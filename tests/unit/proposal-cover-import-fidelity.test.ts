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
  "/Users/andrewluo/Documents/DOCX testing/docx test/Proposal (1).docx";
const GREEN_DOCX_PATH =
  "/Users/andrewluo/Documents/DOCX testing/docx test/Green_Proposal (1).docx";
const PROPOSAL_VARIANTS: ReadonlyArray<{
  path: string;
  secondPageHeading: string;
}> = [
  {
    path: "/Users/andrewluo/Documents/DOCX testing/docx test/Proposal (1).docx",
    secondPageHeading: "Executive Summary",
  },
  {
    path: "/Users/andrewluo/Documents/DOCX testing/docx test/Copy of Proposal (1).docx",
    secondPageHeading: "Executive Summary",
  },
  {
    path: "/Users/andrewluo/Documents/DOCX testing/docx test/Copy of Proposal.docx",
    secondPageHeading: "Executive Summary",
  },
  {
    path: "/Users/andrewluo/Documents/DOCX testing/docx test/Proposal.docx",
    secondPageHeading: "Executive Summary",
  },
  {
    path: "/Users/andrewluo/Documents/DOCX testing/docx test/Standard Proposal.docx",
    secondPageHeading: "The Problem",
  },
];

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
    expect(page1Html).toContain("data-docx-page-cover-layer=\"true\"");
    expect(page1Html).toContain("data-docx-page-cover-image=\"true\"");
    expect(page1Html).toContain("padding-left:9.6px");
    expect(page1Html).toContain("padding-top:4.8px");
    expect(page1Html).toContain("{date}");
    expect(page1Html).toContain("data-docx-textbox-editor=\"true\"");
  });

  it("renders green proposal cover art as a page cover layer", async () => {
    const zip = readFileSync(GREEN_DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model }));

    const pages = extractRenderedPages(html);
    expect(pages.length).toBeGreaterThanOrEqual(1);
    const page1Html = pages[0] ?? "";

    expect(page1Html).toContain("data-docx-page-cover-layer=\"true\"");
    expect(page1Html).toContain("data-docx-page-cover-image=\"true\"");
    expect(page1Html).toContain("Prepared for:");
  });

  it("keeps the proposal cover on page 1 and starts section heading at the top of page 2 across variants", async () => {
    for (const variant of PROPOSAL_VARIANTS) {
      const zip = readFileSync(variant.path);
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

      expect(pages.length, variant.path).toBeGreaterThanOrEqual(2);

      const headingNodeIndex = model.nodes.findIndex(
        (node) =>
          node.type === "paragraph" &&
          node.children.some(
            (child) =>
              child.type === "text" &&
              child.text.trim() === variant.secondPageHeading
          )
      );
      expect(headingNodeIndex, variant.path).toBeGreaterThanOrEqual(0);

      const page1NodeIndexes = new Set((pages[0] ?? []).map((segment) => segment.nodeIndex));
      const page2NodeIndexes = (pages[1] ?? []).map((segment) => segment.nodeIndex);

      expect(page1NodeIndexes.has(headingNodeIndex), variant.path).toBe(false);
      expect(page2NodeIndexes.includes(headingNodeIndex), variant.path).toBe(true);

      const firstNonEmptyParagraphNodeOnPage2 = page2NodeIndexes.find((index) => {
        const node = model.nodes[index];
        if (!node || node.type !== "paragraph") {
          return false;
        }
        return node.children.some(
          (child) => child.type === "text" && child.text.trim().length > 0
        );
      });
      expect(firstNonEmptyParagraphNodeOnPage2, variant.path).toBe(headingNodeIndex);
    }
  });
});
