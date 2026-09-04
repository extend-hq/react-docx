import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DocModel, TextStyle } from "../../packages/doc-model/src";
import { ReactDocxViewer } from "../../packages/react-viewer/src";
import {
  DocxEditorViewer,
  defaultStarterModel,
  useDocxEditor,
} from "../../packages/react-viewer/src/editor";
import {
  classifyDocxFontScript,
  resolveDocxTextFontFamily,
  segmentTextByDocxScriptFont,
} from "../../packages/react-viewer/src/script-fonts";

const SCRIPT_STYLE: TextStyle = {
  fontFamily: "ASCII Face",
  sourceFontFamily: "ASCII Face",
  fontFamilyAscii: "ASCII Face",
  fontFamilyHAnsi: "High ANSI Face",
  fontFamilyEastAsia: "East Asia Face",
  fontFamilyCs: "Complex Script Face",
  language: "en-US",
  languageEastAsia: "ja-JP",
  languageBidi: "ar-SA",
};

function mixedScriptModel(): DocModel {
  return {
    ...defaultStarterModel,
    nodes: [
      {
        type: "paragraph",
        children: [
          {
            type: "text",
            text: "Aé日ع",
            style: SCRIPT_STYLE,
          },
        ],
      },
    ],
  };
}

function EditorProbe({ model }: { model: DocModel }): React.JSX.Element {
  const editor = useDocxEditor({ starterModel: model });
  return React.createElement(DocxEditorViewer, {
    editor,
    mode: "read-only",
    deferInitialPaginationPaint: false,
  });
}

describe("DOCX script font rendering", () => {
  it("resolves the first available font without changing mixed-script behavior", () => {
    for (const text of ["", "A\u00a0text", "—日A", "—é日ع", "😀", "\u00a0", "עִברִית", "\tLatin\n", "عA"]) {
      for (const style of [undefined, SCRIPT_STYLE, { fontFamilyEastAsia: "East Asia Face" }, { ...SCRIPT_STYLE, complexScript: true }, { ...SCRIPT_STYLE, rightToLeft: true, complexScript: false }]) {
        expect(resolveDocxTextFontFamily(text, style)).toBe(
          segmentTextByDocxScriptFont(text, style).find((segment) => segment.fontFamily)?.fontFamily ?? style?.fontFamily
        );
      }
    }
  });

  it("preserves ASCII controls and explicit complex-script overrides", () => {
    const text = "Latin\ttext\n123";
    for (const complexScript of [true, false]) {
      const script = complexScript ? "complexScript" : "ascii";
      const fontFamily = complexScript ? "Complex Script Face" : "ASCII Face";
      expect(
        segmentTextByDocxScriptFont(text, {
          ...SCRIPT_STYLE,
          rightToLeft: true,
          complexScript,
        })
      ).toEqual([
        { text, startOffset: 0, endOffset: text.length, script, fontFamily },
      ]);
    }
  });

  it("merges equivalent families without changing Unicode text or offsets", () => {
    const text = "Aé日😀";
    expect(
      segmentTextByDocxScriptFont(text, {
        ...SCRIPT_STYLE,
        fontFamilyAscii: " Shared Face ",
        fontFamilyHAnsi: '"shared face"',
        fontFamilyEastAsia: "'SHARED FACE'",
      })
    ).toEqual([
      {
        text,
        startOffset: 0,
        endOffset: text.length,
        script: "ascii",
        fontFamily: "Shared Face",
      },
    ]);
  });

  it("classifies and segments mixed Unicode text by OOXML font slot", () => {
    expect(classifyDocxFontScript("A", SCRIPT_STYLE)).toBe("ascii");
    expect(classifyDocxFontScript("é", SCRIPT_STYLE)).toBe("highAnsi");
    expect(classifyDocxFontScript("日", SCRIPT_STYLE)).toBe("eastAsia");
    expect(classifyDocxFontScript("ع", SCRIPT_STYLE)).toBe("complexScript");

    expect(
      segmentTextByDocxScriptFont("Aé日ع", SCRIPT_STYLE).map((segment) => [
        segment.text,
        segment.fontFamily,
        segment.startOffset,
        segment.endOffset,
      ])
    ).toEqual([
      ["A", "ASCII Face", 0, 1],
      ["é", "High ANSI Face", 1, 2],
      ["日", "East Asia Face", 2, 3],
      ["ع", "Complex Script Face", 3, 4],
    ]);
  });

  it("uses hints for neutral text and complex-script flags for RTL runs", () => {
    expect(
      segmentTextByDocxScriptFont("—", {
        ...SCRIPT_STYLE,
        fontHint: "eastAsia",
      })[0]?.fontFamily
    ).toBe("East Asia Face");
    expect(
      segmentTextByDocxScriptFont("Latin", {
        ...SCRIPT_STYLE,
        rightToLeft: true,
      })[0]?.fontFamily
    ).toBe("Complex Script Face");
  });

  it("keeps a later legacy fontFamily edit authoritative over imported slots", () => {
    const segments = segmentTextByDocxScriptFont("Aé日ع", {
      ...SCRIPT_STYLE,
      fontFamily: "Replacement Face",
    });

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      text: "Aé日ع",
      fontFamily: "Replacement Face",
    });
  });

  it("renders distinct script fonts in both viewer surfaces without changing text", () => {
    const model = mixedScriptModel();
    const simpleHtml = renderToStaticMarkup(
      React.createElement(ReactDocxViewer, { model })
    );
    const editorHtml = renderToStaticMarkup(
      React.createElement(EditorProbe, { model })
    );

    for (const html of [simpleHtml, editorHtml]) {
      expect(html).toContain("ASCII Face");
      expect(html).toContain("High ANSI Face");
      expect(html).toContain("East Asia Face");
      expect(html).toContain("Complex Script Face");
      expect(html.replace(/<[^>]+>/g, "")).toContain("Aé日ع");
    }
  });
});
