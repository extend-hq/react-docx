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
});
