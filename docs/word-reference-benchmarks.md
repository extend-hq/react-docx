# Microsoft Word reference benchmarks

The structured reference harness opens hash-verified copies in desktop Microsoft Word, captures its object-model output, and saves a Flat OPC package. Four native parsers then process the original bytes. Word reference generation and parser timing run in separate phases.

The report distinguishes three sources of evidence:

| Reference | Measurements | Limits |
| --- | --- | --- |
| Word object model | Main-story text, top-level table text, visible hyperlink text, and completed resolved bold/italic captures | Text normalization removes whitespace and control markers. Main-story text excludes textboxes. Hyperlink destinations are captured but not scored. |
| Word-saved Flat OPC | Headings, lists, stored spans, table/cell text, explicit formatting, textboxes, secondary stories, and image/equation counts | Uses the existing independent XML extractor on Word's saved output. It still depends on that extractor. Image and equation counts do not prove identity or rendering fidelity. |
| Original source package | Image occurrences matched to retained native payload hashes | Checks original bytes and placement multiplicity, independently of Word's saved image representations. It does not check crop, position, or pixels. |

Word is an application reference, not a proof of universal correctness. Opening a document can normalize or repair its structure. Fields, fonts, compatibility settings, and Word version can affect results. Visual fidelity requires a separate Word PDF/rendering comparison and adjudicated cases.

## Capture policy

The harness records Word version/build, operating system, exporter hashes, source hashes, and the capture policy. Original files are never saved by Word. Only disposable copies in the run's `staging` directory are opened, read-only, with macros force-disabled and external-link updates disabled. Revisions are accepted on the disposable copy so the reference represents the final revision view. Fields are not explicitly updated. The current Word text-retrieval behavior is recorded rather than assumed.

The staging directory is persistent because macOS Word requires file-access consent. Grant access only to that directory when Word requests it. An exclusive lock prevents two captures from using the same staging paths. Cleanup closes only the documents opened by the harness and restores the application settings it changed. Process and Word scripting timeouts, incomplete capture output, and failed document cleanup stop the run for desktop inspection before another input is opened. The optional formatting budget can still leave just formatting unscored after successful capture and cleanup.

Word's Mac scripting bridge can return zero for range-level hyperlink and inline-shape counts while document-level collections contain those objects. The exporter uses document-level collections and filters text hyperlinks to the main story. It also checks for empty native collections that conflict with nonempty Word-saved structure; those native metrics are withheld.

The whole-body text getter can return less text than the document contains. The exporter compares its paragraph breaks with Word's paragraph count and reads the complete paragraph collection on a mismatch. The original whole-range text is retained for diagnosis. This guards the observed truncation, but it does not establish that every Word text API or format is free of extraction defects.

Resolved formatting is optional and bounded per document. The default three-second budget applies only to native formatting capture. If capture exceeds the budget or cannot align every returned span to Word's body text, neither resolved bold nor resolved italic is scored for that document. Text and structural capture continue. `--formatting-budget 0` removes this limit. Partial spans never count as a complete reference, and every feature reports its scored-document coverage. This subset favors documents that Word can inspect quickly; it is not a representative full-corpus formatting score.

## Scoring

Body precision, recall, and F1 use the longest common subsequence of normalized main-story characters. Normalization uses NFC and removes whitespace, soft hyphens, zero-width spaces, the byte-order mark, and Word control markers. These scores do not measure whitespace fidelity or exact paragraph boundaries. The report pools character counts; saved records also retain per-document scores and exact-text checks.

Resolved formatting uses Word's resolved font values, including inherited formatting, and matches the flags at ordered literal paragraph offsets. A paragraph that cannot be aligned receives no formatting credit. Table and hyperlink checks use one-to-one normalized text anchors. The separately labeled literal table/span checks allow additional output characters and therefore measure content retention rather than exact table geometry.

A parser failure receives zero recall wherever a valid reference exists. A reference failure or an unavailable Word field is excluded and counted. A scoring or normalization failure remains a harness error rather than being relabeled as a parser failure. Zero-denominator metrics are displayed as absent or undefined, not as evidence of perfect recovery.

Latency uses the common set of successful inputs across all four parsers. The native runner measures warm parsing plus its native model/IR; the local parser also produces structured blocks. Input reads, process startup, output serialization, destruction, Word capture, and scoring are outside the timed region. Each sample averages an adaptive number of parses; preserve the repeat count and randomized job seed with the results. A development workstation is not an isolated performance lab.

## Running

Use an existing DOCX `format-manifest.json` and matching complete baseline output directory. Capture and retained-output rescoring can run together; fresh timing starts after both finish.

```sh
python3 scripts/parser-benchmark/word_structured.py prepare \
  --out output/word-reference \
  --manifest output/baseline/format-manifest.json \
  --binary output/baseline/bin/parser-benchmark

python3 scripts/parser-benchmark/word_structured.py capture \
  --out output/word-reference --site output/report/word-structured --timeout 600

python3 scripts/parser-benchmark/word_reference_benchmark.py retained \
  --out output/word-reference --baseline output/baseline \
  --site output/report/word-structured

cargo build --release --locked --manifest-path scripts/parser-benchmark/Cargo.toml --bin parser-benchmark

python3 scripts/parser-benchmark/word_reference_benchmark.py prepare-timing \
  --out output/word-reference --baseline output/baseline \
  --binary scripts/parser-benchmark/target/release/parser-benchmark

python3 scripts/parser-benchmark/word_reference_benchmark.py run \
  --out output/word-reference --baseline output/baseline \
  --site output/report/word-structured --repeats 5
```

The preparation step validates source identities and snapshots the selected executable. Timing preparation snapshots the freshly built binary and hashes the Rust sources and dependency manifests. The run refuses a mismatched binary, changed sources, or an incomplete reference cohort. Historical records retain `docx-core` as the engine identifier for the package now named `extend-docx`.

Capture can resume only from receipts matching the exporter and artifact hashes. A changed capture profile requires preparation again. Keep prior accepted reports and receipts; never relabel retained timings as a fresh run. The report identifies retained-output rescoring, partial fresh measurements, and completed fresh measurements separately.

Each successful capture retains compressed raw Word JSON, validated reference JSON, compressed Flat OPC, and a receipt. Fresh parser jobs retain timing samples, output hashes, normalized output, image-payload counts, and Word scores. Temporary full native output is removed after scoring to limit disk use. The generated corpus, Word exports, and document text stay under ignored `output/`; report JSON exposes aggregate scores and anonymous numeric timing points.

Run the focused reference tests with:

```sh
python3 -m unittest discover -s scripts/parser-benchmark -p 'test_word_*.py' -v
```

Before accepting a new Word version or exporter, also verify a controlled Word integration document containing inherited and explicit formatting, merged cells, a hyperlink, and an image. Unit tests cannot establish that the installed Word scripting bridge returns correct data.

## Measured sample, November 3, 2026

This comparison uses 25 documents from the beginning of the fixed DOCX manifest, with no filtering by scores. All four parsers succeeded on all 25 inputs. The run contains 100 fresh parser jobs with five warm timing samples each. It is a small sample and does not replace the earlier full-corpus measurements.

| Parser | Median ms | p95 ms | Word body recall | Word body F1 | Source image payload recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| extend-docx | 0.530 | 6.880 | 99.949% | 99.952% | 100.000% |
| docx-rs | 1.089 | 6.606 | 99.939% | 99.947% | 92.308% |
| office_oxide | 0.680 | 3.668 | 99.937% | 99.946% | 92.308% |
| undoc | 1.084 | 11.990 | 99.949% | 96.999% | 100.000% |

The local parser has the lowest median in this sample; office_oxide has the lowest p95. Image payload counts are 52/52 for extend-docx and undoc, and 48/52 for the other two parsers. These image scores use original source payloads, not Word rendering.

Direct table and hyperlink references are available for 24 documents. Native resolved-formatting capture completed for 10 documents under the three-second budget, so those formatting scores describe that subset only. Word-saved structural references and body-text references cover all 25 documents. Parser, scoring, and reference-error counts are zero; unavailable native fields retain their separate coverage counts.

The reference application was Microsoft Word 16.106.1, build 16.106.26021521. The native benchmark was built from revision `ea3bcc7c2d60f32f1bc8b4b6b5aee9be4033af78`; its SHA-256 is `797b5b22e10c632993b8162fd449f967ae5a90692bcb755828afe98c120cb212`. The report and private capture receipts are under `output/word-structured-20261103`; the live site uses its sanitized aggregate measurements.

## Interpreting the low exact-feature scores

The raw explicit-formatting metrics compare one reference feature per positively marked XML run against adapter output that coalesces adjacent formatted runs. Different run boundaries can therefore fail exact matching even when the same text has the same formatting. Inherited formatting also produces valid output spans absent from an explicit-only reference.

An offline character-position audit of the same 25 saved exports found that extend-docx retained all 19,437 explicitly bold characters and all 17,265 explicitly italic characters. This is positive-markup recall, not full resolved-formatting precision. It does not treat the absence of explicit markup as proof that text should be unformatted. Word-resolved precision and recall remain limited to the ten completed captures.

The same audit found identical header/footer paragraph multisets for extend-docx: the global ordered-text deficits were caused by different part ordering. This establishes content presence, not correct section placement. The five exact table-text mismatches retained all literal text and added symbol glyphs omitted by the XML extractor. All five unmatched textbox paragraphs also retain their literal text; extra output still needs separate evaluation.

The native hyperlink check has reference and adapter limitations. Of 31 unmatched extend-docx text anchors, 29 correspond to `PAGEREF` fields with the `\h` switch omitted by the captured hyperlink collection, one belongs to a textbox outside the reference story, and one combines adjacent links. Microsoft documents that [the `PAGEREF` hyperlink switch creates a link](https://support.microsoft.com/en-us/word/field-codes-pageref-field). Nested overlapping links also require an explicit effective-span policy. These findings do not establish corrected hyperlink precision: destinations and positions must be compared under the same rules for all four parsers.

Run the supplemental checks without opening Word or running the parsers again:

```sh
python3 scripts/parser-benchmark/word_metric_diagnostics.py \
  --out output/word-reference --site output/report/word-structured
python3 -m unittest discover -s scripts/parser-benchmark -p 'test_word_metric_diagnostics.py' -v
```

The audit verifies source, reference, export, and normalized-output hashes and retains the original benchmark unchanged. It publishes a separate `diagnostics.json`, bound to that benchmark's timestamp and executable identity. Unaligned or missing paragraphs receive no formatting credit. Supplemental header/footer presence ignores order while preserving multiplicity; textbox literal retention allows additional characters. Neither is a replacement for structural or precision checks.

Before interpreting the remaining deficits as parser bugs, strengthen the reference with resolved character flags, field-aware hyperlink targets and positions, symbol-aware text, and section/role-aware secondary stories. Then minimize confirmed failures into controlled regression cases and validate parser changes against every category's precision and recall plus matched median/p95 latency. Features absent from this sample, including equations and endnotes, still need a deliberately chosen small reference set; absence is not a perfect score.
