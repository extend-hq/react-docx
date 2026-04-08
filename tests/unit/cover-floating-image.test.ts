import { describe, expect, it } from "vitest";
import { isLikelyFullPageCoverFloatingImage } from "../../packages/react-viewer/src/editor";
import type { ImageRunNode } from "@react-docx/doc-model";

function floatingImage(
  widthPx: number,
  heightPx: number,
  options?: {
    yPx?: number;
    horizontalRelativeTo?: string;
    verticalRelativeTo?: string;
    behindDocument?: boolean;
    wrapType?: ImageRunNode["floating"]["wrapType"];
  }
): ImageRunNode {
  return {
    type: "image",
    widthPx,
    heightPx,
    floating: {
      xPx: 0,
      yPx: options?.yPx ?? -72,
      horizontalRelativeTo: options?.horizontalRelativeTo ?? "margin",
      verticalRelativeTo: options?.verticalRelativeTo ?? "paragraph",
      behindDocument: options?.behindDocument ?? true,
      wrapType: options?.wrapType ?? "none"
    }
  };
}

describe("cover floating image detection", () => {
  it("treats large behind-document paragraph-anchored art as full-page cover content", () => {
    expect(isLikelyFullPageCoverFloatingImage(floatingImage(762, 997), 794, 1123)).toBe(true);
  });

  it("does not treat smaller overlay art as full-page cover content", () => {
    expect(isLikelyFullPageCoverFloatingImage(floatingImage(362, 399), 794, 1123)).toBe(false);
  });

  it("does not treat wrapped or foreground images as full-page cover content", () => {
    expect(
      isLikelyFullPageCoverFloatingImage(
        floatingImage(762, 997, {
          wrapType: "square"
        }),
        794,
        1123
      )
    ).toBe(false);
    expect(
      isLikelyFullPageCoverFloatingImage(
        floatingImage(762, 997, {
          behindDocument: false
        }),
        794,
        1123
      )
    ).toBe(false);
  });
});
