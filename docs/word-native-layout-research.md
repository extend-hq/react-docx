# Word native layout investigation

The installed Mac version of Word exposes enough of its layout framework to
recover and validate individual pagination rules. This investigation reconstructed
integer arithmetic and line-fitting behavior, traced layout callbacks into Word's
executable, and subsequently exported C-like code with Ghidra. The decompiler
initially produced 130 selected Word function bodies and 5,070 layout-framework
function bodies after applying symbol-derived signature hints. This is reconstructed code,
not the original source, a complete independent engine, or evidence of end-to-end
parity with Word.

No original Microsoft source was recovered or copied into production. Later
focused exports and validated contracts remain separate from those initial
decompiler snapshots.

## Further exact-spacing and shaping investigation on 2026-10-09

A subsequent REA pass recovered the exact-spacing producer's whole-height
four-fifths branch in Word's main image. Original instructions at
`0x1002e3e64` through `0x1002e3e70` pass the converted line extent and the
integers 4 and 5 to the signed rounded multiply/divide helper. Neighboring
branches use different metrics, and the private guard fields have not been
mapped conclusively to document properties. Static recovery alone does not
justify applying the branch to every paragraph.

Clean Word controls across Times New Roman, Arial, and Calibri qualify the
four-fifths differential for positive exact spacing with default or baseline
alignment. Alignment and compatibility controls exclude other alignments and
`noExtraLineSpacing=true`; unsupported scripts, custom vertical metrics,
numbering, drawings, and legacy frames retain their existing path. The browser
changes baseline allocation without changing line bands, page flow, or source
offsets. Sliced and unsliced plans receive the same allocation.

The isolated production correction reduces untranslated baseline error across
36 exact-spaced control lines from 2.4648 pt mean absolute error to 0.9945 pt.
Thirty lines improve and six below-natural-height lines worsen because their
previous placement partially canceled the remaining origin offset. The
22-page reference still matches all 987 normalized body lines and their page
assignments. These figures belong to the retained baseline-only build; combined
verification is recorded in the [follow-up report](../output/playwright/rea-word-parity-20261009/REPORT.md).

A PDF primitive audit finds a 0.9506 pt offset in both axes of filled table
paths, separate from font glyphs. That observation accounts for most of the
baseline intercept in the controls, but does not identify whether Word's
content rectangle or upstream printing introduced it. Small-height controls
also retain presentation-rounding residuals. No universal origin offset or
300-DPI quantization rule is applied to production.

REA also traced the graphics framework's script shaping entry point through
its property-tag translation and CoreText glyph-run construction. The recovered
ligature selectors agree with the installed SDK. One contextual-alternate
selector uses an older numeric mapping, so its tag name is not sufficient
evidence of the current runtime path. Controlled Word output supplies the
behavioral qualification: absent or explicit `none` disables optional
ligatures; the four ligature groups follow their explicit flags; contextual
alternates are independent; and explicit `enableOpenTypeFeatures=false`
disables both while retaining the separately qualified kerning policy.

Import and export preserve all 16 ligature values, contextual alternates,
inheritance, explicit disabling, paragraph marks, and the compatibility switch.
Drawing and measurement share a canonical feature string, which is included
in prepared-text, width, line-count, paragraph, and table caches. Document
settings travel through explicit typography parameters. In the qualified
Chrome environment a connected hidden Canvas inherits the required CSS font
features; full feature-specific shaping in non-DOM hosts and other browsers
remains unqualified. Required shaping features are not disabled by the optional
feature policy. The final combined build matches native glyph counts in all 94
shaping controls and line counts in all 14 narrow controls. Repeated loads with
opposite compatibility flags retain the expected wrapping. Equal-metric source
runs shape together without merging the document's stored runs. Font-specific
advance and absolute position residuals remain recorded separately.

The PTLS table trace identifies host-provided row properties and subtraction
of private edge fields before cell formatting; it does not identify a universal
border constant. Clean Word controls qualify a narrower automatic-row rule.
Uniform half-point and one-point collapsed single borders around horizontal
text cells with zero vertical margins retain their logical border-center row
extent. The renderer compensates the difference from the browser's used stroke
width and preserves the resulting fractional measurements. Four headed/headless
and pixel-ratio profiles reproduce the result in the final bundle. The two
eight-row references improve from roughly 1.15-1.19 pt deficits to less than
0.25 pt absolute row-extent error, with all 168 measured text fragments within
their clipping bounds in every profile. Both the corpus reference and isolated
border controls printed cleanly. Outer table
flow, absolute origins, and richer continuations remain separate gaps.

The [instruction and row-height ledger](../output/playwright/rea-word-parity-20261009/native/findings.md)
and [shaping ledger](../output/playwright/rea-word-parity-20261009/native/shaping-findings.md)
retain the original artifact hashes, REA evidence identifiers, and closed
session snapshots. The current pass did not attach to or pause the running
Word process. Original documents and application binaries remain unchanged.

## Deeper REA metric investigation on 2026-10-09

The follow-up follows host metrics into `MicrosoftFontLibrary`,
`WLMGraphicsDevice`, and `mso30`. Word's host projects separate formatting and
presentation components between context scales and redistributes rounding
residuals. The inspected CoreText font factory preserves the requested double
size; its ordinary graphics provider rounds ascent, descent, and leading
independently. Original ARM instructions establish nearest rounding with ties
away from zero, correcting misleading truncation casts in the decompiled C.

An isolated probe against the original graphics library matches those recovered
metric rules in all 24 explicit font/size cases. It records the selected font
URLs and hashes, and demonstrates different leading for the bundled and system
Times New Roman faces. A higher metric adapter can substitute outline
typographic metrics and fold their leading into ascent. The selected face,
virtual dispatch, formatting scale, and baseline phase of a live Word document
remain unqualified; no universal font-size or baseline adjustment follows from
these results.

Separate Word-printed controls qualify the kerning policy: absence and zero
disable kerning; a positive half-point threshold enables it at and above the
threshold; style inheritance and a higher direct override take precedence as
expected. Import, export, Canvas measurement, pretext preparation and DOM paint
now carry the same effective policy. Measurement caches include that policy.
The small pretext extension is bundled into ESM/CJS output, with its license,
so downstream users receive the same behavior without needing a workspace patch.

All 987 body lines of the long reference now match Word's line wraps and page
assignments across 22 pages, at unchanged nominal font sizes. The first combined
build fixed six wrapping mismatch regions but left seven lines on different
pages. Six subsequent Word controls identified the remaining page-start spacing
policy: preserve before-spacing at document and new-page section starts;
suppress it after automatic overflow and paragraph page-break-before. The
qualified manual-break policy applies in compatibility mode 15 and later.
Measurement and rendering now consume the same page-start spacing decision.
The ordinary split-paragraph wrapper includes protective bleed in its declared
box height, eliminating the measured body-bottom overflow. Baseline and pixel
parity remain separate acceptance gates.

Additional Calibri controls corroborate the kerning threshold rule when document
defaults are explicitly supplied. Controls with no styles part expose a
different application-default profile and are retained separately. A narrow
table wrap disagreement then led to independent fractional cell-margin and
border-reservation corrections. Used border widths differ between browser
environments even at the same reported device pixel ratio, so qualified uniform
collapsed borders use measured CSS widths to account for half-border charges.
Mixed or hidden-edge conflicts are excluded from that compensation. The target
header now fits in headed and headless captures with and without common
ligatures. Common-ligature selection remains an observed shaping gap.

One-line and two-line controls isolate another remaining difference: for
explicitly defaulted Times New Roman 12 pt, a 6 pt increase in exact line extent
moves Word's baseline 4.8 pt, versus the browser's 3 pt. The print stream keeps
the same font size and transformation in all cases. Two focused formatter
delegates expose private input packing and dispatch, but do not establish the
baseline producer or a general 4/5 rule. No production baseline adjustment was
applied. Other fonts, mixed runs, document grids, and absolute baseline phase
still require qualification.

Fifteen native numbering controls qualify 87 labels. Instances sharing a raw
abstract definition continue its counters, while a start override is consumed
once for each instance and level. A later parent restart uses the default start
instead of consuming that override again. Separate raw abstract definitions
remain separate even when their style links resolve to the same backing levels.
The short reference's main labels now match Word's 1 through 5 sequence.

The [new native ledger](../output/playwright/rea-word-deep-20261009/native/README.md)
links the source/region hashes, REA Evidence IDs, original assembly, probe,
results, and closed session snapshots. Derived analysis images preserve original
function bytes and addresses, omit unrelated callees and data, and are never
executed. Their default AArch64 ABI does not establish Darwin stack arguments.
The ledger distinguishes valid ordinary branches from incomplete shim and
exception-tail decompilation.

## Earlier REA investigation on 2026-10-09

REA 6.2.0 is installed and connected to Codex. Its Ghidra provider uses the
verified official 12.1.4 distribution and a locally built arm64 decompiler.
Both installed Word binaries still match the target hashes below. Fresh REA
analysis of the arm64 layout-framework copy recovered focused pseudocode and
assembly. The main executable's full default analysis timed out after fifteen
minutes; focused extraction subsequently recovered the three host callbacks
described below.

A subsequent focused trace recovered actual host callbacks without repeating
full executable analysis. The direct `FsCreateContext` caller at `0x1000bb420`
copies the callback table at `0x103af28e8`. REA's `FsCreateContextCore`
decompilation establishes the table's copy into the runtime context, and the
Mach-O chained-pointer format resolves three corresponding host functions:

| Callback | Word address | Observed scope |
| --- | --- | --- |
| Suppressible bottom space | `0x102be8944` | Reads the first integer through the optional line-client pointer at `+0x38`; otherwise returns zero. |
| Allow space-after overhang | `0x102bed460` | Tests host and paragraph-context fields, permits one ordinary-line branch, and compares a converted extent on a special-line branch. |
| Format line | `0x102bed564` | Recovered body; its many private inputs and delegated helpers remain unresolved. |

Small derived analysis images preserve each function's original bytes and
virtual address. REA/Ghidra decompiles these successfully; source and region
hashes are retained in the
[extraction manifest](../output/playwright/rea-word-layout-20261009/word-layout-callbacks-manifest.json),
with separate
[host evidence](../output/playwright/rea-word-layout-20261009/rea-word-host-callback-evidence.json)
and
[framework evidence](../output/playwright/rea-word-layout-20261009/rea-word-fit-path.json).
These images omit surrounding callees and data. Their role labels are analyst
annotations, and the ELF container does not qualify Darwin stack-argument
inference. Register-based observations are checked against the original
Mach-O assembly. The recovered conditions therefore guide controlled Word
comparisons; they do not yet identify all OOXML policy inputs or justify a
universal overhang rule.

`FsCheckLineVerticalFit` at `0x2d3b4` combines maximum ascent and descent and
consults a suppressible-bottom-space callback when the extent does not fit.
`FscbkGetDvrSuppressibleBottomSpace` at `0x15ceb4` delegates to the host; its
private callback parameters remain unresolved. `FsSetTableSrvRowHeight` at
`0x14f558` passes the row total minus two inset fields into cell-height setters.
Those fields alone do not identify border contributions. Current REA records
are retained in the
[framework evidence bundle](../output/playwright/rea-word-layout-20261009/rea-framework-evidence.json).

Eight controlled documents were printed to PDF by the installed Word and
compared with the browser before and after the renderer changes. All eight
now agree on normalized text membership per page, compared with five before.
The controls distinguish paragraph text fit from trailing spacing, keep-next
with a splittable following paragraph, an internal explicit page break, and
minimum versus exact table-row heights. Row dimensions still differ slightly
because the browser and Word's print path quantize geometry differently.

The implementation carries trailing paragraph spacing into the next block's
flow budget without splitting text solely for that spacing; keeps headings
with the widow-safe opening fragment of ordinary following paragraphs; and
uses validated source positions for text-only internal page-break fragments.
Table declarations retain fractional CSS pixels, and uniform collapsed single
borders contribute to qualified minimum heights without inflating exact rows.
Mixed objects, note references, and stale source XML retain their prior break
handling; merged or directly overridden border configurations are excluded
from the minimum-border correction.

A further continuation check exposed a mismatch between whole-row DOM
measurement and the positioned line plan used after splitting. Compatible
paragraph rows now receive the planned height when they first need a slice,
and cuts use complete-line boundaries. The row total also follows every
fragment's vertical-alignment calculation. Declared exact rows, merges,
vertical text, and nested content retain their existing handling. A manual
break at the first character of the document still does not qualify creation
of an initial blank page.

The qualified slice renderer also preserves fractional viewport offsets and
counts visual ink bleed inside its planned flow box. A public-bundle stress
control retains all 560 normalized characters and 15 painted lines, with no
glyphs outside row windows or physical pages. Its three row boxes match the
planned 107.1328125, 107.1328125, and 15.3046875 CSS pixels. A following row
recovers 22 pixels previously charged twice as bleed; the existing one-pixel
visual bottom bleed remains. Cells with different line phases can move to a
fresh page when no shared complete-line boundary fits; Word's independent
per-cell continuation still requires a richer plan. See the
[continuation verification](../output/playwright/rea-word-layout-20261009/table-continuation-control.json).

These are bounded layout corrections. Matching font metrics, page origins,
complex floating objects, notes, and painting still require qualification.
The current
[comparison records](../output/playwright/rea-word-layout-20261009/controls-final-comparison.json)
and browser screenshots are local research artifacts, not package assets.

The same Word/browser comparison exposed two font-selection errors. An
inherited bidirectional language could select the wrong font for neutral
characters in Latin text, and numbering markers bypassed the text's script
font slots. Correcting these choices makes the short reference use Calibri
throughout. Its heading numeral measures 22.703 CSS pixels against Word's
22.728, and its final body baseline moves from 15.95 pixels below Word to
2.05 pixels above. Both outputs have 43 body lines, but six lines still have
different wrapping and two list labels differ.

Explicitly cleared tab stops now survive import, style inheritance and
serialization as clear markers. Rendering excludes those markers when
selecting active tab positions. This restores a single footer baseline in
the same reference, within 1.60 pixels vertically and 1.29 pixels horizontally
of the Word print output. The WASM parser is rebuilt with this model change.
The [qualified final capture](../output/playwright/rea-word-layout-20261009/visual-short-final-verification.json)
pins both JavaScript and WASM hashes and records the remaining differences.

A separate QA-only probe paints runs at the PDF-reported sizes: 11.04 rather
than 11 points, 22.08 rather than 22, and 9.12 rather than 9. This removes the
six wrapping differences in that reference. It is evidence that the print
profile matters, not a qualified rule for nominal DOCX font sizes. No global
font scaling was added. The active formatting, paint and presentation
conversions must be distinguished before implementing such a rule.

The verified public build renders 216 unchanged inputs over 1,815 pages with
zero render exceptions. The existing unit suite passes 568 tests with one
skipped, 99 Rust tests and nine Chrome checks pass, both TypeScript checks
pass, and the WASM and ESM/CJS/declaration builds succeed. The
[verification summary](../output/playwright/rea-word-layout-20261009/verification-summary.json)
pins source and bundle hashes. The acceptance target remains 1:1 visual
layout and page breaks; this stability sweep does not establish that parity.

## Reverification on 2026-10-07

The installed executable and framework still match the hashes below. Fresh
disassembly and a separate-process native probe verified `FsGetLineDvr`
(`0x2d318`) and `FsGetLineElementAscent` (`0x161128`) across **2,004 bounded
metric cases**. In particular, `(70, 10)` and `(40, 40)` produce a combined
height of 110, using maximum ascent plus maximum descent. A further **1,003
first-row cases** verified `FsTableSrvCalcClipHeightW` (`0x14cb34`) as total
height at offset `0x10` minus the fields at `0x18` and `0x20`, retaining negative
results. The row-height setter at `0x14f558` was inspected statically only.

These probes use synthetic records, not Word document callbacks. They do not
establish active story selection, font-provider behavior, conversion scales, or
complete private-structure definitions. Current assembly, the probe, and its
results are retained in
[`output/playwright/word-fidelity-20261007/native/`](../output/playwright/word-fidelity-20261007/native/).
The temporary thin binary copy was removed after analysis.

The corresponding earlier renderer pass fixes imported pagination oscillation,
explicit page dimensions, table run-formatting precedence, and separate Latin
and complex-script font sizes. It rendered all **212 sampled/local documents**
without an exception, but fresh Word comparisons still have pagination and
painting gaps. The
[earlier report](../output/playwright/word-fidelity-20261007/REPORT.md)
records the 18 Word PDFs, input variants, source and package hashes, actual
browser fonts, and remaining differences. Successful native arithmetic probes
are not used as evidence of document-level parity.

A subsequent TypeScript renderer pass corrected overlapping automatic text
lines, continued table flow, active header reserves, stale saved-count selection,
and read-only form rendering. Its **215-document / 1,815-page** sweep completed
without render exceptions; the reported table document remains three pages at
three zoom levels, and a long-table reference now matches Word's 32-page count.
Several layout and painting discrepancies remain. That pass performed no new
native probes or source recovery. See the
[subsequent renderer report](../output/playwright/word-overlap-20261007/REPORT.md)
for its separate source snapshot, 566 unit tests, nine Chrome tests, new samples,
and remaining visual failures.

All `tmp/word-*` references below describe earlier research. Those directories
are **absent from this checkout**; their decompiler output and older validation
results were not independently recaptured in this pass.

## Pinned target

- Word version: **16.106.1**, build **16.106.26021521**.
- Investigated architecture: **arm64**.
- Main executable SHA-256:
  `8cfdfa41db8d8b932b169d52004132da44c4a0bda0f47e6eea63f9c67707187f`.
- MicrosoftPTLS7 framework SHA-256:
  `c725cced2da1d7947c4e7ca5a2ab1c533f560d763de4d0e98201dc8cbdce84b5`.

Addresses below are unslid virtual addresses for these binaries. They are not
stable interfaces and must not be assumed valid after a Word update.

Earlier research recorded artifacts in the ignored `tmp/word-layout-research/`
directory: binary hashes, symbol inventories, selected disassembly, callback
addresses, and native probes. Its decompilation copies were recorded under
`tmp/word-decompiled/`. These historical directories are not present now. No
application binaries are included in the package or tracked by Git.
The application executable was inspected statically; native experiments
loaded its layout framework into a separate Python process. The binary analysis
does not require opening user documents.

## Decompiled code

The historical [decompiler output index](../tmp/word-decompiled/INDEX.md)
listed recovered page, line, table, and paragraph-breaking routines. Earlier
manifests recorded initial and signature-assisted exports with per-function
addresses, completion status, warnings, and executable hashes. Those artifacts
are unavailable in this checkout.

| Export | Function bodies | Generated lines | Scope |
| --- | ---: | ---: | --- |
| Word executable | 130 | 9,960 | All 123 entries in the recovered pagination callback table, plus selected direct callers and helpers. |
| MicrosoftPTLS7 | 5,070 | 314,209 | Functions identified by Ghidra after analysis and application of symbol-derived signature hints. |

The initial framework export contained 5,018 bodies; signature application
identified additional function bodies. These are two passes over the same binary,
not separate engines. Word callback names in these exports were assigned from the
traced callback roles or table offsets; they are not recovered original names.

The tool was Ghidra 12.1.4. Its official release archive was verified against the
published SHA-256, and its native decompiler was built locally for arm64. The
installed executable has no source-bearing DWARF debug information. Ghidra can
recover control flow and expressions, but cannot restore the original source
text, comments, local variable names, or full private type definitions.

Decompiler completion means that a C-like body was emitted, not that it compiles
or preserves every behavior. The signature-assisted framework export contains
warnings in 2,943 functions, including unresolved calling-convention warnings.
Private structures, indirect calls, platform intrinsics, and some return types
remain unresolved. Even warning-free bodies require verification before use.

One decompiler-reconstructed Word body was compiled unchanged in a local C build: the multiply/divide
routine at `0x1000bb630`. Only primitive typedefs were added. Compiled with Apple
Clang for arm64 using `-O0 -fwrapv`, it matched the installed framework's
`FsLwMultDivR` on **12,744** boundary and deterministic random cases. The source,
local build, and result are recorded in `tmp/word-decompiled/`. This validates
that arithmetic routine under the stated build conditions; it does not establish
browser portability or validate the remaining recovered routines.

## The path from Word to pagination

Word imports page-formatting and line-formatting functions from MicrosoftPTLS7.
The framework retains thousands of function symbols, including
`FsCreatePageFinite`, `FsFormatPageBody`, `FsFillTrackMainFlow`,
`FsFormatTextSimple`, `FsFormatTableSrvFiniteCore`, `LsCreateLine`, and
`LsGetLineBreaks`.

Static branch analysis found calls to `FsCreatePageFinite` at Word addresses
`0x1002a0910` and `0x1002a0a14`. Word calls `FsCreateContext` at `0x1000bb588`.
The context initializer copies a callback table from `0x103af28e8`, and the
framework copies it into its context. This establishes a concrete connection
between Word's executable and the framework's layout interfaces.

The framework calls back into Word for document properties and decisions such as
suppression of keep-together behavior and bottom spacing. Table layout, footnotes,
floating-object geometry, and paragraph-breaking penalties have separate native
routines. Their presence identifies further investigation targets; symbols alone
do not establish which branch runs for a particular document.

## Recovered generic-story line-fit behavior

On the generic-story path, `PTLS7::FsCheckLineVerticalFit`, at framework address `0x2d3b4`, aggregates two
signed integer metrics across the elements of a line:

```text
A = maximum element metric A
B = maximum element metric B
H = A + B
```

An empty line has height zero. The metric fields are at offsets `0x18` and
`0x1c` in each element's dimension record. `FsGetLineDvr` independently uses
the same aggregation.

For ordinary bounded, nonnegative metrics, the fit decision is:

```text
reportedSuppression = 0
if H <= available:
    fits = true
else:
    ask Word for each element's suppressible bottom spacing s[i]
    S = max(B[i]) - max(B[i] - s[i])
    fits = H <= secondaryLimit and H - S <= available
    if not fits:
        reportedSuppression = S
```

Callback errors propagate. Later recovery traced the generic-story limits through
`FsGetEmptySpacesCore`, `FsAssignLrG`, `FsGetLineNormal`, and lower-story placement.
On the controlled identity-direction branch with one interval and no obstacles,
the first limit is the current text rectangle bottom minus the line top, while
the second is the enclosing geometry bottom minus the line top. Bottomless
geometry substitutes a large sentinel for the enclosing bottom. The second limit
is therefore an enclosing-space constraint, not a font-height ceiling.

A hash-pinned native geometry probe verified **3,003 cases**, including distinct
finite bottoms and bottomless geometry. Obstacle branches, direction transforms,
and the mapping from effective DOCX regions to these native rectangles remain
incomplete. The line-fit helper does not itself rewrite metrics when suppression
permits a fit. Evidence: upstream metric and geometry report (local investigation artifact).

Controlled native calls demonstrate several consequential details:

| Element metrics `(A, B, suppressible)` | Available | Second limit | Height | Fits |
| --- | ---: | ---: | ---: | --- |
| `(70, 10, 0)`, `(40, 40, 0)` | 100 | 100 | 110 | No |
| `(70, 30, 10)` | 95 | 100 | 100 | Yes |
| `(70, 30, 10)` | 95 | 95 | 100 | No |
| `(70, 30, 4)` | 95 | 100 | 100 | No |

These numbers are native layout units, not measurements in CSS pixels. In the
first row, `max(A + B)` would incorrectly produce 80 instead of 110.

The framework's named `FsGetLineElementAscent` independently reads the first
metric field, strengthening its ascent interpretation. Word's producer also
separates total advance, the second metric, before/after components, and
suppression records. Full baseline and spacing conventions still require care.
The related public Microsoft PTS interface describes separate line ascent/descent
and suppressible spacing. Its managed structures are not the Mac Word ABI and
cannot be substituted for the recovered layouts.
[Microsoft PTS interop source](https://raw.githubusercontent.com/dotnet/wpf/main/src/Microsoft.DotNet.Wpf/src/PresentationFramework/MS/Internal/PtsHost/Pts.cs).

## Conditional Word-story fitting

The story-dispatch audit (local investigation artifact)
distinguishes the generic fitter above from Word's simple and chained fitters.
Compatibility version, document policy and view gates select the branch;
compatibility version 15 can use the generic branch. The generic algorithm is
therefore not a universal description of Word pagination.

In the tested obstacle-free Word branch, both available-height fields equal the
remaining text height. A separate native probe passed 1,003 geometry cases.
The simple fitter accepts `H - S <= remaining`; when full `H` exceeds the
remaining height, a callback selects either retained overhang or a trimmed
descent. The chain fitter uses separate body and after-spacing fields. Its
after-spacing input must not be replaced with the generic suppression formula.
The native zero-height boundary is also outside the browser adapter's current
positive-height contract.

The border-producer follow-up (local investigation artifact)
traces the ordinary suppression record through the bottom paragraph border and
its formatting-domain contribution. Its signed truncating conversion passed
5,008 isolated native cases; it differs from the rounded conversion used at
other boundaries. Effective spacing, selected profile and private boundary or
whole-line gates remain unresolved. No guessed border suppression or outer-page
limit was added to production.

## Recovered upstream metric contracts

Static recovery now traces Word's height producer at `0x1002e3000`, metric
projection at `0x1002e41b4`, and metric outputs at `0x1002e4a58`.

The ordinary height producer distinguishes natural line metrics from paragraph
spacing policy. A negative signed paragraph spacing value selects a fixed-height
branch: its magnitude is converted with the formatting scale and denominator
1440, then becomes the requested line advance. The branch does not enlarge that
advance to the maximum natural ascent plus descent of mixed-size runs. Other
line types, grids, compatibility conditions, paragraph alignment, and
before/after components take additional paths. The legacy signed paragraph
spacing representation corroborates the structure, but the complete modern
OOXML-to-host property loader remains unresolved.

The controlled Word print capture independently shows four mixed-size rows with
13.2-point baseline advances despite 24-point glyphs; their ink overlaps adjacent
exact rows. That observation supports keeping fixed advance and paint ink extent
separate. It does not establish a universal baseline fraction or clipping rule.

The projection routine distinguishes formatting and presentation domains. It can
copy values when the contexts coincide, or project the chosen total and component
values separately and reconcile rounding residuals. Host initialization also
selects different scales by mode. The captured print paint profile is now
qualified separately below; complete active formatting-context and baseline
mapping remain unresolved. Neither a global twip unit nor a universal pixel grid
follows from these routines.

Word's output callbacks distinguish fit metrics, advance excluding before/after
components, and suppressible spacing. The bottom-spacing record returned by the
previously recovered callback now has an upstream producer, including special
state and mode conditions. Those conditions have not been mapped into complete
browser/document rules. The browser's positive-height, zero-suppression/equal-limit
comparison remains valid within that bounded scope. Selecting another fit policy
requires the active native story branch and its effective inputs.

Further glyph-position recovery identifies another signed multiply/divide helper
that truncates toward zero instead of applying half-denominator rounding.
Arithmetic must be selected at its verified conversion boundary; the earlier
rounding helper should not replace every conversion globally.

The frozen print PDFs independently establish a **300-unit-per-inch paint
profile**: the point transform is 0.24, with paint font matrices of 46 for nominal
11pt and 100 for nominal 24pt. Static graphics-framework recovery supplies a
matching file/preview/process-PDF resolution policy. Physical-printer and screen
contexts use distinct policies. This does not identify one global Word layout
scale, and it does not justify measuring nominal 11pt glyph advances at 11.04pt.
Paint size, formatting advances, and presentation projection remain distinct.

Private CoreText probes of the examined font files and frozen embedded subsets
also verify separately rounded ascent, descent, and leading on the ordinary
provider path. A 100-unit font gives components 91/21/3, totaling 115 print units
or 27.6pt, while the browser-size probe gives a 37-unit total. Compatibility flags,
typographic-metric selection, native baseline origin, and paragraph-alignment
defaults still need qualification before these records can replace general
browser line-metric inputs. The controlled mixed-source marks explicitly use
11pt formatting; mark participation remains a separate qualification target.

The later print profile contract (local investigation artifact)
traces a successful normal print selector to 294912 formatting units/inch and
device presentation units; the separate print-file policy gives 300 presentation
units/inch. Request/device gates can fall back, and loaded compatibility/provider
state remains unobserved. Print uses rounded cumulative endpoint differences and
a separate second-component adjustment. The 240/264-twip captures cannot
distinguish competing profiles. No universal Word baseline rule or independently
executed native baseline vectors were added from this follow-up.

The later presentation and record-origin audit (local investigation artifact)
qualifies this further: the conventional page route establishes presentation
availability through a temporary provider, replaces the initial print device,
and selects presentation units from prepared cached geometry. That preparation
can reset or explicitly replace the cached axes. Initial print-device creation
therefore does not prove that the eventual selector uses 300 units/inch. The
implementable conditional contract is precision formatting at 294912 units/inch
with independently qualified stored presentation axes and origins. The incoming
text rectangle and paragraph details still need their upstream margin and
first-line producers before the browser can choose the same baseline phase.

The embedded-font comparison (local investigation artifact)
also narrows the paint-face uncertainty: all 71 encoded Arial glyph instances
(43 unique characters) match the examined bundled Arial 6.80i subset data and
metrics. Retained Calibri subset tables match version 6.20. System Arial shares
the examined unhinted outlines and advances but has different hinting data.
This identifies the observed PDF paint data among the inspected candidates;
the formatting provider, unobserved fallback and original filesystem path remain
separate questions.

The later browser face audit (local investigation artifact)
reports platform ArialMT for all 84 examined text leaves across the three
controlled documents. Chrome's exposed font data matches all 24 SFNT table
contents of the inspected system Arial 5.01.2x candidate. Four controlled font
arms, including the bundled 6.80i face, produce identical browser struts,
advances and isolated text ranges at 10, 11 and 24pt. Eighteen fixed-origin
Canvas raster comparisons also match. This rules out swapping those faces as a
correction for the measured browser baseline residual in this profile. It does
not equate browser row placement or rasterization with Word's PDF output.

The subsequent plan-to-paint trace (local investigation artifact)
joins all 84 text leaves to their planned rows and restored DOM baselines.
The largest planned-versus-painted difference is 0.008334 CSS pixels, while the
Word residual remains approximately 0.56pt for the uniform case and 0.99–2.15pt
across the table case. This places the remaining discrepancy upstream of the
qualified fragment paint subtraction; it does not establish a universal baseline
correction. The trace records its source and WASM observation epochs separately.

The real-document font audit (local investigation artifact)
finds a different problem in the wider corpus: sampled Calibri regular and bold
text actually uses Helvetica and Helvetica-Bold. Those documents contain no
embedded Calibri resource. Embedded Ubuntu faces, by contrast, are loaded and
used correctly. The audit covers 248 connected representative text parents on
16 leading pages, selected from 966 enumerated parents. These are sampled
browser font observations, not a complete glyph census or proof of Word's
selected fonts. No fonts were installed or added to the package.

A later provider trace distinguishes precision formatting from the paint provider.
It obtains the selected font's design em before normalizing ascent, descent and
leading to nominal size. Direct calls to the installed provider returned
2048/1854/434/67 for design em/ascent/descent/line gap for two explicitly selected
Arial files. The corresponding 24pt prediction reaches the observed 27.6pt
minimum advance only under the stated scale, leading and projection conditions;
the actual captured Word face and request flags remain unobserved.

The same follow-up identifies the fresh ordinary OPC import branch as initially
selecting compatibility version 12 when the package-format flag is clear. An
explicit compatibility setting can then replace it. This is a qualified static
branch, not a universal default inferred from a missing settings part or an
observation of the captured process. No new global font scale or compatibility
default was added. See the provider and import contract (local investigation artifact).

Supporting reports: upstream metrics (local investigation artifact),
font-record/print-profile qualification (local investigation artifact),
conditional formatting/presentation profile (local investigation artifact),
paragraph properties (local investigation artifact),
and glyph advance investigation (local investigation artifact).
These are static Word-side reconstructions checked against assembly, except for
the separately identified native geometry calls and controlled PDF observations.
No decompiler body is used as an unverified browser replacement.

## Section origins and the print baseline

The section-origin trace (local investigation artifact)
follows raw section bounds through formatting-domain projection, body-shaft
geometry, the first section cursor, and stored column/paragraph positions.
One thousand bounded calls to named framework query functions validate the
stored-coordinate contract. This ordering supports retaining fractional source
page geometry; it does not support rounding every margin to whole CSS pixels.
Effective overrides and later paragraph placement remain separate inputs.

The baseline-field trace (local investigation artifact)
also resolves a representation-dependent field: cached text details expose a
relative rectangle top where live/simple details expose an object count or
presence flag. The cached coordinate is not a font ascent. On the recovered
ordinary print path, Word projects the cumulative formatting endpoint and then
subtracts the line's presentation baseline component. A secondary, guarded
display-line path reconciles its own component separately.

That investigation passed 1,007 native query cases and 6,014 isolated native
point-arithmetic cases. Conditional inputs reproduce the controlled 46.56pt
baseline, but the historical capture's effective profile, alignment flags and
origin phase are unobserved. No fixed baseline shift or global native unit scale
was added to the viewer. The installed debug/source inventory still contains no
original source or source-bearing DWARF information.

The subsequent paragraph-position trace (local investigation artifact)
closes the additional position term for a successful fresh finite page on the
qualified initializer branch: its first paragraph has zero track progress and
zero framework leading offset before any restart or repositioning. Five thousand
native leaf checks validate the margin guard and stored-position contract.
This excludes an invented first-paragraph font offset on that branch; cached
reuse, relative line origins and the historical capture's effective state remain
separate.

## Recovered arithmetic

`PTLS7::FsLwMultDivR`, at framework address `0xfc4f4`, performs a signed
multiply/divide with integer rounding and overflow handling. Its behavior was
reconstructed as follows for signed 32-bit inputs:

```text
if denominator == 0: return INT_MAX
if a == 0 or b == denominator: return a

adjustment = truncate_toward_zero(denominator / 2)
if signed32(a XOR b XOR denominator) < 0:
    adjustment = -adjustment

numerator = int64(a) * b + adjustment
quotient = truncate_toward_zero(numerator / denominator)
if numerator fits int32:
    return wrap_to_int32(quotient)
return clamp_to_int32(quotient)
```

For non-overflowing half ties this rounds away from zero: `1 * 1 / 2` returns
1, and `-1 * 1 / 2` returns -1. JavaScript's `Math.round` differs on negative
half ties. The narrow integer division path also preserves ARM's overflow result:
`INT_MIN * 1 / -1` returns `INT_MIN`.

This identifies the behavior of one helper. It does not prove that every Word
measurement uses it, or establish the unit scale passed to each layout API.

## Word's own callbacks

The static callback pointers use Mach-O chained pointer format 6
(`DYLD_CHAINED_PTR_64_OFFSET`). Decoding the image-relative targets produces
addresses that match the executable's function-start table.

| Callback | Context offset | Word function address | Recovered behavior |
| --- | --- | --- | --- |
| Paragraph properties | `0xd0` | `0x1002b1c58` | Located and disassembled; full property mapping remains unresolved. |
| Text properties | `0x1d8` | `0x1002b3940` | Located and disassembled; several document-state branches control output flags and counts. |
| Suppressible bottom spacing | `0x270` | `0x102be8944` | Reads a pointer at line-client offset `0x38`; returns its first integer, or zero if null. |
| Suppress keep-together at page top | `0x358` | `0x102bed440` | Returns whether a document-associated control word has neither bit in mask `0x4800` set. |
| Widow/orphan handling during footnote resolution | `0x3f8` | `0x102bf0cf8` | Resolves paragraph state and returns a byte at property offset `0x65`. |

The keep-together callback reads its control word through
`*(nameClient + 0x10) + 0x140`. The meanings of those two bits remain unknown;
they should not be assigned OOXML setting names without further evidence.

The text-property callback also consults property byte `0x65` and, under
additional conditions, sets the two integers at output offsets `0x8` and `0xc`
to 2. This is strong evidence for two-line widow/orphan thresholds on that path,
but the complete enabling conditions and property mapping have not been decoded.
These Word callback findings are static reconstructions, not native calls with
live Word document state.

## Validation and reproducibility

The Python probe calls the installed framework through `ctypes` and compares it
with independently reconstructed arithmetic and line-fit functions. The line
experiments use synthetic structures and a controlled bottom-spacing callback.
The program checks the framework hash before executing any private ABI calls.

Results in `tmp/word-layout-research/native-probe-results.json`:

- **12,744** multiply/divide cases passed, including boundary values and
  deterministic random signed 32-bit inputs.
- **3,005** line-fit cases passed, including empty lines, mixed metrics, spacing
  suppression, and distinct limits. Each case also checks the native line-height
  helper. Random line metrics were nonnegative and bounded, with suppression
  between zero and the corresponding second metric.
- Total: **15,749 cases**. These are function-level experiments, not document
  rendering comparisons or evidence of complete pagination parity.

The local programs can be rerun from the repository root on the pinned arm64 Mac:

```sh
python3 tmp/word-layout-research/probe_native.py
python3 tmp/word-layout-research/extract_callbacks.py
```

The second program verifies the Word executable hash, decodes its callback table,
and uses LLDB in static target mode to save callback disassembly. It does not
launch or attach to Word. `trace_imports.py` supplies the Mach-O section and
function-start parsing used by this analysis.

## Implemented browser integration

`packages/layout-engine/src/line-metrics.ts` provides the portable signed
multiply/divide helper, independent ascent/descent aggregation, vertical-fit
decision, and shared minimum-line split constraint. Its arithmetic uses `BigInt`
intermediates for signed 32-bit edge behavior. These helpers are connected to the
active `DocxEditorViewer` path rather than only the legacy viewer.

Implemented scope:

- Signed integer twip conversion uses the recovered rounding helper at selected
  boundaries. Pretext retains fractional widths, fonts, and geometry.
- Pretext rows carry ascent, descent, and height. Mixed-font rows and atomic
  inline items contribute their metrics; positioned fragments use a shared
  browser-derived baseline. Page slicing, selection, and hit testing consume row
  geometry. Taller rows can recalculate floating-obstacle intervals.
- Character spacing participates in preparation, cache keys, fitting, and caret
  advances. Atomic items retain their physical width. Styled-run leading words
  can move after a breakable space when they do not fit the current row.
- The requested font size and a corresponding effective-size probe now detect
  an observed desktop Chromium advance-precision loss. The adapter corrects
  measured advances without changing the requested nominal font or treating the
  Word PDF's apparent font matrix as a universal layout size. Its probe and font
  revision cache qualify when that correction applies.
- Exact paragraph spacing keeps the declared advance separately from larger
  glyph metrics. The ordinary rich-text body path paints the same fixed rows;
  four mixed-size **17.6-pixel** rows were observed in Chrome for the controlled
  13.2-point case. Word baseline partition and full ink painting remain separate
  qualification targets. Minimum-spacing mixed rows now use per-run DOM natural
  metrics: two 36.6667px rows at the current physical DPR 1.5 against Word's 36.8px
  advance. The earlier 37px/74px probe is historical and lacks full profile/source/
  WASM provenance. No guessed native metric or global baseline offset is applied.
- Browser planning and positioned paint now share actual DOM struts. Fragment
  baselines account for viewer/ancestor CSS zoom; font, DPR and viewport-scale
  changes invalidate metrics. Eight measured paint-zoom combinations preserve
  logical rows and the qualified browser baseline. Word baseline equality is a
  separate gate. See strut qualification (local investigation artifact).
- Page and column splits share the minimum-line constraint. Two lines are
  required on each side when model widow/orphan control is enabled; forced
  progress for content that cannot fit an empty page remains. Page capacity now
  uses layout advance rather than charging interior split ink-clip bleed as
  extra flow space on the controlled ordinary-text path.
- Document default tab intervals reach body, nested tables, global/per-section
  headers and footers, notes, numbering, measurement, and cache signatures through
  immutable model-scoped views. Default 720-twip models reuse existing identities.
  Explicit and fractional positions are retained; ordinary embedded tabs become
  explicit spacers in static and interactive spans. Prefix widths use corrected
  canvas measurement rather than character-width estimates; the controlled
  1440-twip browser source places following runs at 96px and 192px. This is a
  source/browser grid check, not a Word differential tab reference. Fixed
  checkbox-gap policy remains distinct.
- Wrapped editing skips redundant session updates and native selection writes.
  The focused textarea owns its selection rather than competing with global DOM
  range synchronization; keyboard navigation updates that textarea synchronously.
  Equal reducer cursor/style values retain identity, and an unchanged public
  controller retains identity. These changes address the delayed effect/reducer
  update cycle observed during editing. A fresh Chrome run verified rapid
  navigation/insertion with agreeing logical/native carets, delayed settlement
  without repeated-update errors, literal tabs through undo/redo, and synthetic
  composition preedit/commit. Read-only native text selection works. OS-native
  IME and full cold/incremental/export parity remain qualification targets.
  Separately, 24 live caret/active-and-inactive double-click scenarios pass on the
  controlled three-word/tab source at viewer 50/100/200% and external CSS zoom
  1/1.25 in Chrome/DPR 1. Multiline zoom was not qualified. Evidence:
  zoom selection (local investigation artifact).
- Explicit compatibility mode, document tabs, and even/odd headers survive Rust
  import and export. Imported-settings provenance allows a deliberate cleared
  value to remove its corresponding source setting, while an unspecified caller
  value does not silently erase retained XML. Preservation of mode/settings is
  not implementation of all their layout behavior. The rebuilt bundled WASM
  initially passed five direct settings checks; the final packaged viewer/WASM
  verification below supersedes that snapshot with 16 settings/mark checks.
- Paragraph nodes retain effective and imported-baseline paragraph mark styles
  plus a direct `rPr` snapshot. Cloning, duplicate/copy/paste, clipboard round
  trips, and existing paragraph-style template inheritance propagate these
  fields; nested run-border values are cloned independently. The raw snapshot
  contains mark properties only, avoiding new `sectPr` ownership or duplication.
  Ordinary text edits retain the provenance when invalidating paragraph XML.
  The initial implementation provided semantic preservation. The later empty-mark
  and ending-ownership integration is described below. A temporary API probe verifies
  clone/clipboard isolation (local investigation artifact);
  the final packaged viewer/WASM verification (local investigation artifact)
  also checks current-versus-historical formatting, source-preserving text edits
  and regeneration, clearing, and complex-script size fallback.
- Table exact/minimum/auto row restrictions, a 31,680-twip declared-height bound,
  inherited per-edge cell margins, and complete exact-span content clipping share
  a bounded geometry contract in `table-geometry.ts`. Inline border-box cell
  sizing removes a demonstrated host-CSS dependency in the controlled Chrome
  geometry. Native width solving,
  border/default residuals, merged continuation, and full cell break state remain
  unresolved. A generic native height allocator was tested but deliberately not
  shipped because its enabling Word path was not established.
- Table/cell dxa/pct/auto/nil widths, table alignment and bidi placement are now
  represented and resolved in the active renderer. Imported direct/inherited
  provenance reconciles legacy width edits, tagged edits and clears; export
  removes direct overrides while active resolution restores inheritance.
  Direct property-owner lookup isolates current width/alignment/bidi from history
  and nested properties. Source-XML height keys include current content/percentage
  reference. Header/footer inline tables use the text region even with a page-wide
  drawing host. The later fixed-grid integration removes selected width rounding;
  native autofit, nested percentage behavior and broader RTL ordering remain open.
  See input/export contract (local investigation artifact)
  and active width/placement scope (local investigation artifact).

The browser page-fit adapter supplies zero suppressible spacing and equal limits.
That positive-height comparison is valid in both recovered story paths. Distinct
text-space/enclosing limits belong to the generic-story branch; the obstacle-free
Word-story branch uses equal text-space limits. Neither branch establishes the
browser's effective metrics, suppression inputs or consumed-height policy.

## Additional line, table and editing integration

The model now preserves vertical character `textAlignment` separately from
horizontal justification. Direct, paragraph-style, table-style and document-default
ownership is retained, including a direct value equal to its inherited value.
Paragraph style and heading changes update inheritance without discarding a
direct override. Six optional line-spacing compatibility switches also round-trip;
preserving them does not yet implement their native font/spacing behavior.
Named table style associations survive structural regeneration. The serializer
resolves the retained table style and conditional cell context once per table
before deciding whether paragraph alignment requires a direct property.

Empty paragraphs use their effective mark formatting as a zero-width metric
input. The shared result supplies body and cell height, host styling and the
empty editable caret without inserting a character. Header/footer filters retain
represented empty marks, including inherited defaults. Reserve calculations
now match the rendered grid gaps: zero for headers and eight pixels for footers.
Nonempty paragraphs continue to exclude a larger ending mark from ordinary line
metrics. Native framework probes separately verified this fallback on the
ordinary Word paragraph-ending path; other provider and revision paths remain
outside that claim. Trailing empty lines within nonempty paragraphs remain a
separate qualification target. Imported mark layers retain default, character-style
and direct ownership so empty paragraph style changes can recompute inherited
metrics without discarding explicit formatting or promoting inheritance into
direct XML. See the empty-line browser record (local investigation artifact),
header reserve correction (local investigation artifact),
and native paragraph contract (local investigation artifact).

Splitting a paragraph now gives the new ending fresh ownership and leaves the
original ending on the trailing paragraph. Actual paragraph merges retain the
surviving trailing ending. Whole-paragraph copies preserve revision metadata;
new template paragraphs inherit effective formatting without copying the old
ending's raw revision identity or equality baseline.

Fixed tables retain fractional source widths through the ordered grid solver,
cell spans, placement and line-width cache keys. Row omissions and their preferred
widths are represented, while out-of-range omission counts are ignored by layout
without changing raw imported values. Explicit fixed widths can overflow a
containing region. Horizontal table-float distances remain fractional too.
Column editing and rectangular selection now use physical grid positions while
keeping public addresses in actual cell indices. Table selection gives the
editable viewer keyboard focus so Delete reaches its selection handler.
The first-row constraint order
is a standards-derived interpretation awaiting a Word reference; autofit and
complete merge/continuation behavior are still open. See the fixed-grid record (local investigation artifact)
and input/export contract (local investigation artifact).

### Whole paragraph paint and editing

Eligible whole plain body paragraphs and direct table-cell paragraphs now reuse
their decided Pretext lines in read-only and editable views. The initial scope
requires uniform resolved fonts and left/default alignment; links, fields,
annotations, complex-script contexts, numbering, custom tabs/spacing, borders,
indents and nested cell content keep their existing paths. The change preserves
nominal advances and existing native glyph painting; it adds no global font scale
or Word baseline offset.

Cell-layout caches are bounded and include exact text, formatting, geometry,
document tabs/grid/compatibility context, numbering and font-metric revision.
Unchanged-content clones reuse plans while binding them to the current paragraph
objects. Composition derives temporary cell geometry without committing preedit
text. Direct-cell paragraph splitting retains the correct ending metadata and
keeps unstyled cells free of body spacing defaults.
Page-thumbnail content keys also include font-metric revision, invalidating
cached snapshots and surfaces when fonts change with identical text and page
membership. This corrects stale previews while their independent painting path
remains separate from the shared paragraph plan.

The shared input route preserves source offsets for selection, paste, synthetic
composition, paragraph splits/merges, history and cell navigation. Eligible
single-paragraph copying emits exact plain text and style-preserving HTML; Cut
uses the model transaction path. Read-only body clicks preserve native selection.
External toolbar pointerdown reads the focused textarea's actual range before
falling back to native DOM selection, so formatting targets the selected text.
Entering planned text clears previous rectangular cell and object selections,
so subsequent deletion follows the text caret instead of the earlier selection.
Secondary clicks inside planned text preserve the input's selected range for
text context-menu commands; clicks outside it place the caret using planned
geometry. Cut refreshes the input and model together, and undo restores the range.
These context-menu commands retain their existing plain-text clipboard behavior.
Existing smoke checks cover deletion/caret collapse and fresh toolbar selections
through a planned-to-native rendering transition.

The v5 typography controls (local investigation artifact)
record 45 functional assertions. Their read-only copy cases installed DOM ranges;
actual dragging is qualified separately by the v6 matrix below. Neither synthetic
composition nor these bounded editing controls establish OS-native IME or general
Word editing parity. Header/footer/nested adapters, complete region layout and
standalone/direct thumbnail painting remain separate paths.

## Controlled Word references and observed agreement

The v6 report (local investigation artifact)
and summary (local investigation artifact)
bind three frozen Mac Word print PDF references/four pages to the recorded v6 source
epoch. Page count, dimensions, input integrity and measured renderer metadata pass;
exact pixels fail on all four pages. All 39 controlled ordinary/mixed line texts
match. Every v6 PNG and pixel metric is identical to v5/v4. No general Word fidelity
score follows from this finite comparison.

| Controlled case | Word observation | Recorded v6 physical-DPR-1.5 browser observation | Open qualification |
| --- | --- | --- | --- |
| Ordinary text | 30 lines, 21 then 9; first baseline 46.56pt. | Same line/page texts; first baselines 46.000008/46.000031pt. Uniform baseline errors range from −0.566250 to −0.559969pt. | Baseline target, repeatability, selected fonts, edited bytes and pixels. |
| Exact/minimum mixed sizes | Exact advances 13.2pt; minimum advances 27.6pt. | Four 17.6px exact rows; small/large runs share their actual baseline. Mixed errors are −1.510592 to −1.763085pt. Minimum advance is 27.499992pt; large fragments are 36.6667px and the paragraph is 73.3333px. | Native baseline partition/origin and the minimum-metric residual. |
| Row restrictions | Exact/minimum/omitted/auto border-center extents 48/48.48/48.72/24.48pt; border thickness 0.48pt. | DOM outer first-row extents 48/48/48/24.500001pt; borders approximately 0.5pt. | DOM rectangles and PDF border centers are different observables; border/default rules, merges and continuation remain open. |

The baseline's earlier width correction restored 30 lines, and the capacity
correction restored the 21 + 9 split. DOM strut/paint changes align browser
planning and painting without selecting a universal Word baseline. The older
37px/74px minimum probe lacks complete DPR/version/source/WASM provenance; it is
historical, as are earlier emulated/physical/v2 captures with their own epochs.

The earlier ten-table and v4 renderer records retain their own source epochs.
V4 passed 81 geometry assertions but failed two of 75 boundary assertions: at
widths 194.796522px and 194.816522px, native cell paragraphs fit one line while
corrected Pretext advances planned two. The native glyph advance was smaller
than the corrected measurement; the cell width itself snapped downward.

V5 reused the planned rows for eligible whole paragraphs, closing both wrap
failures without changing the widths or tolerances. Its new body path exposed a
read-only click handler that collapsed an otherwise valid native drag selection;
the v6 guard prevents that controller selection update. The guarded v6 capture
passes **81 geometry assertions across 15 labeled tables**, **99 boundary
assertions across 17 read-only and six editable cell scenarios**, and **seven
native selection/caret cases**. Body/cell drags retain offsets and copied text
without model mutation. These checks have no additional Word reference and do
not qualify toolbar commands. Evidence: v6 geometry (local investigation artifact),
boundaries (local investigation artifact),
native selection (local investigation artifact),
and preserved v4 diagnosis (local investigation artifact).

The capture profile is macOS print-to-PDF with Chrome 154.0.8037.98 and physical
startup/context DPR 1.5. Fonts remain provider-managed: embedded subsets are
frozen, while Word's selected originals/fallback are unverified. Python 3.12.14,
Pillow 12.3.0 and NumPy 2.3.5 were used; NumPy differs from pinned 2.5.1. Images
already match requested raster dimensions, so no geometric resampling occurred.
The results remain research evidence rather than a qualified pinned-CI gate.
Same-URL WASM asset readback is recorded separately from the original streamed
response. Three further Word captures await manual Mac unlock.

Evidence: frozen reference manifest (local investigation artifact),
geometry/provenance (local investigation artifact),
v6 comparison (local investigation artifact),
table renderer scope (local investigation artifact),
and strut/zoom qualification (local investigation artifact).

## Integration validation chronology

Production arithmetic/fit helpers matched 12,744 arithmetic and 3,005 vertical-fit
cases against the pinned framework. The separate 3,003-case geometry branch is
another native function domain. Overlapping experiments must not be summed as
document coverage; none is a whole-document parity result.

The prior v3 validation snapshot (local investigation artifact)
fingerprints 31 modified/new source files, its ESM/CJS/WASM and validation
logs. It passes **556 unit checks with one skipped, 97 Rust checks, 46 oracle
contracts, five existing Chrome checks, nine typecheck projects, eight package
builds plus WASM, and 49 public packaged ESM checks**. The ESM total consists of
33 table checks plus 16 settings/mark checks. Public CJS import/clone/export/byte
reimport also passes. Previous validation snapshots are archived separately.

The v3 packaged table record (local investigation artifact)
binds its recorded bundle/WASM hashes and verifies tagged/legacy edits, inherited
clears, property-owner isolation and byte round trips. The settings/mark record (local investigation artifact)
covers current/history distinction, clone/edit/regeneration, clearing and fallback.
The CJS record (local investigation artifact)
qualifies the separate package entry.

The v4 validation snapshot (local investigation artifact)
records 556 passing unit checks with one skipped, 97 Rust checks, 46 oracle
contracts, five existing Chrome checks, nine typecheck projects and eight rebuilt
packages plus WASM. Its 93 packaged ESM checks comprise 33 table, 16 settings/mark
and 44 line/grid/ownership checks; the CJS roundtrip also passes. Existing rounding
assertions now retain fractions, the tab-wrapping unit check holds its body region
fixed, and the legacy-parser comparison excludes new internal mark provenance.
No new tracked unit tests were added.

The controller record (local investigation artifact)
covers 18 command cases and 15 public export/reimport loops, including named table
style ownership and read-only controls. The empty-style record (local investigation artifact)
covers seven body/table controller cases plus header/footer, dirty-mark,
direct-equals-inherited and undo controls. The former fractional boundary failures
remain visible in that historical snapshot despite its passing package checks.

The v5 candidate snapshot (local investigation artifact)
preserves the whole-paragraph rollout and its failed body drag checks. The
v6 candidate snapshot (local investigation artifact)
qualifies the read-only fix and preserves the subsequently found toolbar range
failure. Neither candidate is presented as a completed interaction integration.

The v7 interaction snapshot (local investigation artifact) passes **556 unit checks with one skipped, five existing
Chrome checks, all nine typecheck projects, 93 rebuilt-package ESM checks and the
public CJS roundtrip**. Existing smoke interactions now target the active editing
surface while retaining their selected-text and formatting assertions. No new
tracked unit tests were added. The viewer package was rebuilt; unchanged Rust,
WASM and other workspace packages retain their earlier source-bound validation.
The 50 direct-cell split assertions and four public export/reimports are recorded
against the unchanged controller implementation in the v5 source epoch.
Eleven context-menu and primary-selection controls (local investigation artifact)
pass against the final v7 source, covering body/cell Copy, Cut, undo and outside
caret placement, plus table padding, primary dragging and Shift selection.

For the v7 stage, the Word comparison remains explicitly bound to v6. Its production delta
corrects selection-event ownership; it changes no layout calculation or resting
paint code. The current interaction checks do not relabel earlier Word
images as a fresh v7 capture.

The v8 thumbnail cache correction (local investigation artifact) changes only the revision included in
page content keys and the corresponding memo dependency. Its controlled browser
font-load probe verifies automatic attached redraw and same-target/fresh-target
default renders against forced redraw. The integration passes 33 existing
thumbnail/font checks, the existing Chrome thumbnail check, viewer and playground
typechecks, and a fresh viewer build. Earlier broad checks remain bound to v7;
that stage retains the v6 Word comparison rather than claiming a v8 recapture.

The bounded live zoom-selection matrix (local investigation artifact)
has 24 scenarios and zero failures on the three-word/tab source: viewer
50/100/200% with external CSS zoom 1/1.25, caret placement and active/fresh
double-click selection. Literal source/tabs remain intact. It uses installed
headless Chrome/DPR 1; multiline zoom and OS-native IME are unqualified.
The earlier edit/undo/redo/synthetic-composition record (local investigation artifact)
remains distinct evidence for the selection-cycle correction.

The v3 and v4 source/WASM guards each remained unchanged across their captures;
v4 additionally guards public artifacts and Vite aliases/configuration. Any
subsequent correction requires another source epoch. Reference validation establishes hashes
and provenance; four passing count/dimension gates coexist with four failing
pixel gates. Existing browser checks use installed Chrome through temporary
configuration, rather than changing the repository's pinned setup.

## Mixed text, manual breaks and shared row heights

The v9 integration extends the shared whole-paragraph path to ordinary mixed
formatting in body text and direct table cells. Each eligible source must map
contiguously to text items. The existing exclusions for semantic fields, links,
tracked text, custom vertical metrics, character spacing and other unsupported
features remain; newly mixed East Asian and complex-script content retains its
previous rendering path pending qualification.

Non-exact row metrics now come from the runs actually on that row. A large run
on the first row no longer imposes its strut on later small-only rows. Exact
spacing still uses a fixed advance. Whole-paragraph height, full line ranges,
cell estimates and cell flow use the same successful plan. Table slices use
individual row heights and retain fractional paragraph bottoms and positions.
External grid floors reach the mixed-row and ending-mark metrics, wrapped-object
reflow and anchor reconstruction. Cell grid decisions retain the original
paragraph's explicit snap state when table defaults create a layout copy.

Whole-source token boundaries prevent a formatting boundary from creating an
extra word-break opportunity. A word moves to a fresh line before emergency
wrapping when necessary. Hanging-space fit advances remain distinct from painted
widths. These changes preserve the existing nominal width policy; they do not
force agreement with differing native glyph measurements.

Manual LF, CR and CRLF breaks preserve original UTF16 offsets, including breaks
split across runs, consecutive breaks and a terminal empty row. The final empty
row uses ending-mark metrics. Carets after a break belong to the next row, and
clicking the previous row's right edge stops before the break. Read-only copying
retains the source break characters. A small textarea adapter translates native
LF offsets to source offsets and preserves untouched CRLF pairs through edits
and history. OS-native IME and all clipboard formats remain separate qualification
targets.

Whole-paragraph React identity now survives a line-count change. When genuine
segment remounting loses focus to the document body, the existing wrapped editing
session restores its input and range. Focus on another control is retained.
Replacing a same-paragraph selection inherits its first selected run's formatting
unless a pending typing style overrides it. Page slices retain their global source
ranges and complete navigation plan; only the slice containing the selection's
focus owns the editing input. Point resolution uses the actual clicked slice.
Native selection direction survives input remounting.

Soft-wrap boundaries carry visual caret affinity in the local editing session.
The preceding line's end and following line's start can share a source offset;
point entry, Home/End, vertical navigation and slice input ownership now preserve
that distinction. Sliced caret lookup resolves the full paragraph position before
projecting it onto its owning page. Hard-break and terminal-empty-line ownership
remain unchanged. The same six live boundary checks that exposed three failures
on READY-4d pass on READY-4e.

The guarded READY-4e browser matrix passes 46 controls: 30 formatting/replacement/
undo checkpoints, 12 mixed-run line-membership cases, and four retained script
fallbacks. Earlier failed captures remain archived. Separately, 700
planner assertions cover whole/sliced height equality, participating run metrics
and manual-break offsets, and 78 assertions cover single caret ownership through
line slices, including terminal empty rows. A further 258 browser geometry
assertions cover explicit visual affinity and point/caret round trips.
These close the observed formatting
replacement failures within that scope; they do not establish complete editing
or Word geometry parity. See the mixed-text report (local investigation artifact)
and soft-wrap boundary trace (local investigation artifact).

The v9 validation snapshot (local investigation artifact)
records the rebuilt viewer, 556 existing unit checks with one skipped, two
typechecks, five existing Chrome checks, 93 packaged ESM checks and the CJS
round trip. The separate page-boundary/read-only matrix passes 31 controls.
No new tracked unit tests were added in this stage.

The fresh v9 Word comparison (local investigation artifact)
uses the same three frozen references and four pages. Page counts, dimensions,
39 ordinary line texts and 20 table paragraph texts pass. All four rendered PNGs
are byte-identical to v6. Literal baseline and pixel equality still fail: the
first ordinary browser baseline remains about 46pt versus Word's 46.56pt, and
the table minimum/omitted-row differences remain. Source, public build, workspace
alias and WASM guards pass; the original Word inputs are unchanged. This fresh
result verifies the resting regression boundary without claiming a fidelity gain
for those already-covered pages or parity for the wider document corpus.

## Explicit zero margins through export

The shared serializer now preserves represented zero table and cell margins on
all four edges. Its previous positive-only conversion omitted zero, allowing a
nonzero inherited table margin to become effective after export and reimport.
The correction uses the existing nonnegative conversion only for margin emission;
absent, cleared and negative values retain their existing behavior.

This applies to generated and regenerated table XML. Imported tables that retain
their original source XML continue to preserve that XML, including unknown
attributes. Margin edits on a model retaining original table XML still require
regeneration; this change does not introduce a new surgical margin-edit contract.

The v10 validation snapshot (local investigation artifact)
records a fresh WASM build and all eight package builds, 97 existing Rust checks,
34 focused existing unit checks, and the serializer typecheck. The rebuilt public
ESM and CJS exports pass 26 scenarios across 78 XML/package/DOCX export and
reimport paths, including zero overriding inherited nonzero margins, individual
clears, raw XML preservation and input nonmutation. The React renderer source
and JavaScript bundle bytes are unchanged from v9; the adjacent WASM binary
contains the serializer correction. This is an export fidelity fix and does not
establish a new Word geometry result.

## Fractional pages and mixed object anchors

Section page dimensions, margins, and header/footer distances now retain their
source twip fractions. Ordinary unmeasured pagination capacities, per-node
geometry and virtual page spacers preserve those values. The general paragraph,
table and document-grid converters retain their existing policies, as do measured
height normalization, import page-count reconciliation and multi-column sizing.
The section qualification (local investigation artifact)
records the resulting boundary changes separately from unchanged page counts.

Explicit mixed page/local drawing anchors now resolve their page or margin axis
from the owning page surface instead of treating the paragraph as the page
origin. React owns the final position; measured origins use fractional borders
and the effective viewer zoom. Numeric origin fallbacks preserve unmeasured
rendering. A separate textbox correction stops the body paragraph's first-line
indent from leaking into live textbox text.

The anchor qualification (local investigation artifact)
includes anchor-mode transitions, dragging, undo/redo, export/reimport and
fractional-border controls. The correction refreshes at React ref commits;
imperative inner-container scrolling without a render remains unqualified.
Local column/line/character semantics, alignment-only anchors, fractional drag
coordinates and explicit textbox paragraph indentation remain separate work.
These changes correct observed source-coordinate errors without selecting a
Word font or print profile.

The integrated v11 build passes 556 existing unit checks, two TypeScript
projects, five Chrome regressions and the public CJS round-trip smoke check.
Production anchor validation passes 62 browser controls, four indentation
controls, six unmeasured-style checks and eight real-import checks. The observed
textbox frame now starts at its declared 960 CSS-pixel page offset; its text is
inside the page, with the anchor's 48px indent retained outside the textbox.
No tracked test was added; existing section assertions now expect source ratios.

The three frozen Word references were recaptured on this build. All four browser
page images are byte-identical to v9, so their existing baseline and pixel
disagreements remain. The six-document corpus retains 96 planned pages and 16
leading captures. Five complete segment plans match v9; the fractional-page
table document has changed row boundaries and slice offsets. Its fresh Word
reference remains unavailable, so those changes are qualified as source geometry
corrections rather than measured Word pagination agreement.

## Real-document comparison preparation

Six immutable documents from the local testing corpus now have source-bound v9
browser captures, parsed models and complete page-segment plans. The plans total
96 pages, with 16 leading page screenshots captured across the six documents.
Source, distribution, alias, WASM and input-copy integrity checks passed.
The inspected corpus's 109 PDFs identify LibreOffice as their producer; they are
diagnostic leads rather than Word references. Fresh Word output for these six
documents has not yet been captured.
Evidence is retained in the ignored
`tmp/word-parity-native/oracle/testing-folder-v9/` directory.

## Remaining differences

Remaining work includes both still-observed architecture gaps and unfinished
qualification of the implemented paths:

| Area | Current limit | Investigation needed |
| --- | --- | --- |
| Numeric domains | Browser widths are fractional and selected conversions are exact, but native formatting/presentation scales and component reconciliation are not yet mapped to each profile. | Identify active scales and preserve verified conversion boundaries rather than assuming one global unit. |
| Line metrics and paint | Per-row DOM struts and zoom-aware paint preserve exact advances and share the planned browser baseline. Current physical-DPR-1.5 minimum rows are 36.6667px versus Word's 36.8px; Word baseline residuals remain. | Qualify native metric producers, effective provider/profile/phase, shaping/fallback, and ink painting. |
| Fit inputs | Browser calls use the bounded positive-height, zero-suppression/equal-limit case. Generic and Word story fit policies differ; the tested Word geometry uses equal limits. | Qualify story dispatch, effective spacing and border contributions, overhang/trim decisions, and consumed height before expanding the adapter. |
| Keeps and spacing | Shared split minima coexist with keep-next reserves based on heading/numbering/text length and other spacing heuristics. | Recover effective constraints and first rejected/accepted boundaries, with saved-count forcing disabled. |
| Tables | Tagged widths, legacy/inherited edits, alignment/bidi placement, row/padding/clipping and header/footer text-region contracts are active. Fixed grids, row omissions, horizontal placement and width caches retain fractions. | Ordered fixed constraints, native autofit, nested percentages, RTL ordering, collapsed borders, spans and continuation need Word qualification. |
| Notes and regions | Footnote reserve estimation, endnote append behavior, and separate column planning/rendering remain. | Typed story continuations, coupled rejection/reflow, and concrete page/column geometry. |
| Editing | The shared input preserves source offsets and qualified formatting operations. Native input still commits whole paragraph text through a generic text diff. | Carry explicit replacement ranges into model edits for ambiguous repeated-text and same-text replacements; qualify native IME and remaining clipboard formats. |
| Settings/profile | Compatibility mode and selected settings are preserved; many behaviors, script inputs, and the font environment remain unqualified. | Apply and verify each supported mode/setting under a named renderer/font profile. |

The ordinary-text membership and exact-row observations above demonstrate narrow
improvements. They do not turn unrelated source findings into established Word
mismatch causes or complete geometry/paint parity.

Microsoft documents that compatibility mode selects different feature sets, and
that `usePrinterMetrics` changes the metrics used for layout. A parity target
therefore needs a pinned renderer, settings, and font environment.
[Compatibility mode](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-docx/90138c4d-eb18-4edc-aa6c-dfb799cb1d0d),
[printer metrics](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.useprintermetrics?view=openxml-3.0.1).

Further parity work should use the existing Word fidelity
harness in `docs/word-fidelity-harness.md`: expand the frozen controlled
references, establish repeatability and font provenance, record source-aligned
line/page geometry, and reduce the next divergent decision in the active viewer. Recover upstream line metrics and units
for that decision, then port the smallest verified rule and compare the rendered
result. Font shaping, fallback, tables, floats, sections, and footnotes still need
their own coverage before claiming 1:1 behavior.

The production integration above is a verified subset of the recovered behavior.
The remaining decompiler output is research material and has not been imported
as a replacement for the browser engine.


## Merged-cell continuation verification (2026-10-07)

A further arm64 inspection of the same installed PTLS build examined
`FsTableSrvGetMasterCell` at `0x14d220` and
`FsTableSrvCalcClipHeightW` at `0x14cb34`. Direct calls on bounded synthetic
records verified 5,502 row queries: contiguous single-column merge records
trace back to their first row, and their cumulative clipping extent equals
accumulated row heights minus the starting top inset and ending bottom inset.
The test uses one fragment identifier and merge codes 1 followed by 2. It does
not cover combined horizontal merges, fragment discontinuities, host callbacks,
or establish a general row-height distribution policy.

The viewer now preserves occupied grid columns at page boundaries, clamps DOM
rowspans to the visible rows, and paints carried merged content through a
clipped window using the original cell origin. Direct table-cell text direction
also survives import, edits, clearing, and reconstruction. Vertical writing mode
is rendered in table cells, including read-only, editable, and nested tables.
The text direction values follow the
[Open XML text-direction definition](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.textdirection.val?view=openxml-3.0.1).

These are independently implemented layout rules. Native inspection yielded
machine instructions and symbols, not the original Word source. The bounded
native checks do not establish pixel or pagination parity for full documents.
Retained local diagnostics are under
`output/playwright/word-continuations-20261007/`.

## Native qualification and corpus pass (2026-10-09)

The current investigation uses Word 16.106.1 and 1,000 immutable DOCXCorpus
sources. The browser's frozen baseline captured 992 sources; eight reached a
capture budget or settling failure and have a separate diagnostic contract.
The convergence build subsequently captured 997 of the same 1,000 sources under
the normal contract. Its three page-limit cases complete separately with higher
budgets, covering all 1,000 distinct sources across the two contracts: 10,815
paper surfaces and 503,041 DOM lines. The three previous settling failures now
complete. The convergence build matches 107 of the available 132 native page
counts, up from 104 at baseline, and has 28 qualified normalized main-story
page-text matches. These are an
ordered partial sample, not an overall fidelity percentage.
Native Word references currently cover 132 sources and 1,043 physical pages.
The next native open is unresolved while the Mac is locked, so the remaining
868 sources have no successful native reference. Source hashes, owned-copy
hashes, exact window closure, renderer bytes and font profiles are retained in
`output/playwright/rea-word-corpus1000-20261009/`.

The native API is qualified separately for physical page count, whole-story
text and prefix-range page membership. Prefix ranges cannot describe physical
glyph membership across split table cells. All multi-page main-story tables
are therefore excluded from that membership oracle, even when their count is
valid. Count-first captures defer membership explicitly. Browser automatic
numbering is separated from typed text only after source-bound projection
checks; a normalized page-text match is not a pixel-fidelity claim.

The following changes have bounded Word evidence:

- Logical section parity and explicit page-number restarts share one counter.
  A restart inside a continuous section takes effect on the next physical page.
  All 32 controlled cases match native physical counts and body-text page
  membership. Selected native PDFs additionally verify blank pages and printed
  page labels. Inserted parity blanks suppress headers, footers and borders.
- Effective paragraph grid opt-outs survive defaults, style inheritance, table
  styles and edits. The table compatibility gate is preserved through import
  and serialization, and all viewer table paths use it consistently. Fractional
  grid pitch is retained. Six printed controls qualify gate behavior and the
  exact-spacing override; they do not qualify arbitrary grid-height arithmetic.
- Unwrapped header/footer artwork no longer reserves body flow height. Header
  text remains inside its text margins when an anchored drawing needs page-wide
  coordinates. A native header control verifies body text painted over the
  artwork. A later bounded square-wrap correction applies a page-local gap to
  full-width image obstacles for single-line body paragraphs; native and browser
  controls both place 42 lines on the first page and two on the second.

REA identifies an upstream distinction in vertical metrics. The line-height
producer consumes cached whole-line components and conditional component
maxima, rather than reading the visible glyph font's hhea metrics directly.
The source-associated native CJK advance remains twice the grid pitch even
though the embedded glyph font's ascent plus descent is below one pitch.
Matching that glyph provider in a private browser diagnostic does not close the
gap. A further byte-bound initializer adds
`2 * RoundedMultiplyDivide(metric.height, 15, 100)` to the sum of its ascent
and descent for four charset codes. Its alignment helper redistributes the
components without changing their sum. The record layout is inferred from
the documented structure; its runtime values, provider adaptation, cache
selection and formatting scale remain unobserved. The global selector
previously called a profile selector chooses raw versus shared handles.

A private diagnostic applies a continuous approximation to measured CJK run
fonts, then rounds the extent up to the grid pitch. One source moves from 19
to 40 browser pages against 37 in Word, while its measured same-font line
advance moves from about 16.70pt to 32.65pt against 31.92pt. Using only the
paragraph mark font misses that mixed-script case. The approximation has not
been added to production: source charset, actual native metric-record charset,
glyph provider, component maxima and print quantization remain separate
questions. Four explicit-default controls are prepared for native qualification.

The corpus also exposed an independent floating-table failure. Oversized
text-anchored tables now enter row pagination, preserve their horizontal
position, and use full-row estimates for otherwise missing merged-fragment
clip geometry. One qualified source count changes from one browser page to
12, matching Word; all 145 rows and all 30 merged-cell text inventories survive
the browser clip audit. Four smaller floating-table documents are unchanged.
Exact Word table page membership still requires native PDF evidence.

Two further corpus failures have bounded corrections. Explicit root paragraph
styles now inherit spacing through document defaults and their own parent chain,
without unrelated default-style spacing. A one-page source retains its count and
all body text now stays inside the paper. Canonical table row measurements also
exclude truncated or continuation-only merged geometry. The source that
previously exceeded React's update depth now settles at 18 pages and 760 DOM
lines. Existing Rust checks, hierarchy probes, viewer checks and the fresh
1,000-source browser pass qualify their respective scopes.

The integrated build still matches all 987 body lines and page assignments of
the retained 22-page Word reference. The pre-header integrated build matches
all 41 feature-control counts but misses square-header body membership. A later
frozen header build passes all 49 combined control counts and all 48 eligible
body-page inventories; the multi-page table membership remains excluded. Its
re-extracted native reference also agrees on all 987 lines. A focused PTLS trace
recovers vertical obstacle-band
intersection, horizontal interval subtraction and advancement to the next
obstacle edge when no width is available. Native output independently confirms
the local gap after the first body line. Shared pagination and rendering now
charge that gap consistently, preserving the first line above the artwork on
both pages. Static generic-story routines alone do not qualify every header,
wrap mode or continuation path. Admission is limited to untransformed standalone
anchored pictures and ordinary single-line body flow; unsupported legacy/group
transforms, frames and drop caps are excluded. All 1,000 corpus sources fail an
intentionally overinclusive structural selector, so this later feature correction
is qualified by its controls rather than claimed as a corpus-count improvement.

Comparison qualification now rejects body text rectangles outside the paper.
It separately retains missing positive-range candidates, rotated text order,
and clipped continuation copies. DOM association and source-order projection
do not prove glyph paint. A stored-count ablation also confirms that cached
page statistics influence current pagination; equal counts can conceal overflow
and are never used as the native reference.
An isolated attempt to let a latched body-overlap flag override cached-count
selection reduced count agreement from 107 to 93 out of 132. It was not
promoted. The measurement currently conflates nominal-margin intrusion,
empty/container flow and visible footer overlap; a broad veto is not a qualified
replacement for the existing policy. Same-frame geometry distinguishes a real
text extent inside the paper but beyond the nominal margin from trailing blank
paragraphs that escape the paper; the latter source has an otherwise blank
second native page. Browser Calibri Light substitution was observed in the
former, but its native font metrics still need qualification.

The ten qualified membership mismatches have 122 native page boundaries.
Twenty-five coincide with the same browser physical page boundary, while four
align with cuts on different page ordinals. Eight fall inside browser lines,
83 fall between browser lines and two begin empty native continuations. The
source-bound ledger narrows the next native checks to line wrapping, vertical
flow and blank continuation behavior; it does not infer the underlying cause.

A full-state convergence guard now catches repeating page plans and measured
page heights that leave page counts unchanged. It detects exact periods of two
to four across three repetitions, retaining canonical table measurements when
it uses the existing fallback. All 994 successful captures shared with the
preceding build preserve page counts, source-ordered page text and recorded
region geometry. Fresh convergence captures also retain all 49 control counts,
48 eligible body-page inventories and 987 long-reference line assignments.

A later paint audit found a distinct merged-cell clipping defect: all source
text remained in the DOM, but an internal clip gap cut lower strokes from nine
glyphs. Extending horizontal continuation clips through internal cell padding
preserves the original text origin and net row flow. The targeted corrected
capture covers all 113 inspected character masks without duplicate samples or
ink outside the checked cells; its 84 pages and table geometry are unchanged.
Exact-height rows, vertical text and row slices retain their prior paths. The
fresh 1,000-source pass on this later build also renders all sources across the
normal and larger-budget contracts, retaining 107 of 132 native count matches
and all 49 control counts. All 48 eligible control body-page inventories and
987 long-reference lines still match. Independent comparison of all 997 normal
captures and the separate three larger captures preserves page counts, per-page
text and geometry at the corpus extractor's 0.001 CSS px precision. Fourteen
full-precision character ranges in the targeted paint audit differ by at most
0.000015259 CSS px. This result does not establish native Word table page
membership or pixel parity.

A later native line-fit trace confirms a conditional end-width subtraction in
the simple-text initial feasibility branch. Its caller supplies a mask-based
subtraction gate and a separate optical bit. The residual uses wrapped 32-bit
subtraction and a negative-flag branch; zero accepts the initial fit flag.
This is not a globally overflow-safe mathematical width comparison, and later
break selection remains separate. The optical helper permits signed outputs,
bounds their magnitude and propagates callback errors. An original Word
callback-table candidate resolves to a function that returns an error, but the
object chain linking that table to a sampled invocation remains unproven.
Complete REA Evidence, raw instructions and independent review are retained in
the corpus run's native line-break investigation. None of these observations
calibrates a new CSS tolerance or a universal optical adjustment.

Fresh native PDF checks also separate requested font names from actual font
providers and identify tracked-change markup print scaling. In one private
diagnostic, replacing sampled PingFang with the native PDF's Microsoft YaHei
provider leaves all browser line text, physical page assignments and disputed
cuts unchanged. Actual font identity matters, but that substitution alone does
not explain the line-boundary mismatch. The frozen production renderer and its
full-corpus evidence remain unchanged by this diagnostic.

A separate normal-wrapping diagnostic changes the blanket CJK keep-all policy
without changing the production build. It reduces exact page-count matches
from 30 to 29 across 64 selected sources with qualified native references,
while summed absolute count error rises from 222 to 236 pages. The three
focused native cuts still fall inside browser lines. This rejects that isolated
change as a production correction and leaves horizontal metrics, natural leading
and grid arithmetic as separate causal questions.

Further original-byte analysis verifies Word's custom punctuation action and
class tables, their callback pointers and language-specific fallback classes.
The fixed Traditional Chinese table conditionally routes several punctuation
characters to a cached-metric operation. A separate producer trace recovers
integer width components and rounded multiply/divide arithmetic, but does not
establish metric units, live object identity or public document-setting gates.
The compression investigation retains independent pointer-chain and instruction
verification; the producer extension has a separate evidence scope. Neither
supports a universal half-em correction. Four explicit-font, no-grid/grid
controls have frozen browser geometry and await native PDF baseline measurements.

The latest finite corpus checkpoint contains 724 qualified native references
and 7,332 pages: 558 browser counts match and 166 differ. Four recovered outcomes
remain excluded, one continuation awaits lifecycle qualification and 271 sources
have no native record. This extends count coverage without replacing the earlier
sealed page-membership comparison or establishing 1:1 fidelity. Native opens
await a visible check of the pending lifecycle-control state; the observed
desktop lock does not establish the failure's cause.

The static images retain original virtual addresses and byte-identical slices
of the installed arm64 executable. They are never executed. Complete REA
Evidence records and closed-session snapshots preserve omitted-state,
decompiler and Darwin ABI limitations. These findings guide independently
implemented rules; they do not establish full Word source recovery or 1:1
layout and paint parity.
