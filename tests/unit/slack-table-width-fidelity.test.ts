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
        <w:jc w:val="center"/>
        <w:tblCellSpacing w:w="0" w:type="dxa"/>
        <w:tblCellMar>
          <w:top w:w="80" w:type="dxa"/>
          <w:right w:w="160" w:type="dxa"/>
          <w:bottom w:w="80" w:type="dxa"/>
          <w:left w:w="160" w:type="dxa"/>
        </w:tblCellMar>
        <w:tblBorders>
          <w:top w:val="single" w:sz="2" w:color="000000"/>
          <w:left w:val="single" w:sz="2" w:color="000000"/>
          <w:bottom w:val="single" w:sz="2" w:color="000000"/>
          <w:right w:val="single" w:sz="2" w:color="000000"/>
        </w:tblBorders>
      </w:tblPr>
      <w:tblGrid>
        <w:gridCol w:w="8640"/>
      </w:tblGrid>
      <w:tr>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="2550" w:type="dxa"/>
            <w:gridSpan w:val="3"/>
          </w:tcPr>
          <w:p><w:r><w:t>General Questions</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
      <w:tr>
        <w:tc>
          <w:tcPr><w:tcW w:w="5535" w:type="dxa"/></w:tcPr>
          <w:p><w:r><w:t>Question</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr><w:tcW w:w="2550" w:type="dxa"/></w:tcPr>
          <w:p><w:r><w:t>Response</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr><w:tcW w:w="2310" w:type="dxa"/></w:tcPr>
          <w:p><w:r><w:t>Comments</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

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

function extractFirstTableWidthPx(html: string): number | undefined {
  const match = html.match(/<table\b[^>]*style="[^"]*width:([0-9.]+)px[^"]*"/);
  return match ? Number(match[1]) : undefined;
}

function extractColumnWidthsPx(html: string): number[] {
  return Array.from(
    html.matchAll(/<col\b[^>]*style="[^"]*width:([0-9.]+)px[^"]*"/g),
    (match) => Number(match[1])
  );
}

describe("slack table width fidelity", () => {
  it("prefers the widest fully-specified row over a narrow merged header row", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML, deflate: true },
      { name: "_rels/.rels", content: ROOT_RELS_XML, deflate: true },
      { name: "word/document.xml", content: DOCUMENT_XML, deflate: true },
    ]);
    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model }));
    const tableWidthPx = extractFirstTableWidthPx(html);
    const columnWidthsPx = extractColumnWidthsPx(html);

    expect(tableWidthPx).toBeDefined();
    expect(tableWidthPx as number).toBeGreaterThan(500);
    expect(columnWidthsPx).toHaveLength(3);
    expect(columnWidthsPx[0]).toBeGreaterThan(columnWidthsPx[1]);
    expect(columnWidthsPx[1]).toBeGreaterThan(columnWidthsPx[2]);
  });
});
