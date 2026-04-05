import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "../../packages/doc-model/src";
import { parseDocx } from "../../packages/ooxml-core/src";
import {
  DocxEditorViewer,
  useDocxEditor
} from "../../packages/react-viewer/src/editor";
import { updateParagraphText } from "../../packages/editor-ops/src";

const PART7_DOCX_PATH =
  "/Users/andrewluo/Documents/DOCX testing/SplitResult_2026_02_24_08_16_44/part-7.docx";

function ImportedViewer({
  model,
  mode = "edit"
}: {
  model: Awaited<ReturnType<typeof buildDocModel>>;
  mode?: "edit" | "read-only";
}): React.JSX.Element {
  const editor = useDocxEditor({ starterModel: model });
  return React.createElement(DocxEditorViewer, {
    editor,
    mode
  });
}

describe("part-7 import render", () => {
  it("imports the mixed wrapped-arrow and inline-dot paragraph structure", async () => {
    const zip = readFileSync(PART7_DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);

    expect(model.nodes[1]?.type).toBe("paragraph");
    if (model.nodes[1]?.type !== "paragraph") {
      return;
    }

    const leftArrow = model.nodes[1].children[0];
    const inlineDot = model.nodes[1].children[2];
    expect(leftArrow?.type).toBe("image");
    expect(inlineDot?.type).toBe("image");
    if (leftArrow?.type !== "image" || inlineDot?.type !== "image") {
      return;
    }

    expect(leftArrow.alt).toBe("back.png");
    expect(inlineDot.alt).toBe("dot_green.png");
    expect(leftArrow.src).toContain("data:image/png;base64,");
    expect(inlineDot.src).toContain("data:image/png;base64,");

    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model }));
    expect(html).toContain('data-docx-image-location="p:1:0"');
    expect(html).toContain('data-docx-image-location="p:1:2"');
    expect(html).toContain("back.png");
    expect(html).toContain("dot_green.png");
  });

  it("keeps the second fixed-position wrapped arrow rendered after paragraph text edits", async () => {
    const zip = readFileSync(PART7_DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);

    expect(model.nodes[4]?.type).toBe("paragraph");
    if (model.nodes[4]?.type !== "paragraph") {
      return;
    }

    const editedText = `Edited ${model.nodes[4].children
      .filter((child): child is Extract<typeof model.nodes[4]["children"][number], { type: "text" }> => child.type === "text")
      .map((child) => child.text)
      .join("")}`;
    const editedModel = updateParagraphText(model, 4, editedText);
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model: editedModel }));

    expect(html).toContain("forward.png");
    expect(html).toContain('data-docx-image-location="p:4:1"');
  });
});
