import type { OoxmlPackage } from "@extend-ai/react-docx-ooxml-core";
import {
  mapsToWasmPackage,
  wasmBuildDocModelFromBytes,
  wasmBuildDocModelFromPackage,
  wasmPackageToMaps
} from "@extend-ai/react-docx-wasm";

import { normalizeDocModel } from "./normalize";
import type { DocModel } from "./types";

export * from "./types";
export {
  allocateBlockId,
  collectDuplicateDocModelBlockIds,
  ensureDocModelBlockIds
} from "./block-id";
export { cloneDocModel, cloneParagraphNode, cloneTableNode } from "./clone";
export { deepFreezeDocModel } from "./freeze";
export { normalizeDocModel } from "./normalize";

export async function buildDocModel(pkg: OoxmlPackage): Promise<DocModel> {
  const wasmPackage = mapsToWasmPackage({
    parts: pkg.parts,
    binaryAssets: pkg.binaryAssets,
    warnings: pkg.warnings
  });
  const model = (await wasmBuildDocModelFromPackage(wasmPackage)) as DocModel;
  return normalizeDocModel(model);
}

export async function buildDocModelFromBytes(bytes: ArrayBuffer | Uint8Array): Promise<{
  package: OoxmlPackage;
  model: DocModel;
  timings: { parseMs: number; buildModelMs: number; totalMs: number };
}> {
  const startedAt = performance.now();
  const result = await wasmBuildDocModelFromBytes(bytes);
  const builtAt = performance.now();
  const { parts, binaryAssets, warnings } = wasmPackageToMaps(result.package);
  const pkg = { parts, binaryAssets, ...(warnings.length > 0 ? { warnings } : {}) };
  const model = normalizeDocModel(result.model as DocModel);
  const finishedAt = performance.now();
  const buildModelMs = result.timings.buildModelMs + finishedAt - builtAt;
  return {
    package: pkg,
    model,
    timings: {
      parseMs: Math.max(0, builtAt - startedAt - result.timings.buildModelMs),
      buildModelMs,
      totalMs: finishedAt - startedAt,
    },
  };
}
