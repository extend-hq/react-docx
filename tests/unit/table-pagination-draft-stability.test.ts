import { describe, expect, it } from "vitest";
import type { DocModel, ParagraphNode, TableNode } from "../../packages/doc-model/src";
import { resolveTableMeasuredRowHeightsForPagination } from "../../packages/react-viewer/src/editor";

function createParagraph(text: string): ParagraphNode {
  return {
    type: "paragraph",
    children: [
      {
        type: "text",
        text
      }
    ]
  };
}

function createTable(rowCount: number): TableNode {
  return {
    type: "table",
    blockId: "table-0",
    rows: Array.from({ length: rowCount }, (_, rowIndex) => ({
      type: "table-row" as const,
      cells: [
        {
          type: "table-cell" as const,
          nodes: [createParagraph(`row-${rowIndex}`)]
        }
      ]
    }))
  };
}

function createCantSplitTable(): TableNode {
  return {
    type: "table",
    blockId: "table-0",
    rows: [
      {
        type: "table-row",
        style: {
          cantSplit: true
        },
        cells: [
          {
            type: "table-cell",
            nodes: [createParagraph("short row")]
          }
        ]
      }
    ]
  };
}

describe("table pagination draft stability", () => {
  it("uses stable measured heights for imported tables when there is no active draft", () => {
    const nodes: DocModel["nodes"] = [createTable(2)];

    expect(
      resolveTableMeasuredRowHeightsForPagination(
        nodes,
        {
          "table-0": { rowHeightsPx: [24, 32], contentSignature: "" }
        },
        {
          allowMeasuredImportPagination: true
        }
      )
    ).toEqual({
      0: [24, 32]
    });
  });

  it("preserves untouched import measurements for rows that can split", () => {
    const nodes: DocModel["nodes"] = [
      {
        type: "table",
        blockId: "table-0",
        rows: [
          {
            type: "table-row",
            cells: [
              {
                type: "table-cell",
                nodes: [createParagraph("short row")]
              }
            ]
          },
          {
            type: "table-row",
            cells: [
              {
                type: "table-cell",
                nodes: [createParagraph("second short row")]
              }
            ]
          }
        ]
      }
    ];

    expect(
      resolveTableMeasuredRowHeightsForPagination(
        nodes,
        {
          "table-0": { rowHeightsPx: [120, 96], contentSignature: "" }
        },
        {
          allowMeasuredImportPagination: true,
          pageContentWidthPxByNodeIndex: new Map([[0, 400]])
        }
      )
    ).toEqual({
      0: [120, 96]
    });
  });

  it("keeps clamping cantSplit rows that still fit on a fresh page", () => {
    const nodes: DocModel["nodes"] = [createCantSplitTable()];

    expect(
      resolveTableMeasuredRowHeightsForPagination(
        nodes,
        {
          "table-0": { rowHeightsPx: [96], contentSignature: "" }
        },
        {
          allowMeasuredImportPagination: true,
          pageContentWidthPxByNodeIndex: new Map([[0, 400]]),
          pageContentHeightPxByNodeIndex: new Map([[0, 240]])
        }
      )
    ).toEqual({
      0: [28]
    });
  });

  it("preserves oversize cantSplit row measurements for pagination", () => {
    const nodes: DocModel["nodes"] = [createCantSplitTable()];

    expect(
      resolveTableMeasuredRowHeightsForPagination(
        nodes,
        {
          "table-0": { rowHeightsPx: [260], contentSignature: "" }
        },
        {
          allowMeasuredImportPagination: true,
          pageContentWidthPxByNodeIndex: new Map([[0, 400]]),
          pageContentHeightPxByNodeIndex: new Map([[0, 120]])
        }
      )
    ).toEqual({
      0: [260]
    });
  });

  it("uses live measured heights for the actively edited table only", () => {
    const nodes: DocModel["nodes"] = [createTable(2)];

    expect(
      resolveTableMeasuredRowHeightsForPagination(
        nodes,
        {
          "table-0": { rowHeightsPx: [24, 48], contentSignature: "" }
        },
        {
          allowMeasuredImportPagination: true,
          activeDraftKeys: ["0:1:0"]
        }
      )
    ).toEqual({
      0: [24, 48]
    });
  });
});
