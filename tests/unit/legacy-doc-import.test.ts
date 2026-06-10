import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDocModelFromBytes } from "@extend-ai/react-docx-doc-model";
import { layoutDocument } from "@extend-ai/react-docx-layout-engine";

const FIXTURES = join(__dirname, "../../crates/docx-core/tests/fixtures-doc");

function fixtureBuffer(name: string): ArrayBuffer {
  const bytes = readFileSync(join(FIXTURES, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe("legacy .doc import through wasm", () => {
  it("parses a Word 97 binary file into a DocModel and lays it out", async () => {
    const { package: pkg, model } = await buildDocModelFromBytes(
      fixtureBuffer("Downloadable-Word-Invoice-Template.doc")
    );
    const partNames =
      pkg.parts instanceof Map ? [...pkg.parts.keys()] : Object.keys(pkg.parts);
    expect(partNames).toContain("word/document.xml");

    const docModel = model as {
      nodes: Array<{ type?: string }>;
      metadata: { warnings: string[] };
    };
    expect(docModel.nodes.length).toBeGreaterThan(0);

    const text = JSON.stringify(model).toLowerCase();
    expect(text).toContain("invoice");

    const pages = layoutDocument(model as never, {});
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0].blocks.length).toBeGreaterThan(0);
  });

  it("produces equivalent page counts for a .doc and its .docx twin", async () => {
    const twins = ["DOCX_TestPage", "patient_original (3)"];
    for (const base of twins) {
      const docResult = await buildDocModelFromBytes(fixtureBuffer(`${base}.doc`));
      const docxResult = await buildDocModelFromBytes(fixtureBuffer(`${base}.docx`));
      const docPages = layoutDocument(docResult.model as never, {}).length;
      const docxPages = layoutDocument(docxResult.model as never, {}).length;
      expect(Math.abs(docPages - docxPages)).toBeLessThanOrEqual(1);
    }
  });
});
