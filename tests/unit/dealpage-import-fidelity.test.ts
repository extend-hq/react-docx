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
  "/Users/andrewluo/Documents/DOCX testing/docx test/DealPage One Pager (1).docx";

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

describe("deal page one-pager import fidelity", () => {
  it("keeps poster-style behind-text background art on a single rendered page", async () => {
    const zip = readFileSync(DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const bottomLeftImage = model.nodes[18];
    const html = renderToStaticMarkup(
      React.createElement(ImportedViewer, { model })
    );

    const pages = extractRenderedPages(html);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain("Make");
    expect(pages[0]).toContain("Contact Us");
    expect(pages[0]).toContain("Trusted By");
    expect(pages[0]).toContain("Picture 8");
    expect(pages[0]).toContain("Picture 9");
    expect(pages[0]).toContain("Picture 10");
    expect(pages[0]).toContain("Picture 11");
    expect(bottomLeftImage?.type).toBe("paragraph");
    if (bottomLeftImage?.type === "paragraph") {
      const image = bottomLeftImage.children[0];
      expect(image?.type).toBe("image");
      if (image?.type === "image") {
        expect(image.widthPx).toBeCloseTo(529.933, 3);
        expect(image.heightPx).toBeCloseTo(250.067, 3);
        expect(image.floating?.xPx).toBeCloseTo(-49.267, 3);
        expect(image.floating?.yPx).toBeCloseTo(23.133, 3);
      }
    }
    expect(pages[0]).toContain("left:-49.267px");
    expect(pages[0]).toContain("top:23.133px");
    expect(pages[0]).toContain("width:529.933px");
    expect(pages[0]).toContain("height:250.067px");
  });
});
