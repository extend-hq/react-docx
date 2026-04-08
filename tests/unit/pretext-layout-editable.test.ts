import { beforeAll, describe, expect, it, vi } from "vitest";

class MockCanvasContext {
  font = "16px Calibri";

  measureText(text: string): { width: number } {
    const fontSizeMatch = this.font.match(/(\d+(?:\.\d+)?)px/i);
    const fontSizePx = fontSizeMatch?.[1] ? Number.parseFloat(fontSizeMatch[1]) : 16;
    let width = 0;

    for (const character of text) {
      if (character === "\n" || character === "\r") {
        continue;
      }
      if (/\s/u.test(character)) {
        width += fontSizePx * 0.34;
        continue;
      }
      if (/[A-Z]/u.test(character)) {
        width += fontSizePx * 0.66;
        continue;
      }
      if (/[a-z]/u.test(character)) {
        width += fontSizePx * 0.55;
        continue;
      }
      if (/[0-9]/u.test(character)) {
        width += fontSizePx * 0.57;
        continue;
      }

      width += fontSizePx * 0.48;
    }

    return { width };
  }
}

class MockOffscreenCanvas {
  getContext(_kind: string): MockCanvasContext {
    return new MockCanvasContext();
  }
}

beforeAll(() => {
  vi.stubGlobal("OffscreenCanvas", MockOffscreenCanvas);
});

describe("pretext editable layout helpers", () => {
  it("resolves offsets from points within a wrapped row", async () => {
    const {
      layoutTextWithPretextAroundExclusions,
      resolveOffsetAtPoint
    } = await import("../../packages/react-viewer/src/pretext-layout");

    const layout = layoutTextWithPretextAroundExclusions(
      "Documents may contain images and text.",
      "16px Calibri",
      320,
      22,
      [
        {
          left: 90,
          right: 210,
          top: 20,
          bottom: 88
        }
      ]
    );

    expect(layout).toBeDefined();
    const splitLine = layout?.lines.find((line) => line.fragments.length === 2);
    expect(splitLine).toBeDefined();
    const leftFragment = splitLine?.fragments[0];
    const rightFragment = splitLine?.fragments[1];
    expect(leftFragment).toBeDefined();
    expect(rightFragment).toBeDefined();

    const leftOffset = resolveOffsetAtPoint(
      layout!,
      (leftFragment?.x ?? 0) + 6,
      (splitLine?.y ?? 0) + 10
    );
    const rightOffset = resolveOffsetAtPoint(
      layout!,
      (rightFragment?.x ?? 0) + 6,
      (splitLine?.y ?? 0) + 10
    );

    expect(leftOffset).toBeGreaterThanOrEqual(leftFragment?.startOffset ?? 0);
    expect(leftOffset).toBeLessThanOrEqual(leftFragment?.endOffset ?? 0);
    expect(rightOffset).toBeGreaterThanOrEqual(rightFragment?.startOffset ?? 0);
    expect(rightOffset).toBeLessThanOrEqual(rightFragment?.endOffset ?? 0);
    expect(rightOffset).toBeGreaterThan(leftOffset);
  });

  it("resolves caret rectangles at fragment boundaries", async () => {
    const {
      layoutTextWithPretextAroundExclusions,
      resolveCaretRectAtOffset
    } = await import("../../packages/react-viewer/src/pretext-layout");

    const layout = layoutTextWithPretextAroundExclusions(
      "Wrapped text stays editable.",
      "16px Calibri",
      180,
      22
    );

    const startCaret = resolveCaretRectAtOffset(layout!, 0);
    const endCaret = resolveCaretRectAtOffset(layout!, layout?.text?.length ?? 0);

    expect(startCaret?.left ?? 0).toBeGreaterThanOrEqual(0);
    expect(startCaret?.height).toBe(22);
    expect(endCaret?.left ?? 0).toBeGreaterThan(startCaret?.left ?? 0);
  });

  it("creates selection rects across multiple wrapped fragments", async () => {
    const {
      layoutTextWithPretextAroundExclusions,
      resolveSelectionRects
    } = await import("../../packages/react-viewer/src/pretext-layout");

    const layout = layoutTextWithPretextAroundExclusions(
      "Documents may contain images and text that wrap around exclusions.",
      "16px Calibri",
      320,
      22,
      [
        {
          left: 100,
          right: 220,
          top: 20,
          bottom: 88
        }
      ]
    );

    const selectionRects = resolveSelectionRects(layout!, 10, 38);

    expect(selectionRects.length).toBeGreaterThan(1);
    expect(selectionRects.every((rect) => rect.width > 0)).toBe(true);
    expect(selectionRects.some((rect) => rect.top > 0)).toBe(true);
  });

  it("slices layout lines while preserving global text offsets", async () => {
    const {
      layoutTextWithPretextAroundExclusions,
      sliceLayoutToLineRange
    } = await import("../../packages/react-viewer/src/pretext-layout");

    const layout = layoutTextWithPretextAroundExclusions(
      "This paragraph should produce several lines for slicing behavior validation.",
      "16px Calibri",
      120,
      22
    );

    const sliced = sliceLayoutToLineRange(layout!, 1, 3);

    expect(sliced.lines.length).toBe(2);
    expect(sliced.lines[0]?.y).toBe(0);
    expect(sliced.lines[0]?.fragments[0]?.startOffset ?? 0).toBeGreaterThan(0);
    expect(sliced.height).toBeGreaterThan(0);
  });
});
