import { describe, expect, it } from "vitest";
import { resolveLineRangeWithinVerticalSlice } from "../../packages/react-viewer/src/editor";

describe("table cell line slice", () => {
  it("returns the fully visible lines inside a slice window", () => {
    expect(
      resolveLineRangeWithinVerticalSlice([0, 20, 40, 60], 20, 15, 65)
    ).toEqual({
      startLineIndex: 1,
      endLineIndex: 3,
      totalLineCount: 4,
      lineHeightPx: 20,
    });
  });

  it("returns undefined when no full line fits in the slice", () => {
    expect(
      resolveLineRangeWithinVerticalSlice([0, 20, 40], 20, 5, 15)
    ).toBeUndefined();
  });
});
