import { describe, expect, it } from "vitest";
import type { DocModel } from "../../packages/doc-model/src";
import {
  buildDocumentPageNodeSegments,
  resolveTableMeasuredRowHeightsForPagination
} from "../../packages/react-viewer/src/editor";

function createModel(): DocModel {
  return {
    nodes: [
      {
        type: "table",
        rows: [
          {
            type: "table-row",
            style: {
              cantSplit: true
            },
            cells: [
              {
                type: "table-cell",
                nodes: [
                  {
                    type: "paragraph",
                    children: [
                      {
                        type: "text",
                        text: "Oversize row"
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ],
    metadata: {
      sourceParts: 1,
      warnings: [],
      headerSections: [],
      footerSections: [],
      paragraphStyles: []
    }
  };
}

describe("table row slice pagination", () => {
  it("slices oversize cantSplit rows instead of rendering one overflowing row", () => {
    const model = createModel();
    const measuredTableRowHeightsByNodeIndex =
      resolveTableMeasuredRowHeightsForPagination(
        model.nodes,
        {
          0: [260]
        },
        {
          allowMeasuredImportPagination: true,
          pageContentWidthPxByNodeIndex: new Map([[0, 400]]),
          pageContentHeightPxByNodeIndex: new Map([[0, 120]])
        }
      );

    const pages = buildDocumentPageNodeSegments(
      model,
      120,
      400,
      undefined,
      undefined,
      {
        measuredTableRowHeightsByNodeIndex
      }
    );

    expect(pages).toEqual([
      [
        {
          nodeIndex: 0,
          tableRowRange: {
            startRowIndex: 0,
            endRowIndex: 1
          },
          tableRowSlice: {
            rowIndex: 0,
            startOffsetPx: 0,
            sliceHeightPx: 120,
            totalRowHeightPx: 260
          }
        }
      ],
      [
        {
          nodeIndex: 0,
          tableRowRange: {
            startRowIndex: 0,
            endRowIndex: 1
          },
          tableRowSlice: {
            rowIndex: 0,
            startOffsetPx: 120,
            sliceHeightPx: 120,
            totalRowHeightPx: 260
          }
        }
      ],
      [
        {
          nodeIndex: 0,
          tableRowRange: {
            startRowIndex: 0,
            endRowIndex: 1
          },
          tableRowSlice: {
            rowIndex: 0,
            startOffsetPx: 240,
            sliceHeightPx: 20,
            totalRowHeightPx: 260
          }
        }
      ]
    ]);
  });
});
