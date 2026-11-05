import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const generated = path.join(root, "packages/wasm/src/generated");
const binary = path.join(root, "packages/wasm/src/docx_wasm_bg.wasm");
const workspace = process.env.RUST_DOCX_WORKSPACE;
const required = ["extract_document_review_wasm", "extract_document_blocks_with_revisions_wasm"];
const manifestPath = path.join(generated, "build-info.json");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

export function sourceInfo(workspace, binary) {
  const files = ["Cargo.toml", "Cargo.lock"];
  const walk = relative => {
    for (const entry of readdirSync(path.join(workspace, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(name);
      else files.push(name);
    }
  };
  for (const crate of ["rust-docx", "rust-docx-wasm", "rust-office-art", "rust-office-charts"]) {
    files.push(`crates/${crate}/Cargo.toml`);
    walk(`crates/${crate}/src`);
  }
  const source = createHash("sha256");
  for (const file of files.sort()) source.update(file).update("\0").update(readFileSync(path.join(workspace, file))).update("\0");
  return { rustSourceSha256: source.digest("hex"), wasmSha256: hash(readFileSync(binary)),
    rustc: execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim() };
}

if (workspace) {
  const crate = path.resolve(workspace, "crates/rust-docx-wasm");
  if (!existsSync(path.join(crate, "Cargo.toml"))) throw new Error("RUST_DOCX_WORKSPACE must point to the Rust workspace containing rust-docx-wasm.");
  const output = mkdtempSync(path.join(tmpdir(), "react-docx-wasm-"));
  try {
    execFileSync("wasm-pack", ["build", crate, "--target", "web", "--out-name", "docx_wasm", "--out-dir", output, "--", "--locked"], {
      cwd: root, stdio: "inherit",
      env: { ...process.env, RUSTFLAGS: process.env.RUSTFLAGS ?? "-C target-feature=+simd128" },
    });
    const declarations = readFileSync(path.join(output, "docx_wasm.d.ts"), "utf8");
    if (required.some(name => !declarations.includes(`function ${name}(`))) throw new Error("The selected Rust workspace does not expose shared document review.");
    mkdirSync(generated, { recursive: true });
    for (const name of ["docx_wasm.js", "docx_wasm.d.ts", "docx_wasm_bg.wasm.d.ts"]) copyFileSync(path.join(output, name), path.join(generated, name));
    copyFileSync(path.join(output, "docx_wasm_bg.wasm"), binary);
    writeFileSync(manifestPath, `${JSON.stringify(sourceInfo(path.resolve(workspace), binary), null, 2)}\n`);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

const module = new WebAssembly.Module(readFileSync(binary));
const exports = new Set(WebAssembly.Module.exports(module).map(entry => entry.name));
if (required.some(name => !exports.has(name))) throw new Error("Rebuild shared document review with RUST_DOCX_WORKSPACE set to the matching Rust workspace.");
if (existsSync(manifestPath) && JSON.parse(readFileSync(manifestPath, "utf8")).wasmSha256 !== hash(readFileSync(binary))) throw new Error("The bundled WASM does not match its source manifest.");
console.log(workspace ? "Built shared Rust document review." : "Validated bundled WASM; set RUST_DOCX_WORKSPACE to rebuild from Rust source.");
