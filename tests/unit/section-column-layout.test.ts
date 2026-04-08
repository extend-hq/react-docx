import { describe, expect, it } from "vitest";

import { resolveSectionPaginationContentWidthPx } from "../../packages/react-viewer/src/editor";

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
            left: 96
          }
        },
        sectionXml
      )
    ).toBe(288);
  });
});
