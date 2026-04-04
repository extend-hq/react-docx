import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "../../packages/doc-model/src";
import { parseDocx } from "../../packages/ooxml-core/src";
import { DocxEditorViewer, useDocxEditor } from "../../packages/react-viewer/src/editor";

const HEADER_DOCX_PATH =
  "/Users/andrewluo/Documents/DOCX testing/546b51bd11fb699a2a160eb8d8fde4b6d0c049cec6e375437aeb535d9e0e1611.docx";

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

describe("header column-origin fidelity", () => {
  it("does not add page margin twice to column-relative first-page header images", async () => {
    const zip = readFileSync(HEADER_DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model }));

    expect(html).toMatch(/width:135px[^"]*left:533px|left:533px[^"]*width:135px/);
    expect(html).toMatch(/width:86px[^"]*left:-47px|left:-47px[^"]*width:86px/);
    expect(html).not.toContain("left:605px");
    expect(html).not.toContain("left:25px");
  });
});
