import { defineConfig } from "tsup";

const bundledWorkspacePackages = [
  "@extend-ai/react-docx-doc-model",
  "@extend-ai/react-docx-editor-ops",
  "@extend-ai/react-docx-layout-core",
  "@extend-ai/react-docx-layout-engine",
  "@extend-ai/react-docx-ooxml-core",
  "@extend-ai/react-docx-serializer"
];

export default defineConfig({
  entry: ["src/index.tsx", "src/docx-import-worker.ts"],
  format: ["esm", "cjs"],
  sourcemap: true,
  clean: true,
  external: ["react", "react-dom"],
  noExternal: bundledWorkspacePackages,
  dts: {
    resolve: true,
    entry: "src/index.tsx"
  }
});
