# Text Surface Migration

## Goal

Extend the existing pretext-based wrapped paragraph editing path into a single
selection/caret architecture that can power the full DOCX editor.

The target is a model-first WYSIWYG editor where:

- the editor model owns selection and caret state
- layout owns geometry
- DOM selection is not authoritative
- a hidden text input is only an input bridge for keyboard, IME, clipboard, and accessibility

## Current Reusable Pieces

The wrapped/drop-cap path already has the right primitives:

- model-owned range sync in `syncWrappedParagraphRange(...)`
- geometry-driven selection painting via `resolveSelectionRects(...)`
- geometry-driven caret via `resolveCaretRectAtOffset(...)`
- point-to-offset mapping via `resolveOffsetAtPoint(...)`
- hidden textarea input bridge

Those should become the base of a generic text surface system.

## Core Design

### 1. Canonical Editor Cursor State

Keep one canonical document selection model:

```ts
interface EditorCursorState {
  selection: DocxEditorSelection;
  activeTextRange?: DocxTextRange;
  pendingRunStyle?: TextRunNode["style"];
  sessionKind: DocxSelectionSessionKind;
}
```

Rules:

- `activeTextRange` is authoritative for text selection/caret
- `selection` is the structural fallback for object/table/cell selection
- all edits and selection moves normalize through the model

### 2. Text Surface Contract

Every editable paragraph-like thing should implement the same surface contract:

```ts
interface TextSurfaceId {
  location: ParagraphLocation;
  key: string;
}

interface TextSurfaceLayoutSnapshot {
  text: string;
  textLength: number;
  lineHeightPx: number;
  caretAtOffset(offset: number): { left: number; top: number; width: number; height: number } | undefined;
  rectsForRange(start: number, end: number): Array<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>;
  offsetAtPoint(x: number, y: number): number;
}

interface TextSurfaceRegistration {
  id: TextSurfaceId;
  element: HTMLElement;
  layout: TextSurfaceLayoutSnapshot;
}
```

Rules:

- each surface maps point <-> offset for its own paragraph
- each surface renders only its slice of the global selection
- surfaces do not own document-wide selection ordering

### 3. Surface Registry

The viewer owns a registry of active surfaces:

```ts
interface TextSurfaceRegistry {
  register(surface: TextSurfaceRegistration): void;
  unregister(surfaceKey: string): void;
  get(surfaceKey: string): TextSurfaceRegistration | undefined;
  resolveBoundaryFromPoint(point: { x: number; y: number }): DocxTextRangeBoundary | undefined;
}
```

Behavior:

- prefer a surface hit when the point lands inside a registered surface
- otherwise fall back to document-level boundary resolution
- support wrapped paragraphs, normal paragraphs, table-cell paragraphs, header/footer paragraphs

### 4. Hidden Input Bridge

Do not use one long-lived DOM selection host per paragraph. Use a single shared
input bridge or one active bridge mounted into the active surface only.

```ts
interface TextInputBridgeState {
  activeSurfaceKey?: string;
  value: string;
  selectionStart: number;
  selectionEnd: number;
  composing: boolean;
}
```

Responsibilities:

- receives text input
- receives composition events
- receives clipboard shortcuts
- mirrors current active surface text + local selection
- never defines visible selection

### 5. Document-Level Selection Controller

Cross-paragraph selection should be owned by one controller:

```ts
interface SelectionDragState {
  pointerId: number;
  anchor: DocxTextRangeBoundary;
  focus: DocxTextRangeBoundary;
  startX: number;
  startY: number;
}

interface SelectionController {
  beginPointerSelection(anchor: DocxTextRangeBoundary, pointer: { id: number; x: number; y: number }): void;
  updatePointerSelection(pointer: { id: number; x: number; y: number }): void;
  endPointerSelection(pointerId: number): void;
  setCollapsedCaret(boundary: DocxTextRangeBoundary): void;
  setRange(start: DocxTextRangeBoundary, end: DocxTextRangeBoundary): void;
}
```

Rules:

- drag state stores document boundaries, not surface-local offsets
- shift-click, double-click, triple-click, and keyboard extension all flow through this controller
- surfaces only delegate anchor/focus updates

## Rendering Model

Each text surface receives the global `activeTextRange` and computes its local
slice:

```ts
interface TextSurfaceSelectionSlice {
  start?: number;
  end?: number;
  collapsedCaretOffset?: number;
  touchesSurface: boolean;
}
```

Expected behavior:

- no selection in paragraph: render nothing
- expanded selection spanning paragraph: render local highlight rects
- collapsed caret in paragraph: render local caret

This is the key generalization of the current wrapped paragraph renderer.

## Suggested React Shape

```ts
interface TextSurfaceProps {
  id: TextSurfaceId;
  sourceText: string;
  layout: TextSurfaceLayoutSnapshot;
  activeRange?: DocxTextRange;
  readOnly: boolean;
  onReplaceText(range: { start: number; end: number }, text: string): void;
  onSplit(offset: number): void;
  onMoveCaret(offset: number, options?: { extend?: boolean; preferredCaretX?: number }): void;
  onPointerSelect(boundary: DocxTextRangeBoundary): void;
}
```

Notes:

- `TextSurface` should be generic and unaware of wrapped image specifics
- wrapped/drop-cap/normal paragraph code should supply different layout snapshots, not different selection systems

## Editing Best Practices

### Model First

- all selection and text mutations must produce transactions
- DOM should mirror model state, never race it

### Geometry First

- use layout-derived caret/selection rects for all visual painting
- use layout-derived point-to-offset hit testing

### Input Bridge Only

- hidden textarea handles IME, clipboard, keyboard, accessibility hooks
- visible selection and caret come from the editor model

### Explicit Transactions

The long-term transaction shape should be:

```ts
interface EditorTransactionPatch {
  model?: DocModel;
  selection?: DocxEditorSelection;
  activeTextRange?: DocxTextRange;
  pendingRunStyle?: TextRunNode["style"];
  pushHistory?: boolean;
  clearSelectedFormField?: boolean;
  status?: string;
}
```

That already roughly matches the current `dispatchEditorTransaction(...)`.

## Migration Slices

### Slice 1: Extract Generic Text Surface

- extract the wrapped paragraph renderer into `TextSurface`
- keep current hidden textarea behavior
- keep current layout APIs

Success criteria:

- wrapped paragraphs and drop-cap wrapped paragraphs share the same extracted surface

### Slice 2: Normal Paragraphs on Text Surface

- generate a normal paragraph layout snapshot
- render body paragraphs through `TextSurface` instead of `contentEditable`
- keep document selection model authoritative

Success criteria:

- basic caret movement
- pointer selection within one paragraph
- text input and IME
- home/end/up/down

### Slice 3: Cross-Paragraph Selection

- route drag selection through `SelectionController`
- surface registry resolves boundaries in any paragraph surface
- each paragraph renders its own selection slice

Success criteria:

- drag from paragraph A into paragraph B
- reverse selection direction
- selection survives relayout

### Slice 4: Table Cell Paragraphs

- reuse `TextSurface` inside table cells
- keep table structural selection separate from text selection

Success criteria:

- intra-cell text editing
- cross-paragraph selection inside a cell
- stable transitions between text selection and cell selection

### Slice 5: Retire DOM Selection Authority

- remove `selectionchange` as the primary source of truth
- remove paragraph `contentEditable` dependency for normal editing
- keep DOM selection only where browser-native controls still require it

Success criteria:

- visible caret/highlight always comes from model state
- no selection jumps from DOM reconciliation

## Risks

### IME and Composition

This is the main reason to keep the hidden textarea bridge. Do not attempt a
pure keydown-only editor.

### Accessibility

You will likely need ARIA and focus management work once visible selection is
fully detached from native DOM selection.

### Tables and Embedded Controls

Table selection, form widgets, and object resizing must continue to opt out of
text drag logic when appropriate.

## Immediate Next Implementation

The next code step should be:

1. extract the current wrapped/drop-cap paragraph path into a generic `TextSurface`
2. define the `TextSurfaceLayoutSnapshot` adapter around existing pretext layout utilities
3. make wrapped and drop-cap paragraphs use only that shared surface

That keeps the next slice small and directly reusable for normal paragraphs.
