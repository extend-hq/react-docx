import {
  clearCache,
  layoutNextLine as layoutNextLineWithCanvasAdvances,
  measureLineStats,
  prepareWithSegments,
  type LayoutCursor,
  type LayoutLine,
  type PreparedTextWithSegments,
} from "@chenglou/pretext";
import { registerFontMetricCache } from "./font-metrics";
import { canvasFontAdvanceScale } from "./font-advances";
import {
  aggregateLineMetrics,
  type LineElementMetrics,
} from "@extend-ai/react-docx-layout-engine";

const PREPARED_TEXT_CACHE_MAX_ENTRIES = 8192;
const LAYOUT_CACHE_MAX_ENTRIES = 4096;
const LINE_COUNT_CACHE_MAX_ENTRIES = 16384;

const preparedTextByKey = new Map<string, PreparedTextWithSegments>();
let advanceScaleByPreparedText = new WeakMap<PreparedTextWithSegments, number>();
let sourceOffsetsByPreparedText = new WeakMap<PreparedTextWithSegments, number[]>();
const layoutByKey = new Map<string, PretextVariableWidthLayout>();
const lineCountByKey = new Map<string, number>();
let fragmentOffsetAdvancesByFragment = new WeakMap<
  PretextLineFragment,
  number[]
>();
const graphemeOffsetsByText = new Map<string, number[]>();
const fontLineMetricsByKey = new Map<string, LineElementMetrics>();

registerFontMetricCache(() => {
  clearCache();
  preparedTextByKey.clear();
  advanceScaleByPreparedText = new WeakMap();
  sourceOffsetsByPreparedText = new WeakMap();
  layoutByKey.clear();
  lineCountByKey.clear();
  fontLineMetricsByKey.clear();
  fragmentOffsetAdvancesByFragment = new WeakMap();
});

type PretextWordBreak = "normal" | "keep-all";

export interface PretextLayoutItem {
  text: string;
  font: string;
  startOffset: number;
  endOffset: number;
  break?: "normal" | "never";
  wordBreak?: PretextWordBreak;
  letterSpacingPx?: number;
  lineHeightPx?: number;
  strutFont?: string;
  verticalAlign?: "super" | "sub";
  verticalMetrics?: LineElementMetrics;
  widthPx?: number;
}

export interface PretextEndingMarkMetrics {
  sourceOffset: number;
  font: string;
  lineHeightPx?: number;
  strutFont?: string;
  verticalAlign?: "super" | "sub";
  verticalMetrics?: LineElementMetrics;
}

export interface PretextParagraphLineOptions {
  exactLineHeight?: boolean;
  endingMark?: PretextEndingMarkMetrics;
}

export interface PretextExclusionRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  // Metadata only — ignored by layout. Marks exclusions produced by an
  // in-flight image drag preview so block-height consumers can avoid
  // growing paragraphs to contain a transient preview band.
  fromDragPreview?: boolean;
}

export interface PretextLineFragment {
  text: string;
  width: number;
  x: number;
  intervalX: number;
  intervalWidth: number;
  startOffset: number;
  endOffset: number;
  hardBreakOffset?: number;
  font?: string;
  strutFont?: string;
  letterSpacingPx?: number;
  lineHeightPx?: number;
  verticalAlign?: "super" | "sub";
  hasCustomVerticalMetrics?: boolean;
  ascent?: number;
  descent?: number;
}

export interface PretextLineLayout {
  y: number;
  fragments: PretextLineFragment[];
  height?: number;
  ascent?: number;
  descent?: number;
}

export type PretextCaretAffinity = "upstream" | "downstream";

export interface PretextVariableWidthLayout {
  lineCount: number;
  height: number;
  lines: PretextLineLayout[];
  sourceRange?: {
    startOffset: number;
    endOffset: number;
    includesEnd: boolean;
  };
  sourceLineRange?: {
    startLineIndex: number;
    endLineIndex: number;
  };
  unslicedLayout?: PretextVariableWidthLayout;
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
  endsAtHardBreak: boolean;
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

function measureTextWidthPx(
  font: string,
  text: string,
  letterSpacingPx = 0
): number {
  if (!text) {
    return 0;
  }

  const context = getMeasureContext();
  if (!context) {
    return 0;
  }

  context.font = font;
  const advanceScale = canvasFontAdvanceScale(context, font);
  const spacingAdvance =
    Math.max(0, graphemeCodeUnitOffsets(text).length - 1) * letterSpacingPx;
  if (typeof context.letterSpacing === "string") {
    context.letterSpacing = `${letterSpacingPx / advanceScale}px`;
    return Math.max(0, context.measureText(text).width * advanceScale);
  }
  return Math.max(
    0,
    context.measureText(text).width * advanceScale + spacingAdvance
  );
}

function fontMetricProfileKey(): string {
  const ratio = typeof window !== "undefined" ? window.devicePixelRatio : 1;
  const viewportScale =
    typeof window !== "undefined" ? window.visualViewport?.scale ?? 1 : 1;
  const hasDom = typeof document !== "undefined" && Boolean(document.body);
  return `${ratio}\u0000${viewportScale}\u0000${hasDom}`;
}

function bodyZoomScale(): number {
  let scale = 1;
  let element: HTMLElement | null = document.body;
  while (element) {
    const zoom = Number.parseFloat(window.getComputedStyle(element).zoom);
    if (Number.isFinite(zoom) && zoom > 0) scale *= zoom;
    element = element.parentElement;
  }
  return scale;
}

function measureDomFontStrut(
  strutFont: string,
  lineHeight: string,
  textFont?: string,
  verticalAlign?: "super" | "sub",
  cssZoom = 1
): LineElementMetrics | undefined {
  if (
    typeof document === "undefined" ||
    !document.body ||
    typeof document.createElement !== "function" ||
    typeof window === "undefined" ||
    typeof window.getComputedStyle !== "function"
  ) {
    return undefined;
  }
  const zoom = Number.isFinite(cssZoom) && cssZoom > 0 ? cssZoom : 1;
  const host = document.createElement("span");
  Object.assign(host.style, {
    all: "initial",
    position: "fixed",
    left: "0",
    top: "0",
    visibility: "hidden",
    display: "inline-block",
    whiteSpace: "pre",
    pointerEvents: "none",
    font: strutFont,
    lineHeight,
    zoom: String(zoom / bodyZoomScale()),
  });
  if (textFont || verticalAlign) {
    const text = document.createElement("span");
    Object.assign(text.style, {
      all: "initial",
      font: textFont ?? strutFont,
      lineHeight,
      verticalAlign: verticalAlign ?? "baseline",
    });
    text.textContent = "M";
    host.append(text);
  } else {
    host.append(document.createTextNode("M"));
  }
  const baseline = document.createElement("span");
  Object.assign(baseline.style, {
    all: "initial",
    display: "inline-block",
    width: "0",
    height: "0",
    fontSize: "0",
    lineHeight: "0",
    verticalAlign: "baseline",
  });
  host.append(baseline);
  try {
    document.body.append(host);
    const bounds = host.getBoundingClientRect();
    const baselineY = baseline.getBoundingClientRect().top;
    if (bounds.height > 0) {
      return {
        ascent: (baselineY - bounds.top) / zoom,
        descent: (bounds.bottom - baselineY) / zoom,
      };
    }
  } finally {
    host.remove();
  }
  return undefined;
}

function fontLineMetrics(
  font: string,
  lineHeightPx: number
): LineElementMetrics {
  const key = `${fontMetricProfileKey()}\u0000${font}\u0000${lineHeightPx}`;
  const cached = getCachedValue(fontLineMetricsByKey, key);
  if (cached) return cached;
  const domMetrics = measureDomFontStrut(font, `${lineHeightPx}px`);
  if (domMetrics) {
    const metrics = {
      ascent: domMetrics.ascent,
      descent: lineHeightPx - domMetrics.ascent,
    };
    fontLineMetricsByKey.set(key, metrics);
    trimCache(fontLineMetricsByKey, PREPARED_TEXT_CACHE_MAX_ENTRIES);
    return metrics;
  }
  const context = getMeasureContext();
  let metrics: LineElementMetrics = { ascent: lineHeightPx, descent: 0 };
  if (context) {
    context.font = font;
    const measured = context.measureText(" ");
    const ascent = measured.fontBoundingBoxAscent;
    const descent = measured.fontBoundingBoxDescent;
    if (
      Number.isFinite(ascent) &&
      Number.isFinite(descent) &&
      ascent + descent > 0
    ) {
      const leading = (lineHeightPx - ascent - descent) / 2;
      metrics = { ascent: ascent + leading, descent: descent + leading };
    }
  }
  fontLineMetricsByKey.set(key, metrics);
  trimCache(fontLineMetricsByKey, PREPARED_TEXT_CACHE_MAX_ENTRIES);
  return metrics;
}

export function measureFontNaturalLineHeightPx(font: string): number | undefined {
  const key = `${fontMetricProfileKey()}\u0000natural\u0000${font}`;
  const cached = getCachedValue(fontLineMetricsByKey, key);
  if (cached) return cached.ascent + cached.descent;

  // Measure at a larger scale so integer font-metric rounding does not
  // accumulate into a different line or page boundary at normal zoom.
  const metricScale = 64;
  let metrics = measureDomFontStrut(font, "normal", undefined, undefined, metricScale);

  if (!metrics) {
    const context = getMeasureContext();
    if (context) {
      context.font = font;
      const measured = context.measureText(" ");
      if (
        Number.isFinite(measured.fontBoundingBoxAscent) &&
        Number.isFinite(measured.fontBoundingBoxDescent) &&
        measured.fontBoundingBoxAscent + measured.fontBoundingBoxDescent > 0
      ) {
        metrics = {
          ascent: measured.fontBoundingBoxAscent,
          descent: measured.fontBoundingBoxDescent,
        };
      }
    }
  }
  if (!metrics) return undefined;
  fontLineMetricsByKey.set(key, metrics);
  trimCache(fontLineMetricsByKey, PREPARED_TEXT_CACHE_MAX_ENTRIES);
  return metrics.ascent + metrics.descent;
}

function itemLineMetrics(
  item: PretextLayoutItem,
  lineHeightPx: number
): LineElementMetrics {
  if (item.verticalMetrics) return item.verticalMetrics;
  const strutFont = item.strutFont ?? item.font;
  if (
    !item.verticalAlign ||
    typeof document === "undefined" ||
    !document.body
  ) {
    return fontLineMetrics(strutFont, lineHeightPx);
  }
  const key = `${fontMetricProfileKey()}\u0000${strutFont}\u0000${lineHeightPx}\u0000${item.font}\u0000${item.verticalAlign}`;
  const cached = getCachedValue(fontLineMetricsByKey, key);
  if (cached) return cached;

  const metrics =
    measureDomFontStrut(
      strutFont,
      `${lineHeightPx}px`,
      item.font,
      item.verticalAlign
    ) ?? fontLineMetrics(strutFont, lineHeightPx);
  fontLineMetricsByKey.set(key, metrics);
  trimCache(fontLineMetricsByKey, PREPARED_TEXT_CACHE_MAX_ENTRIES);
  return metrics;
}

export function measurePretextFragmentBaselinePx(
  fragment: PretextLineFragment,
  fallbackLineHeightPx: number,
  cssZoom = 1
): number | undefined {
  if (fragment.hasCustomVerticalMetrics || !fragment.font) return undefined;
  const strutFont = fragment.strutFont ?? fragment.font;
  const lineHeightPx = fragment.lineHeightPx ?? fallbackLineHeightPx;
  const key = `${fontMetricProfileKey()}\u0000paint\u0000${strutFont}\u0000${fragment.font}\u0000${lineHeightPx}\u0000${fragment.verticalAlign ?? ""}\u0000${cssZoom}`;
  const cached = getCachedValue(fontLineMetricsByKey, key);
  if (cached) return cached.ascent;
  const metrics = measureDomFontStrut(
    strutFont,
    `${lineHeightPx}px`,
    fragment.strutFont ? fragment.font : undefined,
    fragment.verticalAlign,
    cssZoom
  );
  if (!metrics) return undefined;
  fontLineMetricsByKey.set(key, metrics);
  trimCache(fontLineMetricsByKey, PREPARED_TEXT_CACHE_MAX_ENTRIES);
  return metrics.ascent;
}

function createLine(
  y: number,
  fragments: PretextLineFragment[],
  font: string,
  lineHeightPx: number,
  exactLineHeight = false
): PretextLineLayout {
  const strut = fontLineMetrics(font, lineHeightPx);
  const candidates = fragments.map((fragment) => ({
    ascent: fragment.ascent ?? lineHeightPx,
    descent: fragment.descent ?? 0,
  }));
  const metrics = aggregateLineMetrics(
    candidates.some((candidate) => candidate.ascent !== 0 || candidate.descent !== 0)
      ? candidates
      : [strut]
  );
  return {
    y,
    fragments,
    height: exactLineHeight ? lineHeightPx : metrics.height,
    ascent: exactLineHeight ? strut.ascent : metrics.ascent,
    descent: exactLineHeight ? strut.descent : metrics.descent,
  };
}

function layoutEmptyParagraphWithEndingMark(
  text: string,
  containerWidthPx: number,
  lineHeightPx: number,
  exclusions: PretextExclusionRect[] | undefined,
  options: PretextParagraphLineOptions | undefined
): PretextVariableWidthLayout | undefined {
  const mark = options?.endingMark;
  if (text || !mark || mark.sourceOffset !== 0) return undefined;
  const safeWidthPx = Math.max(1, containerWidthPx);
  const safeHeightPx = Math.max(1, lineHeightPx);
  const candidateHeightPx =
    mark.verticalMetrics !== undefined
      ? mark.verticalMetrics.ascent + mark.verticalMetrics.descent
      : Number.isFinite(mark.lineHeightPx)
      ? mark.lineHeightPx!
      : measureFontNaturalLineHeightPx(mark.strutFont ?? mark.font) ??
        safeHeightPx;
  const resolvedHeightPx = options?.exactLineHeight
    ? safeHeightPx
    : Math.max(safeHeightPx, candidateHeightPx);
  const normalizedExclusions = (exclusions ?? []).map((exclusion) => ({
    left: exclusion.left,
    right: exclusion.right,
    top: exclusion.top,
    bottom: exclusion.bottom,
  }));
  const markItem: PretextLayoutItem = {
    ...mark,
    text: "",
    startOffset: 0,
    endOffset: 0,
  };
  const fragment: PretextLineFragment = {
    text: "",
    width: 0,
    x: 0,
    intervalX: 0,
    intervalWidth: safeWidthPx,
    startOffset: 0,
    endOffset: 0,
    font: mark.font,
    strutFont: mark.strutFont,
    verticalAlign: mark.verticalAlign,
    lineHeightPx: resolvedHeightPx,
    hasCustomVerticalMetrics: mark.verticalMetrics !== undefined,
    ...itemLineMetrics(markItem, resolvedHeightPx),
  };
  const row = createLine(
    0,
    [fragment],
    mark.strutFont ?? mark.font,
    safeHeightPx,
    options?.exactLineHeight
  );
  const rowHeightPx = row.height ?? resolvedHeightPx;
  let interval = rowWidthsAtY(
    safeWidthPx,
    rowHeightPx,
    row.y,
    normalizedExclusions
  )[0];
  while (!interval) {
    row.y += rowHeightPx;
    interval = rowWidthsAtY(
      safeWidthPx,
      rowHeightPx,
      row.y,
      normalizedExclusions
    )[0];
  }
  fragment.x = interval.x;
  fragment.intervalX = interval.x;
  fragment.intervalWidth = interval.width;
  return {
    text,
    font: mark.font,
    lineCount: 1,
    lines: [row],
    height: Math.max(
      row.y + rowHeightPx,
      ...normalizedExclusions.map((exclusion) => exclusion.bottom)
    ),
    containerWidthPx: safeWidthPx,
    lineHeightPx: safeHeightPx,
    exclusions: normalizedExclusions,
  };
}

function endingMarkCacheKey(mark?: PretextEndingMarkMetrics): string {
  return mark
    ? `${mark.sourceOffset},${mark.font},${mark.strutFont ?? ""},${mark.lineHeightPx ?? ""},${mark.verticalAlign ?? ""},${mark.verticalMetrics?.ascent ?? ""},${mark.verticalMetrics?.descent ?? ""}`
    : "";
}

function appendTrailingHardBreakLine(
  lines: PretextLineLayout[],
  text: string,
  font: string,
  containerWidthPx: number,
  lineHeightPx: number,
  exclusions: PretextExclusionRect[],
  options?: PretextParagraphLineOptions
): void {
  const lastLine = lines[lines.length - 1];
  const lastFragment = lastLine?.fragments[lastLine.fragments.length - 1];
  if (
    !lastLine ||
    lastFragment?.hardBreakOffset === undefined ||
    lastFragment.endOffset !== text.length
  ) {
    return;
  }

  const mark = options?.endingMark?.sourceOffset === text.length
    ? options.endingMark
    : undefined;
  const fragment: PretextLineFragment = {
    ...lastFragment,
    ...(mark
      ? {
          font: mark.font,
          strutFont: mark.strutFont,
          verticalAlign: mark.verticalAlign,
          lineHeightPx: mark.lineHeightPx ?? lineHeightPx,
          hasCustomVerticalMetrics: mark.verticalMetrics !== undefined,
          ...itemLineMetrics(
            { ...mark, text: "", startOffset: text.length, endOffset: text.length },
            mark.lineHeightPx ?? lineHeightPx
          ),
        }
      : {}),
    text: "",
    width: 0,
    startOffset: text.length,
    endOffset: text.length,
    hardBreakOffset: undefined,
  };
  const row = createLine(
    lastLine.y + (lastLine.height ?? lineHeightPx),
    [fragment],
    font,
    lineHeightPx,
    options?.exactLineHeight
  );
  const rowHeightPx = Math.max(1, row.height ?? lineHeightPx);
  let interval = rowWidthsAtY(containerWidthPx, rowHeightPx, row.y, exclusions)[0];
  while (!interval) {
    row.y += rowHeightPx;
    interval = rowWidthsAtY(containerWidthPx, rowHeightPx, row.y, exclusions)[0];
  }
  fragment.x = interval.x;
  fragment.intervalX = interval.x;
  fragment.intervalWidth = interval.width;
  lines.push(row);
}

function measureOffsetWidthPx(
  font: string,
  text: string,
  offset: number,
  letterSpacingPx = 0
): number {
  if (offset <= 0 || !text) {
    return 0;
  }

  return measureTextWidthPx(
    font,
    text.slice(0, Math.max(0, Math.min(offset, text.length))),
    letterSpacingPx
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

  const sourceOffsets = sourceOffsetsByPreparedText.get(prepared);
  if (sourceOffsets) {
    const sourceOffset = (cursor: LayoutCursor): number =>
      (sourceOffsets[cursor.segmentIndex] ?? sourceOffsets[sourceOffsets.length - 1]!) +
      codeUnitOffsetAtGrapheme(
        prepared.segments[cursor.segmentIndex] ?? "",
        cursor.graphemeIndex
      );
    return sourceOffset(end) - sourceOffset(start);
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
  return `${fontMetricProfileKey()}\u0000${layoutSignature}\u0000${containerWidthPx}\u0000${lineHeightPx}\u0000${exclusionsKey}`;
}

function cachedFragmentOffsetAdvances(
  defaultFont: string,
  fragment: PretextLineFragment
): number[] {
  const cached = fragmentOffsetAdvancesByFragment.get(fragment);
  if (cached) {
    return cached;
  }

  const lastOffset = fragment.hardBreakOffset === undefined
    ? fragment.text.length
    : fragment.endOffset - fragment.startOffset;
  const advances = new Array<number>(lastOffset + 1);
  for (
    let localOffset = 0;
    localOffset <= lastOffset;
    localOffset += 1
  ) {
    advances[localOffset] = localOffset >= fragment.text.length
      ? fragment.width
      : measureOffsetWidthPx(
          fragment.font ?? defaultFont,
          fragment.text,
          localOffset,
          fragment.letterSpacingPx
        );
  }
  advances[fragment.text.length] = fragment.width;
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
    return fragment.hardBreakOffset ?? fragment.endOffset;
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

  return Math.min(bestOffset, fragment.hardBreakOffset ?? fragment.endOffset);
}

function nearestLineIndexForY(
  layout: PretextVariableWidthLayout,
  y: number
): number {
  const lineHeightPx = Math.max(1, layout.lineHeightPx ?? 1);
  if (layout.lines.length === 0) {
    return 0;
  }

  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  const containingIndex = layout.lines.findIndex(
    (line) => y >= line.y && y < line.y + (line.height ?? lineHeightPx)
  );
  if (containingIndex >= 0) return containingIndex;
  layout.lines.forEach((line, index) => {
    const centerY = line.y + (line.height ?? lineHeightPx) / 2;
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
  wordBreak: PretextWordBreak = "normal",
  letterSpacingPx = 0
): PreparedTextWithSegments | undefined {
  if (!canUsePretext()) {
    return undefined;
  }

  const cacheKey = `${font}\u0000${wordBreak}\u0000${letterSpacingPx}\u0000${text}`;
  const cached = getCachedValue(preparedTextByKey, cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const context = getMeasureContext();
    const advanceScale = context ? canvasFontAdvanceScale(context, font) : 1;
    const prepared = prepareWithSegments(text, font, {
      whiteSpace: "pre-wrap",
      wordBreak,
      letterSpacing: letterSpacingPx / advanceScale,
    });
    let sourceOffset = 0;
    const sourceOffsets = prepared.segments.map((segment, index) => {
      const startOffset = sourceOffset;
      sourceOffset += prepared.kinds[index] === "hard-break" &&
        text.startsWith("\r\n", sourceOffset)
        ? 2
        : segment.length;
      return startOffset;
    });
    sourceOffsets.push(sourceOffset);
    sourceOffsetsByPreparedText.set(prepared, sourceOffsets);
    advanceScaleByPreparedText.set(prepared, advanceScale);
    preparedTextByKey.set(cacheKey, prepared);
    trimCache(preparedTextByKey, PREPARED_TEXT_CACHE_MAX_ENTRIES);
    return prepared;
  } catch {
    return undefined;
  }
}

function layoutNextLine(
  prepared: PreparedTextWithSegments,
  cursor: LayoutCursor,
  maxWidth: number
): LayoutLine | null {
  const advanceScale = advanceScaleByPreparedText.get(prepared) ?? 1;
  const line = layoutNextLineWithCanvasAdvances(
    prepared,
    cursor,
    maxWidth / advanceScale
  );
  return line && advanceScale !== 1
    ? { ...line, width: line.width * advanceScale }
    : line;
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
    letterSpacingPx?: number;
  }
): number | undefined {
  if (!text) {
    return 0;
  }

  const wordBreak = options?.wordBreak ?? "normal";
  const letterSpacingPx = options?.letterSpacingPx ?? 0;
  const safeWidth = Math.max(1, containerWidthPx);
  const cacheKey =
    `line-count\u0000${font}\u0000${wordBreak}\u0000${letterSpacingPx}` +
    `\u0000${safeWidth}\u0000${text}`;
  const cached = getCachedValue(lineCountByKey, cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const prepared = prepareCached(text, font, wordBreak, letterSpacingPx);
  if (!prepared) {
    return undefined;
  }

  try {
    const advanceScale = advanceScaleByPreparedText.get(prepared) ?? 1;
    const lineCount = measureLineStats(
      prepared,
      safeWidth / advanceScale
    ).lineCount + (prepared.kinds[prepared.kinds.length - 1] === "hard-break" ? 1 : 0);
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

interface PretextLexicalSpan {
  startOffset: number;
  endOffset: number;
}

function richTextLexicalSpans(
  text: string,
  items: PretextLayoutItem[]
): PretextLexicalSpan[] {
  if (items.length < 2 || !items[0]) return [];
  const prepared = prepareCached(text, items[0].font, items[0].wordBreak);
  if (!prepared) return [];
  const sourceOffsets = sourceOffsetsByPreparedText.get(prepared);
  if (!sourceOffsets && prepared.segments.join("") !== text) return [];

  const spans: PretextLexicalSpan[] = [];
  let sourceOffset = 0;
  prepared.segments.forEach((segment, segmentIndex) => {
    sourceOffset = sourceOffsets?.[segmentIndex] ?? sourceOffset;
    const kind = prepared.kinds[segmentIndex];
    if (kind === "text" || kind === "glue") {
      const ends = [
        ...(prepared.breakablePreferredBreaks[segmentIndex] ?? []).map(
          (offset) => codeUnitOffsetAtGrapheme(segment, offset)
        ),
        segment.length,
      ].filter((offset, index, all) =>
        offset > 0 && offset <= segment.length && all.indexOf(offset) === index
      ).sort((a, b) => a - b);
      let localStart = 0;
      for (const localEnd of ends) {
        spans.push({
          startOffset: sourceOffset + localStart,
          endOffset: sourceOffset + localEnd,
        });
        localStart = localEnd;
      }
    }
    sourceOffset += segment.length;
  });
  return spans;
}

function preparedCursorAtCodeUnitOffset(
  prepared: PreparedTextWithSegments,
  offset: number
): LayoutCursor | undefined {
  let segmentStart = 0;
  const sourceOffsets = sourceOffsetsByPreparedText.get(prepared);
  for (
    let segmentIndex = 0;
    segmentIndex < prepared.segments.length;
    segmentIndex += 1
  ) {
    segmentStart = sourceOffsets?.[segmentIndex] ?? segmentStart;
    const segment = prepared.segments[segmentIndex] ?? "";
    if (offset === segmentStart) return { segmentIndex, graphemeIndex: 0 };
    if (offset < segmentStart + segment.length) {
      const graphemeIndex = graphemeCodeUnitOffsets(segment).indexOf(
        offset - segmentStart
      );
      return graphemeIndex >= 0 ? { segmentIndex, graphemeIndex } : undefined;
    }
    segmentStart += segment.length;
  }
  segmentStart = sourceOffsets?.[prepared.segments.length] ?? segmentStart;
  return offset === segmentStart
    ? { segmentIndex: prepared.segments.length, graphemeIndex: 0 }
    : undefined;
}

function richItemCursorSourceOffset(
  items: PretextLayoutItem[],
  preparedItems: Array<PreparedTextWithSegments | undefined>,
  cursor: PretextItemCursor
): number {
  const item = items[cursor.itemIndex];
  const prepared = preparedItems[cursor.itemIndex];
  return item && prepared
    ? item.startOffset + cursorAdvanceCodeUnits(
        prepared,
        { segmentIndex: 0, graphemeIndex: 0 },
        cursor
      )
    : items[items.length - 1]?.endOffset ?? 0;
}

function rollbackRichLineToLegalBreak(
  items: PretextLayoutItem[],
  preparedItems: Array<PreparedTextWithSegments | undefined>,
  start: PretextItemCursor,
  line: InternalPretextItemLine,
  lexicalSpans: PretextLexicalSpan[]
): InternalPretextItemLine {
  const sourceStart = richItemCursorSourceOffset(items, preparedItems, start);
  const sourceEnd = richItemCursorSourceOffset(items, preparedItems, line.end);
  let low = 0;
  let high = lexicalSpans.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (lexicalSpans[middle]!.endOffset <= sourceEnd) low = middle + 1;
    else high = middle;
  }
  const span = lexicalSpans[low];
  if (
    !span || span.startOffset <= sourceStart ||
    span.startOffset >= sourceEnd || sourceEnd >= span.endOffset
  ) {
    return line;
  }

  if (items.some((item) =>
    item.startOffset < span.endOffset && item.endOffset > span.startOffset &&
    (item.break === "never" || item.endOffset - item.startOffset !== item.text.length)
  )) {
    return line;
  }

  const fragments: InternalPretextItemLineFragment[] = [];
  let end: PretextItemCursor | undefined;
  for (const fragment of line.fragments) {
    const item = items[fragment.itemIndex];
    const prepared = preparedItems[fragment.itemIndex];
    if (!item || !prepared) return line;
    const fragmentStart = item.startOffset + cursorAdvanceCodeUnits(
      prepared, { segmentIndex: 0, graphemeIndex: 0 }, fragment.start
    );
    if (fragmentStart >= span.startOffset) break;
    const fragmentEnd = item.startOffset + cursorAdvanceCodeUnits(
      prepared, { segmentIndex: 0, graphemeIndex: 0 }, fragment.end
    );
    if (fragmentEnd <= span.startOffset) {
      fragments.push(fragment);
      end = { itemIndex: fragment.itemIndex, ...fragment.end };
      continue;
    }
    const trimmedEnd = preparedCursorAtCodeUnitOffset(
      prepared, span.startOffset - item.startOffset
    );
    if (!trimmedEnd || fragmentEnd - fragmentStart !== fragment.text.length) {
      return line;
    }
    const text = fragment.text.slice(0, span.startOffset - fragmentStart);
    fragments.push({
      ...fragment,
      text,
      end: trimmedEnd,
      width: measureTextWidthPx(item.font, text, item.letterSpacingPx),
    });
    end = { itemIndex: fragment.itemIndex, ...trimmedEnd };
    break;
  }
  return fragments.some((fragment) =>
    fragment.width > 1e-7 && /\S/u.test(fragment.text)
  ) && end
    ? {
        fragments,
        end: normalizeItemCursor(preparedItems, end),
        endsAtHardBreak: false,
      }
    : line;
}

function layoutNextItemLine(
  items: PretextLayoutItem[],
  preparedItems: Array<PreparedTextWithSegments | undefined>,
  start: PretextItemCursor,
  maxWidth: number,
  lexicalSpans: PretextLexicalSpan[]
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

    const previousFragment = fragments[fragments.length - 1];
    if (
      item.break !== "never" &&
      previousFragment &&
      /[ \t]$/.test(previousFragment.text) &&
      cursorSplitsLeadingBreakableSegment(
        prepared,
        itemCursor,
        remainingItemLine.end
      )
    ) {
      const fullWidthLine = layoutNextLine(prepared, itemCursor, safeMaxWidth);
      if (
        fullWidthLine &&
        !cursorSplitsLeadingBreakableSegment(
          prepared,
          itemCursor,
          fullWidthLine.end
        )
      ) {
        break;
      }
    }

    const occupiedWidth =
      item.break === "never" && Number.isFinite(item.widthPx)
        ? Math.max(0, item.widthPx as number)
        : remainingItemLine.width;
    const terminalSegmentIndex = remainingItemLine.end.segmentIndex - 1;
    const terminalKind = prepared.kinds[terminalSegmentIndex];
    const terminalFitAdvance = prepared.lineEndFitAdvances[terminalSegmentIndex];
    const terminalPaintAdvance = prepared.lineEndPaintAdvances[terminalSegmentIndex];
    const hangingSpaceAdjustment =
      item.break !== "never" &&
      remainingItemLine.end.graphemeIndex === 0 &&
      (terminalKind === "space" || terminalKind === "preserved-space") &&
      Number.isFinite(terminalFitAdvance) &&
      Number.isFinite(terminalPaintAdvance)
        ? Math.max(0, terminalPaintAdvance! - terminalFitAdvance!) *
          (advanceScaleByPreparedText.get(prepared) ?? 1)
        : 0;
    const overflowsCurrentLine =
      fragments.length > 0 &&
      atItemStart &&
      occupiedWidth - hangingSpaceAdjustment > remainingWidth + 0.5;
    if (overflowsCurrentLine) {
      break;
    }

    fragments.push({
      itemIndex: current.itemIndex,
      text: remainingItemLine.text,
      width: occupiedWidth,
      font: item.font,
      start: itemCursor,
      end: remainingItemLine.end,
    });

    remainingWidth = Math.max(0, remainingWidth - occupiedWidth);

    if (remainingItemLine.end.segmentIndex >= prepared.segments.length) {
      current.itemIndex += 1;
      current.segmentIndex = 0;
      current.graphemeIndex = 0;
      if (
        remainingWidth <= 0.5 ||
        cursorEndedAtHardBreak(prepared, remainingItemLine.end)
      ) {
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

  const lastFragment = fragments[fragments.length - 1]!;
  const lastPrepared = preparedItems[lastFragment.itemIndex];
  return rollbackRichLineToLegalBreak(
    items,
    preparedItems,
    start,
    {
      end: normalizeItemCursor(preparedItems, current),
      fragments,
      endsAtHardBreak: Boolean(
        lastPrepared && cursorEndedAtHardBreak(lastPrepared, lastFragment.end)
      ),
    },
    lexicalSpans
  );
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

function hardBreakOffsetAtCursor(
  prepared: PreparedTextWithSegments,
  cursor: LayoutCursor,
  endOffset: number
): number | undefined {
  if (!cursorEndedAtHardBreak(prepared, cursor)) return undefined;
  return endOffset - cursorAdvanceCodeUnits(
    prepared,
    { segmentIndex: cursor.segmentIndex - 1, graphemeIndex: 0 },
    cursor
  );
}

function joinSplitCarriageReturns(items: PretextLayoutItem[]): PretextLayoutItem[] {
  let result = items;
  let previousIndex = -1;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (!item.text) continue;
    const previous = result[previousIndex];
    if (
      previous?.text.endsWith("\r") &&
      item.text.startsWith("\n") &&
      previous.endOffset === item.startOffset
    ) {
      if (result === items) result = [...items];
      result[previousIndex] = {
        ...previous,
        text: `${previous.text}\n`,
        endOffset: previous.endOffset + 1,
      };
      result[index] = { ...item, text: item.text.slice(1), startOffset: item.startOffset + 1 };
    }
    if (result[index]!.text) previousIndex = index;
  }
  return result;
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
  const safeContainerWidthPx = Math.max(0, containerWidthPx);
  let intervals = [
    {
      x: 0,
      width: safeContainerWidthPx,
    },
  ];

  const rowBottomPx = rowTopPx + Math.max(1, lineHeightPx);
  for (const exclusion of exclusions) {
    const overlapsExclusion =
      rowBottomPx > exclusion.top && rowTopPx < exclusion.bottom;
    if (!overlapsExclusion) {
      continue;
    }

    const exclusionLeftPx = Math.max(
      0,
      Math.min(safeContainerWidthPx, exclusion.left)
    );
    const exclusionRightPx = Math.max(
      exclusionLeftPx,
      Math.min(safeContainerWidthPx, exclusion.right)
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
  options?: PretextParagraphLineOptions & {
    wordBreak?: PretextWordBreak;
    letterSpacingPx?: number;
  }
): PretextVariableWidthLayout | undefined {
  if (!text) {
    const endingMarkLayout = layoutEmptyParagraphWithEndingMark(
      text,
      containerWidthPx,
      lineHeightPx,
      exclusions,
      options
    );
    if (endingMarkLayout) return endingMarkLayout;
    return {
      lineCount: 0,
      height: Math.max(
        0,
        ...(exclusions ?? []).map((exclusion) => exclusion.bottom)
      ),
      lines: [],
      text,
      font,
      containerWidthPx: Math.max(1, containerWidthPx),
      lineHeightPx: Math.max(1, lineHeightPx),
      exclusions: (exclusions ?? []).map((exclusion) => ({
        left: exclusion.left,
        right: exclusion.right,
        top: exclusion.top,
        bottom: exclusion.bottom,
      })),
    };
  }

  const wordBreak = options?.wordBreak ?? "normal";
  const letterSpacingPx = options?.letterSpacingPx ?? 0;
  const prepared = prepareCached(text, font, wordBreak, letterSpacingPx);
  if (!prepared) {
    return undefined;
  }

  const safeContainerWidthPx = Math.max(1, containerWidthPx);
  const safeLineHeightPx = Math.max(1, lineHeightPx);
  const normalizedExclusions = (exclusions ?? []).map((exclusion) => ({
    left: exclusion.left,
    right: exclusion.right,
    top: exclusion.top,
    bottom: exclusion.bottom,
  }));
  const cacheKey = layoutCacheKey(
    `plain\u0000${font}\u0000${wordBreak}\u0000${letterSpacingPx}\u0000${options?.exactLineHeight === true}\u0000${endingMarkCacheKey(options?.endingMark)}\u0000${text}`,
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
        (fragments.length > 0 && cursorEndedAtHardBreak(prepared, cursor))
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
          hardBreakOffset: hardBreakOffsetAtCursor(
            prepared,
            line.end,
            consumedOffset + cursorAdvanceCodeUnits(prepared, cursor, line.end)
          ),
          font,
          letterSpacingPx,
          lineHeightPx: safeLineHeightPx,
          ...fontLineMetrics(font, safeLineHeightPx),
        });
        consumedOffset += cursorAdvanceCodeUnits(prepared, cursor, line.end);
        cursor = line.end;
      }
    }

    if (fragments.length === 0) {
      break;
    }

    const row = createLine(
      rowTopPx,
      fragments,
      font,
      safeLineHeightPx,
      options?.exactLineHeight
    );
    lines.push(row);
    rowTopPx += row.height ?? safeLineHeightPx;
  }

  appendTrailingHardBreakLine(
    lines,
    text,
    font,
    safeContainerWidthPx,
    safeLineHeightPx,
    normalizedExclusions,
    options
  );
  const lineCount = lines.length;
  const lastLine = lines[lines.length - 1];
  const contentBottomPx = lastLine
    ? lastLine.y + (lastLine.height ?? safeLineHeightPx)
    : 0;
  const nextLayout: PretextVariableWidthLayout = {
    lineCount,
    height: Math.max(
      contentBottomPx,
      ...normalizedExclusions.map((exclusion) => exclusion.bottom),
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
  fallbackFont?: string,
  options?: PretextParagraphLineOptions
): PretextVariableWidthLayout | undefined {
  if (!text) {
    const endingMarkLayout = layoutEmptyParagraphWithEndingMark(
      text,
      containerWidthPx,
      lineHeightPx,
      exclusions,
      options
    );
    if (endingMarkLayout) return endingMarkLayout;
    return {
      lineCount: 0,
      height: Math.max(
        0,
        ...(exclusions ?? []).map((exclusion) => exclusion.bottom)
      ),
      lines: [],
      text,
      font: fallbackFont,
      containerWidthPx: Math.max(1, containerWidthPx),
      lineHeightPx: Math.max(1, lineHeightPx),
      exclusions: (exclusions ?? []).map((exclusion) => ({
        left: exclusion.left,
        right: exclusion.right,
        top: exclusion.top,
        bottom: exclusion.bottom,
      })),
    };
  }

  if (!canUsePretext()) {
    return undefined;
  }

  items = joinSplitCarriageReturns(items);
  const preparedItems = items.map((item) =>
    prepareCached(
      item.text,
      item.font,
      item.wordBreak ?? "normal",
      item.letterSpacingPx
    )
  );
  if (
    preparedItems.some(
      (prepared, index) => !prepared && items[index]?.text.length
    )
  ) {
    return undefined;
  }

  const safeContainerWidthPx = Math.max(1, containerWidthPx);
  const safeLineHeightPx = Math.max(1, lineHeightPx);
  const normalizedExclusions = (exclusions ?? []).map((exclusion) => ({
    left: exclusion.left,
    right: exclusion.right,
    top: exclusion.top,
    bottom: exclusion.bottom,
  }));
  const layoutSignature = items
    .map(
      (item) =>
        `${item.font}\u0001${item.break ?? "normal"}\u0001${
          item.wordBreak ?? "normal"
        }\u0001${item.letterSpacingPx ?? 0}\u0001${
          item.lineHeightPx ?? ""
        }\u0001${item.strutFont ?? ""}\u0001${item.verticalAlign ?? ""}\u0001${
          item.widthPx ?? ""
        }\u0001${item.verticalMetrics?.ascent ?? ""},${
          item.verticalMetrics?.descent ?? ""
        }\u0001${item.startOffset}\u0001${item.endOffset}\u0001${item.text}`
    )
    .join("\u0002");
  const cacheKey = layoutCacheKey(
    `items\u0000${fallbackFont ?? ""}\u0000${options?.exactLineHeight === true}\u0000${endingMarkCacheKey(options?.endingMark)}\u0000${layoutSignature}`,
    safeContainerWidthPx,
    safeLineHeightPx,
    normalizedExclusions
  );
  const cachedLayout = getCachedValue(layoutByKey, cacheKey);
  if (cachedLayout) {
    return cachedLayout;
  }

  const lexicalSpans = richTextLexicalSpans(text, items);
  const lines: PretextLineLayout[] = [];
  const consumedOffsetsByItemIndex = items.map(() => 0);
  let cursor: PretextItemCursor = {
    itemIndex: 0,
    segmentIndex: 0,
    graphemeIndex: 0,
  };
  let rowTopPx = 0;
  let rowHeightPx = safeLineHeightPx;

  while (!itemCursorIsDone(preparedItems, cursor)) {
    cursor = normalizeItemCursor(preparedItems, cursor);
    const rowStartCursor = cloneItemCursor(cursor);
    const rowStartOffsets =
      normalizedExclusions.length > 0
        ? [...consumedOffsetsByItemIndex]
        : undefined;
    const rowIntervals = rowWidthsAtY(
      safeContainerWidthPx,
      rowHeightPx,
      rowTopPx,
      normalizedExclusions
    );
    const fragments: PretextLineFragment[] = [];

    if (rowIntervals.length === 0) {
      rowTopPx += safeLineHeightPx;
      rowHeightPx = safeLineHeightPx;
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
        interval.width,
        lexicalSpans
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
          hardBreakOffset: hardBreakOffsetAtCursor(prepared, lineFragment.end, endOffset),
          font: lineFragment.font,
          strutFont: item.strutFont,
          letterSpacingPx: item.letterSpacingPx,
          lineHeightPx: item.lineHeightPx ?? safeLineHeightPx,
          verticalAlign: item.verticalAlign,
          hasCustomVerticalMetrics: item.verticalMetrics !== undefined,
          ...itemLineMetrics(item, item.lineHeightPx ?? safeLineHeightPx),
        });

        consumedOffsetsByItemIndex[lineFragment.itemIndex] =
          (consumedOffsetsByItemIndex[lineFragment.itemIndex] ?? 0) +
          consumedCodeUnits;
        nextFragmentX += lineFragment.width;
      }

      cursor = line.end;
      if (line.endsAtHardBreak) {
        break;
      }
    }

    if (fragments.length === 0) {
      break;
    }

    const row = createLine(
      rowTopPx,
      fragments,
      fallbackFont ?? items[0]?.font ?? "",
      safeLineHeightPx,
      options?.exactLineHeight
    );
    if (
      rowStartOffsets &&
      (row.height ?? safeLineHeightPx) > rowHeightPx + 1e-7
    ) {
      cursor = rowStartCursor;
      rowStartOffsets.forEach((offset, index) => {
        consumedOffsetsByItemIndex[index] = offset;
      });
      rowHeightPx = row.height ?? safeLineHeightPx;
      continue;
    }
    lines.push(row);
    rowTopPx += row.height ?? safeLineHeightPx;
    rowHeightPx = safeLineHeightPx;
  }

  appendTrailingHardBreakLine(
    lines,
    text,
    fallbackFont ?? items[0]?.font ?? "",
    safeContainerWidthPx,
    safeLineHeightPx,
    normalizedExclusions,
    options
  );
  const lineCount = lines.length;
  const lastLine = lines[lines.length - 1];
  const contentBottomPx = lastLine
    ? lastLine.y + (lastLine.height ?? safeLineHeightPx)
    : 0;
  const nextLayout: PretextVariableWidthLayout = {
    lineCount,
    height: Math.max(
      contentBottomPx,
      ...normalizedExclusions.map((exclusion) => exclusion.bottom),
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
    return lastFragment.hardBreakOffset ?? lastFragment.endOffset;
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

  return Math.max(0, Math.min(textLength, lastFragment.hardBreakOffset ?? lastFragment.endOffset));
}

export function resolveCaretPositionAtPoint(
  layout: PretextVariableWidthLayout,
  x: number,
  y: number
): { offset: number; affinity: PretextCaretAffinity } {
  const offset = resolveOffsetAtPoint(layout, x, y);
  const line = layout.lines[nearestLineIndexForY(layout, y)];
  const lastFragment = line?.fragments.at(-1);
  return {
    offset,
    affinity:
      lastFragment?.hardBreakOffset === undefined &&
      lastFragment?.endOffset === offset
        ? "upstream"
        : "downstream",
  };
}

export function resolveCaretRectAtOffset(
  layout: PretextVariableWidthLayout,
  offset: number,
  options?: { affinity?: PretextCaretAffinity }
): PretextSelectionRect | undefined {
  if (layout.lines.length === 0) {
    return undefined;
  }

  const safeOffset = Math.max(
    0,
    Math.min(Math.round(offset), layout.text?.length ?? 0)
  );
  if (options?.affinity && layout.unslicedLayout && layout.sourceLineRange) {
    const fullLayout = layout.unslicedLayout;
    const fullCaret = resolveCaretRectAtOffset(fullLayout, safeOffset, options);
    if (!fullCaret) return undefined;
    const fullLineIndex = fullLayout.lines.findIndex(
      (line) => line.y === fullCaret.top
    );
    const { startLineIndex, endLineIndex } = layout.sourceLineRange;
    if (fullLineIndex < startLineIndex || fullLineIndex >= endLineIndex) {
      return undefined;
    }
    return {
      ...fullCaret,
      top: fullCaret.top - (fullLayout.lines[startLineIndex]?.y ?? 0),
    };
  }
  const sourceRange = layout.sourceRange;
  if (
    sourceRange &&
    (safeOffset < sourceRange.startOffset ||
      safeOffset > sourceRange.endOffset ||
      (safeOffset === sourceRange.endOffset && !sourceRange.includesEnd))
  ) {
    return undefined;
  }
  const lineHeightPx = Math.max(1, layout.lineHeightPx ?? 1);

  let preferredLineIndex: number | undefined;
  if (options?.affinity) {
    for (let lineIndex = 1; lineIndex < layout.lines.length; lineIndex += 1) {
      const previousLast = layout.lines[lineIndex - 1]?.fragments.at(-1);
      const nextFirst = layout.lines[lineIndex]?.fragments[0];
      if (
        previousLast?.hardBreakOffset === undefined &&
        previousLast?.endOffset === safeOffset &&
        nextFirst?.startOffset === safeOffset
      ) {
        preferredLineIndex = options.affinity === "upstream"
          ? lineIndex - 1 : lineIndex;
        break;
      }
    }
  }
  for (let lineIndex = 0; lineIndex < layout.lines.length; lineIndex += 1) {
    if (preferredLineIndex !== undefined && lineIndex !== preferredLineIndex) {
      continue;
    }
    const line = layout.lines[lineIndex]!;
    for (const fragment of line.fragments) {
      if (
        safeOffset < fragment.startOffset ||
        safeOffset > fragment.endOffset ||
        (fragment.hardBreakOffset !== undefined && safeOffset === fragment.endOffset)
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
        height: line.height ?? lineHeightPx,
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
    height: lastLine.height ?? lineHeightPx,
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

  const lineHeightPx = Math.max(1, layout.lineHeightPx ?? 1);
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
        height: line.height ?? lineHeightPx,
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
  const lineHeightPx = Math.max(1, layout.lineHeightPx ?? 1);
  const height =
    normalizedLines.length > 0
      ? (normalizedLines[normalizedLines.length - 1]?.y ?? 0) +
        (normalizedLines[normalizedLines.length - 1]?.height ?? lineHeightPx)
      : 0;

  return {
    ...layout,
    lineCount: normalizedLines.length,
    height,
    lines: normalizedLines,
    sourceRange: {
      startOffset: normalizedLines[0]?.fragments[0]?.startOffset ?? layout.text?.length ?? 0,
      endOffset: normalizedLines[normalizedLines.length - 1]?.fragments.at(-1)?.endOffset ?? layout.text?.length ?? 0,
      includesEnd: safeEnd === layout.lines.length && layout.sourceRange?.includesEnd !== false,
    },
    sourceLineRange: {
      startLineIndex: (layout.sourceLineRange?.startLineIndex ?? 0) + safeStart,
      endLineIndex: (layout.sourceLineRange?.startLineIndex ?? 0) + safeEnd,
    },
    unslicedLayout: layout.unslicedLayout ?? layout,
  };
}
