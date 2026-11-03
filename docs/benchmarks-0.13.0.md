# Parser comparison for 0.13.0

Measured on November 2, 2026 from merged main `9ae335abdc79f7defe5a2843065a3ff13c6e5cea`. The release changes package versions and documentation after this measurement; the measured Rust source is unchanged.

All four parsers were rerun on 1,329 distinct inputs: the 257-input multi-format development corpus, 72 additional public inputs retained as regressions after their first evaluation, and the separate seeded 1,000-DOCX corpus. References and input selection were frozen. Comparisons use docx-rs 0.4.22, office_oxide 0.1.15, and undoc 0.27.1.

## Text accuracy and latency

Each cell is **body-text F1 · median / p95 milliseconds**. DOCX below uses the separate 1,000-input corpus; other formats pool both multi-format cohorts. Timing uses the common successful inputs for libraries supporting that format. Accuracy retains every reference-bearing input, including failed parses as zero.

| Format (inputs) | extend-docx | docx-rs | office_oxide | undoc |
| --- | --- | --- | --- | --- |
| DOCX (1,000) | 99.983% · 0.800 / 6.641 | 99.740% · 1.212 / 9.593 | 99.917% · 0.816 / 5.793 | 99.988% · 1.204 / 13.712 |
| DOC (217) | 98.748% · 0.268 / 5.664 | Unsupported | 97.979% · 0.063 / 1.285 | 95.293% · 0.027 / 0.417 |
| DOT (2) | 100.000% · 1.008 / 1.564 | Unsupported | 99.902% · 0.339 / 0.486 | 100.000% · 0.131 / 0.191 |
| DOTX (6) | 100.000% · 0.565 / 7.232 | 99.756% · 0.589 / 3.724 | 99.813% · 0.357 / 1.970 | 99.911% · 0.461 / 3.886 |
| DOCM (6) | 100.000% · 0.180 / 2.463 | 100.000% · 0.257 / 1.823 | 100.000% · 0.142 / 1.031 | 100.000% · 0.083 / 2.569 |
| DOTM (12) | 100.000% · 0.546 / 1.076 | 100.000% · 1.640 / 2.587 | 100.000% · 0.618 / 1.716 | 100.000% · 0.724 / 3.439 |

The pooled DOC cohort has 217 declared-supported inputs and 215 usable references. Core parses 216/217; the remaining invalid document identifier is rejected by every compared binary parser. Nine pre-Word-97 and two encrypted acquired DOC inputs remain visible in the all-input reports but are outside declared support. The template and macro-enabled cohorts are small; their scores do not establish universal compatibility or lossless editing.

The 75 additional DOCX inputs score extend-docx **100.000%**, docx-rs **95.658%**, office_oxide **90.578%**, undoc **98.644%**. On the 25 additional DOC inputs, core parses 25/25 and scores **99.961%**, up from **91.961%** on their first evaluation. Those inputs became regressions after their defects were inspected and repaired; they are not an untouched holdout.

F1 is the harmonic mean of precision and recall for normalized paragraph-level character five-grams, macro-averaged across documents. It ignores whitespace and soft breaks and is sensitive to paragraph segmentation. The original score remains alongside ordered longest-common-subsequence character F1, exact-text counts, feature precision/recall/F1, and literal-content audits. Binary references are LibreOffice conversion proxies; OOXML references are independently extracted from source packages.

On the 1,000-DOCX corpus, ordered-text F1 is extend-docx **99.995%**, docx-rs **99.747%**, office_oxide **99.926%**, undoc **99.975%**. Undoc has the slightly higher original five-gram score, while core has the higher ordered-text score. Core has the lowest measured median, but its 0.800 ms versus office_oxide's 0.816 ms is a small difference on a shared machine; core has a higher p95 than office_oxide. Core is slower than the other binary parsers on DOC.

Timing measures native optimized parsing, model/IR construction, and core's additional structured-block projection. Every parser uses the same release executable and five warm samples; each sample averages 1–20 parses. File reads, process startup, serialization, destruction, and reference conversion are excluded. The p95 is across per-document medians, not request-level or browser latency. Measurements came from a shared development machine.

## Fidelity and validation

All 5,316 engine/input result records were checked against the completed pre-cleanup runs after fresh parsing and scoring. Parse status, original body score, ordered-text score, and both sets of feature metrics are unchanged. Main CI passes JavaScript/type checks, Rust tests and package builds, and browser smoke checks. Local validation passed 963 JavaScript tests and 329 Rust tests, with one Rust corpus test intentionally ignored.

On the 1,000-DOCX corpus, independent recall checks retain all 680,435 explicitly bold characters, 433,678 explicitly italic characters, 101,572 characters with hyperlink destinations, and 1,069 referenced image payload occurrences. These are recall results, not a claim of perfect formatting precision or image geometry. Remaining exact-anchor deficits include one heading, three list items, two horizontal spans, six vertical merges, and six text-box text anchors. General rendering, field calculation, and visual positioning are not established by text F1.

Legacy DOC still has differences in headers/footers, list and heading interpretation, field destinations, table/comment paragraph segmentation, and equations. Conversion can also change cached fields, symbols, and damaged structures. All original scores and denominators remain intact. Encrypted and pre-Word-97 inputs remain unsupported, and macros are never executed.

See [supported formats and MIME types](supported-word-formats.md), [measurement definitions and remaining gaps](word-parser-fixes.md), and [playground deployment provenance](playground-deployment.md).

Complete local interactive reports, including feature tables, latency distributions, and selectable complexity/performance axes, are retained under `output/word-formats-main-20261102`, `output/word-formats-main-holdout-20261102`, and `output/word-formats-main-docx1k-20261102`. Earlier runs and the first evaluation of the additional inputs are preserved separately. Input documents and raw parsed content are not published with the release.
