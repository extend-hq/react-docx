import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "../../packages/doc-model/src";
import { parseDocx } from "../../packages/ooxml-core/src";
import { DocxEditorViewer, useDocxEditor } from "../../packages/react-viewer/src/editor";

const DOCX_PATH =
  "/Users/andrewluo/Documents/DOCX testing/docx test/endnotes.docx";

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

describe("endnotes import render", () => {
  it("renders referenced endnotes on the last existing page instead of forcing a blank trailing page", async () => {
    const zip = readFileSync(DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model }));

    expect(model.metadata.endnotes?.map((note) => note.text)).toEqual([
      "A tachyon walks into a bar.",
      "Fin."
    ]);
    expect((html.match(/data-docx-page-wrapper=\"true\"/g) ?? []).length).toBe(1);
    expect(html).toContain('data-docx-endnotes-section="true"');
    expect(html).not.toContain('data-docx-footnotes-section="true"');
    expect(html).toContain('id="docx-endnote-2"');
    expect(html).toContain('id="docx-endnote-3"');
    expect(html).toContain("A tachyon walks into a bar.");
    expect(html).toContain("Fin.");
    expect(html).not.toContain('margin-top:auto');
  });
});
