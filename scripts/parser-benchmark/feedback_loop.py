import argparse
import hashlib
import json
from pathlib import Path
import random
import resource
import shutil
import statistics
import subprocess
import sys
import tempfile
import time


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def save(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def invoke(command, cpu=False):
    usage_before = resource.getrusage(resource.RUSAGE_CHILDREN) if cpu else None
    result = subprocess.run([str(x) for x in command], capture_output=True, text=True, timeout=120)
    if result.returncode:
        raise RuntimeError(result.stderr[-2000:])
    value = json.loads(result.stdout)
    if cpu:
        usage_after = resource.getrusage(resource.RUSAGE_CHILDREN)
        value['process_cpu_ms'] = 1000 * (usage_after.ru_utime + usage_after.ru_stime - usage_before.ru_utime - usage_before.ru_stime)
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', type=Path, default=Path('output/parser-next'))
    parser.add_argument('--label', required=True)
    parser.add_argument('--index', type=int, default=0)
    parser.add_argument('--count', type=int, default=1)
    parser.add_argument('--rounds', type=int, default=7)
    parser.add_argument('--profile', action='store_true')
    parser.add_argument('--queue', type=Path)
    parser.add_argument('--baseline', type=Path, help='Frozen fast-profile baseline executable')
    parser.add_argument('--reference', type=Path, help='Frozen production comparison executable')
    parser.add_argument('--digest', type=Path, help='Canonical output digest executable')
    args = parser.parse_args()
    if not args.label.replace('-', '').replace('_', '').isalnum() or args.rounds < 3 or args.count < 1 or args.index < 0:
        parser.error('Use a simple label, positive count, nonnegative index and at least three rounds')
    if bool(args.baseline) != bool(args.reference):
        parser.error('--baseline and --reference must be supplied together')
    root = Path(__file__).resolve().parents[2]
    run = args.run.resolve()
    work = run / 'feedback-loop'
    queue_path = args.queue.resolve() if args.queue else work / 'queue.json'
    baseline_receipt = work / 'current-baseline.json'
    if not args.baseline and not baseline_receipt.exists():
        parser.error('Provide --baseline and --reference, or initialize current-baseline.json')
    digest_binary = args.digest.resolve() if args.digest else run / 'digest'
    if not queue_path.is_file() or not digest_binary.is_file():
        parser.error('The frozen queue and digest executable must exist before starting a trial')
    directory = work / args.label
    directory.mkdir(parents=True)
    source_paths = sorted((root / 'crates/docx-core/src').rglob('*.rs'))
    source = {str(p.relative_to(root)): sha(p) for p in source_paths}
    result = {'label': args.label, 'status': 'running', 'started_at': time.time(), 'records': [],
              'scope': 'Targeted tuning, not a random corpus estimate. Fast-profile core builds use identical flags; office_oxide uses the accepted release binary. Full native model and block parity is required. Production release/WASM validation remains separate.',
              'source': source, 'rounds': args.rounds, 'index': args.index, 'count': args.count,
              'queue_path': str(queue_path), 'queue_sha256': sha(queue_path)}
    def publish():
        save(directory / 'results.json', result)
        save(work / 'latest.json', result)
    publish()
    try:
        start = time.monotonic()
        with (directory / 'build.log').open('w') as log:
            subprocess.run(['cargo', 'build', '--locked', '--release', '--manifest-path',
                            str(root / 'scripts/parser-feedback/Cargo.toml')], stdout=log, stderr=subprocess.STDOUT, check=True)
        result['build_seconds'] = time.monotonic() - start
        candidate = directory / 'candidate-core'
        shutil.copy2(root / 'scripts/parser-feedback/target/release/parser-feedback', candidate)
        if args.baseline:
            baseline = args.baseline.resolve()
            reference = args.reference.resolve()
        else:
            selected_baseline = json.loads(baseline_receipt.read_text())
            baseline = Path(selected_baseline['baseline']['path'])
            reference = Path(selected_baseline['reference']['path'])
            for name, path in [('baseline', baseline), ('reference', reference)]:
                if sha(path) != selected_baseline[name]['sha256']:
                    raise ValueError('Accepted feedback baseline identity changed')
            for name in ['Cargo.toml', 'Cargo.lock', 'src/main.rs']:
                if sha(root / 'scripts/parser-feedback' / name) != selected_baseline['harness'][name]:
                    raise ValueError('Rebuild the accepted feedback baseline after changing its harness')
            result['baseline_receipt_sha256'] = sha(baseline_receipt)
        result['binaries'] = {k: {'path': str(p), 'sha256': sha(p)} for k, p in
                              [('baseline', baseline), ('candidate', candidate), ('reference_and_oxide', reference)]}
        result['harness_sha256'] = sha(Path(__file__))
        result['cargo_lock_sha256'] = sha(root / 'scripts/parser-feedback/Cargo.lock')
        result['digest_sha256'] = sha(digest_binary)
        result['process_load_start'] = subprocess.check_output(['ps', '-axo', 'pid=,%cpu=,comm='], text=True).splitlines()
        queue = json.loads(queue_path.read_text())
        selected = queue[args.index:args.index + args.count]
        if len(selected) != args.count:
            raise ValueError('Selection extends beyond the frozen queue')
        for ordinal, entry in enumerate(selected, args.index + 1):
            start = time.monotonic()
            path = Path(entry['path'])
            if sha(path) != entry['id']:
                raise ValueError('Input identity changed')
            record = {'ordinal': ordinal, 'input_sha256': entry['id'], 'status': 'validating'}
            result['records'].append(record)
            publish()
            with tempfile.TemporaryDirectory(dir=directory) as temporary:
                outputs = {}
                for name, binary in [('reference', reference), ('baseline', baseline), ('candidate', candidate)]:
                    prefix = Path(temporary) / name
                    parsed = invoke([binary, 'docx-core', path, 'docx', prefix, 0])
                    if parsed['status'] != 'ok' or parsed.get('compact_output'):
                        raise ValueError('Complete native output unavailable')
                    outputs[name] = {kind: invoke([digest_binary, str(prefix) + suffix]) for kind, suffix in
                                     [('model', '.json.gz'), ('blocks', '.blocks.json.gz')]}
                record['output_digests'] = outputs
                record['full_output_parity'] = outputs['reference'] == outputs['baseline'] == outputs['candidate']
            if not record['full_output_parity']:
                raise ValueError('Complete model or structured-block output changed')
            samples = {name: [] for name in ['baseline', 'candidate', 'office_oxide']}
            cpu_samples = {name: [] for name in samples}
            raw = []
            for round_index in range(args.rounds):
                names = list(samples)
                random.Random(20261029 + round_index).shuffle(names)
                for name in names:
                    binary = reference if name == 'office_oxide' else candidate if name == 'candidate' else baseline
                    engine = 'office_oxide' if name == 'office_oxide' else 'docx-core'
                    timing = invoke([binary, engine, path, 'docx', '-', 1], cpu=True)
                    if timing['status'] != 'ok':
                        raise ValueError('Timing failed: ' + name)
                    raw.append({'round': round_index, 'engine': name, 'result': timing})
                    samples[name].extend(timing['samples'])
                    cpu_samples[name].append(timing['process_cpu_ms'] / (1 + timing['loops'] * len(timing['samples'])))
            record['medians'] = {name: {key: statistics.median(row[key] for row in rows) for key in rows[0]}
                                 for name, rows in samples.items()}
            record['process_cpu_per_parse_ms'] = {name: statistics.median(values) for name, values in cpu_samples.items()}
            record['process_cpu_speedup'] = statistics.median(a / b for a, b in zip(cpu_samples['baseline'], cpu_samples['candidate']))
            record['process_cpu_scope'] = 'Supporting diagnostic: process CPU divided by warm and measured parses, including startup and output destruction. Not wall-clock parsing latency.'
            record['speedup'] = statistics.median(a['total_ms'] / b['total_ms'] for a, b in zip(samples['baseline'], samples['candidate']))
            record['candidate_to_oxide'] = record['medians']['candidate']['total_ms'] / record['medians']['office_oxide']['total_ms']
            ratios = [a['total_ms'] / b['total_ms'] for a, b in zip(samples['baseline'], samples['candidate'])]
            rng = random.Random(20261029)
            bootstrap = sorted(statistics.median(rng.choices(ratios, k=len(ratios))) for _ in range(1000))
            record['paired_speedup_interval'] = [bootstrap[25], bootstrap[974]]
            record['timing_spread'] = {name: (max(x['total_ms'] for x in rows) / min(x['total_ms'] for x in rows) - 1) for name, rows in samples.items()}
            record['noisy'] = max(record['timing_spread'].values()) > .15
            record['verdict'] = ('promising; broader validation required' if record['speedup'] >= 1.03 and bootstrap[25] > 1.01 and not record['noisy']
                                 else 'inconclusive; noisy timing' if record['noisy'] else 'no clear material gain')
            if args.profile and sys.platform == 'darwin':
                record['profiles'] = []
                record['profile_scope'] = 'Separate sampled call stacks after timing; inclusive frame counts overlap. Baseline and candidate use the same fast profile; office_oxide uses the bound release comparator.'
                for name, binary, engine in [('baseline', baseline, 'docx-core'), ('candidate', candidate, 'docx-core'), ('office_oxide', reference, 'office_oxide')]:
                    profile_path = directory / f'{ordinal:03d}-{name}-profile.txt'
                    child = subprocess.Popen([str(binary), engine, str(path), 'docx', '-', '100000'], stdout=subprocess.DEVNULL)
                    try:
                        sampled = subprocess.run(['/usr/bin/sample', str(child.pid), '2', '1', '-file', str(profile_path)], capture_output=True, text=True, timeout=15)
                        record['profiles'].append({'engine': name, 'binary_sha256': sha(binary), 'exit_code': sampled.returncode,
                                                   'path': str(profile_path), 'sha256': sha(profile_path) if profile_path.exists() else None})
                    finally:
                        child.terminate()
                        child.wait(timeout=10)
            record['seconds'] = time.monotonic() - start
            record['status'] = 'passed'
            save(directory / f'{ordinal:03d}-samples.json', raw)
            publish()
            print(json.dumps({key: record[key] for key in ['ordinal', 'medians', 'speedup', 'seconds']}), flush=True)
        if source != {str(p.relative_to(root)): sha(p) for p in source_paths}:
            raise ValueError('Source changed during the run')
        result.update(status='complete', finished_at=time.time())
        result['process_load_end'] = subprocess.check_output(['ps', '-axo', 'pid=,%cpu=,comm='], text=True).splitlines()
    except (Exception, KeyboardInterrupt) as error:
        result.update(status='stopped' if isinstance(error, KeyboardInterrupt) else 'failed', error=str(error) or 'Interrupted', finished_at=time.time())
        raise
    finally:
        publish()


if __name__ == '__main__':
    main()
