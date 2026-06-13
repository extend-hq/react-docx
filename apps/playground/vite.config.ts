import path from "path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

const workspaceRoot = path.resolve(__dirname, "../..");
const workspaceSourceAliases = {
  "@extend-ai/react-docx": path.resolve(workspaceRoot, "packages/react-viewer/src/index.tsx"),
  "@extend-ai/react-docx-doc-model": path.resolve(workspaceRoot, "packages/doc-model/src/index.ts"),
  "@extend-ai/react-docx-editor-ops": path.resolve(workspaceRoot, "packages/editor-ops/src/index.ts"),
  "@extend-ai/react-docx-layout-core": path.resolve(workspaceRoot, "packages/layout-core/src/index.ts"),
  "@extend-ai/react-docx-layout-engine": path.resolve(workspaceRoot, "packages/layout-engine/src/index.ts"),
  "@extend-ai/react-docx-ooxml-core": path.resolve(workspaceRoot, "packages/ooxml-core/src/index.ts"),
  "@extend-ai/react-docx-serializer": path.resolve(workspaceRoot, "packages/serializer/src/index.ts"),
  "@extend-ai/react-docx-wasm": path.resolve(workspaceRoot, "packages/wasm/src/index.ts"),
};

export default defineConfig({
  plugins: [react(), tsconfigPaths(), tailwindcss()],
  optimizeDeps: {
    exclude: Object.keys(workspaceSourceAliases),
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      ...workspaceSourceAliases,
    },
  },
});
