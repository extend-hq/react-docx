export interface TextareaInputHint {
  start: number;
  end: number;
  inputType?: string;
}

interface TextareaReplacement {
  start: number;
  end: number;
  inserted: string;
}

export interface TextareaTextEdit {
  source: string;
  sourceSelectionStart: number;
  sourceSelectionEnd: number;
  changed: boolean;
  replacement?: { sourceStart: number; sourceEnd: number; inserted: string };
}

export function normalizeTextareaText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function clampOffset(offset: number, length: number): number {
  return Math.max(0, Math.min(Math.round(offset), length));
}

export function sourceOffsetToTextareaOffset(source: string, offset: number): number {
  const end = clampOffset(offset, source.length);
  let sourceIndex = 0;
  let textareaIndex = 0;
  while (sourceIndex < end) {
    const step = source.startsWith("\r\n", sourceIndex) ? 2 : 1;
    sourceIndex += step;
    textareaIndex += 1;
  }
  return textareaIndex;
}

export function textareaOffsetToSourceOffset(source: string, offset: number): number {
  const end = clampOffset(offset, normalizeTextareaText(source).length);
  let sourceIndex = 0;
  for (let textareaIndex = 0; textareaIndex < end; textareaIndex += 1) {
    sourceIndex += source.startsWith("\r\n", sourceIndex) ? 2 : 1;
  }
  return sourceIndex;
}

function validatedHint(previous: string, next: string, hint?: TextareaInputHint): TextareaReplacement | undefined {
  if (!hint) return undefined;
  let start = clampOffset(hint.start, previous.length);
  let end = Math.max(start, clampOffset(hint.end, previous.length));
  if (start === end) {
    if (hint.inputType === "deleteContentBackward") start = Math.max(0, start - 1);
    if (hint.inputType === "deleteContentForward") end = Math.min(previous.length, end + 1);
  }
  const prefix = previous.slice(0, start);
  const suffix = previous.slice(end);
  if (next.length < prefix.length + suffix.length ||
      !next.startsWith(prefix) || !next.endsWith(suffix)) return undefined;
  return { start, end, inserted: next.slice(prefix.length, next.length - suffix.length) };
}

export function applyTextareaTextEdit(previousSource: string, nextTextareaText: string, selectionStart: number, selectionEnd = selectionStart, hint?: TextareaInputHint): TextareaTextEdit {
  const previous = normalizeTextareaText(previousSource);
  const next = normalizeTextareaText(nextTextareaText);
  if (previous === next) {
    return {
      source: previousSource,
      sourceSelectionStart: textareaOffsetToSourceOffset(previousSource, selectionStart),
      sourceSelectionEnd: textareaOffsetToSourceOffset(previousSource, selectionEnd),
      changed: false,
    };
  }
  let edit = validatedHint(previous, next, hint);
  if (!edit) {
    let start = 0;
    while (start < previous.length && start < next.length && previous[start] === next[start]) start += 1;
    let suffixLength = 0;
    while (suffixLength < previous.length - start && suffixLength < next.length - start &&
           previous[previous.length - suffixLength - 1] === next[next.length - suffixLength - 1]) suffixLength += 1;
    edit = { start, end: previous.length - suffixLength, inserted: next.slice(start, next.length - suffixLength) };
  }
  const sourceStart = textareaOffsetToSourceOffset(previousSource, edit.start);
  const sourceEnd = textareaOffsetToSourceOffset(previousSource, edit.end);
  const source = previousSource.slice(0, sourceStart) + edit.inserted + previousSource.slice(sourceEnd);
  return {
    source,
    sourceSelectionStart: textareaOffsetToSourceOffset(source, selectionStart),
    sourceSelectionEnd: textareaOffsetToSourceOffset(source, selectionEnd),
    changed: true,
    replacement: { sourceStart, sourceEnd, inserted: edit.inserted },
  };
}
