# @extend-ai/react-docx

## 0.10.0

### Minor Changes

- 027a119: Deprecate ReactDocxViewer and ReactDocxViewerProps while preserving their
  existing API and behavior. Recommend useDocxEditor with DocxEditorViewer in
  read-only mode for document previews.

  Carry per-line ascent, descent, and height through pagination, fragment rendering,
  selection, and hit testing. Preserve fractional text measurements and character
  spacing, use explicit inline-object widths, and share widow/orphan constraints
  between page and column splits. Keep leading words intact across styled-run
  boundaries when they can fit on the next line.

  Honor document default tab stops and preserve compatibility mode and header
  settings through import, cloning, and export. Keep tab offsets aligned with
  editable text and correct Chromium's fractional font advance measurements.

  Apply fixed and minimum line spacing to mixed runs, account for table row
  restrictions and cell clipping, and make table sizing independent of host CSS.

  Preserve tagged table and cell widths, table alignment, and bidi settings through
  import, cloning, and export. Resolve legacy width edits and restore inherited
  formatting when direct overrides are cleared. Use the correct text region for
  header/footer tables and invalidate cached geometry after width edits. Retain
  fractional fixed-table widths, resolve cell spans and skipped row columns, and
  allow explicitly sized fixed tables to overflow their containing region.

  Keep column insertion, deletion, and rectangular cell selection aligned with
  the physical table grid, and retain keyboard focus for table deletion. Preserve
  named table styles during export, direct versus inherited text alignment when
  changing paragraph styles, and line-spacing compatibility settings.

  Preserve paragraph-mark formatting and its revision metadata through import,
  cloning, editing, and export. Give newly split paragraphs fresh ending ownership
  and preserve the surviving ending during merges. Use effective empty-paragraph
  mark formatting for line measurement, paint, and editable caret geometry,
  including header and footer flow. Recompute empty mark inheritance after a
  paragraph style change while preserving explicit mark formatting.
  Retain fractional paragraph and table border widths,
  use black for automatic document text, and stabilize editing state during
  selection, undo/redo, and composition.

  Measure browser line struts and fragment baselines consistently at viewer and
  ancestor CSS zoom, invalidate metrics when the rendering profile changes, and
  correct caret and word selection through the wrapped editing route.

  Use planned line geometry for eligible whole text paragraphs and direct table
  cells, including mixed formatting, in both read-only and editable views. Include text, formatting, font
  revision, and document layout settings in bounded cell-layout caches. Preserve
  editing focus when switching between planned and native text rendering, and
  split direct table-cell paragraphs with independent ending ownership.
  Preserve read-only dragging and copying, capture the active input range for
  toolbar formatting and text context-menu commands, and clear prior cell/object
  selections when entering text. Keep Cut and undo synchronized with the active
  text input.

  Refresh cached page thumbnails when font metrics change, including after a font
  loads without changing the document's text or page count.

  Measure mixed-font rows from their participating runs and use the same heights
  for whole paragraphs, page slices and table-cell flow. Preserve fractional line
  positions and apply document-grid minimums consistently around wrapped objects.
  Keep words together across formatting boundaries, with emergency wrapping for
  words wider than a fresh line.

  Preserve manual line breaks, trailing empty rows and original CRLF source offsets
  through painting, selection, copying, typing, deletion and undo/redo. Keep typing
  focus and selection when a font-size change reflows an active paragraph.
  Preserve selected run formatting during text replacement and give paginated
  paragraphs one editing input, with source offsets and selection direction retained
  across page slices.

  Preserve explicit zero table and cell margins when regenerating document XML,
  so export and reimport retain their override of inherited spacing.

  Preserve fractional section page dimensions, margins and header/footer distances
  through ordinary pagination and virtual page spacing. Resolve explicit mixed
  page/local drawing anchors against the owning page at the current viewer zoom,
  and prevent body paragraph indentation from leaking into live textbox text.

  Stop oscillating measurement feedback from exhausting React's update limit on
  imported documents, and honor explicit page dimensions when the print-orientation
  flag disagrees with them. Apply table run formatting before paragraph, character,
  and direct formatting, while keeping nested tables independent. Preserve separate
  Latin and complex-script font sizes through import, layout, painting, editing,
  and export.

- 16d5b91: Add deterministic Word-reference and edit-roundtrip gates, conservative
  lossless OOXML text/table edits, per-script font resolution, atomic editor
  transactions, and safe comment plus tracked-revision editing APIs.

### Patch Changes

- 9bf0b1c: Render main and header/footer textbox stories from legacy Word `.doc` files,
  including anchored positioning, wrapping, blank-line spacing, fields, and
  nested images. Surface adapter warnings when malformed textbox data is skipped.

## 0.7.0

### Minor Changes

- Ship DOCX parsing and serialization through a Rust/WebAssembly runtime that lazy-loads the bundled `docx_wasm_bg.wasm` asset on first use, keeping the binary out of the JavaScript bundle.
- Add WASM loading controls with `setWasmSource` and `initWasm` so consumers can host the binary from a custom URL/CDN or prewarm the module before opening a document.
- Expose the bundled WASM binary as a package asset for bundlers that prefer explicit URL imports, while preserving Node, SSR, test, and script loading from disk.
- Move viewer/editor DOCX import work into a browser worker when available, with a main-thread fallback for unsupported environments.

## 0.7.0-alpha.5

### Patch Changes

- Remove leftover DOCX table-layout and section-group debug logging from the published viewer bundle.
- Move DOCX parse and document-model construction for viewer/editor imports into a browser worker when available, with main-thread fallback for unsupported environments.
- Fix TOC pagination estimates for right-tab dot leaders so right tab stops are not treated as leading title indentation.
- Allow `pageVirtualization` to receive an explicit scroll element and zoom scale so custom scroll-area shells keep low-zoom page virtualization in sync.
- Keep the detached thumbnail renderer warm between offscreen page renders, and expose `minRasterIntervalMs` plus `renderWindow` thumbnail priority/prefetch options.
- Render DOCX thumbnails from lazy layout/model snapshots by default, avoiding hidden page mounts and DOM serialization for virtualized thumbnail rails.

## 0.7.0-alpha.4

### Patch Changes

- The bundled WebAssembly binary now requires WebAssembly SIMD (Chrome 91+, Firefox 89+, Safari 16.4+, Node 16.4+). `initWasm` reports a descriptive error on runtimes without it.
- Binary assets cross the wasm boundary as `Uint8Array` instead of `number[]` inside JSON, making import/export of image-heavy documents several times faster. `WasmOoxmlPackage.binaryAssets` is now `Record<string, Uint8Array>`; the previous shape is still accepted on input and exported as `LegacyWasmOoxmlPackage`.
- Fixed page virtualization at zoom levels below 100%: page-size estimates are re-measured when the effective zoom changes, so the trailing pages render after fast scrolls instead of staying blank. Large-table documents now pre-render the next page in the scroll direction rather than the one behind it.

## 0.6.4

### Patch Changes

- 76f0ded: Remove bundled internal workspace packages from the published package manifest.

## 0.5.0

### Minor Changes

- Expose DOCX page thumbnails with XLSX-style `paint` and `paintThumbnail` helpers, thumbnail size aliases, and `resolution` bounds compatibility.

## 0.4.0

### Minor Changes

- Remove the viewer's `emf-converter` dependency, keep TIFF-to-PNG conversion, and fall back to explicit EMF/WMF placeholder badges when raw metafiles reach the browser render path.

## 0.3.0

### Minor Changes

- Add page thumbnails, document background controls, night-reader improvements, and refreshed top-level docs.
