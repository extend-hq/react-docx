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
  "/Users/andrewluo/Documents/DOCX testing/docx test/Proposal (1).docx";

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

function extractRenderedPages(html: string): string[] {
  const marker = '<div data-docx-page-wrapper="true"';
  const starts: number[] = [];
  let cursor = 0;
  while (cursor < html.length) {
    const index = html.indexOf(marker, cursor);
    if (index === -1) {
      break;
    }
    starts.push(index);
    cursor = index + marker.length;
  }

  return starts.map((start, index) => html.slice(start, starts[index + 1] ?? html.length));
}

describe("proposal cover import fidelity", () => {
  it("keeps executive summary off the cover page and on page 2", async () => {
    const zip = readFileSync(DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model }));

    const pages = extractRenderedPages(html);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    const page1Html = pages[0] ?? "";
    const page2Html = pages[1] ?? "";

    expect(page1Html).not.toContain("Executive Summary");
    expect(page2Html).toContain("Executive Summary");
    expect(page1Html).toContain("left:-96px");
    expect(page1Html).toContain("top:-96px");
    expect(page1Html).toContain("width:816px");
    expect(page1Html).toContain("height:1056px");
    expect(page1Html).toContain("z-index:-98080");
    expect(page1Html).toContain("{date}");
    expect(page1Html).toContain("data-docx-textbox-editor=\"true\"");
  });
});
