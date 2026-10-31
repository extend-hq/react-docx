import { describe, expect, it } from "vitest";
import { buildDocModelFromBytes } from "@extend-ai/react-docx-doc-model";
import { createMinimalDocxPackage, packageToArrayBuffer } from "@extend-ai/react-docx-ooxml-core";

async function parseGroup(reverse = false, origin = "10,20") {
  const picture = `<v:shape type="#_x0000_t75" style="position:absolute;left:10;top:20;width:200;height:100;visibility:visible;z-index:0"><v:imagedata r:id="r1"/><v:path arrowok="t"/></v:shape>`;
  const textbox = `<v:shape type="#_x0000_t202" filled="f" stroked="f" style="position:absolute;left:110;top:20;width:100;height:100;visibility:visible;mso-wrap-style:none;z-index:1"><v:textbox inset="0,0,0,0" style="mso-fit-shape-to-text:t"><w:txbxContent><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Label</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape>`;
  const pkg = createMinimalDocxPackage(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w10="urn:schemas-microsoft-com:office:word"><w:body><w:p><w:r><w:pict><v:group coordorigin="${origin}" coordsize="200,100" style="width:200px;height:100px">${reverse ? textbox + picture : picture + textbox}<w10:anchorlock/></v:group></w:pict></w:r></w:p></w:body></w:document>`);
  pkg.parts.get("[Content_Types].xml")!.content = pkg.parts.get("[Content_Types].xml")!.content.replace("</Types>", `<Default Extension="png" ContentType="image/png"/></Types>`);
  pkg.parts.get("word/_rels/document.xml.rels")!.content = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/bitmap.png"/></Relationships>`;
  pkg.binaryAssets.set("word/media/bitmap.png", new Uint8Array([1, 2, 3, 4]));
  const { model } = await buildDocModelFromBytes(await packageToArrayBuffer(pkg));
  const paragraph = model.nodes[0];
  if (paragraph.type !== "paragraph") throw new Error("Expected paragraph");
  const image = paragraph.children.find(node => node.type === "image");
  if (!image?.src) throw new Error("Expected image");
  const comma = image.src.indexOf(",");
  const svg = image.src.slice(0, comma).includes(";base64")
    ? Buffer.from(image.src.slice(comma + 1), "base64").toString()
    : decodeURIComponent(image.src.slice(comma + 1));
  return { image, svg };
}

describe("VML bitmap and textbox composition", () => {
  it.each([false, true])("retains bitmap, text semantics and paint order with reversed XML: %s", async reverse => {
    const { image, svg } = await parseGroup(reverse);
    expect(image.widthPx).toBe(200);
    expect(image.heightPx).toBe(100);
    expect(svg).toContain('viewBox="10 20 200 100"');
    expect(svg).toContain('href="data:image/png;base64,AQIDBA==" x="10" y="20" width="200" height="100"');
    expect(svg).toContain('x="110" y="20" width="100" height="100" viewBox="0 0 100 100"');
    expect(svg.indexOf("<image ")).toBeLessThan(svg.indexOf("<text "));
    expect(svg).toContain('font-weight="700"');
    expect(svg).toContain('<text xml:space="preserve" x="0"');
    expect(svg).toContain(">Label</text>");
    expect(image.contentNodes?.[0]).toMatchObject({ type: "paragraph", children: [{ type: "text", text: "Label", style: { bold: true } }] });
  });
  it.each(["NaN,0", "0,Infinity"])("rejects non-finite group coordinates: %s", async origin => {
    const { svg } = await parseGroup(false, origin);
    expect(svg).not.toContain("AQIDBA==");
    expect(svg).toContain("Label");
  });
});
