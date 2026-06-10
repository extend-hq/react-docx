import { describe, expect, it } from "vitest";
import type { DocModel } from "@extend-ai/react-docx-doc-model";
import { buildDocModel } from "@extend-ai/react-docx-doc-model";
import { parseDocx } from "@extend-ai/react-docx-ooxml-core";
import {
  collectTableExplicitPageBreakInfo,
  collectTopLevelExplicitPageBreakStartNodeIndexes
} from "../../packages/react-viewer/src/pagination-breaks";
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

async function buildModelFromDocumentXml(documentXml: string) {
  const pkg = await parseDocx(
    createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: documentXml }
    ])
  );
  return await buildDocModel(pkg);
}

describe("pagination-breaks", () => {
  it("honors imported style-based pageBreakBefore as a hard break", () => {
    const nodes: DocModel["nodes"] = [
      {
        type: "paragraph",
        children: [{ type: "text", text: "Intro" }]
      },
      {
        type: "paragraph",
        style: { pageBreakBefore: true },
        children: [{ type: "text", text: "Starts next page" }]
      }
    ];

    expect([...collectTopLevelExplicitPageBreakStartNodeIndexes(nodes)]).toEqual([1]);
  });

  it("keeps page breaks inside table rows as row boundaries instead of breaks after the table", async () => {
    const model = await buildModelFromDocumentXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Before break</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:br w:type="page"/></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>After break</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>
    <w:p><w:r><w:t>Next top-level paragraph</w:t></w:r></w:p>
  </w:body>
</w:document>`);

    const table = model.nodes[0];
    expect(table?.type).toBe("table");
    if (!table || table.type !== "table") {
      return;
    }

    expect(collectTableExplicitPageBreakInfo(table)).toEqual({
      startRowIndexes: [1],
      breakAfterTable: false
    });
    expect([...collectTopLevelExplicitPageBreakStartNodeIndexes(model.nodes)]).toEqual([2]);
  });

  it("treats a last-row page break with visible row content as a break after the table", async () => {
    const model = await buildModelFromDocumentXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Only row</w:t><w:br w:type="page"/></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
    <w:p><w:r><w:t>After table</w:t></w:r></w:p>
  </w:body>
</w:document>`);

    const table = model.nodes[0];
    expect(table?.type).toBe("table");
    if (!table || table.type !== "table") {
      return;
    }

    expect(collectTableExplicitPageBreakInfo(table)).toEqual({
      startRowIndexes: [],
      breakAfterTable: true
    });
    expect([...collectTopLevelExplicitPageBreakStartNodeIndexes(model.nodes)]).toEqual([1]);
  });

  it("starts a new page before a table when its first row is a page-break-only row", async () => {
    const model = await buildModelFromDocumentXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Intro</w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:br w:type="page"/></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Table body</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
    <w:p><w:r><w:t>After table</w:t></w:r></w:p>
  </w:body>
</w:document>`);

    const table = model.nodes[1];
    expect(table?.type).toBe("table");
    if (!table || table.type !== "table") {
      return;
    }

    expect(collectTableExplicitPageBreakInfo(table)).toEqual({
      startRowIndexes: [0],
      breakAfterTable: false
    });
    expect([...collectTopLevelExplicitPageBreakStartNodeIndexes(model.nodes)]).toEqual([1]);
  });

  it("ignores a first-row break-only cell when the same row already has real content", async () => {
    const model = await buildModelFromDocumentXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Intro</w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc>
          <w:p><w:r><w:br w:type="page"/></w:r></w:p>
          <w:p/>
        </w:tc>
        <w:tc>
          <w:p><w:r><w:t>Visible row content</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
    <w:p><w:r><w:t>After table</w:t></w:r></w:p>
  </w:body>
</w:document>`);

    const table = model.nodes[1];
    expect(table?.type).toBe("table");
    if (!table || table.type !== "table") {
      return;
    }

    expect(collectTableExplicitPageBreakInfo(table)).toEqual({
      startRowIndexes: [],
      breakAfterTable: false
    });
    expect([...collectTopLevelExplicitPageBreakStartNodeIndexes(model.nodes)]).toEqual([]);
  });

  it("treats a single-row signature-style table break-only cell as a break before the table", async () => {
    const model = await buildModelFromDocumentXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Intro</w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc>
          <w:p><w:r><w:br w:type="page"/></w:r></w:p>
          <w:p/>
        </w:tc>
        <w:tc>
          <w:p/>
        </w:tc>
        <w:tc>
          <w:p/>
        </w:tc>
        <w:tc>
          <w:p><w:r><w:t>Very truly yours,</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
    <w:p><w:r><w:t>After table</w:t></w:r></w:p>
  </w:body>
</w:document>`);

    const table = model.nodes[1];
    expect(table?.type).toBe("table");
    if (!table || table.type !== "table") {
      return;
    }

    expect(collectTableExplicitPageBreakInfo(table)).toEqual({
      startRowIndexes: [0],
      breakAfterTable: false
    });
    expect([...collectTopLevelExplicitPageBreakStartNodeIndexes(model.nodes)]).toEqual([1]);
  });
});
