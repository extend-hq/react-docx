import { describe, expect, it } from "vitest";
import {
  applyTextEditingIntent,
  editingIntentCoalesceClass,
  mergeCellParagraphTexts,
  resolveEditingIntent,
  shouldCoalesceTextCommit,
  type EditingIntent
} from "../../packages/react-viewer/src/editing-intents";

describe("resolveEditingIntent", () => {
  it("maps plain typing to insertText with the event data", () => {
    expect(
      resolveEditingIntent({ inputType: "insertText", data: "a" })
    ).toEqual({ kind: "insertText", text: "a" });
  });

  it("maps yank and paste-as-quotation onto insertText", () => {
    expect(
      resolveEditingIntent({ inputType: "insertFromYank", data: "yanked" })
    ).toEqual({ kind: "insertText", text: "yanked" });
    expect(
      resolveEditingIntent({
        inputType: "insertFromPasteAsQuotation",
        data: "quoted"
      })
    ).toEqual({ kind: "insertText", text: "quoted" });
  });

  it("prefers dataTransfer text for paste and drop", () => {
    expect(
      resolveEditingIntent({
        inputType: "insertFromPaste",
        data: null,
        dataTransferText: "pasted"
      })
    ).toEqual({ kind: "insertText", text: "pasted" });
    expect(
      resolveEditingIntent({
        inputType: "insertFromDrop",
        dataTransferText: "dropped"
      })
    ).toEqual({ kind: "insertText", text: "dropped" });
  });

  it("maps autocorrect and transpose onto replaceText", () => {
    expect(
      resolveEditingIntent({
        inputType: "insertReplacementText",
        data: "corrected"
      })
    ).toEqual({ kind: "replaceText", text: "corrected" });
    expect(
      resolveEditingIntent({ inputType: "insertTranspose", data: "ba" })
    ).toEqual({ kind: "replaceText", text: "ba" });
  });

  it("maps paragraph and line break inserts", () => {
    expect(resolveEditingIntent({ inputType: "insertParagraph" })).toEqual({
      kind: "insertParagraph"
    });
    expect(resolveEditingIntent({ inputType: "insertLineBreak" })).toEqual({
      kind: "insertLineBreak"
    });
  });

  it("maps the delete family onto directional units", () => {
    expect(
      resolveEditingIntent({ inputType: "deleteContentBackward" })
    ).toEqual({ kind: "deleteContent", direction: "backward", unit: "character" });
    expect(resolveEditingIntent({ inputType: "deleteContentForward" })).toEqual(
      { kind: "deleteContent", direction: "forward", unit: "character" }
    );
    expect(resolveEditingIntent({ inputType: "deleteWordBackward" })).toEqual({
      kind: "deleteContent",
      direction: "backward",
      unit: "word"
    });
    expect(resolveEditingIntent({ inputType: "deleteWordForward" })).toEqual({
      kind: "deleteContent",
      direction: "forward",
      unit: "word"
    });
    expect(
      resolveEditingIntent({ inputType: "deleteSoftLineBackward" })
    ).toEqual({ kind: "deleteContent", direction: "backward", unit: "line" });
    expect(
      resolveEditingIntent({ inputType: "deleteHardLineBackward" })
    ).toEqual({ kind: "deleteContent", direction: "backward", unit: "line" });
    expect(
      resolveEditingIntent({ inputType: "deleteSoftLineForward" })
    ).toEqual({ kind: "deleteContent", direction: "forward", unit: "line" });
    expect(
      resolveEditingIntent({ inputType: "deleteHardLineForward" })
    ).toEqual({ kind: "deleteContent", direction: "forward", unit: "line" });
    expect(resolveEditingIntent({ inputType: "deleteEntireSoftLine" })).toEqual(
      { kind: "deleteContent", direction: "backward", unit: "entire-line" }
    );
  });

  it("maps cut, drag deletion, and generic deleteContent onto deleteRange", () => {
    expect(resolveEditingIntent({ inputType: "deleteByCut" })).toEqual({
      kind: "deleteRange"
    });
    expect(resolveEditingIntent({ inputType: "deleteByDrag" })).toEqual({
      kind: "deleteRange"
    });
    expect(resolveEditingIntent({ inputType: "deleteContent" })).toEqual({
      kind: "deleteRange"
    });
  });

  it("maps history inputTypes", () => {
    expect(resolveEditingIntent({ inputType: "historyUndo" })).toEqual({
      kind: "historyUndo"
    });
    expect(resolveEditingIntent({ inputType: "historyRedo" })).toEqual({
      kind: "historyRedo"
    });
  });

  it("leaves composition input to the browser", () => {
    expect(
      resolveEditingIntent({ inputType: "insertCompositionText", data: "あ" })
    ).toBeUndefined();
    expect(
      resolveEditingIntent({ inputType: "deleteCompositionText" })
    ).toBeUndefined();
  });

  it("blocks unrecognized mutating inputTypes", () => {
    expect(resolveEditingIntent({ inputType: "formatBold" })).toEqual({
      kind: "blocked"
    });
    expect(resolveEditingIntent({ inputType: "insertHorizontalRule" })).toEqual(
      { kind: "blocked" }
    );
    expect(resolveEditingIntent({ inputType: "" })).toEqual({
      kind: "blocked"
    });
  });
});

describe("editingIntentCoalesceClass", () => {
  it("groups inserts and deletes into separate burst classes", () => {
    expect(
      editingIntentCoalesceClass({ kind: "insertText", text: "a" })
    ).toBe("insert");
    expect(editingIntentCoalesceClass({ kind: "insertLineBreak" })).toBe(
      "insert"
    );
    expect(
      editingIntentCoalesceClass({ kind: "replaceText", text: "x" })
    ).toBe("insert");
    expect(
      editingIntentCoalesceClass({
        kind: "deleteContent",
        direction: "backward",
        unit: "character"
      })
    ).toBe("delete");
    expect(editingIntentCoalesceClass({ kind: "deleteRange" })).toBe("delete");
  });

  it("has no class for structural or history intents", () => {
    expect(
      editingIntentCoalesceClass({ kind: "insertParagraph" })
    ).toBeUndefined();
    expect(editingIntentCoalesceClass({ kind: "historyUndo" })).toBeUndefined();
    expect(editingIntentCoalesceClass({ kind: "blocked" })).toBeUndefined();
  });
});

describe("applyTextEditingIntent", () => {
  const insert = (text: string): EditingIntent => ({
    kind: "insertText",
    text
  });
  const del = (
    direction: "backward" | "forward",
    unit: "character" | "word" | "line" | "entire-line" = "character"
  ): EditingIntent => ({ kind: "deleteContent", direction, unit });

  it("inserts text at a collapsed caret", () => {
    expect(applyTextEditingIntent("hello", 5, 5, insert("!"))).toEqual({
      text: "hello!",
      caret: 6
    });
    expect(applyTextEditingIntent("hello", 0, 0, insert("ab"))).toEqual({
      text: "abhello",
      caret: 2
    });
  });

  it("replaces an expanded selection on insert", () => {
    expect(applyTextEditingIntent("hello world", 6, 11, insert("there"))).toEqual({
      text: "hello there",
      caret: 11
    });
  });

  it("normalizes carriage returns in inserted text", () => {
    expect(applyTextEditingIntent("ab", 1, 1, insert("x\r\ny"))).toEqual({
      text: "ax\nyb",
      caret: 4
    });
  });

  it("treats an empty insert into a collapsed caret as a no-op", () => {
    expect(applyTextEditingIntent("abc", 1, 1, insert(""))).toBeUndefined();
  });

  it("deletes an expanded selection with an empty insert", () => {
    expect(applyTextEditingIntent("abc", 1, 2, insert(""))).toEqual({
      text: "ac",
      caret: 1
    });
  });

  it("inserts a line break", () => {
    expect(
      applyTextEditingIntent("ab", 1, 1, { kind: "insertLineBreak" })
    ).toEqual({ text: "a\nb", caret: 2 });
  });

  it("applies replacement text over the provided range", () => {
    expect(
      applyTextEditingIntent("teh cat", 0, 3, {
        kind: "replaceText",
        text: "the"
      })
    ).toEqual({ text: "the cat", caret: 3 });
  });

  it("deletes a single character backward", () => {
    expect(applyTextEditingIntent("abc", 2, 2, del("backward"))).toEqual({
      text: "ac",
      caret: 1
    });
  });

  it("deletes a full surrogate pair backward", () => {
    const text = "a\u{1F600}b";
    expect(applyTextEditingIntent(text, 3, 3, del("backward"))).toEqual({
      text: "ab",
      caret: 1
    });
  });

  it("deletes a single character forward", () => {
    expect(applyTextEditingIntent("abc", 1, 1, del("forward"))).toEqual({
      text: "ac",
      caret: 1
    });
  });

  it("deletes a full surrogate pair forward", () => {
    const text = "a\u{1F600}b";
    expect(applyTextEditingIntent(text, 1, 1, del("forward"))).toEqual({
      text: "ab",
      caret: 1
    });
  });

  it("returns undefined for boundary deletes that cross paragraphs", () => {
    expect(applyTextEditingIntent("abc", 0, 0, del("backward"))).toBeUndefined();
    expect(applyTextEditingIntent("abc", 3, 3, del("forward"))).toBeUndefined();
    expect(
      applyTextEditingIntent("abc", 0, 0, del("backward", "word"))
    ).toBeUndefined();
    expect(
      applyTextEditingIntent("abc", 3, 3, del("forward", "word"))
    ).toBeUndefined();
  });

  it("deletes the previous word including trailing whitespace", () => {
    expect(
      applyTextEditingIntent("foo bar", 7, 7, del("backward", "word"))
    ).toEqual({ text: "foo ", caret: 4 });
    expect(
      applyTextEditingIntent("foo bar ", 8, 8, del("backward", "word"))
    ).toEqual({ text: "foo ", caret: 4 });
  });

  it("deletes the next word including leading whitespace", () => {
    expect(
      applyTextEditingIntent("foo bar", 3, 3, del("forward", "word"))
    ).toEqual({ text: "foo", caret: 3 });
    expect(
      applyTextEditingIntent("foo  bar baz", 3, 3, del("forward", "word"))
    ).toEqual({ text: "foo baz", caret: 3 });
  });

  it("deletes to the start and end of the current line", () => {
    expect(
      applyTextEditingIntent("one\ntwo three", 8, 8, del("backward", "line"))
    ).toEqual({ text: "one\nthree", caret: 4 });
    expect(
      applyTextEditingIntent("one two\nthree", 3, 3, del("forward", "line"))
    ).toEqual({ text: "one\nthree", caret: 3 });
  });

  it("deletes the line separator when the caret touches it", () => {
    expect(
      applyTextEditingIntent("one\ntwo", 3, 3, del("forward", "line"))
    ).toEqual({ text: "onetwo", caret: 3 });
  });

  it("deletes the entire current line", () => {
    expect(
      applyTextEditingIntent(
        "one\ntwo\nthree",
        5,
        5,
        del("backward", "entire-line")
      )
    ).toEqual({ text: "one\n\nthree", caret: 4 });
    expect(
      applyTextEditingIntent("one", 2, 2, del("backward", "entire-line"))
    ).toEqual({ text: "", caret: 0 });
  });

  it("collapses an expanded selection for any delete unit", () => {
    expect(
      applyTextEditingIntent("abcdef", 1, 4, del("backward", "word"))
    ).toEqual({ text: "aef", caret: 1 });
    expect(applyTextEditingIntent("abcdef", 1, 4, del("forward"))).toEqual({
      text: "aef",
      caret: 1
    });
  });

  it("deletes the selected range for deleteRange and no-ops when collapsed", () => {
    expect(
      applyTextEditingIntent("abcdef", 2, 5, { kind: "deleteRange" })
    ).toEqual({ text: "abf", caret: 2 });
    expect(
      applyTextEditingIntent("abcdef", 2, 2, { kind: "deleteRange" })
    ).toBeUndefined();
  });

  it("clamps out-of-range selection offsets", () => {
    expect(applyTextEditingIntent("abc", -2, 99, insert("x"))).toEqual({
      text: "x",
      caret: 1
    });
    expect(applyTextEditingIntent("abc", 99, 99, insert("x"))).toEqual({
      text: "abcx",
      caret: 4
    });
  });

  it("returns undefined for structural intents", () => {
    expect(
      applyTextEditingIntent("abc", 1, 1, { kind: "insertParagraph" })
    ).toBeUndefined();
    expect(
      applyTextEditingIntent("abc", 1, 1, { kind: "historyUndo" })
    ).toBeUndefined();
    expect(
      applyTextEditingIntent("abc", 1, 1, { kind: "blocked" })
    ).toBeUndefined();
  });
});

describe("shouldCoalesceTextCommit", () => {
  const burst = { key: "p:3:insert", caretAfter: 5, at: 1000 };

  it("coalesces a continuous same-key burst", () => {
    expect(
      shouldCoalesceTextCommit(burst, {
        key: "p:3:insert",
        caretBefore: 5,
        at: 1400
      })
    ).toBe(true);
  });

  it("does not coalesce without a previous burst", () => {
    expect(
      shouldCoalesceTextCommit(undefined, {
        key: "p:3:insert",
        caretBefore: 5,
        at: 1400
      })
    ).toBe(false);
  });

  it("breaks the burst when the paragraph or intent class changes", () => {
    expect(
      shouldCoalesceTextCommit(burst, {
        key: "p:4:insert",
        caretBefore: 5,
        at: 1400
      })
    ).toBe(false);
    expect(
      shouldCoalesceTextCommit(burst, {
        key: "p:3:delete",
        caretBefore: 5,
        at: 1400
      })
    ).toBe(false);
  });

  it("breaks the burst when the caret moved between commits", () => {
    expect(
      shouldCoalesceTextCommit(burst, {
        key: "p:3:insert",
        caretBefore: 2,
        at: 1400
      })
    ).toBe(false);
  });

  it("breaks the burst after the pause window", () => {
    expect(
      shouldCoalesceTextCommit(burst, {
        key: "p:3:insert",
        caretBefore: 5,
        at: 2100
      })
    ).toBe(false);
    expect(
      shouldCoalesceTextCommit(
        burst,
        { key: "p:3:insert", caretBefore: 5, at: 1800 },
        500
      )
    ).toBe(false);
  });

  it("never coalesces backwards in time", () => {
    expect(
      shouldCoalesceTextCommit(burst, {
        key: "p:3:insert",
        caretBefore: 5,
        at: 900
      })
    ).toBe(false);
  });
});

describe("mergeCellParagraphTexts", () => {
  it("merges a paragraph into its predecessor and places the caret at the seam", () => {
    expect(mergeCellParagraphTexts(["alpha", "beta"], 1)).toEqual({
      cellText: "alphabeta",
      caretParagraphIndex: 0,
      caretOffset: 5
    });
  });

  it("keeps later paragraphs intact", () => {
    expect(mergeCellParagraphTexts(["a", "b", "c"], 1)).toEqual({
      cellText: "ab\nc",
      caretParagraphIndex: 0,
      caretOffset: 1
    });
    expect(mergeCellParagraphTexts(["a", "b", "c"], 2)).toEqual({
      cellText: "a\nbc",
      caretParagraphIndex: 1,
      caretOffset: 1
    });
  });

  it("resolves the caret against the re-split paragraph list when texts contain line breaks", () => {
    // "one\ntwo" re-splits into two paragraphs; the seam lands at the end of
    // what becomes the second paragraph.
    expect(mergeCellParagraphTexts(["one\ntwo", "three"], 1)).toEqual({
      cellText: "one\ntwothree",
      caretParagraphIndex: 1,
      caretOffset: 3
    });
  });

  it("merges empty paragraphs", () => {
    expect(mergeCellParagraphTexts(["", "b"], 1)).toEqual({
      cellText: "b",
      caretParagraphIndex: 0,
      caretOffset: 0
    });
    expect(mergeCellParagraphTexts(["a", ""], 1)).toEqual({
      cellText: "a",
      caretParagraphIndex: 0,
      caretOffset: 1
    });
  });

  it("rejects out-of-range boundaries", () => {
    expect(mergeCellParagraphTexts(["a", "b"], 0)).toBeUndefined();
    expect(mergeCellParagraphTexts(["a", "b"], 2)).toBeUndefined();
    expect(mergeCellParagraphTexts([], 1)).toBeUndefined();
  });
});
