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
  exclusion?: PretextExclusionRect
): {
  leftWidthPx: number;
  rightWidthPx: number;
  rightXPx: number;
} {
  const safeContainerWidthPx = Math.max(0, Math.round(containerWidthPx));
  if (!exclusion) {
    return {
      leftWidthPx: safeContainerWidthPx,
      rightWidthPx: 0,
      rightXPx: safeContainerWidthPx
    };
  }

  const rowBottomPx = rowTopPx + Math.max(1, Math.round(lineHeightPx));
  const overlapsExclusion = rowBottomPx > exclusion.top && rowTopPx < exclusion.bottom;
  if (!overlapsExclusion) {
    return {
      leftWidthPx: safeContainerWidthPx,
      rightWidthPx: 0,
      rightXPx: safeContainerWidthPx
    };
  }

  const exclusionLeftPx = Math.max(0, Math.min(safeContainerWidthPx, Math.round(exclusion.left)));
  const exclusionRightPx = Math.max(
    exclusionLeftPx,
    Math.min(safeContainerWidthPx, Math.round(exclusion.right))
  );

  return {
    leftWidthPx: exclusionLeftPx,
    rightWidthPx: Math.max(0, safeContainerWidthPx - exclusionRightPx),
    rightXPx: exclusionRightPx
  };
}

export function layoutTextWithPretextAroundExclusion(
  text: string,
  font: string,
  containerWidthPx: number,
  lineHeightPx: number,
  exclusion?: PretextExclusionRect
): PretextVariableWidthLayout | undefined {
  if (!text) {
    return {
      lineCount: 0,
      height: exclusion ? Math.max(0, Math.round(exclusion.bottom)) : 0,
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

  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
  let consumedOffset = 0;
  let rowIndex = 0;

  while (!cursorIsDone(prepared, cursor)) {
    const rowTopPx = rowIndex * safeLineHeightPx;
    const widths = rowWidthsAtY(safeContainerWidthPx, safeLineHeightPx, rowTopPx, exclusion);
    const fragments: PretextLineFragment[] = [];

    if (widths.leftWidthPx > 0) {
      const leftLine = layoutNextLine(prepared, cursor, widths.leftWidthPx);
      if (leftLine) {
        fragments.push({
          text: leftLine.text,
          width: leftLine.width,
          x: 0,
          startOffset: consumedOffset,
          endOffset: consumedOffset + leftLine.text.length
        });
        consumedOffset += leftLine.text.length;
        cursor = leftLine.end;
      }
    }

    if (
      widths.rightWidthPx > 0 &&
      !cursorIsDone(prepared, cursor) &&
      !cursorEndedAtHardBreak(prepared, cursor)
    ) {
      const rightLine = layoutNextLine(prepared, cursor, widths.rightWidthPx);
      if (rightLine) {
        fragments.push({
          text: rightLine.text,
          width: rightLine.width,
          x: widths.rightXPx,
          startOffset: consumedOffset,
          endOffset: consumedOffset + rightLine.text.length
        });
        consumedOffset += rightLine.text.length;
        cursor = rightLine.end;
      }
    }

    if (fragments.length === 0) {
      break;
    }

    lines.push({
      y: rowTopPx,
      fragments
    });
    rowIndex += 1;
  }

  const lineCount = lines.length;
  const contentBottomPx = lineCount * safeLineHeightPx;
  return {
    lineCount,
    height: Math.max(contentBottomPx, exclusion ? Math.round(exclusion.bottom) : 0),
    lines
  };
}
