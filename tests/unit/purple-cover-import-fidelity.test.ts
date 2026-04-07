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
  "/Users/andrewluo/Documents/DOCX testing/docx test/Purple Cover Letterhead.docx";

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

describe("purple cover import fidelity", () => {
  it("anchors the cover overlay host to the page surface origin", async () => {
    const zip = readFileSync(DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const html = renderToStaticMarkup(
      React.createElement(ImportedViewer, { model })
    );

    expect(model.nodes[0]?.type).toBe("paragraph");
    if (model.nodes[0]?.type === "paragraph") {
      const coverImage = model.nodes[0].children[0];
      expect(coverImage?.type).toBe("image");
      if (coverImage?.type === "image") {
        expect(coverImage.floating?.horizontalRelativeTo).toBe("page");
        expect(coverImage.floating?.verticalRelativeTo).toBe("page");
        expect(coverImage.floating?.xPx).toBeCloseTo(-9.191, 3);
        expect(coverImage.floating?.yPx).toBeCloseTo(-22.468, 3);
      }
    }

    const hostMarker = 'data-docx-paragraph-node-index="0"';
    const hostIndex = html.indexOf(hostMarker);
    expect(hostIndex).toBeGreaterThanOrEqual(0);
    const hostSnippet = html.slice(
      Math.max(0, hostIndex - 400),
      hostIndex + 2200
    );

    expect(hostSnippet).toContain("margin-top:-96px");
    expect(hostSnippet).toContain("margin-left:-96px");
    expect(hostSnippet).toContain("width:816px");
    expect(hostSnippet).toContain('data-docx-image-location="p:0:0"');
    expect(hostSnippet).toContain("left:-9.191px");
    expect(hostSnippet).toContain("top:-22.468px");
  });
});
