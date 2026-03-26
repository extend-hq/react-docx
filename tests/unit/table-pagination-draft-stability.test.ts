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
      0: [24, 32]
    });
  });

  it("ignores live measured heights while a table cell draft is active", () => {
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
    ).toBeUndefined();
  });
});
