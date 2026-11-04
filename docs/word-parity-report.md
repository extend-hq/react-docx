# Word parity evaluation — expanded sample, 2026-10-13

An additional **1,000 distinct DOCX documents** were sampled, with no ID or byte-hash overlap against the prior 1,392 inputs. This pass retains six general parser/layout fixes and preserves the earlier local work. All changes remain local and uncommitted. Full Word parity is still incomplete.

| Paired page-count check | Starting checkout | Retained changes |
| --- | ---: | ---: |
| Original corpus, fixed 995-reference pool | 808 / 995 | **810 / 995** |
| New corpus, same 984 successfully rendered and qualified inputs | 795 / 984 | **799 / 984** |
| Local documents, updated 48-reference pool | 43 / 48 | 43 / 48 |
| Original summed absolute count error | 939 | 935 |
| New common-input summed absolute count error | 707 | 676 |
| Local summed absolute count error | 21 | 22 |

Viewer coverage is **1,000/1,000 original**, **999/1,000 new** (up from 993), and **386/392 local**, with the same six pre-existing local model-transfer failures. The new sample yielded 998 Word reads; two unreadable sources and seven references whose markup view could not be controlled are excluded from native qualification. That leaves 991 qualified Word references, and **799/990 (80.71%)** matching counts among current successful renders. The six recovered renders add six count pairs and 52 error pages: the aggregate 707 → 728 errors across unequal denominators is not a paired comparison. The same-input result is 707 → 676.

The original headline keeps the existing 995 count references for comparability. Four fresh, source-bound Word counts differ from retained references; their exact values are listed in the comparison receipt. The local pool adds one qualified reference to the previous 47; the old 43/47 figure must not be compared directly with 43/48 as a code regression.

[Final comparison](../output/playwright/parity-expand-20261013/comparison-final.json), [capture ledger](../output/playwright/parity-expand-20261013/final-capture-ledger.json), [native qualification](../output/playwright/parity-expand-20261013/native-qualification-final.json), and [independent final audit](../output/playwright/parity-expand-20261013/v3-audit/FINAL-VERIFICATION.md) retain the per-document evidence.

## Page breaks and tradeoffs

Word's next-page traversal skips some implicit blank pages. Sequential traversal indices were therefore not reliable physical page numbers. The reference pipeline now reads Word's unadjusted physical page index, checks it against the document count, and screens older references for section-parity risks and traversal shortfalls. Two inconsistent native physical-index references are excluded from boundary metrics. Older boundary totals below are historical and superseded by this qualification.

| Same-reference boundary comparison | Starting checkout | Retained changes |
| --- | ---: | ---: |
| Original near matches, within 3 normalized characters | 774 | 789 |
| Original exact matches | 658 | 673 |
| New near matches | 1,523 | 1,572 |
| New exact matches | 1,364 | 1,412 |
| Local near matches | 21 | 19 |
| Local exact matches | 20 | 18 |

The common pools contain 782 original documents / 1,881 probed boundaries, 982 new documents / 4,697 boundaries, and 48 local documents / 71 boundaries. Anchorable totals are 1,855 original, 4,630 → 4,631 new, and 67 local. These are sampled main-story text boundaries, usually the first 16 traversable ranges, with physical ordinals where blanks intervene. They do not establish pixel equality or every boundary in long documents.

Across these pools, 69 previously nonmatching near boundaries become near matches and **seven previously near boundaries are lost**. Three new-corpus count matches are also lost, while seven are gained. The lost count matches correspond to correctly restored blank pages confirmed in fresh Word PDFs; other content-flow errors remain. Two original, seven new, and one local document have increased absolute count error. These tradeoffs are explicitly retained in the per-document comparison; this pass does not claim universal nonregression.

## Retained fixes

- **Current table grids:** parse direct grid columns without appending widths from historical change records. This corrects column geometry and duplicate table fragments. The source audit covers 24 affected inputs; changed paragraph/cell groups were checked for content preservation. One detailed table phrase still moves to a less accurate physical page despite a large overall boundary improvement. [Grid qualification](../output/playwright/noncjk-import-20261013/REPORT.md), [text and page-membership audit](../output/playwright/parity-expand-20261013/combined-audit/REPORT.md).
- **Signed wrap distances:** normalize unsigned encodings of negative drawing wrap distances to zero. Three original/control Word pairs have identical page counts, main-story text and PDF word boxes. The isolated 11-document gate changes only one count, from 12 to Word's 3, while retaining all text. [Native controls and isolated gate](../output/playwright/parity-expand-20261013/wrap-distance/REPORT.md).
- **Text cursor bounds:** reject unsupported cursor positions inside unbreakable prepared segments, retaining the valid line instead of crashing. Three newly sampled documents recover. [Cursor evidence](../output/playwright/layout-settle-20261013/REPORT.md).
- **Repeated-header progress:** avoid repeatedly moving an unsplittable row when only the repeated header has consumed page space. The previously hanging document renders 14 pages versus Word's 13; all 82 source text groups remain represented. [Row-progress qualification](../output/playwright/parity-expand-20261013/row-progress/RECOMMENDATION.md), [source coverage](../output/playwright/parity-expand-20261013/v3-audit/f052-source-coverage.json).
- **Stable paragraph-before measurements:** keep page-start margin suppression out of reusable measurements while preserving contextual spacing. Two further documents recover from layout oscillation. Wider spacing and cross-column measurement alternatives remain withheld because they changed native cuts or reused incompatible line indices. [Spacing evidence](../output/playwright/layout-settle-20261013/REPORT.md).
- **Section-numbering parity:** with odd/even headers enabled, page-number restarts can require an implicit blank page. Both source originals and eight controlled copies match Word's page counts and blank positions. All 42 potentially affected sources render. Six cases that reflow text retain all non-header text groups; character-level clipping checks cover 2,763 groups and 142,462 final characters with no wholly or partially clipped characters. Repeated header counts legitimately change. The clipping checks do not cover sibling occlusion or contrast. [Native and source qualification](../output/playwright/layout-settle-20261013/section-parity-controls/REPORT.md), [final paint binding](../output/playwright/parity-expand-20261013/v3-audit/section-paint-final-integration.json).

The negative floating-table candidate is **withheld and reversed**. It improved several counts and cuts but exposed an existing merged-row clipping defect, hiding a previously visible label. All 25 affected documents were recaptured after reversal; the label is visible again at its original rectangle. Broad automatic merged-row height changes remain withheld because an earlier experiment clipped glyphs. [Reversal and visibility audit](../output/playwright/parity-expand-20261013/v3-audit/FINAL-VERIFICATION.md).

## Sample, validation and remaining work

The new sample uses seed `parity-expand-20261013-v1`, 100 documents from each of ten types, length/language stratification, and 46 languages. Among 999 successfully inventoried inputs, there are 506 table-bearing documents, 22 with nested tables, 66 with floating tables, 347 with drawings, 170 with VML pictures, 94 with textboxes, 55 with footnotes, and two with endnotes. One source exceeded the XML inventory byte budget; its viewer and Word captures are included, but its features are not included in those totals. The acquisition manifest pins the corpus revision and metadata hash. The 21 acquisition rejections/replacements remain recorded; native failures were not replaced. All 2,392 original source hashes are unchanged. [Sample manifest](../output/playwright/parity-expand-20261013/manifest.json), [sample verification](../output/playwright/parity-expand-20261013/sample-verification.json), [source verification](../output/playwright/parity-expand-20261013/source-verification-final.json).

The verification is **a complete 2,392-source frozen-v3 run plus a final frozen-v5 rerun of 92 potentially affected corpus/local documents and eight controls**, not a second full run of every source on v5. The remaining 2,300 captures retain their v3 runtime provenance and fall outside the audited changed section/floating-table branches. All 100 final targeted captures succeeded. The four-face Calibri profile is unchanged. [Final runtime/source hashes](../output/playwright/parity-expand-20261013/frozen-build-v5.json), [ledger verification](../output/playwright/parity-expand-20261013/v3-audit/final-ledger-verification.json).

Validation passes **762 existing TypeScript tests** (one skipped), **46 Word-oracle tests**, **three browser geometry checks**, workspace/Playground typechecks, and layout-core/viewer/Playground builds. The parser/WASM state is unchanged since the successful **134 Rust tests** and WASM build in this pass. Final unit tests ran with one worker after concurrent runs exceeded timing budgets. Browser geometry checks used installed Chrome after the default bundled browser was unavailable. No unit tests were added during this continuation. [Validation receipt](../output/playwright/parity-expand-20261013/validation-final.json).

Remaining work includes the one unequal-column render loop in the new sample, six pre-existing local JSON-transfer failures, CJK font/grid metrics, automatic merged-row clipping, image/float geometry, and residual table/paragraph page flow. There are **191 count mismatches among the 990 qualified new render pairs**. Matching counts alone do not prove matching page membership. Some supplemental local Word references remain unavailable or unqualified; they are not silently treated as successful physical-boundary checks. [Prioritized new mismatch inventory](../output/playwright/parity-expand-20261013/open-new-count-mismatches.json), [native exclusions](../output/playwright/parity-expand-20261013/native-exclusions-final.json).

---

## Historical snapshot — earlier 2026-10-13 pass

The following section records the earlier four-fix pass. Its “current” counts and boundary totals refer to that earlier runtime and are superseded by the expanded evaluation above.

The current checkout was evaluated against the retained 1,000-document corpus and the 392 unique documents from the local DOCX and DOC testing folders. Four general fixes are implemented locally: unspecified fixed-table columns, imported page dimensions, literal XML text whitespace, and wrapped-image table pagination. Existing uncommitted typography, embedded-font, selection and block-geometry changes are preserved.

The starting checkout already matched **804/995** qualified Word page counts. This pass raises that to **808/995 (81.21%)**, with **no lost count matches and no increased absolute count error**. Equal page counts do not establish equal page breaks or pixels. This is the retained sample, not the complete document catalog.

| Corpus check | Fresh starting checkout | Current frozen build |
| --- | ---: | ---: |
| Attempted / captured | 1,000 / 1,000 | 1,000 / 1,000 |
| Qualified native page-count pairs | 995 | 995 |
| Matching page counts | 804 | 808 |
| More / fewer pages than Word | 119 / 72 | 113 / 74 |
| Summed absolute page-count error | 962 | 939 |
| Matching probed boundaries, within 3 normalized characters | 734 | 741 |
| Exact probed boundaries | 623 | 626 |
| Count and all probed boundaries matching | 415 | 420 |

The boundary comparison uses the same 767 source-bound native references: 1,665 probed interior boundaries, of which 1,639 can be uniquely anchored in both runs. No previously matching near or exact boundary was lost. Of the 508 references with interior boundaries, 163 → 166 match the count and every probed boundary; the broader 415 → 420 metric also includes single-page references. These are normalized main-story anchors, not a full visual oracle. All 1,392 manifest source hashes were rechecked and are unchanged.

[Full comparison and changed documents](../output/playwright/parity-20261013/comparison.json), [current corpus captures](../output/playwright/parity-20261013/verified-corpus.jsonl), [boundary results](../output/playwright/parity-20261013/boundaries-verified.json), [source verification](../output/playwright/parity-20261013/source-verification.json), and [source/runtime hashes](../output/playwright/parity-20261013/verified-build.json) retain reproducible evidence. The font profile is unchanged and supplies the same four Calibri faces. Five unqualified native count references remain excluded.

## Fixes and native qualification

- **Unspecified fixed-table columns:** retain explicit single-column preferences and distribute remaining preferred table width among unspecified columns. The rule is limited to wholly missing/zero grids, consistent row grids, no skipped columns and supported spanning constraints. It was previously held because of a regression against an older typography build; the fresh comparison against the current checkout clears that regression. The retained eight native width controls establish the allocation, and the full corpus now has no increased count error. Mixed or conflicting populated grids remain outside this rule. [Native width evidence](../output/playwright/native-unknown-grid-20261011/REPORT.md).
- **Imported page dimensions:** partial section properties now use the imported Letter fallback for omitted dimensions, while fractional declared dimensions are parsed instead of silently using editor dimensions. The source audit found 28 documents with fractional page dimensions. The Letter behavior is supported by the retained explicit/omitted-size Word control; a fresh Word PDF also confirms the fractional A4 geometry. This does not establish all locale/template paper defaults. [Fractional source audit](../output/playwright/parity-20261013/fractional-manifest.json), [fresh native source receipt](../output/playwright/parity-20261013/fractional-source.json).
- **Literal XML text whitespace:** raw CR/LF inside text elements becomes whitespace; explicit break elements continue to create breaks. Original source XML is retained. A fresh native A4 reference showed that literal source newlines were incorrectly adding rendered lines. All 22 affected documents in the source audit were captured, and the complete corpus/local runs include the rebuilt WASM parser. [Affected sources](../output/playwright/parity-20261013/newline-manifest.json).
- **Wrapped images in table cells:** eligible paragraph/line-relative DrawingML anchors contribute to cell height and protected row-slice boundaries. The line planner uses wrapped line positions, and unsupported mixed-image slices use the existing clipped rendering path. The confirmed off-page text now appears visibly on page 2 with its image-bearing row, matching Word's page membership. The final build passes all eight native control page counts, with exactly one visible following-text marker and trailing marker per control. Legacy VML, anchors outside cell layout, exact-height rows, vertical text and merged cells retain their existing guarded behavior. [Control verification](../output/playwright/parity-20261013/control-verification.json), [current page 2](../output/playwright/parity-20261013/7a55d146.oct13-v5.page2.png), [native defect diagnosis](../output/playwright/native-overflow-row-20261011/REPORT.md).

The wrapped-image correction does not complete rotated/cropped-image fidelity: the native image clip and resulting row height still differ. In the oversized control, the viewer preserves following text on a continuation page, while Word's PDF clips it; that is not counted as exact native page membership. Pixel-clipped fragments can contain duplicate hidden DOM text, so the controls check actual visible ranges rather than raw DOM occurrence counts.

## Local coverage and validation

The final local run attempted all **392 unique inputs**, captured **386**, and reproduced the same **six pre-existing import failures**. The 47 usable source-bound Word references retain **43 matching page counts**, with no changed matching count or increased count error. Detailed import status is retained in the local comparison receipt. Native coverage is incomplete; unreferenced local documents are capture/regression checks, not established Word matches. [Local captures](../output/playwright/parity-20261013/verified-local.jsonl), [comparison](../output/playwright/parity-20261013/comparison.json).

Validation passed **762 TypeScript tests (one skipped)**, **134 Rust tests**, **46 Word-reference harness tests**, **three existing browser geometry tests**, workspace/Playground typechecks, rebuilt WASM, viewer/Playground production builds and `git diff --check`. Four timing failures in the first concurrent unit run all passed in the final full run with one worker. No unit tests were added; existing section-layout expectations were updated. Repository-wide rustfmt still reports existing formatting differences outside this patch's changed Rust lines; no bulk reformat was applied. [Validation receipt](../output/playwright/parity-20261013/validation.json), [final unit log](../output/playwright/parity-20261013/unit-tests-final.log), [Rust log](../output/playwright/parity-20261013/rust-tests-final.log), [browser log](../output/playwright/parity-20261013/browser-geometry-chrome.log).

## Remaining gaps

Full Word parity remains incomplete: **187 qualified corpus page counts still differ**. Open areas include CJK font metrics/line-grid behavior, complex or partially specified tables, blank-page placement, legacy VML, cropped/rotated drawings and broader native page-membership/visual coverage. Six large local inputs already failed import at the start of this pass. An instrumented Node/WASM import now identifies a single-string decoding limit during model transfer; that diagnostic does not independently establish the browser decoder's exact failure mechanism. Large-model transfer needs a separate bounded-memory fix and render qualification. [Large-model diagnostic](../output/playwright/parity-20261013/large-model-wasm-status.json).

Changes are local and uncommitted. The evaluation below is retained as historical evidence; its older metrics and held-candidate dispositions are superseded by this section where explicitly requalified.

## Historical evaluation — 2026-10-11

The follow-up **1,000-document rerun is complete**. **791/995 qualified Word page counts match (79.50%)**. Tight paragraph and heading highlights are implemented. Page-count and retained page-break results are unchanged from the preceding completed build, preserving its eight earlier count improvements. Full Word layout and page-break parity remains incomplete.

| Check | Completed result |
| --- | --- |
| Documents attempted / parsed / captured | 1,000 / 1000 / 1000 |
| Qualified native count pairs | 995 |
| Matching counts | 791 |
| More / fewer pages than Word | 122 / 82 |
| Summed absolute page-count error | 1012 pages |
| Qualified native page-text membership documents | 59 |
| Exact normalized page-text memberships | 20 |
| Matching native interior boundaries | 61/220 (197 uniquely anchored) |

The regression gate passed against all four saved checkpoints: **3559 source-paired comparisons**, with no lost matching count, increased count error, lost retained matching boundary, lost exact page membership, or decreased raw source-text credit. Equal counts do not establish equal page breaks or pixels.

| Checkpoint | Common count pairs | Matches before → after | Absolute page error before → after | Count regressions |
| --- | --- | --- | --- | --- |
| Preceding completed 1,000-document run | 995 | 791 → 791 | 1012 → 1012 | 0 |
| Earlier completed 1,000-document run | 994 | 783 → 791 | 1036 → 1011 | 0 |
| Rejected 999-document checkpoint | 994 | 790 → 791 | 1003 → 1002 | 0 |
| Stopped 560-document checkpoint | 558 | 460 → 460 | 299 → 297 | 0 |

[Completed comparison](../output/playwright/corpus-tight-blocks-1000-20261011/completed-comparison.json), [all durable results](../output/playwright/corpus-tight-blocks-1000-20261011/retained-1000-final.json), [regression gate](../output/playwright/corpus-tight-blocks-1000-20261011/regression-gate.json), and [remaining count mismatches](../output/playwright/corpus-tight-blocks-1000-20261011/open-count-mismatches.json) retain exact identities and denominators. Five unqualified native references are excluded from the match rate. This is the retained 1,000-document sample; the 736,706-document catalog has not been fully tested.

### Tight block geometry

Paragraphs and headings now follow visible text ranges, excluding unused container width, padding, and surrounding line spacing. Wrapped text retains separate pieces around figures. Geometry remains in unzoomed page CSS pixels and clips through layout containers and the physical page. Table, cell, figure, and formula frames retain their structural geometry; word source-range behavior is unchanged. Font rectangles are not per-pixel glyph outlines.

The preliminary 124-document audit covered 100 corpus documents, 18 local DOCX documents and six local DOC documents: 68,014 blocks across 1,283 pages, including 541 headings. It narrowed 35,563 paragraph boxes and preserved 28,028 structural boxes. Thirteen empty paragraph boxes disappeared; three nonempty text blocks were already clipped beyond a nested cell or the physical page. Their former container boxes did not demonstrate visible text. [Audit and qualification](../output/playwright/tight-blocks-breaks-20261011/sample-geometry-summary.json).

The final 1,000-document run audited **389,395 blocks**, including **5,750 headings**. It narrowed **214,535 paragraph blocks** and preserved **135,102 checked structural boxes**, with no invalid page rectangles or changed structural geometry detected. The raw audit also retains visibility-status changes, including header/footer parents that reference empty paragraphs. These diagnostics are not counted as lost text or universally qualified Word geometry. [Full geometry audit](../output/playwright/corpus-tight-blocks-1000-20261011/geometry-progress.json).

The **22 remaining text-bearing blocks classified as not visible** were inspected: their text rectangles are already outside a physical page or a clipping ancestor. This includes body text, drawing text and a footnote. The old full-width container rectangles obscured those layout gaps. Another 41 affected blocks contain only whitespace, and 1 consists solely of invisible formatting controls. These are observations of current browser clipping, not proof of native visibility for every case. [Clipping qualification](../output/playwright/corpus-tight-blocks-1000-20261011/visibility-qualification.json).

The frozen run also exposed **18 visible combining-dash paragraphs** with zero-width browser text ranges. Those are explicitly separated from clipping. A subsequent geometry-only correction measures the painted horizontal extent using the active font for isolated mark-only paragraphs, preserving page/ancestor clipping. A source audit of all 1,000 XML packages selected every document containing any Unicode mark: 23 documents across 305 viewer pages. The follow-up browser audit restored the 18 dash highlights and left all other checked block geometry unchanged, with identical DOM, page text/dimensions and page counts. Ordinary accented text, Arabic/Thai content and variation selectors are included in this validation. This follow-up changes only the geometry resolver; the 1,000-document pagination run uses the earlier frozen bundle listed below. [Source audit](../output/playwright/corpus-tight-blocks-1000-20261011/combining-mark-source-audit.json), [geometry audit](../output/playwright/corpus-tight-blocks-1000-20261011/combining-mark-geometry-audit.json) and [final source/build validation](../output/playwright/corpus-tight-blocks-1000-20261011/post-corpus-geometry-verification.json).

The Playground was exercised with all highlights, formatted blocks, figures and its third Words tab. The supplied document shows ten nonempty blocks, three figures and 92 unique highlighted words. The title highlight shrinks from **643.22 px to 242.02 px**. [Playground view](../output/playwright/tight-blocks-breaks-20261011/playground-all-highlights.png), [Words view](../output/playwright/tight-blocks-breaks-20261011/playground-words.png), and [interaction receipt](../output/playwright/tight-blocks-breaks-20261011/playground-verification.json).

### Supplied document versus Word

A fresh capture of the frozen build remains **one page**, matching the source-bound saved Word PDF. All ten blocks resolve, all three figure rectangles are unchanged, and all **four checked internal body line breaks match**. Title-width error is +0.250 px; the figure horizontal differences are approximately −1.3 px and vertical differences remain below 1.04 px. Viewer highlight geometry is improved; visual parity remains incomplete. [Native comparison](../output/playwright/corpus-tight-blocks-1000-20261011/priority-native-comparison.json).

### New native and REA investigation

Four remaining count mismatches share fixed tables with unspecified grid widths. Fresh Word PDFs and ten controlled table cases show that Word preserves specified column preferences and distributes remaining table width among unspecified columns. Eight guarded controls agree exactly. Current zero-width columns can cause one-character wrapping.

The private correction was **not promoted**: under the unchanged font profile, three documents improve but a fourth changes from six to three pages against Word's five, increasing its absolute error. It retains the same three of fourteen newly qualified native cuts. A private font-isolated experiment plus Letter page geometry matches three of four counts and five of fourteen cuts, but one matching count has an empty final page where Word has text.

Actual browser font inspection found Helvetica fallback for requested Segoe UI and Calibri Light. The private experiment uses Word-bundled Calibri Light and source-bound PDF Segoe UI subsets, with incomplete subset coverage explicitly retained. These fonts are not shipped or installed. The fourth document also exposes absent paragraph-default provenance: native line spacing and paragraph-after spacing differ even with the diagnostic fonts. Global spacing changes would contradict explicit table styles, so none were made.

REA/Ghidra inspected the installed Word-associated layout framework. Its table formatter consumes host callbacks and geometry, formats repeated headers, and reduces available height accordingly. This supports investigating Word-host width/default construction; it does not recover Word's entire pagination algorithm. The width rule is qualified by native controls, not inferred as original source from decompilation. [Detailed report, binary identities, REA evidence and held patch](../output/playwright/native-unknown-grid-20261011/REPORT.md).

A separate fresh native export confirms a visibility/page-membership defect despite equal five-page counts: Word moves an image-bearing table row and its text to page 2; both the previous and current frozen viewers put the text below page 1. The row slice planner excludes the floating image from line positions, then renders the full wrapped paragraph inside a smaller slice, expanding the fragment and leaving an empty continuation. Simply enabling the existing protected-boundary path is insufficient because that path also omits float exclusions. Rotation changes the native painted height as well. No partial correction was promoted; the report retains exact source/copy/PDF identities, old=current geometry evidence and the required contrasting controls. [Native row-split diagnosis](../output/playwright/native-overflow-row-20261011/REPORT.md).

Two further one-paragraph native excerpts isolate distinct Chinese-text gaps. In the source with 580 native pages versus 686 viewer pages, the checked paragraph takes 11 native lines versus 15 viewer lines while both advance approximately 31.2 pt. Word permits a Han-to-Han break and substitutes Microsoft YaHei; the viewer's `keep-all` rule and font provider remain separate inputs. The earlier broad normal-wrapping experiment lost a count match, so no blanket change was promoted.

In the source with 77 native pages versus 52 viewer pages, both excerpts produce six lines, but Word advances approximately 31.2 pt versus the viewer's 15.6 pt. The source declares a 15.6 pt line grid with no explicit doubled multiplier. Native PMingLiU/SimSun static font heights remain below one grid pitch, so substituting those heights alone does not explain the difference. Existing REA evidence points to charset-dependent metric construction before grid rounding; its actual runtime inputs remain unqualified. The isolated Chrome font probes resolved the requested Chinese faces to PingFang/Helvetica, but do not prove every glyph's provider in retained full-document captures. These excerpts preserve exact source text and old=current browser geometry. They do not establish full-document native cuts or justify a guessed multiplier. [Focused native CJK diagnosis and reused REA evidence](../output/playwright/native-cjk-counts-20261011/REPORT.md).

Earlier qualified shared-border, wrapped-figure, character spacing/scaling, empty merged-row and protected automatic-table-width fixes remain in the build. The repaired long-table and protected-width cases retain matching 35- and eight-page counts, but their fresh detailed row cuts remain incomplete. [Earlier native qualification](../output/playwright/minimum-border-regression-20261011/NATIVE-REPORT.md) and [protected width/row evidence](../output/playwright/followup-regression-20261011/protected-autofit-qualified/native-width-comparison.json).

### Parser and validation scope

Validation passes **760 TypeScript tests** (one skipped), **three browser geometry tests at 75%, 100% and 150% zoom**, **36 frozen geometry checks**, **46 Word-oracle harness tests**, workspace and Playground typechecks, and viewer/Playground builds. The follow-up geometry correction reran the typechecks, unit tests, viewer/Playground builds and expanded browser tests, adding isolated marks, invisible format/variation controls and self-clipping. The Rust/WASM parser is byte-identical to the preceding qualified build, which passed 129 Rust tests and matched Mammoth raw text in 17/17 retained upstream fixtures. Every corpus document was freshly parsed with that frozen native binary. [Frozen validation receipt](../output/playwright/tight-blocks-breaks-20261011/code-validation.json) and [follow-up validation](../output/playwright/corpus-tight-blocks-1000-20261011/post-corpus-geometry-verification.json).

The historical Mammoth corpus audit read all 1,000 with rust-docx versus 997 with Mammoth; 934 matched after whitespace normalization and 967 retained Mammoth's characters in order. Thirty reading-order cases retained exact paragraph occurrences. That comparison was not rerun here and does not prove complete Mammoth converter/API compatibility or universal DOC/DOCX support. [Mammoth coverage](mammoth-coverage.md) and [structured blocks](structured-blocks.md).

Across the current corpus, 16 documents have raw source-range credit gaps (419 UTF-16 units), 689 have unresolved mappings, and 127 have raw DOM outliers. These require individual qualification and are not interchangeable with lost visible text or painted overflow. The backend emits source-bound content; authoritative browser boxes require mounted layout. Every word box has not been compared with Word.

### Reproducibility and disk use

Fresh native control counts were 2, 3, 3, with scoped page text verified against saved physical references. Corpus comparisons use qualified source-bound saved native references; this run did not generate 1,000 fresh Word PDFs. Separate four-case, row-split and Chinese-text excerpt investigations did generate fresh PDFs. Browser imports isolate document fonts and verify source/profile hashes. The initial test-copy startup failure was corrected before the first document capture; its evidence is retained separately.

- Frozen corpus viewer bundle: `1bc9f5ea0adf589cfe4c7ac25eceb4c3ac252be3141383b4109d374270b223c2`.
- WASM: `ef88440993c08aa3bd55f5f1e3c7f910c3d853facd3867fd468daef740841677`.
- Native parser: `4439ad08638a7e0d54af1630a5b16a08a24e59ea8da7921478175c76a567990f`.
- Run contract: `3b3128f73bb11154d47a32b84917e0f8f6d04cac92e3d3dd28284f9ecfb51b85`.
- All 183 source-file hashes were verified at frozen-run completion. The later geometry-only correction and rebuilt distribution hashes are recorded separately; frozen runtime files and contract scripts remain intact.

The runner enforced an 8 GiB reserve before each batch and a 512 MiB evidence cap, deleting **323,766,926 logical bytes** of disposable batch products after durable writes and retaining 186,927,078 bytes of failure evidence. It stopped safely at 825 and 850 completed documents when system free space crossed the reserve, then resumed the same frozen contract with one browser worker and batches of 25.

Separate cleanup removed closed task-owned Vite/browser caches, unused Rust debug outputs, package download caches and inactive temporary distribution staging data. The latter had no open files, was older than six hours, and retained its original Xcode archives. Regenerable Xcode build intermediates were removed after verifying no active build or open files; source, products, index, simulator data and archives remain. Installed project dependencies were verified after package-cache removal. Transparent APFS compression reduced allocated storage for closed generated evidence, immutable REA reference data and dependency text/map files while preserving every checked SHA-256 and path. Active profiles, user documents, source and native references were preserved. Per-category receipts distinguish logical deletion from allocated storage; system free space also changes with other activity. [Cache/build cleanup](../output/playwright/corpus-tight-blocks-1000-20261011/rust-debug-cleanup.json), [package cache cleanup](../output/playwright/corpus-tight-blocks-1000-20261011/package-download-cache-cleanup.json), [temporary staging cleanup](../output/playwright/corpus-tight-blocks-1000-20261011/distribution-temp-cleanup.json), [Xcode intermediates](../output/playwright/corpus-tight-blocks-1000-20261011/xcode-intermediate-cleanup.json), [artifact compression](../output/playwright/corpus-tight-blocks-1000-20261011/artifact-compression.json), [additional compression](../output/playwright/corpus-tight-blocks-1000-20261011/additional-artifact-compression.json), [dependency compression](../output/playwright/corpus-tight-blocks-1000-20261011/dependency-text-compression.json) and [completion proof](../output/playwright/corpus-tight-blocks-1000-20261011/completion-verification.json).

Docker Desktop was briefly started to inspect reclaimable data and returned to its previous stopped state. It had no build cache and its images were container-referenced. Unused volumes were retained because they may contain databases; no Docker data was removed. [Docker inspection](../output/playwright/corpus-tight-blocks-1000-20261011/docker-cleanup-inspection.json). Earlier Docker/browser/cache cleanup remains historical and is not counted again.

Remaining work includes native font/default provenance, automatic and partially specified table widths, blank-page and row-split behavior, complex stories/drawings and broader native visual qualification. Full Word fidelity and all-catalog coverage are not claimed.
