import { defineConfig, type Options } from "tsup";
import { copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const bundledWorkspacePackages = [
  "@extend-ai/react-docx-doc-model",
  "@extend-ai/react-docx-editor-ops",
  "@extend-ai/react-docx-layout-core",
  "@extend-ai/react-docx-layout-engine",
  "@extend-ai/react-docx-ooxml-core",
  "@extend-ai/react-docx-serializer",
  "@extend-ai/react-docx-wasm",
  "@chenglou/pretext",
];

const virtualizer = ["@tanstack/react-virtual", "@tanstack/virtual-core"];

function sharedRuntimePlugin(): NonNullable<Options["esbuildPlugins"]>[number] {
  return {
    name: "shared-docx-runtime",
    setup(build) {
      build.onResolve({ filter: /^@extend-ai\/react-docx-wasm$/ }, () => ({
        path: "@extend-ai/react-docx/internal",
        external: true,
      }));
      build.onResolve({ filter: /^\.\/wasm-source$/ }, () => ({
        path: "@extend-ai/react-docx/internal",
        external: true,
      }));
    },
  };
}

export default defineConfig([
  {
    entry: { internal: "src/internal.ts" },
    format: ["esm", "cjs"],
    sourcemap: true,
    clean: true,
    shims: true,
    noExternal: bundledWorkspacePackages,
    dts: { resolve: true },
  },
  {
    entry: { vanilla: "src/vanilla.tsx" },
    format: ["esm", "cjs"],
    platform: "browser",
    sourcemap: true,
    clean: false,
    shims: true,
    external: ["@extend-ai/react-docx/internal"],
    noExternal: [
      ...bundledWorkspacePackages,
      ...virtualizer,
      "react",
      "react-dom",
      "preact",
      "preact-render-to-string",
      "utif",
      "pako",
    ],
    esbuildPlugins: [sharedRuntimePlugin()],
    esbuildOptions(options) {
      options.alias = {
        ...options.alias,
        react: "preact/compat",
        "react-dom": "preact/compat",
        "react-dom/server": "preact/compat/server.browser",
      };
    },
    dts: { resolve: true },
  },
  {
    entry: { index: "src/index.tsx" },
    format: ["esm", "cjs"],
    sourcemap: true,
    clean: false,
    shims: true,
    external: ["react", "react-dom", "@extend-ai/react-docx/internal"],
    noExternal: [...bundledWorkspacePackages, ...virtualizer],
    esbuildPlugins: [sharedRuntimePlugin()],
    dts: { resolve: true },
  },
  {
    entry: { "docx-import-worker": "src/docx-import-worker.ts" },
    format: ["esm", "cjs"],
    sourcemap: true,
    clean: false,
    shims: true,
    external: ["react", "react-dom"],
    noExternal: bundledWorkspacePackages,
    onSuccess: async () => {
      await copyFile("../wasm/src/docx_wasm_bg.wasm", "dist/docx_wasm_bg.wasm");
      await copyFile("src/pretext-license.txt", "dist/pretext-license.txt");
      await copyFile("node_modules/preact/LICENSE", "dist/preact-license.txt");
      await copyFile("node_modules/preact-render-to-string/LICENSE", "dist/preact-render-to-string-license.txt");
      await copyFile("node_modules/@tanstack/react-virtual/LICENSE", "dist/tanstack-virtual-license.txt");
      await copyFile("node_modules/utif/LICENSE", "dist/utif-license.txt");
      const requireFromUtif = createRequire(createRequire(import.meta.url).resolve("utif/package.json"));
      await copyFile(join(dirname(requireFromUtif.resolve("pako/package.json")), "LICENSE"), "dist/pako-license.txt");
      await copyFile("../../crates/docx-core/third-party/dingbat-to-unicode-LICENSE", "dist/dingbat-to-unicode-LICENSE");
    },
  },
]);
