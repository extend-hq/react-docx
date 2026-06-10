import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "@extend-ai/react-docx-doc-model";
import { parseDocx } from "@extend-ai/react-docx-ooxml-core";
import { resolveDocumentLayout } from "../../packages/react-viewer/src/section-layout";
import {
  buildDocumentPageNodeSegments,
  buildDocumentPageNodeSegmentsFromLastRenderedPageBreakHints,
  estimateTableRowHeightsPx,
  resolveFooterPaginationReservePx,
  resolveHeaderPaginationReservePx,
} from "../../packages/react-viewer/src/editor";

const DOC_PATH =
  "/Users/andrewluo/Documents/DOCX testing/Self-FI inspection report format-March 2024.docx";

describe("Self-FI table pagination debug", () => {
  it.skipIf(!existsSync(DOC_PATH))(
    "analyzes table row splits across pages",
    async () => {
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
      const pages = buildDocumentPageNodeSegments(
        model,
        pageContentHeightPx,
        pageContentWidthPx,
        model.metadata.numberingDefinitions,
        metrics,
        { allowParagraphLineSplitting: true }
      );
      const hintPages =
        buildDocumentPageNodeSegmentsFromLastRenderedPageBreakHints(model);

      const tableCantSplit = model.nodes
        .filter((node) => node.type === "table")
        .map((table, tableIndex) => ({
          nodeIndex: model.nodes.indexOf(table),
          rows: table.rows.length,
          cantSplitRows: table.rows.filter((row) => row.style?.cantSplit === true)
            .length,
          exactHeightRows: table.rows.filter(
            (row) => row.style?.heightRule === "exact"
          ).length,
        }));

      const pageTableSegments = pages.map((segments, pageIndex) =>
        segments
          .filter((segment) => model.nodes[segment.nodeIndex]?.type === "table")
          .map((segment) => ({
            nodeIndex: segment.nodeIndex,
            tableRowRange: segment.tableRowRange,
          }))
      );

      const firstPageTable0 = pages[0]?.find(
        (segment) => segment.nodeIndex === 0
      );
      const table0 = model.nodes[0];
      expect(table0?.type).toBe("table");
      if (table0?.type === "table") {
        const table0RowHeightsPx = estimateTableRowHeightsPx(
          table0,
          pageContentWidthPx,
          model.metadata.numberingDefinitions,
          layout.docGridLinePitchPx,
          pageContentHeightPx
        );
        const table0HeightSumPx = table0RowHeightsPx.reduce(
          (sum, heightPx) => sum + heightPx,
          0
        );
        expect(table0HeightSumPx).toBeGreaterThan(pageContentHeightPx);
        expect(firstPageTable0?.tableRowRange).toBeDefined();
      }

      expect(model.metadata.documentPageCount).toBe(6);
      expect(pages.length).toBeGreaterThanOrEqual(6);
      expect(hintPages.length).toBe(1);
      if (firstPageTable0?.tableRowRange) {
        expect(firstPageTable0.tableRowRange.endRowIndex).toBeLessThan(41);
      }
    }
  );
});
