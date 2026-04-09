import type { DocModel } from "@extend-ai/react-docx-doc-model";
import {
  layoutDocument,
  type LayoutOptions,
  type LayoutParagraphBlock,
  type LayoutTableBlock
} from "@extend-ai/react-docx-layout-engine";
import { resolveDocumentLayout } from "../section-layout";
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
      const objects = page.blocks.map((block) =>
        block.kind === "paragraph"
          ? paragraphObjectGeometry(block, pageIndex, pageWidth)
          : tableObjectGeometry(block, pageIndex)
      );

      return {
        page: page.number,
        width: pageWidth,
        height: pageHeight,
        objects
      };
    })
  };
}
