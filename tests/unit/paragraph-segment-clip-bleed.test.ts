import { describe, expect, it } from "vitest";
import {
  resolveFallbackParagraphSegmentClipBleedPx,
  resolveParagraphSegmentClipBleedPx,
  resolveParagraphSegmentNonFlowReservePx,
} from "../../packages/react-viewer/src/editor";

describe("paragraph segment clip bleed", () => {
  it("adds extra top bleed for continued paragraph segments on a new page", () => {
    expect(
      resolveParagraphSegmentClipBleedPx({
        startLineIndex: 6,
        endLineIndex: 9,
        totalLineCount: 9,
        lineHeightPx: 24
      })
    ).toEqual({
      topPx: 22,
      bottomPx: 6
    });
  });

  it("keeps top bleed at zero for the first segment of a partial paragraph", () => {
    expect(
      resolveParagraphSegmentClipBleedPx({
        startLineIndex: 0,
        endLineIndex: 3,
        totalLineCount: 9,
        lineHeightPx: 24
      })
    ).toEqual({
      topPx: 0,
      bottomPx: 6
    });
  });

  it("adds non-flow reserve for partial paragraph segments so bleed never clips into the page edge", () => {
    expect(
      resolveParagraphSegmentNonFlowReservePx({
        startLineIndex: 6,
        endLineIndex: 9,
        totalLineCount: 9,
        lineHeightPx: 24,
      })
    ).toBe(52);
  });

  it("caps fallback continued-segment bleed so clipped rendering does not re-show adjacent lines", () => {
    expect(
      resolveFallbackParagraphSegmentClipBleedPx(
        {
          type: "paragraph",
          children: [
            {
              type: "text",
              text: "Oversized fallback paragraph text",
              style: {
                fontSizePt: 24,
              },
            },
          ],
        },
        {
          startLineIndex: 3,
          endLineIndex: 5,
          totalLineCount: 8,
          lineHeightPx: 20,
        }
      )
    ).toEqual({
      topPx: 4,
      bottomPx: 0,
    });
  });
});
