# Parser benchmark and optimization harness

The standalone Cargo workspace pins docx-rs 0.4.22, office_oxide 0.1.15, and undoc 0.27.1. It pins the published extend-docx from [extend-office](https://github.com/extend-hq/extend-office). Release measurements use opt-level 3, thin LTO, and one codegen unit for every parser. The production WASM build uses opt-level 3 and wasm-opt -O3; record its compressed size alongside speed.

The Rust package and import names are `extend-docx` and `extend_docx`. Historical benchmark records and the comparison scripts retain `docx-core` as the engine identifier so existing measurements remain comparable. The native runner accepts both `extend-docx` and `docx-core`; both select the same parser. Historical chart labels using `docx-core` refer to this parser before its rename.

Install Python dependencies from `requirements.txt` into `.python-deps`, then build with `cargo build --release --manifest-path scripts/parser-benchmark/Cargo.toml`. Run commands from the repository root. Generated results and binary snapshots belong under `output/`.

Inventory an explicitly supplied input directory with `python3 scripts/parser-benchmark/corpus.py --roots /path/to/local/corpus`. Use only documents you are authorized to process and redistribute; input documents and generated reports are not included in the repository. Legacy DOC reference generation requires LibreOffice (`soffice`) on PATH.

## Original comparison

`corpus.py` inventories local inputs by content hash and creates an independent OOXML extraction oracle. `run.py`, `assess.py`, and `report.py` run the four parsers, normalize outputs, and publish the original report. Actual format is determined from bytes; filename extensions do not determine format. Legacy DOC uses a different reference and is reported separately.

## Optimization experiments

The optimization scripts reuse the manifest and oracle under `output/parser-benchmark` and write results to `output/parser-hillclimb`. The saved split defines tuning, holdout, and outlier cohorts. Keep its identity fixed throughout an experiment.

Preserve a baseline binary before editing core. `src/bin/probe.rs` separately measures package decoding, complete model construction, and structured-block extraction. It reads input once, discards the first iteration, and excludes serialization and destruction from timings.

```sh
python3 scripts/parser-benchmark/hillclimb.py --label final --baseline output/parser-hillclimb/baseline-probe --candidate output/parser-hillclimb/final-probe --repeats 5
python3 scripts/parser-benchmark/hillclimb_accuracy.py --label final --binary output/parser-hillclimb/final-parser-benchmark --split full
python3 scripts/parser-benchmark/compare.py --binary output/parser-hillclimb/final-parser-benchmark --split full --repeats 5
python3 scripts/parser-benchmark/parity.py --label final --binary output/parser-hillclimb/final-parser-benchmark
python3 scripts/parser-benchmark/wasm_compare.py --repeats 5
python3 scripts/parser-benchmark/hillclimb_report.py
```

Run timing commands sequentially after builds, accuracy checks, and other owned CPU jobs finish. Engine order and input order are randomized with a saved seed. Raw samples, cold parses, dispersion, process status, load averages, and binary hashes are retained. A shared development machine is not an isolated performance lab.

The main harness takes `ENGINE INPUT FORMAT OUTPUT_PREFIX REPEATS [compact]`. Output prefix `-` disables serialization. `compact` reduces only the saved diagnostic JSON after a complete production parse; it does not change timed work. Core builds both its complete model and structured blocks; the other engines expose their corresponding native models or IR. docx-rs image previews are disabled. These outputs have different fidelity and coverage.

The parity audit compares all model fields against original saved native output, except source XML serialization and binary image payload contents. Image presence is retained; style definitions are aligned by ID. Other arrays remain ordered. The WASM benchmark measures complete model construction and the JS bridge, with file reads, module initialization, and explicit GC outside warm timings. It does not measure layout or structured-block extraction.

For parser rewrites, use `strict_parity.py` with `--baseline`, `--binary`, `--out`, `--label`, and `--split full`. This compares every serialized model and block value, including source XML and binary payloads. Only JSON object key order and the order of paragraph/table style definitions are normalized. All other arrays retain their order. Pass `--digest-binary scripts/parser-benchmark/target/release/digest` to stream canonical hashes in native code without loading large output trees into memory. Baseline receipts are cached by parser and digest executable hashes. `--manifest` accepts an additional differential fixture corpus.

## Interpretation

Text scores normalize Unicode and whitespace and use character 5-grams plus paragraph anchors. Feature checks report recall with explicit denominators. They do not establish universal accuracy or Word-identical rendering. Adjacent styled spans, resolved table grids, grouped images, generated symbols, and form controls can differ legitimately from raw XML occurrence counts. Preserve original scores and document diagnostic limitations rather than changing an oracle to make a candidate appear perfect.

Competitor accuracy can be reused only when pinned versions, dependencies, and normalization are unchanged. Fresh comparison timings use the common set of successful inputs; failures and legacy DOC are reported separately. Do not compare old timing totals with fresh totals as if they were paired observations.

## Reference limitations

For desktop Word object-model JSON, Word-saved Flat OPC references, and fresh four-parser comparisons, see [Microsoft Word reference benchmarks](../../docs/word-reference-benchmarks.md). The Word report keeps direct application measurements, checks derived from Word-saved XML, and original image-payload checks separately labeled, with per-feature reference coverage.

The Python XML extractor is an independent reference, not a complete Word implementation. Adjacent short formatted runs can score differently after a parser combines them, even when every character retains its formatting. Exact content anchors can differ when a parser resolves symbol characters absent from the literal-text reference. An image's preferred SVG representation can also differ from the PNG fallback counted by the original reference.

Keep the original scores visible. Investigate each deficit against source relationships, character-position formatting, native image payloads, and independently specified geometry. Track reference mistakes separately from parser omissions, and retain source and binary identities with the evidence. A 100% recall score does not establish precision, complete format coverage, or rendering fidelity.

The image-occurrence metric matches each body image reference to retained native payload bytes for all four parsers. It counts repeated placements inside composite SVGs, accepts an SVG alternative only when the source explicitly associates it with that occurrence, and uses one-to-one matching so one payload cannot satisfy multiple placements. It collapses mirrored visual and semantic representations, and gives no credit for unreferenced resource inventories, preserved source XML, or package copies. Unresolved references stay in the denominator. docx-rs placements resolve against its retained image bytes; office_oxide exposes bytes in its IR; undoc placements resolve against hashes computed from its in-memory resource bytes, which its default JSON serialization omits. Hash export and scoring run outside timed parsing. This checks payload retention, not crop, position, or pixel fidelity. The original node-count score remains in the original-scoring details.

The shared literal checks add three separately named metrics without replacing their original records. `horizontal_spans_literal` requires a one-to-one content anchor and the exact span value. `table_text_literal` requires every source literal character in order within one output table. Both permit additional output characters and preserve multiplicity; they measure recall, not precision or geometry. `explicit_bold_characters` aligns source literal paragraphs in order and checks bold at the corresponding character offsets, independently of how runs are split. A missing paragraph receives no formatting credit. These rules apply equally to all parsers; the original exact-anchor and per-run 5-gram scores remain available.

## Reporting

Use charts as the primary comparison view in HTML reports, with tables for exact values. Include median and p95 latency by parser, full latency distributions, and selectable axes for document size and complexity. Show extraction quality and feature recall alongside speed, with their denominators and reference limitations. Keep the cohort identical across parsers, retain zero-count inputs on logarithmic axes, and label units, transforms, and timing exclusions. Current feature and priority tables share the same live measurements. The latest experiment stays visible, with earlier experiments in a separate history section. The live publisher tracks the presentation hash and reloads the page when its template changes, in addition to polling measurements.

While a candidate is being validated, the live report shows its completed per-document latency and recall records above the accepted benchmark. Partial timing uses only inputs completed successfully by every compared engine, including the previous build. Records must match the candidate executable, corpus, scorer, phase, and timing repeat count. The latest complete comparison can appear in the latency charts and cohort tables even when its improvement gate fails; its build and promotion status remain explicit. Accepted-build recall stays separately labeled, and promotion still requires all validation and timing gates. Targeted measurements remain labeled as experiments and do not replace full-corpus results.

The publisher caches validated records and aggregate measurements while their source identities remain unchanged. Progress and experiment status continue to refresh. The browser checks the small publication-status response before downloading the complete report payload; an unavailable status response falls back to fetching the payload. These changes reduce reporting overhead and do not change timed parser work or scoring rules.

`chart_metrics.py` derives numeric input dimensions from the existing manifest and OOXML oracle without exporting document text or filenames. `frontier_report.py` combines those dimensions with measured latencies and verified accuracy receipts to produce a self-contained interactive report. Use the same charts for subsequent comparison reports rather than relying on summary tables alone.

`wasm_parity.py` compares the complete model and package returned across the JavaScript boundary. It excludes runtime timing fields and normalizes only object-key and style-definition order. Run it separately from WASM timing measurements.

## Tight feedback loop

See [the feedback runner](../parser-feedback/README.md) for immutable baseline setup, single-document parity checks, and interleaved timings. The live publisher accepts explicit paths: `python3 scripts/parser-benchmark/live_report.py --run output/parser-next --site output/parser-frontier`. Serve that site locally with `python3 -m http.server 8772 --bind 127.0.0.1 --directory output/parser-frontier`.
