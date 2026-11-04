import argparse
import collections
import copy
import gzip
import hashlib
import json
import os
from pathlib import Path
import platform
import random
import statistics
import subprocess
import time
import zipfile

from assess import feature_score, percentile, text_score
from corpus import ROOT, oracle
from image_occurrences import score_image_occurrences
from literal_features import score_literal_features
from normalize import core_block_paragraphs, normalize
from parser_source import parser_version, source_identity
from run import ENGINES
from fidelity_metrics import VERSION as FIDELITY_VERSION, ordered_text, prf, strict_features


MIMES = {
    'doc': 'application/msword',
    'dot': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'dotx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
    'docm': 'application/vnd.ms-word.document.macroEnabled.12',
    'dotm': 'application/vnd.ms-word.template.macroEnabled.12',
}
MAIN_TYPES = {
    'dotx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml',
    'docm': 'application/vnd.ms-word.document.macroEnabled.main+xml',
    'dotm': 'application/vnd.ms-word.template.macroEnabledTemplate.main+xml',
}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))


def prepare(out):
    original = json.loads((out / 'manifest.json').read_text())['entries']
    docs = [e for e in original if e['format'] == 'doc']
    paired = [e for e in original if e['format'] == 'docx' and '/fixtures-doc/' in e['path']]
    candidates = sorted([e for e in original if e['format'] == 'docx' and e not in paired
                         and e['bytes'] < 5_000_000], key=lambda e: (e['bytes'], e['id']))
    selected = paired + [candidates[round(i * (len(candidates) - 1) / 5)] for i in range(6)]
    entries = []

    def add(path, ext, kind, parent=None, reference_path=None):
        digest = sha(path)
        entry = {'id': digest, 'path': str(path), 'bytes': path.stat().st_size,
                 'format': 'doc' if ext in ('doc', 'dot') else 'docx',
                 'extension': ext, 'cohort': kind, 'parent_id': parent,
                 'reference_path': str(reference_path or path)}
        entries.append(entry)

    for entry in docs:
        add(Path(entry['path']), 'doc', 'original_binary',
            reference_path=out / 'references' / (entry['id'] + '.docx'))
    for path in sorted((out / 'generated' / 'dot').glob('*.dot')):
        add(path, 'dot', 'libreoffice_generated_template', path.stem,
            out / 'references' / 'dot' / (path.stem + '.docx'))
    for entry in selected:
        path = Path(entry['path'])
        add(path, 'docx', 'original_ooxml')
        with zipfile.ZipFile(path) as source:
            for extension, content_type in MAIN_TYPES.items():
                target = out / 'generated' / extension / (entry['id'] + '.' + extension)
                target.parent.mkdir(parents=True, exist_ok=True)
                old_type = b'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
                with zipfile.ZipFile(target, 'w') as result:
                    for item in source.infolist():
                        payload = source.read(item.filename)
                        if item.filename == '[Content_Types].xml':
                            if old_type not in payload:
                                raise ValueError('Missing document content type')
                            payload = payload.replace(old_type, content_type.encode())
                        result.writestr(copy.copy(item), payload)
                add(target, extension, 'controlled_content_type_variant_without_vba', entry['id'])
    for entry in entries:
        try:
            truth = oracle(Path(entry['reference_path']))
            truth['reference'] = 'libreoffice_conversion_proxy' if entry['format'] == 'doc' else 'source_ooxml'
            truth['reference_sha256'] = sha(entry['reference_path'])
            entry['paragraphs'] = len(truth['paragraphs'])
            entry['feature_occurrences'] = sum(len(v) for v in truth['features'].values())
        except Exception as exc:
            truth = {'error': str(exc)}
        save(out / 'format-oracle' / (entry['id'] + '.json'), truth)
    save(out / 'format-manifest.json', {'entries': entries, 'mimetypes': MIMES,
         'selection': 'All unique binary inputs; six paired OOXML inputs plus six size-spread OOXML inputs below 5 MB; controlled variants share source content.'})
    print(dict(collections.Counter(e['extension'] for e in entries)), flush=True)


def run(out, repeats):
    binary = out / 'bin' / 'parser-benchmark'
    entries = json.loads((out / 'format-manifest.json').read_text())['entries']
    seed = 20261102
    rng = random.Random(seed)
    jobs = [(e, engine) for e in entries for engine in ENGINES]
    rng.shuffle(jobs)
    env = {'binary_sha256': sha(binary), 'manifest_sha256': sha(out / 'format-manifest.json'),
           'git_revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
           'versions': {'docx-core': parser_version(), 'docx-rs': '0.4.22', 'office_oxide': '0.1.15', 'undoc': '0.27.1'},
           'os': platform.platform(), 'rustc': subprocess.check_output(['rustc', '--version'], text=True).strip(),
           'libreoffice': subprocess.check_output(['soffice', '--version'], text=True).strip(),
           'seed': seed, 'repeats': repeats, 'load_start': os.getloadavg(), 'start_time': time.time(),
           'timing': 'Warm parse plus native model/IR and core structured blocks; excludes input reads, output serialization, destruction, process startup, and reference conversion. Each sample averages adaptive 1–20 parses.',
           'profile': 'release opt-level=3 thin LTO codegen-units=1',
           'source_sha256': source_identity(),
           'scorer_sha256': {p.name: sha(p) for p in Path(__file__).parent.glob('*.py')}}
    save(out / 'format-environment.json', env)
    for index, (entry, engine) in enumerate(jobs):
        prefix = out / 'format-raw' / engine / entry['id']
        prefix.parent.mkdir(parents=True, exist_ok=True)
        metric_path = prefix.with_suffix('.metrics.json')
        row = {'id': entry['id'], 'engine': engine, 'extension': entry['extension'],
               'format': entry['format'], 'binary_sha256': env['binary_sha256'],
               'manifest_sha256': env['manifest_sha256'],
               'repeats': repeats, 'load_before': os.getloadavg()}
        if entry['format'] == 'doc' and engine == 'docx-rs':
            row.update(status='unsupported', error='No legacy Word parser')
        else:
            start = time.time()
            try:
                result = subprocess.run([str(binary), engine, entry['path'], entry['format'], str(prefix), str(repeats)],
                                        capture_output=True, text=True, timeout=120)
                if result.returncode:
                    row.update(status='process_error', returncode=result.returncode, error=result.stderr[-2000:])
                else:
                    row.update(json.loads(result.stdout.strip().splitlines()[-1]))
            except subprocess.TimeoutExpired:
                row.update(status='timeout')
            row['wall_seconds'] = time.time() - start
        samples = row.get('samples', [])
        if samples:
            row['median_total_ms'] = statistics.median(s['total_ms'] for s in samples)
            row['relative_mad'] = statistics.median(abs(s['total_ms'] - row['median_total_ms']) for s in samples) / row['median_total_ms']
        save(metric_path, row)
        if (index + 1) % 12 == 0:
            print('Timed', index + 1, '/', len(jobs), flush=True)
    env.update(end_time=time.time(), load_end=os.getloadavg())
    save(out / 'format-environment.json', env)


def score(out):
    entries = json.loads((out / 'format-manifest.json').read_text())['entries']
    rows = []
    for entry_index, entry in enumerate(entries):
        truth = json.loads((out / 'format-oracle' / (entry['id'] + '.json')).read_text())
        for engine in ENGINES:
            prefix = out / 'format-raw' / engine / entry['id']
            row = json.loads(prefix.with_suffix('.metrics.json').read_text())
            row.update(bytes=entry['bytes'], paragraphs=entry.get('paragraphs', 0),
                       extension=entry['extension'],
                       feature_occurrences=entry.get('feature_occurrences', 0), cohort=entry['cohort'],
                       source_group=entry.get('source_group', 'original'),
                       scope_eligible=entry.get('scope_eligible', True), scope_reason=entry.get('scope_reason'),
                       contains_vba=entry.get('contains_vba', False))
            for metric in ('parse_ms', 'projection_ms'):
                samples = [sample[metric] for sample in row.get('samples', []) if metric in sample]
                row['median_' + metric] = statistics.median(samples) if samples else None
            row['cold_total_ms'] = sum(row['warm_ms']) if row.get('warm_ms') else None
            if 'error' in truth:
                row['accuracy_error'] = truth['error']
                rows.append(row)
                continue
            actual = {'paragraphs': [], 'features': {}}
            if row['status'] == 'ok':
                try:
                    data = json.load(gzip.open(prefix.with_suffix('.json.gz')))
                    actual = normalize(engine, data)
                except Exception as exc:
                    row['accuracy_error'] = 'normalization: ' + str(exc)
                    rows.append(row)
                    continue
            body = [p for p in actual['paragraphs'] if p['story'] == 'body']
            if engine == 'docx-core' and row['status'] == 'ok':
                block_data = json.load(gzip.open(prefix.with_suffix('.blocks.json.gz')))
                paragraphs, audit = core_block_paragraphs(block_data)
                body = [p for p in paragraphs if p['story'] == 'body']
                row['source_reference_audit'] = audit
            row['body'] = text_score([p for p in truth['paragraphs'] if p['story'] == 'body'], body)
            row['ordered_body'] = ordered_text([p for p in truth['paragraphs'] if p['story'] == 'body'], body)
            row['features_v2'] = strict_features(truth, actual)
            row['features'] = feature_score(truth, actual)
            row['features'].update(score_literal_features(Path(entry['reference_path']), truth, actual,
                                   data if engine == 'docx-core' and row['status'] == 'ok' else None))
            if row['status'] != 'ok':
                row['body'].update(recall=0, precision=0, f1=0, paragraph_recall=0)
                row['ordered_body'].update(recall=0, precision=0, f1=0, exact_ordered_text=False, exact_ordered_paragraphs=False)
            if entry['format'] == 'docx':
                payload_model = data if row['status'] == 'ok' else {'resource_payload_sha256': {}}
                row['features']['image_payload_occurrences'] = score_image_occurrences(Path(entry['path']), payload_model, engine)
            row['reference'] = truth['reference']
            rows.append(row)
        if (entry_index + 1) % 20 == 0:
            save(out / 'format-scores.partial.json', rows)
            print('Scored', entry_index + 1, '/', len(entries), flush=True)
    save(out / 'format-scores.json', rows)
    save(out / 'format-scoring-environment.json', {
        'created_at': time.time(), 'manifest_sha256': sha(out / 'format-manifest.json'),
        'scores_sha256': sha(out / 'format-scores.json'),
        'scorer_sha256': {p.name: sha(p) for p in Path(__file__).parent.glob('*.py')},
    })
    summary = summarize(rows)
    save(out / 'format-summary.json', summary)
    save(out / 'format-supported-summary.json', summarize([r for r in rows if r['scope_eligible']]))
    for extension, group in summary.items():
        print(extension, group['common_n'], {engine: {k: v for k, v in value.items() if k != 'features'} for engine, value in group['engines'].items()}, flush=True)


def summarize(rows):
    summary = {}
    for extension in MIMES:
        selected = [r for r in rows if r['extension'] == extension]
        supported = [e for e in ENGINES if not (extension in ('doc', 'dot') and e == 'docx-rs')]
        common = set.intersection(*[{r['id'] for r in selected if r['engine'] == engine and r['status'] == 'ok'} for engine in supported])
        group = {'common_n': len(common), 'common_engines': supported, 'engines': {}}
        for engine in ENGINES:
            all_rows = [r for r in selected if r['engine'] == engine]
            ok = [r for r in all_rows if r['status'] == 'ok']
            paired = [r for r in ok if r['id'] in common]
            features = {}
            for row in all_rows:
                for name, value in row.get('features', {}).items():
                    agg = features.setdefault(name, {'matched': 0, 'expected': 0, 'found': 0,
                                                    'unit': value.get('unit', '')})
                    for key in ('matched', 'expected', 'found'):
                        agg[key] += value.get(key, 0)
            for value in features.values():
                value['recall'] = value['matched'] / value['expected'] if value['expected'] else None
                value.update(precision=value['matched'] / value['found'] if value['found'] else None,
                             f1=2 * value['matched'] / (value['expected'] + value['found']) if value['expected'] + value['found'] else None)
            scored = [r for r in all_rows if 'body' in r]
            totals = {key: sum(r['body'][key + '_grams'] for r in scored) for key in ('matched', 'expected', 'found')}
            ordered = [r['ordered_body'] for r in all_rows if 'ordered_body' in r]
            ordered_totals = {key: sum(r[key] for r in ordered) for key in ('matched', 'expected', 'found')}
            strict = {}
            for row in all_rows:
                for name, value in row.get('features_v2', {}).items():
                    total = strict.setdefault(name, {'matched': 0, 'expected': 0, 'found': 0, 'unit': value['unit']})
                    for key in ('matched', 'expected', 'found'):
                        total[key] += value[key]
            for value in strict.values():
                value.update(prf(value['matched'], value['expected'], value['found']))
            success_scored = [r for r in scored if r['status'] == 'ok']
            common_scored = [r for r in paired if 'body' in r]
            group['engines'][engine] = {
                'attempted': len(all_rows), 'ok': len(ok), 'status': dict(collections.Counter(r['status'] for r in all_rows)),
                'accuracy_scored': len(scored), 'accuracy_unscored': len(all_rows) - len(scored),
                'common_accuracy_scored': len(common_scored),
                'median_ms': percentile([r['median_total_ms'] for r in paired], .5),
                'p95_ms': percentile([r['median_total_ms'] for r in paired], .95),
                'cold_median_ms': percentile([sum(r['warm_ms']) for r in paired], .5),
                'text_f1_macro_all': statistics.mean(r['body']['f1'] for r in scored) if scored else None,
                'text_f1_macro_success': statistics.mean(r['body']['f1'] for r in success_scored) if success_scored else None,
                'text_f1_macro_common': statistics.mean(r['body']['f1'] for r in common_scored) if common_scored else None,
                'text_f1_micro': prf(**totals)['f1'] if scored else None,
                'ordered_f1_macro': statistics.mean(r['f1'] for r in ordered) if ordered else None,
                'ordered_f1_micro': prf(**ordered_totals)['f1'] if ordered else None,
                'exact_ordered_text': sum(r['exact_ordered_text'] for r in ordered),
                'exact_ordered_paragraphs': sum(r['exact_ordered_paragraphs'] for r in ordered),
                'features_v2': strict,
                'features': features,
            }
        summary[extension] = group
    return summary


def report(out):
    manifest = json.loads((out / 'format-manifest.json').read_text())
    rows = json.loads((out / 'format-scores.json').read_text())
    for row in rows:
        row.pop('error', None)
        if 'accuracy_error' in row:
            row['accuracy_error'] = 'Reference or normalized output unavailable; see local receipts.'
        if 'body' in row:
            row['body'].pop('missing_paragraphs', None)
            row['body'].pop('extra_paragraphs', None)
    data = {'mimetypes': MIMES, 'summary': json.loads((out / 'format-summary.json').read_text()),
            'fidelity_version': FIDELITY_VERSION,
            'supported_summary': json.loads((out / 'format-supported-summary.json').read_text()) if (out / 'format-supported-summary.json').exists() else None,
            'rows': rows, 'environment': json.loads((out / 'format-environment.json').read_text()),
            'scoring_environment': json.loads((out / 'format-scoring-environment.json').read_text()),
            'selection': manifest['selection'], 'external': manifest.get('external', False),
            'provenance': manifest.get('provenance'),
            'diagnostics': json.loads((out / 'diagnostics.json').read_text()) if (out / 'diagnostics.json').exists() else None,
            'comparison': json.loads((out / 'comparison.json').read_text()) if (out / 'comparison.json').exists() else None,
            'corpus': {'unique_inputs': len(manifest['entries']), 'excluded_nonword': len(manifest.get('excluded', [])),
                       'source_groups': dict(collections.Counter(e.get('source_group', 'original') for e in manifest['entries'])),
                       'outside_scope': dict(collections.Counter(e.get('scope_reason') for e in manifest['entries'] if not e.get('scope_eligible', True))),
                       'vba_bearing': sum(e.get('contains_vba', False) for e in manifest['entries'])}}
    template = Path(__file__).with_name('word_formats_report.html').read_text()
    (out / 'report.html').write_text(template.replace('__DATA__', json.dumps(data).replace('</', '<\\/')))


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('phase', choices=['prepare', 'run', 'score', 'report'])
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--repeats', type=int, default=9)
    args = ap.parse_args()
    out = args.out.resolve()
    if args.phase == 'run':
        run(out, args.repeats)
    else:
        globals()[args.phase](out)
