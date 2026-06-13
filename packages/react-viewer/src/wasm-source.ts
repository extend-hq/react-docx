import {
  initWasm as initRuntimeWasm,
  setWasmSource as setRuntimeWasmSource,
  type WasmSource
} from "@extend-ai/react-docx-wasm";

export type WorkerWasmSource = string | ArrayBuffer | WebAssembly.Module;

let hasConfiguredWasmSource = false;
let configuredWorkerWasmSource: WorkerWasmSource | undefined;

function bufferSourceToArrayBuffer(
  source: ArrayBuffer | ArrayBufferView<ArrayBufferLike>
): ArrayBuffer {
  if (source instanceof ArrayBuffer) {
    return source.slice(0);
  }

  const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  const copy = new Uint8Array(bytes);
  return copy.buffer;
}

function sourceToWorkerSource(source: WasmSource): WorkerWasmSource | undefined {
  if (typeof source === "string") {
    return source;
  }
  if (typeof URL !== "undefined" && source instanceof URL) {
    return source.href;
  }
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    return bufferSourceToArrayBuffer(source);
  }
  if (typeof WebAssembly !== "undefined" && source instanceof WebAssembly.Module) {
    return source;
  }
  if (typeof Request !== "undefined" && source instanceof Request) {
    return source.url;
  }

  return undefined;
}

function rememberWorkerWasmSource(source: WasmSource): void {
  hasConfiguredWasmSource = true;
  configuredWorkerWasmSource = sourceToWorkerSource(source);
}

export function setWasmSource(source: WasmSource): void {
  setRuntimeWasmSource(source);
  rememberWorkerWasmSource(source);
}

export function initWasm(source?: WasmSource): ReturnType<typeof initRuntimeWasm> {
  if (source !== undefined) {
    rememberWorkerWasmSource(source);
  }
  return initRuntimeWasm(source);
}

export function canUseConfiguredWasmSourceInWorker(): boolean {
  return !hasConfiguredWasmSource || configuredWorkerWasmSource !== undefined;
}

export function getConfiguredWorkerWasmSource(): WorkerWasmSource | undefined {
  return configuredWorkerWasmSource;
}

export type { WasmSource };
