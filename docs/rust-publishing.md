# Publishing extend-docx

`extend-docx` is the public Rust parser, model, and serializer. Its source is in `crates/extend-docx`, and consumers import it as `extend_docx`. The `docx-wasm` workspace member is an internal JavaScript bridge with `publish = false`.

The Rust version is defined in `[workspace.package]` in the root `Cargo.toml`. It is independent of the npm release version managed by Changesets.

## Release

Authenticate with `cargo login` using a crates.io token scoped to the crate. The initial publication needs permission to publish a new crate. Keep tokens out of the repository and command history.

Update the Rust version and lockfiles, then run:

```sh
cargo test --workspace --locked
cargo check -p docx-wasm --target wasm32-unknown-unknown --locked
cargo check -p extend-docx --no-default-features --locked
cargo publish -p extend-docx --locked --dry-run
```

Review the package contents with `cargo package -p extend-docx --list`, commit the release changes, and publish:

```sh
cargo publish -p extend-docx --locked
```

Verify the version on [crates.io](https://crates.io/crates/extend-docx) and the [API documentation](https://docs.rs/extend-docx). The README version badges track crates.io automatically. Tag the published source with `extend-docx-v<VERSION>` to distinguish Rust releases from npm tags.

## Extend ownership

The repository is maintained by the `extend-hq/engineering` GitHub team. After the initial publication, an individual crate owner who belongs to that team can add it:

```sh
cargo owner --add github:extend-hq:engineering extend-docx
cargo owner --list extend-docx
```

Team owners can publish and yank versions. Individual owners manage ownership, so retain an individual maintainer alongside the team. crates.io must have permission to read the relevant GitHub organization membership. See [Cargo's ownership documentation](https://doc.rust-lang.org/cargo/reference/publishing.html#cargo-owner).

## Historical benchmark names

Older measurement records use `docx-core` as their engine identifier. The benchmark tools retain that identifier for compatibility, while their Cargo dependency and Rust imports use `extend-docx` and `extend_docx`. Both native runner names select the same parser. Charts and tables display `extend-docx`, including regenerated historical figures; stored timings, cohort membership, and measured revisions are unchanged.
