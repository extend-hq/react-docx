import { describe, expect, it } from "vitest";
import {
  resolveUiActiveTextRange,
  type DocxEditorSelection,
  type DocxTextRange
} from "../../packages/react-viewer/src/editor";

function paragraphSelection(nodeIndex: number): DocxEditorSelection {
  return {
    kind: "paragraph",
    nodeIndex
  };
}

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

describe("UI active text range fallback", () => {
  it("keeps using the live active range when it exists", () => {
    const activeRange = paragraphRange(4, 9);
    const lastRange = paragraphRange(4, 3);

    expect(
      resolveUiActiveTextRange(paragraphSelection(4), activeRange, lastRange)
    ).toBe(activeRange);
  });

  it("falls back to the last in-viewer range when the current selection is still in the same paragraph", () => {
    const lastRange = paragraphRange(7, 11);

    expect(
      resolveUiActiveTextRange(paragraphSelection(7), undefined, lastRange)
    ).toEqual(lastRange);
  });

  it("does not reuse a stale in-viewer range after selection moves to another paragraph", () => {
    const lastRange = paragraphRange(7, 11);

    expect(
      resolveUiActiveTextRange(paragraphSelection(8), undefined, lastRange)
    ).toBeUndefined();
  });
});
