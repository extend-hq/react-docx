import { describe, expect, it } from "vitest";
import {
  resolveMaxPretextLineRangeEndIndexThatFits,
  resolvePretextLineRangeContentHeightPx,
} from "../../packages/react-viewer/src/editor";

describe("pretext line slice height", () => {
  it("uses actual line offsets for irregular wrapped line geometry", () => {
    const layout = {
      lineHeightPx: 18,
      lines: [
        { y: 0, fragments: [] },
        { y: 18, fragments: [] },
        { y: 44, fragments: [] },
      ],
    } as any;

    expect(resolvePretextLineRangeContentHeightPx(layout, 0, 1)).toBe(18);
    expect(resolvePretextLineRangeContentHeightPx(layout, 0, 2)).toBe(36);
    expect(resolvePretextLineRangeContentHeightPx(layout, 0, 3)).toBe(62);
    expect(resolvePretextLineRangeContentHeightPx(layout, 1, 3)).toBe(44);
  });

  it("stops before the first line that would overflow the available height", () => {
    const layout = {
      lineHeightPx: 18,
      lines: [
        { y: 0, fragments: [] },
        { y: 18, fragments: [] },
        { y: 44, fragments: [] },
      ],
    } as any;

    expect(resolveMaxPretextLineRangeEndIndexThatFits(layout, 0, 3, 35)).toBe(
      1
    );
    expect(resolveMaxPretextLineRangeEndIndexThatFits(layout, 0, 3, 36)).toBe(
      2
    );
    expect(resolveMaxPretextLineRangeEndIndexThatFits(layout, 0, 3, 61)).toBe(
      2
    );
    expect(resolveMaxPretextLineRangeEndIndexThatFits(layout, 0, 3, 62)).toBe(
      3
    );
  });
});
