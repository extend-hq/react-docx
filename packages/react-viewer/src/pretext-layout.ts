import {
  layoutNextLine,
  measureLineStats,
  prepareWithSegments,
  type LayoutCursor,
  type LayoutLine,
  type PreparedTextWithSegments,
} from "@chenglou/pretext";

const PREPARED_TEXT_CACHE_MAX_ENTRIES = 8192;
const LAYOUT_CACHE_MAX_ENTRIES = 4096;
const LINE_COUNT_CACHE_MAX_ENTRIES = 16384;

const preparedTextByKey = new Map<string, PreparedTextWithSegments>();
const layoutByKey = new Map<string, PretextVariableWidthLayout>();
const lineCountByKey = new Map<string, number>();
const fragmentOffsetAdvancesByFragment = new WeakMap<
  PretextLineFragment,
  number[]
>();
const graphemeOffsetsByText = new Map<string, number[]>();

type PretextWordBreak = "normal" | "keep-all";

export interface PretextLayoutItem {
  text: string;
  font: string;
  startOffset: number;
  endOffset: number;
  break?: "normal" | "never";
  wordBreak?: PretextWordBreak;
}

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
  intervalX: number;
  intervalWidth: number;
  startOffset: number;
  endOffset: number;
  font?: string;
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

let measureCanvas: OffscreenCanvas | HTMLCanvasElement | undefined;
let measureCanvasContext:
  | OffscreenCanvasRenderingContext2D
  | CanvasRenderingContext2D
  | null
  | undefined;
let graphemeSegmenter: Intl.Segmenter | undefined;

interface PretextItemCursor {
  itemIndex: number;
  segmentIndex: number;
  graphemeIndex: number;
}

interface InternalPretextItemLineFragment {
  itemIndex: number;
  text: string;
  width: number;
  font: string;
  start: LayoutCursor;
  end: LayoutCursor;
}

interface InternalPretextItemLine {
  end: PretextItemCursor;
  fragments: InternalPretextItemLineFragment[];
}

function canUsePretext(): boolean {
  return (
    typeof OffscreenCanvas !== "undefined" || typeof document !== "undefined"
  );
}

function getCachedValue<K, V>(cache: Map<K, V>, key: K): V | undefined {
  const cached = cache.get(key);
  if (cached === undefined) {
    return undefined;
  }

  cache.delete(key);
  cache.set(key, cached);
  return cached;
}

function trimCache<K, V>(cache: Map<K, V>, maxEntries: number): void {
  while (cache.size > maxEntries) {
    const firstKey = cache.keys().next().value as K | undefined;
    if (firstKey === undefined) {
      break;
    }
    cache.delete(firstKey);
  }
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

function measureOffsetWidthPx(
  font: string,
  text: string,
  offset: number
): number {
  if (offset <= 0 || !text) {
    return 0;
  }

  return measureTextWidthPx(
    font,
    text.slice(0, Math.max(0, Math.min(offset, text.length)))
  );
}

function getGraphemeSegmenter(): Intl.Segmenter | undefined {
  if (graphemeSegmenter) {
    return graphemeSegmenter;
  }

  if (typeof Intl === "undefined" || typeof Intl.Segmenter === "undefined") {
    return undefined;
  }

  graphemeSegmenter = new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  });
  return graphemeSegmenter;
}

function graphemeCodeUnitOffsets(text: string): number[] {
  if (!text) {
    return [0];
  }

  const cached = graphemeOffsetsByText.get(text);
  if (cached) {
    return cached;
  }

  const segmenter = getGraphemeSegmenter();
  const offsets = [0];
  if (segmenter) {
    for (const grapheme of segmenter.segment(text)) {
      offsets.push(grapheme.index + grapheme.segment.length);
    }
  } else {
    let nextOffset = 0;
    for (const codePoint of text) {
      nextOffset += codePoint.length;
      offsets.push(nextOffset);
    }
  }
  if (offsets[offsets.length - 1] !== text.length) {
    offsets[offsets.length - 1] = text.length;
  }
  graphemeOffsetsByText.set(text, offsets);
  return offsets;
}

function countGraphemes(text: string): number {
  return Math.max(0, graphemeCodeUnitOffsets(text).length - 1);
}

function codeUnitOffsetAtGrapheme(text: string, graphemeIndex: number): number {
  const offsets = graphemeCodeUnitOffsets(text);
  const safeIndex = Math.max(
    0,
    Math.min(Math.round(graphemeIndex), offsets.length - 1)
  );
  return offsets[safeIndex] ?? text.length;
}

function cursorAdvanceCodeUnits(
  prepared: PreparedTextWithSegments,
  start: LayoutCursor,
  end: LayoutCursor
): number {
  if (
    end.segmentIndex < start.segmentIndex ||
    (end.segmentIndex === start.segmentIndex &&
      end.graphemeIndex <= start.graphemeIndex)
  ) {
    return 0;
  }

  let consumedCodeUnits = 0;
  const lastSegmentIndex = Math.min(end.segmentIndex, prepared.segments.length);
  for (
    let segmentIndex = start.segmentIndex;
    segmentIndex <= lastSegmentIndex;
    segmentIndex += 1
  ) {
    const segmentText = prepared.segments[segmentIndex] ?? "";
    if (
      segmentIndex === start.segmentIndex &&
      segmentIndex === end.segmentIndex
    ) {
      consumedCodeUnits += Math.max(
        0,
        codeUnitOffsetAtGrapheme(segmentText, end.graphemeIndex) -
          codeUnitOffsetAtGrapheme(segmentText, start.graphemeIndex)
      );
      break;
    }
    if (segmentIndex === start.segmentIndex) {
      consumedCodeUnits += Math.max(
        0,
        segmentText.length -
          codeUnitOffsetAtGrapheme(segmentText, start.graphemeIndex)
      );
      continue;
    }
    if (segmentIndex === end.segmentIndex) {
      consumedCodeUnits += codeUnitOffsetAtGrapheme(
        segmentText,
        end.graphemeIndex
      );
      break;
    }
    consumedCodeUnits += segmentText.length;
  }

  return consumedCodeUnits;
}

function layoutCacheKey(
  layoutSignature: string,
  containerWidthPx: number,
  lineHeightPx: number,
  exclusions: PretextExclusionRect[]
): string {
  const exclusionsKey = exclusions
    .map(
      (exclusion) =>
        `${exclusion.left},${exclusion.right},${exclusion.top},${exclusion.bottom}`
    )
    .join(";");
  return `${layoutSignature}\u0000${containerWidthPx}\u0000${lineHeightPx}\u0000${exclusionsKey}`;
}

function cachedFragmentOffsetAdvances(
  defaultFont: string,
  fragment: PretextLineFragment
): number[] {
  const cached = fragmentOffsetAdvancesByFragment.get(fragment);
  if (cached) {
    return cached;
  }

  const advances = new Array<number>(fragment.text.length + 1);
  for (
    let localOffset = 0;
    localOffset <= fragment.text.length;
    localOffset += 1
  ) {
    advances[localOffset] = measureOffsetWidthPx(
      fragment.font ?? defaultFont,
      fragment.text,
      localOffset
    );
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

function nearestLineIndexForY(
  layout: PretextVariableWidthLayout,
  y: number
): number {
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

function prepareCached(
  text: string,
  font: string,
  wordBreak: PretextWordBreak = "normal"
): PreparedTextWithSegments | undefined {
  if (!canUsePretext()) {
    return undefined;
  }

  const cacheKey = `${font}\u0000${wordBreak}\u0000${text}`;
  const cached = getCachedValue(preparedTextByKey, cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const prepared = prepareWithSegments(text, font, {
      whiteSpace: "pre-wrap",
      wordBreak,
    });
    preparedTextByKey.set(cacheKey, prepared);
    trimCache(preparedTextByKey, PREPARED_TEXT_CACHE_MAX_ENTRIES);
    return prepared;
  } catch {
    return undefined;
  }
}

/**
 * Fast line-count-only path for plain single-font paragraphs with no
 * exclusions. Uses pretext's `measureLineStats` (added in 0.0.5) so we can
 * wrap text and count lines in pure arithmetic without allocating any line
 * text strings. Intended for hot pagination loops that only read
 * `lineCount` from the result and discard the rest.
 *
 * Returns `undefined` when pretext is not available in the host environment
 * (e.g. SSR without Canvas); callers should fall back to the general layout
 * path in that case.
 */
export function measurePretextPlainTextLineCount(
  text: string,
  font: string,
  containerWidthPx: number,
  options?: {
    wordBreak?: PretextWordBreak;
  }
): number | undefined {
  if (!text) {
    return 0;
  }

  const wordBreak = options?.wordBreak ?? "normal";
  const safeWidth = Math.max(1, Math.round(containerWidthPx));
  const cacheKey =
    `line-count\u0000${font}\u0000${wordBreak}` +
    `\u0000${safeWidth}\u0000${text}`;
  const cached = getCachedValue(lineCountByKey, cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const prepared = prepareCached(text, font, wordBreak);
  if (!prepared) {
    return undefined;
  }

  try {
    const lineCount = measureLineStats(prepared, safeWidth).lineCount;
    lineCountByKey.set(cacheKey, lineCount);
    trimCache(lineCountByKey, LINE_COUNT_CACHE_MAX_ENTRIES);
    return lineCount;
  } catch {
    return undefined;
  }
}

function cloneItemCursor(cursor: PretextItemCursor): PretextItemCursor {
  return {
    itemIndex: cursor.itemIndex,
    segmentIndex: cursor.segmentIndex,
    graphemeIndex: cursor.graphemeIndex,
  };
}

function itemCursorAtStart(cursor: PretextItemCursor): boolean {
  return cursor.segmentIndex === 0 && cursor.graphemeIndex === 0;
}

function normalizeItemCursor(
  preparedItems: Array<PreparedTextWithSegments | undefined>,
  cursor: PretextItemCursor
): PretextItemCursor {
  const nextCursor = cloneItemCursor(cursor);
  while (nextCursor.itemIndex < preparedItems.length) {
    const prepared = preparedItems[nextCursor.itemIndex];
    if (!prepared || nextCursor.segmentIndex >= prepared.segments.length) {
      nextCursor.itemIndex += 1;
      nextCursor.segmentIndex = 0;
      nextCursor.graphemeIndex = 0;
      continue;
    }
    break;
  }
  return nextCursor;
}

function itemCursorIsDone(
  preparedItems: Array<PreparedTextWithSegments | undefined>,
  cursor: PretextItemCursor
): boolean {
  return (
    normalizeItemCursor(preparedItems, cursor).itemIndex >= preparedItems.length
  );
}

function wholeRemainingItemLine(
  prepared: PreparedTextWithSegments,
  cursor: LayoutCursor
): LayoutLine | null {
  return layoutNextLine(prepared, cursor, Number.POSITIVE_INFINITY);
}

function layoutNextItemLine(
  items: PretextLayoutItem[],
  preparedItems: Array<PreparedTextWithSegments | undefined>,
  start: PretextItemCursor,
  maxWidth: number
): InternalPretextItemLine | null {
  const cursor = normalizeItemCursor(preparedItems, start);
  if (cursor.itemIndex >= items.length) {
    return null;
  }

  const safeMaxWidth = Math.max(1, maxWidth);
  const fragments: InternalPretextItemLineFragment[] = [];
  let remainingWidth = safeMaxWidth;
  let current = cloneItemCursor(cursor);

  while (current.itemIndex < items.length) {
    const item = items[current.itemIndex];
    const prepared = preparedItems[current.itemIndex];
    if (!item || !prepared) {
      current.itemIndex += 1;
      current.segmentIndex = 0;
      current.graphemeIndex = 0;
      continue;
    }

    const itemCursor: LayoutCursor = {
      segmentIndex: current.segmentIndex,
      graphemeIndex: current.graphemeIndex,
    };
    const atItemStart = itemCursorAtStart(current);
    const remainingItemLine =
      item.break === "never"
        ? wholeRemainingItemLine(prepared, itemCursor)
        : layoutNextLine(prepared, itemCursor, Math.max(1, remainingWidth));
    if (!remainingItemLine) {
      current.itemIndex += 1;
      current.segmentIndex = 0;
      current.graphemeIndex = 0;
      continue;
    }

    const noProgress =
      remainingItemLine.end.segmentIndex === itemCursor.segmentIndex &&
      remainingItemLine.end.graphemeIndex === itemCursor.graphemeIndex &&
      remainingItemLine.text.length === 0;
    if (noProgress) {
      current.itemIndex += 1;
      current.segmentIndex = 0;
      current.graphemeIndex = 0;
      continue;
    }

    const overflowsCurrentLine =
      fragments.length > 0 &&
      atItemStart &&
      remainingItemLine.width > remainingWidth + 0.5;
    if (overflowsCurrentLine) {
      break;
    }

    fragments.push({
      itemIndex: current.itemIndex,
      text: remainingItemLine.text,
      width: remainingItemLine.width,
      font: item.font,
      start: itemCursor,
      end: remainingItemLine.end,
    });

    remainingWidth = Math.max(0, remainingWidth - remainingItemLine.width);

    if (remainingItemLine.end.segmentIndex >= prepared.segments.length) {
      current.itemIndex += 1;
      current.segmentIndex = 0;
      current.graphemeIndex = 0;
      if (remainingWidth <= 0.5) {
        break;
      }
      continue;
    }

    current.segmentIndex = remainingItemLine.end.segmentIndex;
    current.graphemeIndex = remainingItemLine.end.graphemeIndex;
    break;
  }

  if (fragments.length === 0) {
    return null;
  }

  return {
    end: normalizeItemCursor(preparedItems, current),
    fragments,
  };
}

function lineSplitsLeadingItem(
  items: PretextLayoutItem[],
  preparedItems: Array<PreparedTextWithSegments | undefined>,
  start: PretextItemCursor,
  line: InternalPretextItemLine
): boolean {
  if (!itemCursorAtStart(start)) {
    return false;
  }

  const firstFragment = line.fragments[0];
  const item = firstFragment ? items[firstFragment.itemIndex] : undefined;
  const prepared = firstFragment
    ? preparedItems[firstFragment.itemIndex]
    : undefined;
  if (
    !firstFragment ||
    !item ||
    !prepared ||
    item.break === "never" ||
    firstFragment.itemIndex !== start.itemIndex
  ) {
    return false;
  }

  const wholeLine = wholeRemainingItemLine(prepared, {
    segmentIndex: start.segmentIndex,
    graphemeIndex: start.graphemeIndex,
  });
  if (!wholeLine) {
    return false;
  }

  return firstFragment.text.length < wholeLine.text.length;
}

function laterIntervalFitsLeadingItemWithoutSplit(
  items: PretextLayoutItem[],
  preparedItems: Array<PreparedTextWithSegments | undefined>,
  start: PretextItemCursor,
  line: InternalPretextItemLine,
  laterIntervals: Array<{
    x: number;
    width: number;
  }>
): boolean {
  const item = items[start.itemIndex];
  const prepared = preparedItems[start.itemIndex];
  if (
    !item ||
    !prepared ||
    !itemCursorAtStart(start) ||
    item.break === "never"
  ) {
    return false;
  }

  const startCursor: LayoutCursor = {
    segmentIndex: start.segmentIndex,
    graphemeIndex: start.graphemeIndex,
  };
  const wholeLine = wholeRemainingItemLine(prepared, startCursor);
  if (!wholeLine) {
    return false;
  }

  if (
    laterIntervals.some((interval) => wholeLine.width <= interval.width + 0.5)
  ) {
    return true;
  }

  // Even when the whole remaining run cannot fit a later slot, never split a
  // word across wrap slots if some later slot in the same row can keep that
  // leading word intact.
  const firstFragment = line.fragments[0];
  if (
    !firstFragment ||
    firstFragment.itemIndex !== start.itemIndex ||
    !cursorSplitsLeadingBreakableSegment(
      prepared,
      startCursor,
      firstFragment.end
    )
  ) {
    return false;
  }

  return laterIntervals.some((interval) => {
    const candidate = layoutNextLine(
      prepared,
      startCursor,
      Math.max(1, interval.width)
    );
    if (!candidate) {
      return false;
    }

    return !cursorSplitsLeadingBreakableSegment(
      prepared,
      startCursor,
      candidate.end
    );
  });
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

function cursorSplitsLeadingBreakableSegment(
  prepared: PreparedTextWithSegments,
  start: LayoutCursor,
  end: LayoutCursor
): boolean {
  if (start.graphemeIndex !== 0) {
    return false;
  }

  const segmentText = prepared.segments[start.segmentIndex];
  const segmentGraphemeCount = segmentText ? countGraphemes(segmentText) : 0;
  if (segmentGraphemeCount <= 1) {
    return false;
  }

  return (
    end.segmentIndex === start.segmentIndex &&
    end.graphemeIndex > start.graphemeIndex &&
    end.graphemeIndex < segmentGraphemeCount
  );
}

function lineSplitsLeadingBreakableSegment(
  prepared: PreparedTextWithSegments,
  start: LayoutCursor,
  line: LayoutLine
): boolean {
  return cursorSplitsLeadingBreakableSegment(prepared, start, line.end);
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
      width: safeContainerWidthPx,
    },
  ];

  const rowBottomPx = rowTopPx + Math.max(1, Math.round(lineHeightPx));
  for (const exclusion of exclusions) {
    const overlapsExclusion =
      rowBottomPx > exclusion.top && rowTopPx < exclusion.bottom;
    if (!overlapsExclusion) {
      continue;
    }

    const exclusionLeftPx = Math.max(
      0,
      Math.min(safeContainerWidthPx, Math.round(exclusion.left))
    );
    const exclusionRightPx = Math.max(
      exclusionLeftPx,
      Math.min(safeContainerWidthPx, Math.round(exclusion.right))
    );

    intervals = intervals.flatMap((interval) => {
      const intervalLeftPx = interval.x;
      const intervalRightPx = interval.x + interval.width;
      if (
        exclusionRightPx <= intervalLeftPx ||
        exclusionLeftPx >= intervalRightPx
      ) {
        return [interval];
      }

      const nextIntervals: Array<{ x: number; width: number }> = [];
      if (exclusionLeftPx > intervalLeftPx) {
        nextIntervals.push({
          x: intervalLeftPx,
          width: exclusionLeftPx - intervalLeftPx,
        });
      }
      if (exclusionRightPx < intervalRightPx) {
        nextIntervals.push({
          x: exclusionRightPx,
          width: intervalRightPx - exclusionRightPx,
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
  exclusions?: PretextExclusionRect[],
  options?: {
    wordBreak?: PretextWordBreak;
  }
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
        bottom: Math.round(exclusion.bottom),
      })),
    };
  }

  const wordBreak = options?.wordBreak ?? "normal";
  const prepared = prepareCached(text, font, wordBreak);
  if (!prepared) {
    return undefined;
  }

  const safeContainerWidthPx = Math.max(1, Math.round(containerWidthPx));
  const safeLineHeightPx = Math.max(1, Math.round(lineHeightPx));
  const normalizedExclusions = (exclusions ?? []).map((exclusion) => ({
    left: Math.round(exclusion.left),
    right: Math.round(exclusion.right),
    top: Math.round(exclusion.top),
    bottom: Math.round(exclusion.bottom),
  }));
  const cacheKey = layoutCacheKey(
    `plain\u0000${font}\u0000${wordBreak}\u0000${text}`,
    safeContainerWidthPx,
    safeLineHeightPx,
    normalizedExclusions
  );
  const cachedLayout = getCachedValue(layoutByKey, cacheKey);
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

    for (
      let intervalIndex = 0;
      intervalIndex < rowIntervals.length;
      intervalIndex += 1
    ) {
      const interval = rowIntervals[intervalIndex]!;
      if (
        cursorIsDone(prepared, cursor) ||
        cursorEndedAtHardBreak(prepared, cursor)
      ) {
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
          intervalX: interval.x,
          intervalWidth: interval.width,
          startOffset: consumedOffset,
          endOffset:
            consumedOffset + cursorAdvanceCodeUnits(prepared, cursor, line.end),
          font,
        });
        consumedOffset += cursorAdvanceCodeUnits(prepared, cursor, line.end);
        cursor = line.end;
      }
    }

    if (fragments.length === 0) {
      break;
    }

    lines.push({
      y: rowTopPx,
      fragments,
    });
    rowTopPx += safeLineHeightPx;
  }

  const lineCount = lines.length;
  const contentBottomPx =
    lines.length > 0 ? (lines[lines.length - 1]?.y ?? 0) + safeLineHeightPx : 0;
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
    exclusions: normalizedExclusions,
  };
  layoutByKey.set(cacheKey, nextLayout);
  trimCache(layoutByKey, LAYOUT_CACHE_MAX_ENTRIES);
  return nextLayout;
}

export function layoutItemsWithPretextAroundExclusions(
  text: string,
  items: PretextLayoutItem[],
  containerWidthPx: number,
  lineHeightPx: number,
  exclusions?: PretextExclusionRect[],
  fallbackFont?: string
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
      font: fallbackFont,
      containerWidthPx: Math.max(1, Math.round(containerWidthPx)),
      lineHeightPx: Math.max(1, Math.round(lineHeightPx)),
      exclusions: (exclusions ?? []).map((exclusion) => ({
        left: Math.round(exclusion.left),
        right: Math.round(exclusion.right),
        top: Math.round(exclusion.top),
        bottom: Math.round(exclusion.bottom),
      })),
    };
  }

  if (!canUsePretext()) {
    return undefined;
  }

  const preparedItems = items.map((item) =>
    prepareCached(item.text, item.font, item.wordBreak ?? "normal")
  );
  if (
    preparedItems.some(
      (prepared, index) => !prepared && items[index]?.text.length
    )
  ) {
    return undefined;
  }

  const safeContainerWidthPx = Math.max(1, Math.round(containerWidthPx));
  const safeLineHeightPx = Math.max(1, Math.round(lineHeightPx));
  const normalizedExclusions = (exclusions ?? []).map((exclusion) => ({
    left: Math.round(exclusion.left),
    right: Math.round(exclusion.right),
    top: Math.round(exclusion.top),
    bottom: Math.round(exclusion.bottom),
  }));
  const layoutSignature = items
    .map(
      (item) =>
        `${item.font}\u0001${item.break ?? "normal"}\u0001${
          item.wordBreak ?? "normal"
        }\u0001${item.startOffset}\u0001${item.endOffset}\u0001${item.text}`
    )
    .join("\u0002");
  const cacheKey = layoutCacheKey(
    `items\u0000${layoutSignature}`,
    safeContainerWidthPx,
    safeLineHeightPx,
    normalizedExclusions
  );
  const cachedLayout = getCachedValue(layoutByKey, cacheKey);
  if (cachedLayout) {
    return cachedLayout;
  }

  const lines: PretextLineLayout[] = [];
  const consumedOffsetsByItemIndex = items.map(() => 0);
  let cursor: PretextItemCursor = {
    itemIndex: 0,
    segmentIndex: 0,
    graphemeIndex: 0,
  };
  let rowTopPx = 0;

  while (!itemCursorIsDone(preparedItems, cursor)) {
    cursor = normalizeItemCursor(preparedItems, cursor);
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

    for (
      let intervalIndex = 0;
      intervalIndex < rowIntervals.length;
      intervalIndex += 1
    ) {
      cursor = normalizeItemCursor(preparedItems, cursor);
      if (itemCursorIsDone(preparedItems, cursor)) {
        break;
      }

      const interval = rowIntervals[intervalIndex]!;
      const line = layoutNextItemLine(
        items,
        preparedItems,
        cursor,
        interval.width
      );
      if (!line) {
        continue;
      }

      if (
        lineSplitsLeadingItem(items, preparedItems, cursor, line) &&
        laterIntervalFitsLeadingItemWithoutSplit(
          items,
          preparedItems,
          cursor,
          line,
          rowIntervals.slice(intervalIndex + 1)
        )
      ) {
        continue;
      }

      let nextFragmentX = interval.x;
      let nextCursor = cloneItemCursor(cursor);
      for (const lineFragment of line.fragments) {
        const item = items[lineFragment.itemIndex];
        const prepared = preparedItems[lineFragment.itemIndex];
        if (!item || !prepared) {
          continue;
        }

        const consumedCodeUnits = cursorAdvanceCodeUnits(
          prepared,
          lineFragment.start,
          lineFragment.end
        );
        const startOffset =
          item.startOffset +
          (consumedOffsetsByItemIndex[lineFragment.itemIndex] ?? 0);
        const endOffset = startOffset + consumedCodeUnits;

        fragments.push({
          text: lineFragment.text,
          width: lineFragment.width,
          x: nextFragmentX,
          intervalX: interval.x,
          intervalWidth: interval.width,
          startOffset,
          endOffset,
          font: lineFragment.font,
        });

        consumedOffsetsByItemIndex[lineFragment.itemIndex] =
          (consumedOffsetsByItemIndex[lineFragment.itemIndex] ?? 0) +
          consumedCodeUnits;
        nextFragmentX += lineFragment.width;

        if (lineFragment.itemIndex === nextCursor.itemIndex) {
          if (lineFragment.end.segmentIndex >= prepared.segments.length) {
            nextCursor.itemIndex += 1;
            nextCursor.segmentIndex = 0;
            nextCursor.graphemeIndex = 0;
          } else {
            nextCursor.segmentIndex = lineFragment.end.segmentIndex;
            nextCursor.graphemeIndex = lineFragment.end.graphemeIndex;
          }
        }
      }

      cursor = line.end;
    }

    if (fragments.length === 0) {
      break;
    }

    lines.push({
      y: rowTopPx,
      fragments,
    });
    rowTopPx += safeLineHeightPx;
  }

  const lineCount = lines.length;
  const contentBottomPx =
    lines.length > 0 ? (lines[lines.length - 1]?.y ?? 0) + safeLineHeightPx : 0;
  const nextLayout: PretextVariableWidthLayout = {
    lineCount,
    height: Math.max(
      contentBottomPx,
      ...normalizedExclusions.map((exclusion) => Math.round(exclusion.bottom)),
      0
    ),
    lines,
    text,
    font: fallbackFont ?? items[0]?.font,
    containerWidthPx: safeContainerWidthPx,
    lineHeightPx: safeLineHeightPx,
    exclusions: normalizedExclusions,
  };
  layoutByKey.set(cacheKey, nextLayout);
  trimCache(layoutByKey, LAYOUT_CACHE_MAX_ENTRIES);
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
  if (x <= firstFragment.x) {
    return firstFragment.startOffset;
  }

  if (x >= lastFragment.x + lastFragment.width) {
    return lastFragment.endOffset;
  }

  for (
    let fragmentIndex = 0;
    fragmentIndex < line.fragments.length;
    fragmentIndex += 1
  ) {
    const fragment = line.fragments[fragmentIndex]!;
    const fragmentLeft = fragment.x;
    const fragmentRight = fragment.x + fragment.width;
    if (x >= fragmentLeft && x <= fragmentRight) {
      return fragmentOffsetAtX(layout.font ?? "", fragment, x - fragmentLeft);
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

  const safeOffset = Math.max(
    0,
    Math.min(Math.round(offset), layout.text?.length ?? 0)
  );
  const lineHeightPx = Math.max(1, Math.round(layout.lineHeightPx ?? 1));

  for (const line of layout.lines) {
    for (const fragment of line.fragments) {
      if (
        safeOffset < fragment.startOffset ||
        safeOffset > fragment.endOffset
      ) {
        continue;
      }

      const localOffset = safeOffset - fragment.startOffset;
      const advances = cachedFragmentOffsetAdvances(
        layout.font ?? "",
        fragment
      );
      const left = fragment.x + (advances[localOffset] ?? 0);
      return {
        left,
        top: line.y,
        width: 1,
        height: lineHeightPx,
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
    height: lineHeightPx,
  };
}

export function resolveSelectionRects(
  layout: PretextVariableWidthLayout,
  startOffset: number,
  endOffset: number
): PretextSelectionRect[] {
  const safeStart = Math.max(
    0,
    Math.min(Math.round(startOffset), layout.text?.length ?? 0)
  );
  const safeEnd = Math.max(
    safeStart,
    Math.min(Math.round(endOffset), layout.text?.length ?? 0)
  );
  if (safeStart === safeEnd) {
    return [];
  }

  const lineHeightPx = Math.max(1, Math.round(layout.lineHeightPx ?? 1));
  const rects: PretextSelectionRect[] = [];

  layout.lines.forEach((line) => {
    line.fragments.forEach((fragment) => {
      const overlapStart = Math.max(safeStart, fragment.startOffset);
      const overlapEnd = Math.min(safeEnd, fragment.endOffset);
      if (overlapStart >= overlapEnd) {
        return;
      }

      const advances = cachedFragmentOffsetAdvances(
        layout.font ?? "",
        fragment
      );
      const leadingWidthPx = advances[overlapStart - fragment.startOffset] ?? 0;
      const selectedWidthPx =
        (advances[overlapEnd - fragment.startOffset] ?? 0) - leadingWidthPx;
      rects.push({
        left: fragment.x + leadingWidthPx,
        top: line.y,
        width: Math.max(1, selectedWidthPx),
        height: lineHeightPx,
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
  const safeStart = Math.max(
    0,
    Math.min(Math.round(startLineIndex), layout.lines.length)
  );
  const safeEnd = Math.max(
    safeStart,
    Math.min(Math.round(endLineIndex), layout.lines.length)
  );
  const slicedLines = layout.lines.slice(safeStart, safeEnd);
  const yOffset = slicedLines[0]?.y ?? 0;
  const normalizedLines = slicedLines.map((line) => ({
    ...line,
    y: line.y - yOffset,
    fragments: line.fragments.map((fragment) => ({ ...fragment })),
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
    lines: normalizedLines,
  };
}
