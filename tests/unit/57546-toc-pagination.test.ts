import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "@extend-ai/react-docx-doc-model";
import { parseDocx } from "@extend-ai/react-docx-ooxml-core";
import {
  buildDocumentPageNodeSegments,
  paragraphLineCountWithinWidth,
  resolveFooterPaginationReservePx,
  resolveHeaderPaginationReservePx,
} from "../../packages/react-viewer/src/editor";
import { resolveDocumentLayout } from "../../packages/react-viewer/src/section-layout";

const DOC_PATH =
  "/Users/andrewluo/Documents/DOCX testing/2026-04-05_21-56-54/57546d8119283214ab7cf4641417a3b26ea820771cd848f7dad62c8b21fe077a.docx";

describe("57546 TOC pagination", () => {
  it.skipIf(!existsSync(DOC_PATH))(
    "does not over-reserve right tab stops as leading TOC title width",
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

      const longTocEntry = model.nodes[29];
      expect(longTocEntry?.type).toBe("paragraph");
      expect(
        longTocEntry && longTocEntry.type === "paragraph"
          ? paragraphLineCountWithinWidth(
              longTocEntry,
              pageContentWidthPx,
              model.metadata.numberingDefinitions
            )
          : 0
      ).toBeLessThanOrEqual(4);

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
            model.metadata.compatibility
              ?.suppressSpacingBeforeAfterPageBreak === true,
          preferLastRenderedParagraphStartBreaks: true,
        }
      );

      const secondPageNodeIndexes = new Set(
        (pages[1] ?? []).map((segment) => segment.nodeIndex)
      );
      expect(secondPageNodeIndexes.has(48)).toBe(true);
      expect(pages.length).toBeLessThanOrEqual(70);
    }
  );
});
