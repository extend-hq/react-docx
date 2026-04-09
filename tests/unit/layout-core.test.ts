import { describe, expect, it } from "vitest";
import type { DocModel } from "@extend-ai/react-docx-doc-model";
import {
  buildDocumentPageNodeSegments,
  buildLayoutSnapshot,
  collectDocxEstimatedOverflowBreakStartNodeIndexes,
  paragraphHasLastRenderedPageBreak,
  paragraphHasPageBreakBefore,
  paragraphLetterheadColumnGroupAtSegmentOffset,
  resolveDocumentSectionsFromMetadata,
  resolvePaginationSectionMetricsIndexForNodeIndex,
  resolveParagraphBeforeSpacingPx,
  resolveDocumentForLayout,
  resolveSectionIndexForNodeIndex,
  resolveSectionPropertiesXmlForNodeIndex,
  scorePaginationAgainstStoredPageBreaks,
  scalePaginationSectionMetricsHeights,
  selectSectionVariantForPage,
  sectionTitlePageEnabled,
  sectionBreakPropertiesStartNewPage
} from "@extend-ai/react-docx-layout-core";

function createModel(): DocModel {
  return {
    nodes: [
      {
        type: "paragraph",
        children: [
          {
            type: "text",
            text: "Hello layout core"
          }
        ]
      },
      {
        type: "table",
        rows: [
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
                        text: "Cell text"
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
      sourceParts: 4,
      warnings: ["legacy warning"],
      documentPageCount: 2,
      sections: [
        {
          startNodeIndex: 0,
          headerSections: [],
          footerSections: []
        }
      ],
      headerSections: [],
      footerSections: [],
      paragraphStyles: []
    }
  };
}

const TEST_PAGE_SEGMENTATION_CALLBACKS = {
  estimateDocNodeHeightPx: (node: DocModel["nodes"][number]) =>
    node.type === "paragraph" ? 200 : 240,
  paragraphHasVisibleText: (paragraph: Extract<DocModel["nodes"][number], { type: "paragraph" }>) =>
    paragraph.children.some((child) => child.type === "text" && child.text.trim().length > 0),
  paragraphIsStructuralSectionBreakSpacer: () => false,
  estimateParagraphHeightPx: () => 200,
  estimateParagraphLineHeightPx: () => 50,
  paragraphLineCountWithinWidth: () => 4,
  paragraphWidowControlEnabled: () => false,
  paragraphCanSplitAcrossPages: () => true,
  estimateTableRowHeightsPx: () => [80, 80, 80]
};

describe("layout-core", () => {
  it("resolves document-level layout metadata into a pure resolved document", () => {
    const resolved = resolveDocumentForLayout(createModel(), {
      pageWidth: 900,
      pageHeight: 1200,
      margin: 48
    });

    expect(resolved.source).toBe("layout-engine-adapter");
    expect(resolved.nodeCount).toBe(2);
    expect(resolved.pageCountHint).toBe(2);
    expect(resolved.layout.pageSizePx).toEqual({
      width: 900,
      height: 1200
    });
    expect(resolved.layout.marginsPx).toEqual({
      top: 48,
      right: 48,
      bottom: 48,
      left: 48
    });
    expect(resolved.sections).toEqual([
      {
        index: 0,
        startNodeIndex: 0,
        synthetic: false,
        layout: resolved.layout
      }
    ]);
  });

  it("builds a layout snapshot with source mappings for top-level blocks and table content", () => {
    const snapshot = buildLayoutSnapshot(createModel(), {
      pageWidth: 816,
      pageHeight: 1056,
      margin: 72
    });

    expect(snapshot.version).toBe(1);
    expect(snapshot.pages).toHaveLength(1);
    expect(snapshot.pages[0]?.blocks).toHaveLength(2);

    const firstBlock = snapshot.pages[0]?.blocks[0];
    expect(firstBlock?.kind).toBe("paragraph");
    if (firstBlock?.kind === "paragraph") {
      expect(firstBlock.source).toEqual({
        kind: "paragraph",
        nodeIndex: 0
      });
    }

    const secondBlock = snapshot.pages[0]?.blocks[1];
    expect(secondBlock?.kind).toBe("table");
    if (secondBlock?.kind === "table") {
      expect(secondBlock.source).toEqual({
        kind: "table",
        nodeIndex: 1
      });
      expect(secondBlock.rows[0]?.cells[0]?.source).toEqual({
        kind: "table-cell",
        nodeIndex: 1,
        rowIndex: 0,
        cellIndex: 0
      });
      expect(secondBlock.rows[0]?.cells[0]?.paragraphs[0]?.source).toEqual({
        kind: "table-cell-paragraph",
        nodeIndex: 1,
        rowIndex: 0,
        cellIndex: 0,
        paragraphIndex: 0
      });
    }
  });

  it("normalizes metadata sections and prepends a synthetic zero-start section when needed", () => {
    const sections = resolveDocumentSectionsFromMetadata({
      sourceParts: 1,
      warnings: [],
      sectionPropertiesXml: "<w:sectPr/>",
      sections: [
        {
          startNodeIndex: 3,
          sectionPropertiesXml: "<w:sectPr><w:type w:val=\"continuous\"/></w:sectPr>",
          headerSections: [],
          footerSections: []
        }
      ],
      headerSections: [],
      footerSections: [],
      paragraphStyles: []
    });

    expect(sections).toHaveLength(2);
    expect(sections[0]?.startNodeIndex).toBe(0);
    expect(sections[1]?.startNodeIndex).toBe(3);
  });

  it("owns pure pagination helpers for section metrics and paragraph spacing suppression", () => {
    const metrics = [
      {
        startNodeIndex: 0,
        pageContentWidthPx: 500,
        pageContentHeightPx: 700
      },
      {
        startNodeIndex: 5,
        pageContentWidthPx: 300,
        pageContentHeightPx: 400
      }
    ];

    expect(resolvePaginationSectionMetricsIndexForNodeIndex(metrics, 0, 0)).toBe(0);
    expect(resolvePaginationSectionMetricsIndexForNodeIndex(metrics, 6, 0)).toBe(1);
    expect(scalePaginationSectionMetricsHeights(metrics, 0.5)).toEqual([
      {
        startNodeIndex: 0,
        pageContentWidthPx: 500,
        pageContentHeightPx: 350
      },
      {
        startNodeIndex: 5,
        pageContentWidthPx: 300,
        pageContentHeightPx: 200
      }
    ]);

    const model: DocModel = {
      nodes: [
        {
          type: "paragraph",
          sourceXml: `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`,
          children: []
        },
        {
          type: "paragraph",
          children: [
            {
              type: "text",
              text: "After break"
            }
          ],
          style: {
            spacing: {
              beforeTwips: 240
            }
          }
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

    expect(
      resolveParagraphBeforeSpacingPx(
        model,
        1,
        model.nodes[1] as Extract<DocModel["nodes"][number], { type: "paragraph" }>,
        0,
        true
      )
    ).toBe(0);
  });

  it("parses paragraph and section page-break markers in layout-core", () => {
    expect(
      sectionBreakPropertiesStartNewPage(`<w:sectPr><w:type w:val="nextColumn"/><w:cols w:num="1"/></w:sectPr>`)
    ).toBe(true);
    expect(
      sectionBreakPropertiesStartNewPage(`<w:sectPr><w:type w:val="continuous"/></w:sectPr>`)
    ).toBe(false);

    const pageBreakParagraph = {
      type: "paragraph" as const,
      sourceXml: `<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>Text</w:t></w:r></w:p>`,
      children: [
        {
          type: "text" as const,
          text: "Text"
        }
      ]
    };
    const renderedBreakParagraph = {
      type: "paragraph" as const,
      sourceXml: `<w:p><w:r><w:lastRenderedPageBreak/></w:r><w:r><w:t>Text</w:t></w:r></w:p>`,
      children: [
        {
          type: "text" as const,
          text: "Text"
        }
      ]
    };

    expect(paragraphHasPageBreakBefore(pageBreakParagraph)).toBe(true);
    expect(paragraphHasLastRenderedPageBreak(renderedBreakParagraph)).toBe(true);
  });

  it("owns section lookup and header/footer page-variant selection", () => {
    const sections = [
      {
        startNodeIndex: 0,
        sectionPropertiesXml: `<w:sectPr><w:type w:val="continuous"/></w:sectPr>`,
        headerSections: [],
        footerSections: []
      },
      {
        startNodeIndex: 4,
        sectionPropertiesXml: `<w:sectPr><w:titlePg/></w:sectPr>`,
        headerSections: [],
        footerSections: []
      }
    ];

    expect(sectionTitlePageEnabled(`<w:sectPr><w:titlePg/></w:sectPr>`)).toBe(true);
    expect(resolveSectionIndexForNodeIndex(sections, 0, 0)).toBe(0);
    expect(resolveSectionIndexForNodeIndex(sections, 6, 0)).toBe(1);
    expect(resolveSectionPropertiesXmlForNodeIndex(sections, 5)).toBe(
      `<w:sectPr><w:titlePg/></w:sectPr>`
    );

    const headerSections = [
      {
        referenceType: "first",
        partName: "header-first",
        nodes: []
      },
      {
        referenceType: "even",
        partName: "header-even",
        nodes: []
      },
      {
        referenceType: "default",
        partName: "header-default",
        nodes: []
      }
    ];

    expect(
      selectSectionVariantForPage(
        headerSections,
        `<w:sectPr><w:titlePg/></w:sectPr>`,
        0
      )?.partName
    ).toBe("header-first");
    expect(
      selectSectionVariantForPage(
        headerSections,
        `<w:sectPr><w:titlePg/></w:sectPr>`,
        1
      )?.partName
    ).toBe("header-even");
    expect(
      selectSectionVariantForPage(
        headerSections,
        `<w:sectPr><w:titlePg/></w:sectPr>`,
        2
      )?.partName
    ).toBe("header-default");
    expect(
      selectSectionVariantForPage(
        headerSections,
        `<w:sectPr><w:titlePg/></w:sectPr>`,
        1,
        {
          evenAndOddHeaders: false
        }
      )?.partName
    ).toBe("header-default");
    expect(
      selectSectionVariantForPage(
        headerSections.filter((section) => section.referenceType !== "first"),
        `<w:sectPr><w:titlePg/></w:sectPr>`,
        0
      )?.partName
    ).toBeUndefined();
  });

  it("inherits header/footer references forward when later sections omit references", () => {
    const resolvedSections = resolveDocumentSectionsFromMetadata({
      sourceParts: 1,
      warnings: [],
      sections: [
        {
          startNodeIndex: 0,
          sectionPropertiesXml: `<w:sectPr/>`,
          headerSections: [
            {
              referenceType: "default",
              partName: "header-a",
              nodes: []
            }
          ],
          footerSections: [
            {
              referenceType: "default",
              partName: "footer-a",
              nodes: []
            }
          ]
        },
        {
          startNodeIndex: 10,
          sectionPropertiesXml: `<w:sectPr/>`,
          headerSections: [],
          footerSections: []
        },
        {
          startNodeIndex: 20,
          sectionPropertiesXml: `<w:sectPr/>`,
          headerSections: [
            {
              referenceType: "default",
              partName: "header-b",
              nodes: []
            }
          ],
          footerSections: [
            {
              referenceType: "default",
              partName: "footer-b",
              nodes: []
            }
          ]
        },
        {
          startNodeIndex: 30,
          sectionPropertiesXml: `<w:sectPr/>`,
          headerSections: [],
          footerSections: []
        }
      ],
      headerSections: [],
      footerSections: [],
      paragraphStyles: []
    });

    expect(resolvedSections[0]?.headerSections[0]?.partName).toBe("header-a");
    expect(resolvedSections[1]?.headerSections[0]?.partName).toBe("header-a");
    expect(resolvedSections[2]?.headerSections[0]?.partName).toBe("header-b");
    expect(resolvedSections[3]?.headerSections[0]?.partName).toBe("header-b");

    expect(resolvedSections[0]?.footerSections[0]?.partName).toBe("footer-a");
    expect(resolvedSections[1]?.footerSections[0]?.partName).toBe("footer-a");
    expect(resolvedSections[2]?.footerSections[0]?.partName).toBe("footer-b");
    expect(resolvedSections[3]?.footerSections[0]?.partName).toBe("footer-b");
  });

  it("owns the generic page segmentation solver and break scoring", () => {
    const model: DocModel = {
      nodes: [
        {
          type: "paragraph",
          children: [{ type: "text", text: "Long paragraph" }]
        },
        {
          type: "table",
          rows: [
            { type: "table-row", cells: [{ type: "table-cell", nodes: [] }] },
            { type: "table-row", cells: [{ type: "table-cell", nodes: [] }] },
            { type: "table-row", cells: [{ type: "table-cell", nodes: [] }] }
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

    const pages = buildDocumentPageNodeSegments(
      model,
      120,
      400,
      TEST_PAGE_SEGMENTATION_CALLBACKS
    );
    expect(pages).toEqual([
      [
        {
          nodeIndex: 0,
          paragraphLineRange: {
            startLineIndex: 0,
            endLineIndex: 1,
            totalLineCount: 4,
            lineHeightPx: 50
          }
        }
      ],
      [
        {
          nodeIndex: 0,
          paragraphLineRange: {
            startLineIndex: 1,
            endLineIndex: 2,
            totalLineCount: 4,
            lineHeightPx: 50
          }
        }
      ],
      [
        {
          nodeIndex: 0,
          paragraphLineRange: {
            startLineIndex: 2,
            endLineIndex: 3,
            totalLineCount: 4,
            lineHeightPx: 50
          }
        }
      ],
      [
        {
          nodeIndex: 0,
          paragraphLineRange: {
            startLineIndex: 3,
            endLineIndex: 4,
            totalLineCount: 4,
            lineHeightPx: 50
          }
        }
      ],
      [
        {
          nodeIndex: 1,
          tableRowRange: {
            startRowIndex: 0,
            endRowIndex: 1
          }
        }
      ],
      [
        {
          nodeIndex: 1,
          tableRowRange: {
            startRowIndex: 1,
            endRowIndex: 2
          }
        }
      ],
      [
        {
          nodeIndex: 1,
          tableRowRange: {
            startRowIndex: 2,
            endRowIndex: 3
          }
        }
      ]
    ]);

    const overflowBreaks = collectDocxEstimatedOverflowBreakStartNodeIndexes(
      model,
      new Set<number>(),
      120,
      400,
      TEST_PAGE_SEGMENTATION_CALLBACKS
    );
    expect([...overflowBreaks]).toEqual([1]);

    expect(
      scorePaginationAgainstStoredPageBreaks(
        [
          [{ nodeIndex: 0 }],
          [{ nodeIndex: 1 }],
          [{ nodeIndex: 2 }]
        ],
        [1, 2]
      )
    ).toBe(50);

    const group = paragraphLetterheadColumnGroupAtSegmentOffset(
      [{ nodeIndex: 0 }, { nodeIndex: 1 }, { nodeIndex: 2 }],
      0,
      (nodeIndex) => (nodeIndex < 2 ? "left" : "right")
    );
    expect(group).toEqual({
      startOffset: 0,
      endOffset: 3,
      leftSegments: [{ nodeIndex: 0 }, { nodeIndex: 1 }],
      rightSegments: [{ nodeIndex: 2 }]
    });
  });

  it("leaves non-flow reserve for split paragraph bleed so partial lines do not get clipped at page boundaries", () => {
    const model: DocModel = {
      nodes: [
        {
          type: "paragraph",
          children: [{ type: "text", text: "Long paragraph" }]
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

    const pages = buildDocumentPageNodeSegments(
      model,
      120,
      400,
      TEST_PAGE_SEGMENTATION_CALLBACKS
    );

    expect(pages).toEqual([
      [
        {
          nodeIndex: 0,
          paragraphLineRange: {
            startLineIndex: 0,
            endLineIndex: 1,
            totalLineCount: 4,
            lineHeightPx: 50
          }
        }
      ],
      [
        {
          nodeIndex: 0,
          paragraphLineRange: {
            startLineIndex: 1,
            endLineIndex: 2,
            totalLineCount: 4,
            lineHeightPx: 50
          }
        }
      ],
      [
        {
          nodeIndex: 0,
          paragraphLineRange: {
            startLineIndex: 2,
            endLineIndex: 3,
            totalLineCount: 4,
            lineHeightPx: 50
          }
        }
      ],
      [
        {
          nodeIndex: 0,
          paragraphLineRange: {
            startLineIndex: 3,
            endLineIndex: 4,
            totalLineCount: 4,
            lineHeightPx: 50
          }
        }
      ]
    ]);
  });

  it("prefers paragraph-start rendered page breaks for untouched import pagination", () => {
    const model: DocModel = {
      nodes: [
        {
          type: "paragraph",
          children: [{ type: "text", text: "First page" }]
        },
        {
          type: "paragraph",
          sourceXml:
            `<w:p><w:r><w:lastRenderedPageBreak/></w:r>` +
            `<w:r><w:t>Second page</w:t></w:r></w:p>`,
          children: [{ type: "text", text: "Second page" }]
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

    const pages = buildDocumentPageNodeSegments(
      model,
      500,
      400,
      TEST_PAGE_SEGMENTATION_CALLBACKS,
      undefined,
      undefined,
      {
        preferLastRenderedParagraphStartBreaks: true
      }
    );

    expect(pages).toEqual([
      [
        {
          nodeIndex: 0,
          paragraphLineRange: {
            startLineIndex: 0,
            endLineIndex: 4,
            totalLineCount: 4,
            lineHeightPx: 50
          }
        }
      ],
      [
        {
          nodeIndex: 1,
          paragraphLineRange: {
            startLineIndex: 0,
            endLineIndex: 4,
            totalLineCount: 4,
            lineHeightPx: 50
          }
        }
      ]
    ]);
  });

  it("keeps a keepNext heading with the leading table row", () => {
    const model: DocModel = {
      nodes: [
        {
          type: "paragraph",
          children: [{ type: "text", text: "Body" }]
        },
        {
          type: "paragraph",
          style: {
            keepNext: true
          },
          children: [{ type: "text", text: "Heading" }]
        },
        {
          type: "table",
          rows: [
            { type: "table-row", cells: [{ type: "table-cell", nodes: [] }] },
            { type: "table-row", cells: [{ type: "table-cell", nodes: [] }] }
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

    const callbacks = {
      ...TEST_PAGE_SEGMENTATION_CALLBACKS,
      estimateDocNodeHeightPx: (node: DocModel["nodes"][number]) => {
        if (node.type === "table") {
          return 160;
        }
        return node.children.some(
          (child) => child.type === "text" && child.text === "Body"
        )
          ? 80
          : 40;
      },
      estimateParagraphHeightPx: (
        paragraph: Extract<DocModel["nodes"][number], { type: "paragraph" }>
      ) =>
        paragraph.children.some((child) => child.type === "text" && child.text === "Body")
          ? 80
          : 40,
      estimateParagraphLineHeightPx: () => 40,
      paragraphLineCountWithinWidth: () => 1,
      paragraphCanSplitAcrossPages: () => false,
      estimateTableRowHeightsPx: () => [80, 80]
    };

    const pages = buildDocumentPageNodeSegments(model, 120, 400, callbacks);
    expect(pages).toEqual([
      [{ nodeIndex: 0 }],
      [
        { nodeIndex: 1 },
        {
          nodeIndex: 2,
          tableRowRange: {
            startRowIndex: 0,
            endRowIndex: 1
          }
        }
      ],
      [
        {
          nodeIndex: 2,
          tableRowRange: {
            startRowIndex: 1,
            endRowIndex: 2
          }
        }
      ]
    ]);
  });

  it("keeps a keepNext heading with the whole following table when it fits on one page", () => {
    const model: DocModel = {
      nodes: [
        {
          type: "paragraph",
          children: [{ type: "text", text: "Body" }]
        },
        {
          type: "paragraph",
          style: {
            keepNext: true
          },
          children: [{ type: "text", text: "Heading" }]
        },
        {
          type: "table",
          rows: [
            { type: "table-row", cells: [{ type: "table-cell", nodes: [] }] },
            { type: "table-row", cells: [{ type: "table-cell", nodes: [] }] }
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

    const callbacks = {
      ...TEST_PAGE_SEGMENTATION_CALLBACKS,
      estimateDocNodeHeightPx: (node: DocModel["nodes"][number]) => {
        if (node.type === "table") {
          return 60;
        }
        return node.children.some(
          (child) => child.type === "text" && child.text === "Body"
        )
          ? 80
          : 40;
      },
      estimateParagraphHeightPx: (
        paragraph: Extract<DocModel["nodes"][number], { type: "paragraph" }>
      ) =>
        paragraph.children.some((child) => child.type === "text" && child.text === "Body")
          ? 80
          : 40,
      estimateParagraphLineHeightPx: () => 40,
      paragraphLineCountWithinWidth: () => 1,
      paragraphCanSplitAcrossPages: () => false,
      estimateTableRowHeightsPx: () => [30, 30]
    };

    const pages = buildDocumentPageNodeSegments(model, 120, 400, callbacks);
    expect(pages).toEqual([
      [{ nodeIndex: 0 }],
      [
        { nodeIndex: 1 },
        { nodeIndex: 2 }
      ]
    ]);
  });
});
