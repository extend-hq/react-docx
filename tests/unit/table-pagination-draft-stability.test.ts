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

describe("table pagination draft stability", () => {
  it("uses stable measured heights for imported tables when there is no active draft", () => {
    const nodes: DocModel["nodes"] = [createTable(2)];

    expect(
      resolveTableMeasuredRowHeightsForPagination(
        nodes,
        {
          0: [24, 32]
        },
        {
          allowMeasuredImportPagination: true
        }
      )
    ).toEqual({
      0: [24, 28]
    });
  });

  it("clamps untouched import measurements to the DOCX row estimate band", () => {
    const nodes: DocModel["nodes"] = [
      {
        type: "table",
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
          0: [120, 96]
        },
        {
          allowMeasuredImportPagination: true,
          pageContentWidthPxByNodeIndex: new Map([[0, 400]])
        }
      )
    ).toEqual({
      0: [28, 28]
    });
  });

  it("uses live measured heights for the actively edited table only", () => {
    const nodes: DocModel["nodes"] = [createTable(2)];

    expect(
      resolveTableMeasuredRowHeightsForPagination(
        nodes,
        {
          0: [24, 48]
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
