import { describe, expect, it } from "vitest";
import {
  createMinimalDocxPackage,
  packageToArrayBuffer,
  parseDocx,
} from "@extend-ai/react-docx-ooxml-core";
import { buildDocModel } from "@extend-ai/react-docx-doc-model";
import {
  insertParagraph,
  setParagraphHeading,
  setRunHighlight,
  toggleRunStyleFlag,
  updateParagraphText,
} from "@extend-ai/react-docx-editor-ops";
import {
  serializeDocModel,
  serializeDocx,
} from "@extend-ai/react-docx-serializer";

const DOCUMENT_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Source Paragraph</w:t></w:r></w:p></w:body></w:document>';
const DOCUMENT_WITH_HEADER_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="rId100"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
const DOCUMENT_RELS_WITH_HEADER =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId100" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>';
const HEADER_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Original Header</w:t></w:r></w:p></w:hdr>';
const DOCUMENT_WITH_DROP_CAP_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:framePr w:dropCap="drop" w:lines="3" w:wrap="around" w:hAnchor="text" w:vAnchor="text" w:x="240" w:y="120" w:hSpace="80" w:vSpace="40"/></w:pPr><w:r><w:t>A</w:t></w:r></w:p><w:p><w:r><w:t>fter paragraph.</w:t></w:r></w:p></w:body></w:document>';
const DOCUMENT_WITH_RUN_BORDER_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:bdr w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:rPr><w:t>box</w:t></w:r></w:p></w:body></w:document>';
const DOCUMENT_WITH_RUN_SHADING_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:color w:val="FFFFFF"/><w:shd w:val="clear" w:color="auto" w:fill="000000"/></w:rPr><w:t>inverse video</w:t></w:r></w:p></w:body></w:document>';
const DOCUMENT_WITH_UNMODELED_TEXT_MARKUP_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body><w:p w14:paraId="1234ABCD"><w:pPr><w:keepLines/><w:contextualSpacing/><w:mirrorIndents/></w:pPr><w:r><w:rPr><w:b/><w:lang w:val="en-US"/><w14:textOutline w14:w="12700"/></w:rPr><w:t>Alpha</w:t></w:r><w:r><w:rPr><w:i/><w:rtl/></w:rPr><w:t>Beta</w:t></w:r></w:p></w:body></w:document>';
const DOCUMENT_WITH_FORM_FIELD_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p w:rsidR="00ABCDEF"><w:proofErr w:type="spellStart"/><w:sdt><w:sdtPr><w:alias w:val="Preserve field"/><w:text/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:lang w:val="en-US"/></w:rPr><w:t>Field value</w:t></w:r></w:sdtContent></w:sdt><w:proofErr w:type="spellEnd"/></w:p></w:body></w:document>';
const DOCUMENT_WITH_THREE_STYLED_RUNS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>A</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>B</w:t></w:r><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>C</w:t></w:r></w:p></w:body></w:document>';
const DOCUMENT_WITH_REVISION_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:ins w:id="1" w:author="Original Author" w:date="2026-01-01T00:00:00Z"><w:r><w:t>A</w:t></w:r></w:ins></w:p></w:body></w:document>';
const DOCUMENT_WITH_EXPLICIT_XML_SPACE =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space = "default">Alpha</w:t></w:r></w:p></w:body></w:document>';
const DOCUMENT_WITH_NOTE_REFERENCES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>A</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r><w:r><w:t>B</w:t></w:r><w:r><w:endnoteReference w:id="2"/></w:r><w:r><w:t>C</w:t></w:r></w:p></w:body></w:document>';
const DOCUMENT_WITH_SIMPLE_FIELD_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:fldSimple w:instr=" DATE \\@ &quot;MMMM d, yyyy&quot; "><w:r><w:t>July 9, 2026</w:t></w:r></w:fldSimple></w:p></w:body></w:document>';

describe("round-trip", () => {
  it("retains a column break through successive text edits and removes it when deleted", async () => {
    const pkg = createMinimalDocxPackage(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body><w:p><w:r><w:t>Left</w:t><w:br w:type="column"/><w:t>Right</w:t></w:r></w:p>
      <w:sectPr><w:cols w:num="2"/></w:sectPr></w:body></w:document>`);
    const source = await buildDocModel(pkg);
    const leftEdited = updateParagraphText(source, 0, "Left & middle\nRight");
    const bothEdited = updateParagraphText(leftEdited, 0, "Left & middle\n Right");
    const saved = await serializeDocModel(bothEdited, pkg);
    const xml = saved.parts.get("word/document.xml")!.content;
    expect(xml).toContain('<w:t>Left &amp; middle</w:t><w:br w:type="column"/><w:t xml:space="preserve"> Right</w:t>');
    const joined = updateParagraphText(bothEdited, 0, "Left & middle Right");
    const withoutBreak = await serializeDocModel(joined, pkg);
    expect(withoutBreak.parts.get("word/document.xml")!.content).not.toContain('w:type="column"');
  });

  it("patches plain paragraph text without dropping unmodeled Word markup", async () => {
    const seed = createMinimalDocxPackage(
      DOCUMENT_WITH_UNMODELED_TEXT_MARKUP_XML
    );
    const pkg = await parseDocx(await packageToArrayBuffer(seed));
    const model = await buildDocModel(pkg);

    const edited = updateParagraphText(model, 0, "AlphaxBeta");
    const serialized = await serializeDocModel(edited, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";

    expect(xml).toContain('w14:paraId="1234ABCD"');
    expect(xml).toContain("<w:keepLines/>");
    expect(xml).toContain("<w:contextualSpacing/>");
    expect(xml).toContain("<w:mirrorIndents/>");
    expect(xml).toContain('<w:lang w:val="en-US"/>');
    expect(xml).toContain('<w14:textOutline w14:w="12700"/>');
    expect(xml).toContain("<w:rtl/>");
    expect(xml).toContain("<w:t>Alphax</w:t>");
    expect(xml).toContain("<w:t>Beta</w:t>");
  });

  it("keeps untouched mixed-content source XML verbatim", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_WITH_FORM_FIELD_XML);
    const pkg = await parseDocx(await packageToArrayBuffer(seed));
    const model = await buildDocModel(pkg);
    const serialized = await serializeDocModel(model, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";
    const sourceParagraph =
      DOCUMENT_WITH_FORM_FIELD_XML.match(/<w:p\b[\s\S]*<\/w:p>/)?.[0];

    expect(sourceParagraph).toBeDefined();
    expect(xml).toContain(sourceParagraph);
  });

  it("treats a redundant mixed-content text update as a no-op", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_WITH_FORM_FIELD_XML);
    const pkg = await parseDocx(await packageToArrayBuffer(seed));
    const model = await buildDocModel(pkg);
    const originalParagraph = model.nodes[0];
    const edited = updateParagraphText(model, 0, "Field value");

    expect(edited.nodes[0]).toBe(originalParagraph);
    expect(edited.nodes[0]?.sourceXml).toBe(originalParagraph?.sourceXml);
  });

  it("regenerates instead of applying text to a mismatched source run style", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_WITH_THREE_STYLED_RUNS_XML);
    const pkg = await parseDocx(await packageToArrayBuffer(seed));
    const model = await buildDocModel(pkg);
    const edited = updateParagraphText(model, 0, "AXC", {
      insertedStyle: { color: "#ff0000" },
    });
    const serialized = await serializeDocModel(edited, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";

    expect(xml).toContain('<w:color w:val="ff0000"/></w:rPr><w:t>X</w:t>');
    expect(xml).not.toContain("<w:i/></w:rPr><w:t>X</w:t>");
  });

  it("revalidates source patch provenance after later model mutations", async () => {
    const seed = createMinimalDocxPackage(
      DOCUMENT_WITH_UNMODELED_TEXT_MARKUP_XML
    );
    const pkg = await parseDocx(await packageToArrayBuffer(seed));
    const model = await buildDocModel(pkg);
    const edited = updateParagraphText(model, 0, "AlphaxBeta");
    const paragraph = edited.nodes[0];
    if (
      paragraph?.type !== "paragraph" ||
      paragraph.children[0]?.type !== "text"
    ) {
      throw new Error("expected text paragraph");
    }
    paragraph.children[0].style = {
      ...paragraph.children[0].style,
      color: "#00aa00",
    };

    const editedAgain = updateParagraphText(edited, 0, "AlphaxyBeta");
    const serialized = await serializeDocModel(editedAgain, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";
    expect(xml).toContain('<w:color w:val="00aa00"/>');
    expect(xml).toContain("Alphaxy");
    expect(xml).not.toContain("<w14:textOutline");
  });

  it("does not rewrite text inside an existing revision wrapper", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_WITH_REVISION_XML);
    const pkg = await parseDocx(await packageToArrayBuffer(seed));
    const model = await buildDocModel(pkg);
    const edited = updateParagraphText(model, 0, "B");
    const serialized = await serializeDocModel(edited, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";

    expect(xml).toContain("<w:t>B</w:t>");
    expect(xml).not.toContain("<w:ins");
    expect(xml).not.toContain("Original Author");
  });

  it("updates an existing xml:space value without duplicating it", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_WITH_EXPLICIT_XML_SPACE);
    const pkg = await parseDocx(await packageToArrayBuffer(seed));
    const model = await buildDocModel(pkg);
    const edited = updateParagraphText(model, 0, " Alpha ");
    const serialized = await serializeDocModel(edited, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";

    expect(xml).toMatch(/xml:space\s*=\s*"preserve"/);
    expect(xml.match(/xml:space/gi)).toHaveLength(1);
    expect(xml).toContain("> Alpha </w:t>");
    const reparsed = await buildDocModel(serialized);
    expect(reparsed.nodes[0]).toMatchObject({
      type: "paragraph",
      children: [{ type: "text", text: " Alpha " }],
    });
  });

  it("retains footnote and endnote markers when surrounding text is edited", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_WITH_NOTE_REFERENCES_XML);
    const pkg = await parseDocx(await packageToArrayBuffer(seed));
    const model = await buildDocModel(pkg);
    const edited = updateParagraphText(model, 0, "AXBC");
    const serialized = await serializeDocModel(edited, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";

    expect(xml).toContain('<w:footnoteReference w:id="1"/>');
    expect(xml).toContain('<w:endnoteReference w:id="2"/>');
    expect(xml).toContain("X");

    const reparsed = await parseDocx(await packageToArrayBuffer(serialized));
    const reparsedModel = await buildDocModel(reparsed);
    const paragraph = reparsedModel.nodes[0];
    expect(paragraph?.type).toBe("paragraph");
    if (paragraph?.type !== "paragraph") {
      throw new Error("expected a paragraph");
    }
    expect(
      paragraph.children
        .filter((child) => child.type === "text" && child.noteReference)
        .map((child) =>
          child.type === "text" ? child.noteReference : undefined
        )
    ).toEqual([
      { kind: "footnote", id: 1 },
      { kind: "endnote", id: 2 },
    ]);
  });

  it("fails closed instead of rewriting a simple field result", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_WITH_SIMPLE_FIELD_XML);
    const pkg = await parseDocx(await packageToArrayBuffer(seed));
    const model = await buildDocModel(pkg);
    const edited = updateParagraphText(model, 0, "July 10, 2026");

    expect(edited).toBe(model);
    const serialized = await serializeDocModel(edited, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";
    expect(xml).toContain(
      '<w:fldSimple w:instr=" DATE \\@ &quot;MMMM d, yyyy&quot; ">'
    );
    expect(xml).toContain("July 9, 2026");
    expect(xml).not.toContain("July 10, 2026");
  });

  it("builds model, edits it, then serializes back to document.xml", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_XML);
    const pkg = await parseDocx(await packageToArrayBuffer(seed));
    const model = await buildDocModel(pkg);
    const edited = insertParagraph(model, "Added by test", model.nodes.length, {
      paragraphStyle: { align: "center" },
      runStyle: { bold: true, color: "#0055aa", fontSizePt: 14 },
    });
    const headed = setParagraphHeading(edited, 1, 2);
    const highlighted = setRunHighlight(headed, 1, 0, "yellow");
    const styled = toggleRunStyleFlag(highlighted, 1, 0, "strike");
    const serialized = await serializeDocModel(styled, pkg);

    const xml = serialized.parts.get("word/document.xml")?.content;
    expect(xml).toContain("Added by test");
    expect(xml).toContain('<w:jc w:val="center"');
    expect(xml).toContain('<w:pStyle w:val="Heading2"/>');
    expect(xml).toContain("<w:b/>");
    expect(xml).toContain('<w:color w:val="0055aa"/>');
    expect(xml).toContain('<w:highlight w:val="yellow"/>');
    expect(xml).toContain("<w:strike/>");
  });

  it("exports parseable DOCX binary", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_XML);
    const pkg = await parseDocx(await packageToArrayBuffer(seed));
    const model = await buildDocModel(pkg);
    const edited = insertParagraph(model, "Another paragraph");

    const exported = await serializeDocx(edited, pkg);
    const reparsed = await parseDocx(exported);
    const reparsedModel = await buildDocModel(reparsed);

    expect(
      reparsedModel.nodes.some((node) =>
        node.children.some((run) => run.text.includes("Another paragraph"))
      )
    ).toBe(true);
  });

  it("serializes paragraph border definitions to pBdr", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_XML);
    const pkg = await parseDocx(await packageToArrayBuffer(seed));
    const model = await buildDocModel(pkg);

    model.nodes = [
      {
        type: "paragraph",
        style: {
          borders: {
            bottom: {
              type: "single",
              sizeEighthPt: 8,
              spacePt: 0,
              color: "#2f5496",
            },
          },
        },
        children: [
          {
            type: "text",
            text: "Border paragraph",
          },
        ],
      },
    ];

    const serialized = await serializeDocModel(model, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";
    expect(xml).toContain("<w:pBdr>");
    expect(xml).toContain("<w:bottom");
    expect(xml).toContain('w:val="single"');
    expect(xml).toContain('w:sz="8"');
    expect(xml).toContain('w:color="2F5496"');
  });

  it("serializes parsed drop-cap metadata after editing paragraph text", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_WITH_DROP_CAP_XML);
    const pkg = await parseDocx(await packageToArrayBuffer(seed));
    const model = await buildDocModel(pkg);
    const paragraph = model.nodes[0];
    expect(paragraph?.type).toBe("paragraph");
    if (paragraph?.type !== "paragraph") {
      return;
    }

    paragraph.children = [
      {
        type: "text",
        text: "AB",
        style:
          paragraph.children[0]?.type === "text"
            ? paragraph.children[0].style
            : undefined,
      },
    ];
    paragraph.sourceXml = undefined;

    const serialized = await serializeDocModel(model, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";
    expect(xml).toContain("<w:framePr");
    expect(xml).toContain('w:dropCap="drop"');
    expect(xml).toContain('w:lines="3"');
    expect(xml).toContain('w:wrap="around"');
    expect(xml).toContain('w:hAnchor="text"');
    expect(xml).toContain('w:vAnchor="text"');
    expect(xml).toContain('w:x="240"');
    expect(xml).toContain('w:y="120"');
    expect(xml).toContain('w:hSpace="80"');
    expect(xml).toContain('w:vSpace="40"');
    expect(xml).toContain("AB");
  });

  it("serializes parsed run border styling", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_WITH_RUN_BORDER_XML);
    const pkg = await parseDocx(await packageToArrayBuffer(seed));
    const model = await buildDocModel(pkg);
    const paragraph = model.nodes[0];
    expect(paragraph?.type).toBe("paragraph");
    if (paragraph?.type !== "paragraph") {
      return;
    }

    const run = paragraph.children[0];
    expect(run?.type).toBe("text");
    if (run?.type !== "text") {
      return;
    }

    paragraph.children = [
      {
        type: "text",
        text: "boxed",
        style: run.style,
      },
    ];
    paragraph.sourceXml = undefined;

    const serialized = await serializeDocModel(model, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";
    expect(xml).toContain("<w:bdr");
    expect(xml).toContain('w:val="single"');
    expect(xml).toContain('w:sz="4"');
    expect(xml).toContain('w:space="0"');
    expect(xml).toContain('w:color="auto"');
    expect(xml).toContain("boxed");
  });

  it("serializes parsed run shading styling", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_WITH_RUN_SHADING_XML);
    const pkg = await parseDocx(await packageToArrayBuffer(seed));
    const model = await buildDocModel(pkg);
    const paragraph = model.nodes[0];
    expect(paragraph?.type).toBe("paragraph");
    if (paragraph?.type !== "paragraph") {
      return;
    }

    const run = paragraph.children[0];
    expect(run?.type).toBe("text");
    if (run?.type !== "text") {
      return;
    }

    paragraph.children = [
      {
        type: "text",
        text: "inverse video updated",
        style: run.style,
      },
    ];
    paragraph.sourceXml = undefined;

    const serialized = await serializeDocModel(model, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";
    expect(xml).toContain('<w:color w:val="FFFFFF"/>');
    expect(xml).toContain(
      '<w:shd w:val="clear" w:color="auto" w:fill="000000"/>'
    );
    expect(xml).toContain("inverse video updated");
  });

  it("serializes hyperlink runs with hyperlink relationship entries", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_XML);
    const pkg = await parseDocx(await packageToArrayBuffer(seed));
    const model = await buildDocModel(pkg);

    model.nodes = [
      {
        type: "paragraph",
        children: [
          {
            type: "text",
            text: "OpenAI",
            link: "https://openai.com",
          },
        ],
      },
    ];

    const serialized = await serializeDocModel(model, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";
    const rels =
      serialized.parts.get("word/_rels/document.xml.rels")?.content ?? "";

    expect(xml).toContain("<w:hyperlink");
    expect(xml).toContain("OpenAI");
    expect(rels).toContain("relationships/hyperlink");
    expect(rels).toContain('Target="https://openai.com"');
    expect(rels).toContain('TargetMode="External"');
  });

  it("serializes editable form-field runs back to SDT XML", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_XML);
    const pkg = await parseDocx(await packageToArrayBuffer(seed));
    const model = await buildDocModel(pkg);

    model.nodes = [
      {
        type: "paragraph",
        children: [
          {
            type: "form-field",
            fieldType: "checkbox",
            checked: true,
            checkedSymbol: "☒",
            uncheckedSymbol: "☐",
          },
          {
            type: "text",
            text: " Name: ",
          },
          {
            type: "form-field",
            fieldType: "text",
            value: "Jane Doe",
          },
        ],
      },
    ];

    const serialized = await serializeDocModel(model, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";
    expect(xml).toContain("<w:sdt>");
    expect(xml).toContain("<w14:checkbox>");
    expect(xml).toContain('w14:checked w14:val="1"');
    expect(xml).toContain("Jane Doe");
    expect(xml).toContain("mc:Ignorable");
  });

  it("preserves legacy form widgets when edited and exported", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_XML);
    const pkg = await parseDocx(await packageToArrayBuffer(seed));
    const model = await buildDocModel(pkg);

    model.nodes = [
      {
        type: "paragraph",
        children: [
          {
            type: "form-field",
            sourceKind: "legacy",
            fieldType: "checkbox",
            checked: true,
            checkedSymbol: "☒",
            uncheckedSymbol: "☐",
            widget: {
              checkbox: {
                defaultChecked: true,
                sizeMode: "exact",
                sizePt: 10,
              },
            },
          },
          {
            type: "text",
            text: " Name: ",
          },
          {
            type: "form-field",
            sourceKind: "legacy",
            fieldType: "text",
            value: "Jane Doe",
            widget: {
              text: {
                inputType: "regular",
                defaultText: "John Doe",
                maxLength: 25,
                textFormat: "titleCase",
              },
            },
          },
        ],
      },
    ];

    const serialized = await serializeDocModel(model, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";
    expect(xml).toContain("<w:ffData>");
    expect(xml).toContain("FORMCHECKBOX");
    expect(xml).toContain("FORMTEXT");
    expect(xml).toContain("<w:checkBox>");
    expect(xml).toContain('<w:size w:val="20"/>');
    expect(xml).toContain("<w:textInput>");
    expect(xml).toContain('<w:maxLength w:val="25"/>');
    expect(xml).toContain("Jane Doe");
  });

  it("round-trips legacy number text form widgets", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_XML);
    const pkg = await parseDocx(await packageToArrayBuffer(seed));
    const model = await buildDocModel(pkg);

    model.nodes = [
      {
        type: "paragraph",
        children: [
          {
            type: "form-field",
            sourceKind: "legacy",
            fieldType: "text",
            value: "1250",
            widget: {
              text: {
                inputType: "number",
                defaultText: "0",
                maxLength: 8,
                textFormat: "0.00",
              },
            },
          },
        ],
      },
    ];

    const serialized = await serializeDocModel(model, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";
    expect(xml).toContain("<w:ffData>");
    expect(xml).toContain("FORMTEXT");
    expect(xml).toContain('<w:type w:val="number"/>');
    expect(xml).toContain('<w:default w:val="0"/>');
    expect(xml).toContain('<w:maxLength w:val="8"/>');
    expect(xml).toContain('<w:format w:val="0.00"/>');

    const reparsed = await parseDocx(await packageToArrayBuffer(serialized));
    const reparsedModel = await buildDocModel(reparsed);
    const firstParagraph = reparsedModel.nodes[0];
    expect(firstParagraph?.type).toBe("paragraph");
    if (firstParagraph?.type === "paragraph") {
      const firstChild = firstParagraph.children[0];
      expect(firstChild?.type).toBe("form-field");
      if (firstChild?.type === "form-field") {
        expect(firstChild.sourceKind).toBe("legacy");
        expect(firstChild.fieldType).toBe("text");
        expect(firstChild.widget?.text?.inputType).toBe("number");
      }
    }
  });

  it("serializes empty legacy number form widgets with a valid default", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_XML);
    const pkg = await parseDocx(await packageToArrayBuffer(seed));
    const model = await buildDocModel(pkg);

    model.nodes = [
      {
        type: "paragraph",
        children: [
          {
            type: "form-field",
            sourceKind: "legacy",
            fieldType: "text",
            widget: {
              text: {
                inputType: "number",
              },
            },
          },
        ],
      },
    ];

    const serialized = await serializeDocModel(model, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";
    expect(xml).toContain('<w:type w:val="number"/>');
    expect(xml).toContain('<w:default w:val="0"/>');
    expect(xml).toContain('<w:format w:val="0"/>');
  });

  it("serializes floating anchored images with center alignment", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_XML);
    const pkg = await parseDocx(await packageToArrayBuffer(seed));
    const model = await buildDocModel(pkg);

    model.nodes = [
      {
        type: "paragraph",
        children: [
          {
            type: "image",
            src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5Aq9EAAAAASUVORK5CYII=",
            widthPx: 26,
            heightPx: 26,
            alt: "dot_green.png",
            floating: {
              horizontalAlign: "center",
              horizontalRelativeTo: "page",
              verticalRelativeTo: "paragraph",
              yPx: 1,
              distLPx: 12,
              distRPx: 12,
              distTPx: 0,
              distBPx: 0,
              wrapType: "topAndBottom",
              behindDocument: false,
              zIndex: 251660288,
            },
          },
        ],
      },
    ];

    const serialized = await serializeDocModel(model, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";
    expect(xml).toContain("<wp:anchor");
    expect(xml).toContain(
      '<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>'
    );
    expect(xml).toContain(
      '<wp:positionV relativeFrom="paragraph"><wp:posOffset>9525</wp:posOffset></wp:positionV>'
    );
    expect(xml).toContain("<wp:wrapTopAndBottom/>");
    expect(xml).toContain('<wp:extent cx="247650" cy="247650"/>');

    const reparsed = await parseDocx(await packageToArrayBuffer(serialized));
    const reparsedModel = await buildDocModel(reparsed);
    const imageRun = reparsedModel.nodes[0]?.children[0];
    expect(imageRun?.type).toBe("image");
    if (imageRun?.type === "image") {
      expect(imageRun.widthPx).toBe(26);
      expect(imageRun.heightPx).toBe(26);
      expect(imageRun.floating?.horizontalAlign).toBe("center");
      expect(imageRun.floating?.wrapType).toBe("topAndBottom");
    }
  });

  it("persists edited header text to header XML part", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_WITH_HEADER_XML);
    seed.parts.set("word/_rels/document.xml.rels", {
      name: "word/_rels/document.xml.rels",
      content: DOCUMENT_RELS_WITH_HEADER,
    });
    seed.parts.set("word/header1.xml", {
      name: "word/header1.xml",
      content: HEADER_XML,
    });
    const contentTypes = seed.parts.get("[Content_Types].xml")?.content ?? "";
    if (!/PartName="\/word\/header1\.xml"/i.test(contentTypes)) {
      seed.parts.set("[Content_Types].xml", {
        name: "[Content_Types].xml",
        content: contentTypes.replace(
          "</Types>",
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'
        ),
      });
    }

    const pkg = await parseDocx(await packageToArrayBuffer(seed));
    const model = await buildDocModel(pkg);
    expect(model.metadata.headerSections[0]?.partName).toBe("word/header1.xml");

    model.metadata.headerSections = [
      {
        ...(model.metadata.headerSections[0] ?? {
          partName: "word/header1.xml",
          referenceType: "default" as const,
        }),
        nodes: [
          {
            type: "paragraph",
            children: [{ type: "text", text: "Updated Header" }],
          },
        ],
      },
    ];

    const serialized = await serializeDocModel(model, pkg);
    const headerXml = serialized.parts.get("word/header1.xml")?.content ?? "";
    expect(headerXml).toContain("Updated Header");
    expect(headerXml).not.toContain("Original Header");
  });

  it("preserves table row cantSplit metadata", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_XML);
    const pkg = await parseDocx(await packageToArrayBuffer(seed));
    const model = await buildDocModel(pkg);

    model.nodes = [
      {
        type: "table",
        style: {
          widthTwips: 5000,
          layout: "fixed",
          columnWidthsTwips: [5000],
        },
        rows: [
          {
            type: "table-row",
            style: {
              heightTwips: 720,
              heightRule: "atLeast",
              cantSplit: true,
            },
            cells: [
              {
                type: "table-cell",
                nodes: [
                  {
                    type: "paragraph",
                    children: [{ type: "text", text: "Row 1" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    const serialized = await serializeDocModel(model, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";
    expect(xml).toContain("<w:cantSplit/>");

    const reparsed = await parseDocx(await packageToArrayBuffer(serialized));
    const reparsedModel = await buildDocModel(reparsed);
    const tableNode = reparsedModel.nodes[0];
    expect(tableNode?.type).toBe("table");
    if (tableNode?.type === "table") {
      expect(tableNode.rows[0]?.style?.cantSplit).toBe(true);
      expect(tableNode.rows[0]?.style?.heightRule).toBe("atLeast");
    }
  });

  it("round-trips diagonal table cell borders", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_XML);
    const pkg = await parseDocx(await packageToArrayBuffer(seed));
    const model = await buildDocModel(pkg);

    model.nodes = [
      {
        type: "table",
        rows: [
          {
            type: "table-row",
            cells: [
              {
                type: "table-cell",
                style: {
                  borders: {
                    tl2br: {
                      type: "single",
                      sizeEighthPt: 8,
                      color: "#ff0000",
                    },
                    tr2bl: {
                      type: "single",
                      sizeEighthPt: 8,
                      color: "#00aa00",
                    },
                  },
                },
                nodes: [
                  {
                    type: "paragraph",
                    children: [{ type: "text", text: "X" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    const serialized = await serializeDocModel(model, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";
    expect(xml).toContain("<w:tcBorders>");
    expect(xml).toContain("<w:tl2br");
    expect(xml).toContain("<w:tr2bl");

    const reparsed = await parseDocx(await packageToArrayBuffer(serialized));
    const reparsedModel = await buildDocModel(reparsed);
    const tableNode = reparsedModel.nodes[0];
    expect(tableNode?.type).toBe("table");
    if (tableNode?.type === "table") {
      const firstCell = tableNode.rows[0]?.cells[0];
      expect(firstCell?.style?.borders?.tl2br?.type).toBe("single");
      expect(firstCell?.style?.borders?.tr2bl?.type).toBe("single");
    }
  });
});
