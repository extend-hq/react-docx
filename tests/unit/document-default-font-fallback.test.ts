import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "../../packages/doc-model/src";
import { parseDocx } from "../../packages/ooxml-core/src";
import {
  DocxEditorViewer,
  useDocxEditor,
} from "../../packages/react-viewer/src/editor";
import { createZip } from "./helpers/zip";

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const FONTLESS_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Fontless body</w:t></w:r></w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const EXPLICIT_FONT_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr>
        <w:t>Explicit body</w:t>
      </w:r>
    </w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

function ImportedViewer({
  model,
}: {
  model: Awaited<ReturnType<typeof buildDocModel>>;
}): React.JSX.Element {
  const editor = useDocxEditor({ starterModel: model });
  return React.createElement(DocxEditorViewer, {
    editor,
    mode: "read-only",
    deferInitialPaginationPaint: false,
  });
}

async function renderDoc(documentXml: string): Promise<string> {
  const zip = createZip([
    { name: "[Content_Types].xml", content: CONTENT_TYPES_XML, deflate: true },
    { name: "_rels/.rels", content: ROOT_RELS_XML, deflate: true },
    { name: "word/document.xml", content: documentXml, deflate: true },
  ]);
  const pkg = await parseDocx(zip);
  const model = buildDocModel(pkg);
  return renderToStaticMarkup(React.createElement(ImportedViewer, { model }));
}

describe("document default font fallback", () => {
  it("uses Times New Roman for imported docs with no declared fonts", async () => {
    const html = await renderDoc(FONTLESS_DOCUMENT_XML);

    expect(html).toMatch(
      /data-docx-page-surface="true"[^>]*style="[^"]*font-family:&quot;Times New Roman&quot;, serif[^"]*"/
    );
  });

  it("does not force the Times fallback when the document already declares a font", async () => {
    const html = await renderDoc(EXPLICIT_FONT_DOCUMENT_XML);

    expect(html).not.toMatch(
      /data-docx-page-surface="true"[^>]*style="[^"]*font-family:&quot;Times New Roman&quot;, serif[^"]*"/
    );
    expect(html).toContain("Calibri");
  });
});
