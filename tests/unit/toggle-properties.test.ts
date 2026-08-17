import { describe, expect, it } from "vitest";
import { buildDocModel } from "@extend-ai/react-docx-doc-model";
import { parseDocx } from "@extend-ai/react-docx-ooxml-core";
import { createZip } from "./helpers/zip";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="BoldPara"><w:name w:val="Bold Para"/><w:rPr><w:b/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="BoldChild" w:basedOn="BoldPara"><w:name w:val="Bold Child"/><w:rPr><w:b/></w:rPr></w:style>
  <w:style w:type="character" w:styleId="BoldChar"><w:name w:val="Bold Char"/><w:rPr><w:b/></w:rPr></w:style>
  <w:style w:type="character" w:styleId="ItalicChar"><w:name w:val="Italic Char"/><w:rPr><w:i/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ItalicPara"><w:name w:val="Italic Para"/><w:rPr><w:i/></w:rPr></w:style>
</w:styles>`;

function doc(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
}

function para(pStyle: string | undefined, runs: string): string {
  const pPr = pStyle ? `<w:pPr><w:pStyle w:val="${pStyle}"/></w:pPr>` : "";
  return `<w:p>${pPr}${runs}</w:p>`;
}

function run(text: string, rPr = ""): string {
  const rPrXml = rPr ? `<w:rPr>${rPr}</w:rPr>` : "";
  return `<w:r>${rPrXml}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

async function runStyles(body: string) {
  const zip = createZip([
    { name: "[Content_Types].xml", content: CONTENT_TYPES },
    { name: "_rels/.rels", content: ROOT_RELS },
    { name: "word/document.xml", content: doc(body) },
    { name: "word/_rels/document.xml.rels", content: DOC_RELS },
    { name: "word/styles.xml", content: STYLES }
  ]);
  const model = await buildDocModel(await parseDocx(zip));
  return model.nodes.map((node) =>
    node.type === "paragraph"
      ? node.children.map((child) =>
          child.type === "text" ? child.style : undefined
        )
      : []
  );
}

describe("toggle properties (ECMA-376 17.7.3)", () => {
  it("cancels a toggle set by both the paragraph style and the character style", async () => {
    const styles = await runStyles(
      para(
        "BoldPara",
        run("char over para", '<w:rStyle w:val="BoldChar"/>') + run("para only")
      ) +
        para(
          "ItalicPara",
          run("italic char over para", '<w:rStyle w:val="ItalicChar"/>') +
            run("italic para only")
        )
    );
    expect(styles[0]?.[0]?.bold).toBe(false);
    expect(styles[0]?.[1]?.bold).toBe(true);
    expect(styles[1]?.[0]?.italic).toBe(false);
    expect(styles[1]?.[1]?.italic).toBe(true);
  });

  it("keeps direct formatting absolute over a same-valued style", async () => {
    const styles = await runStyles(
      para("BoldPara", run("direct bold over bold style", "<w:b/>"))
    );
    expect(styles[0]?.[0]?.bold).toBe(true);
  });

  it("does not cancel across a basedOn chain (inheritance, not XOR)", async () => {
    const styles = await runStyles(para("BoldChild", run("double bold chain")));
    expect(styles[0]?.[0]?.bold).toBe(true);
  });

  it("honors explicit val=0 as an absolute off switch", async () => {
    const styles = await runStyles(
      para("BoldPara", run("explicit off", '<w:b w:val="0"/>'))
    );
    expect(styles[0]?.[0]?.bold).toBe(false);
  });

  it("keeps single-source toggles untouched", async () => {
    const styles = await runStyles(
      para(undefined, run("char only", '<w:rStyle w:val="BoldChar"/>')) +
        para(undefined, run("plain"))
    );
    expect(styles[0]?.[0]?.bold).toBe(true);
    expect(styles[1]?.[0]?.bold).toBeUndefined();
  });
});
