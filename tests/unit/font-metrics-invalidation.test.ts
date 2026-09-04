import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createZip } from "./helpers/zip";

let glyphWidth = 4;

class FontSet extends EventTarget {
  ready = Promise.resolve();
  add(): void {
    glyphWidth = 12;
  }
  delete(): boolean {
    glyphWidth = 4;
    return true;
  }
}

class MockCanvas {
  getContext() {
    return {
      font: "16px sans-serif",
      measureText: (text: string) => ({ width: text.length * glyphWidth }),
    };
  }
}

beforeEach(() => {
  vi.resetModules();
  glyphWidth = 4;
  vi.stubGlobal("OffscreenCanvas", MockCanvas);
  vi.stubGlobal("document", { fonts: new FontSet() });
  vi.stubGlobal(
    "FontFace",
    class {
      async load() {
        return this;
      }
    }
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("font measurement invalidation", () => {
  it("remeasures text after deferred embedded fonts load and after disposal", async () => {
    const { parseDocxForViewer } = await import(
      "../../packages/react-viewer/src/parsed-docx"
    );
    const {
      measurePretextPlainTextLineCount,
      layoutTextWithPretextAroundExclusions,
    } = await import("../../packages/react-viewer/src/pretext-layout");
    const source = createZip([
      {
        name: "word/document.xml",
        content:
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>',
      },
      {
        name: "word/fontTable.xml",
        content:
          '<w:fonts><w:font w:name="Embedded"><w:embedRegular r:id="font"/></w:font></w:fonts>',
      },
      {
        name: "word/_rels/fontTable.xml.rels",
        content:
          '<Relationships><Relationship Id="font" Target="fonts/regular.ttf"/></Relationships>',
      },
      { name: "word/fonts/regular.ttf", content: new Uint8Array([1, 2, 3]) },
    ]);
    const parsed = await parseDocxForViewer(source, {
      useWorker: false,
      loadEmbeddedFonts: "defer",
    });
    const text = "iiiiiiii ".repeat(30);
    const font = "16px Embedded";
    const before = measurePretextPlainTextLineCount(text, font, 200)!;
    const beforeLayout = layoutTextWithPretextAroundExclusions(
      text,
      font,
      200,
      20,
      []
    )!;
    await parsed.loadEmbeddedFonts();
    expect(measurePretextPlainTextLineCount(text, font, 200)).toBeGreaterThan(
      before
    );
    expect(
      layoutTextWithPretextAroundExclusions(text, font, 200, 20, [])!.lineCount
    ).toBeGreaterThan(beforeLayout.lineCount);
    parsed.dispose();
    expect(measurePretextPlainTextLineCount(text, font, 200)).toBe(before);
    expect(
      layoutTextWithPretextAroundExclusions(text, font, 200, 20, [])!.lineCount
    ).toBe(beforeLayout.lineCount);
  });

  it("notifies mounted viewers after clearing caches when fonts finish loading", async () => {
    const { measurePretextPlainTextLineCount } = await import(
      "../../packages/react-viewer/src/pretext-layout"
    );
    const { getFontMetricsRevision, subscribeFontMetrics } = await import(
      "../../packages/react-viewer/src/font-metrics"
    );
    const measure = () =>
      measurePretextPlainTextLineCount(
        "iiiiiiii ".repeat(30),
        "16px Embedded",
        200
      )!;
    const before = measure();
    const revision = getFontMetricsRevision();
    const onChange = vi.fn(() => expect(measure()).toBeGreaterThan(before));
    const unsubscribe = subscribeFontMetrics(onChange);
    glyphWidth = 12;
    document.fonts.dispatchEvent(new Event("loadingdone"));
    expect(onChange).toHaveBeenCalledOnce();
    expect(getFontMetricsRevision()).toBe(revision + 1);
    unsubscribe();
    document.fonts.dispatchEvent(new Event("loadingdone"));
    expect(onChange).toHaveBeenCalledOnce();
  });
});
