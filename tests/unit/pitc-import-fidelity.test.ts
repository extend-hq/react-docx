import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "../../packages/doc-model/src";
import { parseDocx } from "../../packages/ooxml-core/src";
import {
  buildDocumentPageNodeSegments,
  DocxEditorViewer,
  useDocxEditor
} from "../../packages/react-viewer/src/editor";
import { parseSectionLayout } from "../../packages/react-viewer/src/section-layout";

const PITC_FULL_DOCX_PATH =
  "/Users/andrewluo/Documents/DOCX testing/PITC0008189 - RFT Attachment C - Response Schedule.docx";
const PITC_PAGE_ONE_DOCX_PATH =
  "/Users/andrewluo/Documents/DOCX testing/PITC SPLIT/PITC0008189 - RFT Attachment C - Response Schedule (1).docx";

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

describe("PITC import fidelity", () => {
  it("keeps the cover overlay anchor paragraphs on the first page during static pagination", async () => {
    const zip = readFileSync(PITC_FULL_DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const layout = parseSectionLayout(model.metadata.sectionPropertiesXml);
    const pages = buildDocumentPageNodeSegments(
      model,
      layout.pageHeightPx - layout.marginsPx.top - layout.marginsPx.bottom,
      layout.pageWidthPx - layout.marginsPx.left - layout.marginsPx.right,
      model.metadata.numberingDefinitions,
      []
    );

    expect(pages[0]?.[0]?.nodeIndex).toBe(1);
    expect(pages[1]?.[0]?.nodeIndex).toBeGreaterThanOrEqual(32);
  });

  it("keeps absolute overlay anchor paragraphs on a single imported page", async () => {
    const zip = readFileSync(PITC_PAGE_ONE_DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);

    const overlayAnchor = model.nodes.find(
      (node) =>
        node.type === "paragraph" &&
        !node.children.some((child) => child.type === "text" && child.text.trim().length > 0) &&
        node.children.some(
          (child) =>
            child.type === "image" &&
            child.floating?.wrapType === "none" &&
            child.floating?.verticalRelativeTo === "line"
        )
    );

    expect(overlayAnchor?.type).toBe("paragraph");

    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model }));
    const pageCount = (html.match(/data-docx-page-surface="true"/g) ?? []).length;

    expect(pageCount).toBe(1);
  });
});
