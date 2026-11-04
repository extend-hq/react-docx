# Updating the Rust runtime

The Rust parser (`extend-docx`), its WASM bindings (`extend-docx-wasm`), and its chart renderer (`extend-office-charts`) are maintained and published from [extend-office](https://github.com/extend-hq/extend-office). React DOCX builds the registry bindings into the browser module it ships. Browser applications can continue installing the viewer from npm.

To adopt a published release, update the `extend-docx-wasm` version in the viewer's Cargo manifest. Refresh the lockfile, rebuild the bindings and run the viewer checks:

```sh
cargo update -p extend-docx-wasm
pnpm --filter @extend-ai/react-docx-wasm run build
pnpm run typecheck
pnpm run test:unit
```

Commit the lockfiles, generated JavaScript and TypeScript declarations, and the rebuilt WASM binary together. Benchmark tooling, measured results, and chart comparisons are maintained in [extend-office](https://github.com/extend-hq/extend-office#packages-benchmarks-and-chart-accuracy).
