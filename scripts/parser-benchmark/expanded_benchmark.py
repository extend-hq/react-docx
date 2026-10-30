import argparse
import collections
import gzip
import hashlib
import json
import os
from pathlib import Path
import random
import statistics
import subprocess
import tempfile
import time

from assess import feature_score, load_native, text_score
from normalize import core_block_paragraphs, normalize

ENGINES = ['docx-core', 'docx-rs', 'office_oxide', 'undoc']
HERE = Path(__file__).resolve().parent


def sha256(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    temporary.replace(path)


def scorer_hash():
    value = hashlib.sha256()
    for name in ['assess.py', 'normalize.py', 'corpus.py', 'expanded_benchmark.py']:
        value.update(name.encode())
        value.update((HERE / name).read_bytes())
    return value.hexdigest()


def invoke(binary, engine, entry, prefix, repeats, timeout):
    started = time.time()
    record = {'started_at': started, 'load_before': os.getloadavg()}
    try:
        process = subprocess.run([str(binary), engine, entry['path'], entry['format'], str(prefix),
                                  str(repeats), 'compact'], capture_output=True, text=True,
                                 timeout=timeout)
        if process.returncode:
            record.update(status='process_error', returncode=process.returncode,
                          error=process.stderr[-2000:])
        else:
            record.update(json.loads(process.stdout.strip().splitlines()[-1]))
        if process.stderr:
            record['stderr_tail'] = process.stderr[-2000:]
    except subprocess.TimeoutExpired:
        record.update(status='timeout', timeout_seconds=timeout)
    except Exception as error:
        record.update(status='harness_error', error=str(error))
    record['wall_seconds'] = time.time() - started
    samples = record.get('samples', [])
    if samples:
        record['medians'] = {name: statistics.median(sample[name] for sample in samples)
                             for name in ['parse_ms', 'projection_ms', 'total_ms']}
        median = record['medians']['total_ms']
        record['relative_mad'] = (statistics.median(abs(sample['total_ms'] - median)
                                                  for sample in samples) / median if median else 0)
    return record


def cached(path, identity):
    if not path.exists():
        return None
    value = json.loads(path.read_text())
    return value if value.get('cache_identity') == identity else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--oracle', type=Path, required=True)
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--phase', choices=['timing', 'accuracy', 'all'], default='all')
    parser.add_argument('--engines', nargs='+', choices=ENGINES, default=ENGINES)
    parser.add_argument('--repeats', type=int, default=5)
    parser.add_argument('--timeout', type=float, default=120)
    parser.add_argument('--seed', type=int, default=20261029)
    parser.add_argument('--limit', type=int)
    parser.add_argument('--ids', nargs='+')
    parser.add_argument('--keep-core-output', action='store_true')
    args = parser.parse_args()
    if args.repeats < 1:
        parser.error('--repeats must be positive')
    args.out.mkdir(parents=True, exist_ok=True)
    entries = json.loads(args.manifest.read_text())['entries']
    if args.ids:
        selected = set(args.ids)
        if not selected <= {entry['id'] for entry in entries}:
            parser.error('Requested IDs are absent from the manifest')
        entries = [entry for entry in entries if entry['id'] in selected]
    rng = random.Random(args.seed)
    rng.shuffle(entries)
    if args.limit:
        entries = entries[:args.limit]
    if not entries or len({entry['id'] for entry in entries}) != len(entries):
        parser.error('The manifest must contain distinct input IDs')
    binary = args.binary.resolve()
    binary_hash = sha256(binary)
    baseline = args.baseline.resolve() if args.baseline else None
    baseline_hash = sha256(baseline) if baseline else None
    scorer = scorer_hash()
    source_hashes = {}
    for entry in entries:
        source_hashes[entry['id']] = sha256(entry['path'])
        if source_hashes[entry['id']] != entry['id']:
            parser.error('Input content does not match its manifest identity')
    receipt = {'binary_sha256': binary_hash, 'baseline_binary_sha256': baseline_hash,
               'manifest_sha256': sha256(args.manifest), 'manifest': str(args.manifest.resolve()),
               'oracle': str(args.oracle.resolve()), 'scorer_sha256': scorer, 'seed': args.seed,
               'repeats': args.repeats, 'timeout_seconds': args.timeout, 'attempted': len(entries),
               'engines': args.engines, 'input_ids': [entry['id'] for entry in entries],
               'started_at': time.time(), 'load_start': os.getloadavg(),
               'versions': {'docx-core': 'workspace', 'docx-rs': '0.4.22',
                            'office_oxide': '0.1.15', 'undoc': '0.27.1'},
               'scope': 'Complete native models; core structured blocks and oxide IR conversion included. Warm timings exclude file reads, JSON serialization and destruction. Accuracy is a separate parse; reference scorer unchanged.'}
    phases = ['timing', 'accuracy'] if args.phase == 'all' else [args.phase]
    for phase in phases:
        phase_receipt = {**receipt, 'phase': phase, 'started_at': time.time()}
        write_json(args.out / (phase + '-environment.json'), phase_receipt)
        rows = []
        order = random.Random(args.seed)
        for index, entry in enumerate(entries):
            engines = list(args.engines)
            if phase == 'timing' and baseline:
                engines.append('docx-core-baseline')
            order.shuffle(engines)
            truth_path = args.oracle / (entry['id'] + '.json')
            truth = json.loads(truth_path.read_text()) if phase == 'accuracy' else None
            for engine in engines:
                is_baseline = engine == 'docx-core-baseline'
                selected_binary = baseline if is_baseline else binary
                selected_hash = baseline_hash if is_baseline else binary_hash
                parse_engine = 'docx-core' if is_baseline else engine
                target = args.out / phase / engine / (entry['id'] + '.json')
                identity = {'binary_sha256': selected_hash, 'input_sha256': source_hashes[entry['id']],
                            'scorer_sha256': scorer, 'engine': engine, 'phase': phase,
                            'repeats': args.repeats if phase == 'timing' else 0,
                            'timeout_seconds': args.timeout,
                            'oracle_sha256': sha256(truth_path) if phase == 'accuracy' else None,
                            'keep_core_output': args.keep_core_output if phase == 'accuracy' else False}
                saved = cached(target, identity)
                if saved:
                    rows.append(saved)
                    continue
                record = {'id': entry['id'], 'engine': engine, 'format': entry['format'],
                          'cache_identity': identity}
                if phase == 'timing':
                    record.update(invoke(selected_binary, parse_engine, entry, '-', args.repeats, args.timeout))
                elif 'error' in truth:
                    record.update(status='reference_error', error=truth['error'])
                else:
                    actual = {'paragraphs': [], 'features': {}}
                    reference = [p for p in truth['paragraphs'] if p['story'] == 'body']
                    with tempfile.TemporaryDirectory(prefix='accuracy-', dir=args.out) as temporary:
                        prefix = Path(temporary) / 'parsed'
                        record.update(invoke(selected_binary, parse_engine, entry, prefix, 0, args.timeout))
                        parse_status = record['status']
                        if parse_status == 'ok':
                            try:
                                native = load_native(parse_engine, prefix.with_suffix('.json.gz'))
                                actual = normalize(parse_engine, native)
                                del native
                                if parse_engine == 'docx-core':
                                    with gzip.open(prefix.with_suffix('.blocks.json.gz')) as stream:
                                        blocks, audit = core_block_paragraphs(json.load(stream))
                                    record['model_body'] = text_score(reference, [p for p in actual['paragraphs'] if p['story'] == 'body'])
                                    record['body'] = text_score(reference, [p for p in blocks if p['story'] == 'body'])
                                    record['source_reference_audit'] = audit
                                normalized = args.out / 'normalized' / engine / (entry['id'] + '.json.gz')
                                normalized.parent.mkdir(parents=True, exist_ok=True)
                                with gzip.open(normalized, 'wt', encoding='utf-8') as stream:
                                    json.dump(actual, stream, ensure_ascii=False)
                                if args.keep_core_output and parse_engine == 'docx-core':
                                    destination = args.out / 'core-output'
                                    destination.mkdir(exist_ok=True)
                                    for suffix in ['.json.gz', '.blocks.json.gz']:
                                        prefix.with_suffix(suffix).replace(destination / (entry['id'] + suffix))
                            except Exception as error:
                                record.update(status='normalization_error', error=str(error))
                                actual = {'paragraphs': [], 'features': {}}
                        record.setdefault('body', text_score(reference, [p for p in actual['paragraphs'] if p['story'] == 'body']))
                        if record['status'] != 'ok':
                            record['body'].update(recall=0.0, precision=0.0, f1=0.0, paragraph_recall=0.0, exact_text=False)
                        record['features'] = feature_score(truth, actual)
                        record['parse_status'] = parse_status
                record['engine'] = engine
                write_json(target, record)
                rows.append(record)
            if (index + 1) % 10 == 0 or index + 1 == len(entries):
                print(phase.upper(), index + 1, '/', len(entries),
                      'minutes', round((time.time() - phase_receipt['started_at']) / 60, 1), flush=True)
        write_json(args.out / (phase + '-rows.json'), rows)
        phase_receipt.update(finished_at=time.time(), load_end=os.getloadavg(),
                             statuses={engine: dict(collections.Counter(row['status'] for row in rows if row['engine'] == engine))
                                       for engine in dict.fromkeys(row['engine'] for row in rows)})
        write_json(args.out / (phase + '-environment.json'), phase_receipt)
        print(json.dumps({'phase': phase, 'statuses': phase_receipt['statuses']}), flush=True)


if __name__ == '__main__':
    main()
