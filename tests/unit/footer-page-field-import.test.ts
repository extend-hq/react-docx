import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildDocModel, type DocModel } from "@extend-ai/react-docx-doc-model";
import { parseDocx } from "@extend-ai/react-docx-ooxml-core";
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

const TEXTBOX_FOOTER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
  <w:p>
    <w:r>
      <w:drawing>
        <wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658242" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1" wp14:anchorId="4DB1819B" wp14:editId="43B975F4">
          <wp:simplePos x="0" y="0" />
          <wp:positionH relativeFrom="page"><wp:posOffset>1239520</wp:posOffset></wp:positionH>
          <wp:positionV relativeFrom="page"><wp:posOffset>9850755</wp:posOffset></wp:positionV>
          <wp:extent cx="1729105" cy="624840" />
          <wp:wrapNone />
          <wp:docPr id="15" name="Text Box 7" />
          <wp:cNvGraphicFramePr><a:graphicFrameLocks /></wp:cNvGraphicFramePr>
          <a:graphic>
            <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
              <wps:wsp>
                <wps:cNvSpPr txBox="1"><a:spLocks noChangeArrowheads="1" /></wps:cNvSpPr>
                <wps:spPr>
                  <a:xfrm><a:off x="0" y="0" /><a:ext cx="1729105" cy="624840" /></a:xfrm>
                  <a:prstGeom prst="rect"><a:avLst /></a:prstGeom>
                  <a:noFill />
                  <a:ln><a:noFill /></a:ln>
                </wps:spPr>
                <wps:txbx>
                  <w:txbxContent>
                    <w:p>
                      <w:pPr>
                        <w:spacing w:line="345" w:lineRule="exact" />
                        <w:ind w:left="40" />
                        <w:rPr><w:b /><w:sz w:val="32" /></w:rPr>
                      </w:pPr>
                      <w:r><w:fldChar w:fldCharType="begin" /></w:r>
                      <w:r><w:rPr><w:b /><w:color w:val="4F81BC" /><w:sz w:val="32" /></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
                      <w:r><w:fldChar w:fldCharType="separate" /></w:r>
                      <w:r><w:t>1</w:t></w:r>
                      <w:r><w:fldChar w:fldCharType="end" /></w:r>
                    </w:p>
                  </w:txbxContent>
                </wps:txbx>
                <wps:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"><a:noAutofit /></wps:bodyPr>
              </wps:wsp>
            </a:graphicData>
          </a:graphic>
        </wp:anchor>
      </w:drawing>
    </w:r>
  </w:p>
</w:ftr>`;

const COMPACT_TEXTBOX_FOOTER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
  <w:p>
    <w:r>
      <w:drawing>
        <wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658241" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1" wp14:anchorId="3DECC9B5" wp14:editId="1A50C284">
          <wp:simplePos x="0" y="0" />
          <wp:positionH relativeFrom="page"><wp:posOffset>1492885</wp:posOffset></wp:positionH>
          <wp:positionV relativeFrom="page"><wp:posOffset>9836785</wp:posOffset></wp:positionV>
          <wp:extent cx="2132965" cy="165735" />
          <wp:wrapNone />
          <wp:docPr id="10" name="Text Box 8" />
          <wp:cNvGraphicFramePr><a:graphicFrameLocks /></wp:cNvGraphicFramePr>
          <a:graphic>
            <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
              <wps:wsp>
                <wps:cNvSpPr txBox="1"><a:spLocks noChangeArrowheads="1" /></wps:cNvSpPr>
                <wps:spPr>
                  <a:xfrm><a:off x="0" y="0" /><a:ext cx="2132965" cy="165735" /></a:xfrm>
                  <a:prstGeom prst="rect"><a:avLst /></a:prstGeom>
                  <a:noFill />
                  <a:ln><a:noFill /></a:ln>
                </wps:spPr>
                <wps:txbx>
                  <w:txbxContent>
                    <w:p>
                      <w:pPr>
                        <w:spacing w:line="276" w:lineRule="auto" />
                        <w:ind w:left="20" />
                      </w:pPr>
                      <w:r><w:t xml:space="preserve">Te </w:t></w:r>
                      <w:r><w:t xml:space="preserve">Kōhanga </w:t></w:r>
                      <w:r><w:t>Reo Permanent IEA 2023</w:t></w:r>
                    </w:p>
                  </w:txbxContent>
                </wps:txbx>
                <wps:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"><a:noAutofit /></wps:bodyPr>
              </wps:wsp>
            </a:graphicData>
          </a:graphic>
        </wp:anchor>
      </w:drawing>
    </w:r>
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
  return await buildDocModel(pkg);
}

async function buildImportedModelFromDocumentXml(documentXml: string): Promise<DocModel> {
  return buildImportedModelFromDocumentAndFooterXml(documentXml, FOOTER_XML);
}

async function buildImportedModelFromDocumentAndFooterXml(
  documentXml: string,
  footerXml: string
): Promise<DocModel> {
  const pkg = await parseDocx(
    createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "docProps/app.xml", content: APP_XML },
      { name: "word/document.xml", content: documentXml },
      { name: "word/_rels/document.xml.rels", content: DOCUMENT_RELS_XML },
      { name: "word/footer1.xml", content: footerXml }
    ])
  );
  return await buildDocModel(pkg);
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

  it("suppresses title-page footers when no first footer is defined and still formats PAGE fields", async () => {
    const model = await buildImportedModelFromDocumentXml(TITLE_PAGE_DOCUMENT_XML);

    const html = renderToStaticMarkup(React.createElement(ImportedFooterViewer, { model }));
    const pageMarkup = html.match(/data-docx-page-index="[^"]+"[\s\S]*?(?=data-docx-page-index="|$)/g) ?? [];

    expect(pageMarkup).toHaveLength(3);
    expect(pageMarkup[0]).not.toContain("data-docx-header-footer-region=\"footer\"");
    expect(pageMarkup[0]).not.toContain(">i<");
    expect(pageMarkup[1]).toContain(">ii<");
    expect(pageMarkup[2]).toContain(">1<");
  });

  it("offsets continuous-section restarts when the section begins on the prior physical page", async () => {
    const model = await buildImportedModelFromDocumentXml(CONTINUOUS_SECTION_DOCUMENT_XML);

    const html = renderToStaticMarkup(React.createElement(ImportedFooterViewer, { model }));
    const pageMarkup = html.match(/data-docx-page-index="[^"]+"[\s\S]*?(?=data-docx-page-index="|$)/g) ?? [];

    expect(pageMarkup).toHaveLength(3);
    expect(pageMarkup[0]).not.toContain("data-docx-header-footer-region=\"footer\"");
    expect(pageMarkup[0]).not.toContain(">i<");
    expect(pageMarkup[1]).toContain(">ii<");
    expect(pageMarkup[2]).toContain(">2<");
    expect(pageMarkup[2]).not.toContain(">1<");
  });

  it("renders PAGE fields inside synthetic textboxes per page instead of freezing the imported result", async () => {
    const model = await buildImportedModelFromDocumentAndFooterXml(DOCUMENT_XML, TEXTBOX_FOOTER_XML);

    const html = renderToStaticMarkup(React.createElement(ImportedFooterViewer, { model }));
    const pageMarkup = html.match(/data-docx-page-index="[^"]+"[\s\S]*?(?=data-docx-page-index="|$)/g) ?? [];

    expect(pageMarkup).toHaveLength(3);
    expect(pageMarkup[0]).toContain("fill%3D%22%234f81bc%22");
    expect(pageMarkup[0]).toContain("%3E1%3C%2Ftspan%3E");
    expect(pageMarkup[1]).toContain("%3E2%3C%2Ftspan%3E");
    expect(pageMarkup[2]).toContain("%3E3%3C%2Ftspan%3E");
    expect(pageMarkup[2]).not.toContain("%3E1%3C%2Ftspan%3E");
  });

  it("renders compact auto-line synthetic footer textboxes instead of dropping their first line", async () => {
    const model = await buildImportedModelFromDocumentAndFooterXml(DOCUMENT_XML, COMPACT_TEXTBOX_FOOTER_XML);

    const html = renderToStaticMarkup(React.createElement(ImportedFooterViewer, { model }));
    const pageMarkup = html.match(/data-docx-page-index="[^"]+"[\s\S]*?(?=data-docx-page-index="|$)/g) ?? [];

    expect(pageMarkup).toHaveLength(3);
    expect(pageMarkup[0]).toContain("Te%20");
    expect(pageMarkup[0]).toContain("K%C5%8Dhanga%20");
    expect(pageMarkup[0]).toContain("Reo%20Permanent%20IEA%202023");
  });
});
