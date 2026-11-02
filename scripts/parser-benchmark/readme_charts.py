"""Publish aggregate latency charts without document names or parsed content."""
import argparse
import csv
import json
from pathlib import Path
import statistics

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

ENGINES = ['docx-core', 'docx-rs', 'office_oxide', 'undoc']
COLORS = ['#087f8c', '#9270ca', '#db8624', '#d24b65']
FORMATS = ['docx', 'doc', 'dot', 'dotx', 'docm', 'dotm']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--runs', nargs='+', type=Path, required=True)
    parser.add_argument('--docx-run', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--images-output', type=Path, default=Path(__file__).resolve().parents[2] / 'docs/readme-assets')
    args = parser.parse_args()
    pooled = [r for run in args.runs for r in json.loads((run / 'format-scores.json').read_text())]
    docx = json.loads((args.docx_run / 'format-scores.json').read_text())
    groups = {}
    for fmt in [*FORMATS, 'docx-regressions']:
        rows = docx if fmt == 'docx' else pooled
        extension = 'docx' if fmt == 'docx-regressions' else fmt
        selected = {(r['engine'], r['id']): r for r in rows
                    if r['extension'] == extension and r.get('scope_eligible', True)}
        engines = [e for e in ENGINES if not (fmt in ('doc', 'dot') and e == 'docx-rs')]
        common = set.intersection(*[{key for (engine, key), r in selected.items()
                                    if engine == e and r['status'] == 'ok'
                                    and r.get('median_total_ms') is not None} for e in engines])
        core = {key: selected['docx-core', key] for key in common}
        groups[fmt] = {
            'common_inputs': len(common),
            'attempted_inputs': len({key for _, key in selected}),
            'engines': {e: {
                'median_ms': statistics.median([selected[e, k]['median_total_ms'] for k in sorted(common)]),
                'p95_ms': float(np.quantile([selected[e, k]['median_total_ms'] for k in sorted(common)], .95)),
                'points': [{'latency_ms': selected[e, k]['median_total_ms'],
                            'bytes': core[k]['bytes'], 'paragraphs': core[k]['paragraphs'],
                            'feature_occurrences': core[k]['feature_occurrences']} for k in sorted(common)]
            } for e in engines},
        }
    args.output.mkdir(parents=True, exist_ok=True)
    args.images_output.mkdir(parents=True, exist_ok=True)
    receipt = {'release': '0.13.0', 'measured_date': '2026-11-02',
               'measured_commit': '9ae335abdc79f7defe5a2843065a3ff13c6e5cea',
               'versions': {'docx-rs': '0.4.22', 'office_oxide': '0.1.15', 'undoc': '0.27.1'},
               'scope': 'Warm native parse + model/IR; core also projects structured blocks. Common successful inputs per format. Five samples, 1–20 parses/sample. Per-document medians; p95 across documents. Excludes I/O, startup, JSON encoding, destruction, reference conversion. Shared development machine.',
               'groups': groups}
    summary = {**receipt, 'groups': {fmt: {**group, 'engines': {
        e: {k: v for k, v in data.items() if k != 'points'}
        for e, data in group['engines'].items()}} for fmt, group in groups.items()}}
    (args.output / 'latency.json').write_text(json.dumps(summary, indent=2) + '\n')
    with (args.output / 'latency.csv').open('w', newline='') as stream:
        writer = csv.writer(stream, lineterminator='\n')
        writer.writerow(['format', 'bytes', 'paragraphs', 'feature_occurrences', *[e + '_ms' for e in ENGINES]])
        for fmt, group in groups.items():
            for i, point in enumerate(group['engines']['docx-core']['points']):
                writer.writerow([fmt, point['bytes'], point['paragraphs'], point['feature_occurrences'],
                    *[group['engines'][e]['points'][i]['latency_ms'] if e in group['engines'] else '' for e in ENGINES]])
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10,
                         'axes.spines.top': False, 'axes.spines.right': False,
                         'axes.titleweight': 'bold', 'figure.facecolor': 'white'})
    fig, axes = plt.subplots(3, 2, figsize=(13, 12), layout='constrained')
    for ax, fmt in zip(axes.flat, FORMATS):
        group = groups[fmt]
        for i, e in enumerate(ENGINES):
            if e not in group['engines']:
                ax.text(.01, i, 'Unsupported', va='center', color='#666')
                continue
            value = group['engines'][e]
            ax.barh(i - .15, value['median_ms'], height=.28, color=COLORS[i])
            ax.barh(i + .15, value['p95_ms'], height=.28, color=COLORS[i], alpha=.32)
            ax.text(value['p95_ms'], i + .15, f"  {value['p95_ms']:.3f}", va='center', fontsize=9)
            ax.text(value['median_ms'], i - .15, f"  {value['median_ms']:.3f}", va='center', fontsize=9)
        ax.set_yticks(range(4), ENGINES)
        ax.invert_yaxis()
        ax.set_xlim(0, ax.get_xlim()[1] * 1.23)
        ax.set_title(f"{fmt.upper()} · {group['common_inputs']} common inputs")
        ax.set_xlabel('Milliseconds · lower is faster')
        ax.grid(axis='x', alpha=.15)
        ax.set_axisbelow(True)
    fig.suptitle('Native parser latency · release 0.13.0\nSolid: median    Light: p95 across documents', fontsize=18)
    fig.savefig(args.images_output / 'docx-core-0.13.0-latency-overview.png', dpi=145)
    plt.close(fig)
    for fmt, group in groups.items():
        fig, axes = plt.subplots(2, 2, figsize=(13, 9), layout='constrained')
        for e, values in group['engines'].items():
            color = COLORS[ENGINES.index(e)]
            points = values['points']
            times = sorted(p['latency_ms'] for p in points)
            axes[0, 0].step(times, np.arange(1, len(times) + 1) / len(times) * 100,
                            where='post', color=color, label=e, linewidth=2)
            for ax, field, label in [(axes[0, 1], 'bytes', 'Input bytes'),
                                     (axes[1, 0], 'paragraphs', 'Parsed paragraph count (core)'),
                                     (axes[1, 1], 'feature_occurrences', 'Feature occurrences (core)')]:
                ax.scatter([p[field] for p in points], [p['latency_ms'] for p in points],
                           color=color, s=14, alpha=.5, edgecolors='none')
                ax.set_xscale('symlog', linthresh=1)
                ax.set_yscale('log')
                ax.set_xlabel(label + ' · log scale above 1')
                ax.set_ylabel('Per-document median latency (ms, log scale)')
                ax.grid(alpha=.16)
        axes[0, 0].set_xscale('log')
        axes[0, 0].set_xlabel('Per-document median latency (ms, log scale)')
        axes[0, 0].set_ylabel('Documents at or below this latency (%)')
        axes[0, 0].set_ylim(0, 102)
        axes[0, 0].grid(alpha=.16)
        axes[0, 0].legend(loc='lower right')
        title = 'DOCX · additional regression cohort' if fmt == 'docx-regressions' else fmt.upper()
        fig.suptitle(f'{title} · {group["common_inputs"]} common successful inputs\nNative parser latency · release 0.13.0', fontsize=17)
        fig.savefig(args.images_output / f'docx-core-0.13.0-latency-{fmt}.png', dpi=145)
        plt.close(fig)
    print({fmt: {e: {k: v for k, v in stats.items() if k != 'points'} for e, stats in g['engines'].items()} for fmt, g in groups.items()})


if __name__ == '__main__':
    main()
