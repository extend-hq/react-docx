import type * as React from "react";
import { describe, expect, it } from "vitest";
import {
  isCompositionKeyboardEvent,
  shouldReissueDomSelectionRestore,
  stableInnerHtmlProp,
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

  it("does not reissue DOM restore while an IME composition session is active", () => {
    expect(
      shouldReissueDomSelectionRestore({
        modelChanged: true,
        selectionChanged: false,
        rangeChanged: false,
        activeTextRange: paragraphRange(2, 3, 8),
        suppressNext: false,
        selectionSessionKind: "composition"
      })
    ).toBe(false);
  });

  it("does not reissue DOM restore during composition even when the range moved", () => {
    expect(
      shouldReissueDomSelectionRestore({
        modelChanged: true,
        selectionChanged: false,
        rangeChanged: true,
        activeTextRange: paragraphRange(2, 3, 8),
        suppressNext: false,
        selectionSessionKind: "composition"
      })
    ).toBe(false);
  });
});

function keyboardEvent(options: {
  key: string;
  keyCode: number;
  isComposing?: boolean;
}): React.KeyboardEvent<HTMLElement> {
  return {
    key: options.key,
    keyCode: options.keyCode,
    nativeEvent: {
      isComposing: options.isComposing ?? false
    }
  } as unknown as React.KeyboardEvent<HTMLElement>;
}

describe("composition keydown gating", () => {
  it("treats keydown with a live native composition as composing", () => {
    expect(
      isCompositionKeyboardEvent(
        keyboardEvent({ key: "Enter", keyCode: 13, isComposing: true })
      )
    ).toBe(true);
  });

  it("treats the IME process key (keyCode 229) as composing before compositionstart", () => {
    expect(
      isCompositionKeyboardEvent(
        keyboardEvent({ key: "Process", keyCode: 229 })
      )
    ).toBe(true);
  });

  it("lets a post-commit plain Enter through", () => {
    expect(
      isCompositionKeyboardEvent(keyboardEvent({ key: "Enter", keyCode: 13 }))
    ).toBe(false);
  });

  it("lets arrow navigation through once the composition has ended", () => {
    expect(
      isCompositionKeyboardEvent(
        keyboardEvent({ key: "ArrowDown", keyCode: 40 })
      )
    ).toBe(false);
  });
});

describe("stable dangerouslySetInnerHTML props", () => {
  it("reuses the same object while the html string is unchanged", () => {
    const cache = new Map<number, { __html: string }>();
    const first = stableInnerHtmlProp(cache, 3, "<span>a</span>");
    const second = stableInnerHtmlProp(cache, 3, "<span>a</span>");
    expect(second).toBe(first);
    expect(second.__html).toBe("<span>a</span>");
  });

  it("returns a new object when the html string changes", () => {
    const cache = new Map<number, { __html: string }>();
    const first = stableInnerHtmlProp(cache, 3, "<span>a</span>");
    const second = stableInnerHtmlProp(cache, 3, "<span>ab</span>");
    expect(second).not.toBe(first);
    expect(second.__html).toBe("<span>ab</span>");
    expect(stableInnerHtmlProp(cache, 3, "<span>ab</span>")).toBe(second);
  });

  it("tracks entries per key independently", () => {
    const cache = new Map<string, { __html: string }>();
    const a = stableInnerHtmlProp(cache, "0:0:0", "<span>a</span>");
    const b = stableInnerHtmlProp(cache, "0:0:1", "<span>a</span>");
    expect(a).not.toBe(b);
    expect(stableInnerHtmlProp(cache, "0:0:0", "<span>a</span>")).toBe(a);
  });
});
