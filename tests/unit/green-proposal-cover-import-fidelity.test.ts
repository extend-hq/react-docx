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
  "/Users/andrewluo/Documents/DOCX testing/docx test/Green_Proposal (1).docx";

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

describe("green proposal cover import fidelity", () => {
  it("keeps cover textbox text out of top-level flow paragraphs", async () => {
    const zip = readFileSync(DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);

    const leakedFlowParagraphs = model.nodes.filter((node) => {
      if (node.type !== "paragraph") {
        return false;
      }

      const text = node.children
        .filter(
          (
            child
          ): child is Extract<
            (typeof node.children)[number],
            { type: "text" }
          > => child.type === "text"
        )
        .map((child) => child.text)
        .join("");
      return (
        text.includes("{document_title}") ||
        text.includes("Prepared for:") ||
        text.includes("client.name") ||
        text.includes("client.logo")
      );
    });

    const syntheticTextBoxes = model.nodes.filter(
      (node) =>
        node.type === "paragraph" &&
        node.children.some(
          (child) => child.type === "image" && child.syntheticTextBox
        )
    );

    expect(leakedFlowParagraphs).toHaveLength(0);
    expect(syntheticTextBoxes.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the cover text positioned on page 1 without spilling into flow", async () => {
    const zip = readFileSync(DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const html = renderToStaticMarkup(
      React.createElement(ImportedViewer, { model })
    );

    const pages = extractRenderedPages(html);
    const page1Html = pages[0] ?? "";
    const page2Html = pages[1] ?? "";

    expect(pages).toHaveLength(2);
    expect(page1Html).toContain("{document_title}");
    expect(page1Html).toContain("Prepared for:");
    expect(page1Html).toContain('data-docx-paragraph-node-index="4"');
    expect(page1Html).toContain('data-docx-paragraph-node-index="20"');
    expect(page1Html).toContain("text-align:center");
    expect(page2Html).not.toContain("{document_title}");
    expect(page2Html).not.toContain("Prepared for:");
  });
});
