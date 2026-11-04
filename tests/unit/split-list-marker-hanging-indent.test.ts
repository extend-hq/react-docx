import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import type { DocModel, NumberingDefinitionSet } from "@extend-ai/react-docx-doc-model";
import {
  DocxEditorViewer,
  useDocxEditor,
} from "../../packages/react-viewer/src/editor";

// The pretext layout (which drives the split-segment render path this test
// covers) measures text via OffscreenCanvas. Under Vitest's node environment
// there is no canvas, so provide a deterministic proportional-width stub; without
// it the split falls back to the inline clip path and the pretext code is never
// exercised.
beforeAll(() => {
  const makeContext = () => ({
    font: "",
    measureText: (text: string) => ({ width: text.length * 7 }),
  });
  (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas =
    class {
      getContext() {
        return makeContext();
      }
    };
});

// Regression test for the hanging-indent list marker on page-split paragraphs.
//
// When a numbered/lettered list item with a hanging indent is split across a
// page boundary, it is rendered via the absolutely-positioned "pretext" path.
// Two bugs made that segment render wrong:
//   1. the marker used `justify-content: flex-end`, pinning the glyph onto the
//      body text (marker overlapped the first word);
//   2. the block's `text-indent: -hanging` (used by the inline path) leaked onto
//      the absolutely-positioned segment and shifted the whole thing left by the
//      hanging amount, dropping the paragraph's left indent.
// The fix flex-starts the split marker and zeroes the text-indent on pretext
// split segments (see extend-hq/react-docx#10 / #11).

const NUMBERING: NumberingDefinitionSet = {
  abstracts: [
    {
      abstractNumId: 0,
      levels: [
        {
          ilvl: 0,
          format: "decimal",
          text: "(%1)",
          suffix: "tab",
          indent: { leftTwips: 720, hangingTwips: 720 },
        },
      ],
    },
  ],
  instances: [{ numId: 1, abstractNumId: 0 }],
};

const SENTENCE =
  "In the event that the transaction contemplated by this Agreement is not " +
  "consummated, neither you nor your Representatives shall, without the prior " +
  "written consent of the Company, use any of the Evaluation Material for any " +
  "purpose at any time, and you shall promptly return or destroy all copies, " +
  "extracts, and other materials containing or reflecting any Evaluation Material. ";

// Each item is long enough to be TALLER than a page, which forces an
// intra-paragraph split. Once a numbered paragraph is split, its start-line-0
// segment (the one carrying the marker) renders via the absolutely-positioned
// pretext path — the code path this regression covers.
const ITEM_TEXT = SENTENCE.repeat(16);

function buildNumberedListModel(itemCount: number, text = ITEM_TEXT): DocModel {
  return {
    nodes: Array.from({ length: itemCount }, () => ({
      type: "paragraph" as const,
      style: { numbering: { numId: 1, ilvl: 0 } },
      children: [{ type: "text" as const, text }],
    })),
    metadata: {
      sourceParts: 1,
      warnings: [],
      headerSections: [],
      footerSections: [],
      paragraphStyles: [],
      numberingDefinitions: NUMBERING,
    },
  };
}

function NumberedListViewer({ model, showTrackedChanges }: { model: DocModel; showTrackedChanges?: boolean }): React.JSX.Element {
  const editor = useDocxEditor({ starterModel: model });
  return React.createElement(DocxEditorViewer, { editor, mode: "read-only", showTrackedChanges });
}

function renderList(itemCount: number): string {
  return renderToStaticMarkup(
    React.createElement(NumberedListViewer, { model: buildNumberedListModel(itemCount) })
  );
}

describe("split hanging-indent list marker", () => {
  it("splits a long numbered list across a page boundary (test precondition)", () => {
    const html = renderList(3);
    expect(html).toContain('data-docx-paragraph-partial-line-range="true"');
    // The split segment renders numbering marker(s) via the pretext path.
    expect(html).toContain('data-docx-numbering-label="true"');
  });

  it("places the split-segment marker at the number position (flex-start), not on the text", () => {
    const html = renderList(3);
    // Only the pretext split marker is flex-start; the inline (non-split) marker
    // stays flex-end. Its presence proves the split marker is no longer pinned
    // onto the body text.
    expect(html).toMatch(
      /data-docx-numbering-label="true"[^>]*justify-content:flex-start/
    );
  });

  it("keeps the paragraph left indent on the split segment (text-indent zeroed)", () => {
    const html = renderList(3);
    // The pretext split host zeroes the leaked hanging text-indent so the
    // absolutely-positioned segment stays at the paragraph's left indent.
    // (React serializes the numeric 0 as `text-indent:0`, no unit.) Before the
    // fix every split host carried the negative hanging text-indent instead.
    expect(html).toMatch(
      /data-docx-paragraph-partial-line-range="true"[^>]*text-indent:0(?![.\d])/
    );
  });
});

it.each([false, true])("identifies inline list labels with tracked changes set to %s", (showTrackedChanges) => {
  const html = renderToStaticMarkup(React.createElement(NumberedListViewer, {
    model: buildNumberedListModel(1, "Item"),
    showTrackedChanges,
  }));
  expect(html).toMatch(/<span[^>]*data-docx-numbering-label="true"[^>]*>\(1\)/);
});
