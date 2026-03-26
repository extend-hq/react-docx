import type {
  DocModel,
  FormFieldRunNode,
  HeadingLevel,
  ParagraphAlignment,
  ParagraphNode,
  TableCellContentNode,
  TableNode,
  TextStyle
} from "@react-docx/doc-model";

export interface LayoutOptions {
  pageWidth?: number;
  pageHeight?: number;
  margin?: number;
  minLineHeight?: number;
  paragraphSpacing?: number;
  tableCellPadding?: number;
}

export interface LayoutTextRun {
  kind: "text";
  id: string;
  text: string;
  style?: TextStyle;
  link?: string;
}

export interface LayoutImageRun {
  kind: "image";
  id: string;
  src?: string;
  alt?: string;
  widthPx?: number;
  heightPx?: number;
  contentType?: string;
  data?: Uint8Array;
  floating?: boolean;
}

export type LayoutRun = LayoutTextRun | LayoutImageRun;

export interface LayoutParagraphBlock {
  kind: "paragraph";
  id: string;
  runs: LayoutRun[];
  align: ParagraphAlignment;
  headingLevel?: HeadingLevel;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutTableCell {
  id: string;
  colSpan?: number;
  backgroundColor?: string;
  paragraphs: LayoutParagraphBlock[];
}

export interface LayoutTableRow {
  id: string;
  backgroundColor?: string;
  cells: LayoutTableCell[];
}

export interface LayoutTableBlock {
  kind: "table";
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rows: LayoutTableRow[];
}

export type LayoutBlock = LayoutParagraphBlock | LayoutTableBlock;

export interface LayoutPage {
  number: number;
  blocks: LayoutBlock[];
}

const DEFAULT_OPTIONS: Required<LayoutOptions> = {
  pageWidth: 816,
  pageHeight: 1056,
  margin: 72,
  minLineHeight: 22,
  paragraphSpacing: 8,
  tableCellPadding: 8
};

function headingScale(level?: HeadingLevel): number {
  if (!level) {
    return 1;
  }

  switch (level) {
    case 1:
      return 2.15;
    case 2:
      return 1.75;
    case 3:
      return 1.45;
    case 4:
      return 1.28;
    case 5:
      return 1.15;
    case 6:
      return 1.05;
    default:
      return 1;
  }
}

function runHeightPx(run: LayoutRun): number {
  if (run.kind === "image") {
    if (run.floating) {
      return 0;
    }
    return run.heightPx ?? 96;
  }

  const fontSizePt = run.style?.fontSizePt ?? 12;
  return Math.round(fontSizePt * 1.6);
}

function lineHeightFromRuns(
  runs: LayoutRun[],
  minLineHeight: number,
  headingLevel?: HeadingLevel
): number {
  const base =
    runs.reduce((largest, run) => {
      return Math.max(largest, runHeightPx(run));
    }, 12) * headingScale(headingLevel);

  return Math.max(minLineHeight, Math.round(base));
}

function spacingForBlock(baseSpacing: number, headingLevel?: HeadingLevel): number {
  if (!headingLevel) {
    return baseSpacing;
  }
  return baseSpacing + Math.max(4, (7 - headingLevel) * 2);
}

function formFieldDisplayText(field: FormFieldRunNode): string {
  switch (field.fieldType) {
    case "checkbox":
      return field.checked ? field.checkedSymbol ?? "☒" : field.uncheckedSymbol ?? "☐";
    case "dropdown":
    case "date":
    case "text":
    default:
      return field.value ?? "";
  }
}

function paragraphToLayout(
  paragraph: ParagraphNode,
  idPrefix: string,
  x: number,
  y: number,
  width: number,
  minLineHeight: number
): LayoutParagraphBlock {
  const runs: LayoutRun[] = paragraph.children.map((child, runIndex) => {
    if (child.type === "text") {
      return {
        kind: "text",
        id: `${idPrefix}-run-${runIndex}`,
        text: child.text,
        style: child.style,
        link: child.link
      };
    }

    if (child.type === "form-field") {
      return {
        kind: "text",
        id: `${idPrefix}-run-${runIndex}`,
        text: formFieldDisplayText(child),
        style: child.style,
        link: child.link
      };
    }

    return {
      kind: "image",
      id: `${idPrefix}-run-${runIndex}`,
      src: child.src,
      alt: child.alt,
      widthPx: child.widthPx,
      heightPx: child.heightPx,
      contentType: child.contentType,
      data: child.data ? new Uint8Array(child.data) : undefined,
      floating: Boolean(child.floating)
    };
  });

  return {
    kind: "paragraph",
    id: idPrefix,
    runs,
    align: paragraph.style?.align ?? "left",
    headingLevel: paragraph.style?.headingLevel,
    x,
    y,
    width,
    height: lineHeightFromRuns(runs, minLineHeight, paragraph.style?.headingLevel)
  };
}

function paragraphsForTableCellNodes(nodes: TableCellContentNode[]): ParagraphNode[] {
  const paragraphs: ParagraphNode[] = [];

  const walk = (items: typeof nodes): void => {
    for (const item of items) {
      if (item.type === "paragraph") {
        paragraphs.push(item);
        continue;
      }

      for (const row of item.rows) {
        for (const cell of row.cells) {
          walk(cell.nodes);
        }
      }
    }
  };

  walk(nodes);
  return paragraphs;
}

function tableToLayout(
  table: TableNode,
  idPrefix: string,
  x: number,
  y: number,
  width: number,
  options: Required<LayoutOptions>
): LayoutTableBlock {
  const columnCount = Math.max(
    1,
    ...table.rows.map((row) =>
      row.cells.reduce(
        (sum, cell) => sum + (cell.style?.gridSpan && cell.style.gridSpan > 1 ? cell.style.gridSpan : 1),
        0
      )
    )
  );
  const baseCellWidth = width / columnCount;
  let tableHeight = 0;

  const rows: LayoutTableRow[] = table.rows.map((row, rowIndex) => {
    let rowHeight = options.minLineHeight + options.tableCellPadding * 2;
    let columnCursor = 0;

    const cells: LayoutTableCell[] = row.cells.map((cell, cellIndex) => {
      const colSpan = cell.style?.gridSpan && cell.style.gridSpan > 1 ? cell.style.gridSpan : 1;
      const cellWidth = baseCellWidth * colSpan;
      const cellParagraphs = paragraphsForTableCellNodes(cell.nodes);

      const paragraphBlocks = cellParagraphs.map((paragraph, paragraphIndex) =>
        paragraphToLayout(
          paragraph,
          `${idPrefix}-r${rowIndex}-c${cellIndex}-p${paragraphIndex}`,
          x + columnCursor * baseCellWidth,
          y,
          cellWidth,
          options.minLineHeight
        )
      );

      const paragraphsHeight = paragraphBlocks.reduce((sum, block) => sum + block.height, 0);
      rowHeight = Math.max(rowHeight, paragraphsHeight + options.tableCellPadding * 2);
      columnCursor += colSpan;

      return {
        id: `${idPrefix}-r${rowIndex}-c${cellIndex}`,
        colSpan,
        backgroundColor: cell.style?.backgroundColor ?? row.style?.backgroundColor,
        paragraphs: paragraphBlocks
      };
    });

    tableHeight += rowHeight;

    return {
      id: `${idPrefix}-row-${rowIndex}`,
      backgroundColor: row.style?.backgroundColor,
      cells
    };
  });

  return {
    kind: "table",
    id: idPrefix,
    x,
    y,
    width,
    height: Math.max(tableHeight, options.minLineHeight * 2),
    rows
  };
}

function estimateBlockHeight(block: LayoutBlock): number {
  if (block.kind === "paragraph") {
    return block.height;
  }
  return block.height;
}

export function layoutDocument(model: DocModel, options: LayoutOptions = {}): LayoutPage[] {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const pages: LayoutPage[] = [{ number: 1, blocks: [] }];
  const contentWidth = resolved.pageWidth - resolved.margin * 2;
  const pageBottom = resolved.pageHeight - resolved.margin;
  let cursorY = resolved.margin;

  for (const [index, node] of model.nodes.entries()) {
    const block =
      node.type === "paragraph"
        ? paragraphToLayout(
            node,
            `paragraph-${index}`,
            resolved.margin,
            cursorY,
            contentWidth,
            resolved.minLineHeight
          )
        : tableToLayout(node, `table-${index}`, resolved.margin, cursorY, contentWidth, resolved);

    const blockHeight = estimateBlockHeight(block);
    const currentPage = pages[pages.length - 1];

    if (cursorY + blockHeight > pageBottom && currentPage.blocks.length > 0) {
      pages.push({
        number: pages.length + 1,
        blocks: []
      });
      cursorY = resolved.margin;

      if (block.kind === "paragraph") {
        block.y = cursorY;
      } else {
        block.y = cursorY;
      }
    }

    pages[pages.length - 1].blocks.push(block);
    cursorY += blockHeight + (block.kind === "paragraph" ? spacingForBlock(resolved.paragraphSpacing, block.headingLevel) : resolved.paragraphSpacing + 10);
  }

  return pages;
}
