# Changelog

## 0.1.0

Initial crates.io release of Extend's shared Rust parser, previously named `docx-core` within the repository.

- Publish the Cargo package as `extend-docx`, imported as `extend_docx`.
- Parse DOCX and Word 97–2003 binary DOC into a shared document model and structured blocks.
- Preserve source references and support DOCX serialization through the shared model.
- Support native Rust and WebAssembly, with optional native ZIP decompression enabled by default on native builds.

Page geometry requires the viewer's layout engine. Rust versions are independent of the React viewer's npm versions.
