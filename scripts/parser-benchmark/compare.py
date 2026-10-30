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
    parser.add_argument('--out', type=Path, default=Path('output/parser-hillclimb'))
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--repeats', type=int, default=5)
    parser.add_argument('--split', default='full')
    args = parser.parse_args()
    binary = args.binary.resolve()
    binary_hash = hashlib.sha256(binary.read_bytes()).hexdigest()
    entries = json.loads(Path('output/parser-benchmark/manifest.json').read_text())['entries']
    if args.split != 'full':
        ids = set(json.loads((args.out / 'split.json').read_text())[args.split])
        entries = [entry for entry in entries if entry['id'] in ids]
    target = args.out / ('comparison-' + args.split)
    target.mkdir(exist_ok=True)
    rng = random.Random(9816)
    rng.shuffle(entries)
    environment = {'started_at': time.time(), 'load_start': os.getloadavg(), 'binary_sha256': binary_hash,
                   'repeats': args.repeats, 'seed': 9816, 'serialization_in_timing': False, 'disk_read_in_timing': False}
    (target / 'environment.json').write_text(json.dumps(environment, indent=2))
    rows = []
    for index, entry in enumerate(entries):
        engines = ['docx-core', 'docx-rs', 'office_oxide', 'undoc']
        rng.shuffle(engines)
        for engine in engines:
            cache = target / (entry['id'] + '.' + engine + '.json')
            if cache.exists():
                previous = json.loads(cache.read_text())
                if previous.get('binary_sha256') == binary_hash and previous.get('repeats') == args.repeats:
                    rows.append(previous)
                    continue
            record = {'id': entry['id'], 'engine': engine, 'format': entry['format'], 'binary_sha256': binary_hash,
                      'repeats': args.repeats, 'started_at': time.time(), 'load_before': os.getloadavg()}
            try:
                process = subprocess.run([str(binary), engine, entry['path'], entry['format'], '-', str(args.repeats)],
                                         capture_output=True, text=True, timeout=240)
                record.update(json.loads(process.stdout))
                if record.get('samples'):
                    record['medians'] = {key: statistics.median(sample[key] for sample in record['samples'])
                                         for key in record['samples'][0]}
                    median = record['medians']['total_ms']
                    record['relative_mad'] = statistics.median(abs(sample['total_ms'] - median) for sample in record['samples']) / median
            except Exception as error:
                record.update(status='harness_error', error=str(error))
            record['wall_seconds'] = time.time() - record['started_at']
            cache.write_text(json.dumps(record, indent=2))
            rows.append(record)
        if (index + 1) % 16 == 0:
            print('TIMED', index + 1, '/', len(entries), flush=True)
    environment.update(finished_at=time.time(), load_end=os.getloadavg())
    (target / 'environment.json').write_text(json.dumps(environment, indent=2))
    (target / 'rows.json').write_text(json.dumps(rows, indent=2))
    print('Comparison complete', flush=True)


if __name__ == '__main__':
    main()
