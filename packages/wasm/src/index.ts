import type { InitInput, InitOutput } from "./generated/docx_wasm.js";
import wasmInit, {
  build_doc_model_from_bytes,
  build_doc_model_from_package,
  model_to_document_xml_from_json_wasm,
  package_to_array_buffer_wasm,
  parse_docx_wasm,
  serialize_docx_from_json_wasm,
  serialize_docx_wasm
} from "./generated/docx_wasm.js";

export type WasmSource = InitInput;

let initPromise: Promise<InitOutput> | undefined;
let overrideSource: WasmSource | undefined;

/**
 * Override where the `docx_wasm_bg.wasm` binary is loaded from (URL, Response,
 * bytes, or a compiled module). Must be called before the first operation that
 * touches WASM; by default the binary shipped alongside this package is used.
 */
export function setWasmSource(source: WasmSource): void {
  if (initPromise) {
    throw new Error(
      "react-docx: setWasmSource must be called before the first parse/serialize call initializes WASM"
    );
  }
  overrideSource = source;
}

interface FsPromisesLike {
  readFile(path: URL): Promise<Uint8Array>;
}

// Resolve node:fs/promises without a static or dynamic `import("node:...")`
// in the module graph — browser bundlers must never see the specifier or
// they fail the consumer's build.
async function nodeFsPromises(): Promise<FsPromisesLike> {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  if (typeof proc?.getBuiltinModule === "function") {
    return proc.getBuiltinModule("node:fs/promises") as FsPromisesLike;
  }
  // Node < 22.3 fallback; never executed in browsers.
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string
  ) => Promise<FsPromisesLike>;
  return dynamicImport("node:fs/promises");
}

async function defaultWasmSource(): Promise<WasmSource> {
  const wasmUrl = new URL("./docx_wasm_bg.wasm", import.meta.url);
  if (wasmUrl.protocol === "file:") {
    const fs = await nodeFsPromises();
    return fs.readFile(wasmUrl);
  }
  const response = await fetch(wasmUrl);
  if (!response.ok) {
    throw new Error(
      `react-docx: failed to load the bundled WebAssembly binary from ${wasmUrl.href} ` +
        `(${response.status} ${response.statusText}). If your bundler did not emit this asset, ` +
        "import @extend-ai/react-docx/docx_wasm_bg.wasm?url and pass it to setWasmSource() before importing a document."
    );
  }
  return response;
}

export async function initWasm(source?: WasmSource): Promise<InitOutput> {
  if (!initPromise) {
    const chosen = source ?? overrideSource;
    initPromise = (chosen !== undefined ? Promise.resolve(chosen) : defaultWasmSource())
      .then((module_or_path) => wasmInit({ module_or_path }))
      .catch((error: unknown) => {
        if (error instanceof WebAssembly.CompileError) {
          throw new Error(
            "react-docx: the bundled WebAssembly binary failed to compile. It requires " +
              "WebAssembly SIMD support (Chrome 91+, Firefox 89+, Safari 16.4+, Node 16.4+). " +
              `Original error: ${error.message}`,
            { cause: error }
          );
        }
        throw error;
      });
  }
  return initPromise;
}

export interface WasmOoxmlPart {
  name: string;
  content: string;
}

export interface WasmOoxmlPackage {
  parts: Record<string, WasmOoxmlPart>;
  binaryAssets: Record<string, Uint8Array>;
}

/** Package shape produced by pre-Uint8Array versions of this library. */
export interface LegacyWasmOoxmlPackage {
  parts: Record<string, WasmOoxmlPart>;
  binaryAssets: Record<string, number[]>;
}

function toUint8Array(value: number[] | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : Uint8Array.from(value);
}

export function docModelToWasmJson(model: unknown): string {
  return JSON.stringify(model, (_key, value) => {
    if (value instanceof Uint8Array) {
      return Array.from(value);
    }
    return value;
  });
}

export function wasmPackageToMaps(raw: WasmOoxmlPackage | LegacyWasmOoxmlPackage): {
  parts: Map<string, WasmOoxmlPart>;
  binaryAssets: Map<string, Uint8Array>;
} {
  const parts = new Map<string, WasmOoxmlPart>();
  for (const [name, part] of Object.entries(raw.parts ?? {})) {
    parts.set(name, {
      name: part.name ?? name,
      content: part.content
    });
  }

  const binaryAssets = new Map<string, Uint8Array>();
  for (const [name, asset] of Object.entries(raw.binaryAssets ?? {})) {
    binaryAssets.set(name, toUint8Array(asset));
  }

  return { parts, binaryAssets };
}

export function mapsToWasmPackage(input: {
  parts: Map<string, WasmOoxmlPart>;
  binaryAssets: Map<string, Uint8Array>;
}): WasmOoxmlPackage {
  const parts: Record<string, WasmOoxmlPart> = {};
  for (const [name, part] of input.parts.entries()) {
    parts[name] = {
      name: part.name,
      content: part.content
    };
  }

  // Buffers are shared, not copied; the wasm boundary copies on read and JS
  // callers already treat package asset buffers as immutable.
  const binaryAssets: Record<string, Uint8Array> = {};
  for (const [name, asset] of input.binaryAssets.entries()) {
    binaryAssets[name] = asset;
  }

  return { parts, binaryAssets };
}

export async function wasmParseDocx(bytes: ArrayBuffer | Uint8Array): Promise<WasmOoxmlPackage> {
  await initWasm();
  const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return parse_docx_wasm(payload) as WasmOoxmlPackage;
}

export async function wasmBuildDocModelFromPackage(pkg: WasmOoxmlPackage): Promise<unknown> {
  await initWasm();
  const json = build_doc_model_from_package(pkg);
  return JSON.parse(json) as unknown;
}

export async function wasmBuildDocModelFromBytes(bytes: ArrayBuffer | Uint8Array): Promise<{
  package: WasmOoxmlPackage;
  model: unknown;
}> {
  await initWasm();
  const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return build_doc_model_from_bytes(payload) as { package: WasmOoxmlPackage; model: unknown };
}

export async function wasmSerializeDocx(
  model: unknown,
  basePackage?: WasmOoxmlPackage
): Promise<ArrayBuffer> {
  await initWasm();
  const modelJson = docModelToWasmJson(model);
  const bytes = serialize_docx_from_json_wasm(modelJson, basePackage ?? null);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function wasmModelToDocumentXml(
  model: unknown,
  basePackage?: WasmOoxmlPackage
): Promise<string> {
  await initWasm();
  return model_to_document_xml_from_json_wasm(docModelToWasmJson(model), basePackage ?? null);
}

export async function wasmPackageToArrayBuffer(pkg: WasmOoxmlPackage): Promise<ArrayBuffer> {
  await initWasm();
  const bytes = package_to_array_buffer_wasm(pkg);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export {
  build_doc_model_from_bytes,
  build_doc_model_from_package,
  model_to_document_xml_from_json_wasm,
  package_to_array_buffer_wasm,
  parse_docx_wasm,
  serialize_docx_from_json_wasm,
  serialize_docx_wasm
};
