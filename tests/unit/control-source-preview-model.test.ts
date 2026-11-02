import { describe, expect, it } from "vitest";
import {
  cloneDocModel,
  cloneFormFieldSourcePreview,
  cloneParagraphNode,
  invalidateFormFieldSource,
  normalizeDocModel,
  resolveFormFieldSourcePreview,
  type DocModel,
  type FormFieldRunNode,
  type ParagraphNode,
} from "@extend-ai/react-docx-doc-model";
import {
  copyParagraphs,
  parseParagraphsFromClipboard,
  pasteParagraphs,
  serializeParagraphsForClipboard,
  updateParagraphText,
} from "@extend-ai/react-docx-editor-ops";

function field(): FormFieldRunNode {
  return {
    type: "form-field",
    fieldType: "checkbox",
    sourceKind: "legacy",
    checked: true,
    checkedSymbol: "☒",
    uncheckedSymbol: "☐",
    widget: { name: "Selection", checkbox: { defaultChecked: true } },
    sourceXml: '<w:r><w:object><w:control r:id="rId1" w:shapeid="shape1"/></w:object></w:r>',
    sourcePreview: {
      relationshipId: "rId1",
      shapeId: "shape1",
      checked: true,
      image: {
        type: "image",
        src: "data:image/png;base64,AQIDBA==",
        data: new Uint8Array([1, 2, 3, 4]),
        widthPx: 18,
        heightPx: 16,
        contentType: "image/png",
        sourceXml: '<v:shape id="shape1"/>',
        crop: { leftFraction: 0.1 },
        floating: { xPx: 12, yPx: 8, horizontalRelativeTo: "character" },
        contentNodes: [{
          type: "paragraph",
          style: { indent: { leftTwips: 20 } },
          children: [{ type: "image", data: new Uint8Array([5, 6]), alt: "Nested" }],
        }],
      },
    },
  };
}

function model(control = field()): DocModel {
  return {
    nodes: [{
      type: "paragraph",
      children: [control, { type: "text", text: " Choice" }],
    }],
    metadata: { sourceParts: 1, warnings: [], paragraphStyles: [], headerSections: [], footerSections: [] },
  };
}

function control(document: DocModel): FormFieldRunNode {
  const paragraph = document.nodes[0];
  expect(paragraph?.type).toBe("paragraph");
  if (paragraph.type !== "paragraph") throw new Error("Expected a paragraph");
  const run = paragraph.children[0];
  expect(run?.type).toBe("form-field");
  if (run.type !== "form-field") throw new Error("Expected a form field");
  return run;
}

describe("form field source preview", () => {
  it("selects only an unchanged checkbox appearance", () => {
    const original = field();
    expect(resolveFormFieldSourcePreview(original)).toBe(original.sourcePreview?.image);
    expect(resolveFormFieldSourcePreview({ ...original, checked: false })).toBeUndefined();
    expect(resolveFormFieldSourcePreview({ ...original, sourceXml: undefined })).toBeUndefined();
    expect(resolveFormFieldSourcePreview({ ...original, fieldType: "text" })).toBeUndefined();
    expect(resolveFormFieldSourcePreview({ ...original, checked: undefined })).toBe(original.sourcePreview?.image);
    expect(resolveFormFieldSourcePreview({ ...original, sourcePreview: undefined })).toBeUndefined();
  });

  it("requires an associated image source or retained payload", () => {
    const original = field();
    const preview = original.sourcePreview!;
    expect(resolveFormFieldSourcePreview({ ...original, sourcePreview: { ...preview, shapeId: " " } })).toBeUndefined();
    expect(resolveFormFieldSourcePreview({ ...original, sourcePreview: { ...preview, relationshipId: "" } })).toBeUndefined();
    expect(resolveFormFieldSourcePreview({ ...original, sourcePreview: { ...preview, image: { type: "image", src: "", data: new Uint8Array() } } })).toBeUndefined();
    expect(resolveFormFieldSourcePreview({ ...original, sourcePreview: { ...preview, image: { type: "image", data: new Uint8Array([1]) } } })).toBeDefined();
  });

  it("deeply clones preview bytes, placement, and nested image content", () => {
    const original = model();
    const copied = cloneDocModel(original);
    const before = control(original).sourcePreview!;
    const after = control(copied).sourcePreview!;
    expect(after).toEqual(before);
    expect(after).not.toBe(before);
    expect(after.image).not.toBe(before.image);
    after.image.data![0] = 99;
    after.image.floating!.xPx = 100;
    after.image.crop!.leftFraction = 0.8;
    const nested = after.image.contentNodes![0] as ParagraphNode;
    nested.style!.indent!.leftTwips = 70;
    const nestedImage = nested.children[0];
    if (nestedImage.type !== "image") throw new Error("Expected an image");
    nestedImage.data![0] = 100;
    expect(before.image.data![0]).toBe(1);
    expect(before.image.floating!.xPx).toBe(12);
    expect(before.image.crop!.leftFraction).toBe(0.1);
    const oldNested = before.image.contentNodes![0] as ParagraphNode;
    expect(oldNested.style!.indent!.leftTwips).toBe(20);
    const oldNestedImage = oldNested.children[0];
    if (oldNestedImage.type !== "image") throw new Error("Expected an image");
    expect(oldNestedImage.data![0]).toBe(5);
    expect(cloneFormFieldSourcePreview(undefined)).toBeUndefined();
  });

  it("normalizes native preview bytes recursively without changing semantic state", () => {
    const original = model();
    const native = JSON.parse(JSON.stringify(original, (_key, value: unknown) => value instanceof Uint8Array ? Array.from(value) : value)) as DocModel;
    const normalized = normalizeDocModel(native);
    const image = control(normalized).sourcePreview!.image;
    expect(image.data).toBeInstanceOf(Uint8Array);
    const nested = image.contentNodes![0] as ParagraphNode;
    expect(nested.children[0]).toMatchObject({ type: "image", data: new Uint8Array([5, 6]) });
    expect(control(normalized).checked).toBe(true);
    expect(control(normalized).sourceXml).toBe(control(original).sourceXml);
  });

  it("invalidates both retained forms and leaves prior history intact", () => {
    const previous = model();
    const updated = invalidateFormFieldSource({ ...control(previous), checked: false });
    expect(updated.checked).toBe(false);
    expect(updated.sourceXml).toBeUndefined();
    expect(updated.sourcePreview).toBeUndefined();
    expect(resolveFormFieldSourcePreview(control(previous))).toBeDefined();
    const stale = model({ ...control(previous), checked: false });
    const normalized = control(normalizeDocModel(stale));
    expect(normalized.sourceXml).toBeUndefined();
    expect(normalized.sourcePreview).toBeUndefined();
    expect(control(cloneDocModel(model(normalized))).sourcePreview).toBeUndefined();
    expect(control(cloneDocModel(previous)).sourcePreview).toEqual(control(previous).sourcePreview);
  });

  it("invalidates cached ancestor XML when normalized state has changed", () => {
    const stale = model({ ...field(), checked: false });
    const paragraph = stale.nodes[0] as ParagraphNode;
    paragraph.sourceXml = "<w:p/>";
    stale.nodes = [{
      type: "table",
      sourceXml: "<w:tbl/>",
      rows: [{ type: "table-row", cells: [{ type: "table-cell", nodes: [paragraph] }] }],
    }];
    const normalized = normalizeDocModel(stale);
    const table = normalized.nodes[0];
    if (table.type !== "table") throw new Error("Expected a table");
    expect(table.sourceXml).toBeUndefined();
    const nested = table.rows[0].cells[0].nodes[0];
    if (nested.type !== "paragraph") throw new Error("Expected a paragraph");
    expect(nested.sourceXml).toBeUndefined();
    expect(nested.children[0]).toMatchObject({ type: "form-field", checked: false });
    expect((nested.children[0] as FormFieldRunNode).sourceXml).toBeUndefined();
    expect(paragraph.sourceXml).toBe("<w:p/>");
  });

  it("drops an unusable optional preview while preserving unchanged export XML", () => {
    const original = field();
    const sourceXml = original.sourceXml;
    const variants = [
      { ...original.sourcePreview!, shapeId: "" },
      { ...original.sourcePreview!, relationshipId: "" },
      { ...original.sourcePreview!, image: { type: "image" as const } },
    ];
    for (const sourcePreview of variants) {
      const document = model({ ...original, sourcePreview });
      const paragraph = document.nodes[0] as ParagraphNode;
      paragraph.sourceXml = "<w:p/>";
      const normalized = normalizeDocModel(document);
      expect(control(normalized).sourcePreview).toBeUndefined();
      expect(control(normalized).sourceXml).toBe(sourceXml);
      expect((normalized.nodes[0] as ParagraphNode).sourceXml).toBe("<w:p/>");
      const parsed = parseParagraphsFromClipboard(serializeParagraphsForClipboard([paragraph]))!;
      expect((parsed[0].children[0] as FormFieldRunNode).sourceXml).toBe(sourceXml);
      expect((parsed[0].children[0] as FormFieldRunNode).sourcePreview).toBeUndefined();
      expect(parsed[0].sourceXml).toBe("<w:p/>");
    }
  });

  it("retains usable preview data across clipboard copy, paste, and adjacent text edits", () => {
    const original = model();
    const copied = copyParagraphs(original, 0);
    const payload = serializeParagraphsForClipboard(copied);
    const serialized = JSON.parse(payload);
    expect(serialized[0].children[0].sourcePreview.image.data).toEqual([1, 2, 3, 4]);
    const parsed = parseParagraphsFromClipboard(payload)!;
    expect(parsed).toHaveLength(1);
    const pasted = pasteParagraphs(original, 0, parsed);
    const preview = control(pasted).sourcePreview!;
    expect(preview).toEqual(control(original).sourcePreview);
    expect(preview.image.data).not.toBe(control(original).sourcePreview!.image.data);
    const edited = updateParagraphText(original, 0, "☒ Updated choice");
    expect(control(edited).sourcePreview).toEqual(control(original).sourcePreview);
    expect(control(edited).checked).toBe(true);
  });

  it("does not resurrect a stale clipboard preview or alter fields without previews", () => {
    const original = field();
    const paragraph = model(original).nodes[0] as ParagraphNode;
    const serialized = JSON.parse(serializeParagraphsForClipboard([paragraph]));
    serialized[0].children[0].checked = false;
    const parsed = parseParagraphsFromClipboard(JSON.stringify(serialized))!;
    const stale = parsed[0].children[0] as FormFieldRunNode;
    expect(stale.sourceXml).toBeUndefined();
    expect(stale.sourcePreview).toBeUndefined();
    const plain: FormFieldRunNode = { type: "form-field", fieldType: "checkbox", checked: false, sourceXml: "<w:r/>" };
    const normalized = control(normalizeDocModel(model(plain)));
    expect(normalized).toEqual(plain);
    expect(cloneParagraphNode({ type: "paragraph", children: [plain] }).children[0]).toMatchObject(plain);
  });
});
