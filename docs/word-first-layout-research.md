# Word layout before first paint

This bounded investigation uses fresh REA/Ghidra analysis of the installed
Word layout framework on 2026-10-29. It supports a layout result that is complete
before paint, with reusable line and row geometry. It does not support a claim
that arbitrary Word documents require only one internal formatting attempt, or
that disabling browser measurements makes an approximate layout accurate.

## Artifact identity and method

- Installed main executable: `/Applications/Microsoft Word.app/Contents/MacOS/Microsoft Word`.
  SHA-256: `8cfdfa41db8d8b932b169d52004132da44c4a0bda0f47e6eea63f9c67707187f`.
- Installed layout framework: `MicrosoftPTLS7.framework/Versions/A/MicrosoftPTLS7`
  inside that application. SHA-256:
  `c725cced2da1d7947c4e7ca5a2ab1c533f560d763de4d0e98201dc8cbdce84b5`.
- Both installed hashes match the earlier
  [native layout investigation](word-native-layout-research.md).
- A new arm64 slice was produced with `lipo` under
  `output/word-layout-research/MicrosoftPTLS7.arm64`.
  SHA-256: `fbaa834a667ae53c65a6f83079906f77a3fc14e537f9634d4f88c772d8460f1b`.
- REA provider: Ghidra 12.1.4. Addresses below are unslid virtual addresses in
  this slice. Binary analysis was static and did not execute or modify the
  application or framework. A later, separate native export qualification is
  recorded below. No proprietary implementation was copied into viewer source.

The complete evidence bundle is retained at
`output/word-layout-research/evidence.json`, and the closed-session
analysis snapshot at `output/word-layout-research/analysis.snapshot.json`.
These local diagnostic artifacts are separate from the package and are not
required at runtime. Native private types and Darwin ABI details remain partly
unrecovered; conclusions below are limited to inspected branches and bytes.

## Findings

| Finding | Native evidence | Confidence and limit |
| --- | --- | --- |
| Page formatting includes internal retries. | `FsFormatPageBody` at `0xa7b4` calls collision and not-reached restart checks, discards section geometry, and loops before returning a page body. Calls at `0xb098`, `0xb0b8`, and `0xb0d0`, followed by a branch back at `0xb0fc`, confirm this in assembly. | Observed static control flow. The frequency and document-specific triggers were not sampled at runtime. |
| Floating-object geometry can invalidate an in-progress page. | `FsCheckRestartForCollision` at `0x13a2fc` retrieves the colliding obstacle, restores geometry or a geometry stamp, and adds prepositioned obstacles. `FsCheckRestartForNotReached` at `0x31aa8` similarly restores geometry and updates the first disallowed obstacle. | Observed static data/control flow. Public document settings for every private branch remain unmapped. |
| A line's occupied height uses separate component maxima. | `FsCheckLineVerticalFit` at `0x2d3b4` applies a two-lane signed maximum over element fields `+0x18` and `+0x1c`, then adds the two maxima. At `0x2d438`/`0x2d43c`, equality with the available height fits. | Observed instructions. The effective metric producer is a separate contract; these are native integer units, not CSS pixels. |
| Suppressible bottom spacing has a distinct conditional fit branch. | The same function obtains per-element suppressible spacing through a callback only after the first fit fails, checks a second limit, and compares the reduced height. Callback errors propagate. | Observed static behavior. This generic-story function is not all of Word pagination, as the earlier investigation establishes. |
| Row reuse depends on layout context and available space. | `FsTableSrvFormatOrReuseRowInGivenHeight` at `0x150408` finds a previous row, checks its status and formatting flags, checks continuation/merge state and footnote conditions, and compares stored extent plus an edge allowance with the supplied height before reuse. The inclusive fit check is at `0x150754`–`0x150768`. | Observed static conditions. The flag meanings and complete invalidation contract are only partly recovered; content identity alone is insufficient. |
| Formatted rows have queryable stored geometry. | `FsQueryTableSrvRowDetailsCore` at `0x14fff4` copies stored fields into the output record with loads/stores and no formatting call. | Observed complete 44-byte function. This supports separating formatting from consuming geometry, not a claim about every display path. |
| Line creation returns reusable results. | `LsCreateLine` at `0x1a16c` calls its core formatter and copies outputs into the supplied break-record, line-info, and line-object destinations. | Observed wrapper and symbol signature. The decompiler did not recover a complete calling convention; the assembly preserves the output transfers. |
| Table page continuations have separate formatting state. | `FsFormatTableSrvFiniteCore` at `0x14908c` consumes a table break record and formats first/repeated headers and repeated/last footers through distinct calls. `FsFormatCell` at `0x145c3c` delegates cell formatting through a host callback or the paragraph formatter and produces continuation information. | Observed call/data flow. A single whole-row height does not describe all fragment behavior. |

## Consequences for the viewer

The following are implementation recommendations inferred from the observed
contracts, not recovered Microsoft source:

1. Prepare font-dependent line metrics and line breaks before visible paint.
   Use the same prepared rows, cell widths, margins, border reservations, and
   spacing decisions for pagination and rendering. A second independent CSS
   wrapping calculation can disagree even when the original measurement is
   accurate.
2. Treat the finalized page plan as an explicit result. Painting and scrolling
   should consume it without changing page membership merely because a page
   becomes mounted. Internal retries for floats, footnotes, or table fragments
   can finish before the result is published.
3. Cache measurements with their full context: effective text/style, font
   revision, available width, section geometry, compatibility policy, and
   continuation state. Reuse only where that context remains valid. A DOM
   fragment from a split or merged row is not a canonical whole-row measurement.
4. Retain exact fractional browser metrics where the paint path uses fractions.
   Native integer arithmetic must be applied only at established unit
   boundaries. The native equality branch does not justify an arbitrary CSS
   pixel tolerance or a global rounding change.
5. Keep unsupported layouts on a measured path until a shared deterministic
   planner is qualified for them. Simply freezing estimated page breaks can
   eliminate visible movement while retaining wrong wraps or clipped content.

The existing portable line-metric helpers already implement the bounded
component-maxima and fit contract. This pass identifies an architectural
direction and revalidates that contract; it does not supply a new universal
font metric, table solver, or replacement for all layout measurement.

## Evidence ledger

| Scope | REA Evidence ID |
| --- | --- |
| Initial focused procedure inventory | `ev_4971262b0842a6c72a8a9b274933f814797c0d4d03809b27f7d9636290e324c6` |
| Generic line fit | `ev_45838d3849b0dce53ca6cb1563278efda47dce03959039d45464f93703386179` |
| Page-body formatting and restart loop | `ev_7c8a03b1c31e69c583bd8d49122c8d55c656cb12c9d76991e09c86b37fc7de35` |
| Collision restart | `ev_dbd7d41c05f49014692c4591d10ea13b3ef152fb81f1bb067c5a6f79efd34d2e` |
| Not-reached restart | `ev_684452f85f887ada34bc48235c3bd1845d93069f24bc9327abe1fbf24b7a3be0` |
| Finite table formatting | `ev_5de0f98c91708eed79fa0096b8a57fa07ed65fd47fc9a39707f493864fef0f4a` |
| Focused row/cell procedure inventory | `ev_40ff68360ee7b7c341563049fd5a021824359fbd81af1da130158dd232a679bb` |
| Cell formatter | `ev_406b04c5810f9d5cfa7b5aa4c0c624653a3ea35d0a8f278d9f888e297563f4d4` |
| Conditional row formatting/reuse | `ev_d70669dec9d79a91d8e6bcfd62f4f5d7ab8b26ccedd88722933d82d8161e04d8` |
| Row geometry query | `ev_f5659feebab0ebe847e781f7e6faf3567b26e115f08eed82afece94e3f9e73fc` |
| Line creation wrapper | `ev_6ece5d5a1b7c1d3daa6ed8a58f86b1e5d2577456423b898601f03a0b4eb64b30` |

The row-reuse dossier exceeded the MCP transport response limit. REA retained
the complete record, which was read from the exported bundle; it was not
re-analyzed to work around the response limit. Function dossiers include
decompiler-derived value-flow data, some of which is explicitly truncated.
The findings above use complete function assembly/pseudocode and do not claim
complete cross-function value flow or runtime branch coverage.

## Remaining qualification

This pass answers whether native formatting is inherently separated from
geometry consumption and whether a literal single pass is universal: geometry
is reusable, and internal restart paths exist. It partially answers the
measurement/cache contract and does not establish complete Word page-break or
pixel parity. Accurate shaping and actual font selection, mixed-script leading,
autofit tables, merged continuations, footnotes, and floating-object interaction
still require source-bound Word output comparisons. First-load stability,
geometry correctness, and cold-load speed need separate browser measurements.

## Bounded native export qualification

Four synthetic control documents were subsequently exported by the installed
Word application, version **16.106.1**, build **16.106.26021521**. Each declares
Arial, US Letter paper, 72 pt margins, compatibility mode 15, automatic single
line spacing, and zero paragraph before/after spacing. The fixed tables have
two equal 234 pt columns, automatic rows, 5.4 pt horizontal cell margins, and
zero vertical cell margins. No control contains headers, footers, floating
objects, notes, tracked changes, or a document grid.

| Control | Native result | First-page baseline progression |
| --- | --- | --- |
| 50 independent 12 pt paragraphs | 2 pages; 46 paragraphs, then 4 | 83.28–704.16 pt; mean advance 13.797333 pt |
| 8 long wrapping 12 pt paragraphs | 3 pages; 46, 46, and 12 painted text lines | 83.28–704.16 pt; mean advance 13.797333 pt |
| 60 borderless 11 pt table rows | 2 pages; rows 1–51, then 52–60 | 82.32–714.72 pt; mean advance 12.648 pt |
| 60 half-point-grid 11 pt table rows | 2 pages; rows 1–49, then 50–60 | 82.8–714 pt; mean advance 13.15 pt |

All four source DOCX hashes remained unchanged. Each PDF's complete text
matches its source after removing whitespace, and rendered first pages were
visually checked. PDF glyph positions are quantized: successive advances
alternate among nearby values, so the recorded arrays and endpoint progression
are preferable to treating a median step as an exact layout constant. These
results qualify the native controls only; browser agreement is evaluated
separately.

Sources, PDFs, source/PDF hashes, per-page text, every line's baseline and
bounds, border edges, generator, and extraction script are retained under
`output/word-layout-research/word-controls/`.
`native-metrics.json` is the complete machine-readable record;
`native-summary.json` contains a compact summary. The PDFs embed an ArialMT
subset. Both the system and bundled Arial font hashes are recorded; the PDF
font name alone does not identify which installed file supplied that subset.

Only these task-owned documents were opened and closed. A final scripting
check confirmed all four were closed. Word required access to their temporary
folder for export; no unrelated document was saved, edited, or closed.

## Implemented browser path

The viewer now automatically uses precomputed pagination when every paragraph
has a supported whole-text layout plan and every table has a supported fixed
layout. Both pagination and painting consume those plans and the same fractional
table-row heights. This path uses strict page fit, bypasses DOM-driven
pagination feedback and delayed refinement, and permits page virtualization
immediately. The existing measured path remains available for unsupported
content. The root `data-docx-layout-mode` attribute identifies the selected path.

Eligibility is deliberately bounded: one section and column, no populated
headers or footers, notes, tracked changes, or custom heading overrides. Tables
require simple fixed columns and one supported paragraph per cell, without
merged cells, nested tables, repeated headers, exact row heights, or floating
placement. Supported borders use the existing uniform automatic-border path.
Oversized supported rows can still split across pages.

Both parsed-document loading and direct import request the document's actual
font families, styles, weights, and Unicode ranges before publishing layout.
The viewer does not build hidden page plans while an import is awaiting fonts.
Cancellation invalidates stale font work, so an earlier import cannot replace
a newly created document or a later import error. Font failures retain the
available fallback; unavailable fonts therefore remain a fidelity limitation.

Whole-text eligibility and layout plans are cached by immutable paragraph
identity and layout inputs, with bounded per-paragraph caches and invalidation
when font metrics change. Parsing remains in Rust/WASM; font-aware layout and
painting remain separate browser stages.

## Browser and native comparison results

Final frozen-source Chromium runs matched Word's complete per-page text for
all four controls above, ignoring whitespace. The plain paragraphs now break
46/4 instead of the measured comparator's 47/3; borderless rows break 51/9
instead of 50/10. All controls had zero geometry or page-membership changes
after their first imported DOM, reachable final pages, and no detected text
outside physical pages or cells. First-page screenshots were also inspected.

A further 600-paragraph control was exported through Word. Both Word and the
precomputed viewer produced 14 pages: 46 paragraphs on each of pages 1–13 and
two on the final page. Every page's full normalized text matched, with all 600
paragraphs present exactly once. The measured comparator produced 13 pages.

Performance comparisons used immutable copies of the same source and WASM;
the comparator disabled only the precomputed eligibility result. Figures below
are medians of three runs in a headed Chromium development build, not a
production performance guarantee.

| Control | Measured first imported DOM | Precomputed first imported DOM | Change |
| --- | ---: | ---: | ---: |
| 60 borderless rows | 596.8 ms | 491.7 ms | 18% faster |
| 60 bordered rows | 583.5 ms | 490.8 ms | 16% faster |
| 600 paragraphs | 1097.4 ms | 492.9 ms | 55% faster |
| One tall split row | 259.0 ms | 286.7 ms | 11% slower |

Short plain-text controls were essentially unchanged. For 600 paragraphs,
time to final stable geometry fell from 1549.5 ms to 492.9 ms. The viewer
mounted four pages initially instead of all 13 comparator pages, and median
viewer rectangle reads fell from 13,388 to one. These counts include all
viewer rectangle reads, not just pagination reads, and exclude the probe's
own inspection. Zero-to-one reads remained for the precomputed controls.

The tall-row probe painted all 5,399 long-cell characters and all 23 adjacent
short-cell characters exactly once across three pages, with no partially
clipped glyph boxes. Six browser lifecycle checks passed for delayed font
readiness, both import APIs, document replacement, and stale import cancellation.
The existing unit suite passed 762 tests, with one skipped; the final existing
browser suites passed all 18 checks. Type checking and the package build also
passed. No new unit tests were added.

Evidence is retained under
`output/word-layout-research/`: the `controls-final-frozen-cli`
records contain the final four-control comparison, `stress-*-cli` contains the
three-run timings, `long-word-comparison.json` and `long-membership.json`
contain the full 14-page comparison, and `font-lifecycle/results.json` contains
the cancellation checks. `comparison-snapshot.json` and
`comparison-final-snapshot.json` record the source/WASM hashes. The long
control's native PDF and complete metrics are in `stress-controls/`.

## Limits of the result

This establishes stable first presentation and matching page text for these
five native controls, not universal Word parity. The bordered-row browser
height still exceeds its planned height by approximately 0.0208 CSS px per
row because of browser rounding; the observed page breaks remain correct, but
exact pixel geometry and arbitrarily close fit boundaries are not qualified.
Only one Word version, browser/platform combination, and a narrow typography
range were compared.

Five existing complex documents correctly retained the measured fallback;
one still exhibited a later pagination shift. Broader coverage requires shared
layout plans for merged/autofit tables, fields, floats, notes, and complex
shaping, plus corresponding Word output comparisons. The native restart
evidence supports finishing any necessary internal retries before publishing
geometry; it does not support promising a literal single-pass formatter for
every document.

## Stable measured loading and performance follow-up

Measured imports now keep the initial document hidden until pagination settles,
including document replacement. The readiness flag belongs to the current
document load, so a previously loaded document cannot reveal its replacement
prematurely. Detached thumbnail rendering retains its separate readiness path.

The follow-up removes a footer-clearance feedback loop: a footer outside the
body no longer makes page capacity depend on the last body line's position.
Measured header/footer limits also take precedence over attempts to fit the
stored page-count metadata. The initial hidden estimate avoids that search
until physical measurements are available.

The viewer premeasures the initial viewport plus overscan, enables virtualization
when that layout is ready, and replaces the fixed 240 ms wait with two stable
animation frames after pending measurements. It reuses paragraph line counts,
text fragments, and pagination candidates, and stops section-tail checks as
soon as their allowed overflow is exceeded. Initial in-flow header clearance is
estimated directly, and measured corrections distinguish absent values from zero.

Five alternating runs per version used frozen viewer, layout-core, and WASM
sources in headed Chromium with a 1280 by 900 viewport. Timing begins at the
file-input change event and ends at the first stable visible document; application
startup is excluded. Both versions use the same development build configuration.

| Metric | Stable baseline | Optimized |
| --- | ---: | ---: |
| Median first stable visible document | 2461.6 ms | 509.6 ms |
| Range across five runs | 2340.8–2497.0 ms | 491.5–569.7 ms |
| Viewer rectangle reads per run | 12,868 | 1,866 |
| Visible geometry states per run | 1 | 1 |

This is a 4.83× improvement, below the requested 10× target. It measures this
document and environment rather than promising the same gain for every import.
The semantic digest is unchanged. All 21 pages were reached; every body
paragraph's text matched after removing generated numbering labels, no body
glyph boxes extended beyond their page, and returning to the beginning preserved
the initial geometry. This does not establish native Word page-break parity.

The existing unit suite passed 762 tests, with one skipped. Rendering, thumbnail,
and responsive browser checks passed; the virtualization test now waits for a
visible page instead of assuming that more than five pages mount initially,
while retaining the assertion that scrolling reaches the final page. Type
checking and the viewer package build passed. No new unit tests were added.

Benchmark snapshots, source hashes, profiles, and checks are retained under
`output/layout-performance/`. The final comparison is recorded in
`comparison-final.json` and `comparison-final-snapshot.json`; full-document
scrolling and text verification are recorded in `quality-final.json`.
