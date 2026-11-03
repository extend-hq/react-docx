"""Publish aggregate latency charts without document names or parsed content."""
import argparse
import csv
import json
import math
from pathlib import Path
import statistics

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
import numpy as np

ENGINES = ['docx-core', 'docx-rs', 'office_oxide', 'undoc']
LABELS = {'docx-core': 'extend-docx'}
COLORS = ['#087f8c', '#9270ca', '#db8624', '#d24b65']
FORMATS = ['docx', 'doc', 'dot', 'dotx', 'docm', 'dotm']


def published_data(directory):
    receipt = json.loads((directory / 'latency.json').read_text())
    groups = receipt['groups']
    for group in groups.values():
        for values in group['engines'].values():
            values['points'] = []
    with (directory / 'latency.csv').open(newline='') as stream:
        for row in csv.DictReader(stream):
            group = groups[row['format']]
            dimensions = {key: int(row[key]) for key in ['bytes', 'paragraphs', 'feature_occurrences']}
            if any(value < 0 for value in dimensions.values()):
                raise ValueError('Complexity measurements must be nonnegative')
            for engine, values in group['engines'].items():
                latency = float(row[engine + '_ms'])
                if not math.isfinite(latency) or latency <= 0:
                    raise ValueError('Latency measurements must be finite and positive')
                values['points'].append({**dimensions, 'latency_ms': latency})
    for group in groups.values():
        for values in group['engines'].values():
            times = [point['latency_ms'] for point in values['points']]
            if len(times) != group['common_inputs'] or not times:
                raise ValueError('Chart rows do not match the published cohort')
            for key, actual in [('median_ms', statistics.median(times)),
                                ('p95_ms', float(np.quantile(times, .95)))]:
                if not math.isclose(actual, values[key], rel_tol=1e-12):
                    raise ValueError('Chart rows do not match the published summary')
    return receipt


def scatter(ax, group, field, label):
    for engine, values in group['engines'].items():
        points = values['points']
        divisor = 1024 if field == 'bytes' else 1
        ax.scatter([point[field] / divisor for point in points],
                   [point['latency_ms'] for point in points],
                   color=COLORS[ENGINES.index(engine)], s=15, alpha=.5, edgecolors='none')
    ax.set_xscale('symlog', linthresh=1 / 1024 if field == 'bytes' else 1)
    ax.set_yscale('log')
    ax.set_xlabel(label)
    ax.set_ylabel('Per-document median · ms (log scale)')
    ax.grid(alpha=.18)
    ax.set_axisbelow(True)


def legend(fig, engines):
    handles = [Line2D([], [], marker='o', linestyle='', markersize=7,
                      color=COLORS[ENGINES.index(engine)], label=LABELS.get(engine, engine)) for engine in engines]
    fig.legend(handles=handles, loc='outside lower center', ncol=len(handles), frameon=False)


def docx_highlights(group, args):
    title = f'DOCX · {group["common_inputs"]:,} common successful inputs · measured {args.measured_date}'
    fig, axes = plt.subplots(1, 2, figsize=(13, 4.5), layout='constrained')
    for ax, metric, label in zip(axes, ['median_ms', 'p95_ms'], ['Median', 'p95 across documents']):
        values = [group['engines'][engine][metric] for engine in ENGINES]
        ax.barh([LABELS.get(engine, engine) for engine in ENGINES], values, color=COLORS, height=.58)
        ax.invert_yaxis()
        ax.set_xlim(0, max(values) * 1.24)
        for index, value in enumerate(values):
            ax.text(value + max(values) * .025, index, f'{value:.3f} ms', va='center', fontsize=11)
        ax.set_title(label, loc='left', pad=12)
        ax.set_xlabel('Milliseconds · lower is faster')
        ax.grid(axis='x', alpha=.18)
        ax.set_axisbelow(True)
    fig.suptitle(title + '\nWarm native parse + model/IR; extend-docx includes structured blocks', fontsize=16)
    fig.savefig(args.images_output / f'{args.asset_prefix}-latency-docx-summary.png', dpi=160)
    plt.close(fig)
    fig, axes = plt.subplots(1, 3, figsize=(15, 5.5), layout='constrained')
    for ax, field, label, heading in zip(
            axes, ['bytes', 'paragraphs', 'feature_occurrences'],
            ['Input size · KiB (log scale)', 'Source paragraphs (log scale above 1)',
             'Source feature occurrences (log scale above 1)'],
            ['By input size', 'By paragraph count', 'By feature count']):
        scatter(ax, group, field, label)
        ax.set_title(heading, loc='left', pad=12)
    legend(fig, ENGINES)
    fig.suptitle(title + '\nOne point per document and parser · zero complexity counts retained', fontsize=16)
    fig.savefig(args.images_output / f'{args.asset_prefix}-latency-docx-scatter.png', dpi=160)
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', type=Path, help='Regenerate charts from published latency.json and latency.csv')
    parser.add_argument('--runs', nargs='+', type=Path)
    parser.add_argument('--docx-run', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--images-output', type=Path, default=Path(__file__).resolve().parents[2] / 'docs/readme-assets')
    parser.add_argument('--label', default='release 0.13.0')
    parser.add_argument('--asset-prefix', default='docx-core-0.13.0')
    parser.add_argument('--measured-date', default='2026-11-02')
    parser.add_argument('--measured-commit', default='9ae335abdc79f7defe5a2843065a3ff13c6e5cea')
    args = parser.parse_args()
    if args.data:
        if args.runs or args.docx_run or args.output:
            parser.error('--data cannot be combined with --runs, --docx-run, or --output')
        receipt = published_data(args.data)
        args.label = receipt.get('label') or f"release {receipt['release']}"
        args.measured_date = receipt['measured_date']
        args.measured_commit = receipt['measured_commit']
        render(receipt['groups'], args)
        return
    if not args.runs or not args.docx_run or not args.output:
        parser.error('Provide --data, or --runs with --docx-run and --output')
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
    receipt = {'label': args.label, 'measured_date': args.measured_date,
               'measured_commit': args.measured_commit,
               'binary_sha256': sorted({json.loads((run / 'format-environment.json').read_text())['binary_sha256']
                                        for run in [*args.runs, args.docx_run]}),
               'versions': {'docx-rs': '0.4.22', 'office_oxide': '0.1.15', 'undoc': '0.27.1'},
               'scope': 'Warm native parse + model/IR; extend-docx also projects structured blocks. Common successful inputs per format. Five samples, 1–20 parses/sample. Per-document medians; p95 across documents. Excludes I/O, startup, JSON encoding, destruction, reference conversion. Shared development machine.',
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
    render(groups, args)
    print({fmt: {e: {k: v for k, v in stats.items() if k != 'points'} for e, stats in g['engines'].items()} for fmt, g in groups.items()})


def render(groups, args):
    args.images_output.mkdir(parents=True, exist_ok=True)
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10,
                         'axes.spines.top': False, 'axes.spines.right': False,
                         'axes.titleweight': 'bold', 'figure.facecolor': 'white',
                         'axes.facecolor': '#f8fafc', 'axes.edgecolor': '#cbd5e1',
                         'text.color': '#172b4d', 'axes.labelcolor': '#334155',
                         'xtick.color': '#475569', 'ytick.color': '#475569'})
    docx_highlights(groups['docx'], args)
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
        ax.set_yticks(range(4), [LABELS.get(engine, engine) for engine in ENGINES])
        ax.invert_yaxis()
        ax.set_xlim(0, ax.get_xlim()[1] * 1.23)
        ax.set_title(f"{fmt.upper()} · {group['common_inputs']} common inputs")
        ax.set_xlabel('Milliseconds · lower is faster')
        ax.grid(axis='x', alpha=.15)
        ax.set_axisbelow(True)
    fig.suptitle(f'Native parser latency · {args.label}\nSolid: median    Light: p95 across documents', fontsize=18)
    fig.savefig(args.images_output / f'{args.asset_prefix}-latency-overview.png', dpi=145)
    plt.close(fig)
    for fmt, group in groups.items():
        fig, axes = plt.subplots(2, 2, figsize=(13, 9), layout='constrained')
        for e, values in group['engines'].items():
            color = COLORS[ENGINES.index(e)]
            points = values['points']
            times = sorted(p['latency_ms'] for p in points)
            axes[0, 0].step(times, np.arange(1, len(times) + 1) / len(times) * 100,
                            where='post', color=color, label=LABELS.get(e, e), linewidth=2)
            for ax, field, label in [(axes[0, 1], 'bytes', 'Input bytes'),
                                     (axes[1, 0], 'paragraphs', 'Source paragraph count'),
                                     (axes[1, 1], 'feature_occurrences', 'Source feature occurrences')]:
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
        fig.suptitle(f'{title} · {group["common_inputs"]} common successful inputs\nNative parser latency · {args.label}', fontsize=17)
        fig.savefig(args.images_output / f'{args.asset_prefix}-latency-{fmt}.png', dpi=145)
        plt.close(fig)


if __name__ == '__main__':
    main()
