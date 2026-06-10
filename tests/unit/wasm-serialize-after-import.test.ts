import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDocModelFromBytes, cloneDocModel } from "@extend-ai/react-docx-doc-model";
import { serializeDocx } from "@extend-ai/react-docx-serializer";

const MA_DOC =
  "/Users/andrewluo/Downloads/62ad6b6dddfeac380ced43027982ca11e5950e2061a04b2398fbc5eef8248383.docx";

describe("wasm serialize after import", () => {
  it.skipIf(!existsSync(MA_DOC))(
    "serializes Massachusetts letterhead doc after clone",
    async () => {
      const bytes = readFileSync(MA_DOC);
      const { package: pkg, model } = await buildDocModelFromBytes(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        )
      );
      const cloned = cloneDocModel(model);
      const output = await serializeDocx(cloned, pkg);
      expect(output.byteLength).toBeGreaterThan(1000);
    }
  );
});
