import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildDocModel, type DocModel } from "@react-docx/doc-model";
import { parseDocx } from "@react-docx/ooxml-core";
import { describe, expect, it } from "vitest";
import {
  DocxEditorViewer,
  useDocxEditor
} from "../../packages/react-viewer/src/editor";
import { createZip } from "./helpers/zip";

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
</Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship
    Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="word/document.xml"
  />
</Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship
    Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header"
    Target="header1.xml"
  />
</Relationships>`;

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p>
      <w:r><w:rPr><w:rStyle w:val="CharSectno"/></w:rPr><w:t>1</w:t></w:r>
      <w:r><w:t xml:space="preserve"> Alpha</w:t></w:r>
    </w:p>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>
    <w:p>
      <w:r><w:rPr><w:rStyle w:val="CharSectno"/></w:rPr><w:t>2</w:t></w:r>
      <w:r><w:t xml:space="preserve"> Beta</w:t></w:r>
    </w:p>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>
    <w:p>
      <w:r><w:rPr><w:rStyle w:val="CharSectno"/></w:rPr><w:t>3</w:t></w:r>
      <w:r><w:t xml:space="preserve"> Gamma</w:t></w:r>
    </w:p>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>
    <w:p>
      <w:r><w:rPr><w:rStyle w:val="CharSectno"/></w:rPr><w:t>4</w:t></w:r>
      <w:r><w:t xml:space="preserve"> Delta</w:t></w:r>
    </w:p>
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId1"/>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
      <w:pgNumType w:start="1"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const HEADER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:r><w:t xml:space="preserve">r. </w:t></w:r>
    <w:r><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:instrText xml:space="preserve"> STYLEREF CharSectno </w:instrText></w:r>
    <w:r><w:fldChar w:fldCharType="separate"/></w:r>
    <w:r><w:t>1</w:t></w:r>
    <w:r><w:fldChar w:fldCharType="end"/></w:r>
  </w:p>
  <w:p>
    <w:pPr>
      <w:pBdr>
        <w:top w:val="single" w:sz="4" w:space="1" w:color="auto"/>
      </w:pBdr>
    </w:pPr>
  </w:p>
</w:hdr>`;

function HeaderStyleRefViewer({ model }: { model: DocModel }): React.JSX.Element {
  const editor = useDocxEditor({ starterModel: model });
  return React.createElement(DocxEditorViewer, {
    editor,
    mode: "read-only"
  });
}

async function buildImportedModel(): Promise<DocModel> {
  const pkg = await parseDocx(
    createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: DOCUMENT_XML },
      { name: "word/_rels/document.xml.rels", content: DOCUMENT_RELS_XML },
      { name: "word/header1.xml", content: HEADER_XML }
    ])
  );
  return buildDocModel(pkg);
}

function normalizeTextContent(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("header STYLEREF field import", () => {
  it("resolves section-style fields per page and keeps the header separator paragraph border", async () => {
    const model = await buildImportedModel();

    const html = renderToStaticMarkup(React.createElement(HeaderStyleRefViewer, { model }));
    const pageMarkup = html.match(/data-docx-page-index="[^"]+"[\s\S]*?(?=data-docx-page-index="|$)/g) ?? [];

    expect(pageMarkup.length).toBeGreaterThanOrEqual(4);

    const firstFourPages = pageMarkup.slice(0, 4).map((markup) => normalizeTextContent(markup));
    expect(firstFourPages[0]).toContain("r. 1");
    expect(firstFourPages[1]).toContain("r. 2");
    expect(firstFourPages[2]).toContain("r. 3");
    expect(firstFourPages[3]).toContain("r. 4");

    pageMarkup.slice(0, 4).forEach((markup) => {
      expect(markup).toContain('data-docx-header-footer-region="header"');
      expect(markup).toMatch(/border-top:[^;]+solid/i);
    });
  });
});
