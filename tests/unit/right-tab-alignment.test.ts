import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DocModel } from "@extend-ai/react-docx-doc-model";
import { DocxEditorViewer, useDocxEditor } from "../../packages/react-viewer/src/editor";

// Deterministic canvas metrics (20px per character) stand in for the width the
// browser lays text out at, so the tab-spacer arithmetic is exact and testable.
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

const LEFT_TAB_TWIPS = 5760; // 384px
const RIGHT_TAB_TWIPS = 9240; // 616px
const LEFT_TAB_PX = 384;
const RIGHT_TAB_PX = 616;

// left + right stops with two tabs (three segments) render through the plain-tab
// path ("none" anchored layout). The segment after the RIGHT tab should
// right-align so it ends at the right stop — this is the signature-block case
// (extend-hq/react-docx#15). A single right tab instead hits the dedicated
// "right" anchored layout, so we deliberately use two tabs here.
function buildModel(trailer: string): DocModel {
  return {
    nodes: [
      {
        type: "paragraph",
        style: {
          tabStops: [
            { alignment: "left", positionTwips: LEFT_TAB_TWIPS },
            { alignment: "right", positionTwips: RIGHT_TAB_TWIPS },
          ],
        },
        children: [
          { type: "text", text: "AA" }, // 40px
          { type: "text", text: "\t" },
          { type: "text", text: "BB" }, // 40px -> lands at left stop 384, ends 424
          { type: "text", text: "\t" },
          { type: "text", text: trailer },
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
  const widths: number[] = [];
  const re = /data-docx-tab-char="true"[^>]*style="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const w = /(?:^|;)\s*width:\s*([0-9.]+)px/.exec(match[1]);
    if (w) {
      widths.push(Math.round(Number(w[1])));
    }
  }
  return widths;
}

describe("right tab-stop alignment (plain-tab path, left+right stops)", () => {
  it("right-aligns a fitting trailer so it ends at the right stop", () => {
    const trailer = "CC"; // 40px, fits before the right stop
    const html = renderToStaticMarkup(
      React.createElement(Viewer, { model: buildModel(trailer) })
    );
    const spacers = tabSpacerWidths(html);
    expect(spacers).toHaveLength(2);
    // First tab left-aligns "BB" at the left stop.
    expect("AA".length * PX_PER_CHAR + spacers[0]).toBe(LEFT_TAB_PX);
    // Second tab right-aligns the trailer to END at the right stop:
    // widthBeforeSecondTab(424) + spacer + trailer must equal the right stop.
    const beforeSecondTabPx = LEFT_TAB_PX + "BB".length * PX_PER_CHAR; // 384 + 40
    const trailerPx = trailer.length * PX_PER_CHAR;
    expect(beforeSecondTabPx + spacers[1] + trailerPx).toBe(RIGHT_TAB_PX);
  });

  it("degrades to left-advance when the trailer cannot fit before the right stop", () => {
    const trailer = "Z".repeat(40); // 800px, far wider than the remaining gap
    const html = renderToStaticMarkup(
      React.createElement(Viewer, { model: buildModel(trailer) })
    );
    const spacers = tabSpacerWidths(html);
    expect(spacers).toHaveLength(2);
    const beforeSecondTabPx = LEFT_TAB_PX + "BB".length * PX_PER_CHAR; // 424
    // Falls back to the plain left gap to the right stop, not gap - trailer.
    expect(spacers[1]).toBe(RIGHT_TAB_PX - beforeSecondTabPx); // 192
  });
});
