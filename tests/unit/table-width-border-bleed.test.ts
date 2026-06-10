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

const PAGE_SECTION_XML = `
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>`;

const BORDERED_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="10800" w:type="dxa"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="6" w:color="000000"/>
          <w:left w:val="single" w:sz="6" w:color="000000"/>
          <w:bottom w:val="single" w:sz="6" w:color="000000"/>
          <w:right w:val="single" w:sz="6" w:color="000000"/>
        </w:tblBorders>
      </w:tblPr>
      <w:tblGrid>
        <w:gridCol w:w="10800"/>
      </w:tblGrid>
      <w:tr>
        <w:tc>
          <w:tcPr><w:tcW w:w="10800" w:type="dxa"/></w:tcPr>
          <w:p><w:r><w:t>Bordered edge</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
${PAGE_SECTION_XML}
  </w:body>
</w:document>`;

const BORDERLESS_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="10800" w:type="dxa"/>
      </w:tblPr>
      <w:tblGrid>
        <w:gridCol w:w="10800"/>
      </w:tblGrid>
      <w:tr>
        <w:tc>
          <w:tcPr><w:tcW w:w="10800" w:type="dxa"/></w:tcPr>
          <w:p><w:r><w:t>Borderless edge</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
${PAGE_SECTION_XML}
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

async function renderTableWidthPx(documentXml: string): Promise<number | undefined> {
  const zip = createZip([
    { name: "[Content_Types].xml", content: CONTENT_TYPES_XML, deflate: true },
    { name: "_rels/.rels", content: ROOT_RELS_XML, deflate: true },
    { name: "word/document.xml", content: documentXml, deflate: true },
  ]);
  const pkg = await parseDocx(zip);
  const model = await buildDocModel(pkg);
  const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model }));
  return extractFirstTableWidthPx(html);
}

describe("table width border bleed", () => {
  it("shrinks collapsed content-width tables so the outer right border stays inside the page box", async () => {
    await expect(renderTableWidthPx(BORDERED_DOCUMENT_XML)).resolves.toBe(719);
  });

  it("keeps borderless content-width tables at the full content width", async () => {
    await expect(renderTableWidthPx(BORDERLESS_DOCUMENT_XML)).resolves.toBe(720);
  });
});
