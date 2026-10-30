import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import time

from expanded_benchmark import sha256, write_json


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', type=Path, default=Path('output/parser-next'))
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--advance-baseline', action='store_true')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    root, candidate = args.run.resolve(), args.candidate.resolve()
    current = root / 'final-parser-benchmark'
    old_hash, new_hash = sha256(current), sha256(candidate)
    if old_hash == new_hash:
        parser.error('The candidate is identical to the current binary')
    snapshot = json.loads((root / 'measured-latency.json').read_text())
    expected = snapshot.pop('snapshot_sha256')
    actual = hashlib.sha256(json.dumps(snapshot, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    if actual != expected or snapshot['candidate_binary_sha256'] != old_hash:
        parser.error('A valid complete latency snapshot for the current binary is required')
    if not (root / 'expanded' / 'timing-rows.json').exists():
        parser.error('The current timing output is incomplete')
    archive = root / 'waves' / old_hash
    if archive.exists():
        parser.error('The archive destination already exists; inspect the existing promotion receipt')
    items = [name for name in ['expanded', 'legacy', 'run-steps.json', 'regression-validation-steps.json',
                               'source-receipt.json', 'final-source-receipt.json', 'final-probe', 'final.wasm',
                               'final-source-snapshot.tar.gz', 'source-snapshot.tar.gz'] if (root / name).exists()]
    plan = {'old_binary_sha256': old_hash, 'candidate_binary_sha256': new_hash,
            'archive': str(archive), 'move': items, 'advance_baseline': args.advance_baseline,
            'preserved': ['corpus-1k', 'measured-latency.json', 'latency-snapshots'],
            'status': 'planned', 'created_at': time.time()}
    if not args.apply:
        print(json.dumps(plan, indent=2))
        return
    commands = subprocess.check_output(['ps', '-axo', 'command='], text=True).splitlines()
    markers = [str(root), 'output/' + root.name]
    active = [command for command in commands if 'expanded_benchmark.py' in command
              and any(any(token == marker or token.startswith(marker + '/') for marker in markers)
                      for token in command.split())]
    if active:
        parser.error('A benchmark is still using this output directory')
    temporary_candidate = root / 'final-parser-benchmark.promoting'
    shutil.copy2(candidate, temporary_candidate)
    if sha256(temporary_candidate) != new_hash:
        raise ValueError('Candidate copy identity differs')
    archive.mkdir(parents=True)
    receipt = root / 'promotion.json'
    write_json(receipt, plan)
    shutil.copy2(current, archive / 'final-parser-benchmark')
    for name in ['baseline-parser-benchmark', 'baseline-probe', 'baseline.wasm', 'baseline.json']:
        if (root / name).exists():
            shutil.copy2(root / name, archive / name)
    candidate_receipt = root / 'candidate-source-receipt.json'
    if candidate_receipt.exists():
        value = json.loads(candidate_receipt.read_text())
        if old_hash in value.get('binaries', {}).values():
            shutil.copy2(candidate_receipt, archive / candidate_receipt.name)
    shutil.copy2(root / 'measured-latency.json', archive / 'measured-latency.json')
    for name in items:
        (root / name).rename(archive / name)
    if args.advance_baseline:
        temporary = root / 'baseline-parser-benchmark.promoting'
        shutil.copy2(archive / 'final-parser-benchmark', temporary)
        temporary.replace(root / 'baseline-parser-benchmark')
        baseline_receipt = {'started_at': time.time(), 'native_sha256': old_hash,
                            'prior_baseline_receipt': str(archive / 'baseline.json'),
                            'source_receipt': str(archive / 'final-source-receipt.json')}
        source_path = archive / 'final-source-receipt.json'
        if source_path.exists():
            source = json.loads(source_path.read_text())
            if source.get('binaries', {}).get('final-parser-benchmark') == old_hash:
                baseline_receipt.update(head=source.get('head'), source=source.get('source_sha256', source.get('files')))
        for old_name, baseline_name, hash_key in [('final-probe', 'baseline-probe', 'probe_sha256'),
                                                   ('final.wasm', 'baseline.wasm', 'wasm_sha256')]:
            if (archive / old_name).exists():
                shutil.copy2(archive / old_name, root / baseline_name)
                baseline_receipt[hash_key] = sha256(root / baseline_name)
        write_json(root / 'baseline.json', baseline_receipt)
    temporary_candidate.replace(current)
    plan.update(status='promoted', finished_at=time.time())
    write_json(receipt, plan)
    write_json(archive / 'promotion.json', plan)
    backlog_path = root / 'feature-backlog.json'
    if backlog_path.exists():
        backlog = json.loads(backlog_path.read_text())
        backlog['workflow'] = {'measured_binary_sha256': old_hash, 'candidate_binary_sha256': new_hash,
                               'phase': 'benchmark_pending', 'status': 'waiting',
                               'note': 'Accepted candidate promoted; previous complete latency remains visible while the new corpus run is pending.'}
        write_json(backlog_path, backlog)
    print(json.dumps(plan, indent=2))


if __name__ == '__main__':
    main()
