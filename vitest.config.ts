import path from "node:path";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "@reference/ts-doc-model-legacy": path.resolve(
        __dirname,
        "tests/reference/ts-doc-model-legacy.ts"
      ),
      "@reference/ts-ooxml-core-legacy": path.resolve(
        __dirname,
        "tests/reference/ts-ooxml-core-legacy.ts"
      )
    }
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    pool: "forks",
    poolOptions: {
      forks: {
        isolate: true
      }
    },
    coverage: {
      reporter: ["text", "html"],
      include: ["packages/**/src/**/*.ts", "packages/**/src/**/*.tsx"]
    }
  }
});
