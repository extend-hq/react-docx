import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = path.join(root, "apps/playground");
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: "inherit" });
run("pnpm", ["--filter", "@extend-ai/react-docx-wasm", "build:wasm"]);

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const wasmSource = JSON.parse(readFileSync(path.join(root, "packages/wasm/src/generated/build-info.json"), "utf8"));
const info = {
  gitRevision: process.env.VERCEL_GIT_COMMIT_SHA || git("rev-parse", "HEAD"),
  sourceDirty: Boolean(git("status", "--porcelain", "--", "packages/wasm/src", "crates", "Cargo.toml", "Cargo.lock", ".cargo")),
  rustSourceSha256: wasmSource.rustSourceSha256,
  rustSource: wasmSource.source,
  rustRevision: wasmSource.rustRevision,
  rustDocxVersion: wasmSource.rustDocxVersion,
  rustDocxWasmVersion: wasmSource.rustDocxWasmVersion,
  wasmSha256: createHash("sha256").update(readFileSync(path.join(root, "packages/wasm/src/docx_wasm_bg.wasm"))).digest("hex"),
  rustc: wasmSource.rustc,
  builtAt: new Date().toISOString(),
};
mkdirSync(path.join(app, "public"), { recursive: true });
writeFileSync(path.join(app, "public/build-info.json"), `${JSON.stringify(info, null, 2)}\n`);
run("pnpm", ["run", "build:app"], app);
const built = path.join(app, "dist");
const assets = readdirSync(path.join(built, "assets")).filter(name => name.endsWith(".wasm"));
if (!assets.length || assets.some(name => createHash("sha256").update(readFileSync(path.join(built, "assets", name))).digest("hex") !== info.wasmSha256)) {
  throw new Error("Playground assets do not match the bundled WASM");
}
info.wasmAssets = assets.map(name => `/assets/${name}`);
writeFileSync(path.join(built, "build-info.json"), `${JSON.stringify(info, null, 2)}\n`);
console.log(`Playground ${info.gitRevision}: WASM ${info.wasmSha256}`);
