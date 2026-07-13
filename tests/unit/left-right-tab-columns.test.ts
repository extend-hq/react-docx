import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import type { DocModel } from "@extend-ai/react-docx-doc-model";
import { DocxEditorViewer, useDocxEditor } from "../../packages/react-viewer/src/editor";

// Layout measures via OffscreenCanvas; provide a deterministic stub for node.
beforeAll(() => {
  const makeContext = () => ({ font: "", measureText: (t: string) => ({ width: t.length * 7 }) });
  (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
    getContext() {
      return makeContext();
    }
  };
});

// Regression for extend-hq/react-docx#13: a paragraph mixing a LEFT tab stop and
// a RIGHT-aligned tab stop (the classic two-column signature block) must use the
// anchored tab layout — not fall back to the plain left-only tab path that
// treats the right tab as left and mis-wraps.
function buildModel(): DocModel {
  return {
    nodes: [
      {
        type: "paragraph",
        style: {
          tabStops: [
            { alignment: "left", positionTwips: 5760 },
            { alignment: "right", positionTwips: 9240 },
          ],
        },
        // Two rows (split by the line break) x two columns (split by the tab):
        //   Client A                     | Company B Legal Name LLC
        //   On behalf of itself and ...  | On behalf of itself and ...
        children: [
          {
            type: "text",
            text:
              "Client A\tCompany B Legal Name LLC\nOn behalf of itself and its affiliates\tOn behalf of itself and its affiliates",
          },
        ],
      },
    ],
    metadata: {
      sourceParts: 1,
      warnings: [],
      headerSections: [],
      footerSections: [],
      paragraphStyles: [],
    },
  };
}

function Viewer({ model }: { model: DocModel }): React.JSX.Element {
  const editor = useDocxEditor({ starterModel: model });
  return React.createElement(DocxEditorViewer, { editor, mode: "read-only" });
}

describe("left+right tab-stop columns (signature block)", () => {
  it("renders via the anchored left-right tab layout (left margin + right column)", () => {
    const html = renderToStaticMarkup(React.createElement(Viewer, { model: buildModel() }));
    expect(html).toContain('data-docx-tab-layout="left-right"');
    expect(html).toMatch(/data-docx-tab-zone="0"/);
    expect(html).toMatch(/data-docx-tab-zone="1"/);
  });
});
