// Pure mapping from DOM `beforeinput` events onto offset-based editing
// intents. The React hosts resolve the DOM selection to text offsets at event
// time, translate the InputEvent through `resolveEditingIntent`, apply
// same-paragraph text edits with `applyTextEditingIntent`, and route the
// result through the transaction pipeline — the browser never mutates the
// editable DOM on these paths.

export type EditingIntent =
  | { kind: "insertText"; text: string }
  | { kind: "insertParagraph" }
  | { kind: "insertLineBreak" }
  | { kind: "replaceText"; text: string }
  | {
      kind: "deleteContent";
      direction: "backward" | "forward";
      unit: "character" | "word" | "line" | "entire-line";
    }
  | { kind: "deleteRange" }
  | { kind: "historyUndo" }
  | { kind: "historyRedo" }
  // Recognized as content-mutating but not representable as a model edit; the
  // host must preventDefault it so the DOM cannot drift from the model.
  | { kind: "blocked" };

export interface EditingIntentSource {
  inputType: string;
  data?: string | null;
  dataTransferText?: string | null;
}

// Returns undefined only for composition input, which is never cancelable —
// the browser owns the DOM until `compositionend`. Every other inputType maps
// to an intent (unrecognized ones map to "blocked").
export function resolveEditingIntent(
  source: EditingIntentSource
): EditingIntent | undefined {
  const insertedText = source.data ?? source.dataTransferText ?? "";
  const transferredText = source.dataTransferText ?? source.data ?? "";

  switch (source.inputType) {
    case "insertCompositionText":
    case "deleteCompositionText":
      return undefined;
    case "insertText":
    case "insertFromYank":
    case "insertFromPasteAsQuotation":
      return { kind: "insertText", text: insertedText };
    case "insertFromPaste":
    case "insertFromDrop":
      return { kind: "insertText", text: transferredText };
    case "insertReplacementText":
    case "insertTranspose":
      return { kind: "replaceText", text: insertedText };
    case "insertParagraph":
      return { kind: "insertParagraph" };
    case "insertLineBreak":
      return { kind: "insertLineBreak" };
    case "deleteContentBackward":
      return { kind: "deleteContent", direction: "backward", unit: "character" };
    case "deleteContentForward":
      return { kind: "deleteContent", direction: "forward", unit: "character" };
    case "deleteWordBackward":
      return { kind: "deleteContent", direction: "backward", unit: "word" };
    case "deleteWordForward":
      return { kind: "deleteContent", direction: "forward", unit: "word" };
    case "deleteSoftLineBackward":
    case "deleteHardLineBackward":
      return { kind: "deleteContent", direction: "backward", unit: "line" };
    case "deleteSoftLineForward":
    case "deleteHardLineForward":
      return { kind: "deleteContent", direction: "forward", unit: "line" };
    case "deleteEntireSoftLine":
      return {
        kind: "deleteContent",
        direction: "backward",
        unit: "entire-line",
      };
    case "deleteContent":
    case "deleteByCut":
    case "deleteByDrag":
      return { kind: "deleteRange" };
    case "historyUndo":
      return { kind: "historyUndo" };
    case "historyRedo":
      return { kind: "historyRedo" };
    default:
      return { kind: "blocked" };
  }
}

export function editingIntentCoalesceClass(
  intent: EditingIntent
): "insert" | "delete" | undefined {
  switch (intent.kind) {
    case "insertText":
    case "insertLineBreak":
    case "replaceText":
      return "insert";
    case "deleteContent":
    case "deleteRange":
      return "delete";
    default:
      return undefined;
  }
}

export interface AppliedTextEdit {
  text: string;
  caret: number;
}

function isWhitespaceChar(char: string): boolean {
  return /\s/.test(char);
}

function codePointLengthBefore(text: string, offset: number): number {
  if (offset >= 2) {
    const codePoint = text.codePointAt(offset - 2);
    if (codePoint !== undefined && codePoint > 0xffff) {
      return 2;
    }
  }
  return offset > 0 ? 1 : 0;
}

function codePointLengthAt(text: string, offset: number): number {
  if (offset >= text.length) {
    return 0;
  }
  const codePoint = text.codePointAt(offset);
  return codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
}

function wordDeleteStartBefore(text: string, offset: number): number {
  let index = offset;
  while (index > 0 && isWhitespaceChar(text[index - 1])) {
    index -= 1;
  }
  while (index > 0 && !isWhitespaceChar(text[index - 1])) {
    index -= 1;
  }
  return index;
}

function wordDeleteEndAfter(text: string, offset: number): number {
  let index = offset;
  while (index < text.length && isWhitespaceChar(text[index])) {
    index += 1;
  }
  while (index < text.length && !isWhitespaceChar(text[index])) {
    index += 1;
  }
  return index;
}

function lineStartBefore(text: string, offset: number): number {
  const newlineIndex = text.lastIndexOf("\n", Math.max(0, offset - 1));
  return newlineIndex < 0 ? 0 : newlineIndex + 1;
}

function lineEndAfter(text: string, offset: number): number {
  const newlineIndex = text.indexOf("\n", offset);
  if (newlineIndex < 0) {
    return text.length;
  }
  // A caret sitting directly before a line break deletes the break itself.
  return newlineIndex === offset ? offset + 1 : newlineIndex;
}

function replaceRange(
  text: string,
  start: number,
  end: number,
  replacement: string
): AppliedTextEdit {
  return {
    text: `${text.slice(0, start)}${replacement}${text.slice(end)}`,
    caret: start + replacement.length,
  };
}

// Applies a same-paragraph text intent to `text` with the selection at
// [start, end). Returns undefined when there is nothing to apply — a no-op
// (empty insert into a collapsed selection) or a boundary delete that must
// cross into a neighboring paragraph and is the caller's responsibility.
export function applyTextEditingIntent(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  intent: EditingIntent
): AppliedTextEdit | undefined {
  const start = Math.max(0, Math.min(Math.round(selectionStart), text.length));
  const end = Math.max(
    start,
    Math.min(Math.round(selectionEnd), text.length)
  );

  switch (intent.kind) {
    case "insertText":
    case "replaceText": {
      const replacement = intent.text.replace(/\r\n?/g, "\n");
      if (replacement.length === 0 && start === end) {
        return undefined;
      }
      return replaceRange(text, start, end, replacement);
    }
    case "insertLineBreak":
      return replaceRange(text, start, end, "\n");
    case "deleteRange":
      if (start === end) {
        return undefined;
      }
      return replaceRange(text, start, end, "");
    case "deleteContent": {
      if (start !== end) {
        return replaceRange(text, start, end, "");
      }

      if (intent.direction === "backward") {
        if (intent.unit === "entire-line") {
          const lineStart = lineStartBefore(text, start);
          const newlineIndex = text.indexOf("\n", start);
          const lineEnd = newlineIndex < 0 ? text.length : newlineIndex;
          if (lineStart === lineEnd) {
            return undefined;
          }
          return replaceRange(text, lineStart, lineEnd, "");
        }
        if (start === 0) {
          return undefined;
        }
        const deleteFrom =
          intent.unit === "character"
            ? start - codePointLengthBefore(text, start)
            : intent.unit === "word"
            ? wordDeleteStartBefore(text, start)
            : lineStartBefore(text, start);
        if (deleteFrom >= start) {
          return undefined;
        }
        return replaceRange(text, deleteFrom, start, "");
      }

      if (start >= text.length) {
        return undefined;
      }
      const deleteTo =
        intent.unit === "character"
          ? start + codePointLengthAt(text, start)
          : intent.unit === "word"
          ? wordDeleteEndAfter(text, start)
          : lineEndAfter(text, start);
      if (deleteTo <= start) {
        return undefined;
      }
      return replaceRange(text, start, deleteTo, "");
    }
    default:
      return undefined;
  }
}

export interface TextCommitBurst {
  key: string;
  caretAfter: number;
  at: number;
}

// Per-keystroke commits coalesce into one history entry while the burst is
// unbroken: same paragraph and intent class, caret continuity (each edit
// starts where the previous one left the caret), and no long pause.
export function shouldCoalesceTextCommit(
  previous: TextCommitBurst | undefined,
  next: { key: string; caretBefore: number; at: number },
  windowMs = 1000
): boolean {
  return Boolean(
    previous &&
      previous.key === next.key &&
      next.at >= previous.at &&
      next.at - previous.at <= windowMs &&
      previous.caretAfter === next.caretBefore
  );
}

export interface MergedCellParagraphs {
  cellText: string;
  caretParagraphIndex: number;
  caretOffset: number;
}

// Merges the paragraph at `boundaryParagraphIndex` into the one before it and
// resolves the caret (the merge seam) against the paragraph list the model
// will produce when it re-splits the joined cell text on "\n".
export function mergeCellParagraphTexts(
  paragraphTexts: string[],
  boundaryParagraphIndex: number
): MergedCellParagraphs | undefined {
  if (
    boundaryParagraphIndex <= 0 ||
    boundaryParagraphIndex >= paragraphTexts.length
  ) {
    return undefined;
  }

  const mergedTexts = [
    ...paragraphTexts.slice(0, boundaryParagraphIndex - 1),
    `${paragraphTexts[boundaryParagraphIndex - 1]}${
      paragraphTexts[boundaryParagraphIndex]
    }`,
    ...paragraphTexts.slice(boundaryParagraphIndex + 1),
  ];
  const cellText = mergedTexts.join("\n");

  let caretGlobalOffset = 0;
  for (let index = 0; index < boundaryParagraphIndex - 1; index += 1) {
    caretGlobalOffset += paragraphTexts[index].length + 1;
  }
  caretGlobalOffset += paragraphTexts[boundaryParagraphIndex - 1].length;

  const parts = cellText.split("\n");
  let remaining = caretGlobalOffset;
  let caretParagraphIndex = 0;
  while (
    caretParagraphIndex < parts.length - 1 &&
    remaining > parts[caretParagraphIndex].length
  ) {
    remaining -= parts[caretParagraphIndex].length + 1;
    caretParagraphIndex += 1;
  }

  return {
    cellText,
    caretParagraphIndex,
    caretOffset: Math.max(0, Math.min(remaining, parts[caretParagraphIndex].length)),
  };
}
