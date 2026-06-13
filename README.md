# react-docx

`react-docx` is a React-first DOCX viewer and editor built as a monorepo.

The main package is [`@extend-ai/react-docx`](./packages/react-viewer), which gives you:

- A simple read-only viewer for rendering `.docx` files or prebuilt document models
- A richer editor/controller API for building custom DOCX editing UIs
- Pagination, page layout, theme, tracked-change, form-field, and thumbnail hooks
- Configurable page surface and inter-page background colors
- A dark read-only night-reader mode that inverts document content while preserving image hues
- Lower-level OOXML, model, layout, and serialization exports for custom pipelines

## What To Install

For application code, you usually want the main package:

```bash
pnpm add @extend-ai/react-docx react react-dom
```

`react` and `react-dom` are peer dependencies.

## Main Entry Points

The public package exports two useful levels of API:

1. `ReactDocxViewer`
   A lightweight read-only viewer when you just want to render a document.

2. `useDocxEditor` + `DocxEditorViewer`
   The full controller/view split for editable or highly customized experiences.

It also re-exports the internal document/model/layout/serializer packages, so you can work below the UI layer when needed.

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
- The built-in dark page surface uses Tailwind `neutral-950` by default.
- In read-only dark document mode, the viewer uses an inversion-based night reader path so document content inverts cleanly while images keep their hues.

## Workspace Layout

- `packages/react-viewer`: the main published React package, `@extend-ai/react-docx`
- `packages/ooxml-core`: OOXML package parsing and part graph handling
- `packages/doc-model`: normalized document model
- `packages/editor-ops`: document editing operations
- `packages/layout-engine`: pagination and layout
- `packages/layout-core`: layout helpers and snapshot-oriented utilities
- `packages/serializer`: model-to-DOCX serialization
- `apps/playground`: local playground for manual QA and feature development
- `tests/unit`: unit coverage
- `tests/visual`: visual regression coverage

## Local Development

Install dependencies:

```bash
pnpm install
```

Run the playground:

```bash
pnpm dev
```

Build all packages:

```bash
pnpm build
```

Typecheck packages and the playground:

```bash
pnpm typecheck
```

Run unit tests:

```bash
pnpm test:unit
```

Run visual tests:

```bash
pnpm test:visual
```

Run the DOCX-vs-LibreOffice comparison flow:

```bash
pnpm test:docx-vs-libreoffice
```

## Publishing

Changesets are used for release management:

```bash
pnpm changeset
pnpm version-packages
pnpm build
pnpm publish-packages
```
