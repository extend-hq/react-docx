export * from "@extend-ai/react-docx-wasm";
export { initWasm, setWasmSource } from "./wasm-source";
export {
  canUseConfiguredWasmSourceInWorker,
  getConfiguredWorkerWasmSource,
} from "./wasm-source";
export type { WasmSource, WorkerWasmSource } from "./wasm-source";
