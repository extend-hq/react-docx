import { describe, expect, it } from "vitest";
import type { TableNode } from "@extend-ai/react-docx-doc-model";
import {
  buildParagraphPretextLayoutSource,
  resolveLineRangeWithinVerticalSlice,
  resolveTableCellParagraphVisualBottomPx,
  tableCellParagraphFitsFullyWithinSlice,
  tableCellFragmentRowSpan,
  tableCellTextDirectionCss,
} from "../../packages/react-viewer/src/editor";

describe("table cell line slice", () => {
  it("keeps the physical grid occupied when a vertical merge crosses a page", () => {
    const table: TableNode = {
      type: "table", style: { columnWidthsTwips: [300, 600, 600, 900] },
      rows: [0, 1, 2, 3].map((index) => ({
        type: "table-row", style: { gridBefore: 1 },
        cells: [
          { type: "table-cell", nodes: [], style: { gridSpan: 2,
            ...(index === 0 ? { rowSpan: 4 } : { vMergeContinuation: true }) } },
          { type: "table-cell", nodes: [] },
        ],
      })),
    };
    expect(tableCellFragmentRowSpan(table, 0, 0, 0, 2)).toBe(2);
    expect(tableCellFragmentRowSpan(table, 1, 0, 0, 2)).toBe(0);
    expect(tableCellFragmentRowSpan(table, 2, 0, 2, 4)).toBe(2);
    expect(tableCellFragmentRowSpan(table, 3, 0, 2, 4)).toBe(0);
    expect(tableCellFragmentRowSpan(table, 2, 1, 2, 4)).toBe(1);
    expect(tableCellFragmentRowSpan(table, 3, 0, 3, 4)).toBe(1);
  });

  it("maps vertical text to the document's flow and glyph orientation", () => {
    const cell = { type: "table-cell" as const, nodes: [], style: { textDirection: "btLr" as const } };
    expect(tableCellTextDirectionCss(cell, 120)).toMatchObject({ writingMode: "vertical-rl", textOrientation: "sideways", transform: "rotate(180deg)", height: 120 });
    expect(tableCellTextDirectionCss({ ...cell, style: { textDirection: "tbRlV" } }, 120)).toMatchObject({ textOrientation: "upright", transform: undefined });
    expect(tableCellTextDirectionCss({ ...cell, style: { textDirection: "lrTb" } })).toBeUndefined();
  });
  it("returns the lines whose bottoms fit inside a slice window", () => {
    expect(
      resolveLineRangeWithinVerticalSlice([0, 20, 40, 60], 20, 15, 65)
    ).toEqual({
      startLineIndex: 0,
      endLineIndex: 3,
      totalLineCount: 4,
      lineHeightPx: 20,
    });
  });

  it("moves boundary-crossing lines to the following slice", () => {
    expect(
      resolveLineRangeWithinVerticalSlice([0, 20, 40], 20, 5, 15)
    ).toBeUndefined();
    expect(
      resolveLineRangeWithinVerticalSlice([0, 20, 40], 20, 15, 35)
    ).toEqual({
      startLineIndex: 0,
      endLineIndex: 1,
      totalLineCount: 3,
      lineHeightPx: 20,
    });
  });

  it("hands a page-boundary line to the following slice once", () => {
    expect(
      resolveLineRangeWithinVerticalSlice([100], 20, 0, 110)
    ).toBeUndefined();
    expect(resolveLineRangeWithinVerticalSlice([100], 20, 110, 220)).toEqual({
      startLineIndex: 0,
      endLineIndex: 1,
      totalLineCount: 1,
      lineHeightPx: 20,
    });
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
    expect(source?.text).toBe("•\tthe creditor induces the consumer");
    expect(source?.runs[1]?.endOffset).toBe(
      (source?.runs[1]?.startOffset ?? 0) + 1
    );
  });
});
