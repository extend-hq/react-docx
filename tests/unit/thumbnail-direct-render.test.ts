import { afterEach, describe, expect, it, vi } from "vitest";
import {
  blitDocxThumbnailSurface,
  renderDocxThumbnailSnapshotSurface,
  type DocxPageThumbnailRenderSnapshot,
} from "../../packages/react-viewer/src/thumbnail-raster";

/**
 * A 2D context stub that records the operations the direct thumbnail renderer
 * relies on. jsdom/node have no canvas, so the recorder both lets the real
 * paint path run and lets us assert the hot-path optimizations actually fire:
 * font is set per run (not per token), token widths are measured once per
 * (font, text), and text/strokes land where expected.
 */
interface RecordingContext {
  fontSets: string[];
  measuredTexts: string[];
  filledTexts: string[];
}

function createRecordingCanvas(): {
  canvas: { width: number; height: number; style: Record<string, string> };
  recorder: RecordingContext;
  widthAssignments: () => number;
  heightAssignments: () => number;
} {
  const recorder: RecordingContext = {
    fontSets: [],
    measuredTexts: [],
    filledTexts: [],
  };
  let currentFont = "10px sans-serif";
  let widthValue = 0;
  let heightValue = 0;
  let widthAssignmentCount = 0;
  let heightAssignmentCount = 0;

  const context = {
    get font(): string {
      return currentFont;
    },
    set font(value: string) {
      currentFont = value;
      recorder.fontSets.push(value);
    },
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    textBaseline: "alphabetic",
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    measureText: (text: string): { width: number } => {
      recorder.measuredTexts.push(text);
      // Width is irrelevant to the assertions; keep it positive + deterministic.
      return { width: Math.max(1, text.length * 7) };
    },
    fillText: (text: string): void => {
      recorder.filledTexts.push(text);
    },
    fillRect: (): void => {},
    strokeRect: (): void => {},
    beginPath: (): void => {},
    rect: (): void => {},
    clip: (): void => {},
    save: (): void => {},
    restore: (): void => {},
    setTransform: (): void => {},
    clearRect: (): void => {},
    drawImage: (): void => {},
  };

  const canvas = {
    style: {} as Record<string, string>,
    get width(): number {
      return widthValue;
    },
    set width(value: number) {
      widthValue = value;
      widthAssignmentCount += 1;
    },
    get height(): number {
      return heightValue;
    },
    set height(value: number) {
      heightValue = value;
      heightAssignmentCount += 1;
    },
    getContext: (kind: string) => (kind === "2d" ? context : null),
  };

  return {
    canvas,
    recorder,
    widthAssignments: () => widthAssignmentCount,
    heightAssignments: () => heightAssignmentCount,
  };
}

function stubCanvasDocument(factory: () => { getContext: (kind: string) => unknown }): void {
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag !== "canvas") {
        throw new Error(`unexpected createElement(${tag})`);
      }
      return factory();
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renderDocxThumbnailSnapshotSurface (direct paint path)", () => {
  it("draws run text and reuses font/measurements across a run's tokens", () => {
    const created = createRecordingCanvas();
    stubCanvasDocument(() => created.canvas);

    const snapshot: DocxPageThumbnailRenderSnapshot = {
      key: "page-1",
      sourceWidthPx: 600,
      sourceHeightPx: 800,
      elements: [
        {
          kind: "paragraph",
          xPx: 10,
          yPx: 10,
          // Wide enough that the five "aa" tokens never wrap.
          widthPx: 560,
          heightPx: 40,
          runs: [{ text: "aa aa aa aa aa", fontSizePx: 12 }],
        },
      ],
    };

    renderDocxThumbnailSnapshotSurface({
      snapshot,
      widthPx: 300,
      heightPx: 400,
      pixelWidthPx: 300,
      pixelHeightPx: 400,
    });

    const { recorder } = created;

    // Correctness: the run's word is actually painted, once per occurrence.
    expect(recorder.filledTexts.filter((text) => text === "aa")).toHaveLength(5);

    // Measure cache: each distinct (font, token) is measured exactly once even
    // though the tokens repeat across the line.
    expect(recorder.measuredTexts.filter((text) => text === "aa")).toHaveLength(
      1
    );
    expect(recorder.measuredTexts.filter((text) => text === " ")).toHaveLength(
      1
    );

    // Font dedup: a single-run, ~9-token paragraph sets the font a tiny constant
    // number of times (once in layout, once in draw), not once per token.
    expect(recorder.fontSets.length).toBeLessThanOrEqual(3);
    expect(recorder.fontSets.length).toBeLessThan(
      recorder.filledTexts.length
    );
  });

  it("only switches font at run boundaries in the draw pass", () => {
    const created = createRecordingCanvas();
    stubCanvasDocument(() => created.canvas);

    const snapshot: DocxPageThumbnailRenderSnapshot = {
      key: "page-2",
      sourceWidthPx: 600,
      sourceHeightPx: 800,
      elements: [
        {
          kind: "paragraph",
          xPx: 10,
          yPx: 10,
          widthPx: 560,
          heightPx: 40,
          runs: [
            { text: "bold bold ", bold: true, fontSizePx: 12 },
            { text: "plain plain", fontSizePx: 12 },
          ],
        },
      ],
    };

    renderDocxThumbnailSnapshotSurface({
      snapshot,
      widthPx: 300,
      heightPx: 400,
      pixelWidthPx: 300,
      pixelHeightPx: 400,
    });

    const distinctFonts = new Set(created.recorder.fontSets);
    // Two distinct run fonts (bold vs plain); each set a small number of times.
    expect(distinctFonts.size).toBe(2);
    expect(created.recorder.fontSets.length).toBeLessThanOrEqual(4);
    expect(created.recorder.filledTexts.join(" ")).toContain("bold");
    expect(created.recorder.filledTexts.join(" ")).toContain("plain");
  });

  it("renders tables and image placeholders without error", () => {
    const created = createRecordingCanvas();
    stubCanvasDocument(() => created.canvas);

    const snapshot: DocxPageThumbnailRenderSnapshot = {
      key: "page-3",
      sourceWidthPx: 600,
      sourceHeightPx: 800,
      elements: [
        {
          kind: "table",
          xPx: 10,
          yPx: 10,
          widthPx: 400,
          heightPx: 120,
          cells: [
            {
              xPx: 0,
              yPx: 0,
              widthPx: 200,
              heightPx: 40,
              runs: [{ text: "Cell text", fontSizePx: 11 }],
            },
          ],
        },
        {
          kind: "image-placeholder",
          xPx: 10,
          yPx: 150,
          widthPx: 120,
          heightPx: 90,
        },
      ],
    };

    const surface = renderDocxThumbnailSnapshotSurface({
      snapshot,
      widthPx: 300,
      heightPx: 400,
      pixelWidthPx: 300,
      pixelHeightPx: 400,
    });

    expect(surface.width).toBe(300);
    expect(surface.height).toBe(400);
    expect(created.recorder.filledTexts.join(" ")).toContain("Cell");
  });
});

describe("blitDocxThumbnailSurface (size guard)", () => {
  it("only reallocates the backing store when the pixel size changes", () => {
    const surfaceCanvas = createRecordingCanvas().canvas;
    const target = createRecordingCanvas();

    const resolution = {
      widthPx: 150,
      heightPx: 200,
      pixelWidthPx: 150,
      pixelHeightPx: 200,
    };

    blitDocxThumbnailSurface(
      surfaceCanvas as unknown as HTMLCanvasElement,
      target.canvas as unknown as HTMLCanvasElement,
      resolution
    );
    blitDocxThumbnailSurface(
      surfaceCanvas as unknown as HTMLCanvasElement,
      target.canvas as unknown as HTMLCanvasElement,
      resolution
    );

    // Two blits at the same size: the buffer is sized exactly once.
    expect(target.widthAssignments()).toBe(1);
    expect(target.heightAssignments()).toBe(1);

    // A different size re-sizes the buffer again.
    blitDocxThumbnailSurface(
      surfaceCanvas as unknown as HTMLCanvasElement,
      target.canvas as unknown as HTMLCanvasElement,
      { widthPx: 75, heightPx: 100, pixelWidthPx: 75, pixelHeightPx: 100 }
    );
    expect(target.widthAssignments()).toBe(2);
    expect(target.heightAssignments()).toBe(2);
  });
});
