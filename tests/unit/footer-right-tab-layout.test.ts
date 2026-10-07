import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cloneDocModel, type DocModel, type ParagraphNode } from "../../packages/doc-model/src";
import {
  defaultStarterModel,
  DocxEditorViewer,
  useDocxEditor
} from "../../packages/react-viewer/src/editor";
import { describe, expect, it } from "vitest";

function footerParagraph(textParts: string[]): ParagraphNode {
  return {
    type: "paragraph",
    style: {
      align: "justify",
      tabStops: [
        {
          alignment: "right",
          leader: "none",
          positionTwips: 10080
        }
      ]
    },
    children: textParts.map((text) => ({
      type: "text" as const,
      text
    }))
  };
}

function FooterViewer({ model, mode = "read-only" }: {
  model: DocModel;
  mode?: "read-only" | "edit";
}): React.JSX.Element {
  const editor = useDocxEditor({ starterModel: model });
  return React.createElement(DocxEditorViewer, {
    editor,
    mode
  });
}

describe("footer right-tab layout", () => {
  it("renders complete form values as text in read-only mode and controls in edit mode", () => {
    const model = cloneDocModel(defaultStarterModel);
    model.nodes = [{ type: "paragraph", children: [
      { type: "form-field", fieldType: "text", value: "A long form value that must remain fully visible" },
      { type: "form-field", fieldType: "dropdown", value: "chosen", options: [{ value: "chosen", displayText: "Selected option" }] },
      { type: "form-field", fieldType: "date", value: "2026-01-15" },
      { type: "form-field", fieldType: "checkbox", checked: true },
      { type: "form-field", fieldType: "text", value: "", placeholder: "Unfilled field prompt" },
    ] }];
    const readOnly = renderToStaticMarkup(React.createElement(FooterViewer, { model }));
    expect(readOnly).not.toMatch(/<(?:input|select)\b/);
    expect(readOnly).toContain("A long form value that must remain fully visible");
    expect(readOnly).toContain("Selected option");
    expect(readOnly).toContain("Unfilled field prompt");
    expect(readOnly).toContain('aria-checked="true"');
    const editable = renderToStaticMarkup(React.createElement(FooterViewer, { model, mode: "edit" }));
    expect(editable).toContain("<input");
    expect(editable).toContain("<select");
  });

  it("uses numbering indents over inherited style indents while preserving direct overrides", () => {
    const model = cloneDocModel(defaultStarterModel);
    model.metadata.numberingDefinitions = {
      abstracts: [{ abstractNumId: 0, levels: [{
        ilvl: 0, format: "decimal", text: "%1.",
        indent: { leftTwips: 360, hangingTwips: 360 },
      }] }],
      instances: [{ numId: 1, abstractNumId: 0 }],
    };
    const paragraph: ParagraphNode = {
      type: "paragraph",
      style: { numbering: { numId: 1, ilvl: 0 }, indent: { leftTwips: 720 } },
      sourceXml: '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Text</w:t></w:r></w:p>',
      children: [{ type: "text", text: "Text" }],
    };
    model.nodes = [{ type: "table", rows: [{ type: "table-row", cells: [{ type: "table-cell", nodes: [paragraph] }] }] }];
    const inherited = renderToStaticMarkup(React.createElement(FooterViewer, { model }));
    expect(inherited).toContain("padding-left:24px");
    paragraph.sourceXml = paragraph.sourceXml!.replace("</w:pPr>", '<w:ind w:left="720"/></w:pPr>');
    const direct = renderToStaticMarkup(React.createElement(FooterViewer, { model }));
    expect(direct).toContain("padding-left:48px");
  });

  it("advances a list tab from the resolved indent and the full marker box", () => {
    const model = cloneDocModel(defaultStarterModel);
    model.metadata.numberingDefinitions = {
      abstracts: [{ abstractNumId: 0, levels: [{
        ilvl: 0, format: "decimal", text: "%1.", suffix: "tab",
        indent: { leftTwips: 720, hangingTwips: 360 },
      }] }],
      instances: [{ numId: 1, abstractNumId: 0 }],
    };
    model.nodes = [{
      type: "paragraph",
      style: {
        numbering: { numId: 1, ilvl: 0 },
        tabStops: [{ alignment: "left", positionTwips: 1080 }],
      },
      children: [{ type: "text", text: "\tAligned text" }],
    }];
    const html = renderToStaticMarkup(React.createElement(FooterViewer, { model }));
    const markerWidth = Number(html.match(/data-docx-numbering-label="true"[^>]*width:([\d.]+)px/)?.[1]);
    const tabWidth = Number(html.match(/data-docx-tab-char="true"[^>]*width:([\d.]+)px/)?.[1]);
    expect(markerWidth).toBeGreaterThanOrEqual(24);
    expect(tabWidth).toBeGreaterThan(0);
    expect(markerWidth + tabWidth).toBe(48);
  });

  it("renders footer right-tab paragraphs as two aligned zones", () => {
    const model = cloneDocModel(defaultStarterModel);
    model.nodes = [
      {
        type: "paragraph",
        children: [{ type: "text", text: "Body" }]
      }
    ];
    model.metadata.footerSections = [
      {
        partName: "word/footer1.xml",
        referenceType: "default",
        nodes: [
          footerParagraph([
            "MULTISTATE ADJUSTABLE RATE RIDER",
            "—30-day Average SOFR",
            "\t",
            "Form 3141",
            "  ",
            "07/2021"
          ]),
          footerParagraph([
            "--Single Family--",
            "Fannie Mae / Freddie Mac Uniform Instrument",
            "   ",
            "\t",
            "Page ",
            "1",
            " of ",
            "4"
          ])
        ]
      }
    ];

    const html = renderToStaticMarkup(React.createElement(FooterViewer, { model }));

    expect(html.match(/data-docx-tab-layout="right"/g)).toHaveLength(2);
    expect(html).toContain('data-docx-tab-zone="left"');
    expect(html).toContain('data-docx-tab-zone="right"');
    expect(html).toContain("grid-template-columns:672px 0px minmax(0, 1fr)");
    expect(html).toContain("MULTISTATE ADJUSTABLE RATE RIDER");
    expect(html).toContain("Form 3141");
    expect(html).toContain("Page ");
    expect(html).toContain("4");
  });

  it("anchors center and right tab zones to the explicit tab stop positions", () => {
    const model = cloneDocModel(defaultStarterModel);
    model.nodes = [
      {
        type: "paragraph",
        style: {
          tabStops: [
            {
              alignment: "center",
              leader: "none",
              positionTwips: 5040
            },
            {
              alignment: "right",
              leader: "none",
              positionTwips: 9360
            }
          ]
        },
        children: [
          {
            type: "text",
            text: "\tADJUSTABLE RATE RIDER\t-Borrower"
          }
        ]
      }
    ];

    const html = renderToStaticMarkup(React.createElement(FooterViewer, { model }));

    expect(html).toContain('data-docx-tab-layout="center-right"');
    expect(html).toContain("grid-template-columns:336px 0px 288px 0px minmax(0, 1fr)");
    expect(html).toContain('data-docx-tab-zone="1"');
    expect(html).toContain('data-docx-tab-zone="2"');
    expect(html).toContain("ADJUSTABLE RATE RIDER");
    expect(html).toContain("-Borrower");
  });

  it("anchors center-only tab zones to the explicit center tab stop position", () => {
    const model = cloneDocModel(defaultStarterModel);
    model.nodes = [
      {
        type: "paragraph",
        style: {
          tabStops: [
            {
              alignment: "center",
              leader: "none",
              positionTwips: 5040
            }
          ]
        },
        children: [
          {
            type: "text",
            text: "\tADJUSTABLE RATE RIDER"
          }
        ]
      }
    ];

    const html = renderToStaticMarkup(React.createElement(FooterViewer, { model }));

    expect(html).toContain('data-docx-tab-layout="center"');
    expect(html).toContain("grid-template-columns:336px 0px minmax(0, 1fr)");
    expect(html).toContain('data-docx-tab-zone="center"');
    expect(html).toContain("ADJUSTABLE RATE RIDER");
  });

  it("does not apply right-tab anchored layout to multi-tab body rows", () => {
    const model = cloneDocModel(defaultStarterModel);
    model.nodes = [
      {
        type: "paragraph",
        style: {
          tabStops: [
            {
              alignment: "right",
              leader: "none",
              positionTwips: 8640
            }
          ]
        },
        children: [
          {
            type: "text",
            text: "\t(ba)\t a paper record that shows the total votes received by each candidate."
          }
        ]
      }
    ];

    const html = renderToStaticMarkup(React.createElement(FooterViewer, { model }));

    expect(html).not.toContain('data-docx-tab-layout="right"');
    expect(html).toContain("a paper record that shows the total votes");
  });

  it("does not apply anchored tab layouts to list rows that also define left tab stops", () => {
    const model = cloneDocModel(defaultStarterModel);
    model.nodes = [
      {
        type: "paragraph",
        style: {
          tabStops: [
            {
              alignment: "right",
              leader: "none",
              positionTwips: 1531
            },
            {
              alignment: "left",
              leader: "none",
              positionTwips: 2160
            },
            {
              alignment: "left",
              leader: "none",
              positionTwips: 2880
            },
            {
              alignment: "left",
              leader: "none",
              positionTwips: 3600
            },
            {
              alignment: "center",
              leader: "none",
              positionTwips: 4513
            }
          ]
        },
        children: [
          {
            type: "text",
            text:
              "\t(b)\ta reference to any other kind of instrument or writing is a reference to that other instrument or writing as in force, or existing, from time to time."
          }
        ]
      }
    ];

    const html = renderToStaticMarkup(React.createElement(FooterViewer, { model }));

    expect(html).not.toContain('data-docx-tab-layout="center-right"');
    expect(html).not.toContain('data-docx-tab-layout="center"');
    expect(html).not.toContain('data-docx-tab-layout="right"');
    expect(html).toContain("a reference to any other kind of instrument or writing");
    expect(html).toContain("from time to time.");
  });

  it("keeps leading-tab footer page text horizontal in anchored center-right layouts", () => {
    const model = cloneDocModel(defaultStarterModel);
    model.nodes = [
      {
        type: "paragraph",
        children: [{ type: "text", text: "Body" }]
      }
    ];
    model.metadata.footerSections = [
      {
        partName: "word/footer1.xml",
        referenceType: "default",
        nodes: [
          {
            type: "paragraph",
            style: {
              tabStops: [
                {
                  alignment: "center",
                  leader: "none",
                  positionTwips: 4320
                },
                {
                  alignment: "right",
                  leader: "none",
                  positionTwips: 8640
                }
              ]
            },
            children: [
              { type: "text", text: "\t", style: { fontFamily: "Courier New", fontSizePt: 12 } },
              { type: "text", text: "Page - ", style: { fontFamily: "Courier New", fontSizePt: 12 } },
              { type: "text", text: "1", style: { fontFamily: "Courier New", fontSizePt: 12 } },
              { type: "text", text: " -", style: { fontFamily: "Courier New", fontSizePt: 12 } }
            ]
          }
        ]
      }
    ];

    const html = renderToStaticMarkup(React.createElement(FooterViewer, { model }));

    expect(html).toContain('data-docx-tab-layout="center-right"');
    expect(html).toContain("Page - ");
    expect(html).toContain("word-break:normal");
    expect(html).toContain("overflow-wrap:normal");
    expect(html).toContain("flex-wrap:nowrap");
  });
});
