import { describe, expect, it } from "vitest";
import {
  normalizeViewerZoomLevel,
  resolveViewerZoom,
  VIEWER_ZOOM_MAX,
  VIEWER_ZOOM_MIN,
} from "../../packages/react-viewer/src/viewer-zoom";
import {
  normalizeFloatingDragDeltaForZoom,
  normalizeFloatingDropRectForZoom,
} from "../../packages/react-viewer/src/editor";

describe("viewer zoom", () => {
  const page = { contentWidth: 800, contentHeight: 1000 };

  it.each([
    ["fit-width", 1200, 900, 150],
    ["fit-width", 400, 900, VIEWER_ZOOM_MIN],
    ["fit-page", 1200, 600, 60],
    ["fit-page", 400, 400, VIEWER_ZOOM_MIN],
    ["automatic", 1200, 900, 100],
    ["automatic", 640, 900, 80],
  ] as const)(
    "resolves %s in a %d by %d viewport",
    (level, viewportWidth, viewportHeight, expected) => {
      expect(
        resolveViewerZoom(level, {
          ...page,
          viewportWidth,
          viewportHeight,
        })
      ).toBe(expected);
    }
  );

  it("recalculates a responsive mode without replacing the selected level", () => {
    const level = "fit-width" as const;
    const wide = resolveViewerZoom(level, {
      ...page,
      viewportWidth: 1200,
      viewportHeight: 900,
    });
    const narrow = resolveViewerZoom(level, {
      ...page,
      viewportWidth: 600,
      viewportHeight: 900,
    });

    expect(level).toBe("fit-width");
    expect(wide).toBe(150);
    expect(narrow).toBe(75);
  });

  it("clamps numeric and responsive percentages to supported bounds", () => {
    expect(normalizeViewerZoomLevel(10)).toBe(VIEWER_ZOOM_MIN);
    expect(normalizeViewerZoomLevel(900)).toBe(VIEWER_ZOOM_MAX);
    expect(
      resolveViewerZoom("fit-width", {
        ...page,
        viewportWidth: 10000,
        viewportHeight: 10000,
      })
    ).toBe(VIEWER_ZOOM_MAX);
  });

  it("switches from a responsive resolution to a clamped numeric level", () => {
    const resolved = resolveViewerZoom("fit-width", {
      ...page,
      viewportWidth: 720,
      viewportHeight: 900,
    });
    const numeric = normalizeViewerZoomLevel(resolved + 10);

    expect(resolved).toBe(90);
    expect(numeric).toBe(100);
    expect(resolveViewerZoom(numeric, { ...page, viewportWidth: 400, viewportHeight: 400 })).toBe(100);
  });

  it("normalizes pointer deltas and hit-test rectangles with the resolved scale", () => {
    const scale =
      resolveViewerZoom("fit-width", {
        ...page,
        viewportWidth: 600,
        viewportHeight: 900,
      }) / 100;

    expect(normalizeFloatingDragDeltaForZoom(75, scale)).toBe(100);
    expect(normalizeFloatingDragDeltaForZoom(-30, scale)).toBe(-40);
    expect(
      normalizeFloatingDropRectForZoom(
        { left: 75, top: 150, width: 300, height: 450 },
        scale
      )
    ).toEqual({ left: 100, top: 200, width: 400, height: 600 });
  });
});
