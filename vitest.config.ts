import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"],
      include: ["packages/**/src/**/*.ts", "packages/**/src/**/*.tsx"]
    }
  }
});
