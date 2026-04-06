import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cloneDocModel, type DocModel } from "../../packages/doc-model/src";
import {
  defaultStarterModel,
  DocxEditorViewer,
  useDocxEditor
} from "../../packages/react-viewer/src/editor";
import { describe, expect, it } from "vitest";

function FooterViewer({
  model,
  mode = "read-only"
}: {
  model: DocModel;
  mode?: "edit" | "read-only";
}): React.JSX.Element {
  const editor = useDocxEditor({ starterModel: model });
  return React.createElement(DocxEditorViewer, {
    editor,
    mode
  });
}

describe("footer floating positioning", () => {
  it("anchors non-page-relative footer content to the page bottom instead of using a full-page overlay", () => {
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
            children: [{ type: "text", text: "Footer text" }]
          }
        ]
      }
    ];

    const html = renderToStaticMarkup(React.createElement(FooterViewer, { model }));

    expect(html).toContain('data-docx-header-footer-region="footer"');
    expect(html).toContain(
      'style="display:grid;gap:8px;position:absolute;left:0;right:0;bottom:56px;width:100%;max-width:100%;box-sizing:border-box;padding-left:56px;padding-right:56px;padding-bottom:0;pointer-events:auto;opacity:1;transition:opacity 120ms ease;outline:none;box-shadow:none;z-index:1" contentEditable="false" data-docx-header-footer-region="footer"'
    );
    expect(html).not.toContain('data-docx-header-footer-region="footer" style="display:grid;gap:8px;position:absolute;left:0;right:0;top:0;bottom:0');
  });

  it("keeps ordinary inactive footers hit-testable in edit mode so double click can activate footer editing", () => {
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
            children: [{ type: "text", text: "Footer text" }]
          }
        ]
      }
    ];

    const html = renderToStaticMarkup(
      React.createElement(FooterViewer, { model, mode: "edit" })
    );

    expect(html).toContain('data-docx-header-footer-region="footer"');
    expect(html).toContain("padding-bottom:0;pointer-events:auto;opacity:0.5");
  });

  it("uses the page surface as the positioning space for page-relative footer images", () => {
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
            children: [
              {
                type: "image",
                src: "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%3E%3Crect%20width%3D%2212%22%20height%3D%2212%22%20fill%3D%22%23007acc%22%2F%3E%3C%2Fsvg%3E",
                widthPx: 12,
                heightPx: 12,
                floating: {
                  xPx: 120,
                  yPx: 900,
                  horizontalRelativeTo: "page",
                  verticalRelativeTo: "page",
                  wrapType: "none",
                  behindDocument: true
                }
              }
            ]
          }
        ]
      }
    ];

    const html = renderToStaticMarkup(React.createElement(FooterViewer, { model }));

    expect(html).toContain('data-docx-header-footer-region="footer"');
    expect(html).toContain("position:absolute;left:0;right:0;top:0;bottom:0");
    expect(html).toContain("align-content:end");
    expect(html).toContain("padding-bottom:56px;pointer-events:auto");
    expect(html).toContain("left:120px;top:900px");
  });

  it("does not let inactive full-page footer overlays intercept body clicks in edit mode", () => {
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
            children: [
              {
                type: "image",
                src: "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%3E%3Crect%20width%3D%2212%22%20height%3D%2212%22%20fill%3D%22%23007acc%22%2F%3E%3C%2Fsvg%3E",
                widthPx: 12,
                heightPx: 12,
                floating: {
                  xPx: 120,
                  yPx: 900,
                  horizontalRelativeTo: "page",
                  verticalRelativeTo: "page",
                  wrapType: "none",
                  behindDocument: true
                }
              }
            ]
          }
        ]
      }
    ];

    const html = renderToStaticMarkup(React.createElement(FooterViewer, { model, mode: "edit" }));

    expect(html).toContain('data-docx-header-footer-region="footer"');
    expect(html).toContain("padding-bottom:56px;pointer-events:none;opacity:0.5");
    expect(html).toContain('data-docx-footer-activation-zone="true"');
    expect(html).toContain("height:136px;z-index:2;pointer-events:auto;cursor:text");
  });
});
