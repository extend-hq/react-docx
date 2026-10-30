import argparse
import hashlib
import json
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, default=Path('output/parser-frontier'))
    args = parser.parse_args()
    ids = set(json.loads((args.out / 'split.json').read_text())['tuning'])
    entries = [entry for entry in json.loads(Path('output/parser-benchmark/manifest.json').read_text())['entries'] if entry['id'] in ids]
    for manifest in [Path('output/parser-rewrite/xml-all-cases-manifest.json'), args.out / 'prolog-cases-manifest.json', args.out / 'prolog-boundary-manifest.json']:
        entries.extend(json.loads(manifest.read_text())['entries'])
    binaries = {name: args.out / f'{name}.wasm' for name in ['baseline', 'final']}
    result = {'binaries': {name: hashlib.sha256(binary.read_bytes()).hexdigest() for name, binary in binaries.items()},
              'scope': 'Complete WASM-returned model and package, including XML and binary assets; excludes runtime timing fields',
              'normalization': ['JSON object key order', 'paragraphStyles and tableStyles definition order'], 'rows': []}
    for index, entry in enumerate(entries):
        row = {'id': entry['id']}
        for name, binary in binaries.items():
            process = subprocess.run(['node', 'scripts/parser-benchmark/wasm_parity.mjs', str(binary), entry['path']], capture_output=True, text=True, timeout=120, check=True)
            row[name] = json.loads(process.stdout)
        row['equal'] = row['baseline'] == row['final']
        result['rows'].append(row)
        (args.out / 'wasm-output-parity.json').write_text(json.dumps(result, indent=2))
        if (index+1) % 16 == 0:
            print('WASM AUDITED', index+1, '/', len(entries), flush=True)
    result.update(matched=sum(row['equal'] for row in result['rows']), total=len(entries))
    (args.out / 'wasm-output-parity.json').write_text(json.dumps(result, indent=2))
    print(json.dumps({key: value for key, value in result.items() if key != 'rows'}), flush=True)
    if result['matched'] != result['total']:
        raise SystemExit('WASM output differs')


if __name__ == '__main__':
    main()
