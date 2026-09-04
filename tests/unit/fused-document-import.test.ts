import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDocModel,
  buildDocModelFromBytes,
} from "@extend-ai/react-docx-doc-model";
import { parseDocx } from "@extend-ai/react-docx-ooxml-core";
import { createZip } from "./helpers/zip";

async function expectEquivalentImport(bytes: Uint8Array): Promise<void> {
  const buffer = Uint8Array.from(bytes).buffer;
  const pkg = await parseDocx(buffer);
  const expected = await buildDocModel(pkg);
  const padded = new Uint8Array(bytes.length + 14);
  padded.set(bytes, 7);
  const result = await buildDocModelFromBytes(
    padded.subarray(7, 7 + bytes.length)
  );
  expect(result.package).toEqual(pkg);
  expect(result.model).toEqual(expected);
  expect(result.timings.totalMs).toBeGreaterThanOrEqual(0);
  expect(result.timings.parseMs + result.timings.buildModelMs).toBeCloseTo(
    result.timings.totalMs,
    0
  );
  expect([...padded.subarray(7, 7 + bytes.length)]).toEqual([...bytes]);
}

describe("combined document import", () => {
  it("preserves OOXML content, break hints, and binary assets", async () => {
    await expectEquivalentImport(
      new Uint8Array(
        createZip([
          {
            name: "word/document.xml",
            content:
              '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Before</w:t><w:lastRenderedPageBreak/><w:t>After</w:t></w:r></w:p></w:body></w:document>',
          },
          {
            name: "word/media/asset.bin",
            content: new Uint8Array([0, 1, 127, 255]),
          },
        ])
      )
    );
  });

  it("preserves the converted legacy document and its diagnostics", async () => {
    await expectEquivalentImport(
      readFileSync(
        join(
          __dirname,
          "../../crates/docx-core/tests/fixtures-doc/word-authored-sample.doc"
        )
      )
    );
  });
});
