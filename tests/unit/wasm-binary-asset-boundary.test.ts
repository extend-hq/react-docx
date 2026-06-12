import { describe, expect, it } from "vitest";
import {
  wasmPackageToArrayBuffer,
  wasmPackageToMaps,
  wasmParseDocx,
  type LegacyWasmOoxmlPackage,
  type WasmOoxmlPackage,
} from "@extend-ai/react-docx-wasm";
import { createZip } from "./helpers/zip";

const PNG_BYTES = [137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3, 254, 255];

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Asset boundary</w:t></w:r></w:p></w:body>
</w:document>`;

function minimalParts(): WasmOoxmlPackage["parts"] {
  return {
    "[Content_Types].xml": {
      name: "[Content_Types].xml",
      content: CONTENT_TYPES_XML,
    },
    "word/document.xml": { name: "word/document.xml", content: DOCUMENT_XML },
  };
}

describe("wasm binary asset boundary", () => {
  it("round-trips a legacy number[] asset through serialize and parse", async () => {
    const legacy: LegacyWasmOoxmlPackage = {
      parts: minimalParts(),
      binaryAssets: { "word/media/image1.png": [...PNG_BYTES] },
    };

    const bytes = await wasmPackageToArrayBuffer(
      legacy as unknown as WasmOoxmlPackage
    );
    const reparsed = await wasmParseDocx(bytes);

    expect(reparsed.binaryAssets["word/media/image1.png"]).toBeInstanceOf(
      Uint8Array
    );
    expect([...reparsed.binaryAssets["word/media/image1.png"]]).toEqual(
      PNG_BYTES
    );
  });

  it("accepts a prototype-less binaryAssets dictionary", async () => {
    const assets: Record<string, Uint8Array> = Object.assign(
      Object.create(null),
      { "word/media/image1.png": Uint8Array.from(PNG_BYTES) }
    );
    const bytes = await wasmPackageToArrayBuffer({
      parts: minimalParts(),
      binaryAssets: assets,
    });
    const reparsed = await wasmParseDocx(bytes);
    expect([...reparsed.binaryAssets["word/media/image1.png"]]).toEqual(
      PNG_BYTES
    );
  });

  it("preserves a binary asset whose zip entry is named __proto__", async () => {
    const zipped = createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "word/document.xml", content: DOCUMENT_XML },
      { name: "__proto__", content: Uint8Array.from(PNG_BYTES) },
    ]);

    const parsed = await wasmParseDocx(zipped);
    const { binaryAssets } = wasmPackageToMaps(parsed);
    expect([...(binaryAssets.get("__proto__") ?? [])]).toEqual(PNG_BYTES);
  });

  it("converts legacy number[] assets to Uint8Array in wasmPackageToMaps", () => {
    const { binaryAssets } = wasmPackageToMaps({
      parts: {},
      binaryAssets: { "word/media/a.bin": [...PNG_BYTES] },
    });
    const asset = binaryAssets.get("word/media/a.bin");
    expect(asset).toBeInstanceOf(Uint8Array);
    expect([...(asset ?? [])]).toEqual(PNG_BYTES);
  });

  it("rejects packages missing parts or binaryAssets instead of emptying them", async () => {
    await expect(
      wasmPackageToArrayBuffer({
        parts: minimalParts(),
      } as unknown as WasmOoxmlPackage)
    ).rejects.toThrow(/missing field `binaryAssets`/);

    await expect(
      wasmPackageToArrayBuffer({
        binaryAssets: {},
      } as unknown as WasmOoxmlPackage)
    ).rejects.toThrow(/missing field `parts`/);
  });
});
