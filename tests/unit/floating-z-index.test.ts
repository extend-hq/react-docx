import { describe, expect, it } from "vitest";
import { resolveFloatingZIndex } from "../../packages/react-viewer/src/editor";

describe("floating z-index mapping", () => {
  it("preserves relativeHeight ordering for nearby Word z-index values", () => {
    const lower = resolveFloatingZIndex({
      behindDocument: true,
      zIndex: 251658240
    });
    const higher = resolveFloatingZIndex({
      behindDocument: true,
      zIndex: 251658243
    });

    expect(higher).toBeGreaterThan(lower);
  });

  it("keeps behind-document layers below in-front layers", () => {
    const behind = resolveFloatingZIndex({
      behindDocument: true,
      zIndex: 251658240
    });
    const inFront = resolveFloatingZIndex({
      behindDocument: false,
      zIndex: 0
    });

    expect(inFront).toBeGreaterThan(behind);
  });

  it("keeps behind-document layers in visible non-negative z-index space", () => {
    const behind = resolveFloatingZIndex({
      behindDocument: true,
      zIndex: 251658243
    });

    expect(behind).toBeGreaterThanOrEqual(0);
  });
});
