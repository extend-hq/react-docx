import * as React from "react";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { parseDocx } from "../../packages/ooxml-core/src";
import { buildDocModel } from "../../packages/doc-model/src";
import {
  DocxEditorViewer,
  paragraphLineCountWithinWidth,
  useDocxEditor,
} from "../../packages/react-viewer/src/editor";

const DOCX_PATH =
  "/Users/andrewluo/Documents/DOCX testing/docx test/DealPage SaaS Agreement Template [Clean 7.5.23].docx";

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

describe("dealpage saas agreement import fidelity", () => {
  it("does not synthesize huge list indentation from empty numbering levels", async () => {
    const zip = readFileSync(DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const numberingDefinitions = model.metadata.numberingDefinitions;
    const longClause = model.nodes[18];

    expect(longClause?.type).toBe("paragraph");
    if (!longClause || longClause.type !== "paragraph") {
      throw new Error("Expected paragraph node at index 18");
    }

    expect(longClause.style?.numbering).toEqual({
      numId: 2,
      ilvl: 3,
    });
    expect(
      paragraphLineCountWithinWidth(longClause, 351, numberingDefinitions)
    ).toBeLessThan(100);
  });

  it("keeps the two-column agreement close to the source page count", async () => {
    const zip = readFileSync(DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const html = renderToStaticMarkup(
      React.createElement(ImportedViewer, { model })
    );
    const pages = extractRenderedPages(html);

    expect(
      (model.metadata.sections ?? []).filter((section) =>
        /<w:cols\b[^>]*w:num="2"/i.test(section.sectionPropertiesXml ?? "")
      )
    ).toHaveLength(2);
    expect(pages.length).toBeLessThanOrEqual(8);
  });
});
