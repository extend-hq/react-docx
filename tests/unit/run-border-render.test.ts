import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "../../packages/doc-model/src";
import { parseDocx } from "../../packages/ooxml-core/src";
import {
  DocxEditorViewer,
  useDocxEditor
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

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t>Some text in a </w:t></w:r>
      <w:r>
        <w:rPr><w:bdr w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:rPr>
        <w:t>box</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

const SHADED_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:rPr>
          <w:color w:val="FFFFFF"/>
          <w:shd w:val="clear" w:color="auto" w:fill="000000"/>
        </w:rPr>
        <w:t>inverse video</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

function ImportedViewer({
  model
}: {
  model: Awaited<ReturnType<typeof buildDocModel>>;
}): React.JSX.Element {
  const editor = useDocxEditor({ starterModel: model });
  return React.createElement(DocxEditorViewer, { editor });
}

describe("run border render", () => {
  it("renders run borders as inline boxed text", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: DOCUMENT_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model }));

    expect(html).toContain(">box<");
    expect(html).toMatch(/border-style:solid/i);
    expect(html).toMatch(/display:inline-block/i);
  });

  it("renders run shading as inline background color", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: SHADED_DOCUMENT_XML }
    ]);

    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const html = renderToStaticMarkup(React.createElement(ImportedViewer, { model }));

    expect(html).toContain(">inverse video<");
    expect(html).toMatch(/background-color:#000000/i);
    expect(html).toMatch(/color:#ffffff/i);
  });
});
