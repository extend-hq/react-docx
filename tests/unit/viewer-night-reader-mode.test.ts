import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cloneDocModel, type DocModel } from "../../packages/doc-model/src";
import {
  defaultStarterModel,
  DocxEditorViewer,
  useDocxEditor,
} from "../../packages/react-viewer/src/editor";

function NightReaderViewer(props: {
  model: DocModel;
  initialDocumentTheme?: "light" | "dark";
  mode?: "edit" | "read-only";
}): React.JSX.Element {
  const editor = useDocxEditor({
    starterModel: props.model,
    initialDocumentTheme: props.initialDocumentTheme,
  });

  return React.createElement(DocxEditorViewer, {
    editor,
    mode: props.mode ?? "read-only",
  });
}

function nightReaderModel(): DocModel {
  const model = cloneDocModel(defaultStarterModel);
  model.nodes = [
    {
      type: "paragraph",
      children: [
        {
          type: "text",
          text: "Night reader sample ",
        },
        {
          type: "image",
          src: "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%3E%3Crect%20width%3D%2224%22%20height%3D%2224%22%20rx%3D%224%22%20fill%3D%22%23f97316%22%2F%3E%3Ccircle%20cx%3D%2212%22%20cy%3D%2212%22%20r%3D%226%22%20fill%3D%22%230ea5e9%22%2F%3E%3C%2Fsvg%3E",
          alt: "Sample art",
          widthPx: 24,
          heightPx: 24,
          cssFilter: "grayscale(1)",
        },
      ],
    },
  ];
  return model;
}

describe("viewer night reader mode", () => {
  it("inverts read-only dark document content and cancels the inversion on images", () => {
    const nightReaderFilter =
      "invert(0.95) hue-rotate(180deg) saturate(0.9) brightness(0.9) contrast(0.94)";
    const html = renderToStaticMarkup(
      React.createElement(NightReaderViewer, {
        model: nightReaderModel(),
        initialDocumentTheme: "dark",
        mode: "read-only",
      })
    );

    expect(html).toContain(`filter:${nightReaderFilter}`);
    expect(html).toContain(`filter:grayscale(1) ${nightReaderFilter}`);
    expect(html).toContain("background-color:#0a0a0a");
  });

  it("does not apply the inversion path while the dark document is editable", () => {
    const nightReaderFilter =
      "invert(0.95) hue-rotate(180deg) saturate(0.9) brightness(0.9) contrast(0.94)";
    const html = renderToStaticMarkup(
      React.createElement(NightReaderViewer, {
        model: nightReaderModel(),
        initialDocumentTheme: "dark",
        mode: "edit",
      })
    );

    expect(html).not.toContain(`filter:${nightReaderFilter}`);
    expect(html).toContain("color:#f3f4f6");
  });
});
