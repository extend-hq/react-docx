import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "../../packages/doc-model/src";
import { parseDocx } from "../../packages/ooxml-core/src";
import { DocxEditorViewer, useDocxEditor } from "../../packages/react-viewer/src/editor";

const DOCX_PATH =
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

describe("warranty callout render", () => {
  it("keeps the behind-text callout panel visible behind the following heading and bullets", async () => {
    const zip = readFileSync(DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model }));

    expect(html).toMatch(
      /data-docx-paragraph-node-index="12"[^>]*style="position:relative;(?![^"]*z-index:1)[^"]*"[^>]*><span[^>]*data-docx-image-location="p:12:0"[^>]*position:absolute[^"]*width:634px[^"]*height:238px[^"]*left:-43px[^"]*top:1px/
    );
    expect(html).not.toMatch(
      /data-docx-paragraph-node-index="12"[\s\S]*?data-docx-image-location="p:12:0"[\s\S]*?opacity:0\.2/
    );
    expect(html).toMatch(
      /data-docx-paragraph-node-index="13"[\s\S]*?Matters not covered by the warranty:/
    );
  });
});
