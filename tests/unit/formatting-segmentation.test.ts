import { describe, expect, it } from "vitest";
import { buildDocModelFromBytes } from "@extend-ai/react-docx-doc-model";
import { createMinimalDocxPackage, packageToArrayBuffer } from "@extend-ai/react-docx-ooxml-core";

describe("formatting across equivalent run boundaries", () => {
  it.each(["b", "i"])("preserves every marked character for %s", async (property) => {
    for (const fragments of [["ABCDEFGH"], ["ABCD", "EFGH"], [..."ABCDEFGH"]]) {
      const runs = fragments.map(text => `<w:r><w:rPr><w:${property}/></w:rPr><w:t>${text}</w:t></w:r>`).join("");
      const bytes = await packageToArrayBuffer(createMinimalDocxPackage(
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>${runs}</w:p></w:body></w:document>`,
      ));
      const { model } = await buildDocModelFromBytes(bytes);
      const paragraph = model.nodes[0];
      expect(paragraph.type).toBe("paragraph");
      if (paragraph.type !== "paragraph") throw new Error("Expected a paragraph");
      const textRuns = paragraph.children.filter(child => child.type === "text");
      expect(textRuns.map(run => run.text).join("")).toBe("ABCDEFGH");
      for (const run of textRuns) {
        expect(run.style?.[property === "b" ? "bold" : "italic"]).toBe(true);
      }
    }
  });
});
