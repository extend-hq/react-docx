import { describe, expect, it } from "vitest";
import type { DocModel, ParagraphNode } from "../../packages/doc-model/src";
import {
  updateParagraphText,
  updateTableCellParagraphText,
} from "../../packages/editor-ops/src";
import {
  buildDocumentPageNodeSegments,
  createTextEditPaginationMemo,
} from "../../packages/react-viewer/src/editor";
import { invalidateFontMetrics } from "../../packages/react-viewer/src/font-metrics";

const paragraph = (text: string): ParagraphNode => ({
  type: "paragraph",
  children: [
    { type: "text", text, style: { fontFamily: "Arial", fontSizePt: 11 } },
  ],
});
const document = (): DocModel => ({
  nodes: Array.from({ length: 18 }, () =>
    paragraph("A paragraph with ordinary body text.")
  ),
  metadata: { warnings: [], sourceParts: 0 },
});

describe("incremental text pagination", () => {
  it("reuses unchanged page structure while preserving the edited model", () => {
    const paginate = createTextEditPaginationMemo();
    const model = document();
    const before = paginate(model, 300, 500);
    const edited = updateParagraphText(
      model,
      2,
      "An updated paragraph with ordinary body text."
    );
    expect(paginate(edited, 300, 500)).toBe(before);
    expect(before).toEqual(buildDocumentPageNodeSegments(edited, 300, 500));
    expect(edited.nodes[2]).not.toBe(model.nodes[2]);
  });

  it("matches full pagination through typing, line wrapping, and deletion", () => {
    const paginate = createTextEditPaginationMemo();
    let model = document();
    paginate(model, 160, 180);
    for (const text of [
      "x",
      ...Array.from({ length: 24 }, (_, i) => "new words ".repeat(i + 1)),
      "short",
      "",
      " ",
      "two\nlines",
      "tab\tstop",
    ]) {
      model = updateParagraphText(model, 4, text);
      expect(paginate(model, 160, 180)).toEqual(
        buildDocumentPageNodeSegments(model, 160, 180)
      );
    }
  });

  it("invalidates geometry, formatting, and font measurements", () => {
    const paginate = createTextEditPaginationMemo();
    const model = document();
    const original = paginate(model, 160, 180);
    const enlarged: DocModel = { ...model, nodes: [...model.nodes] };
    enlarged.nodes[3] = {
      ...paragraph("A paragraph with ordinary body text."),
      style: { pageBreakBefore: true, keepNext: true },
    };
    expect(paginate(enlarged, 160, 180)).toEqual(
      buildDocumentPageNodeSegments(enlarged, 160, 180)
    );
    expect(paginate(model, 250, 300)).toEqual(
      buildDocumentPageNodeSegments(model, 250, 300)
    );
    const beforeFontChange = paginate(model, 160, 180);
    expect(beforeFontChange).toEqual(original);
    invalidateFontMetrics();
    expect(paginate(model, 160, 180)).not.toBe(beforeFontChange);
    expect(paginate(model, 160, 180)).toEqual(
      buildDocumentPageNodeSegments(model, 160, 180)
    );
  });

  it("fully paginates edits to table cells and documents with wrapped objects", () => {
    const paginate = createTextEditPaginationMemo();
    const model = document();
    model.nodes[2] = {
      type: "table",
      rows: [
        {
          type: "table-row",
          cells: [{ type: "table-cell", nodes: [paragraph("Table text")] }],
        },
      ],
    };
    paginate(model, 160, 180);
    const edited = updateTableCellParagraphText(
      model,
      2,
      0,
      0,
      0,
      "Table text ".repeat(30)
    );
    expect(paginate(edited, 160, 180)).toEqual(
      buildDocumentPageNodeSegments(edited, 160, 180)
    );
    const floating = document();
    (floating.nodes[0] as ParagraphNode).children.unshift({
      type: "image",
      widthPx: 50,
      heightPx: 50,
      floating: { wrapType: "square" },
    });
    const first = paginate(floating, 160, 180);
    expect(paginate(floating, 160, 180)).not.toBe(first);
  });
});
