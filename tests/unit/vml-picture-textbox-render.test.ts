import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cloneDocModel, type DocModel, type ImageRunNode } from "../../packages/doc-model/src";
import { defaultStarterModel, DocxEditorViewer, useDocxEditor } from "../../packages/react-viewer/src/editor";
import { hasSvgPictureLayer, svgPictureTextContents } from "../../packages/react-viewer/src/svg-picture-layer";

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
const PICTURE = `<image x="0" y="0" width="8" height="8" href="${PIXEL}"/>`;
const SOURCE_XML = '<w:pict><v:group><v:shape><v:imagedata r:id="rId1"/></v:shape><v:shape><v:textbox><w:txbxContent><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Editable text</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></v:group></w:pict>';
const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40">${body}</svg>`;
const dataUri = (markup: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;

function ImportedViewer({ model, mode = "read-only" }: { model: DocModel; mode?: "edit" | "read-only" }): React.JSX.Element {
  const editor = useDocxEditor({ starterModel: model });
  return React.createElement(DocxEditorViewer, { editor, mode });
}

type Placement = "inline" | "absolute" | "wrapped" | "header" | "floating-header" | "footer";

function modelWithImage(image: ImageRunNode, placement: Placement): DocModel {
  const model = cloneDocModel(defaultStarterModel);
  model.metadata.sections = undefined;
  model.metadata.sectionPropertiesXml = "<w:sectPr/>";
  model.metadata.headerSections = [];
  model.metadata.footerSections = [];
  if (placement === "absolute" || placement === "floating-header") {
    image.floating = { xPx: 12, yPx: 8, horizontalRelativeTo: "column", verticalRelativeTo: "paragraph", wrapType: "none" };
  } else if (placement === "wrapped") {
    image.floating = { xPx: 12, yPx: 8, horizontalRelativeTo: "column", verticalRelativeTo: "paragraph", wrapType: "topAndBottom" };
  }
  const paragraph = { type: "paragraph" as const, children: [image] };
  if (placement === "header" || placement === "floating-header" || placement === "footer") {
    model.nodes = [{ type: "paragraph", children: [{ type: "text", text: "Body text" }] }];
    const section = { partName: placement === "footer" ? "word/footer1.xml" : "word/header1.xml", referenceType: "default", nodes: [paragraph] };
    if (placement === "footer") model.metadata.footerSections = [section];
    else model.metadata.headerSections = [section];
  } else {
    model.nodes = [paragraph, { type: "paragraph", children: [{ type: "text", text: "After image" }] }];
  }
  return model;
}

function importedImage(src: string): ImageRunNode {
  return {
    type: "image", src, widthPx: 120, heightPx: 40, syntheticTextBox: true,
    sourceXml: SOURCE_XML,
    contentNodes: [{ type: "paragraph", children: [{ type: "text", text: "Editable text", style: { bold: true } }] }],
  };
}

describe("rendered SVG picture layers", () => {
  it.each(["percent", "base64", "raw"])("reads %s SVG sources", (encoding) => {
    const markup = svg(`<g>${PICTURE}</g>`);
    const src = encoding === "base64" ? `data:image/svg+xml;base64,${Buffer.from(markup).toString("base64")}`
      : encoding === "raw" ? `data:image/svg+xml,${markup}` : dataUri(markup);
    expect(hasSvgPictureLayer({ src })).toBe(true);
  });

  it.each([
    `<text>&lt;image href="${PIXEL}"/&gt;</text>`,
    `<!--${PICTURE}-->`,
    `<![CDATA[${PICTURE}]]>`,
    `<metadata>${PICTURE}</metadata>`,
    `<defs>${PICTURE}</defs>`,
    `<g display="none">${PICTURE}</g>`,
    `<g opacity="0.00">${PICTURE}</g>`,
    `<g style="display:none">${PICTURE}</g>`,
    PICTURE.replace('width="8"', 'width="0"'),
    PICTURE.replace(PIXEL, "data:image/x-emf;base64,AA=="),
  ])("ignores non-rendered picture markup %#", (body) => {
    expect(hasSvgPictureLayer({ src: dataUri(svg(body)) })).toBe(false);
  });

  it("invalidates cached classification when the source changes", () => {
    const image = { src: dataUri(svg(PICTURE)) };
    expect(hasSvgPictureLayer(image)).toBe(true);
    image.src = dataUri(svg("<text>Only text</text>"));
    expect(hasSvgPictureLayer(image)).toBe(false);
    image.src = "data:image/svg+xml,%FF";
    expect(hasSvgPictureLayer(image)).toBe(false);
    image.src = "data:image/svg+xml;base64,!";
    expect(hasSvgPictureLayer(image)).toBe(false);
    image.src = dataUri(svg(PICTURE));
    expect(hasSvgPictureLayer(image)).toBe(true);
  });

  it("reads UTF-8 text from base64 SVG without treating nested text as complete", () => {
    const src = `data:image/svg+xml;base64,${Buffer.from(svg(`${PICTURE}<text>Привет</text>`)).toString("base64")}`;
    expect(svgPictureTextContents({ src })).toEqual(["Привет"]);
    expect(svgPictureTextContents({ src: dataUri(svg(`${PICTURE}<text><tspan>Nested</tspan></text>`)) })).toBeUndefined();
  });
});

describe("VML picture and textbox rendering", () => {
  const placements: Placement[] = ["inline", "absolute", "wrapped", "header", "floating-header", "footer"];

  it.each(["inline", "absolute", "wrapped"] as Placement[])("keeps bitmap and rich text together in %s flow", (placement) => {
    const image = importedImage(dataUri(svg(`${PICTURE}<text x="30" y="20">First Second</text>`)));
    image.sourceXml = '<w:pict><v:group style="width:90pt;height:30pt" coordsize="120,40"><v:shape><v:imagedata r:id="rId1"/></v:shape><v:shape type="#_x0000_t202" style="left:30;top:0;width:90;height:40"><v:textbox><w:txbxContent><w:p><w:r><w:rPr><w:b/><w:spacing w:val="20"/></w:rPr><w:t>First </w:t></w:r><w:r><w:rPr><w:i/><w:w w:val="80"/></w:rPr><w:t>Second</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></v:group></w:pict>';
    image.contentNodes = [{ type: "paragraph", children: [
      { type: "text", text: "First ", style: { bold: true, characterSpacingTwips: 20 } },
      { type: "text", text: "Second", style: { italic: true, characterScalePercent: 80 } },
    ] }];
    for (const mode of ["read-only", "edit"] as const) {
      const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model: modelWithImage(image, placement), mode }));
      expect(html).toContain('data-docx-vml-composite-surface="true"');
      expect(html).toContain(encodeURIComponent(PIXEL));
      expect(html).toContain('font-weight:700');
      expect(html).toContain('font-style:italic');
      expect(html).toContain('letter-spacing:1pt');
      expect(html).toContain('transform:scaleX(0.8)');
      expect(html).toContain('First ');
      expect(html).toContain('Second');
      expect(html).not.toContain(image.src);
      expect(html).toMatch(new RegExp(`contentEditable="${mode === "edit"}"`, "i"));
    }
  });

  it.each(placements)("preserves composed bitmap and text layers in %s flow", (placement) => {
    const src = dataUri(svg(`${PICTURE}<path d="M0 20L120 20" stroke="black"/><text y="32">Editable text</text>`));
    const model = modelWithImage(importedImage(src), placement);
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model }));
    expect(html).toContain(src);
    expect(html).toContain("Editable%20text");
    expect(html).toContain(encodeURIComponent(PIXEL));
    if (placement.includes("header")) expect(html).toContain('data-docx-header-footer-region="header"');
    if (placement === "footer") expect(html).toContain('data-docx-header-footer-region="footer"');
  });

  it.each(placements)("keeps rich text reconstruction for text-only fallback in %s flow", (placement) => {
    const src = dataUri(svg("<text>Old text</text>"));
    const model = modelWithImage(importedImage(src), placement);
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model }));
    expect(html).toMatch(/Editable(?:%20| )text/);
    expect(html).not.toContain("Old%20text");
    expect(html).not.toContain(encodeURIComponent(PIXEL));
    expect(html).toMatch(/font-weight(?:%3D%22|:)(?:700|bold)/);
  });

  it.each(["inline", "absolute", "wrapped"] as Placement[])("keeps normal text editing in %s flow", (placement) => {
    const src = dataUri(svg(`${PICTURE}<text>Editable text</text>`));
    const model = modelWithImage(importedImage(src), placement);
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model, mode: "edit" }));
    expect(html).toContain('data-docx-textbox-editor="true"');
    expect(html).toMatch(/contentEditable="true"/i);
    expect(html).toContain("Editable text");
    expect(html).not.toContain(src);
  });

  it.each(["explicit", "contentNodes"])("invalidates readonly composition after %s text edits", (edit) => {
    const src = dataUri(svg(`${PICTURE}<text>Editable text</text>`));
    const image = importedImage(src);
    image.contentNodes = [{ type: "paragraph", children: [{ type: "text", text: "Changed text" }] }];
    if (edit === "explicit") image.textBoxText = "Changed text";
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model: modelWithImage(image, "inline") }));
    expect(html).toMatch(/Changed(?:%20| )text/);
    expect(html).not.toContain("Editable%20text");
  });

  it("retains native placement of two independent readonly textbox stories", () => {
    const image = importedImage(dataUri(svg(`${PICTURE}<svg x="10" y="0" width="40" height="40"><text>First story</text></svg><svg x="70" y="0" width="40" height="40"><text>Second story</text></svg>`)));
    image.sourceXml = '<w:pict><v:group><v:shape><v:imagedata r:id="rId1"/></v:shape><v:shape><v:textbox><w:txbxContent><w:p><w:r><w:t>First story</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape><v:shape><v:textbox><w:txbxContent><w:p><w:r><w:t>Second story</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></v:group></w:pict>';
    image.contentNodes = ["First story", "Second story"].map((text) => ({ type: "paragraph", children: [{ type: "text", text }] }));
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model: modelWithImage(image, "inline") }));
    expect(html).toContain(image.src);
    expect(html).toContain('x%3D%2270%22');
  });

  it("keeps complete semantic text when a composed SVG omits it", () => {
    const image = importedImage(dataUri(svg(`${PICTURE}<text>Editable</text>`)));
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model: modelWithImage(image, "inline") }));
    expect(html).toMatch(/Editable(?:%20| )text/);
    expect(html).not.toContain(image.src);
  });

  it("retains blank paragraphs and language-only run differences", () => {
    const image = importedImage(dataUri(svg(`${PICTURE}<text>Editable text</text>`)));
    image.sourceXml = SOURCE_XML.replace("<w:txbxContent>", "<w:txbxContent><w:p/><w:p/>");
    image.contentNodes = [
      { type: "paragraph", children: [] },
      { type: "paragraph", children: [] },
      { type: "paragraph", children: [
        { type: "text", text: "Editable ", style: { bold: true, language: "en-US" } },
        { type: "text", text: "text", style: { bold: true, language: "fr-FR" } },
      ] },
    ];
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model: modelWithImage(image, "inline") }));
    expect(html).toContain(image.src);
  });

  it.each(["mixed-style", "dynamic-field", "inner-picture"])("preserves rich fallback for unsupported %s content", (kind) => {
    const image = importedImage(dataUri(svg(`${PICTURE}<text>Editable text</text>`)));
    if (kind === "mixed-style") {
      image.contentNodes = [{ type: "paragraph", children: [
        { type: "text", text: "Editable ", style: { bold: true } },
        { type: "text", text: "text", style: { italic: true } },
      ] }];
    } else {
      image.sourceXml = SOURCE_XML.replace('<w:t>Editable text</w:t>', kind === "dynamic-field"
        ? '<w:instrText>PAGE</w:instrText><w:t>Editable text</w:t>'
        : '<w:drawing/><w:t>Editable text</w:t>');
    }
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model: modelWithImage(image, "inline") }));
    expect(html).toMatch(/Editable(?:%20| )/);
    expect(html).not.toContain(image.src);
  });
});
