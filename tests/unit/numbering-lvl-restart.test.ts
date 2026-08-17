import { describe, expect, it } from "vitest";
import { buildDocModel } from "@extend-ai/react-docx-doc-model";
import { parseDocx } from "@extend-ai/react-docx-ooxml-core";
import { buildParagraphNumberingLabels } from "../../packages/react-viewer/src/editor";
import { createZip } from "./helpers/zip";

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

function numberedParagraph(ilvl: number, text: string): string {
  return `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function documentXml(paragraphs: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paragraphs}</w:body>
</w:document>`;
}

function numberingXml(levels: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:multiLevelType w:val="multilevel"/>${levels}
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;
}

async function labelsForZip(
  docXml: string,
  numXml: string
): Promise<Map<string, string | undefined>> {
  const zip = createZip([
    { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
    { name: "_rels/.rels", content: ROOT_RELS_XML },
    { name: "word/document.xml", content: docXml },
    { name: "word/_rels/document.xml.rels", content: DOCUMENT_RELS_XML },
    { name: "word/numbering.xml", content: numXml }
  ]);
  const pkg = await parseDocx(zip);
  const model = await buildDocModel(pkg);
  const labels = buildParagraphNumberingLabels(model);
  const result = new Map<string, string | undefined>();
  for (const [key, label] of labels) {
    result.set(key, label.text);
  }
  return result;
}

describe("numbering lvlRestart", () => {
  it("parses w:lvlRestart into numbering level definitions", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      {
        name: "word/document.xml",
        content: documentXml(numberedParagraph(0, "one"))
      },
      { name: "word/_rels/document.xml.rels", content: DOCUMENT_RELS_XML },
      {
        name: "word/numbering.xml",
        content: numberingXml(`
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlRestart w:val="0"/><w:lvlText w:val="(%2)"/></w:lvl>`)
      }
    ]);
    const pkg = await parseDocx(zip);
    const model = await buildDocModel(pkg);
    const abstract = model.metadata.numberingDefinitions?.abstracts.find(
      (candidate) => candidate.abstractNumId === 0
    );
    expect(abstract?.levels[0]?.lvlRestart).toBeUndefined();
    expect(abstract?.levels[1]?.lvlRestart).toBe(0);
  });

  it("never restarts a level with lvlRestart=0 (continuous legal lettering)", async () => {
    const docXml = documentXml(
      [
        numberedParagraph(0, "Section one"),
        numberedParagraph(1, "clause"),
        numberedParagraph(1, "clause"),
        numberedParagraph(0, "Section two"),
        numberedParagraph(1, "clause"),
        numberedParagraph(1, "clause")
      ].join("")
    );
    const numXml = numberingXml(`
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlRestart w:val="0"/><w:lvlText w:val="(%2)"/></w:lvl>`);

    const labels = await labelsForZip(docXml, numXml);
    expect(labels.get("p:0")).toBe("1.");
    expect(labels.get("p:1")).toBe("(a)");
    expect(labels.get("p:2")).toBe("(b)");
    expect(labels.get("p:3")).toBe("2.");
    expect(labels.get("p:4")).toBe("(c)");
    expect(labels.get("p:5")).toBe("(d)");
  });

  it("restarts only at the level named by lvlRestart", async () => {
    const docXml = documentXml(
      [
        numberedParagraph(0, "Article 1"),
        numberedParagraph(1, "Section 1.1"),
        numberedParagraph(2, "item"),
        numberedParagraph(2, "item"),
        numberedParagraph(1, "Section 1.2"),
        numberedParagraph(2, "item"),
        numberedParagraph(0, "Article 2"),
        numberedParagraph(1, "Section 2.1"),
        numberedParagraph(2, "item")
      ].join("")
    );
    // ilvl=2 restarts only when one-based level 1 (ilvl 0) is used, not when
    // its immediate parent increments.
    const numXml = numberingXml(`
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2"/></w:lvl>
    <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlRestart w:val="1"/><w:lvlText w:val="(%3)"/></w:lvl>`);

    const labels = await labelsForZip(docXml, numXml);
    expect(labels.get("p:2")).toBe("(i)");
    expect(labels.get("p:3")).toBe("(ii)");
    expect(labels.get("p:4")).toBe("1.2");
    expect(labels.get("p:5")).toBe("(iii)");
    expect(labels.get("p:6")).toBe("2.");
    expect(labels.get("p:8")).toBe("(i)");
  });

  it("keeps default restart semantics when lvlRestart is absent", async () => {
    const docXml = documentXml(
      [
        numberedParagraph(0, "Section one"),
        numberedParagraph(1, "clause"),
        numberedParagraph(1, "clause"),
        numberedParagraph(0, "Section two"),
        numberedParagraph(1, "clause")
      ].join("")
    );
    const numXml = numberingXml(`
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%2)"/></w:lvl>`);

    const labels = await labelsForZip(docXml, numXml);
    expect(labels.get("p:1")).toBe("(a)");
    expect(labels.get("p:2")).toBe("(b)");
    expect(labels.get("p:3")).toBe("2.");
    expect(labels.get("p:4")).toBe("(a)");
  });

  it("ignores lvlRestart values deeper than the level itself", async () => {
    const docXml = documentXml(
      [
        numberedParagraph(0, "Section one"),
        numberedParagraph(1, "clause"),
        numberedParagraph(0, "Section two"),
        numberedParagraph(1, "clause")
      ].join("")
    );
    // lvlRestart=5 on a one-based level 2 is invalid per ECMA-376 and must
    // fall back to the default (restart under each new section).
    const numXml = numberingXml(`
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlRestart w:val="5"/><w:lvlText w:val="(%2)"/></w:lvl>`);

    const labels = await labelsForZip(docXml, numXml);
    expect(labels.get("p:1")).toBe("(a)");
    expect(labels.get("p:3")).toBe("(a)");
  });
});
