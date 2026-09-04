import { describe, expect, it } from "vitest";
import type {
  DocModel,
  ParagraphNode,
  TableNode,
} from "@extend-ai/react-docx-doc-model";
import {
  copyModelForParagraphEdits,
  imageDropPositionAtTextOffset,
  insertImageAtDropPosition,
} from "../../packages/react-viewer/src/image-drop";

const image = { type: "image" as const, widthPx: 40, heightPx: 30 };

describe("image drop positions", () => {
  it("splits a text run at the caret while retaining formatting and links", () => {
    const paragraph: ParagraphNode = {
      type: "paragraph",
      children: [
        {
          type: "text",
          text: "alpha beta",
          style: { bold: true },
          link: "https://example.org",
        },
      ],
    };
    const target = imageDropPositionAtTextOffset(paragraph, 6);
    expect(target).toEqual({ childIndex: 0, textOffset: 6 });
    expect(
      insertImageAtDropPosition(
        paragraph,
        image,
        target.childIndex,
        target.textOffset
      )
    ).toBe(1);
    expect(paragraph.children).toEqual([
      {
        type: "text",
        text: "alpha ",
        style: { bold: true },
        link: "https://example.org",
      },
      image,
      {
        type: "text",
        text: "beta",
        style: { bold: true },
        link: "https://example.org",
      },
    ]);
  });

  it("uses DOM text offsets without counting floating or inline images", () => {
    const paragraph: ParagraphNode = {
      type: "paragraph",
      children: [
        image,
        { ...image, floating: { wrapType: "square" } },
        { type: "text", text: "first second" },
      ],
    };
    expect(imageDropPositionAtTextOffset(paragraph, 6)).toEqual({
      childIndex: 2,
      textOffset: 6,
    });
  });

  it("inserts at either run boundary without adding empty text runs", () => {
    for (const offset of [0, 4]) {
      const paragraph: ParagraphNode = {
        type: "paragraph",
        children: [{ type: "text", text: "text" }],
      };
      insertImageAtDropPosition(paragraph, image, 0, offset);
      expect(paragraph.children).toHaveLength(2);
      expect(paragraph.children[offset === 0 ? 0 : 1]).toBe(image);
    }
  });

  it("treats fields as atomic while allowing a drop after them", () => {
    const paragraph: ParagraphNode = {
      type: "paragraph",
      children: [
        { type: "form-field", fieldType: "text", value: "value" },
        { type: "text", text: " tail" },
      ],
    };
    expect(imageDropPositionAtTextOffset(paragraph, 2)).toEqual({
      childIndex: 1,
    });
    expect(imageDropPositionAtTextOffset(paragraph, 7)).toEqual({
      childIndex: 1,
      textOffset: 2,
    });
  });

  it("supports insertion in empty paragraphs and beyond the last run", () => {
    const paragraph: ParagraphNode = { type: "paragraph", children: [] };
    expect(imageDropPositionAtTextOffset(paragraph, 100)).toEqual({
      childIndex: 0,
    });
    insertImageAtDropPosition(paragraph, image, 100);
    expect(paragraph.children).toEqual([image]);
  });
});

describe("image move structural sharing", () => {
  const paragraph = (): ParagraphNode => ({
    type: "paragraph",
    children: [{ type: "text", text: "text" }],
  });

  it("preserves untouched layout identities and the previous paragraph contents", () => {
    const model: DocModel = {
      nodes: [paragraph(), paragraph(), paragraph()],
      metadata: { warnings: [] },
    };
    const before = structuredClone(model);
    const next = copyModelForParagraphEdits(model, [
      { kind: "paragraph", nodeIndex: 0 },
      { kind: "paragraph", nodeIndex: 1 },
      { kind: "paragraph", nodeIndex: 0 },
    ]);
    insertImageAtDropPosition(next.nodes[0] as ParagraphNode, image, 0, 2);
    expect(model).toEqual(before);
    expect(next.nodes[0]).not.toBe(model.nodes[0]);
    expect(next.nodes[1]).not.toBe(model.nodes[1]);
    expect(next.nodes[2]).toBe(model.nodes[2]);
    expect(next.metadata).toBe(model.metadata);
  });

  it("copies both edited paths in a shared table without changing other cells", () => {
    const table: TableNode = {
      type: "table",
      rows: [
        {
          type: "table-row",
          cells: Array.from({ length: 3 }, () => ({
            type: "table-cell",
            nodes: [paragraph(), paragraph()],
          })),
        },
      ],
    };
    const model: DocModel = {
      nodes: [table, paragraph()],
      metadata: { warnings: [] },
    };
    const before = structuredClone(model);
    const next = copyModelForParagraphEdits(model, [
      {
        kind: "table-cell",
        tableIndex: 0,
        rowIndex: 0,
        cellIndex: 0,
        paragraphIndex: 0,
      },
      {
        kind: "table-cell",
        tableIndex: 0,
        rowIndex: 0,
        cellIndex: 1,
        paragraphIndex: 0,
      },
      {
        kind: "table-cell",
        tableIndex: 0,
        rowIndex: 0,
        cellIndex: 0,
        paragraphIndex: 1,
      },
    ]);
    const movedTable = next.nodes[0] as TableNode;
    for (const cellIndex of [0, 1]) {
      insertImageAtDropPosition(
        movedTable.rows[0].cells[cellIndex].nodes[0] as ParagraphNode,
        image,
        0
      );
    }
    expect(model).toEqual(before);
    expect(movedTable.rows[0].cells[0].nodes[1]).not.toBe(
      table.rows[0].cells[0].nodes[1]
    );
    expect(movedTable.rows[0].cells[1].nodes[1]).toBe(
      table.rows[0].cells[1].nodes[1]
    );
    expect(movedTable.rows[0].cells[2]).toBe(table.rows[0].cells[2]);
    expect(next.nodes[1]).toBe(model.nodes[1]);
  });
});
