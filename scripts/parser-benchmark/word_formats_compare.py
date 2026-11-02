import argparse
import json
from pathlib import Path

from assess import percentile
from run import ENGINES
from word_formats import MIMES, save, sha


def compare(baseline, out):
    before = json.loads((baseline / 'format-scores.json').read_text())
    after = json.loads((out / 'format-scores.json').read_text())
    if sha(baseline / 'format-manifest.json') != sha(out / 'format-manifest.json'):
        raise ValueError('Comparison requires the identical input manifest')
    old = {(row['engine'], row['id']): row for row in before}
    regressions, failures = [], []
    for row in after:
        previous = old[(row['engine'], row['id'])]
        if row['engine'] != 'docx-core':
            continue
        if previous['status'] == 'ok' and row['status'] != 'ok':
            failures.append({'id': row['id'], 'extension': row['extension']})
        if 'body' in previous and 'body' in row and previous['body']['f1'] > row['body']['f1'] + 1e-9:
            regressions.append({'id': row['id'], 'extension': row['extension'],
                                'before': previous['body']['f1'], 'after': row['body']['f1']})
        for name, value in previous.get('features', {}).items():
            if value['expected'] != row.get('features', {}).get(name, {}).get('expected'):
                raise ValueError('Feature reference denominator changed')
    latency = {}
    for scope in ('all', 'supported'):
        latency[scope] = {}
        for extension in MIMES:
            engines = [e for e in ENGINES if not (extension in ('doc', 'dot') and e == 'docx-rs')]
            cohorts = [[r for r in rows if r['extension'] == extension
                        and (scope == 'all' or r.get('scope_eligible', True))] for rows in (before, after)]
            common = set.intersection(*[{r['id'] for r in rows if r['engine'] == engine and r['status'] == 'ok'}
                                        for rows in cohorts for engine in engines])
            timing = {'n': len(common)}
            for label, rows in zip(('before', 'after'), cohorts):
                samples = [r['median_total_ms'] for r in rows if r['engine'] == 'docx-core' and r['id'] in common]
                timing[label + '_median_ms'] = percentile(samples, .5)
                timing[label + '_p95_ms'] = percentile(samples, .95)
            latency[scope][extension] = timing
    save(out / 'comparison.json', {
        'baseline_binary_sha256': json.loads((baseline / 'format-environment.json').read_text())['binary_sha256'],
        'baseline_scores_sha256': sha(baseline / 'format-scores.json'),
        'candidate_scores_sha256': sha(out / 'format-scores.json'),
        'summary': json.loads((baseline / 'format-summary.json').read_text()),
        'supported_summary': json.loads((baseline / 'format-supported-summary.json').read_text()),
        'latency': latency, 'body_regressions': regressions, 'new_failures': failures,
    })


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    compare(args.baseline.resolve(), args.out.resolve())
