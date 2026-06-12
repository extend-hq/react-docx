import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDocModelFromBytes } from "@extend-ai/react-docx-doc-model";
import { resolveDocumentLayout } from "../../packages/react-viewer/src/section-layout";
import {
  buildDocumentPageNodeSegments,
  estimateTableRowHeightsPx,
  resolveFooterPaginationReservePx,
  resolveHeaderPaginationReservePx,
} from "../../packages/react-viewer/src/editor";

const DOC_PATH =
  "/Users/andrewluo/Documents/DOC testing/2F73J4NP2YHKVISKHDIDJ7RGPDKTQZ7D.doc";

describe("2F73 legacy doc table pagination debug", () => {
  it.skipIf(!existsSync(DOC_PATH))("prints table row estimates", async () => {
    const bytes = readFileSync(DOC_PATH);
    const { model } = await buildDocModelFromBytes(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    );
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
      nodeTypes: model.nodes.map((node) => node.type).join(","),
    });

    model.nodes.forEach((node, nodeIndex) => {
      if (node.type !== "table") {
        return;
      }
      const rowHeights = estimateTableRowHeightsPx(
        node,
        pageContentWidthPx,
        model.metadata.numberingDefinitions,
        layout.docGridLinePitchPx,
        pageContentHeightPx
      );
      console.log(
        `table node ${nodeIndex}: ${node.rows.length} rows, estimated row heights: ${rowHeights
          .map((heightPx) => Math.round(heightPx))
          .join(",")} total=${Math.round(rowHeights.reduce((sum, heightPx) => sum + heightPx, 0))}`
      );
      console.log(
        `  grid: ${JSON.stringify(node.style?.columnWidthsTwips ?? null)} layout=${node.style?.layout}`
      );
    });

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
        preferLastRenderedParagraphStartBreaks: true,
        strictLastRenderedParagraphStartBreaks: false,
      }
    );
    console.log(`engine pages: ${pages.length}`);
    pages.forEach((pageSegments, pageIndex) => {
      console.log(
        `-- page ${pageIndex + 1}: ${pageSegments
          .map((segment) => {
            const range = (segment as { tableRowRange?: { startRowIndex: number; endRowIndex: number } })
              .tableRowRange;
            return `${segment.nodeIndex}${range ? `[rows ${range.startRowIndex}..${range.endRowIndex}]` : ""}`;
          })
          .join(" ")}`
      );
    });

    // LibreOffice/Word render this document as 3 pages. The file carries a
    // stale <Pages>1</Pages> from a never-repaginated save; reconciliation
    // must not compress the estimate toward it (the compressed pages render
    // clipped). The estimate itself stays at 3-4 pages.
    expect(model.metadata.documentPageCount).toBe(1);
    expect(pages.length).toBeGreaterThanOrEqual(3);
  });
});
