import { describe, expect, it } from "vitest";
import {
  buildParagraphPretextLayoutSource,
  resolveLineRangeWithinVerticalSlice,
  resolveTableCellParagraphVisualBottomPx,
  tableCellParagraphFitsFullyWithinSlice,
} from "../../packages/react-viewer/src/editor";

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

  it("uses the visual text bottom when wrapped text exceeds the estimated paragraph height", () => {
    expect(
      resolveTableCellParagraphVisualBottomPx({
        paragraphTopPx: 83,
        paragraphHeightPx: 91,
        textBottomPx: 182,
      })
    ).toBe(182);
  });

  it("requires bottom clearance before treating a table-cell paragraph as fully visible", () => {
    expect(
      tableCellParagraphFitsFullyWithinSlice({
        sliceStartPx: 0,
        sliceBottomPx: 99,
        paragraphTopPx: 60,
        paragraphBottomPx: 98,
      })
    ).toBe(false);
    expect(
      tableCellParagraphFitsFullyWithinSlice({
        sliceStartPx: 0,
        sliceBottomPx: 100,
        paragraphTopPx: 60,
        paragraphBottomPx: 98,
      })
    ).toBe(true);
  });

  it("keeps tabbed table-cell bullets in the pretext slice path", () => {
    const source = buildParagraphPretextLayoutSource(
      {
        type: "paragraph",
        children: [
          {
            type: "text",
            text: "•",
            style: {
              fontFamily: "Calibri",
              fontSize: 11,
            },
          },
          {
            type: "text",
            text: "\t",
            style: {
              fontFamily: "Calibri",
              fontSize: 11,
            },
          },
          {
            type: "text",
            text: "the creditor induces the consumer",
            style: {
              fontFamily: "Calibri",
              fontSize: 11,
            },
          },
        ],
        style: {
          tabStops: [{ positionTwips: 720, alignment: "left" }],
        },
      } as never,
      {
        allowExplicitLineBreakText: true,
        expandTabsForLayout: true,
      }
    );

    expect(source?.runs.map((run) => run.kind)).toEqual(["text", "tab", "text"]);
    expect(source?.runs[1]?.tabWidthPx).toBeGreaterThan(0);
    expect(source?.text.includes("\u00a0")).toBe(true);
  });
});
