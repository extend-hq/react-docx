import { describe, expect, it } from "vitest";
import { resolveParagraphSegmentClipBleedPx } from "../../packages/react-viewer/src/editor";

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
      topPx: 10,
      bottomPx: 3
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
      bottomPx: 3
    });
  });
});
