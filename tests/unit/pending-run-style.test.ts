import { describe, expect, it } from "vitest";
import {
  shouldPreservePendingRunStyleBetweenRanges,
  type DocxTextRange
} from "../../packages/react-viewer/src/editor";

function paragraphRange(nodeIndex: number, startOffset: number, endOffset = startOffset): DocxTextRange {
  return {
    start: {
      location: {
        kind: "paragraph",
        nodeIndex
      },
      offset: startOffset
    },
    end: {
      location: {
        kind: "paragraph",
        nodeIndex
      },
      offset: endOffset
    }
  };
}

describe("pending run style range preservation", () => {
  it("preserves pending typing style while a collapsed caret moves within the same paragraph", () => {
    expect(
      shouldPreservePendingRunStyleBetweenRanges(
        paragraphRange(3, 5),
        paragraphRange(3, 6)
      )
    ).toBe(true);
  });

  it("clears pending typing style when the next range expands", () => {
    expect(
      shouldPreservePendingRunStyleBetweenRanges(
        paragraphRange(3, 5),
        paragraphRange(3, 5, 7)
      )
    ).toBe(false);
  });

  it("clears pending typing style when the caret moves to another paragraph", () => {
    expect(
      shouldPreservePendingRunStyleBetweenRanges(
        paragraphRange(3, 5),
        paragraphRange(4, 0)
      )
    ).toBe(false);
  });
});
