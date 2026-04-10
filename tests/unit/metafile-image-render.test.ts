import { describe, expect, it } from "vitest";
import {
  imageUsesPlaceholderFallback,
  resolveRenderableImageSource,
  unsupportedImageFallbackLabel
} from "../../packages/react-viewer/src/image-render";

describe("metafile image rendering", () => {
  it("falls back to placeholder badges for raw WMF and EMF sources", () => {
    const wmfImage = {
      contentType: "image/wmf",
      src: "data:image/wmf;base64,AQIDBA=="
    };
    const emfImage = {
      contentType: "image/emf",
      src: "data:image/emf;base64,AQIDBA=="
    };

    expect(imageUsesPlaceholderFallback(wmfImage)).toBe(true);
    expect(imageUsesPlaceholderFallback(emfImage)).toBe(true);
    expect(resolveRenderableImageSource(wmfImage)).toBeUndefined();
    expect(resolveRenderableImageSource(emfImage)).toBeUndefined();
    expect(unsupportedImageFallbackLabel(wmfImage, 96, 96)).toBe("WMF");
    expect(unsupportedImageFallbackLabel(emfImage, 96, 96)).toBe("EMF");
  });
});
