# Changelog

## 0.2.0

- Export native classic, 3D, and extended charts as SVG figures, including region maps drawn from the document’s cached geography. Retain the chart’s data and source attribution.

## 0.1.5

- Expose native chart series and indexed data points, preserving stored values and sparse categories.

## 0.1.4

- Return stored comment timestamps from legacy binary Word documents.

## 0.1.3

- Add opt-in typed revision extraction with source block references and UTF-16 text ranges.
- Preserve authors and timestamps on tracked text insertions and deletions from binary Word documents.

## 0.1.2

- Preserve ellipse outlines in DrawingML shape images.

## 0.1.1

- Expand the package overview with native latency, scatter plots, feature recall, and Microsoft Word reference comparisons.
- Use the published `extend-docx` name throughout benchmark charts and tables.
- Publish aggregate precision, recall, and coverage with links to measurement methods and limitations.

The parser implementation is unchanged from 0.1.0. Benchmark measurements retain their original dates and measured revisions.

## 0.1.0

Initial crates.io release of Extend's shared Rust parser, previously named `docx-core` within the repository.

- Publish the Cargo package as `extend-docx`, imported as `extend_docx`.
- Parse DOCX and Word 97–2003 binary DOC into a shared document model and structured blocks.
- Preserve source references and support DOCX serialization through the shared model.
- Support native Rust and WebAssembly, with optional native ZIP decompression enabled by default on native builds.

Page geometry requires the viewer's layout engine. Rust versions are independent of the React viewer's npm versions.
