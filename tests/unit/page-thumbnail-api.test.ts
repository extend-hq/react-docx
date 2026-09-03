import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createDocxThumbnailRenderer,
  defaultStarterModel,
  useDocxEditor,
  useDocxViewerThumbnails,
  type ParsedDocxDocument,
  type DocxViewerThumbnails,
} from "@extend-ai/react-docx";

describe("docx viewer thumbnails", () => {
  it("exposes xlsx-style paint helpers and size aliases", () => {
    let result: DocxViewerThumbnails | undefined;

    function Probe(): React.JSX.Element {
      const editor = useDocxEditor();
      result = useDocxViewerThumbnails(editor, { resolution: 200 });
      return React.createElement("div");
    }

    renderToStaticMarkup(React.createElement(Probe));

    expect(result).toBeDefined();
    expect(typeof result?.paintThumbnail).toBe("function");
    expect(result?.thumbnails).toHaveLength(1);
    expect(result?.paintThumbnail(0, null)).toBe(false);

    const thumbnail = result?.thumbnails[0];
    expect(thumbnail).toBeDefined();
    expect(typeof thumbnail?.paint).toBe("function");
    expect(thumbnail?.paint(null)).toBe(false);
    expect(thumbnail?.width).toBe(thumbnail?.widthPx);
    expect(thumbnail?.height).toBe(thumbnail?.heightPx);
    expect(thumbnail?.contentWidth).toBe(thumbnail?.sourceWidthPx);
    expect(thumbnail?.contentHeight).toBe(thumbnail?.sourceHeightPx);
    expect(thumbnail?.aspectRatio).toBeCloseTo(
      (thumbnail?.sourceWidthPx ?? 1) /
        Math.max(1, thumbnail?.sourceHeightPx ?? 1)
    );
  });

  it("accepts thumbnail queue and render-window options", () => {
    let result: DocxViewerThumbnails | undefined;

    function Probe(): React.JSX.Element {
      const editor = useDocxEditor();
      result = useDocxViewerThumbnails(editor, {
        minRasterIntervalMs: 0,
        pageIndexes: [0],
        scheduling: "immediate",
        renderWindow: {
          visiblePageIndexes: [0],
          prefetchPageIndexes: [0],
        },
      });
      return React.createElement("div");
    }

    renderToStaticMarkup(React.createElement(Probe));

    expect(result?.thumbnails).toHaveLength(1);
  });

  it("reuses a parsed document as the editor's initial model", () => {
    let text: string | undefined;
    const parsedDocument = {
      model: {
        ...defaultStarterModel,
        nodes: [
          {
            type: "paragraph" as const,
            children: [{ type: "text" as const, text: "Parsed once" }],
          },
        ],
      },
      package: {},
      source: "main-thread",
      fileName: "document.docx",
      timings: {
        fileReadMs: 0,
        parseMs: 0,
        modelConstructionMs: 0,
        fontLoadingMs: 0,
        totalMs: 0,
      },
      embeddedFontsLoaded: false,
      loadEmbeddedFonts: async () => {},
      dispose: () => {},
    } as unknown as ParsedDocxDocument;

    function Probe(): React.JSX.Element {
      const editor = useDocxEditor({
        document: parsedDocument,
        loadEmbeddedFonts: false,
      });
      const firstNode = editor.model.nodes[0];
      text = firstNode?.type === "paragraph" ? firstNode.children[0]?.text : "";
      return React.createElement("div");
    }

    renderToStaticMarkup(React.createElement(Probe));
    expect(text).toBe("Parsed once");
  });

  it("creates a page-scoped renderer without requiring a viewer mount", async () => {
    const parsedDocument = {
      model: defaultStarterModel,
      package: {},
      source: "main-thread",
      timings: {
        fileReadMs: 0,
        parseMs: 0,
        modelConstructionMs: 0,
        fontLoadingMs: 0,
        totalMs: 0,
      },
      embeddedFontsLoaded: false,
      loadEmbeddedFonts: async () => {},
      dispose: () => {},
    } as unknown as ParsedDocxDocument;
    const renderer = createDocxThumbnailRenderer(parsedDocument, {
      pageIndexes: [0],
      scheduling: "immediate",
    });

    expect(renderer.pageCount).toBe(1);
    await expect(renderer.renderPage(1)).rejects.toThrow(/out of range/i);
    renderer.dispose();
  });
});
