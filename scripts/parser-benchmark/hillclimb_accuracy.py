import argparse
import collections
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import time

from assess import feature_score, text_score, load_native
from normalize import normalize, core_block_paragraphs


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, default=Path('output/parser-hillclimb-20261028'))
    parser.add_argument('--label', required=True)
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--split', default='tuning')
    args = parser.parse_args()
    baseline = Path('output/parser-benchmark-20261028')
    entries = json.loads((baseline / 'manifest.json').read_text())['entries']
    if args.split != 'full':
        ids = set(json.loads((args.out / 'split.json').read_text())[args.split])
        entries = [entry for entry in entries if entry['id'] in ids]
    target = args.out / (args.label + '-accuracy')
    target.mkdir(exist_ok=True)
    binary = args.binary.resolve()
    binary_hash = hashlib.sha256(binary.read_bytes()).hexdigest()
    scores = []
    for index, entry in enumerate(entries):
        doc_id = entry['id']
        cache = target / (doc_id + '.score.json')
        if cache.exists() and json.loads(cache.read_text()).get('binary_sha256') == binary_hash:
            scores.append(json.loads(cache.read_text()))
            continue
        record = {'id': doc_id, 'format': entry['format'], 'engine': 'docx-core', 'binary_sha256': binary_hash}
        start = time.monotonic()
        try:
            result = subprocess.run([str(binary), 'docx-core', entry['path'], entry['format'], str(target / doc_id), '0', 'compact'],
                                    capture_output=True, text=True, timeout=240)
            record.update(json.loads(result.stdout))
            if record['status'] == 'ok':
                truth = json.loads((baseline / 'oracle' / (doc_id + '.json')).read_text())
                data = load_native('docx-core', target / (doc_id + '.json.gz'))
                actual = normalize('docx-core', data)
                del data
                block_data = json.load(gzip.open(target / (doc_id + '.blocks.json.gz')))
                blocks, audit = core_block_paragraphs(block_data)
                reference = [p for p in truth['paragraphs'] if p['story'] == 'body']
                record['body'] = text_score(reference, [p for p in blocks if p['story'] == 'body'])
                record['model_body'] = text_score(reference, [p for p in actual['paragraphs'] if p['story'] == 'body'])
                record['features'] = feature_score(truth, actual)
                record['source_reference_audit'] = audit
                with gzip.open(target / (doc_id + '.normalized.json.gz'), 'wt') as stream:
                    json.dump(actual, stream)
        except Exception as error:
            record.update(status='harness_error', error=str(error))
        record['wall_seconds'] = time.monotonic() - start
        cache.write_text(json.dumps(record, indent=2))
        scores.append(record)
        if (index + 1) % 8 == 0:
            print('SCORED', index + 1, '/', len(entries), flush=True)
    (target / 'scores.json').write_text(json.dumps(scores, indent=2))
    features = {}
    for row in scores:
        for key, value in row.get('features', {}).items():
            counter = features.setdefault(key, collections.Counter())
            for field in ['matched', 'expected', 'found']:
                counter[field] += value[field]
    print(json.dumps({'statuses': dict(collections.Counter(row['status'] for row in scores)),
                      'features': {key: value['matched'] / value['expected'] if value['expected'] else 1 for key, value in features.items()}}), flush=True)


if __name__ == '__main__':
    main()
