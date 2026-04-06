import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "../../packages/doc-model/src";
import { parseDocx } from "../../packages/ooxml-core/src";
import { DocxEditorViewer, useDocxEditor } from "../../packages/react-viewer/src/editor";

const DOCX_PATH =
  "/Users/andrewluo/Documents/DOCX testing/docx test/footnote-hyperlink.docx";

function ImportedViewer({
  model
}: {
  model: Awaited<ReturnType<typeof buildDocModel>>;
}): React.JSX.Element {
  const editor = useDocxEditor({ starterModel: model });
  return React.createElement(DocxEditorViewer, {
    editor,
    mode: "read-only",
    deferInitialPaginationPaint: false
  });
}

describe("footnote hyperlink render", () => {
  it("renders footnotes at the bottom of the page with hyperlink content preserved", async () => {
    const zip = readFileSync(DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model }));

    expect(model.metadata.footnotes?.[0]?.text).toContain("Example");
    expect(model.metadata.footnotes?.[0]?.nodes?.length).toBeGreaterThan(0);
    expect((html.match(/data-docx-page-wrapper=\"true\"/g) ?? []).length).toBe(1);
    expect(html).toContain('data-docx-footnotes-section="true"');
    expect(html).toContain('id="docx-footnote-1"');
    expect(html).toContain('href="http://www.example.com"');
    expect(html).toContain(">Example</a>");
  });
});
