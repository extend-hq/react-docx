import {
  layoutNextLine,
  prepareWithSegments,
  type LayoutCursor,
  type PreparedTextWithSegments
} from "@chenglou/pretext";

const PREPARED_TEXT_CACHE_MAX_ENTRIES = 512;

const preparedTextByKey = new Map<string, PreparedTextWithSegments>();

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
}

function canUsePretext(): boolean {
  return typeof OffscreenCanvas !== "undefined" || typeof document !== "undefined";
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
      lines: []
    };
  }

  const prepared = prepareCached(text, font);
  if (!prepared) {
    return undefined;
  }

  const safeContainerWidthPx = Math.max(1, Math.round(containerWidthPx));
  const safeLineHeightPx = Math.max(1, Math.round(lineHeightPx));
  const lines: PretextLineLayout[] = [];
  const normalizedExclusions = (exclusions ?? []).map((exclusion) => ({
    left: Math.round(exclusion.left),
    right: Math.round(exclusion.right),
    top: Math.round(exclusion.top),
    bottom: Math.round(exclusion.bottom)
  }));

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

    for (const interval of rowIntervals) {
      if (cursorIsDone(prepared, cursor) || cursorEndedAtHardBreak(prepared, cursor)) {
        break;
      }

      const line = layoutNextLine(prepared, cursor, interval.width);
      if (line) {
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
  return {
    lineCount,
    height: Math.max(
      contentBottomPx,
      ...normalizedExclusions.map((exclusion) => Math.round(exclusion.bottom)),
      0
    ),
    lines
  };
}
