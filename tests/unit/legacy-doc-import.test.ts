import { describe, expect, it } from "vitest";
import { buildDocModelFromBytes } from "@extend-ai/react-docx-doc-model";
import { layoutDocument } from "@extend-ai/react-docx-layout-engine";
import { createLegacyDoc, createDocxTwin, LEGACY_PARAGRAPHS } from "./helpers/legacy-doc";

describe("legacy document import through wasm", () => {
  it("parses binary text into a model and lays it out", async () => {
    const { package: pkg, model } = await buildDocModelFromBytes(createLegacyDoc());
    expect([...pkg.parts.keys()]).toContain("word/document.xml");
    const text = JSON.stringify(model);
    for (const paragraph of LEGACY_PARAGRAPHS) expect(text).toContain(paragraph);
    const pages = layoutDocument(model, {});
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0].blocks.length).toBeGreaterThan(0);
  });

  it("produces equivalent page counts for binary and OOXML inputs", async () => {
    const doc = await buildDocModelFromBytes(createLegacyDoc());
    const docx = await buildDocModelFromBytes(await createDocxTwin());
    const docPages = layoutDocument(doc.model, {});
    const docxPages = layoutDocument(docx.model, {});
    expect(docPages.length).toBeGreaterThan(0);
    expect(docPages.length).toBe(docxPages.length);
  });
});
