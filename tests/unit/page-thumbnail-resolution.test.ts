import { describe, expect, it } from "vitest";
import { resolveDocxPageThumbnailResolution } from "../../packages/react-viewer/src/editor";

describe("page thumbnail resolution", () => {
  it("uses a 180px default max width and preserves page aspect ratio", () => {
    expect(
      resolveDocxPageThumbnailResolution({
        sourceWidthPx: 900,
        sourceHeightPx: 1200,
      })
    ).toEqual({
      widthPx: 180,
      heightPx: 240,
      pixelWidthPx: 180,
      pixelHeightPx: 240,
      scale: 0.2,
    });
  });

  it("fits thumbnails into an explicit height bound when that is tighter", () => {
    expect(
      resolveDocxPageThumbnailResolution({
        sourceWidthPx: 900,
        sourceHeightPx: 1200,
        maxWidthPx: 240,
        maxHeightPx: 100,
      })
    ).toEqual({
      widthPx: 75,
      heightPx: 100,
      pixelWidthPx: 75,
      pixelHeightPx: 100,
      scale: 100 / 1200,
    });
  });

  it("supports a higher output pixel ratio without changing CSS thumbnail size", () => {
    expect(
      resolveDocxPageThumbnailResolution({
        sourceWidthPx: 900,
        sourceHeightPx: 1200,
        maxWidthPx: 150,
        pixelRatio: 2,
      })
    ).toEqual({
      widthPx: 150,
      heightPx: 200,
      pixelWidthPx: 300,
      pixelHeightPx: 400,
      scale: 150 / 900,
    });
  });

  it("supports an xlsx-style numeric resolution bound", () => {
    expect(
      resolveDocxPageThumbnailResolution({
        sourceWidthPx: 900,
        sourceHeightPx: 1200,
        resolution: 200,
      })
    ).toEqual({
      widthPx: 150,
      heightPx: 200,
      pixelWidthPx: 150,
      pixelHeightPx: 200,
      scale: 200 / 1200,
    });
  });
});
