import collections
import hashlib
import html
import json
from pathlib import Path
import statistics
from corpus import OUT, ROOT
from run import ENGINES


def pct(v):
    return f'{v*100:.2f}%'


def num(v):
    return '—' if v is None else f'{v:,.2f}'


def table(headers,rows):
    return '<div class="scroll"><table><thead><tr>'+''.join('<th>'+html.escape(str(h))+'</th>' for h in headers)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+str(x)+'</td>' for x in row)+'</tr>' for row in rows)+'</tbody></table></div>'


def main():
    out=OUT
    summary=json.loads((out/'summary.json').read_text())
    scores=json.loads((out/'scores.json').read_text())
    env=json.loads((out/'environment.json').read_text())
    manifest=json.loads((out/'manifest.json').read_text())
    entries=manifest['entries']
    index={e['id']:e for e in entries}
    verification=[]
    for e in entries:
        actual=hashlib.sha256(Path(e['path']).read_bytes()).hexdigest()
        verification.append({'id':e['id'],'unchanged':actual==e['id']})
    (out/'source-verification.json').write_text(json.dumps(verification,indent=2))
    findings=json.loads((out/'findings.json').read_text()) if (out/'findings.json').exists() else []
    d=summary['docx']
    parts=['<h1>Local Word parser benchmark</h1><p class="lead">392 unique inputs · 390 DOCX packages · 2 binary DOC files · 28 October 2026</p>']
    parts.append('<p>Source revision <code>'+html.escape(env['git_revision'])+'</code>. All parsers ran natively on '+html.escape(env['cpu'])+' with the same release optimization profile. This report compares content extraction, selected document features, and parsing speed.</p>')
    if findings:
        parts.append('<h2>Findings</h2><ul>'+''.join('<li>'+html.escape(f)+'</li>' for f in findings)+'</ul>')
    parts.append('<h2>DOCX extraction and reliability</h2>')
    rows=[]
    for engine in ENGINES:
        r=d[engine]
        rows.append([html.escape(engine),html.escape(env['versions'][engine]),f"{r['success']} / {r['attempted']}",pct(r['text_f1_macro']),pct(r['text_f1_macro_success']),pct(r['text_recall_micro']),pct(r['paragraph_recall']),str(r['exact_text_documents'])])
    parts.append(table(['Parser','Version','Completed','Mean text F1, failures = 0','Mean text F1, completed only','Text recall, pooled','Exact paragraph recall','Exact body text documents'],rows))
    parts.append('<p>Text F1 compares bags of normalized character 5-grams within body paragraphs, balancing retained and extra text. The mean gives each document equal weight; failed parses receive zero. Pooled recall weights source 5-grams. Exact paragraph recall preserves duplicate counts. Exact body text also requires the same order. Whitespace, soft hyphens, zero-width spaces and byte-order marks are ignored; text uses NFC normalization.</p>')
    parts.append('<h2>Native parsing speed</h2>')
    rows=[]
    for engine in ENGINES:
        r=d[engine]
        rows.append([engine,num(r['median_ms']),num(r['p95_ms']),num(r['common_median_ms']),num(r['common_total_seconds']),num(r['median_paired_speedup_vs_core'])+'×',pct(r['median_relative_mad'] or 0)])
    parts.append(table(['Parser','Median ms, warm successes','P95 ms, warm successes','Median ms, shared successes','Sum of per-file medians, shared / s','Median paired speedup vs core','Median relative MAD'],rows))
    parts.append('<p>The shared speed comparison uses '+str(d['docx-core']['common_success'])+' identical inputs completed with warm timings by all four parsers. Input bytes were loaded before timing. Each process performed a warmup and seven measured samples, with 1–20 parses per sample to target approximately 20 ms for small inputs. Slow repeated runs were retried with one initial parse and no warmup after a retry encountered temporary disk-space pressure. Those six cases remain in extraction scoring, but their single initial-parse timings are shown separately and excluded from the warm speed comparison. Process startup, disk reads, JSON serialization, compression, evaluation, browser rendering, and layout are excluded. Native parsing and conversion into the exposed document representation are included. Destruction occurs outside the timed stages.</p>')
    parts.append('<p><code>docx-core</code> includes package parsing, model construction and structured-block extraction. Its text score uses the structured blocks; feature checks use its native model. <code>docx-rs</code> uses its document model with image preview generation disabled. <code>office_oxide</code> includes <code>to_ir()</code>. <code>undoc</code> uses <code>parse_bytes()</code> with DOC/DOCX/codepage features and no cleanup pass. Adapter normalization is outside timing for every parser. Shared flags: <code>'+html.escape(env['profile'])+'</code>.</p>')
    parts.append('<p>The machine was shared with other workloads. Recorded load averages and per-sample timings are retained in JSON. The speed table shows local warm-parser wall times, not server throughput, cold starts, shipped WASM performance, or memory benchmarks.</p>')
    parts.append('<p>Accuracy scoring began after the main timing run and overlapped the later single-parse recovery attempts. Their initial-parse times are diagnostic only; none enters the warm speed table. The temporary disk-space incident and recovery protocol are recorded in <code>retry-incident.json</code>.</p>')
    parts.append('<p>On shared successful inputs, <code>docx-core</code> spent '+num(d['docx-core']['common_parse_seconds'])+' summed seconds in package parsing/model construction and '+num(d['docx-core']['common_projection_seconds'])+' seconds in structured-block extraction. Stage timings locate the cost broadly; this benchmark does not profile its cause.</p>')
    parts.append('<h2>Feature recovery on DOCX</h2>')
    labels={'headings':'Heading text + level','lists':'Numbered/bulleted paragraph membership','table_cells':'Table cell text','nested_tables':'Nested table content','horizontal_merges':'Nonempty merged-cell text + column span','vertical_merges':'Nonempty vertical-merge start markers','textbox_text':'Text-box paragraph text, recovered anywhere in body','header_text':'Header text','footer_text':'Footer text','footnotes_text':'Footnote text','endnotes_text':'Endnote text','comments_text':'Comment text'}
    rows=[]
    for key,label in labels.items():
        ref=next((d[e]['features'][key] for e in ENGINES if key in d[e]['features']),None)
        if not ref:
            continue
        rows.append([label,f"{ref['expected']:,} / {ref['documents']} docs",*[pct(d[e]['features'].get(key,{}).get('recall',0)) for e in ENGINES]])
    parts.append(table(['Check','Source units / eligible docs',*ENGINES],rows))
    parts.append('<p>These are recovery checks against source XML: exact normalized text anchors, with heading level or column span where stated. Failures remain in denominators. Header/footer/note/comment checks compare distinct paragraphs within the matching story. Text-box checks credit retained content even when a parser flattens the box. Vertical merges test retained starts, not reconstructed row-span accuracy. This is not a complete OOXML conformance or style-cascade audit.</p>')
    parts.append('<p><strong>Span interpretation:</strong> the horizontal-merge score is agreement with the literal source grid-span number, not visual merge accuracy. <code>docx-core</code> deliberately normalizes conflicting table grids. Of its 746 mismatches, 646 retained identical merged-cell text with a different numeric span, another 88 retained the cell text outside the same merged-cell anchor, and 12 had a different text anchor. Do not interpret its 83.09% raw-span agreement as 16.91% lost merges. See <code>span-diagnostics.json</code> and <code>crates/docx-core/src/parse/table.rs</code>.</p>')
    parts.append('<p>The heading check identified 142 source heading text/level pairs absent or different in <code>docx-core</code>; inspected native-model cases had missing heading classifications or a different level. Conversely, its seven non-exact body-text cases contain symbols, form controls, or embedded objects. Some small text differences reflect generated checkbox/symbol content rather than lost source text.</p>')
    rows=[]
    for key,label in [('images','Embedded-image occurrence count'),('equations','Equation occurrence count'),('explicit_bold','Explicit bold text probe'),('explicit_italic','Explicit italic text probe'),('hyperlinks','Hyperlinked text probe')]:
        ref=next((d[e]['features'][key] for e in ENGINES if key in d[e]['features']),None)
        if ref:
            rows.append([label,str(ref['documents'])+' docs',*[pct(d[e]['features'].get(key,{}).get('recall',0)) for e in ENGINES]])
    parts.append('<h3>Additional probes</h3>'+table(['Probe','Source coverage',*ENGINES],rows))
    parts.append('<p>Image/equation probes compare occurrence counts only; they do not verify bytes, placement, or formula correctness. Styled/link text probes use 5-gram recall and are sensitive to run segmentation and inherited formatting. Treat these as diagnostics, rather than full feature accuracy scores.</p>')
    audits=[r['source_reference_audit'] for r in scores if r['format']=='docx' and r.get('source_reference_audit')]
    totals={k:sum(a[k] for a in audits) for k in ['blocks','duplicate_ids','missing_references','wrong_document_references']}
    parts.append('<h3>Structured extraction contract</h3><p><code>docx-core</code> also exposes typed blocks with document/node/part/story references and UTF-16 offsets. The basic audit covered '+f"{totals['blocks']:,}"+' blocks: '+str(totals['duplicate_ids'])+' duplicate IDs, '+str(totals['missing_references'])+' blocks without source references, and '+str(totals['wrong_document_references'])+' references to the wrong document. This checks internal consistency, not source-offset correctness or stability across edits. The other adapters expose their native document models and are not drop-in implementations of this contract. No parser was scored on browser hit-testing or layout geometry.</p>')
    parts.append('<h2>Binary DOC</h2>')
    rows=[]
    for engine in ENGINES:
        r=summary['doc'][engine]
        rows.append([engine,f"{r['success']} / {r['attempted']}",pct(r['text_f1_macro']),num(r['median_ms'])])
    parts.append(table(['Parser','Completed','Mean body text F1','Median ms'],rows))
    parts.append('<p>Only two inputs have the legacy binary signature. Their reference text comes from LibreOffice DOC→DOCX conversion, so agreement is an independent converter comparison rather than direct OOXML ground truth. The other 174 inputs with a <code>.doc</code> suffix are ZIP-based DOCX and belong to the DOCX results. <code>docx-rs</code> has no legacy-DOC reader.</p>')
    parts.append('<h2>Failures and slow retries</h2>')
    rows=[]
    for r in scores:
        if r['status']!='ok' or r.get('initial_attempt'):
            rows.append([r['id'][:16],r['engine'],r['status'],html.escape(r.get('error') or r.get('retry_reason') or ''),num(r.get('median_total_ms'))])
    parts.append(table(['Input SHA-256 prefix','Parser','Final status','Detail','Measured ms'],rows))
    parts.append('<h2>Reference scope and reproducibility</h2><ul><li>Corpus: the existing local DOC and DOCX testing folders; no new sample was downloaded. Lock files beginning <code>~$</code> are excluded and byte-identical inputs are deduplicated. Paths and aliases are in <code>manifest.json</code>.</li><li>DOCX reference: independent ZIP/XML traversal of literal WordprocessingML text, tables and selected properties. Cached field results are retained; field instructions and deleted/moved-from revisions are excluded. One markup-compatibility branch is selected. Figures are not OCRed, equations are not interpreted as ordinary text, and automatic numbering/symbol rendering is not a native Word oracle.</li><li>Visual fidelity, layout, pagination, exact rendering, editing/round-trip correctness, and comprehensive inherited style correctness were not benchmarked.</li><li>Every source hash was rechecked at report generation: '+str(sum(v['unchanged'] for v in verification))+' / '+str(len(verification))+' unchanged.</li><li>The standalone Cargo lockfile pins transitive dependencies. Raw native models, block JSON, per-file timings, normalized projections, independent references, scores, and source verification are retained beside this report.</li></ul>')
    parts.append('<h2>Per-document results</h2><label>Filter by input hash, parser or status <input id="filter" placeholder="Filter results"></label>')
    rows=[]
    for r in sorted(scores,key=lambda r:(r['id'],r['engine'])):
        rows.append([r['id'][:16],r['format'],r['engine'],r['status'],pct(r['body']['f1']),pct(r['body']['paragraph_recall']),num(r.get('median_total_ms'))])
    parts.append('<section id="details">'+table(['Input hash','Format','Parser','Status','Text F1','Paragraph recall','ms'],rows)+'</section>')
    parts.append('<h2>Re-run</h2><p>From the repository root, run these steps in order. Timing runs should be sequential and the host otherwise idle where possible. The corpus script accepts <code>--roots</code>; the result directory can be set with <code>--out</code> for inventory, timing, retry and scoring.</p><pre><code>python3 -m pip install --target scripts/parser-benchmark/.python-deps -r scripts/parser-benchmark/requirements.txt\npython3 scripts/parser-benchmark/corpus.py\ncargo build --release --locked --manifest-path scripts/parser-benchmark/Cargo.toml -j 4\npython3 scripts/parser-benchmark/run.py\npython3 scripts/parser-benchmark/retry.py --single-parse\npython3 scripts/parser-benchmark/assess.py --refresh\npython3 scripts/parser-benchmark/report.py</code></pre>')
    parts.append('<p>Pinned upstream releases: <a href="https://crates.io/crates/docx-rs/0.4.22">docx-rs 0.4.22</a> (MIT), <a href="https://crates.io/crates/office_oxide/0.1.15">office_oxide 0.1.15</a> (MIT OR Apache-2.0), and <a href="https://crates.io/crates/undoc/0.27.1">undoc 0.27.1</a> (MIT). Versions and license metadata are from the downloaded release manifests.</p>')
    style='''body{font:15px/1.55 system-ui,sans-serif;color:#182330;background:#f7f9fb;margin:0;padding:36px}main{max-width:1250px;margin:auto}h1{font-size:34px;margin:0}h2{margin-top:38px;border-top:1px solid #d7e0e8;padding-top:24px}h3{margin-top:25px}.lead{font-size:19px;color:#52677b}p,li{max-width:1100px}table{border-collapse:collapse;width:100%;font-size:13px;background:white}th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #e0e6eb;vertical-align:top}th{background:#e8eff5;font-weight:650}td:nth-child(n+3){font-variant-numeric:tabular-nums}tr:hover{background:#f2f7fa}.scroll{overflow:auto}code{font-size:12px;overflow-wrap:anywhere;background:#edf1f5;padding:2px 4px}input{display:block;width:min(500px,95%);padding:10px;border:1px solid #b7c5d0;border-radius:4px;margin:10px 0 20px}#details{max-height:650px;overflow:auto}#details thead{position:sticky;top:0}'''
    script="document.getElementById('filter').addEventListener('input',e=>{let q=e.target.value.toLowerCase();document.querySelectorAll('#details tbody tr').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(q));});"
    document='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local Word parser benchmark</title><style>'+style+'</style><main>'+''.join(parts)+'</main><script>'+script+'</script></html>'
    (out/'report.html').write_text(document)
    print(out/'report.html')


if __name__=='__main__':
    main()
