import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "@extend-ai/react-docx-doc-model";
import { parseDocx } from "@extend-ai/react-docx-ooxml-core";
import { resolveDocumentLayout } from "../../packages/react-viewer/src/section-layout";
import {
  buildDocumentPageNodeSegments,
  buildDocumentPageNodeSegmentsFromLastRenderedPageBreakHints,
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
  paragraphHasLastRenderedPageBreak,
  paragraphHasPageBreakBefore,
  paragraphStartsWithLastRenderedPageBreak,
} from "../../packages/layout-core/src/pagination";

const DOC_PATH =
  "/Users/andrewluo/Documents/DOCX testing/2026-03-24_15-53-14/8256f805ed4809ac155e16c7ce08f662fc56f82d5f0fb27d818c961260875409.docx";

type ModelNode = Awaited<ReturnType<typeof buildDocModel>>["nodes"][number];

function nodeSummary(node: ModelNode): string {
  if (node.type === "paragraph") {
    const text = (node.children ?? [])
      .filter((child) => child.type === "text")
      .map((child) => ("text" in child ? child.text ?? "" : ""))
      .join("")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 70);
    return `p: ${text || "(empty)"}`;
  }
  if (node.type === "table") {
    return `table (${node.rows.length} rows)`;
  }
  return node.type;
}

describe("8256f8 pagination fidelity debug (5 pages vs Word 3)", () => {
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

    console.log("=== layout ===");
    console.log({
      pageWidthPx: layout.pageWidthPx,
      pageHeightPx: layout.pageHeightPx,
      marginsPx: layout.marginsPx,
      docGridLinePitchPx: layout.docGridLinePitchPx,
      headerReservePx,
      footerReservePx,
      pageContentWidthPx,
      pageContentHeightPx,
      nodeCount: model.nodes.length,
      storedDocumentPageCount: model.metadata.documentPageCount,
      sectionCount: (model.metadata.sections ?? []).length,
      suppressSpacingBeforeAfterPageBreak:
        model.metadata.compatibility?.suppressSpacingBeforeAfterPageBreak === true,
    });

    const metrics = [
      {
        startNodeIndex: 0,
        pageContentWidthPx,
        pageContentHeightPx,
        pageContentHeightMultiplier: 1,
        docGridLinePitchPx: layout.docGridLinePitchPx,
      },
    ];

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

    console.log("=== lastRenderedPageBreak hints ===");
    model.nodes.forEach((node, nodeIndex) => {
      if (node.type !== "paragraph") {
        return;
      }
      if (paragraphHasLastRenderedPageBreak(node)) {
        console.log(
          `node ${nodeIndex}: LRPB startsWith=${paragraphStartsWithLastRenderedPageBreak(node)} pageBreakBefore=${paragraphHasPageBreakBefore(node)} [${nodeSummary(node)}]`
        );
      }
    });

    const suppressSpacingBeforeAfterPageBreak =
      model.metadata.compatibility?.suppressSpacingBeforeAfterPageBreak === true;
    // Fresh-import viewer options (editor.tsx pageSegmentationPlan): no measured
    // heights yet, preferLastRenderedParagraphStartBreaks=true (no undo/redo).
    const pagesViewer = buildDocumentPageNodeSegments(
      model,
      pageContentHeightPx,
      pageContentWidthPx,
      model.metadata.numberingDefinitions,
      metrics,
      {
        allowParagraphLineSplitting: true,
        suppressSpacingBeforeAfterPageBreak,
        preferLastRenderedParagraphStartBreaks: true,
        strictLastRenderedParagraphStartBreaks: false,
      }
    );
    const pagesDefault = buildDocumentPageNodeSegments(
      model,
      pageContentHeightPx,
      pageContentWidthPx,
      model.metadata.numberingDefinitions,
      metrics,
      { allowParagraphLineSplitting: true }
    );
    const pagesFromWordHints =
      buildDocumentPageNodeSegmentsFromLastRenderedPageBreakHints(model);

    const printPages = (
      title: string,
      pages: Array<Array<{ nodeIndex: number; paragraphLineRange?: { startLineIndex: number; endLineIndex: number } }>>
    ): void => {
      console.log(`=== ${title}: ${pages.length} pages ===`);
      pages.forEach((pageSegments, pageIndex) => {
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
          `   page ${pageIndex + 1} total estimated full-node height ~${Math.round(pageEstimatedHeightPx)}px (budget ${Math.round(pageContentHeightPx)}px)`
        );
      });
    };

    printPages("engine pages (viewer fresh-import options)", pagesViewer);
    printPages("engine pages (plain default options)", pagesDefault);
    printPages("Word-hint pages (lastRenderedPageBreak)", pagesFromWordHints);

    expect(pagesViewer.length).toBeGreaterThan(0);

    // Word renders this document as exactly 3 pages (app.xml <Pages>3</Pages>)
    // with lastRenderedPageBreak markers inside nodes 22 and 35. The viewer
    // relies on this hint-aligned slicing (storedDocumentPageCount === hint
    // page count) to land on 3 pages, so pin it.
    expect(model.metadata.documentPageCount).toBe(3);
    expect(pagesFromWordHints).toHaveLength(3);
    expect(pagesFromWordHints[1]?.[0]?.nodeIndex).toBe(22);
    expect(pagesFromWordHints[2]?.[0]?.nodeIndex).toBe(35);
  });
});
