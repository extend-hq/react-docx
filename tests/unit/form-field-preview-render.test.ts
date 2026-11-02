import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cloneDocModel, type DocModel, type FormFieldRunNode } from "@extend-ai/react-docx-doc-model";
import { ReadOnlyCheckbox } from "../../packages/react-viewer/src/form-field-preview";
import { resolveFormFieldPreviewImageSource } from "../../packages/react-viewer/src/image-render";
import { defaultStarterModel, DocxEditorViewer, useDocxEditor } from "../../packages/react-viewer/src/editor";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";

function checkbox(checked = true): FormFieldRunNode {
  return {
    type: "form-field",
    fieldType: "checkbox",
    sourceKind: "legacy",
    title: "Option",
    checked,
    sourceXml: '<w:r><w:control r:id="rId1" w:shapeid="shape1"/></w:r>',
    sourcePreview: {
      relationshipId: "rId1",
      shapeId: "shape1",
      checked,
      image: {
        type: "image",
        src: `data:image/png;base64,${png}`,
        contentType: "image/png",
        widthPx: 18,
        heightPx: 14,
      },
    },
  };
}

function Viewer({ model, mode }: { model: DocModel; mode: "edit" | "read-only" }): React.JSX.Element {
  const editor = useDocxEditor({ starterModel: model });
  return React.createElement(DocxEditorViewer, { editor, mode });
}

function renderViewer(field: FormFieldRunNode, mode: "edit" | "read-only" = "read-only"): string {
  const model = cloneDocModel(defaultStarterModel);
  model.nodes = [{ type: "paragraph", children: [field, { type: "text", text: " Content" }] }];
  return renderToStaticMarkup(React.createElement(Viewer, { model, mode }));
}

describe("form field source preview rendering", () => {
  it.each([true, false])("renders one decorative preview in a named readonly control for checked=%s", (checked) => {
    const html = renderToStaticMarkup(React.createElement(ReadOnlyCheckbox, {
      field: checkbox(checked),
      fallback: checked ? "☒" : "☐",
    }));
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html.match(/role="checkbox"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Option"');
    expect(html).toContain(`aria-checked="${checked}"`);
    expect(html).toContain('aria-readonly="true"');
    expect(html).toContain('alt="" aria-hidden="true"');
    expect(html).not.toContain(checked ? "☒" : "☐");
  });

  it("uses the existing glyph when source state no longer matches", () => {
    const field = checkbox();
    field.checked = false;
    const html = renderToStaticMarkup(React.createElement(ReadOnlyCheckbox, { field, fallback: "☐" }));
    expect(html).not.toContain("<img ");
    expect(html).toContain("☐");
    expect(html).toContain('aria-checked="false"');
  });

  it("consumes the preview through the actual readonly editor route", () => {
    const html = renderViewer(checkbox());
    expect(html.match(/data-docx-form-field-preview="true"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Option"');
    expect(html).toContain("width:18px");
    expect(html).toContain("height:14px");
  });

  it("keeps editing on one semantic control without the source image", () => {
    const html = renderViewer(checkbox(), "edit");
    expect(html).not.toContain('data-docx-form-field-preview="true"');
    expect(html.match(/data-docx-form-field-type="checkbox"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Option"');
    expect(html).toContain('aria-checked="true"');
  });

  it("uses source image anchors for the readonly frame", () => {
    const field = checkbox();
    field.sourcePreview!.image.floating = {
      xPx: 12,
      yPx: 8,
      horizontalRelativeTo: "paragraph",
      verticalRelativeTo: "paragraph",
      wrapType: "none",
    };
    const html = renderViewer(field);
    expect(html).toContain("position:absolute");
    expect(html).toContain("left:12px");
    expect(html).toContain("top:8px");
    expect(html.match(/data-docx-form-field-preview="true"/g)).toHaveLength(1);
  });

  it("resolves retained bitmap bytes without a redundant src", () => {
    const source = resolveFormFieldPreviewImageSource({
      contentType: "image/png",
      data: new Uint8Array(Buffer.from(png, "base64")),
    });
    expect(source).toBe(`data:image/png;base64,${png}`);
  });

  it("renders a converted source while retaining the original metafile payload", () => {
    const field = checkbox();
    const image = field.sourcePreview!.image;
    image.contentType = "image/x-wmf";
    image.data = new Uint8Array([1, 2, 3]);
    expect(resolveFormFieldPreviewImageSource(image)).toBe(image.src);
    expect(image.data).toEqual(new Uint8Array([1, 2, 3]));
    image.src = "data:image/x-wmf;base64,AQID";
    expect(resolveFormFieldPreviewImageSource(image)).toBeUndefined();
  });
});
