import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = path.join(root, "apps/playground");
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: "inherit" });
run("pnpm", ["--filter", "@extend-ai/react-docx-wasm", "build:wasm"]);

const sourceFiles = ["Cargo.toml", "Cargo.lock", ".cargo/config.toml", "crates/docx-wasm/Cargo.toml", "crates/docx-wasm/src/lib.rs"];
const sourceHash = createHash("sha256");
for (const name of sourceFiles.sort()) {
  sourceHash.update(name).update("\0").update(readFileSync(path.join(root, name))).update("\0");
}
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const info = {
  gitRevision: process.env.VERCEL_GIT_COMMIT_SHA || git("rev-parse", "HEAD"),
  sourceDirty: Boolean(git("status", "--porcelain", "--", "crates", "Cargo.toml", "Cargo.lock", ".cargo")),
  rustSourceSha256: sourceHash.digest("hex"),
  wasmSha256: createHash("sha256").update(readFileSync(path.join(root, "packages/wasm/src/docx_wasm_bg.wasm"))).digest("hex"),
  rustc: execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim(),
  builtAt: new Date().toISOString(),
};
mkdirSync(path.join(app, "public"), { recursive: true });
writeFileSync(path.join(app, "public/build-info.json"), `${JSON.stringify(info, null, 2)}\n`);
run("pnpm", ["run", "build:app"], app);
const built = path.join(app, "dist");
const assets = readdirSync(path.join(built, "assets")).filter(name => name.endsWith(".wasm"));
if (!assets.length || assets.some(name => createHash("sha256").update(readFileSync(path.join(built, "assets", name))).digest("hex") !== info.wasmSha256)) {
  throw new Error("Playground assets do not match the freshly compiled WASM");
}
info.wasmAssets = assets.map(name => `/assets/${name}`);
writeFileSync(path.join(built, "build-info.json"), `${JSON.stringify(info, null, 2)}\n`);
console.log(`Playground ${info.gitRevision}: WASM ${info.wasmSha256}`);
