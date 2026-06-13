import { defineConfig } from "tsup";

const bundledWorkspacePackages = [
  "@extend-ai/react-docx-doc-model",
  "@extend-ai/react-docx-editor-ops",
  "@extend-ai/react-docx-layout-core",
  "@extend-ai/react-docx-layout-engine",
  "@extend-ai/react-docx-ooxml-core",
  "@extend-ai/react-docx-serializer",
  "@extend-ai/react-docx-wasm"
];

export default defineConfig({
  entry: ["src/index.tsx", "src/docx-import-worker.ts"],
  format: ["esm", "cjs"],
  sourcemap: true,
  clean: true,
  // Shim import.meta.url in the CJS build — the wasm loader resolves the
  // docx_wasm_bg.wasm asset relative to it at runtime.
  shims: true,
  external: ["react", "react-dom"],
  noExternal: bundledWorkspacePackages,
  dts: {
    resolve: true
  },
  // Ship the wasm binary next to the bundles; the loader references it as
  // new URL("./docx_wasm_bg.wasm", import.meta.url).
  onSuccess: "cp ../wasm/src/docx_wasm_bg.wasm dist/docx_wasm_bg.wasm"
});
