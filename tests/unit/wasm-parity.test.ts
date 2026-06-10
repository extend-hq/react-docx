import { describe, expect, it } from "vitest";
import { buildDocModelFromBytes, cloneDocModel } from "@extend-ai/react-docx-doc-model";
import { createMinimalDocxPackage, packageToArrayBuffer } from "@extend-ai/react-docx-ooxml-core";

async function buildFromDocumentXml(documentXml: string) {
  const seed = createMinimalDocxPackage(documentXml);
  const bytes = await packageToArrayBuffer(seed);
  return buildDocModelFromBytes(bytes);
}

describe("wasm parser parity", () => {
  it("preserves sourceXml substrings used by pagination", async () => {
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>
    <w:p><w:r><w:lastRenderedPageBreak/><w:t>After break</w:t></w:r></w:p>
  </w:body>
</w:document>`;

    const { model } = await buildFromDocumentXml(documentXml);
    const sourceXmlValues = model.nodes
      .filter((node) => node.type === "paragraph")
      .map((node) => node.sourceXml)
      .filter(Boolean);

    expect(sourceXmlValues.some((xml) => xml?.includes("w:br"))).toBe(true);
    expect(sourceXmlValues.some((xml) => xml?.includes("lastRenderedPageBreak"))).toBe(true);
  });

  it("cloneDocModel remains usable on wasm output", async () => {
    const documentXml =
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>';
    const { model } = await buildFromDocumentXml(documentXml);
    const cloned = cloneDocModel(model);
    expect(cloned.nodes[0]?.type).toBe("paragraph");
  });
});
