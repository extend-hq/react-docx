# Word parser fixes and measurement

The parser repair covers binary Word container access, document structure, fields, formatting, images, and the shared OOXML model. The deployed playground rebuilds its WASM from the deployed Rust sources; a package release is not required. See [deployment provenance](playground-deployment.md) and [supported formats](supported-word-formats.md).

## Changes

- The internal CFB reader honors declared FAT and stream lengths, tolerates absent unused padding, isolates unrelated stream errors, limits lookup to root streams, and resolves the ASCII stream names used by Word without case sensitivity. It remains an internal reader, not the external Rust `cfb` crate.
- Binary import retains comments and author metadata, floating/grouped images, delayed blips, metafiles, picture fills, and image-only text boxes.
- Paragraph/run decoding handles compact property modifiers, style-relative toggles, symbols, appended list levels, list overrides, nested table boundaries, tracked deletions, fields, and UTF-16 surrogate pairs. Unmapped paragraph formatting no longer inherits an unrelated final table record.
- Localized link fields are identified by their binary field type. Bookmark ranges, REF/PAGEREF/NOTEREF links, and hyperlink results spanning paragraphs are retained.
- Uncached phonetic-guide EQ fields recover their explicit annotation and base text while preserving the field instruction. This provides text extraction, not complete phonetic positioning or a general EQ evaluator.
- Shared OOXML parsing handles nested compatibility branches once, excludes deleted/moved-away runs from active text, retains heading levels 1–9, and projects cropped/stretched bitmap fills.
- Picker, import, URL naming, and drag-and-drop accept all six Word extensions. Download names and MIME types follow the retained OOXML package family.

## Cohorts and immutable evidence

The final reports are generated locally under:

| Directory | Cohort |
| --- | --- |
| `output/word-formats-final-20261102` | Same 257 downloaded originals used for the initial repair, with frozen references |
| `output/word-formats-holdout-20261102` | First evaluation of 72 new content hashes, before inspecting their parser results |
| `output/word-formats-holdout-fixed-20261102` | The same 72 inputs after repairing two newly discovered DOC defects |
| `output/word-formats-final-docx1k-20261102` | Complete original seeded 1,000-document DOCX corpus, with frozen source references |

The 257-input corpus contains 203 DOC, 31 DOCX, 2 DOT, 4 DOTX, 6 DOCM, and 11 DOTM originals. Nine pre-Word-97 and two encrypted documents are independently outside declared scope. The supported DOC cohort retains 192 inputs, including one invalid document identifier rejected by all binary parsers. There are 190 usable DOC references; missing references affect accuracy denominators only, not parse coverage.

The new-input cohort contains 25 DOC, 44 DOCX, 2 DOTX, and 1 DOTM. Its first evaluation exposed uppercase compound-stream names and phonetic EQ text. The first-pass results remain intact; the repaired evaluation is now a regression cohort, not an untouched holdout. The regression source overlaps a development source, so this is not a source-disjoint holdout. No DOT or DOCM generalization claim is made from this cohort.

The 1,000-DOCX sample was selected before parser results using seed 20261029 from a pinned public corpus snapshot. All original inputs remain included. The source provenance and selection receipt remain under `output/parser-next-20261029/corpus-1k`.

Earlier baselines under `word-formats-expanded-20261102`, `word-formats-fixed-20261102`, `word-formats-verified-20261102`, and `word-formats-docx1k-20261102` are preserved. Raw output folders in a new run must not point to an older run.

## What the scores measure

The original body-text score compares overlapping five-character grams within paragraphs after NFC normalization and removal of whitespace/soft breaks. Precision is matched/found, recall is matched/expected, and F1 is their harmonic mean. The headline value is a document macro average; failed parses with references score zero. This score is sensitive to paragraph segmentation and does not fully enforce order.

The report additionally shows pooled micro F1, exact longest-common-subsequence character F1, exact ordered text and paragraph counts, and feature precision/recall/F1. These additions do not replace or weaken the original references or denominators.

Feature recall retains all earlier checks. Independent literal audits verify explicit bold and italic characters and hyperlink destinations at ordered text offsets. Native OOXML image checks match retained source payload occurrences. Other image/equation count metrics remain proxies, and inherited styling or field-derived links can legitimately exceed an explicit-markup reference. Exact feature anchors are segmentation-sensitive. None of these measurements establishes Word-identical rendering.

The complete reports retain all four engines, full feature tables, scope filters, timing charts, and selectable complexity and performance axes. Pinned comparisons are docx-rs 0.4.22, office_oxide 0.1.15, and undoc 0.27.1. docx-rs has no binary Word parser.

## Latency method

Every final cohort uses one optimized release executable for all libraries, randomized input/engine order, and the repeat count recorded in its environment receipt. Each sample averages 1–20 warm parses. Core constructs its model and structured blocks; competitors construct their native model or IR. File reads, process startup, output serialization, destruction, and reference conversion are excluded. The reported p95 is across document medians, not service-request p95 or browser import latency.

Cross-library timings use the common successful cohort. Accuracy retains all reference-bearing inputs, including failures. Comparing latency across different format cohorts is not a controlled format-only experiment. This is a shared development machine, so small differences should not be treated as isolated laboratory measurements.

## Remaining fidelity limits

Raw discrepancies remain visible even when independent inspection identifies a reference limitation:

- LibreOffice conversion can recalculate cached date/time/page fields, change symbol mapping, synthesize numbering, and repair damaged style/table structures. Core retains source values rather than copying the conversion output.
- Comment and table paragraph segmentation can differ despite complete literal text. Heading, list, table-span, merge, text-box, and story checks still expose unresolved mismatches.
- Some malformed link fields lack their opening field marker; their literal text is retained without inventing a hyperlink.
- Complete visual layout, phonetic placement, image geometry, annotation ranges, and general legacy equations remain outside the guarantees of these extraction scores.
- Encrypted documents, pre-Word-97 formats, and non-Word families remain unsupported. Template/macro content extraction does not establish lossless template or macro editing; macros are never executed.

## Validation and reproduction

The full Rust workspace suite runs again after the missing parity-test module is restored by relocating the existing test. Validation also includes package/playground type checks, the existing JavaScript and oracle suites, browser smoke checks, a fresh WASM/application build, and the deployed build manifest and asset hashes. No new repository unit tests were added for this repair batch.

Build the release harness, copy it to a new run directory's `bin/parser-benchmark`, and preserve the selected manifest and references before measuring:

```sh
python3 scripts/parser-benchmark/word_formats.py run --out output/word-formats-final-20261102 --repeats 5
python3 scripts/parser-benchmark/word_formats.py score --out output/word-formats-final-20261102
python3 scripts/parser-benchmark/word_formats_compare.py --baseline output/word-formats-expanded-20261102 --out output/word-formats-final-20261102
python3 scripts/parser-benchmark/word_formats.py report --out output/word-formats-final-20261102
```

Each run records executable, Rust source, scorer, and manifest hashes, raw timing samples, versions, and environment metadata. The scoring receipt separately records the scorer used for accuracy.

Format interpretation follows Microsoft's [compound-directory rules](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/a94d7445-c4be-49cd-b6b9-2f4abc663817), [toggle operand](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/bc4ca98b-68ca-49dc-a091-1460e42d781e), [FIB/list lengths](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/0c9df81f-98d0-454e-ad84-b612cd05b1a4), and [list overrides](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/1a3bc610-c07a-454e-876f-86534a50c33a). The phonetic EQ representation is documented in Microsoft's archived [Word 2000 phonetic-guide article](https://ftp.zx.net.nz/pub/archive/ftp.microsoft.com/MISC/KB/en-us/210/858.HTM).
