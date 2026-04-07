import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "../../packages/doc-model/src";
import { parseDocx } from "../../packages/ooxml-core/src";
import {
  DocxEditorViewer,
  useDocxEditor,
} from "../../packages/react-viewer/src/editor";

const DOCX_PATH =
  "/Users/andrewluo/Documents/DOCX testing/docx test/Letterhead.docx";

function ImportedViewer({
  model,
}: {
  model: Awaited<ReturnType<typeof buildDocModel>>;
}): React.JSX.Element {
  const editor = useDocxEditor({ starterModel: model });
  return React.createElement(DocxEditorViewer, {
    editor,
    mode: "read-only",
    deferInitialPaginationPaint: false,
  });
}

describe("letterhead page frame render", () => {
  it("imports and renders the document background and page border frame", async () => {
    const zip = readFileSync(DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const html = renderToStaticMarkup(
      React.createElement(ImportedViewer, { model })
    );

    expect(model.metadata.documentBackgroundColor).toBe("#333541");
    expect(model.metadata.sections?.[0]?.sectionPropertiesXml).toContain(
      "<w:pgBorders"
    );

    expect(html).toContain('data-docx-page-surface="true"');
    expect(html).toContain("background-color:#333541");
    expect(html).toContain('data-docx-page-border-overlay="true"');
    expect(html).toContain("top:32px");
    expect(html).toContain("right:32px");
    expect(html).toContain("bottom:32px");
    expect(html).toContain("left:32px");
    expect(html).toContain("border-top:4px solid #00B4D8");
    expect(html).toContain("border-right:4px solid #00B4D8");
    expect(html).toContain("border-bottom:4px solid #00B4D8");
    expect(html).toContain("border-left:4px solid #00B4D8");
  });
});
