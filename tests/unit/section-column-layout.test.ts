import { describe, expect, it } from "vitest";

import { updateSectionColumnsXml } from "../../packages/react-viewer/src/editor";

describe("section column layout xml", () => {
  it("replaces an existing multi-column definition", () => {
    const sectionXml =
      '<w:sectPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="720" w:num="2"/></w:sectPr>';

    expect(updateSectionColumnsXml(sectionXml, { count: 3, gapPx: 36 })).toContain(
      '<w:cols w:space="540" w:num="3"/>'
    );
  });

  it("adds a column definition when one is missing", () => {
    const sectionXml =
      '<w:sectPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';

    expect(updateSectionColumnsXml(sectionXml, { count: 2, gapPx: 48 })).toContain(
      '<w:cols w:space="720" w:num="2"/>'
    );
  });

  it("writes a single-column definition without a num attribute", () => {
    const sectionXml =
      '<w:sectPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="720" w:num="2"/></w:sectPr>';

    expect(updateSectionColumnsXml(sectionXml, { count: 1, gapPx: 48 })).toContain(
      '<w:cols w:space="720"/>'
    );
  });
});
