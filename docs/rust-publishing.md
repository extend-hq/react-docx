# Updating the Rust runtime

The Rust parser (`rust-docx`), its WASM bindings (`rust-docx-wasm`), and its chart renderer (`rust-office-charts`) are maintained and published from [rust-office](https://github.com/extend-hq/rust-office). React DOCX builds the registry bindings into the browser module it ships. Browser applications can continue installing the viewer from npm.

To adopt a published release, update the `rust-docx-wasm` version in the viewer's Cargo manifest. Refresh the lockfile, rebuild the bindings and run the viewer checks:

```sh
cargo update -p rust-docx-wasm
pnpm --filter @extend-ai/react-docx-wasm run build
pnpm run typecheck
pnpm run test:unit
```

Commit the lockfiles, generated JavaScript and TypeScript declarations, and the rebuilt WASM binary together. Benchmark tooling, measured results, and chart comparisons are maintained in [rust-office](https://github.com/extend-hq/rust-office#packages-benchmarks-and-chart-accuracy).
