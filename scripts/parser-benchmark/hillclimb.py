import argparse
import hashlib
import json
import os
from pathlib import Path
import random
import statistics
import subprocess
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, default=Path('output/parser-hillclimb-20261028'))
    parser.add_argument('--label', required=True)
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--candidate', type=Path, default=Path('scripts/parser-benchmark/target/release/probe'))
    parser.add_argument('--split', default='tuning')
    parser.add_argument('--repeats', type=int, default=5)
    args = parser.parse_args()
    ids = json.loads((args.out / 'split.json').read_text())[args.split]
    manifest = json.loads(Path('output/parser-benchmark-20261028/manifest.json').read_text())
    entries = {e['id']: e for e in manifest['entries']}
    binaries = {'candidate': args.candidate.resolve()}
    if args.baseline:
        binaries['baseline'] = args.baseline.resolve()
    result = {'label': args.label, 'split': args.split, 'repeats': args.repeats,
              'started_at': time.time(), 'load_start': os.getloadavg(),
              'binaries': {k: {'path': str(v), 'sha256': hashlib.sha256(v.read_bytes()).hexdigest()}
                           for k, v in binaries.items()}, 'rows': []}
    target = args.out / (args.label + '-' + args.split + '.json')
    rng = random.Random(9816)
    for index, doc_id in enumerate(ids):
        order = list(binaries)
        rng.shuffle(order)
        row = {'id': doc_id}
        for name in order:
            start = time.monotonic()
            try:
                process = subprocess.run([str(binaries[name]), entries[doc_id]['path'], str(args.repeats)],
                                         capture_output=True, text=True, timeout=240)
                data = json.loads(process.stdout)
                samples = data['samples']
                row[name] = {**data, 'medians': {k: statistics.median(s[k] for s in samples) for k in samples[0]},
                             'wall_seconds': time.monotonic() - start}
            except Exception as error:
                row[name] = {'error': str(error), 'wall_seconds': time.monotonic() - start}
        if all('medians' in row.get(k, {}) for k in ('baseline', 'candidate')):
            row['speedup'] = row['baseline']['medians']['total_ms'] / row['candidate']['medians']['total_ms']
        result['rows'].append(row)
        result['updated_at'] = time.time()
        target.write_text(json.dumps(result, indent=2))
        if (index + 1) % 8 == 0:
            print('PROGRESS', index + 1, '/', len(ids), flush=True)
    ratios = [r['speedup'] for r in result['rows'] if 'speedup' in r]
    if ratios:
        result['median_paired_speedup'] = statistics.median(ratios)
    result['load_end'] = os.getloadavg()
    target.write_text(json.dumps(result, indent=2))
    print(json.dumps({k: result[k] for k in ['label', 'split', 'median_paired_speedup'] if k in result}), flush=True)


if __name__ == '__main__':
    main()
