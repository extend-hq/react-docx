import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cloneDocModel, type DocModel } from "../../packages/doc-model/src";
import {
  defaultStarterModel,
  DocxEditorViewer,
  useDocxEditor
} from "../../packages/react-viewer/src/editor";
import { describe, expect, it } from "vitest";

function BodyViewer({ model }: { model: DocModel }): React.JSX.Element {
  const editor = useDocxEditor({ starterModel: model });
  return React.createElement(DocxEditorViewer, {
    editor,
    mode: "read-only"
  });
}

describe("absolute floating image width", () => {
  it("keeps centered absolute body images at their declared width", () => {
    const model = cloneDocModel(defaultStarterModel);
    model.nodes = [
      {
        type: "paragraph",
        children: [
          {
            type: "image",
            src: "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22763%22%20height%3D%22996%22%3E%3Crect%20width%3D%22763%22%20height%3D%22996%22%20fill%3D%22%2351872f%22%2F%3E%3C%2Fsvg%3E",
            alt: "Centered background",
            widthPx: 763,
            heightPx: 996,
            floating: {
              horizontalAlign: "center",
              horizontalRelativeTo: "page",
              yPx: -70,
              verticalRelativeTo: "paragraph",
              wrapType: "none",
              behindDocument: true
            }
          }
        ]
      }
    ];

    const html = renderToStaticMarkup(React.createElement(BodyViewer, { model }));

    expect(html).toContain('data-docx-image-location="p:0:0"');
    expect(html).toContain("width:900px");
    expect(html).toContain("height:1175px");
    expect(html).toContain("left:50%");
    expect(html).toContain("transform:translateX(-50%)");
  });
});
