import argparse
import hashlib
import json
from pathlib import Path
import random
import statistics
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, default=Path('output/parser-hillclimb'))
    parser.add_argument('--repeats', type=int, default=5)
    args = parser.parse_args()
    baseline = args.out / 'baseline.wasm'
    if not baseline.exists():
        baseline.write_bytes(subprocess.check_output(['git', 'show', 'HEAD:packages/wasm/src/docx_wasm_bg.wasm']))
    binaries = {'baseline': baseline, 'candidate': Path('packages/wasm/src/docx_wasm_bg.wasm')}
    hashes = {key: hashlib.sha256(value.read_bytes()).hexdigest() for key, value in binaries.items()}
    ids = set(json.loads((args.out / 'split.json').read_text())['tuning'])
    entries = [e for e in json.loads(Path('output/parser-benchmark/manifest.json').read_text())['entries'] if e['id'] in ids]
    rng = random.Random(9816)
    rng.shuffle(entries)
    result = {'binaries': hashes, 'repeats': args.repeats,
              'scope': 'build_doc_model_from_bytes including JS bridge; no blocks, layout, or I/O; explicit GC outside timed region', 'rows': []}
    for index, entry in enumerate(entries):
        row = {'id': entry['id']}
        order = list(binaries)
        rng.shuffle(order)
        for key in order:
            try:
                process = subprocess.run(['node', '--expose-gc', 'scripts/parser-benchmark/wasm_probe.mjs', str(binaries[key]), entry['path'], str(args.repeats)],
                                         capture_output=True, text=True, timeout=180)
                row[key] = json.loads(process.stdout)
                row[key]['median_ms'] = statistics.median(row[key]['samples_ms'])
            except Exception as error:
                row[key] = {'status': 'error', 'error': str(error), 'stderr': process.stderr[-3000:] if 'process' in locals() else ''}
        if all(row[key]['status'] == 'ok' for key in binaries):
            row['speedup'] = row['baseline']['median_ms'] / row['candidate']['median_ms']
        result['rows'].append(row)
        (args.out / 'wasm-comparison.json').write_text(json.dumps(result, indent=2))
        if (index + 1) % 8 == 0:
            print('WASM', index + 1, '/', len(entries), flush=True)
        if index == 0 and any(row[key]['status'] != 'ok' for key in binaries):
            raise RuntimeError('WASM comparison could not initialize both builds')
    matched = [row for row in result['rows'] if 'speedup' in row]
    result['summary'] = {'matched': len(matched), 'median_paired_speedup': statistics.median(row['speedup'] for row in matched),
                         'median_paired_cold_total_speedup': statistics.median((row['baseline']['init_ms'] + row['baseline']['cold_ms']) / (row['candidate']['init_ms'] + row['candidate']['cold_ms']) for row in matched),
                         **{key: {'median_ms': statistics.median(row[key]['median_ms'] for row in matched),
                                  'cold_median_ms': statistics.median(row[key]['cold_ms'] for row in matched),
                                  'init_median_ms': statistics.median(row[key]['init_ms'] for row in matched),
                                  'cold_total_median_ms': statistics.median(row[key]['init_ms'] + row[key]['cold_ms'] for row in matched)} for key in binaries}}
    (args.out / 'wasm-comparison.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result['summary']), flush=True)


if __name__ == '__main__':
    main()
