import type { InitOutput } from "./generated/docx_wasm.js";
import wasmInit, {
  build_doc_model_from_bytes,
  build_doc_model_from_package,
  model_to_document_xml_from_json_wasm,
  package_to_array_buffer_wasm,
  parse_docx_wasm,
  serialize_docx_from_json_wasm,
  serialize_docx_wasm
} from "./generated/docx_wasm.js";
import { WASM_BYTES_BASE64 } from "./wasm-bytes.js";

let initPromise: Promise<InitOutput> | undefined;

function wasmModuleInput(): Uint8Array {
  const binary = atob(WASM_BYTES_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function initWasm(): Promise<InitOutput> {
  if (!initPromise) {
    initPromise = wasmInit({ module_or_path: wasmModuleInput() });
  }
  return initPromise;
}

export interface WasmOoxmlPart {
  name: string;
  content: string;
}

export interface WasmOoxmlPackage {
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

export function wasmPackageToMaps(raw: WasmOoxmlPackage): {
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

  const binaryAssets: Record<string, number[]> = {};
  for (const [name, asset] of input.binaryAssets.entries()) {
    binaryAssets[name] = Array.from(asset);
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
  const json = build_doc_model_from_bytes(payload);
  return JSON.parse(json) as { package: WasmOoxmlPackage; model: unknown };
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
