import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "../../packages/doc-model/src";
import { parseDocx } from "../../packages/ooxml-core/src";
import {
  DocxEditorViewer,
  useDocxEditor,
} from "../../packages/react-viewer/src/editor";
import { createZip } from "./helpers/zip";

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="10500" w:type="dxa"/>
        <w:jc w:val="center"/>
        <w:tblCellSpacing w:w="0" w:type="dxa"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="2" w:color="000000"/>
          <w:left w:val="single" w:sz="2" w:color="000000"/>
          <w:bottom w:val="single" w:sz="2" w:color="000000"/>
          <w:right w:val="single" w:sz="2" w:color="000000"/>
        </w:tblBorders>
      </w:tblPr>
      <w:tblGrid>
        <w:gridCol w:w="8640"/>
        <w:gridCol w:w="4320"/>
        <w:gridCol w:w="4320"/>
      </w:tblGrid>
      <w:tr>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="10500" w:type="dxa"/>
            <w:gridSpan w:val="2"/>
            <w:tcBorders>
              <w:top w:val="single" w:sz="8" w:color="000000"/>
              <w:left w:val="single" w:sz="8" w:color="000000"/>
              <w:bottom w:val="single" w:sz="8" w:color="000000"/>
              <w:right w:val="single" w:sz="8" w:color="000000"/>
            </w:tcBorders>
          </w:tcPr>
          <w:p><w:r><w:t>Sheet 2</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
      <w:tr>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="5250" w:type="dxa"/>
            <w:tcBorders>
              <w:top w:val="single" w:sz="8" w:color="000000"/>
              <w:left w:val="single" w:sz="8" w:color="000000"/>
              <w:bottom w:val="single" w:sz="8" w:color="000000"/>
              <w:right w:val="single" w:sz="8" w:color="000000"/>
            </w:tcBorders>
          </w:tcPr>
          <w:p><w:r><w:t>Document Request</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="5250" w:type="dxa"/>
            <w:tcBorders>
              <w:top w:val="single" w:sz="8" w:color="000000"/>
              <w:left w:val="single" w:sz="8" w:color="000000"/>
              <w:bottom w:val="single" w:sz="8" w:color="000000"/>
              <w:right w:val="single" w:sz="8" w:color="000000"/>
            </w:tcBorders>
          </w:tcPr>
          <w:p><w:r><w:t>Document Attachment</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const DOCUMENT_WITH_SPACING_XML = DOCUMENT_XML.replace(
  '<w:tblCellSpacing w:w="0" w:type="dxa"/>',
  '<w:tblCellSpacing w:w="30" w:type="dxa"/>'
);

function ImportedViewer({
  model,
}: {
  model: Awaited<ReturnType<typeof buildDocModel>>;
}): React.JSX.Element {
  const editor = useDocxEditor({ starterModel: model });
  return React.createElement(DocxEditorViewer, {
    editor,
    mode: "read-only",
    deferInitialPaginationPaint: false,
  });
}

function extractColumnWidthsPx(html: string): number[] {
  return Array.from(
    html.matchAll(/<col\b[^>]*style="[^"]*width:([0-9.]+)px[^"]*"/g),
    (match) => Number(match[1])
  );
}

describe("table grid width fidelity", () => {
  it("prefers row cell widths when tblGrid disagrees with the actual column count", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML, deflate: true },
      { name: "_rels/.rels", content: ROOT_RELS_XML, deflate: true },
      { name: "word/document.xml", content: DOCUMENT_XML, deflate: true },
    ]);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model }));
    const widths = extractColumnWidthsPx(html);

    expect(widths).toHaveLength(2);
    expect(Math.abs(widths[0] - widths[1])).toBeLessThan(2);
    expect(html).toContain("Document Request");
    expect(html).toContain("Document Attachment");
  });

  it("uses separate borders when cells define their own edges and the table has no inside borders", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML, deflate: true },
      { name: "_rels/.rels", content: ROOT_RELS_XML, deflate: true },
      { name: "word/document.xml", content: DOCUMENT_XML, deflate: true },
    ]);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model }));
    const tableNode = model.nodes[0];

    expect(tableNode.type).toBe("table");
    expect(tableNode.style?.cellSpacingTwips).toBe(0);
    expect(html).toContain("border-collapse:separate");
    expect(html).toContain("border-spacing:1px");
  });

  it("honors imported table cell spacing when Word specifies it", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML, deflate: true },
      { name: "_rels/.rels", content: ROOT_RELS_XML, deflate: true },
      { name: "word/document.xml", content: DOCUMENT_WITH_SPACING_XML, deflate: true },
    ]);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model }));
    const tableNode = model.nodes[0];

    expect(tableNode.type).toBe("table");
    expect(tableNode.style?.cellSpacingTwips).toBe(30);
    expect(html).toContain("border-spacing:2px");
  });
});
