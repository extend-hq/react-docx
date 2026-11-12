import * as React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildDocModelFromBytes,
  cloneDocModel,
  extractDocumentReview,
  isOpenDocumentBlockId,
  isOpenDocumentModel,
  type DocModel,
  type DocNode,
  type ImageRunNode,
  type ParagraphNode,
  type TableNode,
} from "@extend-ai/react-docx-doc-model";
import { layoutDocument } from "@extend-ai/react-docx-layout-engine";
import { parseDocx } from "@extend-ai/react-docx-ooxml-core";
import {
  DocxEditorViewer,
  defaultStarterModel,
  useDocxEditor,
  type DocxEditorController,
} from "../../packages/react-viewer/src/editor";
import { ReactDocxViewer } from "../../packages/react-viewer/src/index";
import { parseDocxForViewer } from "../../packages/react-viewer/src/parsed-docx";
import {
  OPEN_DOCUMENT_VIEW_ONLY_REASON,
  isSupportedDocumentFileName,
} from "../../packages/react-viewer/src/word-formats";

const FIXTURES = path.resolve(__dirname, "../fixtures/opendocument");
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURES, name)));
}

function paragraphText(paragraph: ParagraphNode): string {
  return paragraph.children
    .map((child) => (child.type === "text" ? child.text : ""))
    .join("");
}

function paragraphs(nodes: DocNode[]): ParagraphNode[] {
  return nodes.flatMap((node) =>
    node.type === "paragraph"
      ? [node]
      : node.rows.flatMap((row) => row.cells.flatMap((cell) => paragraphs(cell.nodes)))
  );
}

function images(nodes: DocNode[]): ImageRunNode[] {
  return paragraphs(nodes).flatMap((paragraph) =>
    paragraph.children.flatMap((child) =>
      child.type === "image" ? [child, ...images(child.contentNodes ?? [])] : []
    )
  );
}

function renderViewer(
  model: DocModel,
  mode: "read-only" | "edit" = "read-only"
): { html: string; controller: DocxEditorController } {
  let controller: DocxEditorController | undefined;
  const html = renderToStaticMarkup(
    React.createElement(function OpenDocumentProbe(): React.JSX.Element {
      const editor = useDocxEditor({ starterModel: model });
      controller = editor;
      return React.createElement(DocxEditorViewer, { editor, mode });
    })
  );
  return { html, controller: controller! };
}

describe("OpenDocument text import through wasm", () => {
  it.each(["sample-html-features.odt", "sample-html-features.fodt"])(
    "builds a model without a Word package from %s",
    async (name) => {
      const { package: pkg, model } = await buildDocModelFromBytes(fixture(name));

      expect(pkg.parts.size).toBe(0);
      expect(pkg.binaryAssets.size).toBe(0);
      expect(isOpenDocumentModel(model)).toBe(true);
      expect(model.metadata.sourcePartNames?.document).toBe("content.xml");
      expect(model.metadata.documentOpenTag).toBeUndefined();
      expect(model.metadata.sectionPropertiesXml).toContain("<w:pgSz");

      const body = paragraphs(model.nodes);
      expect(body.every((paragraph) => paragraph.sourceXml === undefined)).toBe(true);
      expect(body.every((paragraph) => isOpenDocumentBlockId(paragraph.blockId))).toBe(true);

      const heading = body.find((paragraph) => paragraphText(paragraph) === "First heading");
      expect(heading?.style?.headingLevel).toBe(1);
      expect(body.map(paragraphText)).toContain("Last paragraph.");

      const numbered = body.find((paragraph) => paragraphText(paragraph) === "Number one");
      expect(numbered?.style?.numbering).toBeDefined();
      const instance = model.metadata.numberingDefinitions?.instances.find(
        (candidate) => candidate.numId === numbered?.style?.numbering?.numId
      );
      expect(instance).toBeDefined();

      const table = model.nodes.find((node): node is TableNode => node.type === "table");
      expect(table?.sourceXml).toBeUndefined();
      expect(paragraphs(table ? [table] : []).map(paragraphText)).toEqual(
        expect.arrayContaining(["Head A", "Wide cell", "Tall cell"])
      );

      const [image] = images(model.nodes);
      expect(image.contentType).toBe("image/png");
      expect(image.data).toBeInstanceOf(Uint8Array);
      expect(Array.from(image.data!.subarray(0, 4))).toEqual(PNG_SIGNATURE);
      expect(image.sourceXml).toBeUndefined();
      // The parser gives no picture source; the model is normalized to one
      // built from the image's own bytes.
      expect(image.src).toBe(
        `data:image/png;base64,${Buffer.from(image.data!).toString("base64")}`
      );
    }
  );

  it("reads the packaged and flat forms into the same text", async () => {
    const packaged = await buildDocModelFromBytes(fixture("sample-html-features.odt"));
    const flat = await buildDocModelFromBytes(fixture("sample-html-features.fodt"));
    expect(paragraphs(flat.model.nodes).map(paragraphText)).toEqual(
      paragraphs(packaged.model.nodes).map(paragraphText)
    );
  });

  it("keeps text frames, page fields and comment anchors as model data", async () => {
    const { model } = await buildDocModelFromBytes(fixture("frames-and-fields.fodt"));

    const frames = images(model.nodes).filter((image) => image.contentNodes);
    expect(frames).toHaveLength(2);
    const [inlineFrame, floatingFrame] = frames;
    expect(inlineFrame).toMatchObject({ semanticKind: "text_box", syntheticTextBox: true });
    expect(inlineFrame.src).toBeUndefined();
    expect(inlineFrame.floating).toBeUndefined();
    expect(inlineFrame.widthPx).toBeCloseTo(226.77, 1);
    expect(inlineFrame.heightPx).toBeCloseTo(113.39, 1);
    expect(paragraphs(inlineFrame.contentNodes!).map(paragraphText)).toEqual([
      "Figure 1: inline frame caption",
    ]);
    const [nestedImage] = images(inlineFrame.contentNodes!);
    expect(nestedImage.src).toMatch(/^data:image\/png;base64,/);

    expect(floatingFrame.floating).toMatchObject({ wrapType: "square" });
    expect(floatingFrame.contentNodes!.map((node) => node.type)).toEqual(["paragraph", "table"]);

    const footer = model.metadata.footerSections[0];
    expect(footer.partName).toBe("styles.xml/footer1");
    expect((footer.nodes[0] as ParagraphNode).children).toMatchObject([
      { text: "Page " },
      { text: "7", fieldInstruction: "PAGE" },
      { text: " of " },
      { text: "9", fieldInstruction: "NUMPAGES" },
    ]);

    const commented = paragraphs(model.nodes).find((paragraph) => paragraph.commentRanges);
    expect(commented?.commentRanges).toEqual([
      { commentId: 0, childStart: 1, childEnd: 2, endsHere: true },
    ]);
    // Editor state is a clone of the imported model and must keep the anchors.
    const clone = cloneDocModel(model);
    expect(paragraphs(clone.nodes).find((paragraph) => paragraph.commentRanges)?.commentRanges)
      .toEqual(commented?.commentRanges);
    const review = await extractDocumentReview(clone);
    expect(review.comments).toHaveLength(1);
    expect(review.comments[0]).toMatchObject({ author: "Ada", text: "Check this wording" });
    expect(review.comments[0].targets).toMatchObject([
      { nodeId: commented?.blockId, start: 10, end: 19, childStart: 1, childEnd: 2 },
    ]);
  });

  it("rejects entry points that need a Word package, and other OpenDocument types", async () => {
    const odt = fixture("sample-html-features.odt");
    await expect(
      parseDocx(odt.buffer.slice(odt.byteOffset, odt.byteOffset + odt.byteLength) as ArrayBuffer)
    ).rejects.toThrow(/OpenDocument text has no Word package/);

    const spreadsheet = new TextEncoder().encode(
      `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
  <office:body><office:spreadsheet><table:table table:name="Sheet1"/></office:spreadsheet></office:body>
</office:document>`
    );
    await expect(buildDocModelFromBytes(spreadsheet)).rejects.toThrow(/not text documents/);
  });
});

describe("OpenDocument text in the viewer", () => {
  it("accepts OpenDocument text file names", () => {
    for (const name of ["a.odt", "a.ott", "a.odm", "a.otm", "a.oth", "A.FODT", "a.docx", "a.doc"]) {
      expect(isSupportedDocumentFileName(name)).toBe(true);
    }
    for (const name of ["a.ods", "a.odp", "a.fods", "a.pdf", "odt"]) {
      expect(isSupportedDocumentFileName(name)).toBe(false);
    }
  });

  it("parses for the viewer with an empty package and nothing to load from it", async () => {
    const document = await parseDocxForViewer(fixture("sample-html-features.fodt"), {
      fileName: "sample-html-features.fodt",
      useWorker: false,
    });
    expect(document.package.parts.size).toBe(0);
    expect(document.fileName).toBe("sample-html-features.fodt");
    expect(isOpenDocumentModel(document.model)).toBe(true);
    await expect(document.loadEmbeddedFonts()).resolves.toBeUndefined();
    document.dispose();
  });

  it("renders headings, lists, tables and images from the model alone", async () => {
    const { model } = await buildDocModelFromBytes(fixture("sample-html-features.odt"));
    const { html } = renderViewer(model);

    expect(html).toContain("First heading");
    expect(html).toContain("Nested bullet");
    expect(html).toContain("Number two");
    expect(html).toContain("Head A");
    expect(html).toContain("Tall cell");
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).not.toContain("Missing image");
    // An OpenDocument heading keeps its own colour instead of the look Word
    // gives headings typed in the editor.
    expect(html).not.toContain("#2f5496");

    const pages = layoutDocument(model, {});
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0].blocks.length).toBeGreaterThan(0);
  });

  it("draws a text frame from its nested content at the frame's size", async () => {
    const { model } = await buildDocModelFromBytes(fixture("frames-and-fields.fodt"));
    const { html } = renderViewer(model);

    expect(html.match(/data-docx-content-frame="true"/g)).toHaveLength(2);
    expect(html).toContain("Figure 1: inline frame caption");
    expect(html).toContain("Floating frame text");
    expect(html).toContain("Cell A");
    expect(html).toContain("Cell B");
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).not.toContain("Missing image");

    const inlineFrame = html.slice(html.indexOf('data-docx-content-frame="true"'));
    expect(inlineFrame.slice(0, inlineFrame.indexOf(">"))).toMatch(/width:226\.77\d*px/);
    expect(inlineFrame.slice(0, inlineFrame.indexOf(">"))).toMatch(/height:113\.38\d*px/);
    // The nested picture is drawn inside the frame, before its caption.
    expect(inlineFrame.indexOf("<img")).toBeGreaterThan(-1);
    expect(inlineFrame.indexOf("<img")).toBeLessThan(
      inlineFrame.indexOf("Figure 1: inline frame caption")
    );

    // The deprecated simple viewer has no nested blocks; it shows the text.
    const legacy = renderToStaticMarkup(React.createElement(ReactDocxViewer, { model }));
    expect(legacy).toContain("Figure 1: inline frame caption");
    expect(legacy).not.toContain("Missing image");
  });

  it("shows the live page number in place of a field's saved result", async () => {
    const { model } = await buildDocModelFromBytes(fixture("frames-and-fields.fodt"));
    const { html } = renderViewer(model);

    const footer = html.slice(html.indexOf("Page "));
    const footerText = footer
      .slice(0, footer.indexOf("</div>"))
      .replace(/<[^>]+>/g, "");
    expect(footerText).toBe("Page 1 of 1");
  });

  it("opens view-only: no editing surface, no export, and edits leave the model alone", async () => {
    const { model } = await buildDocModelFromBytes(fixture("frames-and-fields.fodt"));
    const { html, controller } = renderViewer(model, "edit");

    expect(controller.viewOnlyReason).toBe(OPEN_DOCUMENT_VIEW_ONLY_REASON);
    expect(html).not.toMatch(/contenteditable="true"/i);
    await expect(controller.getDocxBytes()).rejects.toThrow(OPEN_DOCUMENT_VIEW_ONLY_REASON);

    // appendParagraph reports where the paragraph would go; the document does
    // not grow, so a second call reports the same place.
    const first = controller.appendParagraph("one");
    expect(controller.appendParagraph("two")).toBe(first);

    const editable = renderViewer(defaultStarterModel, "edit");
    expect(editable.controller.viewOnlyReason).toBeUndefined();
    expect(editable.html).toMatch(/contenteditable="true"/i);
    const firstEditable = editable.controller.appendParagraph("one");
    expect(editable.controller.appendParagraph("two")).toBe(firstEditable + 1);
  });
});
