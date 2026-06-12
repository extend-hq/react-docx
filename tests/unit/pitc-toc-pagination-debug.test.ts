import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "@extend-ai/react-docx-doc-model";
import { parseDocx } from "@extend-ai/react-docx-ooxml-core";
import { resolveDocumentLayout } from "../../packages/react-viewer/src/section-layout";
import {
  buildDocumentPageNodeSegments,
  buildParagraphNumberingLabels,
  estimateParagraphLineHeightPx,
  estimateTableRowHeightsPx,
  paragraphLineCountWithinWidth,
  resolveFooterPaginationReservePx,
  resolveHeaderPaginationReservePx,
} from "../../packages/react-viewer/src/editor";
import {
  paragraphAfterSpacingPx,
  paragraphBeforeSpacingPx,
} from "../../packages/layout-core/src/pagination";

const DOC_PATH =
  "/Users/andrewluo/Documents/DOCX testing/PITC0008189 - RFT Attachment C - Response Schedule.docx";

type ModelNode = Awaited<ReturnType<typeof buildDocModel>>["nodes"][number];

function nodeSummary(node: ModelNode): string {
  if (node.type === "paragraph") {
    const text = (node.children ?? [])
      .filter((child) => child.type === "text")
      .map((child) => ("text" in child ? child.text ?? "" : ""))
      .join("")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    return `p[${node.style?.styleId ?? "-"}]: ${text || "(empty)"}`;
  }
  if (node.type === "table") {
    return `table (${node.rows.length} rows)`;
  }
  return node.type;
}

describe("PITC0008189 ToC pagination debug", () => {
  it.skipIf(!existsSync(DOC_PATH))("prints pagination diagnostics", async () => {
    const buffer = await readFile(DOC_PATH);
    const pkg = await parseDocx(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
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

    console.log({
      pageContentWidthPx,
      pageContentHeightPx,
      headerReservePx,
      footerReservePx,
      nodeCount: model.nodes.length,
      storedDocumentPageCount: model.metadata.documentPageCount,
    });

    const numberingLabels = buildParagraphNumberingLabels(model);
    const estimatedNodeHeightPx = (node: ModelNode, nodeIndex: number): number => {
      if (node.type === "paragraph") {
        const label = numberingLabels.get(`p:${nodeIndex}`);
        const lines = paragraphLineCountWithinWidth(
          node,
          pageContentWidthPx,
          model.metadata.numberingDefinitions,
          label
        );
        const lineHeightPx = estimateParagraphLineHeightPx(
          node,
          layout.docGridLinePitchPx
        );
        return (
          paragraphBeforeSpacingPx(node) +
          lines * lineHeightPx +
          paragraphAfterSpacingPx(node)
        );
      }
      if (node.type === "table") {
        return estimateTableRowHeightsPx(
          node,
          pageContentWidthPx,
          model.metadata.numberingDefinitions,
          layout.docGridLinePitchPx,
          pageContentHeightPx
        ).reduce((sum, heightPx) => sum + heightPx, 0);
      }
      return 0;
    };

    const pages = buildDocumentPageNodeSegments(
      model,
      pageContentHeightPx,
      pageContentWidthPx,
      model.metadata.numberingDefinitions,
      [
        {
          startNodeIndex: 0,
          pageContentWidthPx,
          pageContentHeightPx,
          pageContentHeightMultiplier: 1,
          docGridLinePitchPx: layout.docGridLinePitchPx,
        },
      ],
      {
        allowParagraphLineSplitting: true,
        suppressSpacingBeforeAfterPageBreak:
          model.metadata.compatibility?.suppressSpacingBeforeAfterPageBreak ===
          true,
        preferLastRenderedParagraphStartBreaks: true,
        strictLastRenderedParagraphStartBreaks: false,
      }
    );

    console.log(`=== engine pages: ${pages.length} ===`);
    pages.slice(0, 4).forEach((pageSegments, pageIndex) => {
      let pageEstimatedHeightPx = 0;
      console.log(`-- page ${pageIndex + 1} (${pageSegments.length} segments)`);
      pageSegments.forEach((segment) => {
        const node = model.nodes[segment.nodeIndex];
        const heightPx = node
          ? estimatedNodeHeightPx(node, segment.nodeIndex)
          : 0;
        const lineRange = segment.paragraphLineRange
          ? ` lines[${segment.paragraphLineRange.startLineIndex}..${segment.paragraphLineRange.endLineIndex}]`
          : "";
        pageEstimatedHeightPx += heightPx;
        console.log(
          `   node ${segment.nodeIndex}${lineRange} h~${Math.round(heightPx)}px ${node ? nodeSummary(node) : "(missing)"}`
        );
      });
      console.log(
        `   page ${pageIndex + 1} total ~${Math.round(pageEstimatedHeightPx)}px (budget ${Math.round(pageContentHeightPx)}px)`
      );
    });

    expect(pages.length).toBeGreaterThan(0);

    // Word/LibreOffice render this document as 23 pages: page 1 is the cover
    // (spacer paragraphs with the floating title text box overlaid — the
    // wrapNone box consumes no flow height), and page 2 holds the entire ToC.
    // Previously the title box's height was charged as flow, breaking page 1
    // early and splitting the ToC across pages 2-3.
    expect(pages.length).toBe(23);
    const tocEntryNodeIndexes = model.nodes
      .map((node, nodeIndex) => ({ node, nodeIndex }))
      .filter(
        ({ node }) =>
          node.type === "paragraph" &&
          /^TOC \d/.test(node.style?.styleId ?? "")
      )
      .map(({ nodeIndex }) => nodeIndex);
    expect(tocEntryNodeIndexes.length).toBeGreaterThan(10);
    const tocPageIndexes = new Set(
      tocEntryNodeIndexes.map((nodeIndex) =>
        pages.findIndex((pageSegments) =>
          pageSegments.some((segment) => segment.nodeIndex === nodeIndex)
        )
      )
    );
    // The whole ToC sits on a single page (page 2).
    expect([...tocPageIndexes]).toEqual([1]);
  });
});
