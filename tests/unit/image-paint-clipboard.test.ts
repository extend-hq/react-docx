import { describe, expect, it } from "vitest";
import { ensureDocModelBlockIds, type DocModel, type ImageRunNode, type ParagraphNode, type TableCellContentNode } from "@extend-ai/react-docx-doc-model";
import {
  parseParagraphsFromClipboard,
  pasteParagraphs,
  serializeParagraphsForClipboard,
  splitParagraphChildrenAtTextOffsets,
} from "@extend-ai/react-docx-editor-ops";

function image(): ImageRunNode {
  return {
    type: "image",
    widthPx: 360,
    heightPx: 140,
    paintBounds: {
      xPx: -0.5,
      yPx: 0,
      widthPx: 361,
      heightPx: 140,
      layoutWidthPx: 360,
      layoutHeightPx: 140,
    },
    src: 'data:image/svg+xml,%3Csvg%3E%3Cimage%20href="data:image/png;base64,AQID"/%3E%3C/svg%3E',
    contentType: "image/svg+xml",
    data: new Uint8Array([1, 2, 3]),
    sourceXml: '<w:r><w:pict><v:group><v:shape><v:textbox><w:txbxContent><w:p><w:r><w:t>First</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></v:group></w:pict></w:r>',
    syntheticTextBox: true,
    contentNodes: [
      { type: "paragraph", children: [{ type: "text", text: "First", style: { bold: true } }] },
      { type: "paragraph", children: [{ type: "text", text: "Second" }] },
    ],
  };
}

function paragraph(run: ImageRunNode): ParagraphNode {
  return { type: "paragraph", children: [run] };
}

function pastedImage(run: ImageRunNode): ImageRunNode {
  const parsed = parseParagraphsFromClipboard(serializeParagraphsForClipboard([paragraph(run)]));
  expect(parsed).toHaveLength(1);
  const child = parsed![0].children[0];
  expect(child.type).toBe("image");
  return child as ImageRunNode;
}

describe("image paint clipboard geometry", () => {
  it("retains independent geometry and payloads when splitting around an image", () => {
    const original = image();
    const source: ParagraphNode = {
      type: "paragraph",
      children: [{ type: "text", text: "A" }, original, { type: "text", text: "B" }],
    };
    const split = splitParagraphChildrenAtTextOffsets(source, "AB", 1, 1);
    const copied = [...split.beforeChildren, ...split.afterChildren].find((run) => run.type === "image") as ImageRunNode;
    expect(copied).toEqual(original);
    expect(copied.paintBounds).not.toBe(original.paintBounds);
    expect(copied.contentNodes).not.toBe(original.contentNodes);
    expect(copied.data).not.toBe(original.data);
    copied.paintBounds!.xPx = -1;
    expect(original.paintBounds!.xPx).toBe(-0.5);
  });

  it("round-trips story data, source XML, and the bitmap payload with paint geometry", () => {
    const original = image();
    const copied = pastedImage(original);
    expect(copied).toEqual(original);
    expect(copied.data).toBeInstanceOf(Uint8Array);
    expect(copied.contentNodes).toHaveLength(2);
    expect(copied.sourceXml).toBe(original.sourceXml);
    expect(copied.floating).toBeUndefined();
    copied.paintBounds!.widthPx = 400;
    expect(original.paintBounds!.widthPx).toBe(361);
  });

  it("retains reference geometry after layout dimensions change", () => {
    const original = { ...image(), widthPx: 720, heightPx: 280 };
    const copied = pastedImage(original);
    expect(copied.widthPx).toBe(720);
    expect(copied.heightPx).toBe(280);
    expect(copied.paintBounds).toEqual(image().paintBounds);
  });

  it("rehydrates embedded story image bytes without losing paint geometry", () => {
    const original = image();
    original.contentNodes = [{
      type: "paragraph",
      children: [{ type: "image", data: new Uint8Array([4, 5, 6]), widthPx: 12, heightPx: 8 }],
    }];
    const copied = pastedImage(original);
    const story = copied.contentNodes![0];
    expect(story.type).toBe("paragraph");
    if (story.type !== "paragraph") throw new Error("Missing paragraph");
    const asset = story.children[0];
    expect(asset.type).toBe("image");
    if (asset.type !== "image") throw new Error("Missing image");
    expect(asset.data).toBeInstanceOf(Uint8Array);
    expect(asset.data).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("regenerates copied measurement identities without changing source identifiers", () => {
    const original = image();
    original.blockId = "original-image";
    original.contentNodes = [{
      type: "table",
      blockId: "original-table",
      rows: [{
        type: "table-row",
        cells: [{
          type: "table-cell",
          nodes: [{
            type: "paragraph",
            blockId: "original-story",
            children: [{ type: "image", blockId: "original-nested-image", widthPx: 12, heightPx: 8 }],
          }],
        }],
      }],
    }];
    const model: DocModel = {
      nodes: [paragraph(original)],
      metadata: { sourceParts: 1, warnings: [], headerSections: [], footerSections: [], paragraphStyles: [] },
    };
    ensureDocModelBlockIds(model);
    const parsed = parseParagraphsFromClipboard(serializeParagraphsForClipboard(model.nodes as ParagraphNode[]))!;
    const pasted = ensureDocModelBlockIds(pasteParagraphs(model, 1, parsed));
    const ids: string[] = [];
    const visitImage = (run: ImageRunNode): void => {
      expect(run.blockId).toBeDefined();
      ids.push(run.blockId!);
      run.contentNodes?.forEach(visit);
    };
    const visit = (node: TableCellContentNode): void => {
      expect(node.blockId).toBeDefined();
      ids.push(node.blockId!);
      if (node.type === "paragraph") {
        for (const run of node.children) if (run.type === "image") visitImage(run);
      } else {
        for (const row of node.rows) for (const cell of row.cells) cell.nodes.forEach(visit);
      }
    };
    pasted.nodes.forEach(visit);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(ids.length);
    const copiedParagraph = pasted.nodes[1] as ParagraphNode;
    const copied = copiedParagraph.children[0] as ImageRunNode;
    expect(copied.sourceXml).toBe(original.sourceXml);
    expect(copied.paintBounds).toEqual(original.paintBounds);
    expect(original.blockId).toBe("original-image");
  });

  it.each([
    ["xPx", Number.POSITIVE_INFINITY],
    ["yPx", Number.NaN],
    ["widthPx", 0],
    ["heightPx", -1],
    ["layoutWidthPx", 0],
    ["layoutHeightPx", Number.POSITIVE_INFINITY],
  ] as const)("rejects invalid %s rather than discarding geometry", (field, value) => {
    const original = image();
    original.paintBounds![field] = value;
    expect(parseParagraphsFromClipboard(serializeParagraphsForClipboard([paragraph(original)]))).toBeUndefined();
  });

  it("does not add paint geometry to images without it", () => {
    const original: ImageRunNode = { type: "image", src: "data:image/png;base64,AQID", widthPx: 12, heightPx: 8 };
    const payload = serializeParagraphsForClipboard([paragraph(original)]);
    expect(payload).not.toContain("paintBounds");
    expect(pastedImage(original).paintBounds).toBeUndefined();
  });
});
