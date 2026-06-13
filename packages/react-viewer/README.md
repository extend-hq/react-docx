# @extend-ai/react-docx

React-first DOCX viewing and editing components for rendering `.docx` files in a browser.

`@extend-ai/react-docx` gives you:

- A simple read-only viewer for rendering `.docx` files or prebuilt document models
- A richer editor/controller API for building custom DOCX editing UIs
- Pagination, page layout, theme, tracked-change, form-field, and thumbnail hooks
- Configurable page surface and inter-page background colors
- A dark read-only night-reader mode that inverts document content while preserving image hues
- Lower-level OOXML, model, layout, and serialization exports for custom pipelines

## Install

```bash
pnpm add @extend-ai/react-docx react react-dom
```

`react` and `react-dom` are peer dependencies.

## WebAssembly Asset

DOCX parsing and serialization run in a Rust/WebAssembly module that ships inside this package as `dist/docx_wasm_bg.wasm` (~2.5 MB raw, ~1 MB over the wire with gzip). It is **not** part of the JavaScript bundle:

- It loads lazily, on the first call that parses or serializes a document.
- The loader references it as `new URL("./docx_wasm_bg.wasm", import.meta.url)`, which Vite, webpack 5, Rollup, and Next.js automatically emit as a hashed static asset — no configuration needed.
- In Node (SSR, tests, scripts) the binary is read from `node_modules` on disk.

If you need to host the binary somewhere else (e.g. a CDN), override the source before the first parse:

```ts
import { setWasmSource } from "@extend-ai/react-docx";

setWasmSource("https://cdn.example.com/docx_wasm_bg.wasm");
// or pass a URL, Response, ArrayBuffer/TypedArray, or compiled WebAssembly.Module
```

The binary is also exposed as a package subpath, so with Vite you can do:

```ts
import wasmUrl from "@extend-ai/react-docx/docx_wasm_bg.wasm?url";
import { setWasmSource } from "@extend-ai/react-docx";

setWasmSource(wasmUrl);
```

You can also call `initWasm()` (optionally with a source) ahead of time to warm the module before the first document is opened.

## Main Entry Points

The package exports two useful levels of API:

1. `ReactDocxViewer`
   A lightweight read-only viewer when you just want to render a document.

2. `useDocxEditor` + `DocxEditorViewer`
   The full controller/view split for editable or highly customized experiences.

It also re-exports lower-level document/model/layout/serializer APIs, so you can work below the UI layer when needed.

## Quick Start

### Read-only viewer

Use `ReactDocxViewer` when you want the smallest integration surface.

```tsx
import * as React from "react";
import { ReactDocxViewer } from "@extend-ai/react-docx";

export function ReadOnlyDocxExample() {
  const [file, setFile] = React.useState<ArrayBuffer | undefined>();

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <input
        type="file"
        accept=".docx"
        onChange={async (event) => {
          const nextFile = event.target.files?.[0];
          setFile(nextFile ? await nextFile.arrayBuffer() : undefined);
        }}
      />

      <ReactDocxViewer
        file={file}
        emptyState="Choose a DOCX file to preview."
      />
    </div>
  );
}
```

You can also pass a `model` instead of a raw `.docx` file if you already have a normalized document model.

### Full editor/viewer

Use `useDocxEditor` when you want import/export controls, document theme state, selection-aware editing commands, pagination state, and a customizable document canvas.

```tsx
import * as React from "react";
import {
  DocxEditorViewer,
  useDocxDocumentTheme,
  useDocxEditor,
  useDocxPagination,
} from "@extend-ai/react-docx";

export function EditorExample() {
  const editor = useDocxEditor({
    initialDocumentTheme: "light",
    initialStatus: "Ready",
  });

  const { documentTheme, toggleDocumentTheme } = useDocxDocumentTheme(editor);
  const { pagination } = useDocxPagination(editor);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="file"
          accept=".docx"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void editor.importDocxFile(file);
            }
          }}
        />

        <button type="button" onClick={() => editor.exportDocx()}>
          Export DOCX
        </button>

        <button type="button" onClick={() => toggleDocumentTheme()}>
          Theme: {documentTheme}
        </button>

        <span>
          Page {pagination.currentPage} / {pagination.totalPages}
        </span>

        <span>{editor.status}</span>
      </div>

      <DocxEditorViewer
        editor={editor}
        mode="edit"
        pageBackgroundColor="#ffffff"
        pageGapBackgroundColor="transparent"
      />
    </div>
  );
}
```

## Thumbnail Hook

The library can expose page thumbnails so you can build your own page strip, mini-map, or navigation UI. Thumbnail painting can render from the live page surface when it is mounted, or from an offscreen one-page surface when viewer virtualization has unmounted that page.

```tsx
import * as React from "react";
import {
  DocxEditorViewer,
  useDocxEditor,
  useDocxPageThumbnails,
} from "@extend-ai/react-docx";

export function ThumbnailExample() {
  const editor = useDocxEditor();
  const { thumbnails } = useDocxPageThumbnails(editor, {
    maxWidthPx: 160,
    maxHeightPx: 220,
    pixelRatio: 2,
    minRasterIntervalMs: 40,
    renderWindow: {
      visiblePageIndexes: [0, 1, 2],
      prefetchPageIndexes: [3, 4, 5],
    },
  });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 16 }}>
      <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
        {thumbnails.map((thumbnail) => (
          <canvas
            key={thumbnail.pageIndex}
            ref={thumbnail.canvasRef}
            width={thumbnail.pixelWidthPx}
            height={thumbnail.pixelHeightPx}
            style={{
              width: thumbnail.widthPx,
              height: thumbnail.heightPx,
              border: "1px solid #ddd",
            }}
          />
        ))}
      </div>

      <DocxEditorViewer editor={editor} />
    </div>
  );
}
```

Notes:

- Thumbnail canvases can stay attached in a virtualized sidebar; only canvases you mount request paint work.
- Use `renderWindow.visiblePageIndexes` for thumbnails currently visible in your sidebar, and `renderWindow.prefetchPageIndexes` to warm nearby pages after visible work.
- `minRasterIntervalMs` controls repeat renders for the same canvas. Lower values are useful when the consumer already limits thumbnail work to a small visible window.
- Thumbnail sizing is bounded by `maxWidthPx` and `maxHeightPx`, so downstream UIs can bias toward portrait thumbnail rails.
- Thumbnails use a direct layout/model canvas renderer first; if a page has no usable snapshot, the hook falls back to an isolated offscreen page surface.

## Useful Hooks

`@extend-ai/react-docx` exports several hooks for wiring custom UI around the viewer:

- `useDocxDocumentTheme(editor)` for light/dark document mode
- `useDocxPagination(editor)` for current page and total page count
- `useDocxPageLayout(editor)` for page size, margins, columns, and viewport defaults
- `useDocxPageThumbnails(editor, options)` for rendering page previews into your own canvases
- `useDocxParagraphStyles(editor)` for available paragraph styles and style selection
- `useDocxLineSpacing(editor)` for selected line spacing state
- `useDocxBorders(editor)` for paragraph/table border presets
- `useDocxFormFields(editor)` for DOCX form-field state and updates
- `useDocxTrackChanges(editor)` for tracked-change UI state
- `useDocxImageWrapMenu(editor)` for image wrapping controls

## Lower-level APIs

The package also re-exports the lower-level internals used by the viewer:

- OOXML parsing from `@extend-ai/react-docx-ooxml-core`
- Document model helpers from `@extend-ai/react-docx-doc-model`
- Editing operations from `@extend-ai/react-docx-editor-ops`
- Layout primitives from `@extend-ai/react-docx-layout-engine`
- Layout/core snapshot helpers from `@extend-ai/react-docx-layout-core`
- DOCX serialization from `@extend-ai/react-docx-serializer`

This means you can build your own pipeline, for example:

```ts
import {
  buildDocModel,
  parseDocx,
  serializeDocx,
} from "@extend-ai/react-docx";

const pkg = await parseDocx(arrayBuffer);
const model = buildDocModel(pkg);
const output = serializeDocx(model, pkg);
```

## Viewer Notes

- `DocxEditorViewer` supports `mode="edit"` and `mode="read-only"`.
- `pageBackgroundColor` controls the page surface color.
- `pageGapBackgroundColor` controls the area between pages and defaults to transparent.
- In read-only dark document mode, the viewer uses an inversion-based night reader path so document content inverts cleanly while images keep their hues.

## License

See the repository license for usage terms.
