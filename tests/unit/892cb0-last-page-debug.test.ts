import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "@extend-ai/react-docx-doc-model";
import { parseDocx } from "@extend-ai/react-docx-ooxml-core";
import { resolveDocumentLayout } from "../../packages/react-viewer/src/section-layout";
import {
  buildDocumentPageNodeSegments,
  buildDocumentPageNodeSegmentsFromLastRenderedPageBreakHints,
  resolveFooterPaginationReservePx,
  resolveHeaderPaginationReservePx,
} from "../../packages/react-viewer/src/editor";

const DOC_PATH =
  "/Users/andrewluo/Documents/DOCX testing/2026-04-03_14-19-35/892cb0f789df3367eb52748402d011e852009ea5adda25752c6557e24c8ea20d.docx";

function nodeSummary(node: { type: string; children?: Array<{ type: string; text?: string }> }) {
  if (node.type === "paragraph") {
    const text = (node.children ?? [])
      .filter((child) => child.type === "text")
      .map((child) => child.text ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    return `p: ${text || "(empty)"}`;
  }
  return node.type;
}

describe("892cb0 last page overflow debug", () => {
  it.skipIf(!existsSync(DOC_PATH))("analyzes pagination for last page overflow", async () => {
    const buffer = await readFile(DOC_PATH);
    const pkg = await parseDocx(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      )
    );
    const model = await buildDocModel(pkg);
    const layout = resolveDocumentLayout(model);
    const pageContentWidthPx =
      layout.pageWidthPx - layout.marginsPx.left - layout.marginsPx.right;
    const headerReservePx = resolveHeaderPaginationReservePx(
      model.metadata.headerSections ?? [],
      layout
    );
    const footerReservePx = resolveFooterPaginationReservePx(
      model.metadata.footerSections ?? [],
      layout
    );
    const pageContentHeightPx = Math.max(
      120,
      layout.pageHeightPx -
        layout.marginsPx.top -
        layout.marginsPx.bottom -
        headerReservePx -
        footerReservePx
    );
    const metrics = [
      {
        startNodeIndex: 0,
        pageContentWidthPx,
        pageContentHeightPx,
        pageContentHeightMultiplier: 1,
        docGridLinePitchPx: layout.docGridLinePitchPx,
      },
    ];
    const pagesDefault = buildDocumentPageNodeSegments(
      model,
      pageContentHeightPx,
      pageContentWidthPx,
      model.metadata.numberingDefinitions,
      metrics,
      { allowParagraphLineSplitting: true }
    );
    const pagesWithHints = buildDocumentPageNodeSegments(
      model,
      pageContentHeightPx,
      pageContentWidthPx,
      model.metadata.numberingDefinitions,
      metrics,
      {
        allowParagraphLineSplitting: true,
        preferLastRenderedParagraphStartBreaks: true,
      }
    );
    const pagesFromWordHints =
      buildDocumentPageNodeSegmentsFromLastRenderedPageBreakHints(model);
    const pages = pagesDefault;

    const lastPageIndex = pages.length - 1;
    const lastPageSegments = pages[lastPageIndex] ?? [];
    const lastPageNodeIndexes = lastPageSegments.map((segment) => segment.nodeIndex);
    expect(pagesFromWordHints.length).toBe(model.metadata.documentPageCount);
    expect(pages.length).toBeGreaterThanOrEqual(model.metadata.documentPageCount);
    expect(
      pagesFromWordHints[pagesFromWordHints.length - 1]?.[0]?.nodeIndex
    ).toBe(148);
    expect(
      pagesFromWordHints[pagesFromWordHints.length - 1]?.length ?? 0
    ).toBe(17);
  });
});
