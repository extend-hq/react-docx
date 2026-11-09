import {
  clearCache,
  layoutNextLine as layoutNextLineWithCanvasAdvances,
  measureLineStats,
  prepareWithSegments,
  type LayoutCursor,
  type LayoutLine,
  type PreparedTextWithSegments,
} from "@chenglou/pretext";
import {
  layoutNextRichInlineLineRange,
  materializeRichInlineLineRange,
  prepareRichInline,
  type PreparedRichInline,
  type RichInlineCursor,
  type RichInlineLine,
} from "@chenglou/pretext/rich-inline";
import { registerFontMetricCache } from "./font-metrics";
import { canvasFontAdvanceScale } from "./font-advances";
import type { FontKerningMode } from "./font-kerning";
import { createDocxTextMeasurementContext, setCanvasFontFeatureSettings } from "./font-features";
import {
  aggregateLineMetrics,
  type LineElementMetrics,
} from "@extend-ai/react-docx-layout-engine";

const PREPARED_TEXT_CACHE_MAX_ENTRIES = 8192;
const LAYOUT_CACHE_MAX_ENTRIES = 4096;
const LINE_COUNT_CACHE_MAX_ENTRIES = 16384;

const preparedTextByKey = new Map<string, PreparedTextWithSegments>();
const preparedRichTextByKey = new Map<string, PreparedRichInline>();
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
  preparedRichTextByKey.clear();
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
  fontKerning?: FontKerningMode;
  fontFeatureSettings?: string;
  textTransform?: "uppercase";
  horizontalScale?: number;
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
  lineGrid?: { pitchPx: number; minimumHeightPx?: number };
}

export interface PretextExclusionRect {
  anchorColumnLeftPx?: number;
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
  discretionaryHyphenOffset?: number;
  font?: string;
  strutFont?: string;
  letterSpacingPx?: number;
  fontKerning?: FontKerningMode;
  fontFeatureSettings?: string;
  textTransform?: "uppercase";
  horizontalScale?: number;
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

/** Repositions baselines without changing line bands or fragment metrics. */
export function withFixedLineBaseline(
  layout: PretextVariableWidthLayout,
  fallbackLineHeightPx: number,
  baselineFraction: number
): PretextVariableWidthLayout {
  if (!Number.isFinite(baselineFraction) || baselineFraction < 0 || baselineFraction > 1) {
    return layout;
  }
  const transformed = new WeakMap<PretextVariableWidthLayout, PretextVariableWidthLayout>();
  const active = new WeakSet<PretextVariableWidthLayout>();
  const transform = (source: PretextVariableWidthLayout): PretextVariableWidthLayout => {
    const cached = transformed.get(source);
    if (cached) return cached;
    const result: PretextVariableWidthLayout = {
      ...source,
      lines: source.lines.map((line) => {
        const heightPx = Number.isFinite(line.height)
          ? line.height as number
          : fallbackLineHeightPx;
        if (!Number.isFinite(heightPx) || heightPx <= 0) return line;
        const ascent = heightPx * baselineFraction;
        return { ...line, ascent, descent: heightPx - ascent };
      }),
    };
    transformed.set(source, result);
    active.add(source);
    if (source.unslicedLayout) {
      if (active.has(source.unslicedLayout)) delete result.unslicedLayout;
      else result.unslicedLayout = transform(source.unslicedLayout);
    }
    active.delete(source);
    return result;
  };
  return transform(layout);
}

export function withPretextHorizontalAlignment(
  layout: PretextVariableWidthLayout,
  align: "center" | "right"
): PretextVariableWidthLayout {
  return {
    ...layout,
    horizontalAlignmentApplied: align,
    lines: layout.lines.map((line) => {
      const byInterval = new Map<string, PretextLineFragment[]>();
      for (const fragment of line.fragments) {
        const key = `${fragment.intervalX}:${fragment.intervalWidth}`;
        const group = byInterval.get(key) ?? [];
        group.push(fragment);
        byInterval.set(key, group);
      }
      const shifts = new Map<PretextLineFragment, number>();
      for (const group of byInterval.values()) {
        const first = group[0]!;
        let right = first.x;
        for (const fragment of group) {
          const visibleLength = fragment.text.replace(/[ \t\r\n]+$/, "").length;
          if (visibleLength === 0) continue;
          const advance = cachedFragmentOffsetAdvances(layout.font ?? "", fragment)[visibleLength];
          right = fragment.x + (advance ?? fragment.width);
        }
        const remaining = Math.max(0, first.intervalWidth - (right - first.x));
        const shift = first.intervalX - first.x + remaining * (align === "center" ? 0.5 : 1);
        for (const fragment of group) shifts.set(fragment, shift);
      }
      return {
        ...line,
        fragments: line.fragments.map((fragment) => ({
          ...fragment,
          x: fragment.x + (shifts.get(fragment) ?? 0),
        })),
      };
    }),
  };
}

export type PretextCaretAffinity = "upstream" | "downstream";

export interface PretextVariableWidthLayout {
  horizontalAlignmentApplied?: "center" | "right";
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

let measureCanvasContext:
  | OffscreenCanvasRenderingContext2D
  | CanvasRenderingContext2D
  | null
  | undefined;
let graphemeSegmenter: Intl.Segmenter | undefined;

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
  if (!canUsePretext()) return undefined;
  if (!measureCanvasContext) {
    measureCanvasContext = createDocxTextMeasurementContext();
  }
  return measureCanvasContext ?? undefined;
}

export function resolveHorizontalTextScale(percent: number | undefined): number {
  return Number.isInteger(percent) && percent! >= 1 && percent! <= 600
    ? percent! / 100 : 1;
}

function validHorizontalScale(value = 1): number {
  return Number.isFinite(value) && value > 0 && value <= 6 ? value : 1;
}

function measureTextWidthPx(
  font: string,
  text: string,
  letterSpacingPx = 0,
  fontKerning: FontKerningMode = "auto",
  fontFeatureSettings?: string,
  textTransform?: "uppercase",
  horizontalScale = 1
): number {
  if (!text) {
    return 0;
  }
  if (textTransform === "uppercase") text = text.toUpperCase();

  const context = getMeasureContext();
  if (!context) {
    return 0;
  }

  setCanvasFontFeatureSettings(context, fontFeatureSettings);
  context.font = font;
  if ("fontKerning" in context) context.fontKerning = fontKerning;
  const advanceScale = canvasFontAdvanceScale(context, font);
  const horizontalAdvanceScale = advanceScale * validHorizontalScale(horizontalScale);
  const spacingAdvance =
    Math.max(0, graphemeCodeUnitOffsets(text).length - 1) * letterSpacingPx;
  if (typeof context.letterSpacing === "string") {
    context.letterSpacing = `${letterSpacingPx / horizontalAdvanceScale}px`;
    return Math.max(0, context.measureText(text).width * horizontalAdvanceScale);
  }
  return Math.max(
    0,
    context.measureText(text).width * horizontalAdvanceScale + spacingAdvance
  );
}

function fontMetricProfileKey(): string {
  const ratio = typeof window !== "undefined" ? window.devicePixelRatio : 1;
  const viewportScale =
    typeof window !== "undefined" ? window.visualViewport?.scale ?? 1 : 1;
  const hasDom = typeof document !== "undefined" && Boolean(document.body);
  return [ratio, viewportScale, hasDom].join("\u0000");
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
    setCanvasFontFeatureSettings(context);
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
      setCanvasFontFeatureSettings(context);
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

export function resolveLineGridHeightPx(
  naturalHeightPx: number,
  pitchPx: number,
  minimumHeightPx = pitchPx
): number {
  if (!Number.isFinite(pitchPx) || pitchPx <= 0) return naturalHeightPx;
  return Math.max(
    Math.ceil(Math.max(0, naturalHeightPx) / pitchPx - 1e-7) * pitchPx,
    minimumHeightPx
  );
}

function createLine(
  y: number,
  fragments: PretextLineFragment[],
  font: string,
  lineHeightPx: number,
  options?: PretextParagraphLineOptions
): PretextLineLayout {
  const exactLineHeight = options?.exactLineHeight === true;
  const lineGrid = !exactLineHeight && options?.lineGrid &&
    Number.isFinite(options.lineGrid.pitchPx) && options.lineGrid.pitchPx > 0
      ? options.lineGrid : undefined;
  if (lineGrid) {
    fragments = fragments.map((fragment) => {
      if (fragment.hasCustomVerticalMetrics) return fragment;
      const fragmentFont = fragment.font ?? font;
      const naturalHeightPx = measureFontNaturalLineHeightPx(
        fragment.strutFont ?? fragmentFont
      ) ?? fragment.lineHeightPx ?? lineHeightPx;
      return Object.assign(fragment, {
        lineHeightPx: naturalHeightPx,
        ...itemLineMetrics({ ...fragment, font: fragmentFont }, naturalHeightPx),
      });
    });
  }
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
  const height = lineGrid
    ? resolveLineGridHeightPx(metrics.height, lineGrid.pitchPx, lineGrid.minimumHeightPx)
    : metrics.height;
  const gridLeading = (height - metrics.height) / 2;
  return {
    y,
    fragments,
    height: exactLineHeight ? lineHeightPx : height,
    ascent: exactLineHeight ? strut.ascent : metrics.ascent + gridLeading,
    descent: exactLineHeight ? strut.descent : metrics.descent + gridLeading,
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
    options
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

function lineGridCacheKey(grid?: PretextParagraphLineOptions["lineGrid"]): string {
  return grid ? `${grid.pitchPx},${grid.minimumHeightPx ?? ""}` : "";
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
    options
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
  letterSpacingPx = 0,
  fontKerning: FontKerningMode = "auto",
  fontFeatureSettings?: string,
  textTransform?: "uppercase",
  horizontalScale = 1
): number {
  if (offset <= 0 || !text) {
    return 0;
  }

  return measureTextWidthPx(
    font,
    text.slice(0, Math.max(0, Math.min(offset, text.length))),
    letterSpacingPx,
    fontKerning,
    fontFeatureSettings,
    textTransform,
    horizontalScale
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

function trackedLigatureDomAdvances(
  font: string,
  fragment: PretextLineFragment,
  lastOffset: number
): number[] | undefined {
  if (!fragment.letterSpacingPx ||
    !/["'](?:liga|clig|dlig|hlig)["'](?:\s+(?:on|[1-9]\d*))?\s*(?:,|$)/i.test(fragment.fontFeatureSettings ?? "") ||
    typeof document === "undefined" || !document.documentElement ||
    typeof document.createElement !== "function" || typeof document.createRange !== "function") return undefined;
  const element = document.createElement("span");
  try {
    const scale = validHorizontalScale(fragment.horizontalScale);
    const rootZoomValue = typeof window !== "undefined" && typeof window.getComputedStyle === "function"
      ? Number.parseFloat(window.getComputedStyle(document.documentElement).zoom)
      : 1;
    const rootZoom = Number.isFinite(rootZoomValue) && rootZoomValue > 0 ? rootZoomValue : 1;
    element.style.cssText = "all:initial;position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;white-space:pre;display:inline-block";
    element.style.font = fragment.font ?? font;
    element.style.fontKerning = fragment.fontKerning ?? "auto";
    element.style.fontFeatureSettings = fragment.fontFeatureSettings ?? "normal";
    element.style.letterSpacing = `${fragment.letterSpacingPx / scale}px`;
    element.style.textTransform = fragment.textTransform ?? "none";
    element.textContent = fragment.text;
    document.documentElement.appendChild(element);
    const textNode = element.firstChild;
    if (!textNode) return undefined;
    const range = document.createRange();
    range.setStart(textNode, 0);
    const advances = new Array<number>(lastOffset + 1);
    const visibleEnd = fragment.hardBreakOffset === undefined
      ? fragment.text.length
      : fragment.hardBreakOffset - fragment.startOffset;
    for (let offset = 0; offset <= lastOffset; offset += 1) {
      if (offset === 0) advances[offset] = 0;
      else if (offset >= visibleEnd) advances[offset] = fragment.width;
      else {
        range.setEnd(textNode, offset);
        advances[offset] = range.getBoundingClientRect().width * scale / rootZoom;
      }
    }
    return advances;
  } catch {
    return undefined;
  } finally {
    element.remove();
  }
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
  const domAdvances = trackedLigatureDomAdvances(defaultFont, fragment, lastOffset);
  if (domAdvances) {
    fragmentOffsetAdvancesByFragment.set(fragment, domAdvances);
    return domAdvances;
  }
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
          fragment.letterSpacingPx,
          fragment.fontKerning,
          fragment.fontFeatureSettings,
          fragment.textTransform,
          fragment.horizontalScale
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
  letterSpacingPx = 0,
  fontKerning: FontKerningMode = "auto",
  fontFeatureSettings?: string,
  textTransform?: "uppercase",
  horizontalScale = 1
): PreparedTextWithSegments | undefined {
  if (!canUsePretext()) {
    return undefined;
  }

  const resolvedScale = validHorizontalScale(horizontalScale);
  const cacheKey = resolvedScale + "\u0000" + `${font}\u0000${fontKerning}\u0000${fontFeatureSettings ?? ""}\u0000${textTransform ?? ""}\u0000${wordBreak}\u0000${letterSpacingPx}\u0000${text}`;
  const cached = getCachedValue(preparedTextByKey, cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const context = getMeasureContext();
    if (context) setCanvasFontFeatureSettings(context, fontFeatureSettings);
    if (context && "fontKerning" in context) context.fontKerning = fontKerning;
    const advanceScale = context ? canvasFontAdvanceScale(context, font) : 1;
    const prepared = prepareWithSegments(text, font, {
      whiteSpace: "pre-wrap",
      wordBreak,
      letterSpacing: letterSpacingPx,
      fontKerning,
      fontFeatureSettings,
      textTransform,
      horizontalScale: advanceScale * resolvedScale,
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
  return layoutNextLineWithCanvasAdvances(prepared, maxWidth, cursor);
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
    fontKerning?: FontKerningMode;
    fontFeatureSettings?: string;
  }
): number | undefined {
  if (!text) {
    return 0;
  }

  const wordBreak = options?.wordBreak ?? "normal";
  const letterSpacingPx = options?.letterSpacingPx ?? 0;
  const fontKerning = options?.fontKerning ?? "auto";
  const fontFeatureSettings = options?.fontFeatureSettings;
  const safeWidth = Math.max(1, containerWidthPx);
  const cacheKey =
    `line-count\u0000${font}\u0000${wordBreak}\u0000${letterSpacingPx}\u0000${fontKerning}\u0000${fontFeatureSettings ?? ""}` +
    `\u0000${safeWidth}\u0000${text}`;
  const cached = getCachedValue(lineCountByKey, cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const prepared = prepareCached(text, font, wordBreak, letterSpacingPx, fontKerning, fontFeatureSettings);
  if (!prepared) {
    return undefined;
  }

  try {
    const lineCount = measureLineStats(
      prepared,
      safeWidth
    ).lineCount + (prepared.kinds[prepared.kinds.length - 1] === "hard-break" ? 1 : 0);
    lineCountByKey.set(cacheKey, lineCount);
    trimCache(lineCountByKey, LINE_COUNT_CACHE_MAX_ENTRIES);
    return lineCount;
  } catch {
    return undefined;
  }
}

function prepareRichItems(
  items: PretextLayoutItem[],
  cacheKey: string
): PreparedRichInline | undefined {
  const cached = getCachedValue(preparedRichTextByKey, cacheKey);
  if (cached) return cached;
  try {
    const context = getMeasureContext();
    const prepared = prepareRichInline(items.map((item) => {
      if (item.break === "never" && Number.isFinite(item.widthPx)) {
        return { width: Math.max(0, item.widthPx!) };
      }
      if (context) {
        setCanvasFontFeatureSettings(context, item.fontFeatureSettings);
        if ("fontKerning" in context) context.fontKerning = item.fontKerning ?? "auto";
      }
      const advanceScale = context ? canvasFontAdvanceScale(context, item.font) : 1;
      return {
        text: item.text,
        font: item.font,
        break: item.break,
        letterSpacing: item.letterSpacingPx,
        fontKerning: item.fontKerning,
        fontFeatureSettings: item.fontFeatureSettings,
        textTransform: item.textTransform,
        horizontalScale: advanceScale * validHorizontalScale(item.horizontalScale),
      };
    }), { whiteSpace: "pre-wrap", wordBreak: items[0]?.wordBreak ?? "normal" });
    preparedRichTextByKey.set(cacheKey, prepared);
    trimCache(preparedRichTextByKey, PREPARED_TEXT_CACHE_MAX_ENTRIES);
    return prepared;
  } catch {
    return undefined;
  }
}

function nextRichLine(
  prepared: PreparedRichInline,
  cursor: RichInlineCursor,
  width: number
): RichInlineLine | null {
  const range = layoutNextRichInlineLineRange(prepared, Math.max(1, width), cursor);
  return range ? materializeRichInlineLineRange(prepared, range) : null;
}

function laterIntervalKeepsLeadingText(
  prepared: PreparedRichInline,
  items: PretextLayoutItem[],
  cursor: RichInlineCursor,
  line: RichInlineLine,
  intervals: Array<{ width: number }>
): boolean {
  const first = line.fragments[0];
  const item = first && items[first.itemIndex];
  if (!first || !item || item.break === "never" || first.sourceStart > 0 ||
    first.sourceEnd >= item.text.length || intervals.length === 0) return false;
  const firstWordEnd = item.text.slice(first.sourceStart).search(/[ \t\r\n]/u);
  const minimumEnd = firstWordEnd < 0 ? item.text.length : first.sourceStart + firstWordEnd;
  return intervals.some((interval) => {
    const candidate = nextRichLine(prepared, cursor, interval.width);
    const fragment = candidate?.fragments[0];
    return fragment?.itemIndex === first.itemIndex &&
      (fragment.sourceEnd === item.text.length ||
        (first.sourceEnd < minimumEnd && fragment.sourceEnd >= minimumEnd));
  });
}

function selectedHyphenOffset(source: string, materialized: string): number | undefined {
  if (!materialized.endsWith("-")) return undefined;
  const offset = source.lastIndexOf("\u00ad");
  return offset >= 0 && /^[\u00ad\u200b]*$/.test(source.slice(offset + 1)) ? offset : undefined;
}

function sourceFragmentText(source: string, materialized: string): string {
  const offset = selectedHyphenOffset(source, materialized);
  return offset === undefined ? source : source.slice(0, offset) + "-" + source.slice(offset + 1);
}

function isInvisibleSource(text: string): boolean {
  return /^[\u00ad\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]*$/.test(text);
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


function joinContiguousShapingItems(items: PretextLayoutItem[]): PretextLayoutItem[] {
  const joined: PretextLayoutItem[] = [];
  let changed = false;
  for (const item of items) {
    const previous = joined[joined.length - 1];
    if (
      previous &&
      previous.text.length > 0 && item.text.length > 0 &&
      previous.endOffset === item.startOffset &&
      previous.endOffset - previous.startOffset === previous.text.length &&
      item.endOffset - item.startOffset === item.text.length &&
      previous.break !== "never" && item.break !== "never" &&
      previous.widthPx === undefined && item.widthPx === undefined &&
      previous.font === item.font &&
      previous.wordBreak === item.wordBreak &&
      previous.letterSpacingPx === item.letterSpacingPx &&
      previous.fontKerning === item.fontKerning &&
      previous.fontFeatureSettings === item.fontFeatureSettings &&
      previous.textTransform === item.textTransform &&
      validHorizontalScale(previous.horizontalScale) === validHorizontalScale(item.horizontalScale) &&
      previous.lineHeightPx === item.lineHeightPx &&
      previous.strutFont === item.strutFont &&
      previous.verticalAlign === item.verticalAlign &&
      previous.verticalMetrics?.ascent === item.verticalMetrics?.ascent &&
      previous.verticalMetrics?.descent === item.verticalMetrics?.descent
    ) {
      joined[joined.length - 1] = {
        ...previous,
        text: previous.text + item.text,
        endOffset: item.endOffset,
      };
      changed = true;
    } else {
      joined.push(item);
    }
  }
  return changed ? joined : items;
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

export function resolveNextUnblockedFullWidthLineTopPx(
  rowTopPx: number,
  lineHeightPx: number,
  containerWidthPx: number,
  exclusions: PretextExclusionRect[]
): number {
  let topPx = rowTopPx;
  while (rowWidthsAtY(containerWidthPx, lineHeightPx, topPx, exclusions).length === 0) {
    const nextEdgePx = Math.min(
      ...exclusions.flatMap((exclusion) => [exclusion.top, exclusion.bottom])
        .filter((edgePx) => Number.isFinite(edgePx) && edgePx > topPx)
    );
    if (!Number.isFinite(nextEdgePx)) break;
    topPx = nextEdgePx;
  }
  return topPx;
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
    fontKerning?: FontKerningMode;
    fontFeatureSettings?: string;
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
  const fontKerning = options?.fontKerning ?? "auto";
  const fontFeatureSettings = options?.fontFeatureSettings;
  const prepared = prepareCached(text, font, wordBreak, letterSpacingPx, fontKerning, fontFeatureSettings);
  if (!prepared) {
    return undefined;
  }

  const safeContainerWidthPx = Math.max(1, containerWidthPx);
  const safeLineHeightPx = options?.lineGrid && !options.exactLineHeight
    ? Math.max(1, resolveLineGridHeightPx(
        measureFontNaturalLineHeightPx(font) ?? lineHeightPx,
        options.lineGrid.pitchPx,
        options.lineGrid.minimumHeightPx
      ))
    : Math.max(1, lineHeightPx);
  const normalizedExclusions = (exclusions ?? []).map((exclusion) => ({
    left: exclusion.left,
    right: exclusion.right,
    top: exclusion.top,
    bottom: exclusion.bottom,
  }));
  const cacheKey = layoutCacheKey(
    `plain\u0000${font}\u0000${fontKerning}\u0000${fontFeatureSettings ?? ""}\u0000${wordBreak}\u0000${letterSpacingPx}\u0000${options?.exactLineHeight === true}\u0000${endingMarkCacheKey(options?.endingMark)}\u0000${lineGridCacheKey(options?.lineGrid)}\u0000${text}`,
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

        const endOffset = consumedOffset + cursorAdvanceCodeUnits(prepared, cursor, line.end);
        const sourceText = text.slice(consumedOffset, endOffset);
        const hyphenOffset = selectedHyphenOffset(sourceText, line.text);
        fragments.push({
          text: sourceFragmentText(sourceText, line.text),
          discretionaryHyphenOffset: hyphenOffset === undefined ? undefined : consumedOffset + hyphenOffset,
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
          fontKerning,
          fontFeatureSettings,
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
      options
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

  items = joinContiguousShapingItems(joinSplitCarriageReturns(items));
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
        validHorizontalScale(item.horizontalScale) + "\u0001" +
        `${item.font}\u0001${item.break ?? "normal"}\u0001${
          item.wordBreak ?? "normal"
        }\u0001${item.letterSpacingPx ?? 0}\u0001${item.fontKerning ?? "auto"}\u0001${item.fontFeatureSettings ?? ""}\u0001${item.textTransform ?? ""}\u0001${
          item.lineHeightPx ?? ""
        }\u0001${item.strutFont ?? ""}\u0001${item.verticalAlign ?? ""}\u0001${
          item.widthPx ?? ""
        }\u0001${item.verticalMetrics?.ascent ?? ""},${
          item.verticalMetrics?.descent ?? ""
        }\u0001${item.startOffset}\u0001${item.endOffset}\u0001${item.text}`
    )
    .join("\u0002");
  const cacheKey = layoutCacheKey(
    `items\u0000${fallbackFont ?? ""}\u0000${options?.exactLineHeight === true}\u0000${endingMarkCacheKey(options?.endingMark)}\u0000${lineGridCacheKey(options?.lineGrid)}\u0000${layoutSignature}`,
    safeContainerWidthPx,
    safeLineHeightPx,
    normalizedExclusions
  );
  const cachedLayout = getCachedValue(layoutByKey, cacheKey);
  if (cachedLayout) {
    return cachedLayout;
  }

  const prepared = prepareRichItems(items, layoutSignature);
  if (!prepared) return undefined;
  const lines: PretextLineLayout[] = [];
  const consumedOffsets = items.map(() => 0);
  let cursor: RichInlineCursor = { itemIndex: 0, segmentIndex: 0, graphemeIndex: 0 };
  let finished = false;
  let rowTopPx = 0;
  let rowHeightPx = safeLineHeightPx;

  while (!finished) {
    const rowStartCursor = { ...cursor };
    const rowStartOffsets = normalizedExclusions.length > 0 ? [...consumedOffsets] : undefined;
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
      const interval = rowIntervals[intervalIndex]!;
      const line = nextRichLine(prepared, cursor, interval.width);
      if (!line) {
        finished = true;
        break;
      }
      if (laterIntervalKeepsLeadingText(prepared, items, cursor, line,
        rowIntervals.slice(intervalIndex + 1))) continue;

      let nextFragmentX = interval.x;
      const appendFragment = (itemIndex: number, sourceEnd: number, width: number, materialized: string) => {
        const item = items[itemIndex]!;
        const sourceStart = consumedOffsets[itemIndex]!;
        const sourceText = item.text.slice(sourceStart, sourceEnd);
        const startOffset = item.startOffset + sourceStart;
        const endOffset = item.startOffset + sourceEnd;
        const hardBreak = /\r\n$|[\r\n]$/.exec(sourceText);
        const hyphenOffset = selectedHyphenOffset(sourceText, materialized);
        fragments.push({
          discretionaryHyphenOffset: hyphenOffset === undefined ? undefined : startOffset + hyphenOffset,
          text: sourceFragmentText(sourceText, materialized),
          width,
          x: nextFragmentX,
          intervalX: interval.x,
          intervalWidth: interval.width,
          startOffset,
          endOffset,
          hardBreakOffset: hardBreak ? endOffset - hardBreak[0].length : undefined,
          font: item.font,
          strutFont: item.strutFont,
          letterSpacingPx: item.letterSpacingPx,
          fontKerning: item.fontKerning,
          fontFeatureSettings: item.fontFeatureSettings,
          textTransform: item.textTransform,
          horizontalScale: validHorizontalScale(item.horizontalScale),
          lineHeightPx: item.lineHeightPx ?? safeLineHeightPx,
          verticalAlign: item.verticalAlign,
          hasCustomVerticalMetrics: item.verticalMetrics !== undefined,
          ...itemLineMetrics(item, item.lineHeightPx ?? safeLineHeightPx),
        });
        consumedOffsets[itemIndex] = sourceEnd;
        nextFragmentX += width;
      };
      for (const lineFragment of line.fragments) {
        const item = items[lineFragment.itemIndex];
        if (!item) continue;
        for (let index = cursor.itemIndex; index < lineFragment.itemIndex; index += 1) {
          const skipped = items[index]!;
          const remaining = skipped.text.slice(consumedOffsets[index]);
          if (remaining && isInvisibleSource(remaining)) appendFragment(index, skipped.text.length, 0, remaining);
        }
        const atomic = item.break === "never" && Number.isFinite(item.widthPx);
        nextFragmentX += lineFragment.gapBefore;
        appendFragment(lineFragment.itemIndex,
          atomic ? item.text.length : lineFragment.sourceEnd,
          lineFragment.occupiedWidth, lineFragment.text);
      }

      cursor = line.end;
      if (fragments.at(-1)?.hardBreakOffset !== undefined) break;
    }

    if (fragments.length === 0) {
      break;
    }

    const row = createLine(
      rowTopPx,
      fragments,
      fallbackFont ?? items[0]?.font ?? "",
      safeLineHeightPx,
      options
    );
    if (
      normalizedExclusions.length > 0 &&
      (row.height ?? safeLineHeightPx) > rowHeightPx + 1e-7
    ) {
      cursor = rowStartCursor;
      rowStartOffsets?.forEach((offset, index) => { consumedOffsets[index] = offset; });
      finished = false;
      rowHeightPx = row.height ?? safeLineHeightPx;
      continue;
    }
    lines.push(row);
    rowTopPx += row.height ?? safeLineHeightPx;
    rowHeightPx = safeLineHeightPx;
  }

  if (lines.length === 0 && items.every((item) => isInvisibleSource(item.text))) {
    const interval = rowWidthsAtY(safeContainerWidthPx, safeLineHeightPx,
      rowTopPx, normalizedExclusions)[0] ?? { x: 0, width: safeContainerWidthPx };
    lines.push(createLine(rowTopPx, items.filter((item) => item.text.length > 0).map((item) => ({
      text: item.text,
      width: 0,
      x: interval.x,
      intervalX: interval.x,
      intervalWidth: interval.width,
      startOffset: item.startOffset,
      endOffset: item.endOffset,
      font: item.font,
      strutFont: item.strutFont,
      lineHeightPx: item.lineHeightPx ?? safeLineHeightPx,
      verticalAlign: item.verticalAlign,
      hasCustomVerticalMetrics: item.verticalMetrics !== undefined,
      ...itemLineMetrics(item, item.lineHeightPx ?? safeLineHeightPx),
    })), fallbackFont ?? items[0]?.font ?? "", safeLineHeightPx, options));
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
