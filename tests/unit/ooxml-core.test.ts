import { describe, expect, it } from "vitest";
import {
  createMinimalDocxPackage,
  getPart,
  packageToArrayBuffer,
  parseDocx
} from "@extend-ai/react-docx-ooxml-core";
import { createZip } from "./helpers/zip";

const DOCUMENT_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello DOCX</w:t></w:r></w:p></w:body></w:document>';

describe("ooxml-core", () => {
  it("throws on empty input", async () => {
    await expect(parseDocx(new ArrayBuffer(0))).rejects.toThrow("cannot be empty");
  });

  it("parses stored ZIP entries", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: "<Types/>" },
      { name: "word/document.xml", content: DOCUMENT_XML }
    ]);
    const pkg = await parseDocx(zip);

    expect(getPart(pkg, "word/document.xml")?.content).toContain("Hello DOCX");
  });

  it("parses deflated ZIP entries", async () => {
    const zip = createZip([
      { name: "[Content_Types].xml", content: "<Types/>", deflate: true },
      { name: "word/document.xml", content: DOCUMENT_XML, deflate: true }
    ]);
    const pkg = await parseDocx(zip);

    expect(getPart(pkg, "word/document.xml")?.content).toContain("Hello DOCX");
  });

  it("writes and re-parses DOCX ZIP archives", async () => {
    const source = createMinimalDocxPackage(DOCUMENT_XML);
    const zip = packageToArrayBuffer(source);
    const reparsed = await parseDocx(zip);

    expect(reparsed.parts.get("word/document.xml")?.content).toContain("Hello DOCX");
  });
});
