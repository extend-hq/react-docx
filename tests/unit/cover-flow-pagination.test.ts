import { describe, expect, it } from "vitest";
import type { DocModel } from "@extend-ai/react-docx-doc-model";
import {
  buildDocumentPageNodeSegments,
  estimateParagraphLineHeightPx,
} from "../../packages/react-viewer/src/editor";

type ModelNode = DocModel["nodes"][number];
type ParagraphNode = Extract<ModelNode, { type: "paragraph" }>;

const EMPTY_METADATA: DocModel["metadata"] = {
  sourceParts: 1,
  warnings: [],
  headerSections: [],
  footerSections: [],
  paragraphStyles: []
};

const PAGE_CONTENT_WIDTH_PX = 600;
const PAGE_CONTENT_HEIGHT_PX = 400;

// Mirrors what the parser now produces for an empty paragraph whose mark
// (pPr>rPr) carries a 20pt bold size: one empty text run with that style.
function markSizedSpacer(): ModelNode {
  return {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "",
        style: { fontSizePt: 20, bold: true, fontFamily: "Calibri" }
      }
    ]
  };
}

function textParagraph(text: string, fontSizePt = 11): ModelNode {
  return {
    type: "paragraph",
    children: [{ type: "text", text, style: { fontSizePt } }]
  };
}

// Full-page behind-document cover art anchored at the first paragraph, the
// way Word cover pages are commonly built (the image floats out of flow; the
// page is filled by mark-sized empty spacer paragraphs).
function coverArtAnchor(): ModelNode {
  return {
    type: "paragraph",
    children: [
      {
        type: "image",
        src: "data:image/png;base64,",
        widthPx: 600,
        heightPx: 380,
        floating: { behindDocument: true, wrapType: "none" }
      }
    ]
  };
}

// A spacer that also anchors a small decorative floating shape (e.g. a rule
// line). This used to sever the cover-overlay heuristic chain so neither the
// forced post-cover break nor real spacer heights applied, cramming the rest
// of the document onto the cover page.
function decoratedSpacer(): ModelNode {
  return {
    type: "paragraph",
    children: [
      {
        type: "text",
        text: "\t",
        style: { fontSizePt: 20, bold: true, fontFamily: "Calibri" }
      },
      {
        type: "image",
        src: "data:image/png;base64,",
        widthPx: 200,
        heightPx: 1,
        floating: { wrapType: "none", xPx: 10, yPx: 120 }
      }
    ]
  };
}

describe("cover page natural-flow pagination", () => {
  it("estimates a text-free paragraph at its mark font's natural line height", () => {
    const spacer = markSizedSpacer() as ParagraphNode;
    const spacerLineHeightPx = estimateParagraphLineHeightPx(spacer);
    // 20pt -> ~27px font; natural (line-height: normal) metrics ~1.21em.
    expect(spacerLineHeightPx).toBeGreaterThanOrEqual(30);
    expect(spacerLineHeightPx).toBeLessThanOrEqual(36);

    // Wrapping paragraphs keep the wrap-compensation scale.
    const textLineHeightPx = estimateParagraphLineHeightPx(
      textParagraph("Some heading text", 20) as ParagraphNode
    );
    expect(textLineHeightPx).toBeLessThan(spacerLineHeightPx);
  });

  it("keeps spacer-built cover pages to one page and starts content on page 2", () => {
    const spacerCount = 14;
    const titleIndex = 1 + spacerCount + 1; // anchor + spacers + decorated spacer
    const model: DocModel = {
      nodes: [
        coverArtAnchor(),
        ...Array.from({ length: spacerCount }, () => markSizedSpacer()),
        decoratedSpacer(),
        textParagraph("AGREEMENT TITLE", 20),
        textParagraph("First body paragraph after the cover."),
        textParagraph("Second body paragraph after the cover."),
        textParagraph("Third body paragraph after the cover.")
      ],
      metadata: EMPTY_METADATA
    };

    const pages = buildDocumentPageNodeSegments(
      model,
      PAGE_CONTENT_HEIGHT_PX,
      PAGE_CONTENT_WIDTH_PX
    );

    // The spacers consume their real flow height (~33px each), so the cover
    // fills page 1 and the title starts page 2 — nothing piles onto the
    // cover page to be clipped by the renderer.
    const coverPageIndex = pages.findIndex((pageSegments) =>
      pageSegments.some((segment) => segment.nodeIndex === 0)
    );
    const titlePageIndex = pages.findIndex((pageSegments) =>
      pageSegments.some((segment) => segment.nodeIndex === titleIndex)
    );
    expect(coverPageIndex).toBe(0);
    expect(titlePageIndex).toBeGreaterThan(coverPageIndex);

    // Every page's estimated content must fit its budget — a page estimated
    // beyond the budget renders clipped.
    pages.forEach((pageSegments, pageIndex) => {
      const pageEstimatePx = pageSegments.reduce((sum, segment) => {
        const node = model.nodes[segment.nodeIndex];
        if (!node || node.type !== "paragraph") {
          return sum;
        }
        const lineCount = segment.paragraphLineRange
          ? Math.max(
              1,
              segment.paragraphLineRange.endLineIndex -
                segment.paragraphLineRange.startLineIndex
            )
          : 1;
        return (
          sum + lineCount * estimateParagraphLineHeightPx(node as ParagraphNode)
        );
      }, 0);
      expect(
        pageEstimatePx,
        `page ${pageIndex + 1} over-crammed (${Math.round(pageEstimatePx)}px)`
      ).toBeLessThanOrEqual(PAGE_CONTENT_HEIGHT_PX + 40);
    });
  });
});
