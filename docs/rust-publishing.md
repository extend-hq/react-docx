# Updating the Rust runtime

The Rust parser (`rust-docx`), its WASM bindings (`rust-docx-wasm`), and its chart renderer (`rust-office-charts`) are maintained and published from [rust-office](https://github.com/extend-hq/rust-office). React DOCX builds its locked Cargo dependencies into the browser module it ships. Browser applications can continue installing the viewer from npm.

The Cargo manifest pins the published `rust-docx-wasm` crate to `=0.2.20`, which includes the drop-cap paragraph fix previously consumed through a Git revision. A rebuild needs no local Rust checkout. Keep the dependency pinned to an exact registry version when adopting future releases.

After changing the dependency, refresh the lockfile, rebuild the bindings and run the viewer checks:

```sh
cargo update -p rust-docx-wasm
pnpm --filter @extend-ai/react-docx-wasm exec node scripts/build-wasm.mjs --cargo
pnpm run build
pnpm run typecheck
pnpm run test:unit
```

Commit the lockfiles, generated JavaScript and TypeScript declarations, rebuilt WASM binary, build provenance, and generated runtime notices together. The Cargo rebuild uses `--locked`, records DOCX, Office Art and Office Charts versions plus the Git revision when applicable, and regenerates the dependency and bundled-data notices. The previous `--registry` flag remains an alias for `--cargo`. Ordinary builds validate the committed WASM and notices without recompiling Rust. The published viewer includes that provenance as `dist/rust-runtime-build-info.json`. Benchmark tooling, measured results, and chart comparisons are maintained in [rust-office](https://github.com/extend-hq/rust-office#packages-benchmarks-and-chart-accuracy).
