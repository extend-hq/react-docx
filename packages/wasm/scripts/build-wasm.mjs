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
const registry = process.argv.includes("--registry");
if (workspace && registry) throw new Error("Choose either a Rust workspace or the locked registry build.");
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
  const version = crate => readFileSync(path.join(workspace, `crates/${crate}/Cargo.toml`), "utf8").match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  let gitInfo = {};
  try {
    gitInfo = { rustRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(),
      rustSourceDirty: Boolean(execFileSync("git", ["status", "--porcelain", "--", ...files], { cwd: workspace, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()) };
  } catch {}
  return { source: "workspace", rustDocxVersion: version("rust-docx"), rustDocxWasmVersion: version("rust-docx-wasm"), ...gitInfo,
    rustSourceSha256: source.digest("hex"), wasmSha256: hash(readFileSync(binary)),
    rustc: execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim() };
}

function registrySourceInfo(binary) {
  const metadata = JSON.parse(execFileSync("cargo", ["metadata", "--locked", "--format-version", "1"], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
  const source = createHash("sha256");
  for (const name of ["Cargo.toml", "Cargo.lock", "crates/docx-wasm/Cargo.toml", "crates/docx-wasm/src/lib.rs"]) source.update(name).update("\0").update(readFileSync(path.join(root, name))).update("\0");
  const crates = metadata.packages.filter(pkg => ["rust-docx", "rust-docx-wasm", "rust-office-art", "rust-office-charts"].includes(pkg.name));
  for (const crate of crates.sort((a, b) => a.name.localeCompare(b.name))) {
    const walk = directory => readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name)).forEach(entry => {
      const name = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(name);
      else source.update(`${crate.name}/${path.relative(path.dirname(crate.manifest_path), name)}`).update("\0").update(readFileSync(name)).update("\0");
    });
    source.update(readFileSync(crate.manifest_path));
    walk(path.join(path.dirname(crate.manifest_path), "src"));
  }
  return { source: "registry", rustDocxVersion: crates.find(p => p.name === "rust-docx")?.version,
    rustDocxWasmVersion: crates.find(p => p.name === "rust-docx-wasm")?.version,
    rustSourceSha256: source.digest("hex"), wasmSha256: hash(readFileSync(binary)),
    cargoLockSha256: hash(readFileSync(path.join(root, "Cargo.lock"))),
    rustc: execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim() };
}

if (workspace || registry) {
  const crate = workspace ? path.resolve(workspace, "crates/rust-docx-wasm") : path.join(root, "crates/docx-wasm");
  if (!existsSync(path.join(crate, "Cargo.toml"))) throw new Error("RUST_DOCX_WORKSPACE must point to the Rust workspace containing rust-docx-wasm.");
  const output = mkdtempSync(path.join(tmpdir(), "react-docx-wasm-"));
  try {
    execFileSync("wasm-pack", ["build", crate, "--target", "web", "--out-name", "docx_wasm", "--out-dir", output, "--", "--locked"], {
      cwd: root, stdio: "inherit",
      env: { ...process.env, RUSTFLAGS: process.env.RUSTFLAGS ?? "-C target-feature=+simd128" },
    });
    const declarations = readFileSync(path.join(output, "docx_wasm.d.ts"), "utf8");
    if (required.some(name => !declarations.includes(`function ${name}(`))) throw new Error("The selected Rust workspace does not expose shared document review.");
    const builtBinary = path.join(output, "docx_wasm_bg.wasm");
    const provenance = registry ? registrySourceInfo(builtBinary) : sourceInfo(path.resolve(workspace), builtBinary);
    mkdirSync(generated, { recursive: true });
    for (const name of ["docx_wasm.js", "docx_wasm.d.ts", "docx_wasm_bg.wasm.d.ts"]) copyFileSync(path.join(output, name), path.join(generated, name));
    copyFileSync(builtBinary, binary);
    writeFileSync(manifestPath, `${JSON.stringify(provenance, null, 2)}\n`);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

const module = new WebAssembly.Module(readFileSync(binary));
const exports = new Set(WebAssembly.Module.exports(module).map(entry => entry.name));
if (required.some(name => !exports.has(name))) throw new Error("Rebuild shared document review with RUST_DOCX_WORKSPACE set to the matching Rust workspace.");
if (existsSync(manifestPath) && JSON.parse(readFileSync(manifestPath, "utf8")).wasmSha256 !== hash(readFileSync(binary))) throw new Error("The bundled WASM does not match its source manifest.");
console.log(workspace || registry ? "Built shared Rust document review." : "Validated bundled WASM; set RUST_DOCX_WORKSPACE to rebuild from Rust source.");
