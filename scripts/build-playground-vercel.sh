#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
export RUSTUP_TOOLCHAIN=1.93.1
if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/docx-rustup-init.sh
  sh /tmp/docx-rustup-init.sh -y --profile minimal --default-toolchain "$RUSTUP_TOOLCHAIN" --no-modify-path
fi
rustup toolchain install "$RUSTUP_TOOLCHAIN" --profile minimal --target wasm32-unknown-unknown
if ! command -v wasm-pack >/dev/null 2>&1 || [[ "$(wasm-pack --version)" != "wasm-pack 0.13.1" ]]; then
  cargo install wasm-pack --version 0.13.1 --locked
fi
pnpm --filter @extend-ai/react-docx-playground build
