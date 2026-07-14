import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DocModel } from "@extend-ai/react-docx-doc-model";
import { DocxEditorViewer, useDocxEditor } from "../../packages/react-viewer/src/editor";

// Deterministic canvas metrics (20px per character, font-independent) stand in
// for the width the browser actually lays text out at. measureTextWidthPx reads
// them via document.createElement("canvas").getContext("2d"); the per-character
// heuristic the renderer used for tab tracking before the fix would produce a
// different width, so asserting the spacer against these metrics proves canvas
// measurement — not the heuristic — drives tab-column placement.
const PX_PER_CHAR = 20;
const originalDocument = (globalThis as { document?: unknown }).document;

beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({
      getContext: () => ({
        font: "",
        measureText: (text: string) => ({ width: text.length * PX_PER_CHAR }),
      }),
    }),
  };
});

afterAll(() => {
  (globalThis as { document?: unknown }).document = originalDocument;
});

const LEFT_TAB_TWIPS = 5760; // 5760 / 1440 * 96 = 384px
const LEFT_TAB_PX = 384;

// A single LEFT tab stop with a line break: the classic left-only two-column
// signature block (variant C). The two lines' pre-tab text differ in width, so a
// tab spacer sized from the over-estimating heuristic drags the second column
// off the stop. The spacer must instead be (stop - measuredWidth) on every line.
function buildModel(): DocModel {
  return {
    nodes: [
      {
        type: "paragraph",
        style: { tabStops: [{ alignment: "left", positionTwips: LEFT_TAB_TWIPS }] },
        children: [
          { type: "text", text: "AAAA" }, // line 1 pre-tab: 4 chars
          { type: "text", text: "\t" },
          { type: "text", text: "BBBB" },
          { type: "text", text: "\n" },
          { type: "text", text: "CCCCCCCCCC" }, // line 2 pre-tab: 10 chars
          { type: "text", text: "\t" },
          { type: "text", text: "DDDD" },
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

function tabSpacerWidths(html: string): number[] {
  // Each tab renders as a span carrying data-docx-tab-char="true" with an inline
  // pixel width. Collect them in document order.
  const widths: number[] = [];
  const tabSpanRe = /data-docx-tab-char="true"[^>]*style="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = tabSpanRe.exec(html)) !== null) {
    const widthMatch = /(?:^|;)\s*width:\s*([0-9.]+)px/.exec(match[1]);
    if (widthMatch) {
      widths.push(Math.round(Number(widthMatch[1])));
    }
  }
  return widths;
}

describe("plain left-tab columns across a line break (signature block)", () => {
  it("sizes each tab spacer from the measured pre-tab width so both columns land on the stop", () => {
    const html = renderToStaticMarkup(React.createElement(Viewer, { model: buildModel() }));
    const spacers = tabSpacerWidths(html);

    expect(spacers).toHaveLength(2);
    // Column offset = preTabWidth + spacerWidth must equal the tab stop on BOTH
    // lines. preTabWidth is the canvas-measured width (chars * PX_PER_CHAR); the
    // pre-fix heuristic broke this equality on the wider second line.
    expect("AAAA".length * PX_PER_CHAR + spacers[0]).toBe(LEFT_TAB_PX);
    expect("CCCCCCCCCC".length * PX_PER_CHAR + spacers[1]).toBe(LEFT_TAB_PX);
  });
});
