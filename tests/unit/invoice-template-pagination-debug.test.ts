import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "@extend-ai/react-docx-doc-model";
import { parseDocx } from "@extend-ai/react-docx-ooxml-core";
import { resolveDocumentLayout } from "../../packages/react-viewer/src/section-layout";
import {
  buildDocumentPageNodeSegments,
  DocxEditorViewer,
  estimateTableRowHeightsPx,
  resolveFooterPaginationReservePx,
  useDocxEditor,
} from "../../packages/react-viewer/src/editor";

const DOC_PATH =
  "/Users/andrewluo/Documents/DOCX testing/Downloadable-Word-Invoice-Template.docx";

function buildViewerPaginationMetrics(
  model: Awaited<ReturnType<typeof buildDocModel>>
) {
  const layout = resolveDocumentLayout(model);
  const pageContentWidthPx =
    layout.pageWidthPx - layout.marginsPx.left - layout.marginsPx.right;
  const footerReservePx = resolveFooterPaginationReservePx(
    model.metadata.footerSections ?? [],
    layout
  );
  const pageContentHeightPx = Math.max(
    120,
    layout.pageHeightPx -
      layout.marginsPx.top -
      layout.marginsPx.bottom -
      footerReservePx
  );

  return {
    layout,
    pageContentWidthPx,
    pageContentHeightPx,
    footerReservePx,
    metrics: [
      {
        startNodeIndex: 0,
        pageContentWidthPx,
        pageContentHeightPx,
        pageContentHeightMultiplier: 1,
        docGridLinePitchPx: layout.docGridLinePitchPx,
      },
    ],
  };
}

function InvoiceViewer({ model }: { model: Awaited<ReturnType<typeof buildDocModel>> }): React.JSX.Element {
  const editor = useDocxEditor({ starterModel: model });
  return React.createElement(DocxEditorViewer, {
    editor,
    mode: "read-only",
  });
}

describe("invoice template pagination", () => {
  it.skipIf(!existsSync(DOC_PATH))(
    "stays on a single page like Word",
    async () => {
      const buffer = await readFile(DOC_PATH);
      const pkg = await parseDocx(
        buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        )
      );
      const model = await buildDocModel(pkg);
      const { layout, pageContentWidthPx, pageContentHeightPx, footerReservePx, metrics } =
        buildViewerPaginationMetrics(model);
      const viewerFallbackPageContentHeightPx = Math.max(
        120,
        layout.pageHeightPx - layout.marginsPx.top - layout.marginsPx.bottom
      );
      const pages = buildDocumentPageNodeSegments(
        model,
        pageContentHeightPx,
        pageContentWidthPx,
        model.metadata.numberingDefinitions,
        metrics,
        { allowParagraphLineSplitting: true }
      );
      const viewerLikePages = buildDocumentPageNodeSegments(
        model,
        viewerFallbackPageContentHeightPx,
        pageContentWidthPx,
        model.metadata.numberingDefinitions,
        metrics,
        { allowParagraphLineSplitting: true }
      );
      const lineItemsTable = model.nodes[10];
      expect(lineItemsTable?.type).toBe("table");
      if (lineItemsTable?.type === "table") {
        const estimatedRowHeightsPx = estimateTableRowHeightsPx(
          lineItemsTable,
          pageContentWidthPx,
          model.metadata.numberingDefinitions,
          layout.docGridLinePitchPx,
          pageContentHeightPx
        );
        expect(estimatedRowHeightsPx.reduce((sum, heightPx) => sum + heightPx, 0)).toBeLessThan(
          pageContentHeightPx
        );
      }

      expect(footerReservePx).toBeGreaterThan(0);
      expect(model.metadata.documentPageCount).toBe(1);
      expect(pages.length).toBe(1);
      expect(viewerLikePages.length).toBe(1);
      expect(pages[0]?.map((segment) => segment.nodeIndex)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
      ]);
    }
  );

  it.skipIf(!existsSync(DOC_PATH))(
    "keeps a single stored page count even when import measurements would split",
    async () => {
      const buffer = await readFile(DOC_PATH);
      const pkg = await parseDocx(
        buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        )
      );
      const model = await buildDocModel(pkg);
      const { layout, pageContentWidthPx, pageContentHeightPx, metrics } =
        buildViewerPaginationMetrics(model);
      const viewerFallbackPageContentHeightPx = Math.max(
        120,
        layout.pageHeightPx - layout.marginsPx.top - layout.marginsPx.bottom
      );
      const measuredLineItemRowHeightsPx = [30, 58, 58, 58, 29, 28, 28, 28, 29, 30];
      const inflatedPages = buildDocumentPageNodeSegments(
        model,
        viewerFallbackPageContentHeightPx,
        pageContentWidthPx,
        model.metadata.numberingDefinitions,
        metrics,
        {
          allowParagraphLineSplitting: true,
          measuredTableRowHeightsByNodeIndex: {
            4: [170],
            7: [141],
            10: measuredLineItemRowHeightsPx,
          },
          measuredPageContentHeightsPxByPageIndex: [pageContentHeightPx - 48],
        }
      );

      expect(inflatedPages.length).toBe(2);
      expect(
        buildDocumentPageNodeSegments(
          model,
          viewerFallbackPageContentHeightPx,
          pageContentWidthPx,
          model.metadata.numberingDefinitions,
          metrics,
          { allowParagraphLineSplitting: true }
        ).length
      ).toBe(1);
    }
  );

  it.skipIf(!existsSync(DOC_PATH))(
    "renders a single page surface in the viewer",
    async () => {
      const buffer = await readFile(DOC_PATH);
      const pkg = await parseDocx(
        buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        )
      );
      const model = await buildDocModel(pkg);
      const html = renderToStaticMarkup(
        React.createElement(InvoiceViewer, { model })
      );
      const pageMarkup =
        html.match(/data-docx-page-index="[^"]+"[\s\S]*?(?=data-docx-page-index="|$)/g) ??
        [];

      expect(pageMarkup).toHaveLength(1);
    }
  );
});
