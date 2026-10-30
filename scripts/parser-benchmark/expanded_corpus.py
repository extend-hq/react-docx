import argparse
import collections
from concurrent.futures import ThreadPoolExecutor
import datetime
import hashlib
import json
from pathlib import Path
import random
import time
import urllib.request
import zipfile


def create_oracles(out):
    from corpus import oracle
    entries = json.loads((out / 'manifest.json').read_text())['entries']
    directory = out / 'oracle'
    directory.mkdir(exist_ok=True)
    errors = []
    for index, entry in enumerate(entries):
        try:
            truth = oracle(Path(entry['path']))
            truth['id'] = entry['id']
        except Exception as error:
            truth = {'id': entry['id'], 'error': str(error)}
            errors.append(truth)
        (directory / (entry['id'] + '.json')).write_text(json.dumps(truth, ensure_ascii=False))
        if (index + 1) % 50 == 0:
            print(json.dumps({'oracles': index + 1, 'total': len(entries), 'errors': len(errors)}), flush=True)
    receipt = {'documents': len(entries), 'success': len(entries) - len(errors), 'errors': errors,
               'oracle_source_sha256': digest(Path(__file__).with_name('corpus.py')),
               'scope': 'Unmodified source-OOXML oracle; failures remain in manifest and are not replaced.'}
    (out / 'oracle-receipt.json').write_text(json.dumps(receipt, indent=2))


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def download(row, directory, max_bytes, max_expanded):
    record = dict(row)
    path = directory / (row['source_id'] + '.docx')
    errors = []
    for attempt in range(3):
        try:
            if not path.exists():
                request = urllib.request.Request(row['url'], headers={'User-Agent': 'docx-parser-research/1.0'})
                with urllib.request.urlopen(request, timeout=60) as response:
                    payload = response.read(max_bytes + 1)
                    if len(payload) > max_bytes:
                        raise ValueError('compressed_size_limit')
                    path.write_bytes(payload)
            record.update(bytes=path.stat().st_size, sha256=digest(path), path=str(path.resolve()))
            with zipfile.ZipFile(path) as archive:
                entries = archive.infolist()
                names = {entry.filename for entry in entries}
                record['uncompressed_bytes'] = sum(entry.file_size for entry in entries)
                if record['uncompressed_bytes'] > max_expanded:
                    raise ValueError('uncompressed_size_limit')
                if '[Content_Types].xml' not in names or 'word/document.xml' not in names:
                    raise ValueError('not_word_ooxml_package')
            record['status'] = 'downloaded_docx'
            record['source_id_matches_bytes'] = record['sha256'] == row['source_id']
            if not record['source_id_matches_bytes']:
                record['source_id_matches_appended_warc_terminator'] = hashlib.sha256(path.read_bytes() + b'\r\n\r\n').hexdigest() == row['source_id']
            break
        except Exception as error:
            errors.append({'attempt': attempt + 1, 'error': str(error), 'type': type(error).__name__})
            record['status'] = 'download_or_package_error'
            if isinstance(error, (ValueError, zipfile.BadZipFile)):
                break
            time.sleep(attempt + 1)
    record['attempt_errors'] = errors
    return record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--metadata', type=Path)
    parser.add_argument('--revision')
    parser.add_argument('--oracle-only', action='store_true')
    parser.add_argument('--count', type=int, default=1000)
    parser.add_argument('--seed', type=int, default=20261029)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--max-compressed-bytes', type=int, default=128 * 1024 * 1024)
    parser.add_argument('--max-expanded-bytes', type=int, default=512 * 1024 * 1024)
    parser.add_argument('--exclude-manifest', type=Path)
    args = parser.parse_args()
    if args.oracle_only:
        create_oracles(args.out)
        return
    if args.metadata is None or args.revision is None:
        parser.error('--metadata and --revision are required for sampling')
    import duckdb
    connection = duckdb.connect()
    connection.execute('SET threads=1')
    raw_rows = connection.execute('SELECT id, url, type, topic, language, word_count FROM read_parquet(?) ORDER BY id', [str(args.metadata)]).fetchall()
    rows = [dict(zip(['source_id', 'url', 'type', 'topic', 'language', 'word_count'], values)) for values in raw_rows]
    connection.close()
    population = len(rows)
    random.Random(args.seed).shuffle(rows)
    directory = args.out.resolve() / 'documents'
    directory.mkdir(parents=True, exist_ok=True)
    excluded = set()
    if args.exclude_manifest:
        excluded = {entry['id'] for entry in json.loads(args.exclude_manifest.read_text())['entries']}
    receipt_path = args.out / 'sampling.json'
    receipt = {
        'dataset': 'superdoc-dev/docx-corpus', 'dataset_revision': args.revision,
        'metadata_url': 'https://huggingface.co/datasets/superdoc-dev/docx-corpus/resolve/' + args.revision + '/data/train-00000-of-00001.parquet',
        'metadata_sha256': digest(args.metadata), 'population_documents': population,
        'seed': args.seed, 'target_documents': args.count,
        'algorithm': 'Python random.Random(seed).shuffle on metadata rows ordered by source ID; take first eligible distinct downloaded byte hashes, retaining every attempted row and rejection.',
        'eligibility': 'ZIP readable, contains [Content_Types].xml and word/document.xml, bounded compressed and uncompressed bytes, unique actual SHA-256, not in excluded legacy benchmark manifest. No language, document type, feature, parser-success, or oracle-success filtering.',
        'max_compressed_bytes': args.max_compressed_bytes, 'max_expanded_bytes': args.max_expanded_bytes,
        'excluded_manifest_sha256': digest(args.exclude_manifest) if args.exclude_manifest else None,
        'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'input_bytes_unchanged': True, 'downloaded_byte_hash_is_authoritative': True,
        'attempts': [],
    }
    accepted = []
    hashes = set()
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        cursor = 0
        while len(accepted) < args.count:
            remaining = min(args.count - len(accepted), 32)
            batch = rows[cursor:cursor + remaining]
            if not batch:
                raise RuntimeError('Sampling population exhausted')
            cursor += len(batch)
            for record in executor.map(lambda row: download(row, directory, args.max_compressed_bytes, args.max_expanded_bytes), batch):
                record['sample_rank'] = len(receipt['attempts']) + 1
                if record['status'] == 'downloaded_docx':
                    value = record['sha256']
                    if value in excluded:
                        record['status'] = 'excluded_previous_corpus'
                    elif value in hashes:
                        record['status'] = 'duplicate_bytes'
                    else:
                        hashes.add(value)
                        accepted.append(record)
                        record['status'] = 'accepted'
                receipt['attempts'].append(record)
            receipt['accepted_documents'] = len(accepted)
            receipt['status_counts'] = dict(collections.Counter(row['status'] for row in receipt['attempts']))
            receipt_path.write_text(json.dumps(receipt, indent=2))
            print(json.dumps({'accepted': len(accepted), 'attempted': len(receipt['attempts']), 'bytes': sum(row['bytes'] for row in accepted)}), flush=True)
    entries = [{'id': row['sha256'], 'path': row['path'], 'bytes': row['bytes'], 'format': 'docx', 'extension': '.docx', 'aliases': [row['path']]} for row in sorted(accepted, key=lambda row: row['sha256'])]
    manifest = {'roots': [str(directory)], 'entries': entries, 'sampling_receipt': str(receipt_path.resolve())}
    (args.out / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    receipt['finished_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    receipt['downloaded_bytes'] = sum(row['bytes'] for row in accepted)
    receipt['languages'] = dict(collections.Counter(row['language'] for row in accepted))
    receipt['document_types'] = dict(collections.Counter(row['type'] for row in accepted))
    receipt['topics'] = dict(collections.Counter(row['topic'] for row in accepted))
    receipt_path.write_text(json.dumps(receipt, indent=2))
    (args.out / 'ATTRIBUTION.txt').write_text('Dataset: superdoc-dev/docx-corpus\nSource: https://docxcorp.us/download\nMetadata: https://huggingface.co/datasets/superdoc-dev/docx-corpus\nDataset license: Open Data Commons Attribution License (ODC-BY) v1.0\nhttps://opendatacommons.org/licenses/by/1-0/\nUnderlying documents retain their respective rights.\n')


if __name__ == '__main__':
    main()
