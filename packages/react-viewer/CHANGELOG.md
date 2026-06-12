# @extend-ai/react-docx

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
