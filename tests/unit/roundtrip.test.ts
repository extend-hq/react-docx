import { describe, expect, it } from "vitest";
import { createMinimalDocxPackage, packageToArrayBuffer, parseDocx } from "@extend-ai/react-docx-ooxml-core";
import { buildDocModel } from "@extend-ai/react-docx-doc-model";
import { insertParagraph, setParagraphHeading, setRunHighlight, toggleRunStyleFlag } from "@extend-ai/react-docx-editor-ops";
import { serializeDocModel, serializeDocx } from "@extend-ai/react-docx-serializer";

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

describe("round-trip", () => {
  it("builds model, edits it, then serializes back to document.xml", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_XML);
    const pkg = await parseDocx(packageToArrayBuffer(seed));
    const model = buildDocModel(pkg);
    const edited = insertParagraph(model, "Added by test", model.nodes.length, {
      paragraphStyle: { align: "center" },
      runStyle: { bold: true, color: "#0055aa", fontSizePt: 14 }
    });
    const headed = setParagraphHeading(edited, 1, 2);
    const highlighted = setRunHighlight(headed, 1, 0, "yellow");
    const styled = toggleRunStyleFlag(highlighted, 1, 0, "strike");
    const serialized = serializeDocModel(styled, pkg);

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
    const pkg = await parseDocx(packageToArrayBuffer(seed));
    const model = buildDocModel(pkg);
    const edited = insertParagraph(model, "Another paragraph");

    const exported = serializeDocx(edited, pkg);
    const reparsed = await parseDocx(exported);
    const reparsedModel = buildDocModel(reparsed);

    expect(reparsedModel.nodes.some((node) => node.children.some((run) => run.text.includes("Another paragraph")))).toBe(
      true
    );
  });

  it("serializes paragraph border definitions to pBdr", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_XML);
    const pkg = await parseDocx(packageToArrayBuffer(seed));
    const model = buildDocModel(pkg);

    model.nodes = [
      {
        type: "paragraph",
        style: {
          borders: {
            bottom: {
              type: "single",
              sizeEighthPt: 8,
              spacePt: 0,
              color: "#2f5496"
            }
          }
        },
        children: [
          {
            type: "text",
            text: "Border paragraph"
          }
        ]
      }
    ];

    const serialized = serializeDocModel(model, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";
    expect(xml).toContain("<w:pBdr>");
    expect(xml).toContain("<w:bottom");
    expect(xml).toContain('w:val="single"');
    expect(xml).toContain('w:sz="8"');
    expect(xml).toContain('w:color="2F5496"');
  });

  it("serializes parsed drop-cap metadata after editing paragraph text", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_WITH_DROP_CAP_XML);
    const pkg = await parseDocx(packageToArrayBuffer(seed));
    const model = buildDocModel(pkg);
    const paragraph = model.nodes[0];
    expect(paragraph?.type).toBe("paragraph");
    if (paragraph?.type !== "paragraph") {
      return;
    }

    paragraph.children = [
      {
        type: "text",
        text: "AB",
        style: paragraph.children[0]?.type === "text" ? paragraph.children[0].style : undefined
      }
    ];
    paragraph.sourceXml = undefined;

    const serialized = serializeDocModel(model, pkg);
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
    const pkg = await parseDocx(packageToArrayBuffer(seed));
    const model = buildDocModel(pkg);
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
        style: run.style
      }
    ];
    paragraph.sourceXml = undefined;

    const serialized = serializeDocModel(model, pkg);
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
    const pkg = await parseDocx(packageToArrayBuffer(seed));
    const model = buildDocModel(pkg);
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
        style: run.style
      }
    ];
    paragraph.sourceXml = undefined;

    const serialized = serializeDocModel(model, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";
    expect(xml).toContain('<w:color w:val="FFFFFF"/>');
    expect(xml).toContain('<w:shd w:val="clear" w:color="auto" w:fill="000000"/>');
    expect(xml).toContain("inverse video updated");
  });

  it("serializes hyperlink runs with hyperlink relationship entries", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_XML);
    const pkg = await parseDocx(packageToArrayBuffer(seed));
    const model = buildDocModel(pkg);

    model.nodes = [
      {
        type: "paragraph",
        children: [
          {
            type: "text",
            text: "OpenAI",
            link: "https://openai.com"
          }
        ]
      }
    ];

    const serialized = serializeDocModel(model, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";
    const rels = serialized.parts.get("word/_rels/document.xml.rels")?.content ?? "";

    expect(xml).toContain("<w:hyperlink");
    expect(xml).toContain("OpenAI");
    expect(rels).toContain("relationships/hyperlink");
    expect(rels).toContain('Target="https://openai.com"');
    expect(rels).toContain('TargetMode="External"');
  });

  it("serializes editable form-field runs back to SDT XML", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_XML);
    const pkg = await parseDocx(packageToArrayBuffer(seed));
    const model = buildDocModel(pkg);

    model.nodes = [
      {
        type: "paragraph",
        children: [
          {
            type: "form-field",
            fieldType: "checkbox",
            checked: true,
            checkedSymbol: "☒",
            uncheckedSymbol: "☐"
          },
          {
            type: "text",
            text: " Name: "
          },
          {
            type: "form-field",
            fieldType: "text",
            value: "Jane Doe"
          }
        ]
      }
    ];

    const serialized = serializeDocModel(model, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";
    expect(xml).toContain("<w:sdt>");
    expect(xml).toContain("<w14:checkbox>");
    expect(xml).toContain('w14:checked w14:val="1"');
    expect(xml).toContain("Jane Doe");
    expect(xml).toContain("mc:Ignorable");
  });

  it("preserves legacy form widgets when edited and exported", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_XML);
    const pkg = await parseDocx(packageToArrayBuffer(seed));
    const model = buildDocModel(pkg);

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
                sizePt: 10
              }
            }
          },
          {
            type: "text",
            text: " Name: "
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
                textFormat: "titleCase"
              }
            }
          }
        ]
      }
    ];

    const serialized = serializeDocModel(model, pkg);
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
    const pkg = await parseDocx(packageToArrayBuffer(seed));
    const model = buildDocModel(pkg);

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
                textFormat: "0.00"
              }
            }
          }
        ]
      }
    ];

    const serialized = serializeDocModel(model, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";
    expect(xml).toContain("<w:ffData>");
    expect(xml).toContain("FORMTEXT");
    expect(xml).toContain('<w:type w:val="number"/>');
    expect(xml).toContain('<w:default w:val="0"/>');
    expect(xml).toContain('<w:maxLength w:val="8"/>');
    expect(xml).toContain('<w:format w:val="0.00"/>');

    const reparsed = await parseDocx(packageToArrayBuffer(serialized));
    const reparsedModel = buildDocModel(reparsed);
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
    const pkg = await parseDocx(packageToArrayBuffer(seed));
    const model = buildDocModel(pkg);

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
                inputType: "number"
              }
            }
          }
        ]
      }
    ];

    const serialized = serializeDocModel(model, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";
    expect(xml).toContain('<w:type w:val="number"/>');
    expect(xml).toContain('<w:default w:val="0"/>');
    expect(xml).toContain('<w:format w:val="0"/>');
  });

  it("serializes floating anchored images with center alignment", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_XML);
    const pkg = await parseDocx(packageToArrayBuffer(seed));
    const model = buildDocModel(pkg);

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
              zIndex: 251660288
            }
          }
        ]
      }
    ];

    const serialized = serializeDocModel(model, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";
    expect(xml).toContain("<wp:anchor");
    expect(xml).toContain('<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>');
    expect(xml).toContain('<wp:positionV relativeFrom="paragraph"><wp:posOffset>9525</wp:posOffset></wp:positionV>');
    expect(xml).toContain("<wp:wrapTopAndBottom/>");
    expect(xml).toContain('<wp:extent cx="247650" cy="247650"/>');

    const reparsed = await parseDocx(packageToArrayBuffer(serialized));
    const reparsedModel = buildDocModel(reparsed);
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
      content: DOCUMENT_RELS_WITH_HEADER
    });
    seed.parts.set("word/header1.xml", {
      name: "word/header1.xml",
      content: HEADER_XML
    });
    const contentTypes = seed.parts.get("[Content_Types].xml")?.content ?? "";
    if (!/PartName="\/word\/header1\.xml"/i.test(contentTypes)) {
      seed.parts.set("[Content_Types].xml", {
        name: "[Content_Types].xml",
        content: contentTypes.replace(
          "</Types>",
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'
        )
      });
    }

    const pkg = await parseDocx(packageToArrayBuffer(seed));
    const model = buildDocModel(pkg);
    expect(model.metadata.headerSections[0]?.partName).toBe("word/header1.xml");

    model.metadata.headerSections = [
      {
        ...(model.metadata.headerSections[0] ?? {
          partName: "word/header1.xml",
          referenceType: "default" as const
        }),
        nodes: [
          {
            type: "paragraph",
            children: [{ type: "text", text: "Updated Header" }]
          }
        ]
      }
    ];

    const serialized = serializeDocModel(model, pkg);
    const headerXml = serialized.parts.get("word/header1.xml")?.content ?? "";
    expect(headerXml).toContain("Updated Header");
    expect(headerXml).not.toContain("Original Header");
  });

  it("preserves table row cantSplit metadata", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_XML);
    const pkg = await parseDocx(packageToArrayBuffer(seed));
    const model = buildDocModel(pkg);

    model.nodes = [
      {
        type: "table",
        style: {
          widthTwips: 5000,
          layout: "fixed",
          columnWidthsTwips: [5000]
        },
        rows: [
          {
            type: "table-row",
            style: {
              heightTwips: 720,
              heightRule: "atLeast",
              cantSplit: true
            },
            cells: [
              {
                type: "table-cell",
                nodes: [
                  {
                    type: "paragraph",
                    children: [{ type: "text", text: "Row 1" }]
                  }
                ]
              }
            ]
          }
        ]
      }
    ];

    const serialized = serializeDocModel(model, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";
    expect(xml).toContain("<w:cantSplit/>");

    const reparsed = await parseDocx(packageToArrayBuffer(serialized));
    const reparsedModel = buildDocModel(reparsed);
    const tableNode = reparsedModel.nodes[0];
    expect(tableNode?.type).toBe("table");
    if (tableNode?.type === "table") {
      expect(tableNode.rows[0]?.style?.cantSplit).toBe(true);
      expect(tableNode.rows[0]?.style?.heightRule).toBe("atLeast");
    }
  });

  it("round-trips diagonal table cell borders", async () => {
    const seed = createMinimalDocxPackage(DOCUMENT_XML);
    const pkg = await parseDocx(packageToArrayBuffer(seed));
    const model = buildDocModel(pkg);

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
                    tl2br: { type: "single", sizeEighthPt: 8, color: "#ff0000" },
                    tr2bl: { type: "single", sizeEighthPt: 8, color: "#00aa00" }
                  }
                },
                nodes: [
                  {
                    type: "paragraph",
                    children: [{ type: "text", text: "X" }]
                  }
                ]
              }
            ]
          }
        ]
      }
    ];

    const serialized = serializeDocModel(model, pkg);
    const xml = serialized.parts.get("word/document.xml")?.content ?? "";
    expect(xml).toContain("<w:tcBorders>");
    expect(xml).toContain("<w:tl2br");
    expect(xml).toContain("<w:tr2bl");

    const reparsed = await parseDocx(packageToArrayBuffer(serialized));
    const reparsedModel = buildDocModel(reparsed);
    const tableNode = reparsedModel.nodes[0];
    expect(tableNode?.type).toBe("table");
    if (tableNode?.type === "table") {
      const firstCell = tableNode.rows[0]?.cells[0];
      expect(firstCell?.style?.borders?.tl2br?.type).toBe("single");
      expect(firstCell?.style?.borders?.tr2bl?.type).toBe("single");
    }
  });
});
