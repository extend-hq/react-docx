/**
 * Legacy TS parser comparison runs in isolation because loading the ~9k-line
 * reference module in the same Vitest worker can destabilize WASM init.
 */
import { describe, expect, it } from "vitest";
import { buildDocModelFromBytes, type DocModel } from "@extend-ai/react-docx-doc-model";
import { createMinimalDocxPackage, packageToArrayBuffer } from "@extend-ai/react-docx-ooxml-core";

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, current) => {
    if (current instanceof Map) {
      return Object.fromEntries(current.entries());
    }
    if (current instanceof Uint8Array) {
      return { __uint8array__: Array.from(current) };
    }
    return current;
  });
}

function normalizeForCompare(model: DocModel): DocModel {
  return JSON.parse(stableStringify(model));
}

describe("wasm vs legacy parser", () => {
  it("matches legacy parser for a styled paragraph and table fixture", async () => {
    const { buildDocModel: buildDocModelLegacy } = await import("@reference/ts-doc-model-legacy");
    const { parseDocx: parseDocxLegacy } = await import("@reference/ts-ooxml-core-legacy");

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>Red text</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body>
</w:document>`;

    const seed = createMinimalDocxPackage(documentXml);
    const bytes = await packageToArrayBuffer(seed);

    const legacyPkg = await parseDocxLegacy(bytes);
    const legacy = normalizeForCompare(buildDocModelLegacy(legacyPkg));
    const wasm = normalizeForCompare((await buildDocModelFromBytes(bytes)).model);

    expect(stableStringify(wasm)).toBe(stableStringify(legacy));
  });
});
