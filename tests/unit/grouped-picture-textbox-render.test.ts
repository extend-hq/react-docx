import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "../../packages/doc-model/src";
import { parseDocx } from "../../packages/ooxml-core/src";
import {
  DocxEditorViewer,
  useDocxEditor
} from "../../packages/react-viewer/src/editor";
import { createZip } from "./helpers/zip";

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
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
  <Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.jpeg"/>
</Relationships>`;

const GROUPED_PICTURE_TEXTBOX_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
  mc:Ignorable="wp14"
>
  <w:body>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:anchor behindDoc="0" layoutInCell="1" allowOverlap="1" simplePos="0">
            <wp:simplePos x="0" y="0"/>
            <wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>
            <wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>
            <wp:extent cx="4936605" cy="845819"/>
            <wp:wrapTopAndBottom/>
            <wp:docPr id="5" name="Group 5"/>
            <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">
                <wpg:wgp>
                  <wpg:cNvGrpSpPr/>
                  <wpg:grpSpPr>
                    <a:xfrm>
                      <a:off x="0" y="0"/>
                      <a:ext cx="4936605" cy="845819"/>
                      <a:chOff x="0" y="0"/>
                      <a:chExt cx="4933026" cy="850291"/>
                    </a:xfrm>
                  </wpg:grpSpPr>
                  <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                    <pic:nvPicPr>
                      <pic:cNvPr id="6" name="Picture 6" descr="MassHealth Logo"/>
                      <pic:cNvPicPr/>
                    </pic:nvPicPr>
                    <pic:blipFill>
                      <a:blip r:embed="rId8"/>
                      <a:stretch><a:fillRect/></a:stretch>
                    </pic:blipFill>
                    <pic:spPr>
                      <a:xfrm>
                        <a:off x="0" y="0"/>
                        <a:ext cx="1371600" cy="731520"/>
                      </a:xfrm>
                      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                    </pic:spPr>
                  </pic:pic>
                  <wps:wsp>
                    <wps:cNvPr id="7" name="Text Box 2"/>
                    <wps:cNvSpPr txBox="1"/>
                    <wps:spPr>
                      <a:xfrm>
                        <a:off x="1421485" y="0"/>
                        <a:ext cx="3511541" cy="850291"/>
                      </a:xfrm>
                      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                      <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
                    </wps:spPr>
                    <wps:txbx>
                      <w:txbxContent>
                        <w:p><w:r><w:t>Commonwealth of Massachusetts</w:t></w:r></w:p>
                        <w:p><w:r><w:t>Executive Office of Health and Human Services</w:t></w:r></w:p>
                      </w:txbxContent>
                    </wps:txbx>
                    <wps:bodyPr wrap="square"/>
                  </wps:wsp>
                </wpg:wgp>
              </a:graphicData>
            </a:graphic>
          </wp:anchor>
        </w:drawing>
      </w:r>
      <w:r><w:t>After group</w:t></w:r>
    </w:p>
    <w:sectPr/>
  </w:body>
</w:document>`;

const GROUPED_VECTOR_SHAPE_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
  mc:Ignorable="wp14"
>
  <w:body>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:anchor behindDoc="0" layoutInCell="1" allowOverlap="1" simplePos="0">
            <wp:simplePos x="0" y="0"/>
            <wp:positionH relativeFrom="page"><wp:posOffset>7188741</wp:posOffset></wp:positionH>
            <wp:positionV relativeFrom="page"><wp:posOffset>2040</wp:posOffset></wp:positionV>
            <wp:extent cx="44544" cy="2016004"/>
            <wp:wrapTopAndBottom/>
            <wp:docPr id="1305526484" name="Group 386"/>
            <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">
                <wpg:wgp>
                  <wpg:cNvGrpSpPr/>
                  <wpg:grpSpPr>
                    <a:xfrm>
                      <a:off x="0" y="0"/>
                      <a:ext cx="44544" cy="2016004"/>
                      <a:chOff x="0" y="0"/>
                      <a:chExt cx="44544" cy="2016004"/>
                    </a:xfrm>
                  </wpg:grpSpPr>
                  <wps:wsp>
                    <wps:cNvPr id="2097971878" name="Shape 58"/>
                    <wps:cNvSpPr/>
                    <wps:spPr>
                      <a:xfrm><a:off x="0" y="0"/><a:ext cx="44539" cy="1697658"/></a:xfrm>
                      <a:custGeom>
                        <a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="0" b="0"/>
                        <a:pathLst>
                          <a:path w="44539" h="1697658">
                            <a:moveTo><a:pt x="0" y="0"/></a:moveTo>
                            <a:lnTo><a:pt x="44539" y="0"/></a:lnTo>
                            <a:lnTo><a:pt x="44539" y="1675395"/></a:lnTo>
                            <a:cubicBezTo><a:pt x="44539" y="1687688"/><a:pt x="34570" y="1697658"/><a:pt x="22276" y="1697658"/></a:cubicBezTo>
                            <a:cubicBezTo><a:pt x="9970" y="1697658"/><a:pt x="0" y="1687688"/><a:pt x="0" y="1675395"/></a:cubicBezTo>
                            <a:lnTo><a:pt x="0" y="0"/></a:lnTo>
                            <a:close/>
                          </a:path>
                        </a:pathLst>
                      </a:custGeom>
                      <a:ln w="0" cap="flat"><a:miter lim="127000"/></a:ln>
                    </wps:spPr>
                    <wps:style>
                      <a:lnRef idx="0"><a:srgbClr val="000000"><a:alpha val="0"/></a:srgbClr></a:lnRef>
                      <a:fillRef idx="1"><a:srgbClr val="76A88B"/></a:fillRef>
                      <a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef>
                      <a:fontRef idx="none"/>
                    </wps:style>
                    <wps:bodyPr/>
                  </wps:wsp>
                </wpg:wgp>
              </a:graphicData>
            </a:graphic>
          </wp:anchor>
        </w:drawing>
      </w:r>
    </w:p>
    <w:sectPr/>
  </w:body>
</w:document>`;

const ONE_BY_ONE_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBAQEBAVEBUVFRUVFRUVFRUVFRUVFRUWFhUVFRUYHSggGBolHRUVITEhJSkrLi4uFx8zODMsNygtLisBCgoKDg0OGxAQGy0fHR0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAXAAADAQAAAAAAAAAAAAAAAAAAAQMC/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEAMQAAAB6A//xAAXEAADAQAAAAAAAAAAAAAAAAAAAREC/9oACAEBAAEFAiUf/8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAwEBPwEf/8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAgEBPwEf/8QAFxABAQEBAAAAAAAAAAAAAAAAAQARIf/aAAgBAQAGPwJrP//EABcQAQEBAQAAAAAAAAAAAAAAAAERACH/2gAIAQEAAT8hR5iP/9oADAMBAAIAAwAAABBf/8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAwEBPxAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAgEBPxAf/8QAFxABAAMAAAAAAAAAAAAAAAAAAREhQf/aAAgBAQABPxBBbQ7/2Q==";

function ImportedViewer({
  model
}: {
  model: Awaited<ReturnType<typeof buildDocModel>>;
}): React.JSX.Element {
  const editor = useDocxEditor({ starterModel: model });
  return React.createElement(DocxEditorViewer, {
    editor,
    mode: "read-only"
  });
}

describe("grouped picture textbox render", () => {
  it("keeps the picture layer when rendering grouped picture + textbox SVG imports", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: GROUPED_PICTURE_TEXTBOX_DOC_XML },
      { name: "word/_rels/document.xml.rels", content: DOCUMENT_RELS_XML },
      { name: "word/media/image1.jpeg", content: Buffer.from(ONE_BY_ONE_JPEG_BASE64, "base64") }
    ]);

    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model }));

    expect(html).toContain("data-docx-image-location=\"p:0:0\"");
    expect(html).toContain("data:image/svg+xml;charset=utf-8,");
    expect(html).toContain("data%3Aimage%2Fjpeg%3Bbase64%2C");
    expect(html).toContain("Commonwealth%20of%20Massachusetts");
    expect(html).toContain("clear:both");
    expect(html).toContain("After group");
  });

  it("keeps grouped vector shape fill colors when they come from wps:style fillRef", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: GROUPED_VECTOR_SHAPE_DOC_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model }));

    expect(html).toContain("data:image/svg+xml;charset=utf-8,");
    expect(html).toContain("76A88B");
    expect(html).not.toContain("Missing image");
  });
});
