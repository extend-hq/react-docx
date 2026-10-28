# Parser benchmark and optimization harness

The standalone Cargo workspace pins docx-rs 0.4.22, office_oxide 0.1.15, and undoc 0.27.1. It links the local docx-core. Release measurements use opt-level 3, thin LTO, and one codegen unit for every parser. The production WASM build retains the repository's size-oriented profile.

Install Python dependencies from `requirements.txt` into `.python-deps`, then build with `cargo build --release --manifest-path scripts/parser-benchmark/Cargo.toml`. Run commands from the repository root. Generated results and binary snapshots belong under `output/`.

## Original comparison

`corpus.py` inventories local inputs by content hash and creates an independent OOXML extraction oracle. `run.py`, `assess.py`, and `report.py` run the four parsers, normalize outputs, and publish the original report. Actual format is determined from bytes; filename extensions do not determine format. Legacy DOC uses a different reference and is reported separately.

## Optimization experiments

The optimization scripts reuse the original manifest and oracle under `output/parser-benchmark-20261028`. The dated default output is `output/parser-hillclimb-20261028`. Its saved split has 48 tuning documents, 336 ordinary holdout documents, and six large outliers, all DOCX. Two legacy DOC inputs are included in full-corpus runs.

Preserve a baseline binary before editing core. `src/bin/probe.rs` separately measures package decoding, complete model construction, and structured-block extraction. It reads input once, discards the first iteration, and excludes serialization and destruction from timings.

```sh
python3 scripts/parser-benchmark/hillclimb.py --label final --baseline output/parser-hillclimb-20261028/baseline-probe --candidate output/parser-hillclimb-20261028/final-probe --repeats 5
python3 scripts/parser-benchmark/hillclimb_accuracy.py --label final --binary output/parser-hillclimb-20261028/final-parser-benchmark --split full
python3 scripts/parser-benchmark/compare.py --binary output/parser-hillclimb-20261028/final-parser-benchmark --split full --repeats 5
python3 scripts/parser-benchmark/parity.py --label final --binary output/parser-hillclimb-20261028/final-parser-benchmark
python3 scripts/parser-benchmark/wasm_compare.py --repeats 5
python3 scripts/parser-benchmark/hillclimb_report.py
```

Run timing commands sequentially after builds, accuracy checks, and other owned CPU jobs finish. Engine order and input order are randomized with a saved seed. Raw samples, cold parses, dispersion, process status, load averages, and binary hashes are retained. A shared development machine is not an isolated performance lab.

The main harness takes `ENGINE INPUT FORMAT OUTPUT_PREFIX REPEATS [compact]`. Output prefix `-` disables serialization. `compact` reduces only the saved diagnostic JSON after a complete production parse; it does not change timed work. Core builds both its complete model and structured blocks; the other engines expose their corresponding native models or IR. docx-rs image previews are disabled. These outputs have different fidelity and coverage.

The parity audit compares all model fields against original saved native output, except source XML serialization and binary image payload contents. Image presence is retained; style definitions are aligned by ID. Other arrays remain ordered. The WASM benchmark measures complete model construction and the JS bridge, with file reads, module initialization, and explicit GC outside warm timings. It does not measure layout or structured-block extraction.

## Interpretation

Text scores normalize Unicode and whitespace and use character 5-grams plus paragraph anchors. Feature checks report recall with explicit denominators. They do not establish universal accuracy or Word-identical rendering. Adjacent styled spans, resolved table grids, grouped images, generated symbols, and form controls can differ legitimately from raw XML occurrence counts. Preserve original scores and document diagnostic limitations rather than changing an oracle to make a candidate appear perfect.

Competitor accuracy can be reused only when pinned versions, dependencies, and normalization are unchanged. Fresh comparison timings use the common set of successful inputs; failures and legacy DOC are reported separately. Do not compare old timing totals with fresh totals as if they were paired observations.
