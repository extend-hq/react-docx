import { describe, expect, it } from "vitest";
import { buildDocModel } from "@extend-ai/react-docx-doc-model";
import { parseDocx } from "@extend-ai/react-docx-ooxml-core";
import { createZip } from "./helpers/zip";

const RED_TEXT_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    <w:p>
      <w:r>
        <w:rPr><w:color w:val="FF0000"/></w:rPr>
        <w:t>Red text</w:t>
      </w:r>
    </w:p>
    <w:tbl>
      <w:tr>
        <w:tc>
          <w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="00FF00"/></w:tcPr>
          <w:p><w:r><w:t>Cell A1</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:inline>
            <wp:extent cx="952500" cy="952500"/>
            <wp:docPr id="1" name="Picture" descr="Test image"/>
            <a:graphic>
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic>
                  <pic:blipFill>
                    <a:blip r:embed="rId5"/>
                  </pic:blipFill>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`;

const CONTENT_TYPES_WITH_SVG_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="svg" ContentType="image/svg+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const DRAWING_SVG_FALLBACK_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main">
  <w:body>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:anchor behindDoc="1">
            <wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>
            <wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>
            <wp:extent cx="1524000" cy="762000"/>
            <wp:wrapNone/>
            <wp:docPr id="1" name="Cover art"/>
            <a:graphic>
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic>
                  <pic:blipFill>
                    <a:blip r:embed="rId5">
                      <a:extLst>
                        <a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}">
                          <asvg:svgBlip r:embed="rId6"/>
                        </a:ext>
                      </a:extLst>
                    </a:blip>
                    <a:stretch/>
                  </pic:blipFill>
                  <pic:spPr>
                    <a:xfrm><a:off x="0" y="0"/><a:ext cx="1524000" cy="762000"/></a:xfrm>
                    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                  </pic:spPr>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:anchor>
        </w:drawing>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

const DOCUMENT_RELS_WITH_SVG_FALLBACK_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
  <Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image2.svg"/>
</Relationships>`;

const SIMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80" viewBox="0 0 160 80"><rect width="160" height="80" fill="#00B4D8"/><circle cx="130" cy="20" r="14" fill="#90E0EF"/></svg>`;

const HYPERLINK_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p>
      <w:r><w:t xml:space="preserve">Website: </w:t></w:r>
      <w:hyperlink r:id="rId2">
        <w:r>
          <w:rPr><w:rStyle w:val="InternetLink"/></w:rPr>
          <w:t>openai.com</w:t>
        </w:r>
      </w:hyperlink>
    </w:p>
  </w:body>
</w:document>`;

const FIELD_HYPERLINK_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:fldChar w:fldCharType="begin"/></w:r>
      <w:r><w:instrText xml:space="preserve"> HYPERLINK "https://example.com"</w:instrText></w:r>
      <w:r><w:fldChar w:fldCharType="separate"/></w:r>
      <w:r><w:t>_________</w:t></w:r>
      <w:r><w:fldChar w:fldCharType="end"/></w:r>
    </w:p>
  </w:body>
</w:document>`;

const DROP_CAP_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr>
        <w:framePr w:dropCap="drop" w:lines="3" w:wrap="around" w:hAnchor="text" w:vAnchor="text" w:x="240" w:y="120" w:hSpace="80" w:vSpace="40"/>
      </w:pPr>
      <w:r><w:t>A</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>fter the drop cap paragraph.</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

const RUN_BORDER_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t>Some text in a </w:t></w:r>
      <w:r>
        <w:rPr><w:bdr w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:rPr>
        <w:t>box</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

const RUN_SHADING_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:rPr>
          <w:color w:val="FFFFFF"/>
          <w:shd w:val="clear" w:color="auto" w:fill="000000"/>
        </w:rPr>
        <w:t>inverse video</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

const FORM_CONTROLS_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:p>
      <w:r><w:t xml:space="preserve">Female </w:t></w:r>
      <w:sdt>
        <w:sdtPr>
          <w14:checkbox>
            <w14:checked w14:val="0"/>
            <w14:checkedState w14:val="2612" w14:font="MS Gothic"/>
            <w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/>
          </w14:checkbox>
        </w:sdtPr>
        <w:sdtContent>
          <w:r><w:t>☐</w:t></w:r>
        </w:sdtContent>
      </w:sdt>
      <w:r><w:t xml:space="preserve"> Name: </w:t></w:r>
      <w:sdt>
        <w:sdtPr><w:text/></w:sdtPr>
        <w:sdtContent>
          <w:r><w:t>Click here.</w:t></w:r>
        </w:sdtContent>
      </w:sdt>
    </w:p>
    <w:p>
      <w:sdt>
        <w:sdtPr>
          <w:dropDownList>
            <w:listItem w:displayText="Option A" w:value="A"/>
            <w:listItem w:displayText="Option B" w:value="B"/>
            <w:lastValue w:val="B"/>
          </w:dropDownList>
        </w:sdtPr>
        <w:sdtContent>
          <w:r><w:t>Option B</w:t></w:r>
        </w:sdtContent>
      </w:sdt>
    </w:p>
  </w:body>
</w:document>`;

const ACTIVEX_CHECKBOX_OBJECT_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <w:body>
    <w:p>
      <w:r>
        <w:object w:dxaOrig="225" w:dyaOrig="225" w14:anchorId="4B610928">
          <v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f">
            <v:stroke joinstyle="miter"/>
            <v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/>
            <o:lock v:ext="edit" aspectratio="t"/>
          </v:shapetype>
          <v:shape id="_x0000_i1199" type="#_x0000_t75" style="width:20.05pt;height:17.9pt" o:ole="">
            <v:imagedata r:id="rId6" o:title=""/>
          </v:shape>
          <w:control r:id="rId7" w:name="DefaultOcxName" w:shapeid="_x0000_i1199"/>
        </w:object>
      </w:r>
      <w:r><w:t xml:space="preserve">Administrative Services</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

const ACTIVEX_CHECKBOX_DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image2.wmf"/>
  <Relationship Id="rId7" Type="http://schemas.microsoft.com/office/2006/relationships/activeXControl" Target="activeX/activeX1.xml"/>
</Relationships>`;

const ACTIVEX_CHECKBOX_XML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<ax:ocx ax:classid="{5512D116-5CC6-11CF-8D67-00AA00BDCE1D}" ax:persistence="persistStream" r:id="rId1" xmlns:ax="http://schemas.microsoft.com/office/2006/activeX" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>`;

const ACTIVEX_CHECKBOX_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2006/relationships/activeXControlBinary" Target="activeX1.bin"/>
</Relationships>`;

const ACTIVEX_CHECKBOX_BINARY = new TextEncoder().encode(
  '<INPUT TYPE="checkbox" CHECKED NAME="field-1" VALUE="1">'
);

const DOCUMENT_RELS_WITH_HYPERLINK_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://openai.com" TargetMode="External"/>
</Relationships>`;

const CONTENT_TYPES_WITH_HEADER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
</Types>`;

const TABLE_AND_HEADER_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    <w:tbl>
      <w:tr>
        <w:trPr><w:shd w:val="clear" w:color="auto" w:fill="3F4448"/></w:trPr>
        <w:tc>
          <w:tcPr><w:gridSpan w:val="2"/></w:tcPr>
          <w:p>
            <w:r>
              <w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr>
              <w:t>Demographics</w:t>
            </w:r>
          </w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId10"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const DOCUMENT_RELS_WITH_HEADER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
</Relationships>`;

const HEADER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:tbl>
    <w:tr>
      <w:tc>
        <w:p><w:r><w:t>Header</w:t></w:r></w:p>
      </w:tc>
      <w:tc>
        <w:p>
          <w:r>
            <w:drawing>
              <wp:inline>
                <wp:extent cx="952500" cy="952500"/>
                <wp:docPr id="1" name="Logo"/>
                <a:graphic>
                  <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                    <pic:pic>
                      <pic:blipFill>
                        <a:blip r:embed="rId1"/>
                      </pic:blipFill>
                    </pic:pic>
                  </a:graphicData>
                </a:graphic>
              </wp:inline>
            </w:drawing>
          </w:r>
        </w:p>
      </w:tc>
    </w:tr>
  </w:tbl>
</w:hdr>`;

const HEADER_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`;

const CONTENT_TYPES_WITH_TWO_HEADERS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
</Types>`;

const MULTI_SECTION_HEADERS_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:r><w:t>Section One</w:t></w:r></w:p>
    <w:p>
      <w:pPr>
        <w:sectPr>
          <w:headerReference w:type="default" r:id="rId10"/>
          <w:pgSz w:w="12240" w:h="15840"/>
          <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>
        </w:sectPr>
      </w:pPr>
    </w:p>
    <w:p><w:r><w:t>Section Two</w:t></w:r></w:p>
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId11"/>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const DOCUMENT_RELS_WITH_TWO_HEADERS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rId11" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/>
</Relationships>`;

const SIMPLE_HEADER_ONE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:r><w:t>Header One</w:t></w:r></w:p>
</w:hdr>`;

const SIMPLE_HEADER_TWO_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:r><w:t>Header Two</w:t></w:r></w:p>
</w:hdr>`;

const DRAWING_TEXTBOX_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
  <w:body>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:inline>
            <wp:extent cx="952500" cy="952500"/>
            <wp:docPr id="1" name="Background"/>
            <a:graphic>
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic>
                  <pic:blipFill>
                    <a:blip r:embed="rId5"/>
                  </pic:blipFill>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
      <w:r>
        <w:drawing>
          <wp:anchor>
            <a:graphic>
              <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
                <wps:wsp>
                  <wps:txbx>
                    <w:txbxContent>
                      <w:p>
                        <w:r>
                          <w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr>
                          <w:t>Overlay Title</w:t>
                        </w:r>
                      </w:p>
                    </w:txbxContent>
                  </wps:txbx>
                </wps:wsp>
              </a:graphicData>
            </a:graphic>
          </wp:anchor>
        </w:drawing>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

const DRAWING_TEXTBOX_ALTERNATE_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:v="urn:schemas-microsoft-com:vml" mc:Ignorable="w14">
  <w:body>
    <w:p>
      <w:r>
        <w:rPr><w:color w:val="000000"/></w:rPr>
        <mc:AlternateContent>
          <mc:Choice Requires="wps">
            <w:drawing>
              <wp:anchor>
                <a:graphic>
                  <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
                    <wps:wsp>
                      <wps:txbx>
                        <w:txbxContent>
                          <w:p>
                            <w:r>
                              <w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr>
                              <w:t>Overlay Title</w:t>
                            </w:r>
                          </w:p>
                        </w:txbxContent>
                      </wps:txbx>
                    </wps:wsp>
                  </a:graphicData>
                </a:graphic>
              </wp:anchor>
            </w:drawing>
          </mc:Choice>
          <mc:Fallback>
            <w:pict>
              <v:shape>
                <v:textbox>
                  <w:txbxContent>
                    <w:p><w:r><w:t>Overlay Title</w:t></w:r></w:p>
                  </w:txbxContent>
                </v:textbox>
              </v:shape>
            </w:pict>
          </mc:Fallback>
        </mc:AlternateContent>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

const GROUPED_PICTURE_TEXTBOX_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
  <w:body>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:anchor behindDoc="0">
            <wp:extent cx="4936605" cy="845819"/>
            <wp:docPr id="5" name="Group 5"/>
            <a:graphic>
              <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">
                <wpg:wgp>
                  <wpg:grpSpPr>
                    <a:xfrm>
                      <a:off x="0" y="0"/>
                      <a:ext cx="4936605" cy="845819"/>
                      <a:chOff x="0" y="0"/>
                      <a:chExt cx="4933026" cy="850291"/>
                    </a:xfrm>
                  </wpg:grpSpPr>
                  <pic:pic>
                    <pic:blipFill>
                      <a:blip r:embed="rId5"/>
                    </pic:blipFill>
                    <pic:spPr>
                      <a:xfrm>
                        <a:off x="0" y="0"/>
                        <a:ext cx="1371600" cy="731520"/>
                      </a:xfrm>
                    </pic:spPr>
                  </pic:pic>
                  <wps:wsp>
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
                        <w:p><w:r><w:t>Office of Medicaid</w:t></w:r></w:p>
                      </w:txbxContent>
                    </wps:txbx>
                  </wps:wsp>
                </wpg:wgp>
              </a:graphicData>
            </a:graphic>
          </wp:anchor>
        </w:drawing>
      </w:r>
      <w:r><w:t>After group</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

const GROUPED_TEXTBOX_VERTICAL_ANCHOR_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
  <w:body>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:anchor behindDoc="1">
            <wp:extent cx="6858000" cy="7315576"/>
            <wp:docPr id="10" name="Group 10"/>
            <a:graphic>
              <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">
                <wpg:wgp>
                  <wpg:grpSpPr>
                    <a:xfrm>
                      <a:off x="0" y="0"/>
                      <a:ext cx="6858000" cy="7315576"/>
                      <a:chOff x="0" y="0"/>
                      <a:chExt cx="6858000" cy="7315576"/>
                    </a:xfrm>
                  </wpg:grpSpPr>
                  <wps:wsp>
                    <wps:cNvPr id="11" name="Text Box 11"/>
                    <wps:cNvSpPr txBox="1"/>
                    <wps:spPr>
                      <a:xfrm>
                        <a:off x="0" y="0"/>
                        <a:ext cx="6858000" cy="7315576"/>
                      </a:xfrm>
                      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                      <a:noFill/>
                      <a:ln w="6350"><a:noFill/></a:ln>
                    </wps:spPr>
                    <wps:txbx>
                      <w:txbxContent>
                        <w:p>
                          <w:pPr>
                            <w:jc w:val="center"/>
                            <w:rPr><w:b/><w:color w:val="9BE36E"/><w:sz w:val="72"/></w:rPr>
                          </w:pPr>
                          <w:r><w:rPr><w:b/><w:color w:val="9BE36E"/><w:sz w:val="72"/></w:rPr><w:t>BUSINESS PROPOSAL</w:t></w:r>
                        </w:p>
                        <w:p>
                          <w:pPr>
                            <w:spacing w:before="240"/>
                            <w:jc w:val="center"/>
                            <w:rPr><w:color w:val="123500"/><w:sz w:val="48"/></w:rPr>
                          </w:pPr>
                          <w:r><w:rPr><w:color w:val="123500"/><w:sz w:val="48"/></w:rPr><w:t>COMPANY NAME</w:t></w:r>
                        </w:p>
                      </w:txbxContent>
                    </wps:txbx>
                    <wps:bodyPr lIns="457200" tIns="457200" rIns="457200" bIns="457200" anchor="ctr"><a:prstTxWarp prst="textNoShape"><a:avLst/></a:prstTxWarp><a:noAutofit/></wps:bodyPr>
                  </wps:wsp>
                  <wps:wsp>
                    <wps:cNvPr id="12" name="Rectangle 12"/>
                    <wps:cNvSpPr txBox="1"/>
                    <wps:spPr>
                      <a:xfrm>
                        <a:off x="0" y="5486400"/>
                        <a:ext cx="6858000" cy="1828800"/>
                      </a:xfrm>
                      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                      <a:solidFill><a:srgbClr val="9BE36E"/></a:solidFill>
                      <a:ln w="6350"><a:noFill/></a:ln>
                    </wps:spPr>
                    <wps:txbx>
                      <w:txbxContent>
                        <w:p>
                          <w:pPr><w:rPr><w:color w:val="FFFFFF"/><w:sz w:val="28"/></w:rPr></w:pPr>
                          <w:r><w:rPr><w:color w:val="FFFFFF"/><w:sz w:val="28"/></w:rPr><w:t>Contact name</w:t></w:r>
                        </w:p>
                      </w:txbxContent>
                    </wps:txbx>
                    <wps:bodyPr lIns="457200" tIns="182880" rIns="457200" bIns="457200" anchor="b"><a:prstTxWarp prst="textNoShape"><a:avLst/></a:prstTxWarp><a:noAutofit/></wps:bodyPr>
                  </wps:wsp>
                </wpg:wgp>
              </a:graphicData>
            </a:graphic>
          </wp:anchor>
        </w:drawing>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

const TEXTBOX_COLOR_ONLY_UNDERLINE_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
  <w:body>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:anchor behindDoc="0">
            <wp:extent cx="5071110" cy="4519448"/>
            <a:graphic>
              <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
                <wps:wsp>
                  <wps:txbx>
                    <w:txbxContent>
                      <w:p>
                        <w:pPr>
                          <w:pStyle w:val="IntroParagraph"/>
                          <w:jc w:val="center"/>
                          <w:rPr>
                            <w:b/>
                            <w:color w:val="FFFFFF"/>
                            <w:sz w:val="72"/>
                            <w:u w:color="FFFFFF"/>
                          </w:rPr>
                        </w:pPr>
                        <w:r>
                          <w:rPr>
                            <w:b/>
                            <w:color w:val="FFFFFF"/>
                            <w:sz w:val="72"/>
                            <w:u w:color="FFFFFF"/>
                          </w:rPr>
                          <w:t><REDACTED_DOC></w:t>
                        </w:r>
                      </w:p>
                      <w:p>
                        <w:pPr>
                          <w:pStyle w:val="IntroParagraph"/>
                          <w:jc w:val="center"/>
                          <w:rPr>
                            <w:b/>
                            <w:color w:val="FFFFFF"/>
                            <w:sz w:val="72"/>
                            <w:u w:color="FFFFFF"/>
                          </w:rPr>
                        </w:pPr>
                        <w:r>
                          <w:rPr>
                            <w:b/>
                            <w:color w:val="FFFFFF"/>
                            <w:sz w:val="72"/>
                            <w:u w:color="FFFFFF"/>
                          </w:rPr>
                          <w:t>Cleaning Services for Libraries ACT</w:t>
                        </w:r>
                      </w:p>
                    </w:txbxContent>
                  </wps:txbx>
                </wps:wsp>
              </a:graphicData>
            </a:graphic>
          </wp:anchor>
        </w:drawing>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

const TEXTBOX_COLOR_ONLY_UNDERLINE_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
        <w:color w:val="000000"/>
        <w:sz w:val="24"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="IntroParagraph">
    <w:name w:val="Intro Paragraph"/>
    <w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
      <w:u w:val="none"/>
    </w:rPr>
  </w:style>
</w:styles>`;

const CUSTOM_SHAPE_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
  <w:body>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:anchor behindDoc="1">
            <wp:positionH relativeFrom="margin"><wp:align>center</wp:align></wp:positionH>
            <wp:positionV relativeFrom="paragraph"><wp:posOffset>-650875</wp:posOffset></wp:positionV>
            <wp:extent cx="3865880" cy="3528060"/>
            <wp:docPr id="43" name="Flowchart: Delay 16"/>
            <a:graphic>
              <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
                <wps:wsp>
                  <wps:spPr bwMode="auto">
                    <a:xfrm rot="5400000"><a:off x="0" y="0"/><a:ext cx="3865880" cy="3528060"/></a:xfrm>
                    <a:prstGeom prst="flowChartDelay"><a:avLst/></a:prstGeom>
                    <a:solidFill><a:schemeClr val="bg1"/></a:solidFill>
                    <a:ln w="25400"><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></a:ln>
                  </wps:spPr>
                </wps:wsp>
              </a:graphicData>
            </a:graphic>
          </wp:anchor>
        </w:drawing>
      </w:r>
      <w:r>
        <w:drawing>
          <wp:anchor behindDoc="1">
            <wp:positionH relativeFrom="margin"><wp:align>center</wp:align></wp:positionH>
            <wp:positionV relativeFrom="paragraph"><wp:posOffset>-669925</wp:posOffset></wp:positionV>
            <wp:extent cx="7269480" cy="9487535"/>
            <wp:docPr id="42" name="Freeform: Shape 12"/>
            <a:graphic>
              <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
                <wps:wsp>
                  <wps:spPr bwMode="auto">
                    <a:xfrm><a:off x="0" y="0"/><a:ext cx="7269480" cy="9487535"/></a:xfrm>
                    <a:custGeom>
                      <a:avLst/>
                      <a:pathLst>
                        <a:path w="8513" h="2403">
                          <a:moveTo><a:pt x="8512" y="0"/></a:moveTo>
                          <a:lnTo><a:pt x="108" y="0"/></a:lnTo>
                          <a:lnTo><a:pt x="0" y="2402"/></a:lnTo>
                          <a:lnTo><a:pt x="8512" y="2402"/></a:lnTo>
                          <a:close/>
                        </a:path>
                      </a:pathLst>
                    </a:custGeom>
                    <a:gradFill rotWithShape="1">
                      <a:gsLst>
                        <a:gs pos="0"><a:srgbClr val="2B4C17"><a:alpha val="0"/></a:srgbClr></a:gs>
                        <a:gs pos="50000"><a:srgbClr val="427026"><a:alpha val="50000"/></a:srgbClr></a:gs>
                        <a:gs pos="100000"><a:srgbClr val="51872F"/></a:gs>
                      </a:gsLst>
                      <a:lin ang="5400000" scaled="1"/>
                    </a:gradFill>
                    <a:ln><a:noFill/></a:ln>
                  </wps:spPr>
                </wps:wsp>
              </a:graphicData>
            </a:graphic>
          </wp:anchor>
        </w:drawing>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

const FILTERED_IMAGE_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:anchor behindDoc="1">
            <wp:extent cx="7256756" cy="9498842"/>
            <wp:docPr id="1" name="Picture 1"/>
            <a:graphic>
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic>
                  <pic:blipFill rotWithShape="1">
                    <a:blip r:embed="rId5">
                      <a:duotone>
                        <a:prstClr val="black"/>
                        <a:schemeClr val="accent3"/>
                      </a:duotone>
                      <a:alphaModFix amt="57000"/>
                      <a:extLst>
                        <a:ext uri="{BEBA8EAE-BF5A-486C-A8C5-ECC9F3942E4B}">
                          <a14:imgProps>
                            <a14:imgLayer r:embed="rId6">
                              <a14:imgEffect><a14:artisticPastelsSmooth trans="34000"/></a14:imgEffect>
                            </a14:imgLayer>
                          </a14:imgProps>
                        </a:ext>
                      </a:extLst>
                    </a:blip>
                    <a:srcRect t="3196" b="12653"/>
                    <a:stretch/>
                  </pic:blipFill>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:anchor>
        </w:drawing>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

const CONTENT_TYPES_WITH_CHART_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
</Types>`;

const CHART_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
  <w:body>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:inline>
            <wp:extent cx="4098290" cy="2059305"/>
            <wp:docPr id="1" name="Sales chart"/>
            <a:graphic>
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
                <c:chart r:id="rId3"/>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

const DOCUMENT_RELS_WITH_CHART_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/chart1.xml"/>
</Relationships>`;

const CHART_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <c:chart>
    <c:title><c:tx><c:rich><a:p><a:r><a:t>Quarterly Revenue</a:t></a:r></a:p></c:rich></c:tx></c:title>
    <c:plotArea>
      <c:barChart>
        <c:ser>
          <c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>North</c:v></c:pt></c:strCache></c:strRef></c:tx>
          <c:spPr><a:solidFill><a:srgbClr val="004586"/></a:solidFill></c:spPr>
          <c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt></c:strCache></c:strRef></c:cat>
          <c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>4.2</c:v></c:pt><c:pt idx="1"><c:v>8.1</c:v></c:pt></c:numCache></c:numRef></c:val>
        </c:ser>
        <c:ser>
          <c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>South</c:v></c:pt></c:strCache></c:strRef></c:tx>
          <c:spPr><a:solidFill><a:srgbClr val="ff420e"/></a:solidFill></c:spPr>
          <c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt></c:strCache></c:strRef></c:cat>
          <c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>2.1</c:v></c:pt><c:pt idx="1"><c:v>7.5</c:v></c:pt></c:numCache></c:numRef></c:val>
        </c:ser>
      </c:barChart>
    </c:plotArea>
  </c:chart>
</c:chartSpace>`;

const CONTENT_TYPES_WITH_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const STYLES_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
        <w:sz w:val="22"/>
        <w:color w:val="222222"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Body"/>
    <w:rPr>
      <w:color w:val="111111"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="CustomBody">
    <w:name w:val="Custom Body"/>
    <w:basedOn w:val="Normal"/>
    <w:rPr>
      <w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/>
      <w:color w:val="336699"/>
    </w:rPr>
  </w:style>
  <w:style w:type="character" w:styleId="FancyLink">
    <w:name w:val="Fancy Link"/>
    <w:rPr>
      <w:color w:val="AA00AA"/>
      <w:u w:val="single"/>
    </w:rPr>
  </w:style>
</w:styles>`;

const DOC_WITH_STYLE_REFERENCES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="CustomBody"/>
      </w:pPr>
      <w:r>
        <w:t>Styled paragraph</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:rPr><w:rStyle w:val="FancyLink"/></w:rPr>
        <w:t>Styled run</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="CustomBody"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:rFonts w:cs="Arial Unicode MS" w:eastAsia="Arial Unicode MS"/>
        </w:rPr>
        <w:t>Latin run should keep CustomBody font</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

const DOC_WITH_EAST_ASIA_THEME_STYLE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Heading1"/>
      </w:pPr>
      <w:r>
        <w:t>Latin heading should keep the Normal font</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

const STYLES_WITH_EAST_ASIA_THEME_HEADING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr>
      <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:rPr>
      <w:rFonts w:eastAsiaTheme="majorEastAsia"/>
    </w:rPr>
  </w:style>
</w:styles>`;

const THEME_WITH_CAMBRIA_MAJOR_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
  <a:themeElements>
    <a:fontScheme name="Office">
      <a:majorFont>
        <a:latin typeface="Cambria"/>
        <a:ea typeface=""/>
        <a:cs typeface=""/>
      </a:majorFont>
      <a:minorFont>
        <a:latin typeface="Calibri"/>
        <a:ea typeface=""/>
        <a:cs typeface=""/>
      </a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>`;

const DOC_WITH_NO_DEFAULT_PARAGRAPH_STYLE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t>Body text should not become Heading 1</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

const STYLES_WITH_ONLY_HEADING_DEFINITIONS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>
        <w:sz w:val="22"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:rPr>
      <w:b/>
      <w:sz w:val="48"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:rPr>
      <w:b/>
      <w:sz w:val="36"/>
    </w:rPr>
  </w:style>
</w:styles>`;

const PAGINATION_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr>
      <w:keepNext w:val="0"/>
      <w:keepLines w:val="0"/>
      <w:widowControl w:val="1"/>
      <w:pageBreakBefore w:val="0"/>
    </w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="KeepWithNext">
    <w:name w:val="Keep With Next"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:keepNext w:val="1"/>
      <w:keepLines w:val="1"/>
      <w:widowControl w:val="1"/>
      <w:pageBreakBefore w:val="0"/>
    </w:pPr>
  </w:style>
</w:styles>`;

const DOC_WITH_PAGINATION_STYLE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="KeepWithNext"/></w:pPr>
      <w:r><w:t>Keep this paragraph with the next one</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Normal"/>
        <w:pageBreakBefore/>
        <w:keepLines w:val="0"/>
      </w:pPr>
      <w:r><w:t>Start on a new page</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

const PARAGRAPH_BORDERS_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr>
      <w:pBdr>
        <w:bottom w:val="single" w:sz="8" w:space="4" w:color="auto"/>
      </w:pBdr>
    </w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:pBdr>
        <w:top w:val="double" w:sz="6" w:space="2" w:color="336699"/>
      </w:pBdr>
    </w:pPr>
  </w:style>
</w:styles>`;

const DOC_WITH_PARAGRAPH_BORDERS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Title"/>
      </w:pPr>
      <w:r><w:t>Title with inherited border</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Title"/>
        <w:pBdr>
          <w:bottom w:val="nil"/>
        </w:pBdr>
      </w:pPr>
      <w:r><w:t>Title with direct border override</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

const DOC_WITH_PARAGRAPH_SHADING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr>
        <w:shd w:val="clear" w:color="auto" w:fill="DDDDDD"/>
        <w:jc w:val="right"/>
      </w:pPr>
      <w:r><w:t>Paragraph with gray background</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

const DOC_WITH_JC_BOTH_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr>
        <w:jc w:val="both"/>
      </w:pPr>
      <w:r><w:t>Justified paragraph</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

const TABLE_LAYOUT_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:bookmarkStart w:id="0" w:name="_GoBack"/>
      <w:bookmarkEnd w:id="0"/>
    </w:p>
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="7200" w:type="dxa"/>
        <w:tblInd w:w="180" w:type="dxa"/>
        <w:tblLayout w:type="fixed"/>
        <w:tblCellMar>
          <w:top w:w="120" w:type="dxa"/>
          <w:right w:w="90" w:type="dxa"/>
          <w:bottom w:w="120" w:type="dxa"/>
          <w:left w:w="90" w:type="dxa"/>
        </w:tblCellMar>
      </w:tblPr>
      <w:tblGrid>
        <w:gridCol w:w="5000"/>
        <w:gridCol w:w="2200"/>
      </w:tblGrid>
      <w:tr>
        <w:trPr><w:trHeight w:val="840"/></w:trPr>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="5000" w:type="dxa"/>
            <w:tcMar>
              <w:top w:w="180" w:type="dxa"/>
              <w:right w:w="180" w:type="dxa"/>
              <w:bottom w:w="180" w:type="dxa"/>
              <w:left w:w="180" w:type="dxa"/>
            </w:tcMar>
            <w:vAlign w:val="center"/>
          </w:tcPr>
          <w:p><w:r><w:t>Left cell</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr><w:tcW w:w="2200" w:type="dxa"/></w:tcPr>
          <w:p><w:r><w:t>Right cell</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

const TABLE_BORDERS_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tblPr>
        <w:tblBorders>
          <w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>
          <w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>
          <w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>
          <w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>
          <w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>
          <w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>
        </w:tblBorders>
      </w:tblPr>
      <w:tr>
        <w:tc>
          <w:p><w:r><w:t>Layout cell</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
    <w:tbl>
      <w:tr>
        <w:tc>
          <w:tcPr>
            <w:tcBorders>
              <w:top w:val="single" w:sz="8" w:space="0" w:color="BFBFBF"/>
              <w:left w:val="single" w:sz="8" w:space="0" w:color="FF0000"/>
            </w:tcBorders>
          </w:tcPr>
          <w:p><w:r><w:t>Bordered cell</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

const STYLES_WITH_TABLE_CONDITIONALS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="table" w:styleId="HeaderOnly">
    <w:name w:val="Header Only"/>
    <w:tblStylePr w:type="firstRow">
      <w:tcPr>
        <w:shd w:val="clear" w:color="auto" w:fill="9BBB59"/>
        <w:tcBorders>
          <w:top w:val="single" w:sz="8" w:space="0" w:color="00AA00"/>
        </w:tcBorders>
      </w:tcPr>
      <w:rPr>
        <w:b/>
        <w:color w:val="FFFFFF"/>
      </w:rPr>
    </w:tblStylePr>
  </w:style>
</w:styles>`;

const DOC_WITH_TABLE_STYLE_CONDITIONALS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tblPr>
        <w:tblStyle w:val="HeaderOnly"/>
        <w:tblLook w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/>
      </w:tblPr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Header</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Body</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

const STYLES_WITH_CALENDAR_LIKE_TABLE_STYLE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="table" w:styleId="CalendarLike">
    <w:name w:val="Calendar Like"/>
    <w:pPr>
      <w:jc w:val="right"/>
    </w:pPr>
    <w:rPr>
      <w:color w:val="7F7F7F"/>
    </w:rPr>
    <w:tblStylePr w:type="firstRow">
      <w:pPr>
        <w:jc w:val="right"/>
      </w:pPr>
      <w:rPr>
        <w:color w:val="365F91"/>
        <w:sz w:val="44"/>
      </w:rPr>
    </w:tblStylePr>
  </w:style>
</w:styles>`;

const DOC_WITH_CALENDAR_LIKE_TABLE_STYLE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tblPr>
        <w:tblStyle w:val="CalendarLike"/>
        <w:tblLook w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/>
      </w:tblPr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>December 2007</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

const DOC_WITH_NESTED_VMERGE_TABLE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tr>
        <w:tc>
          <w:tbl>
            <w:tr>
              <w:tc>
                <w:tcPr><w:vMerge w:val="restart"/></w:tcPr>
                <w:p><w:r><w:t>One</w:t></w:r></w:p>
                <w:p><w:r><w:t>Three</w:t></w:r></w:p>
              </w:tc>
              <w:tc><w:p><w:r><w:t>Two</w:t></w:r></w:p></w:tc>
            </w:tr>
            <w:tr>
              <w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>
              <w:tc><w:p><w:r><w:t>Four</w:t></w:r></w:p></w:tc>
            </w:tr>
          </w:tbl>
        </w:tc>
        <w:tc><w:p><w:r><w:t>Right</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

const STYLES_WITH_STYLE_LOOK_AND_PROPERTIES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="table" w:styleId="StyleLookAndProperties">
    <w:name w:val="Style Look And Properties"/>
    <w:tblPr>
      <w:tblLook w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/>
      <w:tblW w:w="5200" w:type="dxa"/>
      <w:tblLayout w:type="autofit"/>
      <w:tblStyleRowBandSize w:val="2"/>
      <w:tblStyleColBandSize w:val="2"/>
      <w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:right w:w="90" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:left w:w="90" w:type="dxa"/></w:tblCellMar>
    </w:tblPr>
    <w:tblStylePr w:type="firstRow">
      <w:tcPr>
        <w:shd w:fill="9bbb59"/>
      </w:tcPr>
      <w:rPr>
        <w:b/>
        <w:color w:val="ffffff"/>
      </w:rPr>
    </w:tblStylePr>
  </w:style>
</w:styles>`;

const DOC_WITH_TABLE_STYLE_LOOK_FROM_STYLE_ONLY_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tblPr>
        <w:tblStyle w:val="StyleLookAndProperties"/>
      </w:tblPr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Header</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Body</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

const DOC_WITH_FLOATING_TABLE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="2800" w:type="dxa"/>
        <w:tblpPr
          w:leftFromText="120"
          w:rightFromText="240"
          w:topFromText="60"
          w:bottomFromText="180"
          w:vertAnchor="text"
          w:horzAnchor="margin"
          w:tblpX="720"
          w:tblpY="360"
          w:tblpXSpec="left"
          w:tblpYSpec="top"/>
      </w:tblPr>
      <w:tr><w:tc><w:p><w:r><w:t>Floating table</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

const NUMBERED_LIST_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr>
        <w:numPr>
          <w:ilvl w:val="0"/>
          <w:numId w:val="1"/>
        </w:numPr>
      </w:pPr>
      <w:r><w:t>Top level</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:numPr>
          <w:ilvl w:val="1"/>
          <w:numId w:val="1"/>
        </w:numPr>
      </w:pPr>
      <w:r><w:t>Second level</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:numPr>
          <w:ilvl w:val="2"/>
          <w:numId w:val="1"/>
        </w:numPr>
      </w:pPr>
      <w:r><w:t>Third level</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

const NUMBERING_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
    </w:lvl>
    <w:lvl w:ilvl="1">
      <w:start w:val="1"/>
      <w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1.%2."/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr>
      <w:rPr>
        <w:rFonts w:hAnsi="Arial Unicode MS"/>
        <w:color w:val="7030A0"/>
      </w:rPr>
    </w:lvl>
    <w:lvl w:ilvl="2">
      <w:start w:val="1"/>
      <w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1.%2.%3."/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1">
    <w:abstractNumId w:val="0"/>
  </w:num>
</w:numbering>`;

const CONTENT_TYPES_WITH_NUMBERING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

const DOCUMENT_RELS_WITH_NUMBERING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

const ONE_BY_ONE_PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2M4x8AAAAASUVORK5CYII=",
    "base64"
  )
);

describe("doc-model import", () => {
  it("imports deleted paragraph marks so final-view layout can collapse them like Word", async () => {
    const deletedParagraphMarkDocXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr>
        <w:rPr>
          <w:del w:id="1" w:author="Author" w:date="2023-02-20T15:55:00Z"/>
        </w:rPr>
      </w:pPr>
      <w:r><w:t>Personal information</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t></w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: deletedParagraphMarkDocXml }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    expect(model.nodes[0]?.type).toBe("paragraph");
    expect(model.nodes[1]?.type).toBe("paragraph");
    if (model.nodes[0]?.type === "paragraph") {
      expect(model.nodes[0].paragraphMarkDeleted).toBe(true);
    }
    if (model.nodes[1]?.type === "paragraph") {
      expect(model.nodes[1].paragraphMarkDeleted).toBeUndefined();
    }
  });

  it("imports contextualSpacing from paragraph styles", async () => {
    const contextualSpacingDocXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="ListParagraph"/>
      </w:pPr>
      <w:r><w:t>One</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;
    const contextualSpacingStylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1">
    <w:name w:val="Normal"/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph">
    <w:name w:val="List Paragraph"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:contextualSpacing/>
    </w:pPr>
  </w:style>
</w:styles>`;

    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: contextualSpacingDocXml },
      { name: "word/styles.xml", content: contextualSpacingStylesXml }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    expect(model.nodes[0]?.type).toBe("paragraph");
    if (model.nodes[0]?.type === "paragraph") {
      expect(model.nodes[0].style?.styleId).toBe("ListParagraph");
      expect(model.nodes[0].style?.contextualSpacing).toBe(true);
    }
  });

  it("imports text color, tables, and embedded images", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: RED_TEXT_DOC_XML },
      { name: "word/_rels/document.xml.rels", content: DOCUMENT_RELS_XML },
      { name: "word/media/image1.png", content: ONE_BY_ONE_PNG }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    const firstParagraph = model.nodes[0];
    expect(firstParagraph?.type).toBe("paragraph");
    if (firstParagraph?.type === "paragraph") {
      const firstRun = firstParagraph.children[0];
      expect(firstRun?.type).toBe("text");
      if (firstRun?.type === "text") {
        expect(firstRun.style?.color?.toLowerCase()).toBe("#ff0000");
      }
    }

    const tableNode = model.nodes.find((node) => node.type === "table");
    expect(tableNode).toBeDefined();
    if (tableNode?.type === "table") {
      expect(tableNode.rows[0]?.cells[0]?.style?.backgroundColor?.toLowerCase()).toBe("#00ff00");
      expect(tableNode.rows[0]?.cells[0]?.nodes[0]?.children[0]?.type).toBe("text");
    }

    const imageParagraph = model.nodes.find((node) =>
      node.type === "paragraph" && node.children.some((child) => child.type === "image")
    );
    expect(imageParagraph).toBeDefined();
    if (imageParagraph?.type === "paragraph") {
      const imageRun = imageParagraph.children.find((child) => child.type === "image");
      expect(imageRun).toBeDefined();
      if (imageRun?.type === "image") {
        expect(imageRun.src?.startsWith("data:image/png;base64,")).toBe(true);
        expect(imageRun.widthPx).toBeGreaterThan(0);
        expect(imageRun.heightPx).toBeGreaterThan(0);
      }
    }
  });

  it("imports numbering level indentation metadata", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_WITH_NUMBERING_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: NUMBERED_LIST_DOC_XML },
      { name: "word/_rels/document.xml.rels", content: DOCUMENT_RELS_WITH_NUMBERING_XML },
      { name: "word/numbering.xml", content: NUMBERING_DOC_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    expect(model.metadata.numberingDefinitions).toBeDefined();
    const levelSet = model.metadata.numberingDefinitions;
    if (!levelSet) {
      return;
    }

    const numbering = levelSet.instances.find((instance) => instance.numId === 1);
    expect(numbering?.abstractNumId).toBe(0);

    const abstractNumber = levelSet.abstracts.find((candidate) => candidate.abstractNumId === 0);
    expect(abstractNumber?.levels[0]?.indent?.leftTwips).toBe(720);
    expect(abstractNumber?.levels[1]?.indent?.leftTwips).toBe(1440);
    expect(abstractNumber?.levels[2]?.indent?.leftTwips).toBe(2160);
    expect(abstractNumber?.levels[1]?.runStyle?.color?.toLowerCase()).toBe("#7030a0");
  });

  it("imports hyperlink runs with external targets", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: HYPERLINK_DOC_XML },
      { name: "word/_rels/document.xml.rels", content: DOCUMENT_RELS_WITH_HYPERLINK_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);
    const firstParagraph = model.nodes[0];
    expect(firstParagraph?.type).toBe("paragraph");

    if (firstParagraph?.type === "paragraph") {
      const linkRun = firstParagraph.children.find(
        (child) => child.type === "text" && child.link
      );
      expect(linkRun?.type).toBe("text");
      if (linkRun?.type === "text") {
        expect(linkRun.text).toBe("openai.com");
        expect(linkRun.link).toBe("https://openai.com");
      }
    }
  });

  it("imports field-code hyperlinks as clickable links", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: FIELD_HYPERLINK_DOC_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);
    const firstParagraph = model.nodes[0];
    expect(firstParagraph?.type).toBe("paragraph");

    if (firstParagraph?.type === "paragraph") {
      const linkRun = firstParagraph.children.find(
        (child) => child.type === "text" && child.text === "_________"
      );
      expect(linkRun?.type).toBe("text");
      if (linkRun?.type === "text") {
        expect(linkRun.link).toBe("https://example.com");
      }
    }
  });

  it("imports SDT form controls as structured form-field runs", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: FORM_CONTROLS_DOC_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    const firstParagraph = model.nodes[0];
    expect(firstParagraph?.type).toBe("paragraph");
    if (firstParagraph?.type === "paragraph") {
      const checkboxField = firstParagraph.children.find(
        (child) => child.type === "form-field" && child.fieldType === "checkbox"
      );
      expect(checkboxField?.type).toBe("form-field");
      if (checkboxField?.type === "form-field") {
        expect(checkboxField.fieldType).toBe("checkbox");
        expect(checkboxField.checked).toBe(false);
        expect(checkboxField.uncheckedSymbol).toBe("☐");
      }

      const textField = firstParagraph.children.find(
        (child) => child.type === "form-field" && child.fieldType === "text"
      );
      expect(textField?.type).toBe("form-field");
      if (textField?.type === "form-field") {
        expect(textField.value).toBe("Click here.");
      }
    }

    const secondParagraph = model.nodes[1];
    expect(secondParagraph?.type).toBe("paragraph");
    if (secondParagraph?.type === "paragraph") {
      const dropdownField = secondParagraph.children.find(
        (child) => child.type === "form-field" && child.fieldType === "dropdown"
      );
      expect(dropdownField?.type).toBe("form-field");
      if (dropdownField?.type === "form-field") {
        expect(dropdownField.value).toBe("Option B");
        expect(dropdownField.options).toHaveLength(2);
      }
    }
  });

  it("imports ActiveX checkbox objects as structured checkbox form fields", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: ACTIVEX_CHECKBOX_OBJECT_DOC_XML },
      {
        name: "word/_rels/document.xml.rels",
        content: ACTIVEX_CHECKBOX_DOCUMENT_RELS_XML
      },
      { name: "word/activeX/activeX1.xml", content: ACTIVEX_CHECKBOX_XML },
      {
        name: "word/activeX/_rels/activeX1.xml.rels",
        content: ACTIVEX_CHECKBOX_RELS_XML
      },
      { name: "word/activeX/activeX1.bin", content: ACTIVEX_CHECKBOX_BINARY },
      { name: "word/media/image2.wmf", content: new Uint8Array([1, 2, 3, 4]) }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    const firstParagraph = model.nodes[0];
    expect(firstParagraph?.type).toBe("paragraph");
    if (firstParagraph?.type === "paragraph") {
      const checkboxField = firstParagraph.children.find(
        (child) => child.type === "form-field" && child.fieldType === "checkbox"
      );
      expect(checkboxField?.type).toBe("form-field");
      if (checkboxField?.type === "form-field") {
        expect(checkboxField.checked).toBe(true);
        expect(checkboxField.widget?.name).toBe("field-1");
      }

      expect(
        firstParagraph.children.some((child) => child.type === "image")
      ).toBe(false);
    }
  });

  it("imports header images, table row shading, cell spans, and run styles", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_WITH_HEADER_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: TABLE_AND_HEADER_DOC_XML },
      { name: "word/_rels/document.xml.rels", content: DOCUMENT_RELS_WITH_HEADER_XML },
      { name: "word/header1.xml", content: HEADER_XML },
      { name: "word/_rels/header1.xml.rels", content: HEADER_RELS_XML },
      { name: "word/media/image1.png", content: ONE_BY_ONE_PNG }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    const tableNode = model.nodes.find((node) => node.type === "table");
    expect(tableNode).toBeDefined();
    if (tableNode?.type === "table") {
      const headerRow = tableNode.rows[0];
      expect(headerRow?.style?.backgroundColor?.toLowerCase()).toBe("#3f4448");
      expect(headerRow?.cells[0]?.style?.gridSpan).toBe(2);

      const firstRun = headerRow?.cells[0]?.nodes[0]?.children[0];
      expect(firstRun?.type).toBe("text");
      if (firstRun?.type === "text") {
        expect(firstRun.style?.bold).toBe(true);
        expect(firstRun.style?.color?.toLowerCase()).toBe("#ffffff");
      }
    }

    expect(model.metadata.headerSections).toHaveLength(1);
    const headerSection = model.metadata.headerSections[0];
    expect(headerSection?.partName).toBe("word/header1.xml");

    const headerTable = headerSection?.nodes.find((node) => node.type === "table");
    expect(headerTable).toBeDefined();
    if (headerTable?.type === "table") {
      const imageRun = headerTable.rows[0]?.cells[1]?.nodes[0]?.children.find((child) => child.type === "image");
      expect(imageRun).toBeDefined();
      if (imageRun?.type === "image") {
        expect(imageRun.src?.startsWith("data:image/png;base64,")).toBe(true);
      }
    }
  });

  it("tracks section-scoped header references for multi-section documents", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_WITH_TWO_HEADERS_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: MULTI_SECTION_HEADERS_DOC_XML },
      { name: "word/_rels/document.xml.rels", content: DOCUMENT_RELS_WITH_TWO_HEADERS_XML },
      { name: "word/header1.xml", content: SIMPLE_HEADER_ONE_XML },
      { name: "word/header2.xml", content: SIMPLE_HEADER_TWO_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    expect(model.metadata.sections).toBeDefined();
    expect(model.metadata.sections).toHaveLength(2);
    expect(model.metadata.sections?.[0]?.startNodeIndex).toBe(0);
    expect(model.metadata.sections?.[1]?.startNodeIndex).toBe(2);
    expect(model.metadata.sections?.[0]?.headerSections[0]?.partName).toBe("word/header1.xml");
    expect(model.metadata.sections?.[1]?.headerSections[0]?.partName).toBe("word/header2.xml");
  });

  it("imports overlay textbox text from drawing runs with nested runs", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: DRAWING_TEXTBOX_DOC_XML },
      { name: "word/_rels/document.xml.rels", content: DOCUMENT_RELS_XML },
      { name: "word/media/image1.png", content: ONE_BY_ONE_PNG }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    const firstParagraph = model.nodes[0];
    expect(firstParagraph?.type).toBe("paragraph");
    if (firstParagraph?.type === "paragraph") {
      const imageRuns = firstParagraph.children.filter((child) => child.type === "image");
      expect(imageRuns.length).toBeGreaterThanOrEqual(2);

      const overlayImage = imageRuns.find((child) => child.syntheticTextBox);
      expect(overlayImage?.type).toBe("image");
      if (overlayImage?.type === "image") {
        expect(overlayImage.src?.startsWith("data:image/svg+xml")).toBe(true);
        expect(overlayImage.contentType).toBe("image/svg+xml");
      }

      const overlayTextInFlow = firstParagraph.children.find(
        (child) => child.type === "text" && child.text.includes("Overlay Title")
      );
      expect(overlayTextInFlow).toBeUndefined();
    }
  });

  it("prefers svgBlip assets over raster preview fallbacks in drawings", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_WITH_SVG_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: DRAWING_SVG_FALLBACK_DOC_XML },
      {
        name: "word/_rels/document.xml.rels",
        content: DOCUMENT_RELS_WITH_SVG_FALLBACK_XML,
      },
      { name: "word/media/image1.png", content: ONE_BY_ONE_PNG },
      { name: "word/media/image2.svg", content: SIMPLE_SVG },
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    const firstParagraph = model.nodes[0];
    expect(firstParagraph?.type).toBe("paragraph");
    if (firstParagraph?.type === "paragraph") {
      const imageRun = firstParagraph.children.find(
        (child) => child.type === "image"
      );
      expect(imageRun?.type).toBe("image");
      if (imageRun?.type === "image") {
        expect(imageRun.contentType).toBe("image/svg+xml");
        expect(imageRun.src?.startsWith("data:image/svg+xml")).toBe(true);
      }
    }
  });

  it("prefers AlternateContent Choice textbox text and style over fallback duplication", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: DRAWING_TEXTBOX_ALTERNATE_DOC_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    const firstParagraph = model.nodes[0];
    expect(firstParagraph?.type).toBe("paragraph");
    if (firstParagraph?.type === "paragraph") {
      const overlayImage = firstParagraph.children.find(
        (child) => child.type === "image" && child.syntheticTextBox
      );
      expect(overlayImage?.type).toBe("image");
      if (overlayImage?.type === "image") {
        expect(overlayImage.src?.startsWith("data:image/svg+xml")).toBe(true);
        expect(overlayImage.contentType).toBe("image/svg+xml");
      }

      const overlayTextInFlow = firstParagraph.children.find(
        (child) => child.type === "text" && child.text.includes("Overlay Title")
      );
      expect(overlayTextInFlow).toBeUndefined();
    }
  });

  it("imports grouped picture and textbox drawings as one synthetic SVG without leaking textbox text into flow", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: GROUPED_PICTURE_TEXTBOX_DOC_XML },
      { name: "word/_rels/document.xml.rels", content: DOCUMENT_RELS_XML },
      { name: "word/media/image1.png", content: ONE_BY_ONE_PNG }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    const firstParagraph = model.nodes[0];
    expect(firstParagraph?.type).toBe("paragraph");
    if (firstParagraph?.type === "paragraph") {
      const imageRuns = firstParagraph.children.filter((child) => child.type === "image");
      expect(imageRuns).toHaveLength(1);

      const groupedImage = imageRuns[0];
      expect(groupedImage?.type).toBe("image");
      if (groupedImage?.type === "image") {
        expect(groupedImage.src?.startsWith("data:image/svg+xml")).toBe(true);
        expect(groupedImage.contentType).toBe("image/svg+xml");
        expect(groupedImage.syntheticTextBox).toBe(true);
      }

      const inFlowText = firstParagraph.children
        .filter((child): child is Extract<(typeof firstParagraph.children)[number], { type: "text" }> => child.type === "text")
        .map((child) => child.text)
        .join("");
      expect(inFlowText).toBe("After group");
      expect(inFlowText.includes("Commonwealth of Massachusetts")).toBe(false);
    }
  });

  it("keeps grouped textbox SVG text vertically anchored for centered and bottom-anchored cover layouts", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: GROUPED_TEXTBOX_VERTICAL_ANCHOR_DOC_XML },
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    const firstParagraph = model.nodes[0];
    expect(firstParagraph?.type).toBe("paragraph");
    if (firstParagraph?.type === "paragraph") {
      const groupedImage = firstParagraph.children.find(
        (child) => child.type === "image" && child.syntheticTextBox
      );
      expect(groupedImage?.type).toBe("image");
      if (groupedImage?.type === "image") {
        const encodedSvg =
          groupedImage.src?.replace(/^data:image\/svg\+xml;charset=utf-8,/, "") ?? "";
        const decodedSvg = decodeURIComponent(encodedSvg);
        const centeredTitleY = Number(
          decodedSvg.match(
            /<text[^>]*y="(\d+)"[^>]*>BUSINESS PROPOSAL<\/text>/
          )?.[1]
        );
        const bottomAnchoredContactY = Number(
          decodedSvg.match(/<text[^>]*y="(\d+)"[^>]*>Contact name<\/text>/)?.[1]
        );

        expect(centeredTitleY).toBeGreaterThan(300);
        expect(bottomAnchoredContactY).toBeGreaterThan(130);
      }
    }
  });

  it("keeps color-only textbox underline tags from forcing underline and fits long overlay text", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_WITH_STYLES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: TEXTBOX_COLOR_ONLY_UNDERLINE_DOC_XML },
      { name: "word/styles.xml", content: TEXTBOX_COLOR_ONLY_UNDERLINE_STYLES_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    const firstParagraph = model.nodes[0];
    expect(firstParagraph?.type).toBe("paragraph");
    if (firstParagraph?.type === "paragraph") {
      const overlayImage = firstParagraph.children.find(
        (child) => child.type === "image" && child.syntheticTextBox
      );
      expect(overlayImage?.type).toBe("image");
      if (overlayImage?.type === "image") {
        expect(overlayImage.src?.startsWith("data:image/svg+xml")).toBe(true);
        const encodedSvg = overlayImage.src?.replace(/^data:image\/svg\+xml;charset=utf-8,/, "") ?? "";
        const decodedSvg = decodeURIComponent(encodedSvg);

        expect(decodedSvg).toContain("Cleaning Services for Libraries ACT");
        expect(decodedSvg).toContain("font-family=\"Calibri, Arial, sans-serif\"");
        expect(decodedSvg).not.toContain("text-decoration=\"underline\"");
        expect(decodedSvg).toContain("textLength=\"");
      }
    }
  });

  it("imports standalone custom drawing shapes as renderable svg image runs", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: CUSTOM_SHAPE_DOC_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    const firstParagraph = model.nodes[0];
    expect(firstParagraph?.type).toBe("paragraph");
    if (firstParagraph?.type === "paragraph") {
      const imageRuns = firstParagraph.children.filter((child) => child.type === "image");
      expect(imageRuns).toHaveLength(2);

      const flowchartImage = imageRuns.find((child) => child.alt === "Flowchart: Delay 16");
      expect(flowchartImage?.type).toBe("image");
      if (flowchartImage?.type === "image") {
        expect(flowchartImage.contentType).toBe("image/svg+xml");
        expect(flowchartImage.floating?.horizontalAlign).toBe("center");
        expect(flowchartImage.floating?.xPx).toBeUndefined();
        expect(flowchartImage.floating?.yPx).toBeLessThan(0);
        const decodedSvg = decodeURIComponent(
          (flowchartImage.src ?? "").replace(/^data:image\/svg\+xml;charset=utf-8,/, "")
        );
        expect(decodedSvg).toContain("rotate(90.000");
        expect(decodedSvg).toContain('fill="#ffffff"');
      }

      const freeformImage = imageRuns.find((child) => child.alt === "Freeform: Shape 12");
      expect(freeformImage?.type).toBe("image");
      if (freeformImage?.type === "image") {
        expect(freeformImage.contentType).toBe("image/svg+xml");
        expect(freeformImage.floating?.horizontalAlign).toBe("center");
        expect(freeformImage.floating?.xPx).toBeUndefined();
        const decodedSvg = decodeURIComponent(
          (freeformImage.src ?? "").replace(/^data:image\/svg\+xml;charset=utf-8,/, "")
        );
        expect(decodedSvg).toContain("<linearGradient");
        expect(decodedSvg).toContain('fill="url(#shape-fill)"');
        expect(decodedSvg).toContain("<path d=");
      }
    }
  });

  it("parses drawing image crop and effect metadata", async () => {
    const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
  <Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image2.png"/>
</Relationships>`;
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: FILTERED_IMAGE_DOC_XML },
      { name: "word/_rels/document.xml.rels", content: relsXml },
      { name: "word/media/image1.png", content: ONE_BY_ONE_PNG },
      { name: "word/media/image2.png", content: ONE_BY_ONE_PNG }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);
    const firstParagraph = model.nodes[0];
    expect(firstParagraph?.type).toBe("paragraph");
    if (firstParagraph?.type === "paragraph") {
      const image = firstParagraph.children.find((child) => child.type === "image");
      expect(image?.type).toBe("image");
      if (image?.type === "image") {
        expect(image.crop?.topFraction).toBeCloseTo(0.03196, 5);
        expect(image.crop?.bottomFraction).toBeCloseTo(0.12653, 5);
        expect(image.cssOpacity).toBeCloseTo(0.57, 5);
        expect(image.cssFilter).toContain("saturate(0.76)");
        expect(image.cssFilter).toContain("grayscale(1)");
      }
    }
  });

  it("imports chart relationships as renderable svg image runs", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_WITH_CHART_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: CHART_DOC_XML },
      { name: "word/_rels/document.xml.rels", content: DOCUMENT_RELS_WITH_CHART_XML },
      { name: "word/charts/chart1.xml", content: CHART_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    const chartParagraph = model.nodes.find(
      (node) => node.type === "paragraph" && node.children.some((child) => child.type === "image")
    );
    expect(chartParagraph).toBeDefined();

    if (chartParagraph?.type === "paragraph") {
      const chartImage = chartParagraph.children.find((child) => child.type === "image");
      expect(chartImage?.type).toBe("image");
      if (chartImage?.type === "image") {
        expect(chartImage.src?.startsWith("data:image/svg+xml")).toBe(true);
        expect(chartImage.widthPx).toBeGreaterThan(0);
        expect(chartImage.heightPx).toBeGreaterThan(0);
        expect(chartImage.alt).toBe("Sales chart");
      }
    }
  });

  it("imports style definitions and applies style-inherited run formatting", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_WITH_STYLES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: DOC_WITH_STYLE_REFERENCES_XML },
      { name: "word/styles.xml", content: STYLES_DOC_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    expect(model.metadata.defaultParagraphStyleId).toBe("Normal");
    expect(model.metadata.paragraphStyles.some((style) => style.id === "CustomBody")).toBe(true);

    const firstParagraph = model.nodes[0];
    expect(firstParagraph?.type).toBe("paragraph");
    if (firstParagraph?.type === "paragraph") {
      expect(firstParagraph.style?.styleId).toBe("CustomBody");
      expect(firstParagraph.style?.styleName).toBe("Custom Body");

      const firstRun = firstParagraph.children[0];
      expect(firstRun?.type).toBe("text");
      if (firstRun?.type === "text") {
        expect(firstRun.style?.fontFamily).toBe("Georgia");
        expect(firstRun.style?.color?.toLowerCase()).toBe("#336699");
      }
    }

    const secondParagraph = model.nodes[1];
    expect(secondParagraph?.type).toBe("paragraph");
    if (secondParagraph?.type === "paragraph") {
      const styledRun = secondParagraph.children[0];
      expect(styledRun?.type).toBe("text");
      if (styledRun?.type === "text") {
        expect(styledRun.style?.underline).toBe(true);
        expect(styledRun.style?.color?.toLowerCase()).toBe("#aa00aa");
      }
    }

    const thirdParagraph = model.nodes[2];
    expect(thirdParagraph?.type).toBe("paragraph");
    if (thirdParagraph?.type === "paragraph") {
      const eastAsiaOnlyRun = thirdParagraph.children[0];
      expect(eastAsiaOnlyRun?.type).toBe("text");
      if (eastAsiaOnlyRun?.type === "text") {
        expect(eastAsiaOnlyRun.style?.fontFamily).toBe("Georgia");
      }
    }
  });

  it("keeps inherited latin paragraph fonts when a style only defines eastAsiaTheme", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_WITH_STYLES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: DOC_WITH_EAST_ASIA_THEME_STYLE_XML },
      { name: "word/styles.xml", content: STYLES_WITH_EAST_ASIA_THEME_HEADING_XML },
      { name: "word/theme/theme1.xml", content: THEME_WITH_CAMBRIA_MAJOR_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    const paragraph = model.nodes[0];
    expect(paragraph?.type).toBe("paragraph");
    if (paragraph?.type !== "paragraph") {
      return;
    }

    const run = paragraph.children[0];
    expect(run?.type).toBe("text");
    if (run?.type !== "text") {
      return;
    }

    expect(paragraph.style?.styleId).toBe("Heading1");
    expect(run.style?.fontFamily).toBe("Times New Roman");
  });

  it("does not fall back to Heading1 when no default paragraph style exists", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_WITH_STYLES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: DOC_WITH_NO_DEFAULT_PARAGRAPH_STYLE_XML },
      { name: "word/styles.xml", content: STYLES_WITH_ONLY_HEADING_DEFINITIONS_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    expect(model.metadata.defaultParagraphStyleId).toBeUndefined();

    const paragraph = model.nodes[0];
    expect(paragraph?.type).toBe("paragraph");
    if (paragraph?.type !== "paragraph") {
      return;
    }

    expect(paragraph.style?.styleId).toBeUndefined();
    expect(paragraph.style?.headingLevel).toBeUndefined();

    const run = paragraph.children[0];
    expect(run?.type).toBe("text");
    if (run?.type !== "text") {
      return;
    }

    expect(run.style?.bold).toBeUndefined();
    expect(run.style?.fontSizePt).toBe(11);
    expect(run.style?.fontFamily).toBe("Times New Roman");
  });

  it("imports paragraph pagination properties from style inheritance and direct paragraph properties", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_WITH_STYLES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: DOC_WITH_PAGINATION_STYLE_XML },
      { name: "word/styles.xml", content: PAGINATION_STYLES_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    const keepWithNextStyle = model.metadata.paragraphStyles.find((style) => style.id === "KeepWithNext");
    expect(keepWithNextStyle).toBeDefined();
    expect(keepWithNextStyle?.keepNext).toBe(true);
    expect(keepWithNextStyle?.keepLines).toBe(true);
    expect(keepWithNextStyle?.pageBreakBefore).toBe(false);

    const firstParagraph = model.nodes[0];
    expect(firstParagraph?.type).toBe("paragraph");
    if (firstParagraph?.type === "paragraph") {
      expect(firstParagraph.style?.keepNext).toBe(true);
      expect(firstParagraph.style?.keepLines).toBe(true);
      expect(firstParagraph.style?.pageBreakBefore).toBe(false);
    }

    const secondParagraph = model.nodes[1];
    expect(secondParagraph?.type).toBe("paragraph");
    if (secondParagraph?.type === "paragraph") {
      expect(secondParagraph.style?.pageBreakBefore).toBe(true);
      expect(secondParagraph.style?.keepLines).toBe(false);
    }
  });

  it("imports paragraph border properties from style inheritance and direct paragraph properties", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_WITH_STYLES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: DOC_WITH_PARAGRAPH_BORDERS_XML },
      { name: "word/styles.xml", content: PARAGRAPH_BORDERS_STYLES_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    const titleStyle = model.metadata.paragraphStyles.find((style) => style.id === "Title");
    expect(titleStyle).toBeDefined();
    expect(titleStyle?.borders?.top?.type).toBe("double");
    expect(titleStyle?.borders?.top?.spacePt).toBe(2);
    expect(titleStyle?.borders?.bottom?.type).toBe("single");
    expect(titleStyle?.borders?.bottom?.spacePt).toBe(4);

    const firstParagraph = model.nodes[0];
    expect(firstParagraph?.type).toBe("paragraph");
    if (firstParagraph?.type === "paragraph") {
      expect(firstParagraph.style?.borders?.top?.type).toBe("double");
      expect(firstParagraph.style?.borders?.bottom?.type).toBe("single");
    }

    const secondParagraph = model.nodes[1];
    expect(secondParagraph?.type).toBe("paragraph");
    if (secondParagraph?.type === "paragraph") {
      expect(secondParagraph.style?.borders?.bottom?.type).toBe("nil");
      expect(secondParagraph.style?.borders?.top?.type).toBe("double");
    }
  });

  it("imports paragraph shading as paragraph background color", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: DOC_WITH_PARAGRAPH_SHADING_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    const firstParagraph = model.nodes[0];
    expect(firstParagraph?.type).toBe("paragraph");
    if (firstParagraph?.type === "paragraph") {
      expect(firstParagraph.style?.backgroundColor?.toLowerCase()).toBe("#dddddd");
      expect(firstParagraph.style?.align).toBe("right");
    }
  });

  it("maps paragraph alignment both to justify", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: DOC_WITH_JC_BOTH_XML }
    ]);
    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);
    const firstParagraph = model.nodes[0];

    expect(firstParagraph?.type).toBe("paragraph");
    if (firstParagraph?.type === "paragraph") {
      expect(firstParagraph.style?.align).toBe("justify");
    }
  });

  it("imports table layout metadata and skips bookmark-only _GoBack paragraphs", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: TABLE_LAYOUT_DOC_XML },
      { name: "word/_rels/document.xml.rels", content: DOCUMENT_RELS_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    expect(model.nodes).toHaveLength(1);
    const table = model.nodes[0];
    expect(table?.type).toBe("table");
    if (table?.type === "table") {
      expect(table.style?.widthTwips).toBe(7200);
      expect(table.style?.indentTwips).toBe(180);
      expect(table.style?.layout).toBe("fixed");
      expect(table.style?.columnWidthsTwips).toEqual([5000, 2200]);
      expect(table.style?.cellMarginTwips).toEqual({
        topTwips: 120,
        rightTwips: 90,
        bottomTwips: 120,
        leftTwips: 90
      });

      const firstRow = table.rows[0];
      expect(firstRow?.style?.heightTwips).toBe(840);

      const firstCell = firstRow?.cells[0];
      expect(firstCell?.style?.widthTwips).toBe(5000);
      expect(firstCell?.style?.verticalAlign).toBe("center");
      expect(firstCell?.style?.marginTwips).toEqual({
        topTwips: 180,
        rightTwips: 180,
        bottomTwips: 180,
        leftTwips: 180
      });
    }
  });

  it("imports table and cell border metadata", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: TABLE_BORDERS_DOC_XML },
      { name: "word/_rels/document.xml.rels", content: DOCUMENT_RELS_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    expect(model.nodes).toHaveLength(2);
    expect(model.nodes[0]?.type).toBe("table");
    expect(model.nodes[1]?.type).toBe("table");

    const layoutTable = model.nodes[0];
    if (layoutTable?.type === "table") {
      expect(layoutTable.style?.borders?.top?.type).toBe("none");
      expect(layoutTable.style?.borders?.insideH?.type).toBe("none");
    }

    const borderedTable = model.nodes[1];
    if (borderedTable?.type === "table") {
      const firstCell = borderedTable.rows[0]?.cells[0];
      expect(firstCell?.style?.borders?.top).toEqual({
        type: "single",
        sizeEighthPt: 8,
        color: "#BFBFBF"
      });
      expect(firstCell?.style?.borders?.left).toEqual({
        type: "single",
        sizeEighthPt: 8,
        color: "#FF0000"
      });
    }
  });

  it("applies first-row table style condition without leaking to whole-table formatting", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_WITH_STYLES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: DOC_WITH_TABLE_STYLE_CONDITIONALS_XML },
      { name: "word/styles.xml", content: STYLES_WITH_TABLE_CONDITIONALS_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);
    const table = model.nodes[0];
    expect(table?.type).toBe("table");
    if (table?.type !== "table") {
      return;
    }

    expect(table.style?.borders).toBeUndefined();
    expect(table.rows[0]?.cells[0]?.style?.backgroundColor?.toLowerCase()).toBe("#9bbb59");
    expect(table.rows[0]?.cells[0]?.style?.borders?.top?.type).toBe("single");
    expect(table.rows[0]?.cells[0]?.nodes[0]?.children[0]?.type).toBe("text");
    if (table.rows[0]?.cells[0]?.nodes[0]?.children[0]?.type === "text") {
      expect(table.rows[0].cells[0].nodes[0].children[0].style?.bold).toBe(true);
      expect(table.rows[0].cells[0].nodes[0].children[0].style?.color?.toLowerCase()).toBe("#ffffff");
    }
    expect(table.rows[1]?.cells[0]?.style?.backgroundColor).toBeUndefined();
    expect(table.rows[1]?.cells[0]?.style?.borders).toBeUndefined();
  });

  it("applies table-style paragraph alignment and first-row run overrides", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_WITH_STYLES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: DOC_WITH_CALENDAR_LIKE_TABLE_STYLE_XML },
      { name: "word/styles.xml", content: STYLES_WITH_CALENDAR_LIKE_TABLE_STYLE_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);
    const table = model.nodes[0];
    expect(table?.type).toBe("table");
    if (table?.type !== "table") {
      return;
    }

    const firstRowParagraph = table.rows[0]?.cells[0]?.nodes[0];
    const secondRowParagraph = table.rows[1]?.cells[0]?.nodes[0];
    expect(firstRowParagraph?.type).toBe("paragraph");
    expect(secondRowParagraph?.type).toBe("paragraph");
    if (firstRowParagraph?.type !== "paragraph" || secondRowParagraph?.type !== "paragraph") {
      return;
    }

    expect(firstRowParagraph.style?.align).toBe("right");
    expect(secondRowParagraph.style?.align).toBe("right");

    const firstRun = firstRowParagraph.children[0];
    const secondRun = secondRowParagraph.children[0];
    expect(firstRun?.type).toBe("text");
    expect(secondRun?.type).toBe("text");
    if (firstRun?.type !== "text" || secondRun?.type !== "text") {
      return;
    }

    expect(firstRun.style?.color?.toLowerCase()).toBe("#365f91");
    expect(firstRun.style?.fontSizePt).toBe(22);
    expect(secondRun.style?.color?.toLowerCase()).toBe("#7f7f7f");
  });

  it("preserves nested table structure and vertical merge metadata in cells", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: DOC_WITH_NESTED_VMERGE_TABLE_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);
    const outerTable = model.nodes[0];
    expect(outerTable?.type).toBe("table");
    if (outerTable?.type !== "table") {
      return;
    }

    const leftCell = outerTable.rows[0]?.cells[0];
    const nestedTable = leftCell?.nodes.find((node) => node.type === "table");
    expect(nestedTable?.type).toBe("table");
    if (!nestedTable || nestedTable.type !== "table") {
      return;
    }
    expect(leftCell?.nodes).toHaveLength(1);

    expect(nestedTable.rows).toHaveLength(2);
    expect(nestedTable.rows[0]?.cells[0]?.style?.rowSpan).toBe(2);
    expect(nestedTable.rows[1]?.cells[0]?.style?.vMergeContinuation).toBe(true);
  });

  it("imports floating table positioning metadata from tblpPr", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: DOC_WITH_FLOATING_TABLE_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);
    const table = model.nodes[0];
    expect(table?.type).toBe("table");
    if (table?.type !== "table") {
      return;
    }

    expect(table.style?.floating).toEqual({
      xTwips: 720,
      yTwips: 360,
      leftFromTextTwips: 120,
      rightFromTextTwips: 240,
      topFromTextTwips: 60,
      bottomFromTextTwips: 180,
      horizontalAnchor: "margin",
      verticalAnchor: "text",
      horizontalAlign: "left",
      verticalAlign: "top"
    });
  });

  it("applies table style look and properties from style definition when table instance omits them", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: DOC_WITH_TABLE_STYLE_LOOK_FROM_STYLE_ONLY_XML },
      { name: "word/styles.xml", content: STYLES_WITH_STYLE_LOOK_AND_PROPERTIES_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);
    const table = model.nodes[0];
    expect(table?.type).toBe("table");
    if (table?.type !== "table") {
      return;
    }

    expect(table.style?.widthTwips).toBe(5200);
    expect(table.style?.layout).toBe("autofit");
    expect(table.style?.cellMarginTwips).toEqual({
      topTwips: 80,
      rightTwips: 90,
      bottomTwips: 80,
      leftTwips: 90
    });
    expect(table.rows[0]?.cells[0]?.nodes[0]?.children[0]?.type).toBe("text");
    const firstCellRun = table.rows[0]?.cells[0]?.nodes[0]?.children[0];
    if (firstCellRun?.type === "text") {
      expect(firstCellRun.style?.bold).toBe(true);
      expect(firstCellRun.style?.color?.toLowerCase()).toBe("#ffffff");
    }
  });

  it("imports compatibility pagination flags from settings.xml", async () => {
    const settingsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:compat>
    <w:suppressSpBfAfterPgBrk/>
    <w:usePrinterMetrics w:val="1"/>
    <w:doNotUseHTMLParagraphAutoSpacing/>
    <w:doNotBreakWrappedTables/>
    <w:doNotBreakConstrainedForcedTable/>
  </w:compat>
</w:settings>`;
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: RED_TEXT_DOC_XML },
      { name: "word/settings.xml", content: settingsXml }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);

    expect(model.metadata.compatibility).toEqual({
      suppressSpacingBeforeAfterPageBreak: true,
      usePrinterMetrics: true,
      useFixedHtmlParagraphSpacing: true,
      doNotBreakWrappedTables: true,
      doNotBreakConstrainedForcedTable: true
    });
  });

  it("imports paragraph drop-cap frame metadata", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: DROP_CAP_DOC_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);
    const paragraph = model.nodes[0];
    expect(paragraph?.type).toBe("paragraph");
    if (paragraph?.type !== "paragraph") {
      return;
    }

    expect(paragraph.style?.dropCap).toEqual({
      type: "drop",
      lines: 3,
      wrap: "around",
      horizontalAnchor: "text",
      verticalAnchor: "text",
      xTwips: 240,
      yTwips: 120,
      horizontalSpaceTwips: 80,
      verticalSpaceTwips: 40
    });
  });

  it("imports run character spacing", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      {
        name: "word/document.xml",
        content:
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
          `<w:body>` +
          `<w:p>` +
          `<w:r>` +
          `<w:rPr><w:spacing w:val="20"/></w:rPr>` +
          `<w:t>Spaced</w:t>` +
          `</w:r>` +
          `</w:p>` +
          `</w:body>` +
          `</w:document>`
      }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);
    const paragraph = model.nodes[0];
    expect(paragraph?.type).toBe("paragraph");
    if (paragraph?.type !== "paragraph") {
      return;
    }

    const run = paragraph.children[0];
    expect(run?.type).toBe("text");
    if (run?.type !== "text") {
      return;
    }

    expect(run.style?.characterSpacingTwips).toBe(20);
  });

  it("imports run border styling", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: RUN_BORDER_DOC_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);
    const paragraph = model.nodes[0];
    expect(paragraph?.type).toBe("paragraph");
    if (paragraph?.type !== "paragraph") {
      return;
    }

    const run = paragraph.children[1];
    expect(run?.type).toBe("text");
    if (run?.type !== "text") {
      return;
    }

    expect(run.text).toBe("box");
    expect(run.style?.runBorder).toEqual({
      type: "single",
      sizeEighthPt: 4,
      spacePt: 0
    });
  });

  it("imports run shading as background color", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: RUN_SHADING_DOC_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);
    const paragraph = model.nodes[0];
    expect(paragraph?.type).toBe("paragraph");
    if (paragraph?.type !== "paragraph") {
      return;
    }

    const run = paragraph.children[0];
    expect(run?.type).toBe("text");
    if (run?.type !== "text") {
      return;
    }

    expect(run.text).toBe("inverse video");
    expect(run.style?.color?.toLowerCase()).toBe("#ffffff");
    expect(run.style?.backgroundColor?.toLowerCase()).toBe("#000000");
  });
});
