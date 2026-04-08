import type {
  DocModel,
  HeadingLevel,
  ParagraphAlignment,
  TextStyle
} from "@react-docx/doc-model";
import {
  layoutDocument,
  type LayoutOptions,
  type LayoutPage,
  type LayoutParagraphBlock,
  type LayoutRun,
  type LayoutTableBlock
} from "@react-docx/layout-engine";
export * from "./pagination";
export * from "./page-segmentation";

const DEFAULT_LAYOUT_OPTIONS: Required<LayoutOptions> = {
  pageWidth: 816,
  pageHeight: 1056,
  margin: 72,
  minLineHeight: 22,
  paragraphSpacing: 8,
  tableCellPadding: 8
};

export type LayoutSnapshotOptions = LayoutOptions;

export interface LayoutSnapshotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutSnapshotPageSize {
  width: number;
  height: number;
}

export interface LayoutSnapshotMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ResolvedLayoutMetrics {
  pageSizePx: LayoutSnapshotPageSize;
  marginsPx: LayoutSnapshotMargins;
  contentBoxPx: LayoutSnapshotRect;
}

export interface ResolvedDocumentSection {
  index: number;
  startNodeIndex: number;
  synthetic: boolean;
  layout: ResolvedLayoutMetrics;
}

export interface ResolvedDocument {
  source: "layout-engine-adapter";
  nodeCount: number;
  pageCountHint?: number;
  layout: ResolvedLayoutMetrics;
  sections: ResolvedDocumentSection[];
  metadata: {
    sourceParts: number;
    warningCount: number;
    warnings: string[];
    headerSectionCount: number;
    footerSectionCount: number;
  };
}

export interface LayoutFragmentSource {
  kind: "paragraph" | "table" | "table-cell" | "table-cell-paragraph";
  nodeIndex: number;
  rowIndex?: number;
  cellIndex?: number;
  paragraphIndex?: number;
}

export interface LayoutSnapshotTextRun {
  kind: "text";
  id: string;
  text: string;
  style?: TextStyle;
  link?: string;
}

export interface LayoutSnapshotImageRun {
  kind: "image";
  id: string;
  src?: string;
  alt?: string;
  widthPx?: number;
  heightPx?: number;
  floating?: boolean;
}

export type LayoutSnapshotRun = LayoutSnapshotTextRun | LayoutSnapshotImageRun;

export interface LayoutSnapshotParagraphFragment {
  kind: "paragraph";
  id: string;
  framePx: LayoutSnapshotRect;
  align: ParagraphAlignment;
  headingLevel?: HeadingLevel;
  runs: LayoutSnapshotRun[];
  source?: LayoutFragmentSource;
}

export interface LayoutSnapshotTableCellFragment {
  id: string;
  colSpan?: number;
  backgroundColor?: string;
  paragraphs: LayoutSnapshotParagraphFragment[];
  source?: LayoutFragmentSource;
}

export interface LayoutSnapshotTableRowFragment {
  id: string;
  backgroundColor?: string;
  cells: LayoutSnapshotTableCellFragment[];
}

export interface LayoutSnapshotTableFragment {
  kind: "table";
  id: string;
  framePx: LayoutSnapshotRect;
  rows: LayoutSnapshotTableRowFragment[];
  source?: LayoutFragmentSource;
}

export type LayoutSnapshotBlockFragment =
  | LayoutSnapshotParagraphFragment
  | LayoutSnapshotTableFragment;

export interface LayoutSnapshotPage {
  index: number;
  number: number;
  pageSizePx: LayoutSnapshotPageSize;
  marginsPx: LayoutSnapshotMargins;
  contentBoxPx: LayoutSnapshotRect;
  blocks: LayoutSnapshotBlockFragment[];
}

export interface LayoutSnapshot {
  version: 1;
  source: "layout-engine-adapter";
  resolvedDocument: ResolvedDocument;
  pages: LayoutSnapshotPage[];
}

function normalizeLayoutOptions(options: LayoutSnapshotOptions = {}): Required<LayoutOptions> {
  return {
    ...DEFAULT_LAYOUT_OPTIONS,
    ...options
  };
}

function createResolvedLayoutMetrics(
  options: Required<LayoutOptions>
): ResolvedLayoutMetrics {
  const marginPx = Math.max(0, Math.round(options.margin));
  const pageWidthPx = Math.max(1, Math.round(options.pageWidth));
  const pageHeightPx = Math.max(1, Math.round(options.pageHeight));
  return {
    pageSizePx: {
      width: pageWidthPx,
      height: pageHeightPx
    },
    marginsPx: {
      top: marginPx,
      right: marginPx,
      bottom: marginPx,
      left: marginPx
    },
    contentBoxPx: {
      x: marginPx,
      y: marginPx,
      width: Math.max(0, pageWidthPx - marginPx * 2),
      height: Math.max(0, pageHeightPx - marginPx * 2)
    }
  };
}

function resolveSections(
  model: DocModel,
  layout: ResolvedLayoutMetrics
): ResolvedDocumentSection[] {
  const sections = model.metadata.sections ?? [];
  if (sections.length === 0) {
    return [
      {
        index: 0,
        startNodeIndex: 0,
        synthetic: true,
        layout
      }
    ];
  }

  return sections.map((section, index) => ({
    index,
    startNodeIndex: section.startNodeIndex,
    synthetic: false,
    layout
  }));
}

export function resolveDocumentForLayout(
  model: DocModel,
  options: LayoutSnapshotOptions = {}
): ResolvedDocument {
  const normalizedOptions = normalizeLayoutOptions(options);
  const layout = createResolvedLayoutMetrics(normalizedOptions);

  return {
    source: "layout-engine-adapter",
    nodeCount: model.nodes.length,
    pageCountHint: model.metadata.documentPageCount,
    layout,
    sections: resolveSections(model, layout),
    metadata: {
      sourceParts: model.metadata.sourceParts,
      warningCount: model.metadata.warnings.length,
      warnings: [...model.metadata.warnings],
      headerSectionCount: model.metadata.headerSections.length,
      footerSectionCount: model.metadata.footerSections.length
    }
  };
}

function legacyBlockSource(id: string): LayoutFragmentSource | undefined {
  const paragraphMatch = /^paragraph-(\d+)$/.exec(id);
  if (paragraphMatch) {
    return {
      kind: "paragraph",
      nodeIndex: Number.parseInt(paragraphMatch[1], 10)
    };
  }

  const tableMatch = /^table-(\d+)$/.exec(id);
  if (tableMatch) {
    return {
      kind: "table",
      nodeIndex: Number.parseInt(tableMatch[1], 10)
    };
  }

  return undefined;
}

function snapshotRectFromLegacyBlock(
  block: Pick<LayoutParagraphBlock | LayoutTableBlock, "x" | "y" | "width" | "height">
): LayoutSnapshotRect {
  return {
    x: block.x,
    y: block.y,
    width: block.width,
    height: block.height
  };
}

function snapshotRunFromLegacyRun(run: LayoutRun): LayoutSnapshotRun {
  if (run.kind === "image") {
    return {
      kind: "image",
      id: run.id,
      src: run.src,
      alt: run.alt,
      widthPx: run.widthPx,
      heightPx: run.heightPx,
      floating: run.floating
    };
  }

  return {
    kind: "text",
    id: run.id,
    text: run.text,
    style: run.style,
    link: run.link
  };
}

function snapshotParagraphFromLegacyBlock(
  block: LayoutParagraphBlock,
  source?: LayoutFragmentSource
): LayoutSnapshotParagraphFragment {
  return {
    kind: "paragraph",
    id: block.id,
    framePx: snapshotRectFromLegacyBlock(block),
    align: block.align,
    headingLevel: block.headingLevel,
    runs: block.runs.map(snapshotRunFromLegacyRun),
    source
  };
}

function snapshotTableFromLegacyBlock(block: LayoutTableBlock): LayoutSnapshotTableFragment {
  const tableSource = legacyBlockSource(block.id);

  return {
    kind: "table",
    id: block.id,
    framePx: snapshotRectFromLegacyBlock(block),
    rows: block.rows.map((row, rowIndex) => ({
      id: row.id,
      backgroundColor: row.backgroundColor,
      cells: row.cells.map((cell, cellIndex) => ({
        id: cell.id,
        colSpan: cell.colSpan,
        backgroundColor: cell.backgroundColor,
        paragraphs: cell.paragraphs.map((paragraph, paragraphIndex) =>
          snapshotParagraphFromLegacyBlock(paragraph, {
            kind: "table-cell-paragraph",
            nodeIndex: tableSource?.nodeIndex ?? -1,
            rowIndex,
            cellIndex,
            paragraphIndex
          })
        ),
        source:
          tableSource !== undefined
            ? {
                kind: "table-cell",
                nodeIndex: tableSource.nodeIndex,
                rowIndex,
                cellIndex
              }
            : undefined
      }))
    })),
    source: tableSource
  };
}

function snapshotBlockFromLegacyBlock(
  block: LayoutParagraphBlock | LayoutTableBlock
): LayoutSnapshotBlockFragment {
  if (block.kind === "table") {
    return snapshotTableFromLegacyBlock(block);
  }

  return snapshotParagraphFromLegacyBlock(block, legacyBlockSource(block.id));
}

function snapshotPageFromLegacyPage(
  page: LayoutPage,
  index: number,
  layout: ResolvedLayoutMetrics
): LayoutSnapshotPage {
  return {
    index,
    number: page.number,
    pageSizePx: layout.pageSizePx,
    marginsPx: layout.marginsPx,
    contentBoxPx: layout.contentBoxPx,
    blocks: page.blocks.map(snapshotBlockFromLegacyBlock)
  };
}

export function buildLayoutSnapshot(
  model: DocModel,
  options: LayoutSnapshotOptions = {}
): LayoutSnapshot {
  const resolvedDocument = resolveDocumentForLayout(model, options);
  const legacyPages = layoutDocument(model, options);

  return {
    version: 1,
    source: "layout-engine-adapter",
    resolvedDocument,
    pages: legacyPages.map((page, index) =>
      snapshotPageFromLegacyPage(page, index, resolvedDocument.layout)
    )
  };
}
