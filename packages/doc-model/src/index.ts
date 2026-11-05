import type { OoxmlPackage } from "@extend-ai/react-docx-ooxml-core";
import {
  mapsToWasmPackage,
  wasmBuildDocModelFromBytes,
  wasmBuildDocModelFromPackage,
  wasmPackageToMaps,
  type DocxParseOptions
} from "@extend-ai/react-docx-wasm";

import { normalizeDocModel } from "./normalize";
import type { DocModel } from "./types";

export * from "./types";
export type { DocxParseOptions } from "@extend-ai/react-docx-wasm";
export { resolveImagePaintBounds, type ImagePaintRect } from "./image-paint";
export * from "./blocks";
export * from "./review";
export { resolveTableGridSkipCount, tableGridColumnBound, tableRowGridSkipCount } from "./table-grid";
export {
  projectCollapsedTableGrid,
  materializeCollapsedTableGrid,
  type GridTable,
  type GridProjectionOptions,
  type GridProjectionResult,
  type LogicalBoundaryRange,
} from "./table-grid-projection";
export {
  allocateBlockId,
  collectDuplicateDocModelBlockIds,
  ensureDocModelBlockIds
} from "./block-id";
export { cloneDocModel, cloneFormFieldSourcePreview, cloneParagraphMarkFormatting, cloneParagraphNode, cloneTableNode } from "./clone";
export { invalidateFormFieldSource, resolveFormFieldSourcePreview } from "./form-field";
export { deepFreezeDocModel } from "./freeze";
export { normalizeDocModel } from "./normalize";

export async function buildDocModel(pkg: OoxmlPackage, options?: DocxParseOptions): Promise<DocModel> {
  const wasmPackage = mapsToWasmPackage({
    parts: pkg.parts,
    binaryAssets: pkg.binaryAssets,
    warnings: pkg.warnings
  });
  const model = (await wasmBuildDocModelFromPackage(wasmPackage, options)) as DocModel;
  return normalizeDocModel(model);
}

export async function buildDocModelFromBytes(bytes: ArrayBuffer | Uint8Array, options?: DocxParseOptions): Promise<{
  package: OoxmlPackage;
  model: DocModel;
  timings: { parseMs: number; buildModelMs: number; totalMs: number };
}> {
  const startedAt = performance.now();
  const result = await wasmBuildDocModelFromBytes(bytes, options);
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
