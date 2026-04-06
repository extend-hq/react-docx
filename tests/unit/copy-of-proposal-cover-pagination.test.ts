import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "../../packages/doc-model/src";
import { parseDocx } from "../../packages/ooxml-core/src";
import {
  buildDocumentPageNodeSegments,
  DocxEditorViewer,
  useDocxEditor,
} from "../../packages/react-viewer/src/editor";
import { parseSectionLayout } from "../../packages/react-viewer/src/section-layout";

const DOCX_PATH =
  "/Users/andrewluo/Documents/DOCX testing/docx test/Copy of Proposal (1).docx";

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

  return starts.map((start, index) =>
    html.slice(start, starts[index + 1] ?? html.length)
  );
}

describe("copy of proposal cover pagination", () => {
  it("starts executive summary on page 2 after the cover spacer run", async () => {
    const zip = readFileSync(DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const primaryLayout = parseSectionLayout(
      model.metadata.sections?.[0]?.sectionPropertiesXml ??
        model.metadata.sectionPropertiesXml
    );
    const pageContentWidthPx =
      primaryLayout.pageWidthPx -
      primaryLayout.marginsPx.left -
      primaryLayout.marginsPx.right;
    const pageContentHeightPx =
      primaryLayout.pageHeightPx -
      primaryLayout.marginsPx.top -
      primaryLayout.marginsPx.bottom;

    const pages = buildDocumentPageNodeSegments(
      model,
      pageContentHeightPx,
      pageContentWidthPx,
      model.metadata.numberingDefinitions
    );
    const html = renderToStaticMarkup(
      React.createElement(ImportedViewer, { model })
    );
    const renderedPages = extractRenderedPages(html);

    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(renderedPages.length).toBeGreaterThanOrEqual(2);
    expect(renderedPages[0]).not.toContain("Executive Summary");
    expect(renderedPages[1]).toContain("Executive Summary");
    expect(renderedPages[0]).toContain("Sales Proposal");
  });
});
