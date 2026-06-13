import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  useDocxEditor,
  useDocxViewerThumbnails,
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
      (thumbnail?.sourceWidthPx ?? 1) / Math.max(1, thumbnail?.sourceHeightPx ?? 1)
    );
  });

  it("accepts thumbnail queue and render-window options", () => {
    let result: DocxViewerThumbnails | undefined;

    function Probe(): React.JSX.Element {
      const editor = useDocxEditor();
      result = useDocxViewerThumbnails(editor, {
        minRasterIntervalMs: 0,
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
});
