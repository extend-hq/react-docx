import * as React from "react";

export type ViewerZoomMode = "automatic" | "fit-page" | "fit-width";
export type ViewerZoomLevel = number | ViewerZoomMode;

export type ViewerZoomState = {
  level: ViewerZoomLevel;
  resolvedZoom: number;
};

export const VIEWER_ZOOM_MIN = 50;
export const VIEWER_ZOOM_MAX = 200;

export interface ViewerZoomDimensions {
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;
  contentHeight: number;
}

export function normalizeViewerZoomLevel(
  level: ViewerZoomLevel
): ViewerZoomLevel {
  if (typeof level !== "number") {
    return level;
  }
  if (!Number.isFinite(level)) {
    return 100;
  }
  return Math.max(VIEWER_ZOOM_MIN, Math.min(VIEWER_ZOOM_MAX, level));
}

export function resolveViewerZoom(
  level: ViewerZoomLevel,
  dimensions: ViewerZoomDimensions
): number {
  const normalizedLevel = normalizeViewerZoomLevel(level);
  if (typeof normalizedLevel === "number") {
    return normalizedLevel;
  }

  const safeContentWidth = Math.max(1, dimensions.contentWidth);
  const safeContentHeight = Math.max(1, dimensions.contentHeight);
  const fitWidth = (Math.max(1, dimensions.viewportWidth) / safeContentWidth) * 100;
  const fitHeight =
    (Math.max(1, dimensions.viewportHeight) / safeContentHeight) * 100;
  const resolved =
    normalizedLevel === "fit-page"
      ? Math.min(fitWidth, fitHeight)
      : normalizedLevel === "automatic"
        ? Math.min(fitWidth, 100)
        : fitWidth;

  return Math.max(
    VIEWER_ZOOM_MIN,
    Math.min(VIEWER_ZOOM_MAX, resolved)
  );
}

export interface ViewerZoomBridge {
  setZoom(level: ViewerZoomLevel): void;
  getZoom(): ViewerZoomLevel;
  getResolvedZoom(): number;
}

interface UseViewerZoomOptions {
  zoom?: ViewerZoomLevel;
  defaultZoom?: ViewerZoomLevel;
  onZoomChange?: (state: ViewerZoomState) => void;
  rootRef: React.RefObject<HTMLElement | null>;
  contentWidth: number;
  contentHeight: number;
  pageSelector: string;
  onBridgeChange?: (bridge?: ViewerZoomBridge) => void;
}

interface ViewerAnchor {
  pageIndex: string;
  progress: number;
}

function isWindowScroller(element: HTMLElement): boolean {
  return (
    element === document.documentElement ||
    element === document.body ||
    element === document.scrollingElement
  );
}

function nearestScrollableAncestor(element: HTMLElement): HTMLElement {
  let current = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    if (/(auto|scroll|overlay|hidden)/.test(`${style.overflow} ${style.overflowY}`)) {
      return current;
    }
    current = current.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

function elementPadding(element: HTMLElement): {
  horizontal: number;
  vertical: number;
} {
  const style = window.getComputedStyle(element);
  const number = (value: string): number => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    horizontal: number(style.paddingLeft) + number(style.paddingRight),
    vertical: number(style.paddingTop) + number(style.paddingBottom),
  };
}

function viewportRect(scroller: HTMLElement): { top: number; bottom: number } {
  if (isWindowScroller(scroller)) {
    return { top: 0, bottom: window.innerHeight };
  }
  const rect = scroller.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom };
}

function captureAnchor(
  root: HTMLElement,
  scroller: HTMLElement,
  pageSelector: string
): ViewerAnchor | undefined {
  const viewport = viewportRect(scroller);
  let best: { element: HTMLElement; visible: number } | undefined;
  root.querySelectorAll<HTMLElement>(pageSelector).forEach((element) => {
    const rect = element.getBoundingClientRect();
    const visible = Math.max(
      0,
      Math.min(rect.bottom, viewport.bottom) - Math.max(rect.top, viewport.top)
    );
    if (!best || visible > best.visible) {
      best = { element, visible };
    }
  });
  if (!best || best.visible <= 0) {
    return undefined;
  }
  const element = best.element;
  const rect = element.getBoundingClientRect();
  const pageIndex =
    element.dataset.docxPageIndex ?? element.dataset.pageIndex ?? element.dataset.page;
  if (!pageIndex || rect.height <= 0) {
    return undefined;
  }
  return {
    pageIndex,
    progress: Math.max(0, Math.min(1, (viewport.top - rect.top) / rect.height)),
  };
}

function restoreAnchor(
  root: HTMLElement,
  scroller: HTMLElement,
  pageSelector: string,
  anchor: ViewerAnchor
): void {
  const page = Array.from(root.querySelectorAll<HTMLElement>(pageSelector)).find(
    (element) =>
      (element.dataset.docxPageIndex ??
        element.dataset.pageIndex ??
        element.dataset.page) === anchor.pageIndex
  );
  if (!page) {
    return;
  }
  const viewport = viewportRect(scroller);
  const rect = page.getBoundingClientRect();
  const desiredTop = viewport.top - anchor.progress * rect.height;
  const delta = rect.top - desiredTop;
  if (Math.abs(delta) < 0.5) {
    return;
  }
  if (isWindowScroller(scroller)) {
    window.scrollBy(0, delta);
  } else {
    scroller.scrollTop += delta;
  }
}

export function useViewerZoom({
  zoom,
  defaultZoom = 100,
  onZoomChange,
  rootRef,
  contentWidth,
  contentHeight,
  pageSelector,
  onBridgeChange,
}: UseViewerZoomOptions): ViewerZoomState {
  const controlled = zoom !== undefined;
  const [uncontrolledLevel, setUncontrolledLevel] = React.useState<ViewerZoomLevel>(
    () => normalizeViewerZoomLevel(defaultZoom)
  );
  const level = normalizeViewerZoomLevel(controlled ? zoom : uncontrolledLevel);
  const levelRef = React.useRef(level);
  levelRef.current = level;
  const [resolvedZoom, setResolvedZoom] = React.useState(() =>
    typeof level === "number" ? level : 100
  );
  const resolvedZoomRef = React.useRef(resolvedZoom);
  resolvedZoomRef.current = resolvedZoom;
  const onZoomChangeRef = React.useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;
  const controlledRef = React.useRef(controlled);
  controlledRef.current = controlled;
  const dimensionsRef = React.useRef<ViewerZoomDimensions | undefined>(
    undefined
  );
  const pendingAnchorRef = React.useRef<ViewerAnchor | undefined>(undefined);
  const scrollerRef = React.useRef<HTMLElement | undefined>(undefined);
  const lastEmittedRef = React.useRef<string | undefined>(undefined);

  const emit = React.useCallback((state: ViewerZoomState): void => {
    const key = `${state.level}:${state.resolvedZoom.toFixed(4)}`;
    if (lastEmittedRef.current === key) {
      return;
    }
    lastEmittedRef.current = key;
    onZoomChangeRef.current?.(state);
  }, []);

  const setLevel = React.useCallback(
    (nextLevel: ViewerZoomLevel): void => {
      const normalized = normalizeViewerZoomLevel(nextLevel);
      const root = rootRef.current;
      const scroller = root ? nearestScrollableAncestor(root) : undefined;
      if (root && scroller) {
        pendingAnchorRef.current = captureAnchor(root, scroller, pageSelector);
      }
      const nextResolved =
        typeof normalized === "number"
          ? normalized
          : dimensionsRef.current
            ? resolveViewerZoom(normalized, dimensionsRef.current)
            : resolvedZoomRef.current;
      if (!controlledRef.current) {
        levelRef.current = normalized;
        resolvedZoomRef.current = nextResolved;
        setUncontrolledLevel(normalized);
        setResolvedZoom(nextResolved);
      }
      emit({ level: normalized, resolvedZoom: nextResolved });
    },
    [emit, pageSelector, rootRef]
  );

  const bridge = React.useMemo<ViewerZoomBridge>(
    () => ({
      setZoom: setLevel,
      getZoom: () => levelRef.current,
      getResolvedZoom: () => resolvedZoomRef.current,
    }),
    [setLevel]
  );

  React.useLayoutEffect(() => {
    onBridgeChange?.(bridge);
    return () => onBridgeChange?.(undefined);
  }, [bridge, onBridgeChange]);

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof window === "undefined") {
      return;
    }
    const scroller = nearestScrollableAncestor(root);
    scrollerRef.current = scroller;
    let frame = 0;
    const recalculate = (): void => {
      frame = 0;
      const scrollerPadding = elementPadding(scroller);
      const rootPadding = elementPadding(root);
      const viewportWidth =
        (isWindowScroller(scroller) ? window.innerWidth : scroller.clientWidth) -
        scrollerPadding.horizontal;
      const viewportHeight =
        (isWindowScroller(scroller) ? window.innerHeight : scroller.clientHeight) -
        scrollerPadding.vertical;
      const dimensions = {
        viewportWidth,
        viewportHeight,
        contentWidth: contentWidth + rootPadding.horizontal,
        contentHeight: contentHeight + rootPadding.vertical,
      };
      dimensionsRef.current = dimensions;
      const nextResolved = resolveViewerZoom(levelRef.current, dimensions);
      if (Math.abs(nextResolved - resolvedZoomRef.current) < 0.01) {
        return;
      }
      pendingAnchorRef.current = captureAnchor(root, scroller, pageSelector);
      resolvedZoomRef.current = nextResolved;
      setResolvedZoom(nextResolved);
      emit({ level: levelRef.current, resolvedZoom: nextResolved });
    };
    const schedule = (): void => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(recalculate);
    };
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : undefined;
    observer?.observe(scroller);
    observer?.observe(root);
    window.addEventListener("resize", schedule);
    recalculate();
    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [contentHeight, contentWidth, emit, pageSelector, rootRef, level]);

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    const scroller = scrollerRef.current;
    const anchor = pendingAnchorRef.current;
    if (!root || !scroller || !anchor) {
      return;
    }
    pendingAnchorRef.current = undefined;
    restoreAnchor(root, scroller, pageSelector, anchor);
  }, [pageSelector, resolvedZoom, rootRef]);

  return { level, resolvedZoom };
}
