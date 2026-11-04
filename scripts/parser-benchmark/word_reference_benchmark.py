import argparse
import collections
import json
import os
from pathlib import Path
import platform
import random
import shutil
import statistics
import subprocess
import tempfile
import time

from assess import load_native, percentile
from fidelity_metrics import prf
from image_occurrences import score_image_occurrences
from normalize import normalize
from parser_source import parser_version, source_identity
from run import ENGINES
from word_recall import score
from word_structured import VERSION, read_gzip, save, save_gzip, sha, status


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def scorer_identity():
    names = ['word_recall.py', 'word_structured.py', 'word_reference_benchmark.py', 'assess.py', 'normalize.py', 'fidelity_metrics.py',
             'literal_features.py', 'semantic_audit.py', 'image_occurrences.py', 'image_payload_audit.py', 'corpus.py']
    return {name: sha(HERE / name) for name in names}


def prepare_timing(out, baseline, binary):
    previous = json.loads((baseline / 'format-environment.json').read_text())
    target = out / 'bin/current-parser-benchmark'
    shutil.copy2(binary, target)
    save(out / 'build-environment.json', {
        **{key: previous[key] for key in ['timing', 'profile']},
        'versions': {**previous['versions'], 'docx-core': parser_version()},
        'binary_sha256': sha(target), 'source_sha256': source_identity(),
        'git_revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'rustc': subprocess.check_output(['rustc', '--version'], text=True).strip(),
        'created_at': time.time(), 'engine_names': {'docx-core': 'extend-docx'},
    })


def aggregate(values):
    if not values:
        return None
    counts = {key: sum(v[key] for v in values) for key in ['matched', 'expected', 'found']}
    return {**counts, **prf(**counts), 'scored': len(values), 'unit': values[0].get('unit')}


def summarize(rows):
    successes = {engine: {r['id'] for r in rows if r['engine'] == engine and r['status'] == 'ok'} for engine in ENGINES}
    common = set.intersection(*successes.values())
    result = {}
    for engine in ENGINES:
        group = [r for r in rows if r['engine'] == engine]
        scored = [r for r in group if r.get('word')]
        measured = [r['median_total_ms'] for r in group if r['id'] in common and r.get('median_total_ms') is not None]
        result[engine] = {'attempted': len(group), 'ok': len(successes[engine]), 'scored': len(scored),
                          'common': len(common), 'median_ms': percentile(measured, .5), 'p95_ms': percentile(measured, .95),
                          'body': aggregate([r['word']['body'] for r in scored]),
                          'body_macro_f1': statistics.mean(r['word']['body']['f1'] for r in scored) if scored else None,
                          'exact_body_text': sum(r['word']['body']['exact_ordered_text'] for r in scored)}
        for key in ['native_features', 'export_features', 'source_features']:
            groups = [r.get(key, {}) if key == 'source_features' else r.get('word', {}).get(key, {}) for r in group]
            names = sorted(set().union(*(g.keys() for g in groups)))
            result[engine][key] = {name: aggregate([g[name] for g in groups if name in g]) for name in names}
    return result, len(common)


def publish(out, site, rows, stage, timing_environment, total):
    comparison, common = summarize(rows)
    environment = json.loads((out / 'capture-environment.json').read_text())
    label = 'Previous completed parser timings; Word accuracy is being rescored from the matching retained native outputs.' if stage == 'retained' else (
        'Fresh timing and Word accuracy run complete.' if stage == 'complete' else 'Fresh timing and Word accuracy estimates are partial.')
    scored = min(v['scored'] for v in comparison.values())
    data = {'updated_at': time.time(), 'stage': stage, 'comparison': comparison,
            'scope': f'{label} {total:,} source inputs; {common:,} common successful timing inputs; {scored:,} Word-scored inputs per parser so far.',
            'coverage': f'Word-scored inputs: {scored:,}/{total:,}. Each feature shows its own reference coverage. Failed or unavailable captures never receive perfect scores.',
            'points': [{'id': r['id'][:12], 'engine': r['engine'], 'ms': r['median_total_ms'],
                        **{key: r.get(key, 0) for key in ['bytes', 'paragraphs', 'feature_occurrences']}}
                       for r in rows if r['status'] == 'ok' and r.get('median_total_ms') is not None],
            'receipt': {'reference': environment, 'timing': {key: timing_environment.get(key) for key in
                        ['binary_sha256', 'manifest_sha256', 'git_revision', 'versions', 'os', 'seed', 'repeats', 'timing', 'profile', 'start_time', 'end_time']},
                        'scorer_sha256': scorer_identity()}}
    save(out / 'benchmark.json', data)
    if site:
        site.mkdir(parents=True, exist_ok=True)
        save(site / 'benchmark.json', data)
        shutil.copy2(HERE / 'word_structured_report.html', site / 'report.html')
    return data


def reference_for(out, entry):
    prefix = out / 'references' / entry['id']
    path = prefix.with_suffix('.json.gz')
    receipt_path = prefix.with_suffix('.receipt.json')
    if not receipt_path.exists():
        return None, None
    receipt = json.loads(receipt_path.read_text())
    if receipt.get('status') != 'ok':
        return None, None
    capture_env = json.loads((out / 'capture-environment.json').read_text())
    if receipt.get('exporter_sha256') != capture_env['exporter_sha256']:
        return None, None
    digest = sha(path)
    if digest != receipt['reference_sha256']:
        raise ValueError('Word reference artifact hash mismatch')
    reference = read_gzip(path)
    if reference['source_sha256'] != entry['id']:
        raise ValueError('Word reference source identity mismatch')
    return reference, digest


def retained(out, baseline, site, follow):
    entries = json.loads((out / 'manifest.json').read_text())['entries']
    env = json.loads((baseline / 'format-environment.json').read_text())
    capture_env = json.loads((out / 'capture-environment.json').read_text())
    if env['binary_sha256'] != capture_env['binary_sha256']:
        raise ValueError('Retained output binary differs from the selected benchmark binary')
    original = json.loads((baseline / 'format-scores.json').read_text())
    selected = {e['id'] for e in entries}
    if not selected.issubset({r['id'] for r in original}):
        raise ValueError('Selected inputs are missing from the retained output cohort')
    original = [r for r in original if r['id'] in selected]
    identity = scorer_identity()
    rows = []
    lookup = {}
    for old in original:
        row = {key: old[key] for key in ['id', 'engine', 'status', 'median_total_ms', 'bytes', 'paragraphs', 'feature_occurrences'] if key in old}
        row['binary_sha256'] = env['binary_sha256']
        value = old.get('features', {}).get('image_payload_occurrences')
        if value:
            row['source_features'] = {'image_payload_occurrences': {**value, **prf(value['matched'], value['expected'], value['found'])}}
        rows.append(row)
        lookup[old['id'], old['engine']] = row
    first_publish = True
    while True:
        changed = first_publish
        first_publish = False
        for entry in entries:
            receipt_path = out / 'references' / (entry['id'] + '.receipt.json')
            if receipt_path.exists():
                receipt = json.loads(receipt_path.read_text())
                if all(lookup[entry['id'], e].get('reference_sha256') == receipt.get('reference_sha256')
                       and 'word' in lookup[entry['id'], e] for e in ENGINES):
                    continue
            reference, reference_hash = reference_for(out, entry)
            if reference is None:
                continue
            for engine in ENGINES:
                row = lookup[entry['id'], engine]
                if row.get('reference_sha256') == reference_hash:
                    continue
                cache = out / 'retained-scores' / engine / (entry['id'] + '.json')
                cached = json.loads(cache.read_text()) if cache.exists() else {}
                if cached.get('reference_sha256') == reference_hash and cached.get('scorer_sha256') == identity:
                    row.update(cached)
                    changed = True
                    continue
                actual = {'paragraphs': [], 'features': {}}
                if row['status'] == 'ok':
                    path = baseline / 'format-raw' / engine / (entry['id'] + '.json.gz')
                    native = load_native(engine, path)
                    actual = normalize(engine, native)
                    row['native_output_sha256'] = sha(path)
                    del native
                row.update(word=score(reference, actual), reference_sha256=reference_hash, scorer_sha256=identity)
                save(cache, row)
                changed = True
        if changed or not (out / 'benchmark.json').exists():
            publish(out, site, rows, 'retained', env, len(entries))
            print(json.dumps({'word_scored_rows': sum('word' in r for r in rows), 'total_rows': len(rows)}), flush=True)
        if not follow:
            return
        current = json.loads((out / 'status.json').read_text()) if (out / 'status.json').exists() else {}
        if current.get('stage') == 'capture_complete' and current.get('total') == len(entries):
            return
        time.sleep(5)


def run(out, baseline, site, repeats, timeout):
    entries = json.loads((out / 'manifest.json').read_text())['entries']
    binary = out / 'bin/current-parser-benchmark'
    previous = json.loads((out / 'build-environment.json').read_text())
    if sha(binary) != previous['binary_sha256']:
        raise ValueError('Benchmark binary identity changed')
    if source_identity() != previous['source_sha256']:
        raise ValueError('Current parser source differs from the pinned binary')
    summary = json.loads((out / 'capture-summary.json').read_text())
    capture_env = json.loads((out / 'capture-environment.json').read_text())
    if (summary['total'] != len(entries) or summary['exporter_sha256'] != capture_env['exporter_sha256']
            or summary['manifest_sha256'] != sha(out / 'manifest.json')):
        raise ValueError('Full reference capture must finish before timing begins')
    env = {**previous, 'manifest_sha256': sha(out / 'manifest.json'), 'seed': 20261103, 'repeats': repeats,
           'start_time': time.time(), 'end_time': None, 'os': platform.platform(), 'load_start': os.getloadavg(),
           'git_revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
           'reference_version': VERSION, 'scorer_sha256': scorer_identity()}
    env.pop('load_end', None)
    save(out / 'environment.json', env)
    jobs = [(entry, engine) for entry in entries for engine in ENGINES]
    random.Random(env['seed']).shuffle(jobs)
    rows = []
    started = time.time()
    for index, (entry, engine) in enumerate(jobs):
        row = {'id': entry['id'], 'engine': engine, 'binary_sha256': env['binary_sha256'],
               'manifest_sha256': env['manifest_sha256'], 'repeats': repeats, 'started_at': time.time(),
               'load_before': os.getloadavg(), 'bytes': entry['bytes'],
               **{key: entry.get(key, 0) for key in ['paragraphs', 'feature_occurrences']}}
        actual = None
        try:
            if sha(entry['path']) != entry['id']:
                raise ValueError('Input hash changed')
            if shutil.disk_usage(out).free < 2 * 2**30:
                raise RuntimeError('Insufficient free space for native output')
            with tempfile.TemporaryDirectory(prefix='parser-output-', dir=out) as directory:
                prefix = Path(directory) / 'native'
                process = subprocess.run([str(binary), engine, entry['path'], 'docx', str(prefix), str(repeats)],
                                         text=True, capture_output=True, timeout=timeout)
                if process.returncode:
                    row.update(status='process_error', error=process.stderr[-300:])
                else:
                    row.update(json.loads(process.stdout.strip().splitlines()[-1]))
                if row['status'] == 'ok':
                    row['median_total_ms'] = statistics.median(s['total_ms'] for s in row['samples'])
                    try:
                        native_path = prefix.with_suffix('.json.gz')
                        native = load_native(engine, native_path, preserve_image_payloads=True)
                        actual = normalize(engine, native)
                        row['native_output_sha256'] = sha(native_path)
                        row['source_features'] = {'image_payload_occurrences': score_image_occurrences(Path(entry['path']), native, engine)}
                        value = row['source_features']['image_payload_occurrences']
                        value.update(prf(value['matched'], value['expected'], value['found']))
                        del native
                        normalized_path = out / 'normalized' / engine / (entry['id'] + '.json.gz')
                        save_gzip(normalized_path, actual)
                        row['normalized_sha256'] = sha(normalized_path)
                    except Exception as error:
                        actual = None
                        row['accuracy_error'] = str(error)
                else:
                    actual = {'paragraphs': [], 'features': {}}
        except subprocess.TimeoutExpired:
            row.update(status='timeout')
            actual = {'paragraphs': [], 'features': {}}
        except Exception as error:
            row.update(status='harness_error', error=str(error))
        reference, reference_hash = reference_for(out, entry)
        if reference and actual is not None:
            row.update(word=score(reference, actual), reference_sha256=reference_hash)
        if row['status'] not in ['ok', 'harness_error']:
            row['source_features'] = {'image_payload_occurrences': score_image_occurrences(Path(entry['path']), {'resource_payload_sha256': {}}, engine)}
        row['wall_seconds'] = time.time() - row['started_at']
        save(out / 'measurements' / engine / (entry['id'] + '.json'), row)
        rows.append(row)
        if (index + 1) % 20 == 0 or index + 1 == len(jobs):
            save(out / 'scores.partial.json', rows)
            publish(out, site, rows, 'timing', env, len(entries))
            status(out, site, stage='timing', completed=index + 1, total=len(jobs),
                   message=f'Fresh four-library benchmark: {index + 1:,}/{len(jobs):,} parser jobs complete. Word capture is finished.')
            print(json.dumps({'timed': index + 1, 'total': len(jobs), 'elapsed_s': round(time.time() - started, 1)}), flush=True)
    env.update(end_time=time.time(), load_end=os.getloadavg())
    save(out / 'environment.json', env)
    save(out / 'scores.json', rows)
    publish(out, site, rows, 'complete', env, len(entries))
    status(out, site, stage='complete', completed=len(jobs), total=len(jobs),
           message=f'Complete: {len(entries):,} source inputs, {len(jobs):,} fresh parser jobs. Word-reference coverage and failures are shown below.')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('phase', choices=['retained', 'prepare-timing', 'run'])
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--site', type=Path)
    parser.add_argument('--follow', action='store_true')
    parser.add_argument('--binary', type=Path)
    parser.add_argument('--repeats', type=int, default=5)
    parser.add_argument('--timeout', type=int, default=180)
    args = parser.parse_args()
    if args.phase == 'retained':
        retained(args.out.resolve(), args.baseline.resolve(), args.site, args.follow)
    elif args.phase == 'prepare-timing':
        if args.binary is None:
            parser.error('--binary is required for prepare-timing')
        prepare_timing(args.out.resolve(), args.baseline.resolve(), args.binary)
    else:
        run(args.out.resolve(), args.baseline.resolve(), args.site, args.repeats, args.timeout)


if __name__ == '__main__':
    main()
