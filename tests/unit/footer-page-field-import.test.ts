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
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
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
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer"
    Target="footer1.xml"
  />
</Relationships>`;

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:r><w:t>Page 1 body</w:t></w:r></w:p>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>
    <w:p><w:r><w:t>Page 2 body</w:t></w:r></w:p>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>
    <w:p><w:r><w:t>Page 3 body</w:t></w:r></w:p>
    <w:sectPr>
      <w:footerReference w:type="default" r:id="rId1"/>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const TITLE_PAGE_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:r><w:t>Cover</w:t></w:r></w:p>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>
    <w:p><w:r><w:t>Front matter</w:t></w:r></w:p>
    <w:p>
      <w:pPr>
        <w:sectPr>
          <w:footerReference w:type="default" r:id="rId1"/>
          <w:pgSz w:w="12240" w:h="15840"/>
          <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
          <w:pgNumType w:fmt="lowerRoman" w:start="1"/>
          <w:titlePg/>
        </w:sectPr>
      </w:pPr>
    </w:p>
    <w:p><w:r><w:t>Main body</w:t></w:r></w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
      <w:pgNumType w:start="1"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const CONTINUOUS_SECTION_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:r><w:t>Cover</w:t></w:r></w:p>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>
    <w:p><w:r><w:t>Front matter</w:t></w:r></w:p>
    <w:p>
      <w:pPr>
        <w:sectPr>
          <w:footerReference w:type="default" r:id="rId1"/>
          <w:pgSz w:w="12240" w:h="15840"/>
          <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
          <w:pgNumType w:fmt="lowerRoman" w:start="1"/>
          <w:titlePg/>
        </w:sectPr>
      </w:pPr>
    </w:p>
    <w:p><w:r><w:t>Continuous section starts here.</w:t></w:r></w:p>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>
    <w:p><w:r><w:t>Main body</w:t></w:r></w:p>
    <w:sectPr>
      <w:type w:val="continuous"/>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
      <w:pgNumType w:start="1"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const FOOTER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:r><w:t>Footer page </w:t></w:r>
    <w:r><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
    <w:r><w:fldChar w:fldCharType="separate"/></w:r>
    <w:r><w:t>2</w:t></w:r>
    <w:r><w:fldChar w:fldCharType="end"/></w:r>
  </w:p>
</w:ftr>`;

const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
  xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Pages>2</Pages>
</Properties>`;

async function buildImportedModel(): Promise<DocModel> {
  const pkg = await parseDocx(
    createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "docProps/app.xml", content: APP_XML },
      { name: "word/document.xml", content: DOCUMENT_XML },
      { name: "word/_rels/document.xml.rels", content: DOCUMENT_RELS_XML },
      { name: "word/footer1.xml", content: FOOTER_XML }
    ])
  );
  return buildDocModel(pkg);
}

async function buildImportedModelFromDocumentXml(documentXml: string): Promise<DocModel> {
  const pkg = await parseDocx(
    createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "docProps/app.xml", content: APP_XML },
      { name: "word/document.xml", content: documentXml },
      { name: "word/_rels/document.xml.rels", content: DOCUMENT_RELS_XML },
      { name: "word/footer1.xml", content: FOOTER_XML }
    ])
  );
  return buildDocModel(pkg);
}

function ImportedFooterViewer({ model }: { model: DocModel }): React.JSX.Element {
  const editor = useDocxEditor({ starterModel: model });
  return React.createElement(DocxEditorViewer, {
    editor,
    mode: "read-only"
  });
}

describe("footer PAGE field import", () => {
  it("does not clamp PAGE fields to a stale imported total page count", async () => {
    const model = await buildImportedModel();

    expect(model.metadata.documentPageCount).toBe(2);

    const html = renderToStaticMarkup(React.createElement(ImportedFooterViewer, { model }));
    const pageMarkup = html.match(/data-docx-page-index="[^"]+"[\s\S]*?(?=data-docx-page-index="|$)/g) ?? [];

    expect(pageMarkup).toHaveLength(3);
    expect(pageMarkup[0]).toContain(">1<");
    expect(pageMarkup[1]).toContain(">2<");
    expect(pageMarkup[2]).toContain(">3<");
    expect(pageMarkup[2]).not.toContain(">2<");
  });

  it("suppresses first-page footers for title pages and formats imported PAGE fields", async () => {
    const model = await buildImportedModelFromDocumentXml(TITLE_PAGE_DOCUMENT_XML);

    const html = renderToStaticMarkup(React.createElement(ImportedFooterViewer, { model }));
    const pageMarkup = html.match(/data-docx-page-index="[^"]+"[\s\S]*?(?=data-docx-page-index="|$)/g) ?? [];

    expect(pageMarkup).toHaveLength(3);
    expect(pageMarkup[0]).not.toContain("data-docx-header-footer-region=\"footer\"");
    expect(pageMarkup[0]).not.toContain(">1<");
    expect(pageMarkup[1]).toContain(">ii<");
    expect(pageMarkup[2]).toContain(">1<");
  });

  it("offsets continuous-section restarts when the section begins on the prior physical page", async () => {
    const model = await buildImportedModelFromDocumentXml(CONTINUOUS_SECTION_DOCUMENT_XML);

    const html = renderToStaticMarkup(React.createElement(ImportedFooterViewer, { model }));
    const pageMarkup = html.match(/data-docx-page-index="[^"]+"[\s\S]*?(?=data-docx-page-index="|$)/g) ?? [];

    expect(pageMarkup).toHaveLength(3);
    expect(pageMarkup[0]).not.toContain("data-docx-header-footer-region=\"footer\"");
    expect(pageMarkup[1]).toContain(">ii<");
    expect(pageMarkup[2]).toContain(">2<");
    expect(pageMarkup[2]).not.toContain(">1<");
  });
});
