import type { OoxmlPackage } from "@extend-ai/react-docx-ooxml-core";
import {
  mapsToWasmPackage,
  wasmBuildDocModelFromPackage,
  wasmPackageToMaps
} from "@extend-ai/react-docx-wasm";

import { normalizeDocModel } from "./normalize";
import type { DocModel } from "./types";

export * from "./types";
export { cloneDocModel } from "./clone";
export { normalizeDocModel } from "./normalize";

export async function buildDocModel(pkg: OoxmlPackage): Promise<DocModel> {
  const wasmPackage = mapsToWasmPackage({
    parts: pkg.parts,
    binaryAssets: pkg.binaryAssets
  });
  const model = (await wasmBuildDocModelFromPackage(wasmPackage)) as DocModel;
  return normalizeDocModel(model);
}

export async function buildDocModelFromBytes(bytes: ArrayBuffer | Uint8Array): Promise<{
  package: OoxmlPackage;
  model: DocModel;
}> {
  const { parseDocx } = await import("@extend-ai/react-docx-ooxml-core");
  const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const buffer =
    payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer;
  const pkg = await parseDocx(buffer);
  const model = await buildDocModel(pkg);
  return { package: pkg, model };
}
