import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "../../packages/doc-model/src";
import { parseDocx } from "../../packages/ooxml-core/src";
import { DocxEditorViewer, useDocxEditor } from "../../packages/react-viewer/src/editor";

const HEADER_FOOTER_DOCX_PATH =
  "/Users/andrewluo/Documents/DOCX testing/2026-04-03_14-45-42/fd29deb939afe8b33f66f2431738a90cac3b1c1de79d6aa0da4a227c40d7322b.docx";

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

describe("header/footer variant fidelity", () => {
  it("uses the default header when even-and-odd headers are disabled and keeps footer column-relative art centered", async () => {
    const zip = readFileSync(HEADER_FOOTER_DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model }));

    expect(html).toContain("width:5px");
    expect(html).not.toContain("width:397px");
    expect(html).toMatch(/width:760px[^"]*left:17px|left:17px[^"]*width:760px/);
  });

  it("does not overpaginate when the footer only contains behind-text decorative overlays", async () => {
    const zip = readFileSync(HEADER_FOOTER_DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model }));
    const pageWrapperCount = (html.match(/data-docx-page-wrapper="true"/g) ?? []).length;

    expect(model.metadata.documentPageCount).toBe(2);
    expect(pageWrapperCount).toBe(2);
  });

  it("uses the default header on page 1 and keeps the right-side green accent in that header", async () => {
    const zip = readFileSync(HEADER_FOOTER_DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model }));

    expect(html).toMatch(
      /data-docx-page-wrapper="true"[^>]*data-docx-page-index="0"[\s\S]*?data-docx-header-footer-region="header"[\s\S]*?width:5px/
    );
    expect(html).toMatch(
      /data-docx-page-wrapper="true"[^>]*data-docx-page-index="0"[\s\S]*?data-docx-header-footer-region="header"[\s\S]*?width:207px[^"]*position:absolute[^"]*left:273px[^"]*top:-11px/
    );
    expect(html).toMatch(
      /data-docx-page-wrapper="true"[^>]*data-docx-page-index="0"[\s\S]*?data-docx-header-footer-region="header"[\s\S]*?width:5px[^"]*position:absolute[^"]*left:755px[^"]*top:0/
    );
  });
});
