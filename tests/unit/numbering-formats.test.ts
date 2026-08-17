import { describe, expect, it } from "vitest";
import { buildDocModel } from "@extend-ai/react-docx-doc-model";
import { parseDocx } from "@extend-ai/react-docx-ooxml-core";
import { buildParagraphNumberingLabels } from "../../packages/react-viewer/src/editor";
import { createZip } from "./helpers/zip";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const EMPTY_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:styles>`;

function doc(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
}

function num(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${inner}</w:numbering>`;
}

function p(numId: number, ilvl: number, text: string): string {
  return `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

async function labelsFor(
  docXml: string,
  numXml: string,
  stylesXml = EMPTY_STYLES
): Promise<(key: string) => string | undefined> {
  const zip = createZip([
    { name: "[Content_Types].xml", content: CONTENT_TYPES },
    { name: "_rels/.rels", content: ROOT_RELS },
    { name: "word/document.xml", content: docXml },
    { name: "word/_rels/document.xml.rels", content: DOC_RELS },
    { name: "word/numbering.xml", content: numXml },
    { name: "word/styles.xml", content: stylesXml }
  ]);
  const model = await buildDocModel(await parseDocx(zip));
  const built = buildParagraphNumberingLabels(model);
  return (key: string) => built.get(key)?.text;
}

describe("numbering formats", () => {
  it("repeats letters past 26 like Word instead of bijective counting", async () => {
    const paras = Array.from({ length: 4 }, (_, i) => p(1, 0, `i${i}`)).join("");
    const more = Array.from({ length: 2 }, (_, i) => p(2, 0, `j${i}`)).join("");
    const get = await labelsFor(
      doc(paras + more),
      num(`<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="27"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%1)"/></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="52"/><w:numFmt w:val="upperLetter"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>`)
    );
    expect(get("p:0")).toBe("(aa)");
    expect(get("p:1")).toBe("(bb)");
    expect(get("p:2")).toBe("(cc)");
    expect(get("p:3")).toBe("(dd)");
    expect(get("p:4")).toBe("ZZ.");
    expect(get("p:5")).toBe("AAA.");
  });

  it("renders w:start val=0 lists from zero like Word", async () => {
    const get = await labelsFor(
      doc([p(1, 0, "a"), p(1, 0, "b"), p(1, 0, "c")].join("")),
      num(`<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="0"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`)
    );
    expect(get("p:0")).toBe("0.");
    expect(get("p:1")).toBe("1.");
    expect(get("p:2")).toBe("2.");
  });

  it("renders every placeholder decimal on isLgl levels", async () => {
    const get = await labelsFor(
      doc([p(1, 0, "article"), p(1, 1, "a"), p(1, 1, "b")].join("")),
      num(`<w:abstractNum w:abstractNumId="0">
  <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperLetter"/><w:lvlText w:val="%1."/></w:lvl>
  <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:isLgl/><w:lvlText w:val="%1.%2"/></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`)
    );
    expect(get("p:0")).toBe("A.");
    expect(get("p:1")).toBe("1.1");
    expect(get("p:2")).toBe("1.2");
  });

  it("pads decimalZero to two digits", async () => {
    const get = await labelsFor(
      doc([p(1, 0, "a"), p(1, 0, "b")].join("")),
      num(`<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="9"/><w:numFmt w:val="decimalZero"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`)
    );
    expect(get("p:0")).toBe("09.");
    expect(get("p:1")).toBe("10.");
  });

  it("renders ordinal, ordinalText, and cardinalText word forms", async () => {
    const get = await labelsFor(
      doc([p(1, 0, "a"), p(1, 0, "b"), p(2, 0, "c"), p(3, 0, "d")].join("")),
      num(`<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="21"/><w:numFmt w:val="ordinal"/><w:lvlText w:val="%1"/></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="22"/><w:numFmt w:val="ordinalText"/><w:lvlText w:val="%1"/></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:start w:val="101"/><w:numFmt w:val="cardinalText"/><w:lvlText w:val="%1"/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
<w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num>`)
    );
    expect(get("p:0")).toBe("21st");
    expect(get("p:1")).toBe("22nd");
    expect(get("p:2")).toBe("twenty-second");
    expect(get("p:3")).toBe("one hundred one");
  });

  it("keeps the style's list when a direct numPr only changes the level", async () => {
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="ListPara"><w:name w:val="List Para"/><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:style>
</w:styles>`;
    const body = [
      `<w:p><w:pPr><w:pStyle w:val="ListPara"/></w:pPr><w:r><w:t>one</w:t></w:r></w:p>`,
      `<w:p><w:pPr><w:pStyle w:val="ListPara"/><w:numPr><w:ilvl w:val="1"/></w:numPr></w:pPr><w:r><w:t>demoted</w:t></w:r></w:p>`,
      `<w:p><w:pPr><w:pStyle w:val="ListPara"/><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr><w:r><w:t>removed</w:t></w:r></w:p>`,
      `<w:p><w:pPr><w:pStyle w:val="ListPara"/></w:pPr><w:r><w:t>two</w:t></w:r></w:p>`
    ].join("");
    const get = await labelsFor(
      doc(body),
      num(`<w:abstractNum w:abstractNumId="0">
  <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
  <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%2)"/></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`),
      styles
    );
    expect(get("p:0")).toBe("1.");
    expect(get("p:1")).toBe("(a)");
    expect(get("p:2")).toBeUndefined();
    expect(get("p:3")).toBe("2.");
  });
});
