import { afterEach, describe, expect, it, vi } from "vitest";
import {
  renderDocxThumbnailSnapshotSurface,
  type DocxPageThumbnailImageSnapshot,
} from "../../packages/react-viewer/src/thumbnail-raster";

afterEach(() => vi.unstubAllGlobals());

async function drawImageSnapshot(
  image: Omit<DocxPageThumbnailImageSnapshot, "kind" | "src">
): Promise<unknown[][]> {
  const draws: unknown[][] = [];
  const context = {
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    drawImage: (...args: unknown[]) => draws.push(args),
  };
  const canvas = { style: {}, getContext: () => context };
  vi.stubGlobal("document", { createElement: () => canvas });
  vi.stubGlobal("Image", class {
    naturalWidth = 361;
    naturalHeight = 140;
    src = "";
    decode = async (): Promise<void> => {};
  });
  await renderDocxThumbnailSnapshotSurface({
    snapshot: {
      key: "paint-bounds",
      sourceWidthPx: 800,
      sourceHeightPx: 600,
      elements: [{ kind: "image", src: `data:image/svg+xml,${JSON.stringify(image)}`, ...image }],
    },
    widthPx: 800,
    heightPx: 600,
    pixelWidthPx: 800,
    pixelHeightPx: 600,
  });
  return draws;
}

const paintBounds = {
  xPx: -0.5,
  yPx: 0,
  widthPx: 361,
  heightPx: 140,
  layoutWidthPx: 360,
  layoutHeightPx: 140,
};

describe("thumbnail image paint bounds", () => {
  it("paints the full viewport at its fractional offset", async () => {
    const draws = await drawImageSnapshot({
      xPx: 10.25, yPx: 20.5, widthPx: 360, heightPx: 140, paintBounds,
    });
    expect(draws).toHaveLength(1);
    expect(draws[0].slice(1)).toEqual([9.75, 20.5, 361, 140]);
  });

  it("scales the viewport from its reference layout frame", async () => {
    const draws = await drawImageSnapshot({
      xPx: 10, yPx: 20, widthPx: 180, heightPx: 70, paintBounds,
    });
    expect(draws).toHaveLength(1);
    expect(draws[0].slice(1)).toEqual([9.75, 20, 180.5, 70]);
  });

  it("keeps existing layout rounding when metadata is absent", async () => {
    const draws = await drawImageSnapshot({
      xPx: 10.25, yPx: 20.5, widthPx: 180.2, heightPx: 70.1,
    });
    expect(draws).toHaveLength(1);
    expect(draws[0].slice(1)).toEqual([10, 21, 180, 70]);
  });

  it("uses the layout fallback when metadata is invalid", async () => {
    const draws = await drawImageSnapshot({
      xPx: 10, yPx: 20, widthPx: 180, heightPx: 70,
      paintBounds: { ...paintBounds, layoutWidthPx: 0 },
    });
    expect(draws).toHaveLength(1);
    expect(draws[0].slice(1)).toEqual([10, 20, 180, 70]);
  });
});
