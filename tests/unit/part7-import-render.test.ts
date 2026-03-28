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
  it("imports and renders both floating arrow images", async () => {
    const zip = readFileSync(PART7_DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);

    expect(model.nodes[1]?.type).toBe("paragraph");
    expect(model.nodes[3]?.type).toBe("paragraph");
    if (model.nodes[1]?.type !== "paragraph" || model.nodes[3]?.type !== "paragraph") {
      return;
    }

    const leftArrow = model.nodes[1].children[3];
    const rightArrow = model.nodes[3].children[1];
    expect(leftArrow?.type).toBe("image");
    expect(rightArrow?.type).toBe("image");
    if (leftArrow?.type !== "image" || rightArrow?.type !== "image") {
      return;
    }

    expect(leftArrow.alt).toBe("back.png");
    expect(rightArrow.alt).toBe("forward.png");
    expect(leftArrow.src).toContain("data:image/png;base64,");
    expect(rightArrow.src).toContain("data:image/png;base64,");

    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model }));
    expect(html).toContain('data-docx-image-location="p:1:3"');
    expect(html).toContain('data-docx-image-location="p:3:1"');
    expect(html).toContain("back.png");
    expect(html).toContain("forward.png");
  });
});
