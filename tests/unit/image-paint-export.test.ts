import { describe, expect, it, vi } from "vitest";
import type { DocModel, ImagePaintRect, ImageRunNode, ParagraphNode, TableNode } from "@extend-ai/react-docx-doc-model";
import { prepareImagePaintBoundsForExport } from "../../packages/react-viewer/src/image-paint-export";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
function image(): ImageRunNode {
  return {
    type: "image", widthPx: 360, heightPx: 140,
    paintBounds: { xPx: -0.5, yPx: 0, widthPx: 361, heightPx: 140, layoutWidthPx: 360, layoutHeightPx: 140 },
    src: "data:image/svg+xml,%3Csvg%2F%3E", sourceXml: "<w:pict/>",
    contentNodes: [{ type: "paragraph", children: [{ type: "text", text: "Current story" }] }],
    syntheticTextBox: true, textBoxText: "Current story", contentType: "image/svg+xml",
    data: new Uint8Array([1, 2]), partName: "media/old.svg",
  };
}
const paragraph = (child: ImageRunNode): ParagraphNode => ({ type: "paragraph", sourceXml: "<w:p/>", children: [child], sourceTextPatch: { runs: [] }, sourceRunProvenance: { runs: [] } });
const model = (child = image()): DocModel => ({ nodes: [paragraph(child)], metadata: { sourceParts: 1, warnings: [], headerSections: [], footerSections: [], paragraphStyles: [] } });
const fallback = { canPreserveSource: async () => false, rasterize: async () => png };
function first(document: DocModel): ImageRunNode { return (document.nodes[0] as ParagraphNode).children[0] as ImageRunNode; }

describe("image paint export preparation", () => {
  it("preserves eligible source stories and never calls the rasterizer", async () => {
    const source = model();
    const rasterize = vi.fn(async (_image: ImageRunNode, _bounds: ImagePaintRect) => png);
    const output = await prepareImagePaintBoundsForExport(source, undefined, { canPreserveSource: async () => true, rasterize });
    expect(output).toEqual(source);
    expect(output).not.toBe(source);
    expect(first(output).sourceXml).toBe("<w:pict/>");
    expect(first(output).contentNodes).toHaveLength(1);
    expect(rasterize).not.toHaveBeenCalled();
  });
  it("rasterizes a clone and invalidates source replay while preserving live state", async () => {
    const source = model();
    const before = JSON.stringify(source);
    const output = await prepareImagePaintBoundsForExport(source, undefined, fallback);
    expect(JSON.stringify(source)).toBe(before);
    expect(first(output).src).toBe(png);
    expect(first(output).contentType).toBe("image/png");
    for (const key of ["partName", "data", "sourceXml", "contentNodes", "syntheticTextBox", "textBoxText"]) expect(first(output)).not.toHaveProperty(key);
    expect(output.nodes[0]).not.toHaveProperty("sourceXml");
    expect(output.nodes[0]).not.toHaveProperty("sourceTextPatch");
    expect(output.nodes[0]).not.toHaveProperty("sourceRunProvenance");
  });
  it.each([[720, 70, -1, 722, 70], [180, 35, -0.25, 180.5, 35]])("normalizes continuous paint geometry after resize %s by %s", async (width, height, x, paintWidth, paintHeight) => {
    const source = model({ ...image(), widthPx: width, heightPx: height });
    const rasterize = vi.fn(async (_image: ImageRunNode, _bounds: ImagePaintRect) => png);
    const output = await prepareImagePaintBoundsForExport(source, undefined, { ...fallback, rasterize });
    expect(rasterize.mock.calls[0][1]).toEqual({ xPx: x, yPx: 0, widthPx: paintWidth, heightPx: paintHeight });
    expect(first(output).paintBounds).toEqual({ xPx: x, yPx: 0, widthPx: paintWidth, heightPx: paintHeight, layoutWidthPx: width, layoutHeightPx: height });
    expect(first(source).paintBounds!.layoutWidthPx).toBe(360);
  });
  it("takes its snapshot before awaiting the source guard", async () => {
    const source = model();
    let complete!: (preserve: boolean) => void;
    const pending = prepareImagePaintBoundsForExport(source, undefined, { canPreserveSource: () => new Promise((resolve) => { complete = resolve; }), rasterize: async () => png });
    first(source).widthPx = 999;
    first(source).paintBounds!.xPx = -99;
    complete(true);
    expect(first(await pending).widthPx).toBe(360);
    expect(first(await pending).paintBounds!.xPx).toBe(-0.5);
  });
  it("invalidates all containing table sources", async () => {
    const child = paragraph(image());
    const inner: TableNode = { type: "table", sourceXml: "<w:tbl/>", rows: [{ type: "table-row", cells: [{ type: "table-cell", nodes: [child] }] }] };
    const outer: TableNode = { type: "table", sourceXml: "<w:tbl/>", rows: [{ type: "table-row", cells: [{ type: "table-cell", nodes: [inner] }] }] };
    const source = model(); source.nodes = [outer];
    const result = await prepareImagePaintBoundsForExport(source, undefined, fallback);
    const out = result.nodes[0] as TableNode;
    expect(out.sourceXml).toBeUndefined();
    expect((out.rows[0].cells[0].nodes[0] as TableNode).sourceXml).toBeUndefined();
    expect(outer.sourceXml).toBe("<w:tbl/>");
  });
  it("matches first-part-wins owner normalization for section stories", async () => {
    const source = model(); source.nodes = [];
    source.metadata.headerSections = [{ partName: "/word/header1.xml", nodes: [paragraph(image())] }];
    source.metadata.footerSections = [{ partName: "word/footer1.xml", nodes: [paragraph(image())] }];
    source.metadata.sections = [{ startNodeIndex: 0, headerSections: [{ partName: "word/header1.xml", nodes: [paragraph(image())] }, { partName: "//word/header2.xml", nodes: [paragraph(image())] }], footerSections: [] }];
    const owners: Array<string | undefined> = [];
    await prepareImagePaintBoundsForExport(source, undefined, { canPreserveSource: async (_image, _base, owner) => { owners.push(owner); return false; }, rasterize: async () => png });
    expect(owners).toEqual(["word/header1.xml", "word/footer1.xml", "/word/header2.xml"]);
  });
  it("skips empty normalized header and footer parts", async () => {
    const source = model(); source.nodes = [];
    source.metadata.headerSections = [{ partName: "", nodes: [paragraph(image())] }];
    source.metadata.footerSections = [{ partName: "/", nodes: [paragraph(image())] }];
    const preserve = vi.fn(async () => false);
    expect(await prepareImagePaintBoundsForExport(source, undefined, { canPreserveSource: preserve })).toBe(source);
    expect(preserve).not.toHaveBeenCalled();
  });
  it("rejects invalid metadata before calling asynchronous source or raster code", async () => {
    const source = model(); first(source).paintBounds!.widthPx = Number.NaN;
    const preserve = vi.fn(async () => false);
    const rasterize = vi.fn(async (_image: ImageRunNode, _bounds: ImagePaintRect) => png);
    await expect(prepareImagePaintBoundsForExport(source, undefined, { canPreserveSource: preserve, rasterize })).rejects.toThrow("invalid");
    expect(preserve).not.toHaveBeenCalled(); expect(rasterize).not.toHaveBeenCalled();
  });
  it("propagates raster failures and leaves the original model unchanged", async () => {
    const source = model();
    await expect(prepareImagePaintBoundsForExport(source, undefined, { ...fallback, rasterize: async () => { throw new Error("decode failed"); } })).rejects.toThrow("decode failed");
    expect(first(source).sourceXml).toBe("<w:pict/>");
  });
  it("rejects fallback under a nonserialized nested image projection", async () => {
    const outer = image(); delete outer.paintBounds;
    outer.contentNodes = [paragraph(image())];
    await expect(prepareImagePaintBoundsForExport(model(outer), undefined, fallback)).rejects.toThrow("nested image stories");
  });
  it("preserves ignored note and comment projections without rasterizing them", async () => {
    for (const kind of ["footnotes", "endnotes", "comments"] as const) {
      const source = model(); source.nodes = [];
      source.metadata[kind] = [{ id: 1, text: "Text", nodes: [paragraph(image())] }];
      const rasterize = vi.fn(async (_image: ImageRunNode, _bounds: ImagePaintRect) => png);
      expect(await prepareImagePaintBoundsForExport(source, undefined, { ...fallback, rasterize })).toBe(source);
      expect(rasterize).not.toHaveBeenCalled();
    }
  });
  it("does not initialize raster or source guards for images without paint metadata", async () => {
    const child = image(); delete child.paintBounds; delete child.contentNodes;
    const source = model(child); const preserve = vi.fn(async () => false);
    expect(await prepareImagePaintBoundsForExport(source, undefined, { canPreserveSource: preserve })).toBe(source);
    expect(preserve).not.toHaveBeenCalled();
  });
});
