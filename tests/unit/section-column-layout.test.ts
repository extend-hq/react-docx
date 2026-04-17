import { describe, expect, it } from "vitest";
import type { DocModel } from "../../packages/doc-model/src";

import {
  buildDocumentPageNodeSegments,
  resolveSectionPaginationContentWidthPx,
} from "../../packages/react-viewer/src/editor";

describe("section column layout xml", () => {
  it("uses the per-column width for pagination in multi-column sections", () => {
    const sectionXml =
      '<w:sectPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:type w:val="continuous"/><w:cols w:space="720" w:num="2"/></w:sectPr>';

    expect(
      resolveSectionPaginationContentWidthPx(
        {
          pageWidthPx: 816,
          marginsPx: {
            top: 96,
            right: 96,
            bottom: 96,
            left: 96,
          },
        },
        sectionXml
      )
    ).toBe(288);
  });

  it("keeps explicit column-break paragraphs on the same multi-column page when the segments fit", () => {
    const model: DocModel = {
      nodes: [
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
                          text: "Spacer",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          children: [
            {
              type: "text",
              text: "This is an example of columns. With columns, the page is split into two or more horizontal sections. Unlike tables, in which you usually read across a row and then down to the next, in columns, you read down a column and then across to the next.",
            },
            {
              type: "text",
              text: "\n",
            },
            {
              type: "text",
              text: "When columns are not created correctly, screen readers may run lines together, reading the first line of the first column, then the first line of the second column, then the second line of the first column, and so on. Obviously, that is not accessible.",
            },
          ],
          style: {
            spacing: {
              beforeTwips: 120,
              afterTwips: 120,
              lineTwips: 276,
              lineRule: "auto",
            },
          },
          sourceXml:
            '<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:r><w:t>This is an example of columns. With columns, the page is split into two or more horizontal sections. Unlike tables, in which you usually read across a row and then down to the next, in columns, you read down a column and then across to the next.</w:t></w:r><w:r><w:br w:type="column"/></w:r><w:r><w:t>When columns are not created correctly, screen readers may run lines together, reading the first line of the first column, then the first line of the second column, then the second line of the first column, and so on. Obviously, that is not accessible.</w:t></w:r></w:p>',
        },
      ],
      metadata: {
        sourceParts: 1,
        warnings: [],
        headerSections: [],
        footerSections: [],
        paragraphStyles: [],
      },
    };

    const pages = buildDocumentPageNodeSegments(
      model,
      864,
      624,
      undefined,
      [
        {
          startNodeIndex: 0,
          pageContentWidthPx: 624,
          pageContentHeightPx: 864,
          pageContentHeightMultiplier: 1,
        },
        {
          startNodeIndex: 1,
          pageContentWidthPx: 288,
          pageContentHeightPx: 1728,
          pageContentHeightMultiplier: 2,
        },
      ],
      {
        measuredTableRowHeightsByNodeIndex: {
          0: [740],
        },
      }
    );

    expect(pages).toHaveLength(1);
    expect(pages[0]).toEqual([{ nodeIndex: 0 }, { nodeIndex: 1 }]);
  });
});
