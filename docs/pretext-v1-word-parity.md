# Pretext 1.0.0 and Word layout

The migration to [Pretext 1.0.0](https://github.com/chenglou/pretext/releases/tag/v1.0.0)
replaces the custom per-run line walker with Pretext's
paragraph-wide rich-inline layout. Break opportunities come from the joined
paragraph while widths retain each run's typography. Source offsets remain
UTF-16 positions in the original document, including uppercase expansions,
hard breaks, and discretionary hyphens.

## Typography contract

The dependency extension retains explicit kerning, OpenType feature settings,
uppercase measurement, and horizontal character scaling. Glyph scaling and
tracking are separate: scaling changes glyph advances and tracking is then
applied in final layout pixels. Measurement caches must distinguish every
effective typography input. Font revisions clear plain and rich prepared
handles together.

Explicitly enabled optional ligatures combined with character spacing need a
cached DOM probe: Chromium Canvas can suppress those ligatures under spacing
even while DOM text retains them. The patch counts the painted spacing
contributions, and caret measurement uses ranges in the complete fragment so
positions inside a ligature follow its painted shape. The default typography
path retains Canvas measurement. Temporary probe nodes are removed after use,
and measurement canvases are removed when replacing their language context.

Word's previously qualified kerning and optional-ligature policy remains in
the viewer's typography resolver. Upstream defaults are insufficient because
Pretext assumes browser-default font features. Its new browser-specific break
rules also do not establish Word equivalence.

The adapter consumes public source ranges and continuation cursors instead of
writing Pretext's private width and break arrays. Object widths, exclusion
intervals, per-row vertical metrics, and paragraph-ending metrics remain owned
by the viewer.

Positioned text now paints a chosen discretionary hyphen at its source
character's offset. The presentation substitution preserves the original
model and UTF-16 length, and the fragment cache includes the hyphen decision.
Previously the renderer reconstructed the original invisible character even
when the line planner had selected the visible hyphen.

Paragraphs with left or right indents now use the same Pretext line count for
height estimation and painting when their first-line width is uniform. The
previous eligibility check excluded every indent, allowing the legacy estimate
to charge four lines for a paragraph that painted three. First-line and hanging
indents retain their existing specialized paths. This correction changes no
page-fit tolerance.

Explicit left tabs now recompute their advance from the line where they
actually land. A tab that wraps must use that line's origin instead of the
previous line's accumulated advance. The bounded refit and height estimator
share one layout routine, preserve source coverage, and fall back to the
original consistent layout if refitting cycles or fails to converge. It is
limited to supported text/tab paragraphs without numbering or first-line and
hanging indents. Twenty-one actual-build comparisons retain all page counts;
eleven boundary widths retain exact estimator/painted-line agreement. Improved
tab placement can expose existing downstream wrapping differences, which remain
recorded in `visual/TAB-REFIT-QUALIFICATION.md` rather than hidden by a missing
line.

Corpus validation found that the existing section-tail pagination path can
retain overflowing body paragraphs. Wrapped-tab refitting therefore stays on
the established body path when the document has hard section transitions;
headers, footers, and notes retain the qualified refit. A private node-view
context carries this policy through measurement and painting without changing
the source model. The broader removal of section-tail retention was rejected
because it worsens other measured layouts. Those existing clipping and
pagination gaps remain explicit in the corpus report.

## Upstream parser corrections

Parser changes live in `extend-hq/rust-office` and are consumed through
published crates. The legacy table-cell margin correction merged in
[upstream PR 9](https://github.com/extend-hq/rust-office/pull/9) and was published
as `rust-docx` and `rust-docx-wasm` 0.2.12. Registry archive checksums and VCS
identities were independently verified. Per-cell and row-default padding now
retain explicit zero and inherited values. Across the twelve binary DOC inputs,
this improves physical page-count agreement from ten to eleven, with the other
eleven counts unchanged. One of the twelve Word references required repair and
remains conditional; the unrepaired subset improves from nine of eleven to ten
of eleven. Counts alone do not establish layout parity.

Uncached PAGE/NUMPAGES fields retain an optional `fieldInstruction` on an empty
text run. This preserves zero UTF-16 source length and formatting while allowing
the viewer to resolve the value on each page. The initial change was published
in [upstream PR 10](https://github.com/extend-hq/rust-office/pull/10) as
`rust-docx` and `rust-docx-wasm` 0.2.13. The follow-up published as 0.2.14 in
[upstream PR 11](https://github.com/extend-hq/rust-office/pull/11) also preserves
separator-less fields, using the first instruction run's formatting. Native
Word controls independently establish both the displayed value and formatting.
Cached fields remain unchanged; nested, malformed, and unsupported fields
retain their conservative behavior. Original paragraph XML is preserved, and
rebuilding a marker emits a styled field instruction rather than a fabricated
cached number.

Clone, clipboard, and text-edit boundaries preserve the marker. Displayed digits
are marked as generated text so source geometry continues to use the original
zero-length field offsets. Browser controls cover body text, section numbering
restarts, ordinary and nested table cells, headers, footers, number-format
switches, and mixed cached/uncached fields. Rust artifact validation covers 28
cases and source-text/XML equivalence across 8,897 paragraphs in 33 source
documents. The viewer pins the registry release through an exact
`rust-docx-wasm = "=0.2.14"` dependency; archive checksums and the
merged source revision `3b3f28fd96b428306e96295d180488eb87ac2d87` were verified.
The complete final corpus sweep is tracked separately from these controls.

Page numbering also preserves an explicit zero start. Native Word shows decimal
zero while leaving Roman and alphabetic zero fields blank; NUMPAGES stays
positive. The eight affected OOXML inputs preserve their physical page counts
and source text. This corrects a one-page label offset after a hidden cover page.
The existing cached-body-field limitation remains documented separately;
uncached body fields, dynamic footer fields, and textbox fields were verified.

A footer-only legacy story correction removes the terminal guard character
specified by the binary format. The actual Rust before/after projection across
all twelve DOC inputs changes exactly 21 footer XML parts by removing the
terminal empty paragraph; body/header content, formatting, geometry, source
mappings, and binary assets remain unchanged. Controlled rendering improves the
remaining page-count mismatch, reaching twelve of twelve counts, including one
repair-dependent reference. This is still a count result, not complete layout
parity. The published-WASM corpus capture confirms all twelve counts, including
eleven unrepaired references and one conditional repaired reference.

The corresponding header guard change remains deferred: removing it exposes an
existing header-positioning error and regresses another page count. Header
floating-table placement and compatibility flags have separate investigation
artifacts. No arbitrary blank-paragraph removal or page-fit adjustment is used
to improve counts.

Correcting footer story bounds exposes a font-availability regression in one
binary input: correctly paged characters fall from 5,823 to 5,687 out of 6,131,
although the footer image moves to within 0.06 pt of Word. A diagnostic render
with Word's actual symbol font reaches 6,047 correctly paged characters. The
fallback font has different line metrics and glyph coverage; an open-font alias
did not qualify across the affected cohort. No proprietary font is bundled and
no incorrect footer guard is restored to compensate. This remaining regression
and the rejected alternatives are retained in `footer-regression-debug`.

The initial-paint readiness gate also distinguishes whole table rows from
fragments that cannot provide reusable row measurements. It can settle when
all observed rows are explicitly ineligible for measurement, while zero or
nonfinite measurements of whole rows continue to block readiness. No synthetic
row heights enter the measurement cache. Positive and negative artifact probes
verify both paths.

## Fresh native investigation

REA/Ghidra inspected the installed Word 16.106.1 layout framework on
2026-11-06. The original framework SHA-256 is
`c725cced2da1d7947c4e7ca5a2ab1c533f560d763de4d0e98201dc8cbdce84b5`;
the arm64 slice SHA-256 is
`fbaa834a667ae53c65a6f83079906f77a3fc14e537f9634d4f88c772d8460f1b`.

`CheckBreakAtSpace` (`0xc1fe8`) and its surrounding-character helpers
(`0x4cd30`, `0x4ce20`) inspect neighboring non-space text across chunk
boundaries. The decision helper (`0xc3340`) uses character classes,
cluster-boundary checks, a class-pair table, and conditional host callbacks.
`LsFHyphenFitsUseTruncateReal` (`0xd2600`) includes the selected hyphen's
advance in its conditional fit comparison.

This supports paragraph-wide breaking and reserving visible hyphen width.
It does not establish that native chunks map one-to-one to OOXML runs or that
browser and Word break classes are identical. No proprietary implementation
or private class tables were copied into the renderer.

The local evidence ledger and original REA evidence IDs are retained in
`output/pretext-v1-20261106/native/findings.md`; complete evidence and the
closed-session snapshot are retained beside it. These observations are static,
not a trace of a document's execution.

The subsequent corpus investigation inspected `FsCheckLineVerticalFit`
(`0x2d3b4`) and `FsFormatTextSimple` (`0x165d08`). These routines compare
aggregated line metrics against available vertical space, with host callbacks
and additional constraints. This supports keeping measurement and actual
formatted-line geometry consistent; the controlled Word output supplies the
behavioral evidence for the indent correction. Its evidence ledger is retained
in `output/word-corpus-parity-20261106/native/findings.md`.

Targeted REA analysis of Word's `mso20` framework also found character-based
uppercase helpers with locale-dependent handling. A fresh multilingual Word
control confirms that its presentation casing differs from full browser
uppercase expansion. The private mapping tables were not copied. Evidence,
binary identities, finite control results, and font-fallback caveats are retained
under `output/word-corpus-parity-20261106/native/casing`. This remaining gap needs
a shared casing policy across measurement, painting, and source/caret mapping.

Six controlled Word exports also show that a standalone page-break paragraph
can itself overflow and retain a blank page. The inspected hard-break status
and result-conversion routines do not establish a global coalescing rule.
Consequently, no blanket suppression of overflowing page-break paragraphs was
added. The control outputs and static evidence are retained in
`manual-break-controls` and `native/manual-break-evidence.json`.

The focused tab investigation found that `LsGetCurTabInfoCore` (`0xfa718`)
selects tab positions relative to current horizontal position and computes the
advance from that difference; pending-tab handling also updates subline state.
The margin-after-tab routine delegates to a host callback whose behavior is
not established here. This supports position-dependent advances, while the
Word exports supply the actual overflow evidence. The complete observations
and limitations are in `native/tab-findings.md`.

## Validation scope

The previous build is frozen in `output/pretext-v1-20261106/baseline-dist`.
Fresh Word exports cover mixed formatting, punctuation, discretionary hyphens,
kerning, negative tracking, and uppercase text across a width sweep. The
comparison must retain the same source and Word reference for both builds.
Rendered line endings, source coverage, and page membership are separate from
baseline position and pixel agreement.

The semantic control document uses `w:softHyphen` for discretionary hyphens,
eight typography categories, and 17 widths per category (120–280 CSS px).
Both builds were compared with the same Word-exported PDF. The browser was
Chromium with the same fonts and capture configuration for both builds.

| Measurement | Patched 0.0.8 | Migrated 1.0.0 |
| --- | ---: | ---: |
| Exact visible line text by paragraph | 91 / 136 | 119 / 136 |
| Exact visible line text and page membership | 87 / 136 | 118 / 136 |
| Line page-membership arrays | 124 / 136 | 132 / 136 |
| Plain discretionary-hyphen paragraphs | 2 / 17 | 17 / 17 |
| Mixed-format discretionary-hyphen paragraphs | 5 / 17 | 17 / 17 |
| Kerning-enabled paragraphs | 16 / 17 | 17 / 17 |
| Total pages (Word: 17) | 17 | 17 |

There are 28 newly exact paragraphs and no previously exact paragraph
regresses. Mixed words, mixed punctuation, disabled kerning, and negative
tracking retain their 17/17 line-text matches. The remaining 17 uppercase
paragraphs expose a pre-existing difference: Word retains sharp-s while CSS
uppercase expands it. The subsequent indent correction restores page-membership
arrays from 132/136 to 136/136, while retaining 119/136 exact line-text matches
and 17 physical pages. This result was revalidated in actual read-only mode.
The line comparison normalizes whitespace and omits invisible soft-hyphen
characters; it retains visible hyphens and all line boundaries. It does not
measure pixel agreement or establish corpus-wide Word parity.

A separate retained control document places literal U+00AD in `w:t`. Word
paints that input differently from `w:softHyphen`; its reference is not
rewritten or substituted. Exact matches improve from 84/136 to 85/136, while
its 18-page Word reference remains different from both 17-page viewer
outputs. `comparison.json` and `comparison-semantic.json` retain both sets.

The corpus pass preserves this distinction. Word saves the literal characters
back as literal text and the semantic elements back as elements; neither input
is normalized into the other. The current parser flattens both into U+00AD, so
their distinct Word presentation semantics cannot be recovered by the layout
adapter alone. The indent correction reduces correctly paged characters for
the literal-character control from 7,616 to 7,427 out of 9,027 matched characters
relative to the initial migration, while fixing all semantic-control paragraph
page assignments. That refinement tradeoff remains visible in the report.
A proper correction requires preserving the distinction in the parser/model;
changing page-fit tolerances would only hide it. The optional behavior of the
semantic element is defined in the [Open XML reference](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.softhyphen?view=openxml-3.0.1).

The primary immutable inputs are:

| Artifact | SHA-256 |
| --- | --- |
| Semantic DOCX | `3019e62cd96adf91ba294b758aab7a7be38d08683e14f2b83f817a71afe8cb23` |
| Semantic Word PDF | `a6d01bbe5e335aecde5499ea31c0767541cc4c5177e1d9c9e5b825ff16f0291b` |
| Literal-character DOCX | `399af730fc2a3d9a86d8e6cf4fba879a20fcc15b3e2f3691dc39e230d1081c9a` |
| Literal-character Word PDF | `96085625916be842af3c3cf0df6778998e98c223a5d4c518a2bfcd5c6d88d83b` |

All artifacts and capture scripts are retained under
`output/pretext-v1-20261106`. Source controls and Word application binaries
remain unchanged. No new unit tests were added.

Source verification covers 916 rendered fragments across 272 paragraphs,
with no gaps, overlaps, or incorrect range lengths. Re-export preserves all
paragraph text and all 85 semantic discretionary-hyphen elements.

An additional Chromium typography probe covers 68 width cases, including
explicit ligatures, positive and negative tracking, character scaling, and
long words in Arial, Times New Roman, and bundled Carlito and Tinos. The
maximum planned-versus-painted width difference is below
0.019 CSS px; checked caret positions differ by less than 0.017 CSS px.
All 16 narrow uppercase-expansion source checks pass. Repeating the probe
under root CSS zoom of 2 keeps width and caret differences below 0.008 CSS px.
The scripts and raw measurements are retained in `typography*` artifacts.

The registry-backed final build, full workspace/playground type checks, 967
existing unit tests, 46 oracle-contract tests, and 17 Chromium checks pass.
The browser checks cover fidelity, source geometry, annotation export/reopen,
and thumbnail cold starts. Seven final consumer controls also pass, alongside
two end-to-end controls loaded from DOCX bytes through the published parser.
Frozen-lockfile installation was verified for the Pretext dependency migration.
The corrected immutable build and validation receipts are retained in
`output/word-corpus-parity-20261106/corrected-validation.json`. Its 77-file build
identity is `546d4e536f37d9a1a20b896e3edcb1b9aa725701b616632f9a3605a1f88ac071`.
Twenty-three actual-build controls additionally verify the section-tab boundary
and its interaction with zero-start numbering. The earlier
`final-validation.json` remains tied to the preceding build.

Bundle measurements for all five builds are retained in
`final-bundle-sizes.json`. Upstream speed claims have not been treated as
end-to-end viewer speed; the corpus report measures each complete rendering
run. Recorded worker scheduling and overlapping capture jobs affect those
timings; they are not controlled dependency speed benchmarks. Broader
multilingual, cross-browser, and pixel fidelity remain unqualified.

## Local corpus audit

The frozen filesystem inventory contains 1,360 paths representing 1,181 unique
byte sequences. Of these, 1,176 are eligible Word documents: 1,164 DOCX packages
and 12 binary DOC documents. Content detection identifies 175 DOCX packages
whose filenames use `.doc`. One additional Office package is encrypted; four
other candidates are owner locks or non-Word extension collisions.

The scan covered hidden and ignored files across 44 physical roots. Permission
errors prevented complete enumeration of 13 roots. Extensionless files, archive
members, remote-only documents, and files created after the discovery window are
outside this frozen cohort. The audit does not claim coverage of inaccessible
files. Source hashes, aliases, discovery errors, and exclusions are retained in
`output/word-corpus-parity-20261106/inventory.json` and `inventory-report.md`.

Fresh native Word exports and five immutable renderer builds are compared
against the same original source bytes. Physical page counts, source-to-page
membership, line breaks, geometry, and visual differences are separate metrics.
Printed PAGE/NUMPAGES label agreement is not inferred from physical page counts.
Repaired Word references and failed exports remain separate coverage categories.

The native Word run attempted all 1,176 eligible inputs and produced 1,058
qualified references totaling 20,692 physical pages. One reference required
in-memory repair; the other 1,057 are the primary reference set. The remaining
118 inputs have terminal export failures after the bounded recovery pass.
All 1,360 inventoried source paths still match their original hashes. Permission
errors and the encrypted source remain separate from export failures.

The corrected geometry sweep also attempted all 1,176 inputs: 1,169 rendered
successfully, producing 7,383 viewer pages, and seven retained their existing
large-model failures. Source, frozen-build, capture-profile, and readiness
identity checks report no violations. Those seven failures represent 14,673
Word pages and remain outside the paired fidelity aggregate.

The shared unrepaired comparison contains 1,049 documents and 6,010 Word pages.
Exact physical page counts improve from 952 to 954. The stricter native-text
page-parity check, which also requires complete page text, dimensions, and no
clipped text or failed images, improves from 113 to 115. It does not measure
pixel equivalence. The paired user-document subgroup retains 327/418 exact
physical counts; its stricter native-text page-parity matches improve from 96
to 98. The two physical-count gains occur in repository fixtures.

Within the qualified user-document comparisons, correct-page text improves for
15 documents with no losses, visible text improves for 12 with no losses, and
common-position recall improves for 17 with no losses. Line-break recall has
12 gains and the two separately investigated losses. The shared user-document
cohort covers 4,777 Word pages; generated artifacts retain their own group.

The corrected visual sweep also attempted every eligible source, with the same
1,169 successes, seven failures, and 7,383 physical viewer pages. Its primary
comparison uses the four complete visual variants: baseline, initial migration,
refinement, and corrected build. The preceding intermediate build's partial
visual capture is archived separately and does not limit that comparison.
The 48-DPI image diagnostics cover shapes and textless pages separately from
native-text scoring; they do not establish exact pixel equivalence.
Among 1,044 shared documents with a defined edge-overlap score, 38 improve,
14 decline, and 992 remain equal. With an absolute 0.001 sensitivity band,
22 improve and nine decline. All raw changes remain in the report. These
coarse raster regressions, including unresolved initial-migration and parser
follow-up cases, prevent a universal visual-improvement claim even where
native-text placement improves.
Mean per-document edge overlap changes from 0.623916 to 0.625406; the
pixel-weighted score changes from 0.426711 to 0.427578. The 1,338 Word pages
without native text, including 1,313 with visible ink, retain identical viewer
thumbnails across the four complete builds. That establishes renderer
stability, not visual equivalence to Word. Final image, feature, coverage, and
integrity evidence is linked from `visual/FINAL-VISUAL-RESULTS.md`.

Across qualified directional comparisons, visible text improves for 16
documents with no losses; correct-page text improves for 20 with one loss;
line-break recall improves for 17 with two losses; and common-position recall
improves for 22 with one loss. Unresolved alignment and textless inputs remain
unavailable for these directional metrics. The font-related loss and both
line-break qualifications are described below and in the detailed report.

The final field audit covers 143 source documents containing relevant fields.
For the baseline-to-corrected common qualified cohort, matching PAGE labels
improve from 102/161 to 161/161 across 51 documents, with 59 gains and no losses.
The mean per-document match rate improves from 92.16% to 100%; four documents
improve. The separate preceding-build comparison isolates the zero-start fix:
408/421 to 421/421 across 52 documents. All 55 qualified NUMPAGES values also
match. These are qualified occurrences, not a claim about every field: 65
documents remain ambiguous and 26 unavailable to the field audit. Their
physical page counts are unchanged. Provenance and per-occurrence records are
retained in `final-corrected-page-field-review.json`.

The initial browser sweep used unsupported `mode: "read"`, which the viewer
treated as editable mode. Those observations are archived and excluded from
read-only parity claims. The replacement profile uses `mode: "read-only"` and
`zoom: 100` (the API accepts percentages). It captures every physical page and
records asset and readiness failures. Native Word references remain valid.

Text alignment uses deterministic work limits, not wall-clock timeouts. When
alignment is incomplete, absolute text recall is a lower bound rather than
proof of omitted text. Changed-text pairs with unresolved alignment do not
contribute fidelity deltas. Empty-text pages require visual assessment; they
cannot establish text-based parity by themselves. The live report and complete
capture receipts are retained under `output/word-corpus-parity-20261106`.

Restoring missing page-field text can lower a line-break score without changing
body layout. Exact comparator replay for one such result confirms identical
body words and geometry: the new footer digits interrupt aligned character
adjacency at pre-existing incorrect page boundaries. The raw score loss remains
visible, with this causal qualification in the field-boundary audit.

A separate initial-migration residual changes wrapping of punctuation-heavy
numeric and date text: matching Word line boundaries decrease from 5,139 to
5,087 out of 17,781, while text recall, page membership, and physical page count
remain unchanged. The corrected build retains the same geometry as the initial
migration. The underlying break-policy or measurement cause is not isolated;
the paragraph-level evidence remains in the visual diagnostics. Together with
the symbol-font and discretionary-hyphen distinctions above, this prevents a
claim that every document improves.

Large-model failures are retained in coverage. A standalone reproduction of
one browser JSON failure produces a 694,971,709-byte native model, beyond the
JavaScript engine's single-string limit. This is a transport/resource failure,
not evidence of missing document text or layout parity. The native size audit
and same-WASM reproduction are retained under `large-model-debug`.
