# Document feedback loop

This runner builds a candidate, verifies complete model and structured-block parity, then measures the same input with the baseline, candidate, and office_oxide. Run from the repository root with Python 3.11 or later and Rust installed.

## Freeze the baseline before editing core

```sh
mkdir -p output/parser-next/feedback-loop
cargo build --locked --release --manifest-path scripts/parser-feedback/Cargo.toml
cp scripts/parser-feedback/target/release/parser-feedback output/parser-next/feedback-loop/baseline-core
cargo build --locked --release --manifest-path scripts/parser-benchmark/Cargo.toml
cp scripts/parser-benchmark/target/release/parser-benchmark output/parser-next/reference
cp scripts/parser-benchmark/target/release/digest output/parser-next/digest
```

Create `output/parser-next/feedback-loop/queue.json` as an ordered JSON array with an absolute `path` and the input's SHA-256 as `id` for each DOCX. A corpus manifest from `corpus.py` supplies these fields; select entries whose format is `docx`. Freeze the queue for the entire experiment. Documents, snapshots, profiles, and receipts stay in the ignored `output/` directory.

After making a source change:

```sh
python3 scripts/parser-benchmark/feedback_loop.py \
  --run output/parser-next --label trial-name --index 0 --count 1 \
  --baseline output/parser-next/feedback-loop/baseline-core \
  --reference output/parser-next/reference
```

Use a fresh label for each iteration and increment `--index` to advance through the queue. `--rounds` defaults to seven. On macOS, `--profile` additionally captures separate call-stack samples after timing. Samples overlap and are diagnostic, not complete invocation counts or CPU-cycle measurements.

For repeated accepted baselines, `feedback-loop/current-baseline.json` may replace the explicit baseline arguments. Its `baseline` and `reference` objects each contain `path` and `sha256`; `harness` maps `Cargo.toml`, `Cargo.lock`, and `src/main.rs` to their SHA-256 values relative to this directory. The runner verifies these identities before measurement. Rebuild both sides when changing harness code or compiler flags.

Every invocation requires a successful locked build, copies the candidate into its own directory, verifies input hashes, and compares complete output digests against both frozen baselines. It then interleaves timings and records raw samples, phase timings, source and executable hashes, process CPU time, and a paired bootstrap interval. Run timing after other owned CPU jobs have stopped.

Fast core builds disable LTO and enable incremental compilation; office_oxide runs in the production comparison executable. This loop identifies candidates. It does not establish the production latency gap or representative corpus performance. Exact parity preserves existing output; it cannot prove support for missing features.

Before promotion, run the full native/output audit, regression tests, WASM validation, and matched release corpus benchmark. The live report's experiment table reads `feedback-loop/latest.json` separately from the accepted corpus measurements. See [the benchmark guide](../parser-benchmark/README.md) for reporting and acceptance requirements.
