# extend-docx

[![crates.io version](https://img.shields.io/crates/v/extend-docx)](https://crates.io/crates/extend-docx)

Extend's native Rust parser, document model, and serializer, shared with the React viewer through WebAssembly. It accepts OOXML DOCX and Word 97–2003 binary DOC through the existing format adapter. No browser, Word installation, or network service is required for parsing.

## Installation

```sh
cargo add extend-docx
```

The Cargo package is `extend-docx`; the Rust import is `extend_docx`. The source lives in `crates/extend-docx` within [extend-hq/react-docx](https://github.com/extend-hq/react-docx/tree/extend-docx-v0.1.0/crates/extend-docx). Rust crate versions are independent of the `@extend-ai/react-docx` npm versions. The internal `docx-wasm` package provides the JavaScript bindings and is not published to crates.io.

Native builds enable `native-deflate` by default, using libdeflate for whole-buffer ZIP decompression and reusing its decoder across package entries. This requires a C compiler at build time. Disable default features to use the portable Rust decoder. WebAssembly always uses the Rust decoder. Both paths retain the same fallback for entries whose declared size cannot be used for bounded preallocation.

```toml
[dependencies]
extend-docx = { version = "0.1", default-features = false }
```

## Usage

```rust
let package = extend_docx::parse_document_bytes(&bytes)?;
let model = extend_docx::build_doc_model(&package);
let blocks = extend_docx::extract_document_blocks(&model);
let json = serde_json::to_string(&blocks)?;
```

`parse_document_blocks(&bytes)` combines these steps. `cargo run --example parse_blocks -- input.docx` writes the block JSON to standard output.

Word spans are optional:

```rust
let options = extend_docx::ExtractDocumentBlocksOptions { include_words: true };
let blocks = extend_docx::parse_document_blocks_with_options(&bytes, options)?;
```

Use `extract_document_blocks_with_options(&model, options)` for an existing model, or add `--include-words` to the CLI. The TypeScript equivalent is `extractDocumentBlocks(model, { includeWords: true })`. Existing calls omit word data.

Paragraph-derived blocks, including those in tables and auxiliary stories, then include `words`. Each word has an ID, its parent `blockId`, original `content`, and document-bound source references with UTF-16 `start`/`end` offsets into the paragraph block's content. Segmentation uses Unicode word boundaries and includes punctuation and symbols; whitespace-only segments are omitted. It is not dictionary-based linguistic segmentation. Styled run boundaries do not split a word, and capitalization formatting does not rewrite its source text. Word rectangles are resolved by the viewer after layout, just like block rectangles.

The versioned output uses Extend's 15 block type names. Each block retains document-bound source references; paragraphs retain styled inline content, tables retain cells and spans, and text boxes retain nested content. Header/footer stories, notes, comments, form controls, and equations are represented where supported by the parser. Image blocks expose their render payload through `details.imageUrl`, including SVG composites, charts, text boxes, and converted images. Existing `details.asset` values continue to identify source package parts. A data URI carries its payload with the block; external URLs remain references and are never fetched during extraction. If an imported model has image bytes but no nonblank URL, extraction encodes those bytes as a data URI. Empty payloads do not create an `imageUrl` field. Original image bytes remain available in the parsed package.

`document_source_graph(&package)` provides an optional namespace-aware tree of XML elements, attributes, text, and an asset manifest. Original XML and binary assets remain in `package`. XML byte ranges refer to the decoded UTF-8 strings. For legacy DOC, the graph describes the adapter's OOXML output; keep the original DOC bytes to preserve unsupported binary structures.

Page numbers and bounding boxes require layout. The native parser deliberately returns `geometryStatus: "requires_layout"`. Use the matching React viewer to resolve source references against rendered pages. Source identity is a SHA-256 digest of the sorted, decoded package parts and assets, independent of ZIP compression and entry order. It is not the digest of the original ZIP bytes. Keep the original upload digest separately. Imported source IDs are stable for the same package and parser version; reimport edited bytes as a new document version.

The source graph preserves structure beyond the semantic block model. This is not a promise of complete semantic extraction or Word-identical rendering. Imported HTML, subdocuments, embedded programs/objects, diagrams, and equation layout have explicit diagnostics where recognized. Unknown extension markup can be inspected in the source graph. Dynamic fields use imported values; they are not a general field calculation engine. Encrypted files and older binary formats are not covered by the Word 97–2003 adapter.

## Logical and physical table columns

Table-cell `gridSpan` and structured table `columnIndex`, `columnSpan`, and `columnCount` describe the logical OOXML grid. A fixed-layout table can retain distinct logical columns whose resolved physical boundaries coincide. Its model style then includes `collapsedGridColumns`, listing the zero-width logical intervals in `columnWidthsTwips`. These intervals are not independently drawable columns. Structured table details describe logical extraction and are not a replacement for the model's layout grid.

The matching React viewer projects marked tables to their positive-width physical columns before layout, border resolution, DOM spans, and resize measurement. Structural edits materialize that physical grid and invalidate the edited table's source cache and any containing table caches. Untouched export and supported text edits retain the original source grid. Source-less export projects to the physical grid without changing the logical input model.

Rust callers can use `table_grid::materialize_collapsed_table_grid` before structural edits. `table_grid::validate_collapsed_table_grids` checks the entire model, including nested tables, image content, and auxiliary stories. `serialize_docx` and the WASM serialization entry points call this validation and reject unsupported markers. The legacy infallible `model_to_document_xml` and `serialize_doc_model` APIs retain their return types; callers supplying external models must validate first. Unsupported style or border changes must materialize the marked grid before applying the change.

For fixed-layout tables with automatic table width, supported conflicting cell-width preferences resolve against shared logical columns. The bounded solver requires complete positive singleton anchors and explicit positive cell preferences, excludes vertical-merge continuation preferences, and preserves source spans. Tables outside those conditions retain the existing fallback; this does not claim universal Word layout equivalence.

## Shared formatting in the Rust model

Run, form-field, paragraph-mark, and imported provenance formatting use `SharedTextStyle`, which owns a fully resolved `TextStyle` through `Arc`. Cloning these values shares the formatting allocation. Mutable access copies it only when another model value still shares it, so editing a run cannot change another run or its imported provenance. The model remains transferable across threads.

This changes these Rust fields from `Option<TextStyle>` to `Option<SharedTextStyle>`. Convert an owned style with `.into()` when constructing a field, use `.as_deref()` to borrow a `TextStyle` from an optional field, or call `.into_owned()` to obtain an owned style. Standalone `parse_run_style` continues to return `Option<TextStyle>`.

Serde serializes the complete underlying formatting object transparently. JSON and TypeScript field shapes are unchanged, and style resolution finishes during parsing.

`ParagraphChildNode::Image` and `ParagraphChildNode::FormField` hold boxed payloads, keeping ordinary text slots small. Rust callers constructing these variants should wrap their payload with `Box::new`; borrowed field access continues through dereferencing. Serialization includes the complete payload with no additional wrapper.

See the repository's structured-block design document for the viewer contract, integration steps, validation evidence, and remaining coverage gaps.

## Third-party notices

The symbol-font Unicode mapping is derived from `dingbat-to-unicode` 1.0.1 by Michael Williamson, distributed under the BSD 2-Clause license. The complete notice is in `third-party/dingbat-to-unicode-LICENSE` and is included in the WASM and viewer distributions.

## Typed structured details in Rust

`DocumentBlock.details` uses `structured::BlockDetails`. Generated paragraph details are `BlockDetails::Paragraph(Box<ParagraphDetails>)`, with a typed `ParagraphInline` sequence and shared, fully resolved text styles. Text, classification, field instructions, inline ordering, UTF-16 offsets, and formatting are computed eagerly during extraction. This avoids constructing a second generic JSON tree for every paragraph and run; it does not defer semantic parsing or style resolution.

Serde writes the same JSON object shape, including explicit nulls in paragraph and inline fields. Rust callers can match `BlockDetails::Paragraph` to read or edit the typed data. Call `.to_json_value()` explicitly when a `serde_json::Value` view is needed; this performs serialization and allocation. There is no implicit indexing or lazy conversion. Existing arbitrary JSON details can be constructed with `BlockDetails::Raw(value)` or `value.into()`.

Deserializing `BlockDetails` stores `Raw(Value)` to retain unknown fields, including unknown nested inline or style fields. Re-serialization preserves that JSON data, and equality compares JSON values so generated and deserialized representations remain semantically comparable. The native extraction result is a typed model and structured representation; JSON encoding remains a separate explicit operation.

## Parser latency comparisons

Measured November 2, 2026 for the **optimized parser**, against **docx-rs 0.4.22**, **office_oxide 0.1.15**, and **undoc 0.27.1**. The measured source is commit `dcce836072cb01a24f6490c97643f825d2d6902e`. The `docx-core` labels in historical benchmark artifacts refer to this parser before its rename to `extend-docx`. The [npm release 0.13.0 results](https://github.com/extend-hq/react-docx/blob/extend-docx-v0.1.0/docs/benchmarks-0.13.0.md) remain available separately.

![Median and p95 native parser latency for DOCX, DOC, DOT, DOTX, DOCM, and DOTM](https://raw.githubusercontent.com/extend-hq/react-docx/extend-docx-v0.1.0/docs/readme-assets/docx-core-optimized-20261102-latency-overview.png)

These are native optimized parse and model/IR timings; extend-docx also includes structured-block projection. Each document has five warm samples, each averaging 1–20 parses. Charts use the common successful inputs for the parsers supporting each format. File reads, process startup, JSON serialization, destruction, and reference conversion are excluded. The p95 is across per-document medians, not request-level or browser latency. Measurements were taken on a shared development machine.

DOCX uses the separate seeded 1,000-input corpus. DOC and the template/macro formats pool the two multi-format cohorts. The additional 75 DOCX inputs are shown separately below because they became regressions after inspection and repair. Template and macro-enabled cohorts are small (2–12 inputs); these results do not establish universal performance.

Core has the lowest measured DOCX median (0.673 ms) and p95 (5.080 ms) in this run. Core remains slower than the other binary parsers on DOC; the two paths retain different amounts of structure. See the [full accuracy comparison and limitations](https://github.com/extend-hq/react-docx/blob/extend-docx-v0.1.0/docs/benchmarks-optimized-20261102.md) when interpreting speed: the parsers retain different amounts of structure, and text F1 does not measure visual layout.

Each format chart includes the cumulative latency distribution and latency against input bytes, parsed paragraph count, and feature occurrences. Complexity counts use the core result for the same document across every parser. The axes use logarithmic scales so small and large documents remain visible.

<details>
<summary>DOCX — seeded corpus: latency distribution and complexity</summary>

![DOCX — seeded corpus native latency distribution and complexity comparisons](https://raw.githubusercontent.com/extend-hq/react-docx/extend-docx-v0.1.0/docs/readme-assets/docx-core-optimized-20261102-latency-docx.png)

</details>

<details>
<summary>DOC: latency distribution and complexity</summary>

![DOC native latency distribution and complexity comparisons](https://raw.githubusercontent.com/extend-hq/react-docx/extend-docx-v0.1.0/docs/readme-assets/docx-core-optimized-20261102-latency-doc.png)

</details>

<details>
<summary>DOT: latency distribution and complexity</summary>

![DOT native latency distribution and complexity comparisons](https://raw.githubusercontent.com/extend-hq/react-docx/extend-docx-v0.1.0/docs/readme-assets/docx-core-optimized-20261102-latency-dot.png)

</details>

<details>
<summary>DOTX: latency distribution and complexity</summary>

![DOTX native latency distribution and complexity comparisons](https://raw.githubusercontent.com/extend-hq/react-docx/extend-docx-v0.1.0/docs/readme-assets/docx-core-optimized-20261102-latency-dotx.png)

</details>

<details>
<summary>DOCM: latency distribution and complexity</summary>

![DOCM native latency distribution and complexity comparisons](https://raw.githubusercontent.com/extend-hq/react-docx/extend-docx-v0.1.0/docs/readme-assets/docx-core-optimized-20261102-latency-docm.png)

</details>

<details>
<summary>DOTM: latency distribution and complexity</summary>

![DOTM native latency distribution and complexity comparisons](https://raw.githubusercontent.com/extend-hq/react-docx/extend-docx-v0.1.0/docs/readme-assets/docx-core-optimized-20261102-latency-dotm.png)

</details>

<details>
<summary>DOCX — additional regression cohort: latency distribution and complexity</summary>

![DOCX — additional regression cohort native latency distribution and complexity comparisons](https://raw.githubusercontent.com/extend-hq/react-docx/extend-docx-v0.1.0/docs/readme-assets/docx-core-optimized-20261102-latency-docx-regressions.png)

</details>

The [summary](https://github.com/extend-hq/react-docx/blob/extend-docx-v0.1.0/crates/extend-docx/benchmarks/optimized-20261102/latency.json) and [chart data](https://github.com/extend-hq/react-docx/blob/extend-docx-v0.1.0/crates/extend-docx/benchmarks/optimized-20261102/latency.csv) contain timings and numeric complexity measurements, with no document names or parsed content. Regenerate the figures with [readme_charts.py](https://github.com/extend-hq/react-docx/blob/extend-docx-v0.1.0/scripts/parser-benchmark/readme_charts.py) and the retained optimized benchmark runs and the label, asset-prefix, and measured-commit options.

## Regression inputs

The public suite uses generated inputs and inline XML. Run `cargo test --workspace --locked` from the repository root. To smoke-test a local corpus explicitly, set `DOCX_TEST_CORPUS` to a directory containing DOC or DOCX inputs and run `cargo test -p extend-docx --test doc_fixture -- --ignored`. Corpus documents and diagnostic outputs stay local and are not distributed with the package.
