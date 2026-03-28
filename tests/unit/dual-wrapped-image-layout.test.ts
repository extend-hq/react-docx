import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ParagraphNode } from "@react-docx/doc-model";

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
      if (/[\u2e80-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(character)) {
        width += fontSizePx;
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

describe("dual wrapped image layout", () => {
  it("detects an interior both-sides wrapped image exclusion box", async () => {
    const { resolveDualWrappedFloatingImageGeometry } = await import(
      "../../packages/react-viewer/src/editor"
    );

    const geometry = resolveDualWrappedFloatingImageGeometry(
      {
        type: "image",
        widthPx: 120,
        heightPx: 100,
        floating: {
          xPx: 120,
          yPx: 18,
          distLPx: 12,
          distRPx: 12,
          distTPx: 4,
          distBPx: 6,
          wrapType: "square",
          wrapText: "bothSides",
          behindDocument: false
        }
      },
      420
    );

    expect(geometry).toBeDefined();
    expect(geometry?.imageLeftPx).toBe(120);
    expect(geometry?.imageTopPx).toBe(22);
    expect(geometry?.exclusion).toEqual({
      left: 108,
      right: 252,
      top: 22,
      bottom: 128
    });
  });

  it("lays out text into left and right fragments beside an interior wrapped image", async () => {
    const { resolveParagraphDualWrappedTextLayout } = await import(
      "../../packages/react-viewer/src/editor"
    );

    const paragraph: ParagraphNode = {
      type: "paragraph",
      children: [
        {
          type: "text",
          text:
            "This paragraph should wrap around a centered floating image and keep filling both the left and right side strips while the image occupies the middle of the page."
        },
        {
          type: "image",
          widthPx: 110,
          heightPx: 96,
          floating: {
            xPx: 112,
            yPx: 20,
            distLPx: 10,
            distRPx: 10,
            distTPx: 4,
            distBPx: 4,
            wrapType: "square",
            wrapText: "bothSides",
            behindDocument: false
          }
        }
      ]
    };

    const layout = resolveParagraphDualWrappedTextLayout(paragraph, 320, 22);

    expect(layout).toBeDefined();
    expect(layout?.layout.lineCount).toBeGreaterThan(2);
    expect(layout?.layout.lines.some((line) => line.fragments.length === 2)).toBe(true);

    const splitLine = layout?.layout.lines.find((line) => line.fragments.length === 2);
    expect(splitLine?.fragments[0]?.x).toBe(0);
    expect(splitLine?.fragments[1]?.x).toBeGreaterThan(splitLine?.fragments[0]?.width ?? 0);
    expect(layout?.layout.height).toBeGreaterThanOrEqual(layout?.geometry.exclusion.bottom ?? 0);
  });
});
