# Word parser fixes and remeasurement

The repaired build was rerun on the same 257 downloaded originals, with the same frozen references and scoring rules. No inputs were dropped to improve scores. The interactive report is `output/word-formats-fixed-20261102/report.html`; the immutable baseline is `output/word-formats-expanded-20261102/report.html`. The report retains every feature metric, all four comparison libraries, both scope filters, latency charts, and selectable size/complexity axes.

## Changes

- The repository's CFB reader respects declared FAT and stream lengths, tolerates absent unused sector padding, isolates errors in unrelated streams, and prevents embedded storage streams from shadowing top-level Word streams. It remains an internal reader, not the external Rust `cfb` crate.
- The legacy adapter imports comments with author/initial metadata and reference anchors; resolves floating/grouped pictures, delayed blips, WMF/EMF payloads, picture fills, and image-only text boxes; and attaches story-specific image relationships.
- Binary formatting now handles compact property modifiers, style-relative toggles, symbol runs, appended list-level records, list overrides, negative list identifiers, nested table cell boundaries, tracked deletions, nested fields, and UTF-16 surrogate pairs within a run.
- The shared OOXML parser selects nested compatibility branches once and excludes deleted/moved-away runs from active text.
- The Rust and TypeScript models retain Word heading levels 1–9. Paragraph reconstruction writes the outline level even when the paragraph uses a non-heading style.

## Supported-version DOC results

The supported-version cohort contains 192 DOC inputs. Of these, 190 have independent conversion references. The malformed input that still fails parsing remains in coverage; all three binary Word parsers reject its invalid Word identifier. The two inputs without usable references remain excluded only from accuracy denominators.

| Metric | Before | After |
| --- | ---: | ---: |
| Parsed DOC inputs | 188/192 | 191/192 |
| Mean body-text F1 | 97.00% | 98.58% |
| Table-cell anchors | 4,584/5,066 | 5,058/5,066 |
| Literal table-text anchors | 197/208 | 205/208 |
| Image occurrences, count recall only | 76/131 | 131/131 |
| Vertical merges | 79/84 | 84/84 |
| Horizontal spans, literal anchors | 351/381 | 379/381 |
| Explicit bold characters | 51,642/55,088 | 53,922/55,088 |
| Heading anchors and levels | 502/774 | 572/774 |
| Comment paragraph anchors | 0/46 | 34/46 |
| Text-box paragraph anchors | 251/285 | 282/285 |

No scored input has lower body-text F1 than the original baseline, and no previously successful parse fails. Image results measure occurrence-count recall, not payload, placement, or visual accuracy: core emits 140 occurrences against 131 reference occurrences. Other feature rows also measure recall under their stated matching rules, not precision or complete fidelity.

## Latency and competing parsers

All parsers were timed again from one optimized release executable with pinned comparison versions. On the identical 185-input before/after DOC cohort, core's median increased from 0.224 to 0.291 ms, and p95 from 3.823 to 4.303 ms. The median increase is about 30%; the repaired parser also extracts more content and features. This is an observed tradeoff, not a causal profile of each change.

The current cross-library common-success cohort has 187 inputs, including two newly recovered documents. Its p95 is therefore not directly comparable with the old 185-input p95.

| Parser | Parsed | Body-text F1 | Median ms | p95 ms |
| --- | ---: | ---: | ---: | ---: |
| docx-core | 191/192 | 98.58% | 0.293 | 6.437 |
| office_oxide | 191/192 | 98.38% | 0.070 | 1.405 |
| undoc | 187/192 | 95.80% | 0.029 | 0.467 |

`docx-rs` has no binary Word parser. Versions remain pinned at docx-rs 0.4.22, office_oxide 0.1.15, and undoc 0.27.1. Core builds its complete model and structured blocks; competitors build their native model or IR. Nine warm samples per input average 1–20 parses each. Timings exclude file reads, process startup, serialization, destruction, and reference conversion. The p95 is across document medians, not request latency.

| Other format | Parsed | Body-text F1 | Median ms |
| --- | ---: | ---: | ---: |
| .dot | 2/2 | 100.00% | 0.969 |
| .docx | 31/31 | 100.00% | 0.190 |
| .dotx | 4/4 | 100.00% | 0.245 |
| .docm | 6/6 | 100.00% | 0.184 |
| .dotm | 11/11 | 100.00% | 0.559 |

These are small cohorts and text-extraction results, not a claim of full template, macro, or visual fidelity. Macros are not executed.

## Remaining discrepancies and limits

The raw scores are preserved. `diagnostics.json` explains independently inspected differences:

- LibreOffice recalculates cached date/time and page fields, maps symbol characters differently, and can synthesize `numFmt="none"` numbering on headings. Core retains source values and bindings.
- All 442 normalized characters of the comment input responsible for the remaining 12 paragraph-anchor misses are recovered in order. The conversion splits its paragraphs differently.
- One deliberately damaged source accounts for the remaining 202 heading misses. Its malformed styles and garbled text are retained in the corpus; core does not invent LibreOffice's salvage assignments.
- Two table-span counts differ despite matching cell widths and the complete grid. Another nested-table anchor differs because the reference moves the first source cell out of the inner table.
- Remaining header/footer, hyperlink, formatting, text-box, and image-count differences remain visible in the full tables. They are not all established parser defects or all resolved. Image rendering and complete annotation/range metadata were not validated by this extraction benchmark.

Pre-Word-97 formats and password-encrypted documents remain unsupported. The six supported extensions and five MIME types are listed in [supported-word-formats.md](supported-word-formats.md). There is no claim of lossless binary round trips or standalone RTF/ODT/PDF support.

## Validation and receipts

The optimized benchmark build, WASM core check, all eight package type checks, 32 existing DOC-module checks, and 50 focused Rust integration tests pass. A source-derived round-trip check verifies all nine heading levels, including direct outline assignments, through model JSON and reconstructed OOXML. The full library unit-test target is blocked by the pre-existing missing `src/parse/root_plan_parity.rs`; the existing DOC tests were run through an isolated harness importing the actual module instead of removing that test declaration.

The run records binary/source/scorer hashes, manifest hash, versions, timing samples, and environment metadata. The final Rust source hashes match the timed build. No new repository unit tests were added. Changes are local and uncommitted.

Reproduce the comparison after `word_formats.py run` and `score`:

```sh
python3 scripts/parser-benchmark/word_formats_compare.py --baseline output/word-formats-expanded-20261102 --out output/word-formats-fixed-20261102
python3 scripts/parser-benchmark/word_formats.py report --out output/word-formats-fixed-20261102
```

The run reuses the baseline's immutable manifest and reference/oracle artifacts while keeping its executable and all four engines' outputs separate. Never run into a directory whose raw-output folders point to an older run.

Format interpretation follows Microsoft's [toggle operand](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/bc4ca98b-68ca-49dc-a091-1460e42d781e), [FIB table and list lengths](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/0c9df81f-98d0-454e-ad84-b612cd05b1a4), [list override data](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/1a3bc610-c07a-454e-876f-86534a50c33a), and [OfficeArt metafile header](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/ffdcc2b8-98fd-46b2-921e-6bb6693d05e5) definitions.
