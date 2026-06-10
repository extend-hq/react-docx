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
      pageWidthPx: 794,
      pageHeightPx: 1123,
      marginsPx: {
        top: 96,
        right: 57,
        bottom: 96,
        left: 57
      },
      headerDistancePx: 47,
      footerDistancePx: 47,
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

  it("resolves document layout from model metadata", () => {
    expect(resolveDocumentLayout(createModel(SECTION_PROPERTIES_XML))).toMatchObject({
      pageWidthPx: 794,
      pageHeightPx: 1123,
      marginsPx: {
        top: 96,
        right: 57,
        bottom: 96,
        left: 57
      },
      footerDistancePx: 47
    });
  });
});
