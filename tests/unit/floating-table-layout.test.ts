import { describe, expect, it } from "vitest";
import type { TableNode } from "@extend-ai/react-docx-doc-model";

function makeTable(style: TableNode["style"]): TableNode {
  return {
    type: "table",
    rows: [
      {
        type: "table-row",
        cells: [
          {
            type: "table-cell",
            nodes: [{ type: "paragraph", children: [{ type: "text", text: "cell" }] }]
          }
        ]
      }
    ],
    style
  };
}

describe("floating table layout", () => {
  it("estimates width from the column grid when tblW is auto", async () => {
    const { estimateFloatingTableWidthPx } = await import(
      "../../packages/react-viewer/src/editor"
    );

    // demo.docx floating table: gridCols 1818 + 1620 twips ≈ 229px
    const table = makeTable({
      columnWidthsTwips: [1818, 1620],
      floating: { yTwips: 1, verticalAnchor: "text" }
    });
    expect(estimateFloatingTableWidthPx(table, 624)).toBeGreaterThan(220);
    expect(estimateFloatingTableWidthPx(table, 624)).toBeLessThan(240);
    // clamped to the container
    expect(estimateFloatingTableWidthPx(table, 120)).toBe(120);
  });

  it("computes a hugging exclusion for an explicitly positioned floating table", async () => {
    const { resolveFloatingTableGeometry } = await import(
      "../../packages/react-viewer/src/editor"
    );

    const table = makeTable({
      widthTwips: 3438,
      floating: {
        xTwips: 3000,
        yTwips: 450,
        horizontalAnchor: "margin",
        verticalAnchor: "text",
        leftFromTextTwips: 187,
        rightFromTextTwips: 187,
        topFromTextTwips: 0,
        bottomFromTextTwips: 0
      }
    });
    const geometry = resolveFloatingTableGeometry(table, 624, {
      tableWidthPx: 229,
      tableHeightPx: 115
    });

    expect(geometry?.leftPx).toBe(200); // 3000 twips ≈ 200px
    expect(geometry?.topPx).toBe(30); // 450 twips ≈ 30px
    expect(geometry?.exclusion).toEqual({
      left: 188, // 200 - 12px leftFromText
      right: 441, // 200 + 229 + 12px rightFromText
      top: 30,
      bottom: 145
    });
  });

  it("anchors a text-anchored table without x at its indent and snaps sliver bands", async () => {
    const { resolveFloatingTableGeometry } = await import(
      "../../packages/react-viewer/src/editor"
    );

    // demo.docx shape: vertAnchor=text tblpY=1, no tblpX -> table sits at the
    // column left; the left band is a sliver and snaps to the edge.
    const table = makeTable({
      floating: {
        yTwips: 1,
        verticalAnchor: "text",
        rightFromTextTwips: 187,
        bottomFromTextTwips: 72
      }
    });
    const geometry = resolveFloatingTableGeometry(table, 624, {
      tableWidthPx: 229,
      tableHeightPx: 115,
      indentPx: 0
    });

    expect(geometry?.leftPx).toBe(0);
    expect(geometry?.exclusion.left).toBe(0);
    expect(geometry?.exclusion.right).toBe(241); // 229 + 12px rightFromText
    expect(geometry?.exclusion.bottom).toBe(120); // 115 + ~5px bottomFromText
  });

  it("maps margin/page vertical anchors into flow-local tops", async () => {
    const { resolveFloatingTableGeometry } = await import(
      "../../packages/react-viewer/src/editor"
    );

    const table = makeTable({
      floating: {
        xTwips: 0,
        yTwips: 1500, // 100px
        horizontalAnchor: "margin",
        verticalAnchor: "margin"
      }
    });
    const geometry = resolveFloatingTableGeometry(table, 624, {
      tableWidthPx: 200,
      tableHeightPx: 80,
      flowTopPx: 60
    });

    expect(geometry?.topPx).toBe(40); // 100px from margin top - 60px flow top
  });

  it("returns undefined for tables without floating style", async () => {
    const { resolveFloatingTableGeometry } = await import(
      "../../packages/react-viewer/src/editor"
    );

    expect(
      resolveFloatingTableGeometry(makeTable(undefined), 624, {
        tableWidthPx: 200,
        tableHeightPx: 80
      })
    ).toBeUndefined();
  });

  it("keeps floating whole-table segments out of the flow height", async () => {
    const { estimateRenderedPageSegmentHeightPx } = await import(
      "../../packages/react-viewer/src/editor"
    );

    const floatingTable = makeTable({
      floating: { yTwips: 1, verticalAnchor: "text" }
    });
    const inlineTable = makeTable(undefined);
    const model = { nodes: [floatingTable], metadata: {} } as never;

    expect(
      estimateRenderedPageSegmentHeightPx(
        floatingTable,
        { nodeIndex: 0 },
        model,
        624
      )
    ).toBe(0);
    expect(
      estimateRenderedPageSegmentHeightPx(
        inlineTable,
        { nodeIndex: 0 },
        model,
        624
      )
    ).toBeGreaterThan(0);
  });
});
