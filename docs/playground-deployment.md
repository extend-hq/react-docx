# Playground deployment

Vercel deploys the `apps/playground` application from the repository. Its build command runs `scripts/build-playground-vercel.sh`, which installs Rust 1.93.1 with the WASM target and wasm-pack 0.13.1, then runs the playground build. The dependency lockfile is enforced.

`scripts/build-playground.mjs` recompiles `docx-wasm` and `docx-core` before building the viewer and application. The deployed playground therefore follows the deployed Git revision without requiring an npm or crate release. Published packages retain their own released code until a separate release is cut.

The build writes `/build-info.json` with the Git revision, Rust source SHA-256, WASM SHA-256, compiler version, and build timestamp. The application exposes this through its Build link. The build fails if the emitted WASM asset differs from the freshly compiled binary. The manifest is served with `Cache-Control: no-store`; the WASM asset has a content-based filename.

Verify production by comparing the manifest revision with the merged commit, comparing its Rust source hash with the checkout, and downloading its listed WASM asset to check the recorded hash. Local and hosted WASM hashes can differ with compiler/build environments; the source hash and each deployment's own asset hash provide the provenance checks.

The file picker, drag-and-drop paths, and viewer import validation accept DOC, DOT, DOCX, DOTX, DOCM, and DOTM. Import parses their document content. Downloads use the extension and MIME type of the retained OOXML package family; imported binary DOC/DOT is converted to DOCX. This does not promise lossless template or macro round trips, and macros are never executed.
