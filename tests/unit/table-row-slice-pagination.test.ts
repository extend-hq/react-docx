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

function createTwoRowModel(): DocModel {
  return {
    nodes: [
      {
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
          },
          {
            type: "table-row",
            cells: [
              {
                type: "table-cell",
                nodes: [
                  {
                    type: "paragraph",
                    children: [
                      {
                        type: "text",
                        text: "Trailing row"
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

function createExplicitTallSplitRowModel(): DocModel {
  return {
    nodes: [
      {
        type: "table",
        blockId: "table-0",
        rows: [
          {
            type: "table-row",
            style: {
              heightTwips: 240,
              heightRule: "atLeast"
            },
            cells: [
              {
                type: "table-cell",
                nodes: Array.from({ length: 30 }, (_, index) => ({
                  type: "paragraph" as const,
                  children: [
                    {
                      type: "text" as const,
                      text: `Tall explicit row paragraph ${index + 1}`
                    }
                  ]
                }))
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

function createNestedTableSplitRowModel(): DocModel {
  return {
    nodes: [
      {
        type: "table",
        blockId: "table-0",
        style: {
          cellMarginTwips: {
            topTwips: 0,
            rightTwips: 0,
            bottomTwips: 0,
            leftTwips: 0
          }
        },
        rows: [
          {
            type: "table-row",
            style: {
              heightTwips: 1050,
              heightRule: "exact"
            },
            cells: [
              {
                type: "table-cell",
                nodes: [
                  {
                    type: "paragraph",
                    children: [{ type: "text", text: "Lead row" }]
                  }
                ]
              }
            ]
          },
          {
            type: "table-row",
            cells: [
              {
                type: "table-cell",
                nodes: [
                  {
                    type: "table",
                    rows: [
                      {
                        type: "table-row",
                        style: {
                          heightTwips: 600,
                          heightRule: "exact"
                        },
                        cells: [
                          {
                            type: "table-cell",
                            nodes: [
                              {
                                type: "paragraph",
                                children: [
                                  { type: "text", text: "Nested row 1" }
                                ]
                              }
                            ]
                          }
                        ]
                      },
                      {
                        type: "table-row",
                        style: {
                          heightTwips: 900,
                          heightRule: "exact"
                        },
                        cells: [
                          {
                            type: "table-cell",
                            nodes: [
                              {
                                type: "paragraph",
                                children: [
                                  { type: "text", text: "Nested row 2" }
                                ]
                              }
                            ]
                          }
                        ]
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
          "table-0": { rowHeightsPx: [260], contentSignature: "" }
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

  it("keeps following rows on the same page after the last row slice remainder", () => {
    const model = createTwoRowModel();
    const measuredTableRowHeightsByNodeIndex =
      resolveTableMeasuredRowHeightsForPagination(
        model.nodes,
        {
          "table-0": { rowHeightsPx: [250, 80], contentSignature: "" }
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
            totalRowHeightPx: 250
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
            totalRowHeightPx: 250
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
            sliceHeightPx: 10,
            totalRowHeightPx: 250
          }
        },
        {
          nodeIndex: 0,
          tableRowRange: {
            startRowIndex: 1,
            endRowIndex: 2
          }
        }
      ]
    ]);
  });

  it("slices split-capable rows into usable remaining page space", () => {
    const model = createTwoRowModel();
    const table = model.nodes[0];
    if (table?.type === "table") {
      table.rows[0]!.style = {
        ...(table.rows[0]!.style ?? {}),
        heightTwips: 1050,
        heightRule: "exact"
      };
    }
    const measuredTableRowHeightsByNodeIndex =
      resolveTableMeasuredRowHeightsForPagination(
        model.nodes,
        {
          "table-0": { rowHeightsPx: [70, 100], contentSignature: "" }
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
          }
        },
        {
          nodeIndex: 0,
          tableRowRange: {
            startRowIndex: 1,
            endRowIndex: 2
          },
          tableRowSlice: {
            rowIndex: 1,
            startOffsetPx: 0,
            sliceHeightPx: 50,
            totalRowHeightPx: 100
          }
        }
      ],
      [
        {
          nodeIndex: 0,
          tableRowRange: {
            startRowIndex: 1,
            endRowIndex: 2
          },
          tableRowSlice: {
            rowIndex: 1,
            startOffsetPx: 50,
            sliceHeightPx: 50,
            totalRowHeightPx: 100
          }
        }
      ]
    ]);
  });

  it("snaps nested-table row slices to nested row boundaries", () => {
    const model = createNestedTableSplitRowModel();
    const measuredTableRowHeightsByNodeIndex =
      resolveTableMeasuredRowHeightsForPagination(
        model.nodes,
        {
          "table-0": { rowHeightsPx: [70, 100], contentSignature: "" }
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
          }
        },
        {
          nodeIndex: 0,
          tableRowRange: {
            startRowIndex: 1,
            endRowIndex: 2
          },
          tableRowSlice: {
            rowIndex: 1,
            startOffsetPx: 0,
            sliceHeightPx: 40,
            totalRowHeightPx: 100
          }
        }
      ],
      [
        {
          nodeIndex: 0,
          tableRowRange: {
            startRowIndex: 1,
            endRowIndex: 2
          },
          tableRowSlice: {
            rowIndex: 1,
            startOffsetPx: 40,
            sliceHeightPx: 60,
            totalRowHeightPx: 100
          }
        }
      ]
    ]);
  });

  it("does not cap explicit split-row estimates below multipage cell content", () => {
    const pages = buildDocumentPageNodeSegments(
      createExplicitTallSplitRowModel(),
      120,
      400
    );
    const slices = pages
      .flat()
      .map((segment) => segment.tableRowSlice)
      .filter((slice): slice is NonNullable<typeof slice> => Boolean(slice));

    expect(slices.length).toBeGreaterThan(1);
    expect(slices[0]?.totalRowHeightPx).toBeGreaterThan(120);
    expect(slices.at(-1)?.startOffsetPx ?? 0).toBeGreaterThanOrEqual(120);
  });
});
