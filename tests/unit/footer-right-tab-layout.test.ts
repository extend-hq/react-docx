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

function FooterViewer({ model }: { model: DocModel }): React.JSX.Element {
  const editor = useDocxEditor({ starterModel: model });
  return React.createElement(DocxEditorViewer, {
    editor,
    mode: "read-only"
  });
}

describe("footer right-tab layout", () => {
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
