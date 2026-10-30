import argparse
import collections
import hashlib
import json
from pathlib import Path
import subprocess

from assess import load_native


def differences(before, after, path=()):
    if type(before) is not type(after):
        yield path, 'type'
    elif isinstance(before, dict):
        for key in sorted(before.keys() | after.keys()):
            if key not in before or key not in after:
                yield (*path, key), 'presence'
            else:
                yield from differences(before[key], after[key], (*path, key))
    elif isinstance(before, list):
        if len(before) != len(after):
            yield path, 'length'
        for index, (a, b) in enumerate(zip(before, after)):
            yield from differences(a, b, (*path, str(index)))
    elif before != after:
        yield path, 'value'


def align_style_metadata(model):
    for key in ['paragraphStyles', 'tableStyles']:
        styles = model.get('metadata', {}).get(key)
        if isinstance(styles, list):
            styles.sort(key=lambda style: style.get('id', ''))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--label', required=True)
    parser.add_argument('--out', type=Path, default=Path('output/parser-hillclimb'))
    args = parser.parse_args()
    baseline = Path('output/parser-benchmark')
    ids = set(json.loads((args.out / 'split.json').read_text())['tuning'])
    entries = [e for e in json.loads((baseline / 'manifest.json').read_text())['entries'] if e['id'] in ids]
    target = args.out / (args.label + '-parity')
    target.mkdir(exist_ok=True)
    binary = args.binary.resolve()
    records = []
    for index, entry in enumerate(entries):
        output = target / entry['id']
        result = subprocess.run([str(binary), 'docx-core', entry['path'], entry['format'], str(output), '0'],
                                capture_output=True, text=True, timeout=240)
        record = {'id': entry['id'], **json.loads(result.stdout)}
        if record['status'] == 'ok':
            before = load_native('docx-core', baseline / 'raw/docx-core' / (entry['id'] + '.json.gz'))
            after = load_native('docx-core', output.with_suffix('.json.gz'))
            align_style_metadata(before)
            align_style_metadata(after)
            changes = list(differences(before, after))
            record['changed_fields'] = dict(collections.Counter(path[-1] if path else '<root>' for path, _ in changes))
            record['changes'] = [{'path': '/'.join(path), 'kind': kind} for path, kind in changes]
        records.append(record)
        (target / 'audit.json').write_text(json.dumps({'binary_sha256': hashlib.sha256(binary.read_bytes()).hexdigest(),
            'excluded': ['XML source markup', 'image payload values (presence retained)', 'style definition order (aligned by ID)'], 'records': records}, indent=2))
        if (index + 1) % 8 == 0:
            print('AUDITED', index + 1, '/', len(entries), flush=True)


if __name__ == '__main__':
    main()
