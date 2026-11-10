# @extend-ai/react-docx

## 0.14.10

### Patch Changes

- Keep focus in the editor when selecting across paragraphs so Space and typed characters replace the selection instead of scrolling the page. Restore the caret before the next keystroke after replacing or deleting selected text.

## 0.14.9

### Patch Changes

- Update the bundled Rust DOCX parser and WASM bindings to 0.2.20, retaining logical drop-cap paragraphs and including faster parsing, deterministic style resolution, and support for document models larger than the JavaScript string limit. Legacy imports containing multiple image formats may receive new document and block IDs because generated media content types now have a stable order.

## 0.14.8

### Patch Changes

- Build the font metric profile cache key with an explicit null-separated join so production minification preserves its separators.

## 0.14.7

### Patch Changes

- Fix `getDocxBytes()` failing with `RuntimeError: unreachable` when a document contains an image part of about 64 MiB or more (#42). Saving now passes the editor model to the Rust DOCX/WASM 0.2.16 object API, which keeps image bytes out of the model JSON: a 67 MB image now saves in about 0.4 s using about 400 MiB of WebAssembly memory instead of exhausting it. Saved archives now compress XML and uncompressed media such as BMP; already-compressed images such as PNG and JPEG are stored as-is. Also picks up rust-office-art 0.1.5 and rust-office-charts 0.1.7.

## 0.14.6

### Patch Changes

- Upgrade to Pretext 1.0.0 for paragraph-wide line breaking while preserving document typography and source ranges, paint selected discretionary hyphens, and use consistent line measurements for indents and supported wrapped left tabs. Adopt upstream parser corrections for legacy cell padding, footer story boundaries, and uncached page-number fields, preserve explicit zero page-number starts, and allow initial rendering to settle when merged table fragments cannot provide reusable whole-row measurements.

## 0.14.4

- Use the aligned Rust DOCX/WASM 0.2.9 release with shared OfficeArt pictures, shapes, connectors and saved SmartArt drawings.
- Preserve cached diagram labels and independent text frames, drawing spacing, pattern placement and supported WordArt text effects.
- Expose original 3D model assets through the opt-in `include3dModels` parser option while retaining saved previews.
- Improve tracked-review presentation and preserve the source editor for review actions.

## 0.14.2

- Use the Rust Office crates by Extend and refresh the bundled WebAssembly.

## 0.14.1

- Use the published Rust Office parser to include visible heading numbers and list markers in structured paragraph details.

## 0.14.0

### Minor Changes

- Render native classic, 3D, and extended Word charts, including filled maps with embedded boundaries, numeric and categorical color scales, legends, and source attribution.

## 0.13.6

### Patch Changes

- Render native bubble charts from indexed coordinates and sizes, and preserve the chart frame when series have no cached observations.

## 0.13.5

### Patch Changes

- Update the bundled WebAssembly parser to `rust-docx` 0.1.5. Imported charts now retain their source part name in the document model. Legacy Word imports preserve stored comment timestamps and the authors and timestamps of tracked text edits.

## 0.13.4

### Patch Changes

- Preserve fixed picture crops, ellipse outlines, and the positioning of overlapping Word drawings.

## 0.13.3

### Patch Changes

- Include visible list markers in paragraph bounding boxes across review modes and keep generated numbering out of word offsets.

## 0.13.2

### Patch Changes

- Preserve the editing hook context when rendering floating text boxes. Expose comment ranges and their target block IDs through the React and vanilla entry points.

## 0.13.1

### Patch Changes

- eaf0f26: Reduce legacy Word import overhead by moving compound-file streams into the parser, reusing decoded text and formatting data, and appending XML directly into output buffers. Preserve the generated package, parsed model, and structured-block representation.

  Use immutable native cache snapshots with thread-local regex readers and a bounded update actor. Skip optional cache admission when its mailbox is full, while preserving complete parsing results.

- fa27e2e: Resolve plain tab stops from the current visual line after wrapping, and preserve tab indentation when an unbroken run exceeds the remaining line width. Apply the layout consistently in editing, read-only, and markup views.

## 0.13.0

### Minor Changes

- 55737c0: Add `getDocxBytes()` to the editor controller. It resolves to the current document as DOCX bytes, the same bytes `exportDocx()` downloads, so an app can save the edited document without a browser download.

### Patch Changes

- 9ae335a: Improve legacy Word parsing for compound streams, fields, phonetic text, comments, symbols, lists, tables, and images. Accept DOC, DOT, DOCX, DOTX, DOCM, and DOTM consistently in file import and drag-and-drop, with download names matching the retained OOXML package family.

  Preserve inline and grouped VML artwork, editable text-box stories, cropped bitmap fills, and heading levels 1–9 across parsing and export. Retain the current editor state and pending image edits when obtaining document bytes.

## 0.12.2

### Patch Changes

- 09c5400: Align body-table row resize handles with rendered row borders when pagination measurements are disabled. Refresh handle positions as rows resize or text reflows, and account for viewer zoom during row resizing.

## 0.12.1

### Patch Changes

- 4001188: Keep table row resize handles on the row borders of compact rows, so clicks in table cells place the caret instead of resizing the rows.

## 0.12.0

### Minor Changes

- a9ecee6: Add a vanilla JavaScript viewer entry with a bundled Preact renderer, an imperative controller API, and a standalone playground demo. Improve wrapped-text editing and dark read-only document contrast.

## 0.11.3

### Patch Changes

- Enable context menus in read-only mode with Copy and custom renderers while blocking editing commands and preserving native text selection.

## 0.11.2

### Patch Changes

- Serialize justified paragraphs with the correct OOXML alignment value.

## 0.11.1

### Patch Changes

- 4e76349: Extend the text selection across paragraphs with Shift+ArrowUp/Down.

## 0.11.0

### Minor Changes

- Add structured document blocks, stable source references, source inspection, and browser layout geometry for document and word citations. Preserve image occurrence order, inline field ranges, capitalization, symbols, and mathematical content through parsing and rendering.

  Improve Word pagination fidelity for section numbering and blank pages, paragraph spacing, table grids and repeated headers, floating-image wrap distances, and mixed-script text. Recover layout failures caused by unsupported text cursors and unstable paragraph measurements.

  Support Shift-click text selection across paragraphs and refine editing, text-box rendering, and structured-block previews. Expand Word parity validation with another 1,000 distinct documents; remaining count and page-boundary differences are documented in the parity report.

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
