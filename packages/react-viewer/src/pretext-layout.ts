import {
  layoutNextLine,
  prepareWithSegments,
  type LayoutCursor,
  type LayoutLine,
  type PreparedTextWithSegments
} from "@chenglou/pretext";

const PREPARED_TEXT_CACHE_MAX_ENTRIES = 512;
const LAYOUT_CACHE_MAX_ENTRIES = 256;

const preparedTextByKey = new Map<string, PreparedTextWithSegments>();
const layoutByKey = new Map<string, PretextVariableWidthLayout>();
const fragmentOffsetAdvancesByFragment = new WeakMap<PretextLineFragment, number[]>();

export interface PretextExclusionRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PretextLineFragment {
  text: string;
  width: number;
  x: number;
  intervalWidth: number;
  startOffset: number;
  endOffset: number;
}

export interface PretextLineLayout {
  y: number;
  fragments: PretextLineFragment[];
}

export interface PretextVariableWidthLayout {
  lineCount: number;
  height: number;
  lines: PretextLineLayout[];
  text?: string;
  font?: string;
  containerWidthPx?: number;
  lineHeightPx?: number;
  exclusions?: PretextExclusionRect[];
}

export interface PretextSelectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

let measureCanvas:
  | OffscreenCanvas
  | HTMLCanvasElement
  | undefined;
let measureCanvasContext:
  | OffscreenCanvasRenderingContext2D
  | CanvasRenderingContext2D
  | null
  | undefined;

function canUsePretext(): boolean {
  return typeof OffscreenCanvas !== "undefined" || typeof document !== "undefined";
}

function getMeasureContext():
  | OffscreenCanvasRenderingContext2D
  | CanvasRenderingContext2D
  | undefined {
  if (!canUsePretext()) {
    return undefined;
  }

  if (measureCanvasContext) {
    return measureCanvasContext ?? undefined;
  }

  if (typeof OffscreenCanvas !== "undefined") {
    measureCanvas = new OffscreenCanvas(1, 1);
    measureCanvasContext = measureCanvas.getContext("2d");
    return measureCanvasContext ?? undefined;
  }

  if (typeof document !== "undefined") {
    measureCanvas = document.createElement("canvas");
    measureCanvasContext = measureCanvas.getContext("2d");
    return measureCanvasContext ?? undefined;
  }

  return undefined;
}

function measureTextWidthPx(font: string, text: string): number {
  if (!text) {
    return 0;
  }

  const context = getMeasureContext();
  if (!context) {
    return 0;
  }

  context.font = font;
  return Math.max(0, Math.round(context.measureText(text).width));
}

function measureOffsetWidthPx(font: string, text: string, offset: number): number {
  if (offset <= 0 || !text) {
    return 0;
  }

  return measureTextWidthPx(font, text.slice(0, Math.max(0, Math.min(offset, text.length))));
}

function layoutCacheKey(
  text: string,
  font: string,
  containerWidthPx: number,
  lineHeightPx: number,
  exclusions: PretextExclusionRect[]
): string {
  const exclusionsKey = exclusions
    .map((exclusion) => `${exclusion.left},${exclusion.right},${exclusion.top},${exclusion.bottom}`)
    .join(";");
  return `${font}\u0000${containerWidthPx}\u0000${lineHeightPx}\u0000${exclusionsKey}\u0000${text}`;
}

function cachedFragmentOffsetAdvances(font: string, fragment: PretextLineFragment): number[] {
  const cached = fragmentOffsetAdvancesByFragment.get(fragment);
  if (cached) {
    return cached;
  }

  const advances = new Array<number>(fragment.text.length + 1);
  for (let localOffset = 0; localOffset <= fragment.text.length; localOffset += 1) {
    advances[localOffset] = measureOffsetWidthPx(font, fragment.text, localOffset);
  }
  fragmentOffsetAdvancesByFragment.set(fragment, advances);
  return advances;
}

function fragmentOffsetAtX(
  font: string,
  fragment: PretextLineFragment,
  xWithinFragment: number
): number {
  if (xWithinFragment <= 0) {
    return fragment.startOffset;
  }

  if (xWithinFragment >= fragment.width) {
    return fragment.endOffset;
  }

  let bestOffset = fragment.startOffset;
  let bestDistance = Number.POSITIVE_INFINITY;
  const advances = cachedFragmentOffsetAdvances(font, fragment);
  for (let localOffset = 0; localOffset < advances.length; localOffset += 1) {
    const advancePx = advances[localOffset] ?? 0;
    const distance = Math.abs(xWithinFragment - advancePx);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestOffset = fragment.startOffset + localOffset;
    }
  }

  return bestOffset;
}

function nearestLineIndexForY(layout: PretextVariableWidthLayout, y: number): number {
  const lineHeightPx = Math.max(1, Math.round(layout.lineHeightPx ?? 1));
  if (layout.lines.length === 0) {
    return 0;
  }

  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  layout.lines.forEach((line, index) => {
    const centerY = line.y + lineHeightPx / 2;
    const distance = Math.abs(y - centerY);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  return nearestIndex;
}

function prepareCached(text: string, font: string): PreparedTextWithSegments | undefined {
  if (!canUsePretext()) {
    return undefined;
  }

  const cacheKey = `${font}\u0000${text}`;
  const cached = preparedTextByKey.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const prepared = prepareWithSegments(text, font, { whiteSpace: "pre-wrap" });
    preparedTextByKey.set(cacheKey, prepared);
    while (preparedTextByKey.size > PREPARED_TEXT_CACHE_MAX_ENTRIES) {
      const firstKey = preparedTextByKey.keys().next().value as string | undefined;
      if (!firstKey) {
        break;
      }
      preparedTextByKey.delete(firstKey);
    }
    return prepared;
  } catch {
    return undefined;
  }
}

function cursorIsDone(
  prepared: PreparedTextWithSegments,
  cursor: LayoutCursor
): boolean {
  return cursor.segmentIndex >= prepared.segments.length;
}

function cursorEndedAtHardBreak(
  prepared: PreparedTextWithSegments,
  cursor: LayoutCursor
): boolean {
  if (cursor.graphemeIndex > 0 || cursor.segmentIndex <= 0) {
    return false;
  }

  return prepared.kinds[cursor.segmentIndex - 1] === "hard-break";
}

function lineSplitsLeadingBreakableSegment(
  prepared: PreparedTextWithSegments,
  start: LayoutCursor,
  line: LayoutLine
): boolean {
  if (start.graphemeIndex !== 0) {
    return false;
  }

  const breakableWidths = prepared.breakableWidths[start.segmentIndex];
  if (!breakableWidths || breakableWidths.length <= 1) {
    return false;
  }

  return (
    line.end.segmentIndex === start.segmentIndex &&
    line.end.graphemeIndex > start.graphemeIndex &&
    line.end.graphemeIndex < breakableWidths.length
  );
}

function laterIntervalFitsLeadingSegmentWithoutSplit(
  prepared: PreparedTextWithSegments,
  start: LayoutCursor,
  laterIntervals: Array<{
    x: number;
    width: number;
  }>
): boolean {
  for (const interval of laterIntervals) {
    const candidate = layoutNextLine(prepared, start, interval.width);
    if (!candidate) {
      continue;
    }

    if (!lineSplitsLeadingBreakableSegment(prepared, start, candidate)) {
      return true;
    }
  }

  return false;
}

function rowWidthsAtY(
  containerWidthPx: number,
  lineHeightPx: number,
  rowTopPx: number,
  exclusions: PretextExclusionRect[]
): Array<{
  x: number;
  width: number;
}> {
  const safeContainerWidthPx = Math.max(0, Math.round(containerWidthPx));
  let intervals = [
    {
      x: 0,
      width: safeContainerWidthPx
    }
  ];

  const rowBottomPx = rowTopPx + Math.max(1, Math.round(lineHeightPx));
  for (const exclusion of exclusions) {
    const overlapsExclusion = rowBottomPx > exclusion.top && rowTopPx < exclusion.bottom;
    if (!overlapsExclusion) {
      continue;
    }

    const exclusionLeftPx = Math.max(0, Math.min(safeContainerWidthPx, Math.round(exclusion.left)));
    const exclusionRightPx = Math.max(
      exclusionLeftPx,
      Math.min(safeContainerWidthPx, Math.round(exclusion.right))
    );

    intervals = intervals.flatMap((interval) => {
      const intervalLeftPx = interval.x;
      const intervalRightPx = interval.x + interval.width;
      if (exclusionRightPx <= intervalLeftPx || exclusionLeftPx >= intervalRightPx) {
        return [interval];
      }

      const nextIntervals: Array<{ x: number; width: number }> = [];
      if (exclusionLeftPx > intervalLeftPx) {
        nextIntervals.push({
          x: intervalLeftPx,
          width: exclusionLeftPx - intervalLeftPx
        });
      }
      if (exclusionRightPx < intervalRightPx) {
        nextIntervals.push({
          x: exclusionRightPx,
          width: intervalRightPx - exclusionRightPx
        });
      }
      return nextIntervals;
    });
  }

  return intervals.filter((interval) => interval.width > 0.5);
}

export function layoutTextWithPretextAroundExclusions(
  text: string,
  font: string,
  containerWidthPx: number,
  lineHeightPx: number,
  exclusions?: PretextExclusionRect[]
): PretextVariableWidthLayout | undefined {
  if (!text) {
    return {
      lineCount: 0,
      height: Math.max(
        0,
        ...(exclusions ?? []).map((exclusion) => Math.round(exclusion.bottom))
      ),
      lines: [],
      text,
      font,
      containerWidthPx: Math.max(1, Math.round(containerWidthPx)),
      lineHeightPx: Math.max(1, Math.round(lineHeightPx)),
      exclusions: (exclusions ?? []).map((exclusion) => ({
        left: Math.round(exclusion.left),
        right: Math.round(exclusion.right),
        top: Math.round(exclusion.top),
        bottom: Math.round(exclusion.bottom)
      }))
    };
  }

  const prepared = prepareCached(text, font);
  if (!prepared) {
    return undefined;
  }

  const safeContainerWidthPx = Math.max(1, Math.round(containerWidthPx));
  const safeLineHeightPx = Math.max(1, Math.round(lineHeightPx));
  const normalizedExclusions = (exclusions ?? []).map((exclusion) => ({
    left: Math.round(exclusion.left),
    right: Math.round(exclusion.right),
    top: Math.round(exclusion.top),
    bottom: Math.round(exclusion.bottom)
  }));
  const cacheKey = layoutCacheKey(
    text,
    font,
    safeContainerWidthPx,
    safeLineHeightPx,
    normalizedExclusions
  );
  const cachedLayout = layoutByKey.get(cacheKey);
  if (cachedLayout) {
    return cachedLayout;
  }

  const lines: PretextLineLayout[] = [];

  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
  let consumedOffset = 0;
  let rowTopPx = 0;

  while (!cursorIsDone(prepared, cursor)) {
    const rowIntervals = rowWidthsAtY(
      safeContainerWidthPx,
      safeLineHeightPx,
      rowTopPx,
      normalizedExclusions
    );
    const fragments: PretextLineFragment[] = [];

    if (rowIntervals.length === 0) {
      rowTopPx += safeLineHeightPx;
      continue;
    }

    for (let intervalIndex = 0; intervalIndex < rowIntervals.length; intervalIndex += 1) {
      const interval = rowIntervals[intervalIndex]!;
      if (cursorIsDone(prepared, cursor) || cursorEndedAtHardBreak(prepared, cursor)) {
        break;
      }

      const line = layoutNextLine(prepared, cursor, interval.width);
      if (line) {
        if (
          lineSplitsLeadingBreakableSegment(prepared, cursor, line) &&
          laterIntervalFitsLeadingSegmentWithoutSplit(
            prepared,
            cursor,
            rowIntervals.slice(intervalIndex + 1)
          )
        ) {
          continue;
        }

        fragments.push({
          text: line.text,
          width: line.width,
          x: interval.x,
          intervalWidth: interval.width,
          startOffset: consumedOffset,
          endOffset: consumedOffset + line.text.length
        });
        consumedOffset += line.text.length;
        cursor = line.end;
      }
    }

    if (fragments.length === 0) {
      break;
    }

    lines.push({
      y: rowTopPx,
      fragments
    });
    rowTopPx += safeLineHeightPx;
  }

  const lineCount = lines.length;
  const contentBottomPx =
    lines.length > 0
      ? (lines[lines.length - 1]?.y ?? 0) + safeLineHeightPx
      : 0;
  const nextLayout: PretextVariableWidthLayout = {
    lineCount,
    height: Math.max(
      contentBottomPx,
      ...normalizedExclusions.map((exclusion) => Math.round(exclusion.bottom)),
      0
    ),
    lines,
    text,
    font,
    containerWidthPx: safeContainerWidthPx,
    lineHeightPx: safeLineHeightPx,
    exclusions: normalizedExclusions
  };
  layoutByKey.set(cacheKey, nextLayout);
  while (layoutByKey.size > LAYOUT_CACHE_MAX_ENTRIES) {
    const firstKey = layoutByKey.keys().next().value as string | undefined;
    if (!firstKey) {
      break;
    }
    layoutByKey.delete(firstKey);
  }
  return nextLayout;
}

export function resolveOffsetAtPoint(
  layout: PretextVariableWidthLayout,
  x: number,
  y: number
): number {
  const textLength = layout.text?.length ?? 0;
  if (layout.lines.length === 0) {
    return 0;
  }

  const lineIndex = nearestLineIndexForY(layout, y);
  const line = layout.lines[lineIndex];
  if (!line || line.fragments.length === 0) {
    return Math.max(0, Math.min(textLength, 0));
  }

  const firstFragment = line.fragments[0]!;
  const lastFragment = line.fragments[line.fragments.length - 1]!;
  const font = layout.font ?? "";
  if (x <= firstFragment.x) {
    return firstFragment.startOffset;
  }

  if (x >= lastFragment.x + lastFragment.width) {
    return lastFragment.endOffset;
  }

  for (let fragmentIndex = 0; fragmentIndex < line.fragments.length; fragmentIndex += 1) {
    const fragment = line.fragments[fragmentIndex]!;
    const fragmentLeft = fragment.x;
    const fragmentRight = fragment.x + fragment.width;
    if (x >= fragmentLeft && x <= fragmentRight) {
      return fragmentOffsetAtX(font, fragment, x - fragmentLeft);
    }

    const nextFragment = line.fragments[fragmentIndex + 1];
    if (nextFragment && x > fragmentRight && x < nextFragment.x) {
      const gapMidpoint = fragmentRight + (nextFragment.x - fragmentRight) / 2;
      return x < gapMidpoint ? fragment.endOffset : nextFragment.startOffset;
    }
  }

  return Math.max(0, Math.min(textLength, lastFragment.endOffset));
}

export function resolveCaretRectAtOffset(
  layout: PretextVariableWidthLayout,
  offset: number
): PretextSelectionRect | undefined {
  if (layout.lines.length === 0) {
    return undefined;
  }

  const safeOffset = Math.max(0, Math.min(Math.round(offset), layout.text?.length ?? 0));
  const lineHeightPx = Math.max(1, Math.round(layout.lineHeightPx ?? 1));
  const font = layout.font ?? "";

  for (const line of layout.lines) {
    for (const fragment of line.fragments) {
      if (safeOffset < fragment.startOffset || safeOffset > fragment.endOffset) {
        continue;
      }

      const localOffset = safeOffset - fragment.startOffset;
      const advances = cachedFragmentOffsetAdvances(font, fragment);
      const left = fragment.x + (advances[localOffset] ?? 0);
      return {
        left,
        top: line.y,
        width: 1,
        height: lineHeightPx
      };
    }
  }

  const lastLine = layout.lines[layout.lines.length - 1];
  const lastFragment = lastLine?.fragments[lastLine.fragments.length - 1];
  if (!lastLine || !lastFragment) {
    return undefined;
  }

  return {
    left: lastFragment.x + lastFragment.width,
    top: lastLine.y,
    width: 1,
    height: lineHeightPx
  };
}

export function resolveSelectionRects(
  layout: PretextVariableWidthLayout,
  startOffset: number,
  endOffset: number
): PretextSelectionRect[] {
  const safeStart = Math.max(0, Math.min(Math.round(startOffset), layout.text?.length ?? 0));
  const safeEnd = Math.max(safeStart, Math.min(Math.round(endOffset), layout.text?.length ?? 0));
  if (safeStart === safeEnd) {
    return [];
  }

  const lineHeightPx = Math.max(1, Math.round(layout.lineHeightPx ?? 1));
  const font = layout.font ?? "";
  const rects: PretextSelectionRect[] = [];

  layout.lines.forEach((line) => {
    line.fragments.forEach((fragment) => {
      const overlapStart = Math.max(safeStart, fragment.startOffset);
      const overlapEnd = Math.min(safeEnd, fragment.endOffset);
      if (overlapStart >= overlapEnd) {
        return;
      }

      const advances = cachedFragmentOffsetAdvances(font, fragment);
      const leadingWidthPx = advances[overlapStart - fragment.startOffset] ?? 0;
      const selectedWidthPx =
        (advances[overlapEnd - fragment.startOffset] ?? 0) - leadingWidthPx;
      rects.push({
        left: fragment.x + leadingWidthPx,
        top: line.y,
        width: Math.max(1, selectedWidthPx),
        height: lineHeightPx
      });
    });
  });

  return rects;
}

export function sliceLayoutToLineRange(
  layout: PretextVariableWidthLayout,
  startLineIndex: number,
  endLineIndex: number
): PretextVariableWidthLayout {
  const safeStart = Math.max(0, Math.min(Math.round(startLineIndex), layout.lines.length));
  const safeEnd = Math.max(safeStart, Math.min(Math.round(endLineIndex), layout.lines.length));
  const slicedLines = layout.lines.slice(safeStart, safeEnd);
  const yOffset = slicedLines[0]?.y ?? 0;
  const normalizedLines = slicedLines.map((line) => ({
    ...line,
    y: line.y - yOffset,
    fragments: line.fragments.map((fragment) => ({ ...fragment }))
  }));
  const lineHeightPx = Math.max(1, Math.round(layout.lineHeightPx ?? 1));
  const height =
    normalizedLines.length > 0
      ? (normalizedLines[normalizedLines.length - 1]?.y ?? 0) + lineHeightPx
      : 0;

  return {
    ...layout,
    lineCount: normalizedLines.length,
    height,
    lines: normalizedLines
  };
}
