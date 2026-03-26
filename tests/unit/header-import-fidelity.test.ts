import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildDocModel } from "@react-docx/doc-model";
import { parseDocx } from "@react-docx/ooxml-core";
import { describe, expect, it } from "vitest";

import {
  cloneDocModel,
  type DocModel
} from "../../packages/doc-model/src";
import {
  defaultStarterModel,
  DocxEditorViewer,
  useDocxEditor
} from "../../packages/react-viewer/src/editor";
import { createZip } from "./helpers/zip";

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
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

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="7200" w:type="dxa"/>
        <w:tblInd w:w="-1134" w:type="dxa"/>
      </w:tblPr>
      <w:tr>
        <w:tc>
          <w:p><w:r><w:t>Header table</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

function HeaderViewer({ model }: { model: DocModel }): React.JSX.Element {
  const editor = useDocxEditor({ starterModel: model });
  return React.createElement(DocxEditorViewer, {
    editor,
    mode: "read-only"
  });
}

describe("header import fidelity", () => {
  it("preserves signed table indents from Word", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: DOCUMENT_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const table = model.nodes[0];

    expect(table?.type).toBe("table");
    if (table?.type === "table") {
      expect(table.style?.indentTwips).toBe(-1134);
    }
  });

  it("keeps explicit width on wrapped floating header images", () => {
    const model = cloneDocModel(defaultStarterModel);
    model.nodes = [
      {
        type: "paragraph",
        children: [{ type: "text", text: "Body" }]
      }
    ];
    model.metadata.headerSections = [
      {
        partName: "word/header1.xml",
        referenceType: "default",
        nodes: [
          {
            type: "paragraph",
            style: {
              indent: {
                leftTwips: 6980,
                hangingTwips: 6980
              },
              align: "justify"
            },
            children: [
              {
                type: "image",
                src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2M4x8AAAAASUVORK5CYII=",
                widthPx: 95,
                heightPx: 78,
                floating: {
                  xPx: 25,
                  yPx: 0,
                  horizontalRelativeTo: "column",
                  verticalRelativeTo: "paragraph",
                  wrapType: "through",
                  wrapText: "bothSides",
                  distLPx: 12,
                  distRPx: 12,
                  behindDocument: false
                }
              }
            ]
          }
        ]
      }
    ];

    const html = renderToStaticMarkup(React.createElement(HeaderViewer, { model }));

    expect(html).toContain('data-docx-header-footer-region="header"');
    expect(html).toContain("float:left");
    expect(html).toContain("width:95px");
    expect(html).toContain("height:78px");
    expect(html).not.toContain("text-indent:-465px");
    expect(html).not.toContain("margin:0 0 0 465px");
  });

  it("corrects page-relative header float anchors inside negatively indented tables", () => {
    const model = cloneDocModel(defaultStarterModel);
    model.nodes = [
      {
        type: "paragraph",
        children: [{ type: "text", text: "Body" }]
      }
    ];
    model.metadata.headerSections = [
      {
        partName: "word/header1.xml",
        referenceType: "default",
        nodes: [
          {
            type: "table",
            style: {
              indentTwips: -1134,
              columnWidthsTwips: [2723]
            },
            rows: [
              {
                cells: [
                  {
                    style: {
                      widthTwips: 2723
                    },
                    nodes: [
                      {
                        type: "paragraph",
                        children: [
                          {
                            type: "image",
                            src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2M4x8AAAAASUVORK5CYII=",
                            widthPx: 95,
                            heightPx: 78,
                            floating: {
                              xPx: 25,
                              yPx: 0,
                              horizontalRelativeTo: "column",
                              verticalRelativeTo: "paragraph",
                              wrapType: "through",
                              wrapText: "bothSides",
                              distLPx: 12,
                              distRPx: 12,
                              behindDocument: false
                            }
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ];

    const html = renderToStaticMarkup(React.createElement(HeaderViewer, { model }));

    expect(html).toContain("margin-left:113px");
  });

  it("does not inject a synthetic 8px gap below the header container", () => {
    const model = cloneDocModel(defaultStarterModel);
    model.nodes = [
      {
        type: "paragraph",
        children: [{ type: "text", text: "Body" }]
      }
    ];
    model.metadata.headerSections = [
      {
        partName: "word/header1.xml",
        referenceType: "default",
        nodes: [
          {
            type: "paragraph",
            children: [{ type: "text", text: "Header" }]
          }
        ]
      }
    ];

    const html = renderToStaticMarkup(React.createElement(HeaderViewer, { model }));

    expect(html).toContain('data-docx-header-footer-region="header"');
    expect(html).not.toMatch(/data-docx-header-footer-region="header"[^>]*margin-bottom:8px/);
  });

  it("collapses an empty paragraph after a deleted paragraph mark like Word final view", () => {
    const model = cloneDocModel(defaultStarterModel);
    model.nodes = [
      {
        type: "paragraph",
        paragraphMarkDeleted: true,
        style: {
          spacing: {
            afterTwips: 120
          }
        },
        children: [{ type: "text", text: "Personal information" }]
      },
      {
        type: "paragraph",
        style: {
          spacing: {
            afterTwips: 120
          }
        },
        children: [{ type: "text", text: "" }]
      },
      {
        type: "paragraph",
        children: [{ type: "text", text: "Date: 9th February 2023" }]
      }
    ];

    const html = renderToStaticMarkup(React.createElement(HeaderViewer, { model }));
    const paragraphHostCount = (html.match(/data-docx-paragraph-host="true"/g) ?? []).length;

    expect(html).toContain("Personal information");
    expect(html).toContain("Date: 9th February 2023");
    expect(paragraphHostCount).toBe(2);
  });
});
