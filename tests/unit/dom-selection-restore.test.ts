import { describe, expect, it } from "vitest";
import {
  shouldReissueDomSelectionRestore,
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

describe("DOM selection restore gating", () => {
  it("does not reissue DOM restore after a selection-only update", () => {
    expect(
      shouldReissueDomSelectionRestore({
        modelChanged: false,
        selectionChanged: false,
        rangeChanged: false,
        activeTextRange: paragraphRange(2, 3, 8),
        suppressNext: false,
        selectionSessionKind: "idle"
      })
    ).toBe(false);
  });

  it("does not reissue DOM restore while pointer selection is still settling", () => {
    expect(
      shouldReissueDomSelectionRestore({
        modelChanged: true,
        selectionChanged: false,
        rangeChanged: false,
        activeTextRange: paragraphRange(2, 3, 8),
        suppressNext: false,
        selectionSessionKind: "pointer"
      })
    ).toBe(false);
  });

  it("reissues DOM restore when a model update invalidates the live DOM range", () => {
    expect(
      shouldReissueDomSelectionRestore({
        modelChanged: true,
        selectionChanged: false,
        rangeChanged: false,
        activeTextRange: paragraphRange(2, 3, 8),
        suppressNext: false,
        selectionSessionKind: "idle"
      })
    ).toBe(true);
  });
});
