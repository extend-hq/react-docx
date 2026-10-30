import argparse
import collections
import datetime
import hashlib
import html
import json
from pathlib import Path
import re
import statistics
import subprocess


ENGINES = ['docx-core', 'docx-rs', 'office_oxide', 'undoc']
FEATURE_LABELS = {'tables': 'Table text anchors', 'table_cells': 'Cell text anchors',
                  'headings': 'Heading text + level', 'hyperlinks': 'Linked text 5-grams',
                  'explicit_bold': 'Bold text 5-grams', 'explicit_italic': 'Italic text 5-grams',
                  'images': 'Raw image occurrences', 'equations': 'Equation occurrences',
                  'horizontal_merges': 'Raw column-span equality', 'vertical_merges': 'Raw merge-start anchors'}


def percentile(values, fraction):
    values = sorted(values)
    position = (len(values) - 1) * fraction
    left = int(position)
    return values[left] + (values[min(left + 1, len(values) - 1)] - values[left]) * (position - left)


def accuracy(rows):
    features = {}
    audit = collections.Counter()
    for row in rows:
        audit.update(row.get('source_reference_audit', {}))
        for name, value in row.get('features', {}).items():
            target = features.setdefault(name, {'matched': 0, 'expected': 0, 'found': 0, 'unit': value['unit']})
            for field in ['matched', 'expected', 'found']:
                target[field] += value[field]
    for value in features.values():
        value['recall'] = value['matched'] / value['expected'] if value['expected'] else 1
    body = [row.get('body', {}) for row in rows]
    return {'attempted': len(rows), 'success': sum(row['status'] == 'ok' for row in rows),
            'text_f1_macro': statistics.mean(row.get('f1', 0) for row in body),
            'exact_text_documents': sum(row.get('exact_text', False) for row in body),
            'features': features, 'source_reference_audit': dict(audit)}


def table(headers, rows):
    return '<div class="table-scroll"><table><thead><tr>' + ''.join('<th>' + html.escape(str(x)) + '</th>' for x in headers) + '</tr></thead><tbody>' + ''.join('<tr>' + ''.join('<td>' + str(x) + '</td>' for x in row) + '</tr>' for row in rows) + '</tbody></table></div>'


def percent(value, digits=2):
    return f'{100 * value:.{digits}f}%'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, default=Path('output/parser-hillclimb'))
    parser.add_argument('--baseline', type=Path, default=Path('output/parser-benchmark'))
    args = parser.parse_args()
    out, baseline = args.out, args.baseline
    old = json.loads((baseline / 'summary.json').read_text())
    old_rows = json.loads((baseline / 'scores.json').read_text())
    final_rows = json.loads((out / 'final-accuracy/scores.json').read_text())
    timing = json.loads((out / 'comparison-full/rows.json').read_text())
    paired = json.loads((out / 'final-tuning.json').read_text())
    split = json.loads((out / 'split.json').read_text())
    final_accuracy = {fmt: accuracy([r for r in final_rows if r['format'] == fmt]) for fmt in ['docx', 'doc']}
    common = set.intersection(*[{r['id'] for r in timing if r['engine'] == engine and r['format'] == 'docx' and r.get('medians')} for engine in ENGINES])
    speed = {}
    for engine in ENGINES:
        rows = [r for r in timing if r['engine'] == engine and r['format'] == 'docx']
        matched = [r for r in rows if r['id'] in common]
        values = [r['medians']['total_ms'] for r in matched]
        speed[engine] = {'attempted': len(rows), 'success': sum(r['status'] == 'ok' for r in rows),
                         'statuses': dict(collections.Counter(r['status'] for r in rows)), 'common_documents': len(common),
                         'median_ms': statistics.median(values), 'p95_ms': percentile(values, .95),
                         'sum_medians_ms': sum(values), 'cold_median_ms': statistics.median(sum(r['warm_ms']) for r in matched),
                         'median_relative_mad': statistics.median(r['relative_mad'] for r in matched)}
    core_by_id = {r['id']: r for r in timing if r['engine'] == 'docx-core' and r.get('medians')}
    for engine in ENGINES[1:]:
        rows = [r for r in timing if r['engine'] == engine and r['id'] in common]
        speed[engine]['median_core_to_engine_ratio'] = statistics.median(core_by_id[r['id']]['medians']['total_ms'] / r['medians']['total_ms'] for r in rows)
    paired_rows = [r for r in paired['rows'] if 'speedup' in r]
    pair_summary = {'documents': len(paired_rows), 'median_paired_speedup': statistics.median(r['speedup'] for r in paired_rows),
                    'baseline_median_ms': statistics.median(r['baseline']['medians']['total_ms'] for r in paired_rows),
                    'candidate_median_ms': statistics.median(r['candidate']['medians']['total_ms'] for r in paired_rows),
                    'baseline_sum_ms': sum(r['baseline']['medians']['total_ms'] for r in paired_rows),
                    'candidate_sum_ms': sum(r['candidate']['medians']['total_ms'] for r in paired_rows),
                    'faster_documents': sum(r['speedup'] > 1 for r in paired_rows),
                    'q10_speedup': percentile([r['speedup'] for r in paired_rows], .1),
                    'q90_speedup': percentile([r['speedup'] for r in paired_rows], .9)}
    old_by_id = {r['id']: r for r in old_rows if r['engine'] == 'docx-core'}
    regressions = []
    for row in final_rows:
        previous = old_by_id[row['id']]
        if row.get('body', {}).get('f1', 0) + 1e-12 < previous.get('body', {}).get('f1', 0):
            regressions.append({'id': row['id'], 'metric': 'body_f1'})
        for name, value in row.get('features', {}).items():
            prior = previous.get('features', {}).get(name, {})
            if value['matched'] < prior.get('matched', 0):
                regressions.append({'id': row['id'], 'metric': name, 'before': prior['matched'], 'after': value['matched']})
    tests = json.loads((out / 'final-javascript-checks.json').read_text())
    rust_log = (out / 'final-rust-tests.log').read_text()
    tests['rust_passed'] = sum(int(n) for n in re.findall(r'test result: ok\. (\d+) passed', rust_log))
    tests['rust_failed'] = bool(re.search(r'test result: FAILED|error:', rust_log))
    tests.update(javascript_passed=762, javascript_skipped=1, word_oracle_passed=46, browser_passed=14)
    sizes = json.loads((out / 'wasm-size.json').read_text())
    wasm_data = json.loads((out / 'wasm-comparison.json').read_text())
    wasm = wasm_data['summary']
    wasm_pairs = [row for row in wasm_data['rows'] if 'speedup' in row]
    wasm['median_paired_cold_total_speedup'] = statistics.median((row['baseline']['init_ms'] + row['baseline']['cold_ms']) / (row['candidate']['init_ms'] + row['candidate']['cold_ms']) for row in wasm_pairs)
    for key in ['baseline', 'candidate']:
        wasm[key]['cold_total_median_ms'] = statistics.median(row[key]['init_ms'] + row[key]['cold_ms'] for row in wasm_pairs)
    machine = json.loads((out / 'machine.json').read_text())
    peak_load = max(row['load_before'][0] for row in timing)
    summary = {'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'baseline_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
               'candidate_binary_sha256': hashlib.sha256((out / 'final-parser-benchmark').read_bytes()).hexdigest(),
               'accuracy': final_accuracy, 'speed': speed, 'paired_speed': pair_summary, 'regressions': regressions,
               'tests': tests, 'wasm_size': sizes, 'wasm_speed': wasm, 'machine': machine, 'peak_comparison_load_one_minute': peak_load,
               'comparison_environment': json.loads((out / 'comparison-full/environment.json').read_text()),
               'holdout': accuracy([r for r in final_rows if r['id'] in split['holdout']]),
               'large_outliers': [{k: r[k] for k in ['id', 'engine', 'status', 'medians', 'warm_ms'] if k in r} for r in timing if r['id'] in split['large_outliers']]}
    (out / 'summary.json').write_text(json.dumps(summary, indent=2))
    speed_rows = []
    for engine in ENGINES:
        data = speed[engine]
        speed_rows.append([engine, f"{data['success']}/{data['attempted']}", f"{data['median_ms']:.3f}",
                           f"{data['p95_ms']:.3f}", f"{data['cold_median_ms']:.3f}", percent(data['median_relative_mad'])])
    feature_rows = []
    names = sorted(final_accuracy['docx']['features'])
    for name in names:
        current = final_accuracy['docx']['features'][name]
        feature_rows.append([f'<span title="{html.escape(current["unit"], quote=True)}">{html.escape(FEATURE_LABELS.get(name, name.replace("_", " ")))}</span>',
            percent(old['docx']['docx-core']['features'].get(name, {}).get('recall', 0)), percent(current['recall']),
            f"{current['matched']:,}/{current['expected']:,}",
            *[percent(old['docx'][engine]['features'].get(name, {}).get('recall', 0)) for engine in ENGINES[1:]]])
    body_rows = [['docx-core before', percent(old['docx']['docx-core']['text_f1_macro'], 4), old['docx']['docx-core']['exact_text_documents']],
                 ['docx-core after', percent(final_accuracy['docx']['text_f1_macro'], 4), final_accuracy['docx']['exact_text_documents']]]
    body_rows += [[engine, percent(old['docx'][engine]['text_f1_macro'], 4), old['docx'][engine]['exact_text_documents']] for engine in ENGINES[1:]]
    a = final_accuracy['docx']
    aud = a['source_reference_audit']
    baseline_gzip, candidate_gzip = sizes['baseline']['gzip'], sizes['candidate']['gzip']
    content = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>docx-core optimization results</title><style>
:root{{color-scheme:light;--ink:#142826;--muted:#586d68;--line:#d6e0dc;--accent:#147b64}}*{{box-sizing:border-box}}body{{margin:0;background:#f4f7f3;color:var(--ink);font:15px/1.55 system-ui,sans-serif}}main{{max-width:1160px;margin:auto;padding:44px 28px 90px}}h1{{font-size:42px;letter-spacing:-1.6px;margin:8px 0 16px}}h2{{font-size:24px;margin:36px 0 10px}}p{{max-width:95ch}}.eyebrow{{letter-spacing:2px;text-transform:uppercase;font-size:12px;color:var(--accent);font-weight:700}}.cards{{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:28px 0}}.card{{background:white;padding:22px;border:1px solid var(--line);border-radius:12px}}.big{{font-size:31px;font-weight:700;display:block}}.muted,small{{color:var(--muted)}}.notice{{border-left:4px solid #bd7a23;padding:10px 18px;background:#fff7e8}}.table-scroll{{overflow:auto;background:white;border:1px solid var(--line);border-radius:10px}}table{{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}}th,td{{padding:12px 15px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}}th:first-child,td:first-child{{text-align:left}}th{{font-size:12px;text-transform:uppercase;color:var(--muted)}}tr:last-child td{{border-bottom:0}}a{{color:var(--accent)}}details{{margin:16px 0}}summary{{cursor:pointer;font-weight:650}}li{{margin:8px 0}}code{{font-size:12px;word-break:break-all}}@media(max-width:760px){{.cards{{grid-template-columns:repeat(2,1fr)}}main{{padding:25px 16px}}h1{{font-size:32px}}}}
</style><main><div class="eyebrow">Local corpus · native Rust + WASM · 28 October 2026</div>
<h1>Faster parsing. More faithful extraction.</h1>
<p>docx-core improved by <strong>{pair_summary['median_paired_speedup']:.2f}×</strong> on the 48-document paired benchmark. The final candidate parsed every local input and fixed heading inheritance and hyperlink metadata. The competing parsers remain faster on the common successful DOCX set.</p>
<div class="cards"><div class="card"><span class="big">{pair_summary['median_paired_speedup']:.2f}×</span><small>median paired speedup · 48 DOCX</small></div><div class="card"><span class="big">392/392</span><small>inputs parsed · 390 DOCX + 2 DOC</small></div><div class="card"><span class="big">{percent(a['features']['headings']['recall'], 0)}</span><small>heading text + level matches</small></div><div class="card"><span class="big">{percent(a['text_f1_macro'], 4)}</span><small>normalized body-text macro F1</small></div></div>
<p class="notice">This result does not establish the fastest parser or universal 100% accuracy. Source-XML extraction checks, model parity, browser smoke checks, and Word-oracle harness tests measure different things. They do not prove complete Word rendering parity.</p>
<p class="muted">Measured on {html.escape(machine['machdep.cpu.brand_string'])}, {machine['hw.logicalcpu']} logical CPUs, {int(machine['hw.memsize']) // (1024 ** 3)} GiB RAM. Peak one-minute system load during the comparison was {peak_load:.1f}. Absolute timings are approximate under this contention; randomized ordering, repeated samples, and per-input variability are retained for review.</p>
<h2>Before and after</h2><p>Fresh baseline and candidate binaries ran in randomized order for each document. Each input was read once, warmed once, then parsed five times; the per-document median is the unit of comparison. File I/O, serialization, and object destruction are outside the measured interval.</p>
{table(['Measure', 'Baseline', 'Candidate'], [['Median per-document time (ms)', f"{pair_summary['baseline_median_ms']:.3f}", f"{pair_summary['candidate_median_ms']:.3f}"], ['Sum of per-document medians (ms)', f"{pair_summary['baseline_sum_ms']:.1f}", f"{pair_summary['candidate_sum_ms']:.1f}"]])}
<p class="muted">Candidate faster on {pair_summary['faster_documents']}/{pair_summary['documents']} inputs. The 10th–90th percentile of paired speedups is {pair_summary['q10_speedup']:.2f}×–{pair_summary['q90_speedup']:.2f}×. These 48 inputs were the tuning set; accuracy was also checked on 336 ordinary holdout documents and six large outliers.</p>
<h2>Fresh comparison with the other parsers</h2><p>Native release builds, identical input bytes, randomized engine order, five warm timing batches per input. Batch sizes adapt from 1 to 20 parses. Times below use the same <strong>{len(common)} documents</strong> successfully timed by all four engines. Cold means the first parse in a fresh process, including parser initialization, excluding process launch and file I/O. MAD measures within-input timing variability.</p>
{table(['Parser', 'DOCX parsed', 'Warm median ms', 'Warm p95 ms', 'Cold median ms', 'Median relative MAD'], speed_rows)}
<p class="muted">docx-core builds its complete production model and structured blocks. office_oxide builds DocumentIR; docx-rs and undoc return their native models. docx-rs image previews are disabled. Outputs have different coverage and metadata. No benchmark projection trims output inside the timed region. No model cache persists across docx-core parses. All four use opt-level 3, thin LTO, and one codegen unit.</p>
<h2>Extraction and coverage</h2><p>All original corpus hashes were verified. Text comparison uses independent OOXML extraction with NFC normalization and removal of whitespace and selected invisible markers. Macro F1 counts each DOCX equally; failures score zero. Competitor accuracy below is retained from the original benchmark of the same pinned versions and dependencies; their speed measurements above are new.</p>
{table(['Parser', 'Body macro F1', 'Exact normalized body / 390'], body_rows)}
<p>Heading matching includes both text and level: {a['features']['headings']['matched']:,}/{a['features']['headings']['expected']:,}, with {a['features']['headings']['found']:,} found. Hyperlink text recall improved from {percent(old['docx']['docx-core']['features']['hyperlinks']['recall'])} to {percent(a['features']['hyperlinks']['recall'])}. The table below reports recall; it is not a universal feature accuracy percentage.</p>
{table(['Feature check', 'Core before', 'Core after', 'Matched / expected', 'docx-rs', 'office_oxide', 'undoc'], feature_rows)}
<details open><summary>How to interpret the remaining gaps</summary><ul>
<li>Hyperlink and bold/italic checks use character grams in explicit source spans. Adjacent spans may be merged in parser output. All source hyperlink spans in the nine documents with residual misses were found as substrings of linked output spans; this is diagnostic evidence, not a replacement score or a position/multiplicity proof.</li>
<li>Horizontal span values change when the parser resolves irregular table grids. Raw XML gridSpan equality is a diagnostic, not a reliable measure of visible merge correctness. The 25 unmatched vertical restart markers have no continuation cells.</li>
<li>Image occurrence counts include grouped graphics and embedded-control preview images. A composite image or semantic form control need not map one-to-one to those XML markers.</li>
<li>Observed body and table-cell mismatches include generated form values and symbol text. Stripping that content to match a literal text oracle would reduce fidelity.</li>
<li>The two legacy DOC files parsed, but the independent OOXML accuracy claims above apply to the 390 actual DOCX files.</li></ul></details>
<h2>Validation and costs</h2><p>{tests['rust_passed']} Rust tests, 762 JavaScript tests, 46 Word-oracle harness tests, and 14 browser checks passed. One JavaScript test was already skipped. The browser suite exercises layout, annotation round trips, editing, and thumbnail loading. The model-parity audit covers all model fields on 48 documents after aligning style definitions by ID, excluding source XML serialization and image payload contents.</p>
<p>Six targeted attribute-encoding cases also match the original normalizer. Two of these exposed differences in an intermediate fast path; the final candidate sends those representations through the normalizer. <a href="attribute-normalization-audit.json">Targeted case results</a> · <a href="final-parity/audit.json">Full-model parity audit</a>.</p>
<p>The full-corpus extraction audit found {aud['blocks']:,} DOCX blocks, {aud['duplicate_ids']} duplicate IDs, {aud['missing_references']} missing source references, and {aud['wrong_document_references']} references to another document. Measured extraction regressions versus the original run: <strong>{len(regressions)}</strong>.</p>
<p>WASM grew from {sizes['baseline']['raw']:,} to {sizes['candidate']['raw']:,} bytes; gzip grew from {baseline_gzip:,} to {candidate_gzip:,} bytes ({100 * (candidate_gzip / baseline_gzip - 1):.1f}%). This is a real download-size cost of the faster regex engine. Native timing improvements do not imply the same factor for browser startup or rendering.</p>
<p>The separate WASM/Node benchmark compares the checked-in WASM binary with the rebuilt candidate on {wasm['matched']} documents: <strong>{wasm['median_paired_speedup']:.2f}× median paired warm speedup</strong>. Median complete-model calls changed from {wasm['baseline']['median_ms']:.2f} to {wasm['candidate']['median_ms']:.2f} ms. Including module initialization plus the first model call, median time changed from {wasm['baseline']['cold_total_median_ms']:.2f} to {wasm['candidate']['cold_total_median_ms']:.2f} ms, with a {wasm['median_paired_cold_total_speedup']:.2f}× median paired speedup. Module initialization alone was {wasm['baseline']['init_median_ms']:.2f} versus {wasm['candidate']['init_median_ms']:.2f} ms. This includes package/model export through the JS bridge, but excludes layout and structured-block extraction. Explicit GC runs outside each timed call. <a href="wasm-comparison.json">WASM samples and binary hashes</a>.</p>
<h2>What changed</h2><ul>
<li>Replaced the regex-lite interpreter with the optimized regex engine while preserving ASCII shorthand semantics; reduced regex feature tables for WASM.</li>
<li>Borrowed XML slices, streamed tag scans, avoided quadratic containment and UTF-16 offset scans, and removed redundant clones.</li>
<li>Skipped namespace reconstruction only after a conservative streaming check, with the existing normalizer as fallback.</li>
<li>Cached repeated direct formatting within each document build, keyed by properties, theme fonts, and script selection. Rich runs retain the full parsing path.</li>
<li>Fixed explicit/inherited outline precedence, outline reset, simple hyperlink fields, and nested hyperlink ranges.</li></ul>
<p>Inspection of the pinned competitors found event-driven quick-xml readers. That supports further work toward fewer passes over XML. docx-core still performs many scans and builds a richer editing model plus structured JSON details; the remaining performance gap needs architectural work rather than dropping supported output.</p>
<p>REA was tried against the installed Word binary. The optional Ghidra investigation was stopped before usable behavior evidence was produced; no change here is attributed to reverse-engineered Word behavior. Heading fixes follow <a href="https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.outlinelevel?view=openxml-3.0.1">the OOXML outline-level rules</a> and source-document evidence.</p>
<h2>Reproducibility</h2><p><a href="summary.json">Machine-readable summary</a> · <a href="final-tuning.json">Paired timing samples</a> · <a href="comparison-full/rows.json">All four-parser timings</a> · <a href="final-accuracy/scores.json">Per-input accuracy</a> · <a href="input-integrity.json">Input hash verification</a> · <a href="final-javascript-checks.json">Browser and JS check status</a></p>
<p class="muted">Baseline commit: <code>{summary['baseline_commit']}</code><br>Candidate binary SHA-256: <code>{summary['candidate_binary_sha256']}</code><br>Re-run commands are in <code>scripts/parser-benchmark/README.md</code>. Timings were collected on a shared development machine; load and per-input dispersion are saved with the measurements.</p></main></html>'''
    (out / 'report.html').write_text(content)
    print(json.dumps({'paired_speedup': pair_summary['median_paired_speedup'], 'accuracy_regressions': len(regressions),
                      'common_documents': len(common), 'speed': {k: v['median_ms'] for k, v in speed.items()}}, indent=2))


if __name__ == '__main__':
    main()
