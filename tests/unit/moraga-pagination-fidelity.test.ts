import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "../../packages/doc-model/src";
import { parseDocx } from "../../packages/ooxml-core/src";
import {
  buildDocumentPageNodeSegments,
  DocxEditorViewer,
  paragraphLineCountWithinWidth,
  useDocxEditor,
} from "../../packages/react-viewer/src/editor";
import { parseSectionLayout } from "../../packages/react-viewer/src/section-layout";

const DOCX_PATH =
  "/Users/andrewluo/Documents/DOCX testing/docx test/moraga_clean copy.docx";

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

describe("moraga pagination fidelity", () => {
  it("splits the soft-break-heavy imported paragraph across multiple pages", async () => {
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

    const onlyParagraph = model.nodes[0];
    expect(onlyParagraph?.type).toBe("paragraph");
    if (onlyParagraph?.type !== "paragraph") {
      return;
    }

    const lineCount = paragraphLineCountWithinWidth(
      onlyParagraph,
      pageContentWidthPx,
      model.metadata.numberingDefinitions
    );
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

    expect(lineCount).toBeGreaterThan(50);
    expect(pages.length).toBeGreaterThan(5);
    expect(renderedPages.length).toBeGreaterThan(5);
    expect(html).not.toContain("overflow:hidden visible");
    expect(html).toContain("clip-path:inset(0 0 0 0)");
  });

  it("does not collapse to one page when browser pretext measurement is available", async () => {
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

    const previousDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement: () => ({
        getContext: () => ({
          font: "",
          measureText: (text: string) => ({
            width: Math.max(0, text.length * 7),
          }),
        }),
      }),
    };

    try {
      const pages = buildDocumentPageNodeSegments(
        model,
        pageContentHeightPx,
        pageContentWidthPx,
        model.metadata.numberingDefinitions
      );
      expect(pages.length).toBeGreaterThan(5);
    } finally {
      if (previousDocument === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = previousDocument;
      }
    }
  });
});
