import argparse
import collections
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import statistics
import zipfile
from zoneinfo import ZoneInfo

from assess import percentile
from expanded_benchmark import ENGINES, sha256, write_json
from frontier_report import CHART_METRICS

LABELS = {'body_f1': 'Body text F1', 'tables': 'Table text', 'table_cells': 'Table-cell text',
          'images': 'Image occurrences', 'equations': 'Equation occurrences',
          'hyperlinks': 'Hyperlink text', 'headings': 'Headings', 'lists': 'Lists',
          'horizontal_merges': 'Raw horizontal spans', 'vertical_merges': 'Vertical merges',
          'nested_tables': 'Nested tables', 'explicit_bold': 'Explicit bold text',
          'explicit_italic': 'Explicit italic text', 'textbox_text': 'Text-box text',
          'header_text': 'Header text', 'footer_text': 'Footer text', 'footnotes_text': 'Footnote text',
          'endnotes_text': 'Endnote text', 'comments_text': 'Comment text'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    return json.loads(path.read_text())


def features(rows):
    result = {}
    for row in rows:
        for name, value in row.get('features', {}).items():
            target = result.setdefault(name, {'matched': 0, 'expected': 0, 'found': 0,
                                               'documents': 0, 'unit': value['unit']})
            for field in ['matched', 'expected', 'found']:
                target[field] += value[field]
            target['documents'] += 1
    for value in result.values():
        value['recall'] = value['matched'] / value['expected'] if value['expected'] else None
    return result


def latency(rows):
    return [row['medians']['total_ms'] for row in rows if row.get('status') == 'ok'
            and 'medians' in row and math.isfinite(row['medians']['total_ms'])
            and row['medians']['total_ms'] > 0]


def body_mean(rows):
    values = [row['body']['f1'] for row in rows if 'body' in row]
    return statistics.mean(values) if values else None


def semantic_receipt(path, binary_hash, label, baseline_path=None):
    if not path.exists():
        return None
    result = read_json(path)
    records = result.get('rows', [])
    require(len(records) == result['attempted'], 'Semantic audit result count differs from its declared scope')
    require(len({row['id'] for row in records}) == len(records), 'Duplicate semantic audit input')
    scores = {row['id']: row for row in read_json(path.parent / 'accuracy-rows.json') if row['engine'] == 'docx-core'}
    for row in records:
        require(row['id'] in scores, 'Semantic audit input is absent from current accuracy results')
        require(scores[row['id']]['cache_identity']['binary_sha256'] == binary_hash,
                'Semantic audit does not match the current build')
        if row['status'] == 'ok':
            model_path = path.parent / 'core-output' / (row['id'] + '.json.gz')
            require(model_path.exists() and sha256(model_path) == row['model_artifact_sha256'],
                    'Semantic model output changed after its audit')
    value = {key: result[key] for key in ['attempted', 'statuses', 'summary', 'diagnostics',
                                          'limitations', 'scope', 'method']}
    value['label'] = label
    value['receipt_path'] = path
    value['baseline'] = None
    if baseline_path and baseline_path.exists():
        baseline = read_json(baseline_path)
        require({row['id'] for row in baseline.get('rows', [])} == {row['id'] for row in records},
                'Semantic baseline and candidate cohorts differ')
        value['baseline'] = {key: baseline[key] for key in ['attempted', 'statuses', 'summary', 'diagnostics']}
    return value


def legacy_update(path, previous, cohort_path, binary_hash, scorer):
    if not path.exists():
        return None
    measured = read_json(cohort_path)
    indexed = {(row['id'], row['engine']): row for row in measured if row['format'] == 'docx'}
    fixed = {key for key, _ in indexed if all(indexed.get((key, engine), {}).get('status') == 'ok' for engine in ENGINES)}
    require(len(fixed) == previous['comparison']['fixed_common'], 'Original comparison cohort cannot be reconstructed')
    candidate = {row['id']: row for row in read_json(path) if row['engine'] == 'docx-core' and row['format'] == 'docx'}
    require(fixed <= candidate.keys(), 'Original fixed cohort has unfinished candidate scores')
    selected = [candidate[key] for key in sorted(fixed)]
    for row in selected:
        identity = row['cache_identity']
        require(identity['binary_sha256'] == binary_hash and identity['scorer_sha256'] == scorer
                and identity['input_sha256'] == row['id'], 'Legacy candidate score provenance differs')
    before = previous['quality_comparison']['docx-core']
    after = {'body_f1': body_mean(selected), 'features': features(selected)}
    for name, value in before['features'].items():
        require(name in after['features'] and value['expected'] == after['features'][name]['expected'],
                'The original feature denominator changed: ' + name)
    labels = {'body_f1': LABELS['body_f1']}
    labels.update({name: LABELS.get(name, name.replace('_', ' ').capitalize()) for name in before['features']})
    return {'documents': len(fixed), 'before': before, 'after': after, 'labels': labels,
            'statuses': dict(collections.Counter(row['status'] for row in selected)),
            'receipt_path': path}


def fidelity_findings(root, destination):
    descriptions = [
        ('table-findings.md', 'Preserve consistent logical table columns',
         'Preserve logical source spans with an explicit projection to physical columns. Fixed-layout tables with complete rows and anchored positive column widths can also resolve shared boundary constraints; other conflicts retain the existing fallback. Native geometry, editing/export controls, and bounded Word runtime controls support these cases. General autofit layout and Word-identical pagination remain unverified.'),
        ('feature-audit-findings.md', 'Correct hyperlink destinations',
         'Decode relationship target XML escapes exactly once and retain external relative targets for caller-side resolution. Internal targets continue to resolve against their package part. Destination-character checks below are separate from the original hyperlink-text recall.'),
        ('symbol-findings.md', 'Verified font-specific symbol mappings',
         'Add standard-Unicode Monotype Sorts mappings corroborated by vendor mapping data and LibreOffice conversion data. Unsupported private mappings retain the prior fallback; complete symbol coverage is not established.'),
        ('word-rea.md', 'Word binary and specification evidence',
         'The retained investigation distinguishes observed grid-oriented and edge-oriented topology mechanisms from unknown import selection rules. It does not establish the complete Word layout algorithm or optimal runtime latency.'),
    ]
    return [{'title': title, 'description': description,
             'evidence_url': os.path.relpath(root / name, destination)}
            for name, title, description in descriptions if (root / name).exists()]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--oracle', type=Path)
    parser.add_argument('--allow-partial', action='store_true')
    parser.add_argument('--legacy', type=Path, default=Path('output/parser-frontier/report-data.json'))
    parser.add_argument('--legacy-cohort', type=Path, default=Path('output/parser-rewrite/comparison-full/rows.json'))
    parser.add_argument('--validation-note', default='Extraction-reference scores do not establish Word-identical rendering or universal accuracy. Parser parity and fidelity checks are reported separately; this page does not infer them from a high recall score.')
    args = parser.parse_args()
    timing_env = read_json(args.out / 'timing-environment.json')
    accuracy_env = read_json(args.out / 'accuracy-environment.json')
    for field in ['binary_sha256', 'manifest_sha256', 'scorer_sha256', 'input_ids']:
        require(timing_env[field] == accuracy_env[field], 'Timing and accuracy provenance differ: ' + field)
    manifest_path = args.manifest or Path(timing_env['manifest'])
    oracle_dir = args.oracle or Path(accuracy_env['oracle'])
    require(sha256(manifest_path) == timing_env['manifest_sha256'], 'Manifest changed after measurements')
    manifest = read_json(manifest_path)
    entries = {entry['id']: entry for entry in manifest['entries']}
    ids = set(timing_env['input_ids'])
    require(ids <= set(entries), 'Measured input identity is absent from manifest')
    timings = read_json(args.out / 'timing-rows.json')
    scores = read_json(args.out / 'accuracy-rows.json')
    by_timing = {(row['id'], row['engine']): row for row in timings}
    by_score = {(row['id'], row['engine']): row for row in scores}
    require(len(by_timing) == len(timings) and len(by_score) == len(scores), 'Duplicate result identity')
    for row in timings + scores:
        require(row['id'] in ids, 'Result is outside the selected cohort')
        identity = row['cache_identity']
        expected_hash = timing_env['baseline_binary_sha256'] if row['engine'] == 'docx-core-baseline' else timing_env['binary_sha256']
        require(identity['binary_sha256'] == expected_hash and identity['input_sha256'] == row['id']
                and identity['scorer_sha256'] == timing_env['scorer_sha256'], 'Result cache identity does not match report')
        if identity['phase'] == 'timing':
            require(identity['repeats'] == timing_env['repeats'], 'Mixed timing sample counts')
    complete = all((key, engine) in by_timing and (key, engine) in by_score for key in ids for engine in ENGINES)
    require(complete or args.allow_partial, 'Not every selected input has timing and accuracy results for all four parsers')
    common = {key for key in ids if all(latency([by_timing.get((key, engine), {})]) for engine in ENGINES)}
    require(bool(common), 'No common successful timed inputs')
    quality_common = {key for key in common if all(by_score.get((key, engine), {}).get('status') == 'ok'
                                                 and 'body' in by_score[(key, engine)] for engine in ENGINES)}
    require(bool(quality_common), 'No common successful scored inputs')
    metric_rows = {}
    dimension_errors = []
    for key in sorted(common):
        entry = entries[key]
        truth_path = oracle_dir / (key + '.json')
        truth = read_json(truth_path)
        for engine in ENGINES:
            score = by_score.get((key, engine))
            if score:
                require(score['cache_identity']['oracle_sha256'] == sha256(truth_path), 'Reference changed after scoring')
        if 'error' in truth:
            dimension_errors.append(key)
            continue
        with zipfile.ZipFile(entry['path']) as package:
            xml_bytes = sum(item.file_size for item in package.infolist()
                            if item.filename.lower().endswith(('.xml', '.rels')))
        paragraphs = truth.get('paragraphs', [])
        metric_rows[key] = {'input_bytes': entry['bytes'], 'xml_bytes': xml_bytes,
                            'paragraphs': len(paragraphs),
                            'reference_characters': sum(len(p.get('text', '')) for p in paragraphs),
                            'table_cells': len(truth.get('features', {}).get('table_cells', [])),
                            'images': len(truth.get('features', {}).get('images', []))}
    summaries = {}
    quality = {}
    for engine in ENGINES:
        all_times = [row for row in timings if row['engine'] == engine]
        all_scores = [row for row in scores if row['engine'] == engine]
        common_times = [by_timing[(key, engine)] for key in common]
        common_scores = [by_score[(key, engine)] for key in quality_common]
        summaries[engine] = {'attempted': len(ids), 'timed_attempted': len(all_times),
                             'scored_attempted': len(all_scores),
                             'statuses': dict(collections.Counter(row['status'] for row in all_times)),
                             'accuracy_statuses': dict(collections.Counter(row['status'] for row in all_scores)),
                             'success': sum(row['status'] == 'ok' for row in all_times),
                             'median_ms': percentile(latency(common_times), .5),
                             'p95_ms': percentile(latency(common_times), .95),
                             'all_median_ms': percentile(latency(all_times), .5),
                             'all_p95_ms': percentile(latency(all_times), .95),
                             'body_f1': body_mean(common_scores), 'body_f1_all': body_mean(all_scores),
                             'body_all_scored': sum('body' in row for row in all_scores),
                             'features': features(common_scores), 'features_all': features(all_scores)}
        quality[engine] = {'body_f1': body_mean(common_scores), 'features': features(common_scores)}
    paired_ids = [key for key in ids if latency([by_timing.get((key, 'docx-core'), {})])
                  and latency([by_timing.get((key, 'docx-core-baseline'), {})])]
    baseline = None
    if paired_ids:
        before = [by_timing[(key, 'docx-core-baseline')]['medians']['total_ms'] for key in paired_ids]
        after = [by_timing[(key, 'docx-core')]['medians']['total_ms'] for key in paired_ids]
        baseline_rows = [row for row in timings if row['engine'] == 'docx-core-baseline']
        baseline = {'documents': len(paired_ids), 'attempted': len(baseline_rows),
                    'statuses': dict(collections.Counter(row['status'] for row in baseline_rows)),
                    'median_paired_speedup': statistics.median(a / b for a, b in zip(before, after)),
                    'faster_documents': sum(a > b for a, b in zip(before, after)),
                    'baseline_median_ms': percentile(before, .5), 'candidate_median_ms': percentile(after, .5),
                    'baseline_p95_ms': percentile(before, .95), 'candidate_p95_ms': percentile(after, .95)}
    labels = {'body_f1': LABELS['body_f1']}
    for key in sorted({name for value in summaries.values() for name in value['features_all']}):
        labels[key] = LABELS.get(key, key.replace('_', ' ').capitalize())
    source = {}
    if manifest.get('sampling_receipt'):
        sampling = read_json(Path(manifest['sampling_receipt']))
        source = {key: value for key, value in sampling.items()
                  if key not in ['attempts', 'attempted_rows', 'accepted', 'rejected', 'rows', 'documents', 'entries']
                  and isinstance(value, (str, int, float, bool, type(None)))}
    legacy = None
    if args.legacy.exists():
        previous = read_json(args.legacy)
        score = previous['quality_comparison']['docx-core']['features']['horizontal_merges']
        legacy = {'horizontal_recall': score['recall'], 'documents': previous['comparison']['docx_attempted'],
                  'common': previous['comparison']['fixed_common'],
                  'url': os.path.relpath(args.legacy.parent / ('saved-report.html' if (args.legacy.parent / 'saved-report.html').exists() else 'report.html'), args.out),
                  'matched': score['matched'], 'expected': score['expected']}
    old_update = None
    if legacy:
        old_update = legacy_update(args.out.parent / 'legacy' / 'accuracy-rows.json', previous,
                                   args.legacy_cohort, timing_env['binary_sha256'], timing_env['scorer_sha256'])
        if old_update:
            old_update['url'] = os.path.relpath(old_update.pop('receipt_path'), args.out)
    audits = []
    for audit_path, label, baseline_path in [
        (args.out / 'semantic-audit.json', 'Expanded sample', None),
        (args.out.parent / 'legacy' / 'semantic-audit.json', 'Original local corpus',
         args.out.parent / 'semantic-audit-baseline.json'),
    ]:
        audit = semantic_receipt(audit_path, timing_env['binary_sha256'], label, baseline_path)
        if audit:
            audit['receipt_url'] = os.path.relpath(audit.pop('receipt_path'), args.out)
            audits.append(audit)
    fidelity_changes = fidelity_findings(args.out.parent, args.out)
    backlog_path = args.out.parent / 'feature-backlog.json'
    backlog = read_json(backlog_path) if backlog_path.exists() else None
    data = {'generated_at': datetime.datetime.now(ZoneInfo('America/New_York')).isoformat(),
            'scope': {'attempted': len(ids), 'common_success': len(common), 'quality_common': len(quality_common),
                      'cohort_name': 'Independent seeded DOCX corpus sample', 'repeats': timing_env['repeats'],
                      'complete': complete, 'scatter_documents': len(metric_rows),
                      'dimension_errors': len(dimension_errors)},
            'engines': ENGINES, 'summaries': summaries, 'quality_comparison': quality,
            'quality_labels': labels, 'baseline': baseline,
            'charts': {'metric_definitions': CHART_METRICS,
                       'points': [{'ordinal': ordinal, 'metrics': metric_rows.get(key),
                                   'latency_ms': {engine: by_timing[(key, engine)]['medians']['total_ms'] for engine in ENGINES}}
                                  for ordinal, key in enumerate(sorted(common), 1)]},
            'provenance': {key: timing_env.get(key) for key in ['binary_sha256', 'baseline_binary_sha256',
                           'manifest_sha256', 'scorer_sha256', 'seed', 'versions']},
            'corpus': source, 'legacy': legacy, 'legacy_update': old_update, 'semantic_audits': audits,
            'fidelity_changes': fidelity_changes, 'validation_note': args.validation_note,
            'feature_backlog': backlog, 'receipt_links': {'backlog': os.path.relpath(backlog_path, args.out)} if backlog else {},
            'timing_scope': timing_env['scope'],
            'quality_scope': 'Unchanged extraction-reference scorer on inputs with successful timing and normalization in every parser. All-attempt accuracy retains parser failures as zero; invalid references are excluded and counted separately.'}
    write_json(args.out / 'report-data.json', data)
    template = Path(__file__).with_suffix('.html').read_text()
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
    (args.out / 'report.html').write_text(template.replace('REPORT_DATA', payload))
    print(json.dumps({'complete': complete, 'attempted': len(ids), 'common_success': len(common),
                      'quality_common': len(quality_common), 'report': str(args.out / 'report.html')}))


if __name__ == '__main__':
    main()
