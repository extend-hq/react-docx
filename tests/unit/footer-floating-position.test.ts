import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cloneDocModel, type DocModel } from "../../packages/doc-model/src";
import {
  defaultStarterModel,
  DocxEditorViewer,
  useDocxEditor
} from "../../packages/react-viewer/src/editor";
import { describe, expect, it } from "vitest";

function FooterViewer({ model }: { model: DocModel }): React.JSX.Element {
  const editor = useDocxEditor({ starterModel: model });
  return React.createElement(DocxEditorViewer, {
    editor,
    mode: "read-only"
  });
}

describe("footer floating positioning", () => {
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
    expect(html).toContain(
      'style="display:grid;gap:8px;position:absolute;left:0;right:0;top:0;bottom:0;width:100%;max-width:100%;box-sizing:border-box;align-content:end;padding-left:0;padding-right:0;padding-bottom:56px;opacity:1;transition:opacity 120ms ease;outline:none;box-shadow:none;z-index:1" contentEditable="false" data-docx-header-footer-region="footer"'
    );
    expect(html).toContain("left:120px;top:900px");
  });
});
