# Legacy Word parser allocation and conversion optimization

This candidate reduces unnecessary work in the Word 97–2003 adapter while preserving its generated OOXML package and complete parsed output. It does not replace the adapter with a separate direct-to-model implementation.

The compound-file reader loads only the streams consumed by the DOC parser and transfers ownership into the document. Public unfiltered compound-file parsing remains available. Formatting lookup uses a start-sorted index with prefix maximum ends, retaining the original precedence for overlapping runs. Paragraphs and runs borrow one decoded UTF-16 story buffer and formatting property slices. XML escaping and paragraph/run emission append directly to destination buffers. Extracted media payloads move into the package.

## Measurement

All four libraries were rerun on the same 1,329 distinct inputs, with frozen references and unchanged scoring. The three cohorts comprise 257 multi-format development inputs, 72 additional public regression inputs, and a separate seeded 1,000-DOCX corpus. The 72-input set became a regression corpus after previous fixes; it is not an untouched holdout.

Competitors are docx-rs 0.4.22, office_oxide 0.1.15, and undoc 0.27.1. The common-success latency cohort differs from the accuracy denominator. Failed parses retain a zero accuracy score where a reference exists. Pre-Word-97 and encrypted inputs remain visible outside declared support.

Native optimized timing includes parsing and model/IR construction, plus structured-block extraction for core. Each document has five warm samples, each averaging 1–20 parses. Input reads, startup, JSON serialization, destruction, and reference conversion are excluded. The p95 is across per-document medians. Shared-machine measurements are directional, especially for small template/macro cohorts.

A second run pairs the previous and candidate binaries on every input, with seeded randomized input order and seeded randomized binary order for each pair. It excludes serialization and retains raw samples and binary hashes. This controls drift more closely than comparing separately timed release runs.

The detailed stage profile uses temporary instrumentation and seven warm samples per input. Its 272-input selection includes every successfully parsed supported non-DOCX input and 30 DOCX inputs spread across the baseline latency distribution. Nested stage timings are inclusive and must not be added together. Instrumentation is absent from the production candidate.

## Accuracy checks

Text five-gram F1, ordered-text F1, both feature score sets, source-reference audits, and reference denominators are compared record by record. Full model and block output digests additionally retain all serialized values, including source XML, binary assets, formatting, warnings, IDs, and source references. Only JSON object key order and order of paragraph/table style definitions are normalized. Package identity also hashes source XML and asset bytes.

These checks establish parity on the measured corpus, not perfect fidelity. The existing text, table, field, equation, story, and visual-layout limitations remain. Binary references are LibreOffice conversion proxies, and text F1 does not measure visual layout. Reference content is never inserted into parser output.

## Native shared-state changes

Native cache hits read immutable snapshots instead of taking the five parser-owned cache mutexes. The regex snapshot reader is local to each thread and revalidates against the shared snapshot. Cache updates run on one actor with an eight-slot mailbox. Optional document-cache admission uses try_send: a full queue skips memoization, and the caller still returns its fully parsed result. Regex registration uses a reply channel to deduplicate retained compiled expressions before returning a stable reference.

The actor alone publishes new snapshots. Snapshot entries share immutable plans, style sheets, and XML-index data through Arc. XML-index lookup scratch storage remains local to each parser. Cache entry/source-byte limits remain in place. Thread-local regex readers can retain an older snapshot until their next lookup or thread exit. The WebAssembly path retains its existing single-threaded implementation.

The shared Rayon pool retains its existing scheduling. A trial atomic admission guard reduced throughput on the mixed cohort and was not retained.

This does not make the entire library lock-free: initialization, actor mailboxes, and dependencies have their own synchronization. The hot cache-read paths no longer acquire the parser's old process-wide mutexes.

## Current comparison

Measured source: `dcce836072cb01a24f6490c97643f825d2d6902e`. Each cell is body-text five-gram F1 followed by median / p95 milliseconds. DOCX uses the seeded 1,000-input corpus; other formats pool both multi-format cohorts.

| Format | extend-docx | docx-rs | office_oxide | undoc |
| --- | --- | --- | --- | --- |
| DOCX | 99.983% · 0.673 / 5.080 | 99.740% · 1.193 / 9.499 | 99.917% · 0.750 / 5.380 | 99.988% · 1.130 / 14.260 |
| DOC | 98.748% · 0.266 / 5.016 | Unsupported | 97.979% · 0.077 / 1.290 | 95.293% · 0.027 / 0.425 |
| DOT | 100.000% · 0.843 / 1.264 | Unsupported | 99.902% · 0.505 / 0.506 | 100.000% · 0.133 / 0.196 |
| DOTX | 100.000% · 0.496 / 9.455 | 99.756% · 0.609 / 3.718 | 99.813% · 0.491 / 2.120 | 99.911% · 0.444 / 3.882 |
| DOCM | 100.000% · 0.183 / 2.380 | 100.000% · 0.259 / 1.856 | 100.000% · 0.148 / 0.899 | 100.000% · 0.084 / 2.571 |
| DOTM | 100.000% · 0.566 / 1.130 | 100.000% · 1.657 / 2.648 | 100.000% · 0.627 / 1.704 | 100.000% · 0.716 / 3.455 |

Common successful latency cohorts contain 999 DOCX, 211 DOC, 2 DOT, 6 DOTX, 6 DOCM, and 12 DOTM inputs. Accuracy retains all reference-bearing inputs, including failed parses; supported DOC has 217 inputs and 215 usable references. The 75 additional DOCX inputs are kept separate in the charts. Template and macro cohorts are too small to establish general performance.

## Validation results

All 5,316 engine/input accuracy records are unchanged, including original body scores, ordered text, both feature metric sets, source-reference audits, statuses, and reference denominators. Full parsed-model and structured-block digests match the original baseline for 1,323 inputs/statuses. Six binary inputs have existing source-identity variability; rerunning the unmodified baseline binary reproduces each candidate model and block digest exactly, including IDs. No output fields were discarded from that comparison except object-key and style-definition ordering.

An additional 1,088 concurrent parses across 272 inputs, at four and eight callers, match sequential results. This concurrency audit normalizes the known document-ID variability while retaining reference paths and all content, formatting, assets, and warnings. It is separate from the strict baseline digest comparison.

The 329 existing Rust tests pass, with one opt-in corpus test ignored. The WASM target check passes, and PR CI passes JavaScript, Rust/package build, browser smoke, and preview deployment. No new unit tests or corpus documents were added.

Complete interactive reports retain all feature tables and selectable complexity/performance axes under `output/doc-actor-perf-20261102/formats`, `holdout`, and `docx1k`. Original release and allocation-only runs are preserved separately. Charts and sanitized numeric data are linked from the [extend-docx README](https://github.com/extend-hq/extend-office/blob/main/crates/extend-docx/README.md#parser-latency-comparisons).

## Paired before/after measurements

The same-machine paired run covers all 1,329 acquired inputs and compares successful, declared-supported core parses. DOCX here pools all 1,075 DOCX inputs, so its absolute timings should not be compared directly with the separate 1,000-input comparison table above. Each pair randomizes binary order; values below are the median of per-input candidate/baseline latency ratios. Negative changes are faster.

| Format | Paired successful inputs | Median per-input latency change | Baseline p95 (ms) | Optimized p95 (ms) |
| --- | ---: | ---: | ---: | ---: |
| DOCX | 1075 | -0.1% | 4.125 | 4.131 |
| DOC | 216 | -6.6% | 4.770 | 4.246 |
| DOT | 2 | -9.4% | 1.437 | 1.244 |
| DOTX | 6 | +2.2% | 7.018 | 7.009 |
| DOCM | 6 | -0.7% | 2.335 | 2.269 |
| DOTM | 12 | -2.8% | 1.047 | 1.011 |

DOC improves 6.6% on the median per-input ratio and 11.0% at the cohort p95. DOCX is effectively unchanged in the paired run. The separate four-library run should not be used to attribute its full DOCX timing difference from the older release run to code changes. Small template/macro cohorts and shared-machine variance limit interpretation of differences of a few percent.

## Stage profile

Temporary instrumentation was removed from production. The 272-input paired stage sample uses all 242 successful supported non-DOCX inputs plus 30 DOCX inputs spread across baseline latency. The table shows median per-input stage latency changes for 216 DOC inputs.

| DOC stage | Baseline median (ms) | Optimized median (ms) | Median per-input change |
| --- | ---: | ---: | ---: |
| Compound-file reading | 0.0065 | 0.0054 | -16.1% |
| Document opening, including compound-file reading | 0.0078 | 0.0063 | -23.4% |
| XML construction | 0.1009 | 0.0887 | -11.3% |
| Total package adaptation | 0.1347 | 0.1191 | -10.9% |
| Model construction | 0.1157 | 0.1215 | +1.7% |

The main gains are reduced copying/decoding and XML construction. The XML-to-model bridge remains; normalization and full model construction still account for substantial work. Nested stages are inclusive and should not be summed.

## Concurrent cache comparison

This isolates the cache changes against the allocation-optimized build. Five paired trials use ten passes per workload at 1, 4, and 8 callers. The mixed workload contains 272 inputs; repeated DOC and DOCX workloads each contain 64 instances of one input. Throughput includes allocation/destruction and all passes; latency below excludes the first pass. Queue contention, cache reuse, and shared-machine scheduling affect these results.

| Workload | Callers | Median paired throughput change | Baseline / optimized p95 (ms) |
| --- | ---: | ---: | ---: |
| mixed | 1 | +0.7% | 6.036 / 5.953 |
| mixed | 4 | +3.0% | 7.888 / 7.722 |
| mixed | 8 | +0.0% | 10.052 / 9.746 |
| hot-doc | 1 | -0.8% | 0.779 / 0.801 |
| hot-doc | 4 | -2.3% | 1.095 / 1.202 |
| hot-doc | 8 | -2.0% | 1.429 / 1.443 |
| hot-docx | 1 | -1.2% | 1.440 / 2.197 |
| hot-docx | 4 | +8.1% | 2.706 / 2.129 |
| hot-docx | 8 | -0.8% | 3.747 / 3.419 |

Cache improvements are workload-dependent, with regressions in some repeated-input tails; there is no universal actor speedup. Synchronous actor writes and a global parallel-admission gate were tested and rejected because they reduced mixed-workload throughput. The retained implementation keeps reads independent of the writer and uses bounded, best-effort cache admission.
