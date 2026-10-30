import argparse
import collections
import datetime
import gzip
import hashlib
import json
import re
import statistics
from pathlib import Path


def quantile(values, fraction):
    values = sorted(values)
    position = (len(values) - 1) * fraction
    low = int(position)
    high = min(low + 1, len(values) - 1)
    return values[low] + (values[high] - values[low]) * (position - low)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, default=Path('output/parser-rewrite'))
    args = parser.parse_args()
    root = args.out
    read = lambda name: json.loads((root / name).read_text())
    parity = read('final-strict-parity.json')
    edge = read('xml-cases-final-strict-parity.json')
    manifest = json.loads(Path('output/parser-benchmark/manifest.json').read_text())['entries']
    assert len(parity['records']) == len(manifest) and all(row['equal'] for row in parity['records']), 'Full output parity is incomplete or differs'
    assert len(edge['records']) == 51 and all(row['equal'] for row in edge['records']), 'XML differential validation is incomplete or differs'
    baseline = json.loads(Path('output/parser-hillclimb/summary.json').read_text())
    assert parity['binary_sha256']['baseline'] == baseline['candidate_binary_sha256']
    binary_hash = hashlib.sha256((root / 'final-parser-benchmark').read_bytes()).hexdigest()
    assert parity['binary_sha256']['candidate'] == binary_hash
    rows = read('comparison-full/rows.json')
    assert len(rows) == len(manifest) * 4
    assert all(row['binary_sha256'] == binary_hash for row in rows)
    by_id = collections.defaultdict(dict)
    for row in rows:
        by_id[row['id']][row['engine']] = row
    engines = ['docx-core', 'docx-rs', 'office_oxide', 'undoc']
    split = read('split.json')
    docx_ids = {entry['id'] for entry in manifest if entry['format'] == 'docx'}
    common = {key for key in docx_ids if all(by_id[key][engine].get('status') == 'ok' for engine in engines)}
    cohorts = {'all': docx_ids, **{name: set(split[name]) for name in ['tuning', 'holdout', 'large_outliers']}}
    performance = {}
    for name, ids in cohorts.items():
        shared = sorted(ids & common)
        group = {'attempted': len(ids), 'common': len(shared), 'engines': {}}
        for engine in engines:
            selected = [by_id[key][engine] for key in shared]
            times = [row['medians']['total_ms'] for row in selected]
            group['engines'][engine] = {
                'median_ms': statistics.median(times), 'p95_ms': quantile(times, .95),
                'sum_medians_ms': sum(times),
                'cold_median_ms': statistics.median(sum(row['warm_ms']) for row in selected),
                'relative_mad': statistics.median(row['relative_mad'] for row in selected),
                'median_core_to_engine_ratio': statistics.median(by_id[key]['docx-core']['medians']['total_ms'] / by_id[key][engine]['medians']['total_ms'] for key in shared),
                'core_faster_documents': sum(by_id[key]['docx-core']['medians']['total_ms'] < by_id[key][engine]['medians']['total_ms'] for key in shared),
                'statuses': dict(collections.Counter(by_id[key][engine].get('status') for key in ids)),
            }
        performance[name] = group
    original_scores = json.loads(Path('output/parser-benchmark/scores.json').read_text())
    core_scores = json.loads(Path('output/parser-hillclimb/final-accuracy/scores.json').read_text())
    feature_scores = {}
    for engine in engines:
        scored = [row for row in (core_scores if engine == 'docx-core' else original_scores) if row['engine'] == engine and row['id'] in common]
        features = {}
        for row in scored:
            for feature, value in row.get('features', {}).items():
                counter = features.setdefault(feature, collections.Counter())
                for key in ['matched', 'expected', 'found']:
                    counter[key] += value[key]
        feature_scores[engine] = {'documents': len(scored), 'body_f1': statistics.mean(row['body']['f1'] for row in scored),
                                  'features': {key: {**value, 'recall': value['matched'] / value['expected'] if value['expected'] else None} for key, value in features.items()}}
    paired = read('final-tuning.json')
    paired_rows = paired['rows']
    holdout = read('final-holdout.json')
    wasm = read('wasm-comparison.json')
    size = {}
    for name, filename in [('baseline', 'baseline.wasm'), ('candidate', 'final.wasm')]:
        data = (root / filename).read_bytes()
        size[name] = {'raw': len(data), 'gzip': len(gzip.compress(data, mtime=0)), 'sha256': hashlib.sha256(data).hexdigest()}
    rust_log = (root / 'final-rust-tests.log').read_text()
    tests = {'rust_passed': sum(map(int, re.findall(r'test result: ok\. (\d+) passed', rust_log))),
             'javascript_passed': 762, 'javascript_skipped': 1, 'word_reference_passed': 46, 'browser_passed': 14}
    assert tests['rust_passed'] == 135 and 'test result: FAILED' not in rust_log
    assert '762 passed' in (root / 'final-unit-tests.log').read_text()
    assert 'pass 46' in (root / 'final-word-oracle-tests.log').read_text()
    assert '14 passed' in (root / 'final-visual-tests.log').read_text()
    summary = {
        'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'baseline_commit': read('baseline.json'), 'candidate_binary_sha256': binary_hash,
        'native_paired': {'documents': len(paired_rows), 'median_speedup': paired['median_paired_speedup'],
                         'baseline_median_ms': statistics.median(row['baseline']['medians']['total_ms'] for row in paired_rows),
                         'candidate_median_ms': statistics.median(row['candidate']['medians']['total_ms'] for row in paired_rows),
                         'faster_documents': sum(row['speedup'] > 1 for row in paired_rows),
                         'q10_speedup': quantile([row['speedup'] for row in paired_rows], .1),
                         'q90_speedup': quantile([row['speedup'] for row in paired_rows], .9)},
        'native_holdout': {'documents': len(holdout['rows']), 'median_speedup': holdout['median_paired_speedup'],
                           'faster_documents': sum(row['speedup'] > 1 for row in holdout['rows']),
                           'baseline_median_ms': statistics.median(row['baseline']['medians']['total_ms'] for row in holdout['rows']),
                           'candidate_median_ms': statistics.median(row['candidate']['medians']['total_ms'] for row in holdout['rows'])},
        'performance': performance, 'comparison_environment': read('comparison-full/environment.json'),
        'peak_one_minute_load': max(row['load_before'][0] for row in rows),
        'full_output_parity': {'scope': 'native complete model and structured blocks', 'matched': len(parity['records']), 'total': len(manifest), 'xml_edge_cases': len(edge['records']),
                               'normalization': parity['normalization'], 'includes_source_xml_and_payloads': True},
        'accuracy': baseline['accuracy'],
        'accuracy_provenance': 'Previous independently scored outputs; transferred only after exact complete model and block equivalence to the scored binary. No oracle or score rule changed.',
        'feature_comparison_common_docx': feature_scores,
        'competitor_accuracy_provenance': 'Original scored outputs of unchanged pinned competitor versions; performance was rerun separately.',
        'wasm_speed': wasm['summary'], 'wasm_size': size,
        'wasm_optimizer': read('wasm-optimizer-comparison.json')['median_paired_speedup'],
        'tests': tests, 'machine': baseline['machine'],
        'legacy_doc_statuses': {engine: dict(collections.Counter(row.get('status') for row in rows if row['format'] == 'doc' and row['engine'] == engine)) for engine in engines},
    }
    (root / 'summary.json').write_text(json.dumps(summary, indent=2))
    template = Path(__file__).with_name('rewrite_report.html').read_text()
    (root / 'report.html').write_text(template.replace('REPORT_DATA', json.dumps(summary).replace('</', '<\\/')))
    print(json.dumps({'native_speedup': summary['native_paired']['median_speedup'], 'wasm_speedup': summary['wasm_speed']['median_paired_speedup'], 'parity': summary['full_output_parity'], 'all_docx_speed': performance['all']}, indent=2))


if __name__ == '__main__':
    main()
