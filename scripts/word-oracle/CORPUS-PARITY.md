# Local Word corpus comparison

The corpus harness compares immutable renderer builds with native Word PDF references from the same source bytes. It keeps failures and unavailable references in the inventory. It does not convert DOC files to DOCX before passing their bytes to the viewer.

The output directory must contain:

- `inventory.json`, with unique source SHA-256 identities, detected formats, paths, eligibility, and provenance.
- `build-identities.json`, with a file hash manifest and immutable directory for each renderer variant under `builds/`.
- `capture-profile.json`, with the combined SHA-256 of the capture script and geometry collector, the exact viewer configuration, and archived copies of both scripts under `capture-profiles/`.
- `word-references/<source-sha>.receipt.json`, with source/PDF/geometry hashes, physical page count, Word version/environment, and an explicit export status. Geometry preserves all physical PDF pages, including pages without native text.

The capture profile uses `mode: "read-only"`, 100% zoom, light document theme, hidden tracked changes/comments, disabled page virtualization, and deferred initial pagination paint. The readiness contract requires five stable samples of all page and source-fragment geometry, loaded fonts, complete images, sequential physical page indices, no initial overlay, and no editable controls inside page surfaces. The capture records registered FontFaceSet states, HTTP failures, requested font families, failed images, clipping, and actual controller/DOM zoom. These font diagnostics do not prove the absence of system fallback or embedded faces discarded by the loader after a failed load.

Run a capture with an explicit output directory:

```sh
node scripts/word-oracle/capture-corpus.mjs --output "$CORPUS_OUTPUT" --variants baseline,migrated,refined --workers 2
```

The command resumes only records matching source, build, and capture-profile identities. `--retry-failures` retries failed records; `--force` replaces all selected records. `--ids` restricts sources and `--inventory` permits a reordered inventory without changing source identities. Do not reuse captures made with a different viewer mode or measurement contract.

Generate the comparison and report:

```sh
node scripts/word-oracle/refresh-corpus.mjs --output "$CORPUS_OUTPUT"
```

Add `--watch` to refresh while native exports and renderer captures complete. The refresh command maintains independent comparisons for the initial migration, renderer refinement, and final parser/renderer changes when those frozen variants exist. The final build is compared against both the baseline and the prior refinement. It merges renderer differences into `word-priority.json` so the native export queue can prioritize changed documents while retaining the full inventory.

When `final-corrected` exists, it is compared separately against the baseline, prior refinement, and original final build. Earlier variants remain immutable. A partial raster sweep of an earlier variant remains a labeled diagnostic snapshot and does not restrict the shared cohort of the completed corrected sweep.

Individual commands support `--help`. `compare-corpus.mjs` accepts `--variants` and `--result`; `report-corpus.mjs` accepts `--comparison`, `--report`, and `--changes`; `renderer-changes.mjs` accepts `--before`, `--after`, `--result`, and `--priority`.

## Reading the results

Physical page count equality is a structural diagnostic. Qualified native-text page parity also requires identical text on every physical page, matching physical page dimensions, complete visible text, and no failed images. A reference with no native text has no native-text layout parity result. Raster comparisons supply separate image/shape coverage and do not turn blank-text pages into text passes.

Text alignment removes whitespace and format controls, applies Unicode NFKC, and retains case. It uses deterministic edit/work limits and shares alignment for identical normalized renderer text. Unresolved alignment remains in recall denominators, so absolute recall is a lower bound rather than proof of missing visual content. Changed-text comparisons with unresolved alignment have unavailable fidelity deltas. Geometry movement is compared only on the intersection of resolved reference words; PDF glyph bounds and DOM inline bounds have different vertical metrics.

The original source SHA remains authoritative for binary DOC inputs. A parser change may alter the converted package's document ID even when body geometry is unchanged. Renderer-only movement diagnostics normalize a single converted namespace prefix only for the same binary source, preserving the part/path and text offsets. They report namespace changes and unmatched geometry keys separately; neither constitutes a content-loss claim. Native Word alignment does not depend on these converted IDs.

Primary aggregates use shared successful, unrepaired-reference cohorts. Repaired Word inputs remain visible as conditional references. Generated artifacts, user documents, repository fixtures, and application/system resources remain separately identifiable. Failed captures retain raw errors and actionable error categories.

Printed PAGE/NUMPAGES labels are separate from physical page ordinals. Footer text candidates alone do not qualify label parity. Any qualified field audit must retain source, build, capture-profile, and Word-reference provenance.

Native reference qualification requires the recorded export profile and current environment identity, read-only final view, verified source preservation, and matching source/PDF/geometry hashes. Geometry is streamed for identity checking when every renderer failed, avoiding a large JSON allocation for an unmeasured input. Printed-label report qualification additionally checks the auditor and source-template identities, the frozen build manifest, and each observed capture/reference hash against both current files and the comparison snapshot. Stale records remain unavailable until the audit and comparison are regenerated.

The report includes source feature coverage, configurable complexity/latency axes, per-document failures, and independent native-text and raster diagnostics. Raster snapshots must match the selected frozen build and native comparison source/reference identities. Each artifact includes a timestamp; comparisons made with an invalidated profile must be archived rather than relabeled.

Ready latency includes font/image loading and the stable-layout guard. Recorded runs may use different worker schedules and share resources with concurrent geometry or raster jobs. These are observed pipeline timings, not controlled dependency speed benchmarks.
