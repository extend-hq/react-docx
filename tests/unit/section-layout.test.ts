import { describe, expect, it } from "vitest";
import { resolveDocumentLayout, parseSectionLayout } from "@extend-ai/react-docx";
import type { DocModel } from "@extend-ai/react-docx-doc-model";

const SECTION_PROPERTIES_XML = `<w:sectPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:pgSz w:w="11906" w:h="16838"/>
  <w:pgMar w:top="1440" w:right="849" w:bottom="1440" w:left="851" w:header="708" w:footer="708" w:gutter="0"/>
  <w:cols w:space="708"/>
  <w:docGrid w:linePitch="360"/>
</w:sectPr>`;

function createModel(sectionPropertiesXml?: string): DocModel {
  return {
    nodes: [],
    metadata: {
      sourceParts: 1,
      warnings: [],
      comments: [],
      hyperlinks: [],
      footnotes: [],
      endnotes: [],
      headerSections: [],
      footerSections: [],
      sections: [],
      sectionPropertiesXml
    }
  };
}

describe("section layout parsing", () => {
  it("extracts page metrics from section properties xml", () => {
    expect(parseSectionLayout(SECTION_PROPERTIES_XML)).toEqual({
      pageWidthPx: 11906 / 15,
      pageHeightPx: 16838 / 15,
      marginsPx: {
        top: 96,
        right: 849 / 15,
        bottom: 96,
        left: 851 / 15
      },
      headerDistancePx: 708 / 15,
      footerDistancePx: 708 / 15,
      // Bare <w:docGrid w:linePitch="360"/> (type "default") stores the pitch
      // but Word applies no line grid, so the viewer must not snap to it.
      docGridLinePitchPx: undefined
    });
  });

  it("applies the doc grid line pitch only for explicit grid types", () => {
    const withLinesGrid = SECTION_PROPERTIES_XML.replace(
      '<w:docGrid w:linePitch="360"/>',
      '<w:docGrid w:type="lines" w:linePitch="360"/>'
    );
    expect(parseSectionLayout(withLinesGrid).docGridLinePitchPx).toBe(24);

    const withDefaultGrid = SECTION_PROPERTIES_XML.replace(
      '<w:docGrid w:linePitch="360"/>',
      '<w:docGrid w:type="default" w:linePitch="360"/>'
    );
    expect(parseSectionLayout(withDefaultGrid).docGridLinePitchPx).toBeUndefined();
  });

  it("preserves explicit page dimensions independently of print orientation", () => {
    const landscapeSectionPropertiesXml = SECTION_PROPERTIES_XML.replace(
      '<w:pgSz w:w="11906" w:h="16838"/>',
      '<w:pgSz w:w="11906" w:h="16838" w:orient="landscape"/>'
    );
    expect(parseSectionLayout(landscapeSectionPropertiesXml)).toMatchObject({
      pageWidthPx: 11906 / 15,
      pageHeightPx: 16838 / 15
    });

    const alreadyLandscapeSectionPropertiesXml = SECTION_PROPERTIES_XML.replace(
      '<w:pgSz w:w="11906" w:h="16838"/>',
      '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>'
    );
    expect(parseSectionLayout(alreadyLandscapeSectionPropertiesXml)).toMatchObject({
      pageWidthPx: 16838 / 15,
      pageHeightPx: 11906 / 15
    });
  });

  it("resolves document layout from model metadata", () => {
    expect(resolveDocumentLayout(createModel(SECTION_PROPERTIES_XML))).toMatchObject({
      pageWidthPx: 11906 / 15,
      pageHeightPx: 16838 / 15,
      marginsPx: {
        top: 96,
        right: 849 / 15,
        bottom: 96,
        left: 851 / 15
      },
      footerDistancePx: 708 / 15
    });
  });
});
