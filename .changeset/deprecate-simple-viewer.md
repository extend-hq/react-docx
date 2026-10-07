---
"@extend-ai/react-docx": minor
---

Deprecate ReactDocxViewer and ReactDocxViewerProps while preserving their
existing API and behavior. Recommend useDocxEditor with DocxEditorViewer in
read-only mode for document previews.

Carry per-line ascent, descent, and height through pagination, fragment rendering,
selection, and hit testing. Preserve fractional text measurements and character
spacing, use explicit inline-object widths, and share widow/orphan constraints
between page and column splits. Keep leading words intact across styled-run
boundaries when they can fit on the next line.

Honor document default tab stops and preserve compatibility mode and header
settings through import, cloning, and export. Keep tab offsets aligned with
editable text and correct Chromium's fractional font advance measurements.

Apply fixed and minimum line spacing to mixed runs, account for table row
restrictions and cell clipping, and make table sizing independent of host CSS.

Preserve tagged table and cell widths, table alignment, and bidi settings through
import, cloning, and export. Resolve legacy width edits and restore inherited
formatting when direct overrides are cleared. Use the correct text region for
header/footer tables and invalidate cached geometry after width edits. Retain
fractional fixed-table widths, resolve cell spans and skipped row columns, and
allow explicitly sized fixed tables to overflow their containing region.

Keep column insertion, deletion, and rectangular cell selection aligned with
the physical table grid, and retain keyboard focus for table deletion. Preserve
named table styles during export, direct versus inherited text alignment when
changing paragraph styles, and line-spacing compatibility settings.

Preserve paragraph-mark formatting and its revision metadata through import,
cloning, editing, and export. Give newly split paragraphs fresh ending ownership
and preserve the surviving ending during merges. Use effective empty-paragraph
mark formatting for line measurement, paint, and editable caret geometry,
including header and footer flow. Recompute empty mark inheritance after a
paragraph style change while preserving explicit mark formatting.
Retain fractional paragraph and table border widths,
use black for automatic document text, and stabilize editing state during
selection, undo/redo, and composition.

Measure browser line struts and fragment baselines consistently at viewer and
ancestor CSS zoom, invalidate metrics when the rendering profile changes, and
correct caret and word selection through the wrapped editing route.

Use planned line geometry for eligible whole text paragraphs and direct table
cells, including mixed formatting, in both read-only and editable views. Include text, formatting, font
revision, and document layout settings in bounded cell-layout caches. Preserve
editing focus when switching between planned and native text rendering, and
split direct table-cell paragraphs with independent ending ownership.
Preserve read-only dragging and copying, capture the active input range for
toolbar formatting and text context-menu commands, and clear prior cell/object
selections when entering text. Keep Cut and undo synchronized with the active
text input.

Refresh cached page thumbnails when font metrics change, including after a font
loads without changing the document's text or page count.

Measure mixed-font rows from their participating runs and use the same heights
for whole paragraphs, page slices and table-cell flow. Preserve fractional line
positions and apply document-grid minimums consistently around wrapped objects.
Keep words together across formatting boundaries, with emergency wrapping for
words wider than a fresh line.

Preserve manual line breaks, trailing empty rows and original CRLF source offsets
through painting, selection, copying, typing, deletion and undo/redo. Keep typing
focus and selection when a font-size change reflows an active paragraph.
Preserve selected run formatting during text replacement and give paginated
paragraphs one editing input, with source offsets and selection direction retained
across page slices.

Preserve explicit zero table and cell margins when regenerating document XML,
so export and reimport retain their override of inherited spacing.

Preserve fractional section page dimensions, margins and header/footer distances
through ordinary pagination and virtual page spacing. Resolve explicit mixed
page/local drawing anchors against the owning page at the current viewer zoom,
and prevent body paragraph indentation from leaking into live textbox text.

Stop oscillating measurement feedback from exhausting React's update limit on
imported documents, and honor explicit page dimensions when the print-orientation
flag disagrees with them. Apply table run formatting before paragraph, character,
and direct formatting, while keeping nested tables independent. Preserve separate
Latin and complex-script font sizes through import, layout, painting, editing,
and export.
