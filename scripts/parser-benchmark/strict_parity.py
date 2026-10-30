import argparse
import collections
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parent / '.python-deps'))
import ijson


def digest(path, binary=None):
    if binary:
        process = subprocess.run([str(binary.resolve()), str(path)], capture_output=True, text=True, timeout=600, check=True)
        return json.loads(process.stdout)
    stack = []
    root = None
    counts = collections.Counter()
    def append(value):
        nonlocal root
        if not stack:
            root = value
        elif stack[-1]['kind'] == 'map':
            frame = stack[-1]
            frame['items'].append((frame['key'], value))
        else:
            stack[-1]['items'].append(value)
    with gzip.open(path, 'rb') as stream:
        for prefix, event, value in ijson.parse(stream, use_float=True):
            counts[event] += 1
            if event in ('start_map', 'start_array'):
                stack.append({'kind': event[6:], 'path': prefix, 'items': [], 'key': None})
            elif event == 'map_key':
                stack[-1]['key'] = value
            elif event in ('end_map', 'end_array'):
                frame = stack.pop()
                h = hashlib.sha256(frame['kind'].encode())
                if frame['kind'] == 'map':
                    for key, item in sorted(frame['items']):
                        h.update(json.dumps(key, ensure_ascii=False).encode()); h.update(item)
                else:
                    items = frame['items']
                    if frame['path'] in ('metadata.paragraphStyles', 'metadata.tableStyles'):
                        items.sort()
                    for item in items:
                        h.update(item)
                append(h.digest())
            else:
                append(hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()).digest())
    return {'sha256': root.hex(), 'events': dict(counts)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--out', type=Path, default=Path('output/parser-rewrite'))
    parser.add_argument('--label', required=True)
    parser.add_argument('--split', default='tuning')
    parser.add_argument('--manifest', type=Path, default=Path('output/parser-benchmark/manifest.json'))
    parser.add_argument('--digest-binary', type=Path)
    parser.add_argument('--resume', action='store_true')
    args = parser.parse_args()
    entries = json.loads(args.manifest.read_text())['entries']
    if args.split != 'full':
        ids = set(json.loads((args.out / 'split.json').read_text())[args.split])
        entries = [e for e in entries if e['id'] in ids]
    baseline_cache = args.out / 'baseline-digests'
    baseline_cache.mkdir(exist_ok=True)
    binaries = {'baseline': args.baseline.resolve(), 'candidate': args.binary.resolve()}
    hashes = {k: hashlib.sha256(v.read_bytes()).hexdigest() for k,v in binaries.items()}
    digest_hash = hashlib.sha256(args.digest_binary.read_bytes()).hexdigest() if args.digest_binary else 'python-merkle-v1'
    result = {'binary_sha256': hashes, 'digest_sha256': digest_hash, 'normalization': ['JSON object key order', 'paragraphStyles and tableStyles definition order'], 'records': []}
    target = args.out / (args.label + '-strict-parity.json')
    completed = {}
    if args.resume and target.exists():
        previous = json.loads(target.read_text())
        if previous.get('binary_sha256') == hashes and previous.get('digest_sha256') == digest_hash:
            completed = {row['id']: row for row in previous['records'] if row.get('equal')}
    for index, entry in enumerate(entries):
        if entry['id'] in completed:
            result['records'].append(completed[entry['id']])
            continue
        record = {'id': entry['id']}
        with tempfile.TemporaryDirectory(prefix='parity-', dir=args.out) as directory:
            for name, binary in binaries.items():
                cache = baseline_cache / (entry['id'] + '.json')
                if name == 'baseline' and cache.exists():
                    saved = json.loads(cache.read_text())
                    if saved.get('binary_sha256') == hashes[name] and saved.get('digest_sha256', 'python-merkle-v1') == digest_hash:
                        record[name] = saved
                        continue
                prefix = Path(directory) / name
                start = time.monotonic()
                try:
                    process = subprocess.run([str(binary), 'docx-core', entry['path'], entry['format'], str(prefix), '0'], capture_output=True, text=True, timeout=300)
                    data = json.loads(process.stdout)
                    if data['status'] == 'ok':
                        data['model'] = digest(prefix.with_suffix('.json.gz'), args.digest_binary)
                        data['blocks'] = digest(prefix.with_suffix('.blocks.json.gz'), args.digest_binary)
                    data['binary_sha256'] = hashes[name]
                    data['digest_sha256'] = digest_hash
                    data['wall_seconds'] = time.monotonic() - start
                    record[name] = data
                    if name == 'baseline':
                        cache.write_text(json.dumps(data, indent=2))
                except Exception as error:
                    record[name] = {'status': 'harness_error', 'error': str(error)}
            record['equal'] = all(record[n].get('status') == 'ok' for n in binaries) and all(record['baseline'][k] == record['candidate'][k] for k in ['model','blocks'])
        result['records'].append(record)
        target.write_text(json.dumps(result, indent=2))
        if not record['equal']:
            print('MISMATCH', entry['id'], flush=True)
        if (index+1)%8 == 0:
            print('AUDITED', index+1, '/', len(entries), flush=True)
    target.write_text(json.dumps(result, indent=2))
    print(json.dumps({'equal': sum(r['equal'] for r in result['records']), 'total': len(result['records'])}), flush=True)


if __name__ == '__main__':
    main()
