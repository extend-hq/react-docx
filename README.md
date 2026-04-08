# react-docx

Monorepo scaffold for building a DOCX parser, model, layout engine, React viewer, and serializer.

## Workspace

- `packages/ooxml-core`: ZIP/XML ingestion and OOXML part graph.
- `packages/doc-model`: Internal normalized document model.
- `packages/layout-engine`: Pagination and block layout.
- `packages/editor-ops`: Editing commands over document model.
- `packages/serializer`: Model to OOXML serialization.
- `packages/react-viewer`: React components/hooks for rendering.
- `apps/playground`: Local app for manual QA.
- `tests/unit`: Unit and round-trip tests.
- `tests/visual`: Playwright visual regression tests.

## Quick start

```bash
pnpm install
pnpm dev
```

## Build and tests

```bash
pnpm build
pnpm test:unit
pnpm test:visual
```

## Publish flow

```bash
pnpm changeset
pnpm version-packages
pnpm build
pnpm publish-packages
```
