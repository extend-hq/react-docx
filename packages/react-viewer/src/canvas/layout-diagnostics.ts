import type { DocModel } from "@extend-ai/react-docx-doc-model";
import {
  layoutDocument,
  type LayoutImageRun,
  type LayoutOptions,
  type LayoutParagraphBlock,
  type LayoutTableBlock
} from "@extend-ai/react-docx-layout-engine";
import { resolveDocumentLayout, type DocumentLayoutMetrics } from "../section-layout";
import type { DocxFormFieldLocation } from "../editor";
import type {
  DocxLayoutDiagnostics,
  DocxLayoutLineGeometry,
  DocxLayoutObjectGeometry
} from "./types";

function parseTopLevelNodeIndexFromLayoutId(id: string): number | undefined {
  const match = id.match(/^(?:paragraph|table)-(\d+)$/);
  if (!match?.[1]) {
    return undefined;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function estimateTextWidthPx(text: string, fontSizePt = 11): number {
  const px = fontSizePt * 1.333333333;
  const averageCharWidth = px * 0.52;
  return Math.max(0, Math.round(text.length * averageCharWidth));
}

function createParagraphLineGeometry(
  block: LayoutParagraphBlock,
  pageWidth: number
): DocxLayoutLineGeometry[] {
  const joinedText = block.runs
    .map((run) => (run.kind === "text" ? run.text : " "))
    .join("");

  const normalized = joinedText.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [
      {
        id: `${block.id}-line-0`,
        text: "",
        x: block.x,
        y: block.y,
        width: block.width,
        height: block.height
      }
    ];
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let currentLine = "";
  const maxWidth = Math.max(16, Math.min(block.width, pageWidth - block.x));

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    const candidateWidth = estimateTextWidthPx(candidate);

    if (candidateWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
      continue;
    }

    currentLine = candidate;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  const lineHeight = lines.length > 0 ? Math.max(12, Math.round(block.height / lines.length)) : block.height;

  return lines.map((line, lineIndex) => {
    const lineWidth = Math.min(maxWidth, estimateTextWidthPx(line));
    return {
      id: `${block.id}-line-${lineIndex}`,
      text: line,
      x: block.x,
      y: block.y + lineHeight * lineIndex,
      width: lineWidth,
      height: lineHeight
    };
  });
}

function paragraphObjectGeometry(
  block: LayoutParagraphBlock,
  pageIndex: number,
  pageWidth: number
): DocxLayoutObjectGeometry {
  return {
    id: block.id,
    kind: "paragraph",
    page: pageIndex,
    x: block.x,
    y: block.y,
    width: block.width,
    height: block.height,
    nodeIndex: parseTopLevelNodeIndexFromLayoutId(block.id),
    lines: createParagraphLineGeometry(block, pageWidth)
  };
}

function fieldLocation(block: LayoutParagraphBlock, childIndex: number): DocxFormFieldLocation | undefined {
  const paragraph = block.id.match(/^paragraph-(\d+)$/);
  if (paragraph) {
    return { kind: "paragraph", nodeIndex: Number(paragraph[1]), childIndex };
  }
  const cell = block.id.match(/^table-(\d+)-r(\d+)-c(\d+)-p(\d+)$/);
  if (!cell || block.formFieldParagraphIndex === -1) return undefined;
  return {
    kind: "table-cell",
    tableIndex: Number(cell[1]),
    rowIndex: Number(cell[2]),
    cellIndex: Number(cell[3]),
    paragraphIndex: block.formFieldParagraphIndex ?? Number(cell[4]),
    childIndex
  };
}

function floatingFrame(
  image: LayoutImageRun,
  block: LayoutParagraphBlock,
  cursorX: number,
  cursorY: number,
  width: number,
  height: number,
  pageWidth: number,
  pageHeight: number,
  margins: DocumentLayoutMetrics["marginsPx"]
): { x: number; y: number } {
  const position = image.floatingPosition;
  if (!position) return { x: cursorX, y: cursorY };
  const horizontal = position.horizontalRelativeTo?.toLowerCase();
  const vertical = position.verticalRelativeTo?.toLowerCase();
  const horizontalStart = horizontal === "page" ? 0
    : horizontal === "margin" ? margins.left
    : horizontal === "character" ? cursorX : block.x;
  const horizontalExtent = horizontal === "page" ? pageWidth
    : horizontal === "margin" ? pageWidth - margins.left - margins.right
    : horizontal === "character" ? 0 : block.width;
  const verticalStart = vertical === "page" ? 0
    : vertical === "margin" ? margins.top
    : vertical === "line" ? cursorY : block.y;
  const verticalExtent = vertical === "page" ? pageHeight
    : vertical === "margin" ? pageHeight - margins.top - margins.bottom : block.height;
  const horizontalAlignment = position.horizontalAlign;
  const verticalAlignment = position.verticalAlign;
  const alignedX = horizontalAlignment === "center" ? (horizontalExtent - width) / 2
    : horizontalAlignment === "right" || horizontalAlignment === "outside" ? horizontalExtent - width : 0;
  const alignedY = verticalAlignment === "center" ? (verticalExtent - height) / 2
    : verticalAlignment === "bottom" || verticalAlignment === "outside" ? verticalExtent - height : 0;
  return {
    x: horizontalStart + (horizontalAlignment ? alignedX : position.xPx ?? 0),
    y: verticalStart + (verticalAlignment ? alignedY : position.yPx ?? 0)
  };
}

function paragraphObjects(
  block: LayoutParagraphBlock,
  pageIndex: number,
  pageWidth: number,
  pageHeight: number,
  margins: DocumentLayoutMetrics["marginsPx"]
): DocxLayoutObjectGeometry[] {
  if (!block.runs.some((run) => run.formField)) {
    return [paragraphObjectGeometry(block, pageIndex, pageWidth)];
  }
  const lines: DocxLayoutLineGeometry[] = [];
  const fields: DocxLayoutObjectGeometry[] = [];
  let x = block.x;
  let y = block.y;
  let lineHeight = Math.max(22, block.height);
  const right = block.x + block.width;
  const nextLine = (): void => {
    x = block.x;
    y += lineHeight;
    lineHeight = 22;
  };
  for (const run of block.runs) {
    if (run.formField) {
      const fontSizePx = (run.formField.style?.fontSizePt ?? 12) * 96 / 72;
      const width = run.kind === "image" ? run.widthPx ?? fontSizePx
        : Math.max(fontSizePx, estimateTextWidthPx(run.text, fontSizePx * 72 / 96));
      const height = run.kind === "image" ? run.heightPx ?? fontSizePx : fontSizePx;
      const floating = run.kind === "image" && run.floatingPosition;
      if (!floating && x > block.x && x + width > right) nextLine();
      const frame = run.kind === "image"
        ? floatingFrame(run, block, x, y, width, height, pageWidth, pageHeight, margins)
        : { x, y };
      fields.push({
        id: run.id,
        kind: "form-field",
        page: pageIndex,
        x: frame.x,
        y: frame.y,
        width,
        height,
        image: run.kind === "image" ? run : undefined,
        formField: run.formField,
        formFieldLocation: fieldLocation(block, run.formField.childIndex)
      });
      if (!floating) {
        x += width;
        lineHeight = Math.max(lineHeight, height);
      } else if (floating.wrapType === "topAndBottom" && !floating.behindDocument) {
        x = block.x;
        y = Math.max(y, frame.y + height + (floating.distBPx ?? 0));
      } else if (["square", "tight", "through"].includes(floating.wrapType ?? "")
        && !floating.behindDocument && frame.y < y + lineHeight && frame.y + height > y
        && frame.x <= x && frame.x + width > x) {
        x = frame.x + width + (floating.distRPx ?? 0);
        if (x >= right) {
          x = block.x;
          y = frame.y + height + (floating.distBPx ?? 0);
        }
      }
      continue;
    }
    if (run.kind !== "text") {
      if (!run.floating) x += run.widthPx ?? 96;
      continue;
    }
    const fontSizePt = run.style?.fontSizePt ?? 11;
    const fontSizePx = fontSizePt * 96 / 72;
    for (const token of run.text.match(/\S+|\s+/g) ?? []) {
      const width = estimateTextWidthPx(token, fontSizePt);
      if (token.includes("\n")) {
        for (let index = 0; index < token.split("\n").length - 1; index += 1) nextLine();
        continue;
      }
      if (x > block.x && x + width > right) nextLine();
      lines.push({
        id: `${run.id}-segment-${lines.length}`,
        text: token,
        x,
        y,
        width,
        height: fontSizePx,
        fontSizePx
      });
      x += width;
      lineHeight = Math.max(lineHeight, fontSizePx);
    }
  }
  return [{
    ...paragraphObjectGeometry(block, pageIndex, pageWidth),
    height: Math.max(block.height, y + lineHeight - block.y),
    lines
  }, ...fields];
}

function tableObjectGeometry(
  block: LayoutTableBlock,
  pageIndex: number
): DocxLayoutObjectGeometry {
  return {
    id: block.id,
    kind: "table",
    page: pageIndex,
    x: block.x,
    y: block.y,
    width: block.width,
    height: block.height,
    nodeIndex: parseTopLevelNodeIndexFromLayoutId(block.id)
  };
}

export function buildDocxLayoutDiagnostics(
  model: DocModel,
  options: LayoutOptions = {}
): DocxLayoutDiagnostics {
  const documentLayout = resolveDocumentLayout(model);
  const resolvedOptions: LayoutOptions = {
    ...options,
    pageWidth: options.pageWidth ?? documentLayout.pageWidthPx,
    pageHeight: options.pageHeight ?? documentLayout.pageHeightPx
  };
  const layoutPages = layoutDocument(model, resolvedOptions);
  const pageWidth = resolvedOptions.pageWidth ?? documentLayout.pageWidthPx;
  const pageHeight = resolvedOptions.pageHeight ?? documentLayout.pageHeightPx;

  return {
    generatedAt: Date.now(),
    sourceLayoutPages: layoutPages,
    pages: layoutPages.map((page, pageIndex) => {
      const objects = page.blocks.flatMap((block) => {
        if (block.kind === "paragraph") {
          return paragraphObjects(block, pageIndex, pageWidth, pageHeight, documentLayout.marginsPx);
        }
        const result = [tableObjectGeometry(block, pageIndex)];
        let rowY = block.y;
        for (const row of block.rows) {
          let rowHeight = 22;
          for (const cell of row.cells) {
            let paragraphY = rowY + (resolvedOptions.tableCellPadding ?? 8);
            for (const paragraph of cell.paragraphs) {
              if (paragraph.runs.some((run) => run.formField)) {
                result.push(...paragraphObjects(
                  { ...paragraph, y: paragraphY }, pageIndex, pageWidth, pageHeight, documentLayout.marginsPx
                ));
              }
              paragraphY += paragraph.height;
            }
            rowHeight = Math.max(rowHeight, paragraphY - rowY + (resolvedOptions.tableCellPadding ?? 8));
          }
          rowY += rowHeight;
        }
        return result;
      });

      return {
        page: page.number,
        width: pageWidth,
        height: pageHeight,
        objects
      };
    })
  };
}
