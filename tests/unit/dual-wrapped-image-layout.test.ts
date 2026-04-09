import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ParagraphNode } from "@extend-ai/react-docx-doc-model";

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
  it("scales drop-cap visual height with resized font size", async () => {
    const {
      resolveDropCapFontSizePx,
      resolveDropCapVisualHeightPx
    } = await import("../../packages/react-viewer/src/editor");

    const style = { fontSizePt: 58.5 };
    const baselineFontSizePx = resolveDropCapFontSizePx(style, 20, 3);
    const baselineHeightPx = resolveDropCapVisualHeightPx(style, 20, 3, baselineFontSizePx);
    const grownHeightPx = resolveDropCapVisualHeightPx(style, 20, 3, baselineFontSizePx * 1.5);
    const shrunkHeightPx = resolveDropCapVisualHeightPx(style, 20, 3, baselineFontSizePx * 0.7);

    expect(baselineHeightPx).toBeGreaterThan(0);
    expect(grownHeightPx).toBeGreaterThan(baselineHeightPx);
    expect(shrunkHeightPx).toBeLessThan(baselineHeightPx);
  });

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

  it("converts margin-relative vertical offsets into paragraph-local exclusion tops", async () => {
    const { resolveDualWrappedFloatingImageGeometry } = await import(
      "../../packages/react-viewer/src/editor"
    );

    const geometry = resolveDualWrappedFloatingImageGeometry(
      {
        type: "image",
        widthPx: 102,
        heightPx: 102,
        floating: {
          xPx: 102,
          yPx: 84,
          horizontalRelativeTo: "margin",
          verticalRelativeTo: "margin",
          distLPx: 12,
          distRPx: 12,
          distTPx: 0,
          distBPx: 0,
          wrapType: "square",
          wrapText: "bothSides",
          behindDocument: false
        }
      },
      420,
      {
        paragraphTopPx: 40
      }
    );

    expect(geometry?.imageTopPx).toBe(44);
    expect(geometry?.exclusion.top).toBe(44);
  });

  it("keeps narrow near-edge both-sides wraps on the side-float path", async () => {
    const { resolveDualWrappedFloatingImageGeometry } = await import(
      "../../packages/react-viewer/src/editor"
    );

    const geometry = resolveDualWrappedFloatingImageGeometry(
      {
        type: "image",
        widthPx: 284,
        heightPx: 140,
        floating: {
          xPx: 40,
          yPx: 0,
          distLPx: 12,
          distRPx: 12,
          distTPx: 0,
          distBPx: 4,
          wrapType: "square",
          wrapText: "bothSides",
          behindDocument: false
        }
      },
      612
    );

    expect(geometry).toBeUndefined();
  });

  it("maps explicit left insets into occupied side-float width", async () => {
    const { wrappedFloatingImageStyle } = await import(
      "../../packages/react-viewer/src/editor"
    );

    const style = wrappedFloatingImageStyle(
      {
        type: "image",
        widthPx: 102,
        heightPx: 102,
        floating: {
          xPx: 102,
          yPx: 84,
          horizontalRelativeTo: "margin",
          verticalRelativeTo: "margin",
          distLPx: 12,
          distRPx: 12,
          distTPx: 0,
          distBPx: 0,
          wrapType: "square",
          wrapText: "bothSides",
          behindDocument: false
        }
      },
      {
        containerWidthPx: 400
      }
    );

    expect(style.float).toBe("left");
    expect(style.marginLeft).toBe(0);
    expect(style.paddingLeft).toBe(102);
    expect(style.boxSizing).toBe("content-box");
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
    const maxExclusionBottom = Math.max(
      ...(layout?.geometries.map((geometry) => geometry.exclusion.bottom) ?? [0])
    );
    expect(layout?.layout.height).toBeGreaterThanOrEqual(maxExclusionBottom);
  });

  it("keeps mixed inline-image paragraphs on the pretext wrapped layout path", async () => {
    const { resolveParagraphDualWrappedTextLayout } = await import(
      "../../packages/react-viewer/src/editor"
    );

    const paragraph: ParagraphNode = {
      type: "paragraph",
      children: [
        {
          type: "image",
          widthPx: 102,
          heightPx: 102,
          alt: "back.png",
          floating: {
            xPx: 102,
            yPx: 84,
            horizontalRelativeTo: "margin",
            verticalRelativeTo: "margin",
            distLPx: 12,
            distRPx: 12,
            distTPx: 0,
            distBPx: 0,
            wrapType: "square",
            wrapText: "bothSides",
            behindDocument: false
          }
        },
        {
          type: "text",
          text: "Images can be part of the normal text flow, like this image of a green dot "
        },
        {
          type: "image",
          widthPx: 14,
          heightPx: 14,
          alt: "dot_green.png"
        },
        {
          type: "text",
          text:
            ". Inline images do not cause breaks in the text and are usually small in size."
        }
      ]
    };

    const layout = resolveParagraphDualWrappedTextLayout(paragraph, 620, 22);

    expect(layout).toBeDefined();
    expect(layout?.geometries).toHaveLength(1);
    expect(
      layout?.source.runs.some(
        (run) => run.kind === "image" && run.image?.alt === "dot_green.png"
      )
    ).toBe(true);
    expect(layout?.layout.lineCount).toBeGreaterThan(1);
    expect(layout?.layout.height).toBeGreaterThan(
      layout?.geometries[0]?.imageTopPx ?? 0
    );
  });

  it("does not let a later-anchored wrapped image start above its anchor line", async () => {
    const { resolveParagraphDualWrappedTextLayout } = await import(
      "../../packages/react-viewer/src/editor"
    );

    const paragraph: ParagraphNode = {
      type: "paragraph",
      children: [
        {
          type: "text",
          text:
            "Generally, it is not possible to translate the exact positioning of images from a Word document to an ebook. That is because in Word, image positioning is specified in absolute units from the page boundaries. "
        },
        {
          type: "image",
          widthPx: 102,
          heightPx: 102,
          alt: "forward.png",
          floating: {
            xPx: 138,
            yPx: 32,
            horizontalRelativeTo: "margin",
            verticalRelativeTo: "margin",
            distLPx: 12,
            distRPx: 12,
            distTPx: 0,
            distBPx: 0,
            wrapType: "square",
            wrapText: "bothSides",
            behindDocument: false
          }
        }
      ]
    };

    const layout = resolveParagraphDualWrappedTextLayout(paragraph, 420, 22, {
      paragraphTopPx: 0
    });

    expect(layout).toBeDefined();
    expect(layout?.geometries[0]?.imageTopPx).toBeGreaterThan(32);
  });

  it("treats top-and-bottom centered images as full-width excluded rows", async () => {
    const { resolveParagraphDualWrappedTextLayout } = await import(
      "../../packages/react-viewer/src/editor"
    );

    const paragraph: ParagraphNode = {
      type: "paragraph",
      children: [
        {
          type: "image",
          widthPx: 26,
          heightPx: 26,
          floating: {
            yPx: 22,
            horizontalAlign: "center",
            horizontalRelativeTo: "page",
            verticalRelativeTo: "paragraph",
            wrapType: "topAndBottom",
            distLPx: 12,
            distRPx: 12,
            distTPx: 0,
            distBPx: 0,
            behindDocument: false
          }
        },
        {
          type: "text",
          text: "Centered images should leave some lines above, skip the image rows, and continue below."
        }
      ]
    };

    const layout = resolveParagraphDualWrappedTextLayout(paragraph, 320, 22);

    expect(layout).toBeDefined();
    expect(layout?.geometries[0]?.exclusion.left).toBe(0);
    expect(layout?.geometries[0]?.exclusion.right).toBe(320);
    expect(layout?.layout.lines[0]?.y ?? 0).toBeLessThan(layout?.geometries[0]?.imageTopPx ?? 0);
    const lowerLines = layout?.layout.lines.filter(
      (line) => line.y >= (layout?.geometries[0]?.exclusion.bottom ?? 0) - 1
    );
    expect((lowerLines?.length ?? 0) > 0).toBe(true);
  });

  it("tracks only wrapped exclusion geometries when a paragraph also has absolute floats", async () => {
    const { resolveParagraphDualWrappedTextLayout } = await import(
      "../../packages/react-viewer/src/editor"
    );

    const paragraph: ParagraphNode = {
      type: "paragraph",
      children: [
        {
          type: "image",
          widthPx: 26,
          heightPx: 26,
          floating: {
            yPx: 1,
            horizontalAlign: "center",
            horizontalRelativeTo: "page",
            verticalRelativeTo: "paragraph",
            distLPx: 12,
            distRPx: 12,
            distTPx: 0,
            distBPx: 0,
            wrapType: "topAndBottom",
            behindDocument: false
          }
        },
        {
          type: "image",
          widthPx: 102,
          heightPx: 102,
          floating: {
            horizontalAlign: "right",
            horizontalRelativeTo: "margin",
            verticalAlign: "top",
            verticalRelativeTo: "margin",
            distLPx: 12,
            distRPx: 12,
            distTPx: 0,
            distBPx: 0,
            wrapType: "square",
            wrapText: "bothSides",
            behindDocument: false
          }
        },
        {
          type: "text",
          text:
            "Centered images like this are useful for large pictures that should be a focus of attention."
        }
      ]
    };

    const layout = resolveParagraphDualWrappedTextLayout(paragraph, 596, 22);

    expect(layout).toBeDefined();
    expect(layout?.geometries).toHaveLength(1);
    expect(layout?.geometries[0]?.imageIndex).toBe(0);
  });

  it("does not promote a dragged inline image into a dual-wrap preview exclusion", async () => {
    const { resolveParagraphDualWrappedTextLayout } = await import(
      "../../packages/react-viewer/src/editor"
    );

    const paragraph: ParagraphNode = {
      type: "paragraph",
      children: [
        {
          type: "text",
          text: "Inline images can preview as wrapped content while dragging."
        },
        {
          type: "image",
          widthPx: 14,
          heightPx: 14
        }
      ]
    };

    const layout = resolveParagraphDualWrappedTextLayout(paragraph, 260, 22, {
      movePreviewByImageIndex: new Map([
        [
          1,
          {
            deltaX: 80,
            deltaY: 18,
            baseLeftPx: 72,
            baseTopPx: 0
          }
        ]
      ]),
      widthPxByImageIndex: new Map([[1, 14]]),
      heightPxByImageIndex: new Map([[1, 14]])
    });

    expect(layout).toBeUndefined();
  });

  it("uses explicit drag bases for wrapped floating image previews", async () => {
    const { resolveDualWrappedFloatingImageGeometry } = await import(
      "../../packages/react-viewer/src/editor"
    );

    const geometry = resolveDualWrappedFloatingImageGeometry(
      {
        type: "image",
        widthPx: 26,
        heightPx: 26,
        floating: {
          yPx: 1,
          horizontalAlign: "center",
          horizontalRelativeTo: "page",
          verticalRelativeTo: "paragraph",
          distLPx: 12,
          distRPx: 12,
          distTPx: 0,
          distBPx: 0,
          wrapType: "topAndBottom",
          behindDocument: false
        }
      },
      320,
      {
        baseLeftPx: 147,
        baseTopPx: 38,
        deltaY: 22
      }
    );

    expect(geometry).toBeDefined();
    expect(geometry?.imageLeftPx).toBe(147);
    expect(geometry?.imageTopPx).toBe(60);
    expect(geometry?.exclusion).toEqual({
      left: 0,
      right: 320,
      top: 60,
      bottom: 86
    });
  });

  it("stores dragged wrapped side-floats without switching them into interior wraps", async () => {
    const { resolveWrappedFloatingImageDropPatch } = await import(
      "../../packages/react-viewer/src/editor"
    );

    const patch = resolveWrappedFloatingImageDropPatch(
      {
        type: "image",
        widthPx: 120,
        heightPx: 96,
        floating: {
          xPx: -6,
          yPx: 18,
          distLPx: 12,
          distRPx: 12,
          distTPx: 4,
          distBPx: 4,
          wrapType: "square",
          wrapText: "bothSides",
          behindDocument: false
        }
      },
      420,
      30,
      26,
      {
        widthPx: 120,
        heightPx: 96
      }
    );

    expect(patch.horizontalAlign).toBe("left");
    expect(patch.xPx).toBe(30);
    expect(patch.yPx).toBe(22);
  });

  it("keeps explicit horizontal offsets on aligned wrapped floats", async () => {
    const { wrappedFloatingImageStyle } = await import(
      "../../packages/react-viewer/src/editor"
    );

    const style = wrappedFloatingImageStyle(
      {
        type: "image" as const,
        widthPx: 120,
        heightPx: 96,
        floating: {
          xPx: 36,
          yPx: 0,
          horizontalAlign: "left",
          distLPx: 12,
          distRPx: 12,
          distTPx: 0,
          distBPx: 4,
          wrapType: "square",
          wrapText: "bothSides",
          behindDocument: false
        }
      },
      { containerWidthPx: 420 }
    );

    expect(style.marginLeft).toBe(36);
  });

  it("ignores tiny vertical jitter when dropping top-and-bottom wrapped images", async () => {
    const { resolveWrappedFloatingImageDropPatch } = await import(
      "../../packages/react-viewer/src/editor"
    );

    const patch = resolveWrappedFloatingImageDropPatch(
      {
        type: "image",
        widthPx: 518,
        heightPx: 89,
        floating: {
          xPx: 6,
          yPx: 30,
          distLPx: 12,
          distRPx: 12,
          distTPx: 0,
          distBPx: 0,
          wrapType: "topAndBottom",
          behindDocument: false
        },
        syntheticTextBox: true,
        sourceXml: "<w:drawing><pic:pic/></w:drawing>"
      },
      640,
      12,
      35,
      {
        widthPx: 518,
        heightPx: 89
      }
    );

    expect(patch.yPx).toBe(30);
  });

  it("lets full-width top-and-bottom exclusions overflow the anchor paragraph box", async () => {
    const {
      resolveParagraphDualWrappedTextLayout,
      wrappedPretextParagraphBlockHeightPx
    } = await import("../../packages/react-viewer/src/editor");

    const paragraph: ParagraphNode = {
      type: "paragraph",
      children: [
        {
          type: "image",
          widthPx: 518,
          heightPx: 89,
          floating: {
            xPx: 6,
            yPx: 60,
            horizontalRelativeTo: "column",
            verticalRelativeTo: "paragraph",
            distLPx: 12,
            distRPx: 12,
            distTPx: 0,
            distBPx: 0,
            wrapType: "topAndBottom",
            behindDocument: false
          },
          syntheticTextBox: true,
          sourceXml: "<w:drawing><pic:pic/></w:drawing>"
        },
        {
          type: "text",
          text: "Nursing Facility Bulletin 191"
        }
      ]
    };

    const layout = resolveParagraphDualWrappedTextLayout(paragraph, 640, 22);

    expect(layout).toBeDefined();
    if (!layout) {
      return;
    }

    expect(layout.layout.height).toBeGreaterThan(100);
    expect(wrappedPretextParagraphBlockHeightPx(layout.layout)).toBe(22);
  });

  it("keeps grouped top-and-bottom mastheads from letting body text rise above them", async () => {
    const { resolveParagraphDualWrappedTextLayout } = await import(
      "../../packages/react-viewer/src/editor"
    );

    const paragraph: ParagraphNode = {
      type: "paragraph",
      children: [
        {
          type: "image",
          widthPx: 518,
          heightPx: 89,
          floating: {
            xPx: 6,
            yPx: 30,
            horizontalRelativeTo: "column",
            verticalRelativeTo: "paragraph",
            distLPx: 12,
            distRPx: 12,
            distTPx: 0,
            distBPx: 0,
            wrapType: "topAndBottom",
            behindDocument: false
          },
          syntheticTextBox: true,
          sourceXml:
            "<w:drawing><wp:anchor><wp:wrapTopAndBottom/><a:graphic><a:graphicData><wpg:wgp><pic:pic/><wps:wsp/></wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing>"
        },
        {
          type: "text",
          text: "Nursing Facility Bulletin 191"
        }
      ]
    };

    const layout = resolveParagraphDualWrappedTextLayout(paragraph, 640, 22);

    expect(layout).toBeDefined();
    if (!layout) {
      return;
    }

    expect(layout.geometries[0]?.imageTopPx).toBe(0);
    expect(layout.layout.lines[0]?.y ?? 0).toBeGreaterThanOrEqual(
      layout.geometries[0]?.exclusion.bottom ?? 0
    );
  });

  it("preserves right alignment for single-slot wrapped lines", async () => {
    const { resolveParagraphDualWrappedTextLayout } = await import(
      "../../packages/react-viewer/src/editor"
    );

    const paragraph: ParagraphNode = {
      type: "paragraph",
      style: {
        align: "right"
      },
      children: [
        {
          type: "image",
          widthPx: 44,
          heightPx: 44,
          floating: {
            xPx: 8,
            yPx: 0,
            distLPx: 8,
            distRPx: 8,
            distTPx: 0,
            distBPx: 0,
            wrapType: "square",
            wrapText: "bothSides",
            behindDocument: false
          }
        },
        {
          type: "text",
          text: "INVOICE"
        }
      ]
    };

    const layout = resolveParagraphDualWrappedTextLayout(paragraph, 320, 22);

    expect(layout).toBeDefined();
    expect(layout?.layout.lines).toHaveLength(1);
    expect(layout?.layout.lines[0]?.fragments).toHaveLength(1);

    const fragment = layout?.layout.lines[0]?.fragments[0];
    expect(fragment?.x ?? 0).toBeGreaterThan(200);
  });

  it("keeps whole words together when a later wrap slot can fit them", async () => {
    const { resolveParagraphDualWrappedTextLayout } = await import(
      "../../packages/react-viewer/src/editor"
    );

    const paragraph: ParagraphNode = {
      type: "paragraph",
      children: [
        {
          type: "image",
          widthPx: 120,
          heightPx: 110,
          floating: {
            xPx: 80,
            yPx: 0,
            distLPx: 8,
            distRPx: 8,
            distTPx: 0,
            distBPx: 4,
            wrapType: "square",
            wrapText: "bothSides",
            behindDocument: false
          }
        },
        {
          type: "text",
          text:
            "Documents may contain images. For example, there is an image of the web accessibility symbol."
        }
      ]
    };

    const layout = resolveParagraphDualWrappedTextLayout(paragraph, 400, 22);

    expect(layout).toBeDefined();
    const firstLine = layout?.layout.lines[0];
    expect(firstLine?.fragments).toHaveLength(1);
    expect(firstLine?.fragments[0]?.text.startsWith("Documents")).toBe(true);
    expect(firstLine?.fragments[0]?.x ?? 0).toBeGreaterThanOrEqual(200);
  });
});
