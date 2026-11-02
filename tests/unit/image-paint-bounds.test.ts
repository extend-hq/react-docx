import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { resolveImagePaintBounds } from "../../packages/doc-model/src/image-paint";
import { cloneParagraphNode } from "../../packages/doc-model/src/clone";
import type { ImageRunNode } from "../../packages/doc-model/src/types";
import { PaintBoundsImage } from "../../packages/react-viewer/src/paint-bounds-image";

const image = (): ImageRunNode => ({
  type: "image", widthPx: 360, heightPx: 140, src: "data:image/svg+xml,%3Csvg/%3E",
  paintBounds: { xPx: -0.5, yPx: -2, widthPx: 361, heightPx: 144, layoutWidthPx: 360, layoutHeightPx: 140 },
});

describe("image paint allocation", () => {
  it("scales offsets and extents independently of the logical frame", () => {
    const run = image();
    expect(resolveImagePaintBounds(run)).toEqual({ xPx: -0.5, yPx: -2, widthPx: 361, heightPx: 144 });
    expect(resolveImagePaintBounds(run, 720, 70)).toEqual({ xPx: -1, yPx: -1, widthPx: 722, heightPx: 72 });
    expect(run).toMatchObject({ widthPx: 360, heightPx: 140, paintBounds: { layoutWidthPx: 360, layoutHeightPx: 140 } });
  });
  it.each(["xPx", "yPx", "widthPx", "heightPx", "layoutWidthPx", "layoutHeightPx"] as const)("rejects nonfinite %s", (field) => {
    const run = image(); run.paintBounds![field] = Number.POSITIVE_INFINITY;
    expect(resolveImagePaintBounds(run)).toBeUndefined();
  });
  it.each(["widthPx", "heightPx", "layoutWidthPx", "layoutHeightPx"] as const)("rejects nonpositive %s", (field) => {
    const run = image(); run.paintBounds![field] = 0;
    expect(resolveImagePaintBounds(run)).toBeUndefined();
  });
  it("rejects invalid current dimensions and overflow without mutating geometry", () => {
    expect(resolveImagePaintBounds(image(), Number.MAX_VALUE, 140)).toBeUndefined();
    expect(resolveImagePaintBounds(image(), 0, 140)).toBeUndefined();
    expect(resolveImagePaintBounds({ widthPx: 360, heightPx: 140 })).toBeUndefined();
  });
  it("deep copies paint metadata during paragraph cloning", () => {
    const run = image();
    const copy = cloneParagraphNode({ type: "paragraph", children: [run] }).children[0] as ImageRunNode;
    expect(copy.paintBounds).toEqual(run.paintBounds);
    expect(copy.paintBounds).not.toBe(run.paintBounds);
    copy.paintBounds!.xPx = -9;
    expect(run.paintBounds!.xPx).toBe(-0.5);
  });
  it("keeps a logical wrapper with an overflowing proportional paint image", () => {
    const markup = renderToStaticMarkup(React.createElement(PaintBoundsImage, { image: image(), src: image().src, widthPx: 720, heightPx: 70 }));
    expect(markup).toContain('data-docx-image-paint-frame="true"');
    expect(markup).toContain('width:720px;height:auto;aspect-ratio:720 / 70;position:relative;overflow:visible');
    expect(markup).toContain('position:absolute;left:-0.1388888888888889%;top:-1.4285714285714286%;width:361px;height:144px;transform:scale(2, 0.5);transform-origin:top left');
  });
  it.each([0.5, 2])("scales the reference paint output at %sx without changing its SVG viewport", (scale) => {
    const run = image();
    const markup = renderToStaticMarkup(React.createElement(PaintBoundsImage, {
      image: run, src: run.src, widthPx: 360 * scale, heightPx: 140 * scale,
    }));
    expect(markup).toContain(`width:361px;height:144px;transform:scale(${scale}, ${scale})`);
    expect(markup).toContain('left:-0.1388888888888889%');
    expect(run.src).toBe(image().src);
  });
  it("retains a sized inline wrapper when optional presentation styles are absent", () => {
    const markup = renderToStaticMarkup(React.createElement(PaintBoundsImage, {
      image: image(), src: image().src, style: { display: undefined, width: undefined, height: undefined, maxWidth: "100%" },
    }));
    const frameStyle = /^<span[^>]*style="([^"]*)"/.exec(markup)?.[1];
    expect(frameStyle).toBeDefined();
    const properties = Object.fromEntries(frameStyle!.split(";").map((entry) => {
      const colon = entry.indexOf(":");
      return [entry.slice(0, colon), entry.slice(colon + 1)];
    }));
    expect(properties).toEqual({
      display: "inline-block", width: "360px", height: "auto", "max-width": "100%",
      "aspect-ratio": "360 / 140", position: "relative", overflow: "visible",
    });
  });
  it("preserves the original image element when no paint metadata exists", () => {
    const run = image(); delete run.paintBounds;
    const markup = renderToStaticMarkup(React.createElement(PaintBoundsImage, { image: run, src: run.src, style: { width: 360, height: 140 } }));
    expect(markup).not.toContain("data-docx-image-paint-frame");
    expect(markup).toContain('style="width:360px;height:140px"');
  });
});
