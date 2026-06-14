/**
 * DOCX page thumbnail rasterization helpers.
 *
 * The raster pipeline clones a live page surface, serializes it into an SVG
 * `foreignObject`, decodes it as an image, and draws it onto a canvas. The
 * helpers here keep that pipeline cheap:
 *
 * - editor-only chrome (selection rects, caret, handles) is stripped from the
 *   clone before serialization;
 * - large embedded data-URI images are swapped for cached, thumbnail-scale
 *   versions so serialize/encode/decode stop round-tripping megabytes;
 * - rasters land on reusable surface canvases held in an LRU cache;
 * - work runs through a serial idle-time queue that coalesces repeat requests
 *   per target canvas instead of fanning out `Promise.all` storms.
 */

/** Marks editor chrome that must never appear in rasterized thumbnails. */
export const DOCX_THUMBNAIL_EXCLUDE_ATTRIBUTE = "data-docx-thumbnail-exclude";

const THUMBNAIL_EXCLUDED_CLONE_SELECTOR = [
  `[${DOCX_THUMBNAIL_EXCLUDE_ATTRIBUTE}="true"]`,
  "textarea",
  '[data-image-resize-handle="true"]',
  '[data-docx-table-move-handle="true"]',
].join(",");

const THUMBNAIL_IMAGE_DOWNSCALE_MIN_DATA_URI_LENGTH = 32_768;
const THUMBNAIL_IMAGE_DOWNSCALE_MAX_DIMENSION_PX = 512;
const THUMBNAIL_IMAGE_JPEG_QUALITY = 0.78;
const THUMBNAIL_DIRECT_DEFAULT_FONT_FAMILY = "Calibri, Arial, sans-serif";
const THUMBNAIL_DIRECT_DEFAULT_TEXT_COLOR = "#111827";
const THUMBNAIL_DIRECT_TABLE_BORDER_COLOR = "#d1d5db";
const THUMBNAIL_DIRECT_IMAGE_BACKGROUND = "#f3f4f6";
const THUMBNAIL_DIRECT_MAX_ELEMENTS = 320;
const THUMBNAIL_DIRECT_MAX_TEXT_CHARS = 640;
const THUMBNAIL_DIRECT_MAX_LINES = 14;
const THUMBNAIL_DIRECT_MAX_LAYOUT_LINES = 80;

export type DocxPageThumbnailSnapshotTextAlign =
  | "left"
  | "center"
  | "right"
  | "justify";

export interface DocxPageThumbnailTextRunSnapshot {
  text: string;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  backgroundColor?: string;
  fontSizePx?: number;
  fontFamily?: string;
}

export interface DocxPageThumbnailParagraphSnapshot {
  kind: "paragraph";
  xPx: number;
  yPx: number;
  widthPx: number;
  heightPx: number;
  align?: DocxPageThumbnailSnapshotTextAlign;
  backgroundColor?: string;
  lineHeightPx?: number;
  startLineIndex?: number;
  runs: readonly DocxPageThumbnailTextRunSnapshot[];
}

export interface DocxPageThumbnailImagePlaceholderSnapshot {
  kind: "image-placeholder";
  xPx: number;
  yPx: number;
  widthPx: number;
  heightPx: number;
  backgroundColor?: string;
  borderColor?: string;
}

export interface DocxPageThumbnailImageSnapshot {
  kind: "image";
  xPx: number;
  yPx: number;
  widthPx: number;
  heightPx: number;
  /** Renderable image source (data URI or URL) drawn into the thumbnail. */
  src: string;
  /** Painted if the image cannot be decoded/drawn (falls back to a box). */
  backgroundColor?: string;
  borderColor?: string;
}

export interface DocxPageThumbnailTableCellSnapshot {
  xPx: number;
  yPx: number;
  widthPx: number;
  heightPx: number;
  backgroundColor?: string;
  runs?: readonly DocxPageThumbnailTextRunSnapshot[];
}

export interface DocxPageThumbnailTableSnapshot {
  kind: "table";
  xPx: number;
  yPx: number;
  widthPx: number;
  heightPx: number;
  borderColor?: string;
  cells: readonly DocxPageThumbnailTableCellSnapshot[];
}

export type DocxPageThumbnailSnapshotElement =
  | DocxPageThumbnailParagraphSnapshot
  | DocxPageThumbnailImagePlaceholderSnapshot
  | DocxPageThumbnailImageSnapshot
  | DocxPageThumbnailTableSnapshot;

export interface DocxPageThumbnailRenderSnapshot {
  key: string;
  sourceWidthPx: number;
  sourceHeightPx: number;
  pageBackgroundColor?: string;
  elements: readonly DocxPageThumbnailSnapshotElement[];
}

function thumbnailSvgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * True when an `<img>` source is a raster data URI large enough that swapping
 * it for a downscaled copy meaningfully shrinks the serialized page markup.
 */
export function thumbnailImageSourceQualifiesForDownscale(
  src: string
): boolean {
  return (
    src.length >= THUMBNAIL_IMAGE_DOWNSCALE_MIN_DATA_URI_LENGTH &&
    src.startsWith("data:image/") &&
    !src.startsWith("data:image/svg")
  );
}

async function loadThumbnailImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => {
      reject(new Error("Failed to decode DOCX thumbnail image."));
    };
  });
  image.src = src;
  if (typeof image.decode === "function") {
    try {
      await image.decode();
      return image;
    } catch {
      // Some engines reject decode() for sources they still paint correctly;
      // fall back to the load event before giving up.
    }
  }
  return loaded;
}

const downscaledThumbnailImageCache = new Map<
  string,
  Promise<string | undefined>
>();

async function downscaleThumbnailImageDataUri(
  src: string
): Promise<string | undefined> {
  if (typeof document === "undefined") {
    return undefined;
  }

  const image = await loadThumbnailImage(src);
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (!naturalWidth || !naturalHeight) {
    return undefined;
  }

  const scale =
    THUMBNAIL_IMAGE_DOWNSCALE_MAX_DIMENSION_PX /
    Math.max(naturalWidth, naturalHeight);
  if (scale >= 1) {
    return undefined;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    return undefined;
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const sourceIsJpeg =
    src.startsWith("data:image/jpeg") || src.startsWith("data:image/jpg");
  const downscaled = sourceIsJpeg
    ? canvas.toDataURL("image/jpeg", THUMBNAIL_IMAGE_JPEG_QUALITY)
    : canvas.toDataURL("image/png");
  return downscaled.length < src.length ? downscaled : undefined;
}

/**
 * Returns a cached thumbnail-scale replacement for a large data-URI image
 * source, or `undefined` when the original should be kept. Failures are
 * cached so a broken image is only attempted once.
 */
export function getDownscaledThumbnailImageDataUri(
  src: string
): Promise<string | undefined> {
  const cached = downscaledThumbnailImageCache.get(src);
  if (cached) {
    return cached;
  }

  const pending = downscaleThumbnailImageDataUri(src).catch(() => undefined);
  downscaledThumbnailImageCache.set(src, pending);
  return pending;
}

const THUMBNAIL_DECODED_IMAGE_CACHE_MAX_ENTRIES = 48;
const decodedThumbnailImageCache = new Map<
  string,
  Promise<HTMLImageElement | undefined>
>();

/**
 * Decodes (and caches) an image source for the direct snapshot painter.
 * Bounded LRU so a long scanned-image document does not retain every decoded
 * page bitmap. Failures cache as `undefined` so a broken source is tried once.
 */
function getDecodedThumbnailImage(
  src: string
): Promise<HTMLImageElement | undefined> {
  const cached = decodedThumbnailImageCache.get(src);
  if (cached) {
    decodedThumbnailImageCache.delete(src);
    decodedThumbnailImageCache.set(src, cached);
    return cached;
  }

  const pending = loadThumbnailImage(src).catch(() => undefined);
  decodedThumbnailImageCache.set(src, pending);
  while (
    decodedThumbnailImageCache.size > THUMBNAIL_DECODED_IMAGE_CACHE_MAX_ENTRIES
  ) {
    const oldestKey = decodedThumbnailImageCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    decodedThumbnailImageCache.delete(oldestKey);
  }
  return pending;
}

function directThumbnailPositivePx(value: number | undefined, fallback = 1): number {
  return Number.isFinite(value) && (value as number) > 0
    ? Math.max(1, Number(value))
    : fallback;
}

function setCanvasFillStyle(
  context: CanvasRenderingContext2D,
  color: string | undefined,
  fallback: string
): void {
  try {
    context.fillStyle = color || fallback;
  } catch {
    context.fillStyle = fallback;
  }
}

function setCanvasStrokeStyle(
  context: CanvasRenderingContext2D,
  color: string | undefined,
  fallback: string
): void {
  try {
    context.strokeStyle = color || fallback;
  } catch {
    context.strokeStyle = fallback;
  }
}

function directThumbnailFont(
  run: DocxPageThumbnailTextRunSnapshot | undefined,
  fallbackFontSizePx: number
): string {
  const fontSizePx = Math.max(
    6,
    Math.min(
      36,
      Math.round(
        directThumbnailPositivePx(run?.fontSizePx, fallbackFontSizePx)
      )
    )
  );
  const fontStyle = run?.italic ? "italic " : "";
  const fontWeight = run?.bold ? "700 " : "";
  return `${fontStyle}${fontWeight}${fontSizePx}px ${
    run?.fontFamily || THUMBNAIL_DIRECT_DEFAULT_FONT_FAMILY
  }`;
}

/**
 * Tokenizer for thumbnail text layout. A token is a hard break, a run of
 * whitespace, or a run of non-whitespace — the classes never mix, so a token's
 * kind is decided by its first character. Hoisted to module scope so the hot
 * layout loop does not allocate a fresh RegExp per run.
 */
const THUMBNAIL_DIRECT_TOKEN_REGEX =
  /(\r\n|\n|\t|[^\S\r\n\t]+|[^\s\r\n\t]+)/g;
const THUMBNAIL_DIRECT_LEADING_WHITESPACE_REGEX = /^\s/;
const THUMBNAIL_DIRECT_TEXT_MEASURE_CACHE_MAX_ENTRIES = 4096;
const directThumbnailTextMeasureCache = new Map<string, number>();

/**
 * Measures a token's advance width, memoizing by `font|text`. Tokens (spaces,
 * common words) repeat heavily across a page, so the cache turns most measures
 * into Map lookups. The caller must have already assigned `context.font` to
 * `font` so a cache miss measures with the matching face.
 */
function measureDirectThumbnailToken(
  context: CanvasRenderingContext2D,
  font: string,
  text: string
): number {
  if (!text) {
    return 0;
  }
  const cacheKey = `${font}\u0000${text}`;
  const cached = directThumbnailTextMeasureCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const width = context.measureText(text).width;
  if (
    directThumbnailTextMeasureCache.size >=
    THUMBNAIL_DIRECT_TEXT_MEASURE_CACHE_MAX_ENTRIES
  ) {
    const oldestKey = directThumbnailTextMeasureCache.keys().next().value;
    if (oldestKey !== undefined) {
      directThumbnailTextMeasureCache.delete(oldestKey);
    }
  }
  directThumbnailTextMeasureCache.set(cacheKey, width);
  return width;
}

interface DirectThumbnailTextSegment {
  run: DocxPageThumbnailTextRunSnapshot;
  text: string;
  widthPx: number;
  /** The run's resolved canvas font shorthand, reused by the draw pass. */
  font: string;
}

interface DirectThumbnailTextLine {
  segments: DirectThumbnailTextSegment[];
  widthPx: number;
}

function appendDirectThumbnailTextLine(
  lines: DirectThumbnailTextLine[],
  currentSegments: DirectThumbnailTextSegment[],
  currentWidthPx: number
): DirectThumbnailTextLine {
  const line = {
    segments: currentSegments,
    widthPx: currentWidthPx,
  };
  lines.push(line);
  return line;
}

function layoutDirectThumbnailTextRuns(params: {
  context: CanvasRenderingContext2D;
  runs: readonly DocxPageThumbnailTextRunSnapshot[];
  widthPx: number;
  fallbackFontSizePx: number;
  maxLineCount: number;
}): DirectThumbnailTextLine[] {
  const { context, runs, fallbackFontSizePx } = params;
  const widthPx = Math.max(1, params.widthPx);
  const maxLineCount = Math.max(
    1,
    Math.min(THUMBNAIL_DIRECT_MAX_LAYOUT_LINES, params.maxLineCount)
  );
  const lines: DirectThumbnailTextLine[] = [];
  let currentSegments: DirectThumbnailTextSegment[] = [];
  let currentWidthPx = 0;
  let remainingChars = THUMBNAIL_DIRECT_MAX_TEXT_CHARS;

  const flushLine = (): void => {
    appendDirectThumbnailTextLine(lines, currentSegments, currentWidthPx);
    currentSegments = [];
    currentWidthPx = 0;
  };

  for (const run of runs) {
    if (lines.length >= maxLineCount || remainingChars <= 0) {
      break;
    }

    const text = run.text.slice(0, remainingChars);
    remainingChars -= text.length;
    // Set the run's font once for the whole run; every token below measures
    // against it (the cache and the wrap test assume context.font === runFont).
    const runFont = directThumbnailFont(run, fallbackFontSizePx);
    context.font = runFont;
    const tokens = text.match(THUMBNAIL_DIRECT_TOKEN_REGEX) ?? [];
    for (const token of tokens) {
      if (lines.length >= maxLineCount) {
        break;
      }
      if (token === "\n" || token === "\r\n") {
        flushLine();
        continue;
      }

      const drawableToken = token === "\t" ? "    " : token;
      const tokenWidthPx = measureDirectThumbnailToken(
        context,
        runFont,
        drawableToken
      );
      const tokenIsWhitespace =
        THUMBNAIL_DIRECT_LEADING_WHITESPACE_REGEX.test(drawableToken);
      if (
        currentSegments.length > 0 &&
        currentWidthPx + tokenWidthPx > widthPx &&
        !tokenIsWhitespace
      ) {
        flushLine();
      }
      if (currentSegments.length === 0 && tokenIsWhitespace) {
        continue;
      }
      currentSegments.push({
        run,
        text: drawableToken,
        widthPx: tokenWidthPx,
        font: runFont,
      });
      currentWidthPx += tokenWidthPx;
    }
  }

  if (currentSegments.length > 0 || lines.length === 0) {
    flushLine();
  }

  return lines;
}

function directThumbnailAlignedX(params: {
  xPx: number;
  widthPx: number;
  lineWidthPx: number;
  align?: DocxPageThumbnailSnapshotTextAlign;
}): number {
  const { xPx, widthPx, lineWidthPx, align } = params;
  if (align === "center") {
    return xPx + Math.max(0, (widthPx - lineWidthPx) / 2);
  }
  if (align === "right") {
    return xPx + Math.max(0, widthPx - lineWidthPx);
  }
  return xPx;
}

function drawDirectThumbnailTextRuns(params: {
  context: CanvasRenderingContext2D;
  runs: readonly DocxPageThumbnailTextRunSnapshot[];
  xPx: number;
  yPx: number;
  widthPx: number;
  heightPx: number;
  align?: DocxPageThumbnailSnapshotTextAlign;
  lineHeightPx?: number;
  startLineIndex?: number;
}): void {
  const {
    context,
    runs,
    xPx,
    yPx,
    widthPx,
    heightPx,
    align,
    startLineIndex,
  } = params;
  const safeWidthPx = Math.max(1, widthPx);
  const safeHeightPx = Math.max(1, heightPx);
  const fallbackFontSizePx = Math.max(
    7,
    Math.min(
      20,
      Math.round(
        runs.find((run) => Number.isFinite(run.fontSizePx))?.fontSizePx ?? 12
      )
    )
  );
  const lineHeightPx = Math.max(
    fallbackFontSizePx + 1,
    Math.round(params.lineHeightPx ?? fallbackFontSizePx * 1.25)
  );
  const skippedLineCount = Math.max(
    0,
    Math.min(THUMBNAIL_DIRECT_MAX_LAYOUT_LINES - 1, Math.trunc(startLineIndex ?? 0))
  );
  const visibleLineCount = Math.max(
    1,
    Math.min(
      THUMBNAIL_DIRECT_MAX_LINES,
      Math.ceil(safeHeightPx / Math.max(1, lineHeightPx)) + 1
    )
  );
  const lines = layoutDirectThumbnailTextRuns({
    context,
    runs,
    widthPx: safeWidthPx,
    fallbackFontSizePx,
    maxLineCount: skippedLineCount + visibleLineCount,
  }).slice(skippedLineCount, skippedLineCount + visibleLineCount);

  context.save();
  context.beginPath();
  context.rect(xPx, yPx, safeWidthPx, safeHeightPx);
  context.clip();
  context.textBaseline = "alphabetic";

  // The layout pass already resolved each segment's font and width; only write
  // context.font when it actually changes (one assignment per run, not token).
  let lastAppliedFont: string | undefined;
  lines.forEach((line, lineIndex) => {
    const lineTopPx = yPx + lineIndex * lineHeightPx;
    if (lineTopPx > yPx + safeHeightPx) {
      return;
    }
    let cursorXPx = directThumbnailAlignedX({
      xPx,
      widthPx: safeWidthPx,
      lineWidthPx: line.widthPx,
      align,
    });
    const baselineYPx =
      lineTopPx + Math.max(1, Math.round(lineHeightPx * 0.78));
    line.segments.forEach((segment) => {
      const segmentWidthPx = segment.widthPx;
      if (segment.run.backgroundColor) {
        setCanvasFillStyle(context, segment.run.backgroundColor, "transparent");
        context.fillRect(cursorXPx, lineTopPx + 1, segmentWidthPx, lineHeightPx);
      }
      if (segment.font !== lastAppliedFont) {
        context.font = segment.font;
        lastAppliedFont = segment.font;
      }
      setCanvasFillStyle(
        context,
        segment.run.color,
        THUMBNAIL_DIRECT_DEFAULT_TEXT_COLOR
      );
      context.fillText(segment.text, cursorXPx, baselineYPx);
      cursorXPx += segmentWidthPx;
    });
  });

  context.restore();
}

function drawDirectThumbnailParagraph(
  context: CanvasRenderingContext2D,
  paragraph: DocxPageThumbnailParagraphSnapshot
): void {
  const xPx = Math.round(paragraph.xPx);
  const yPx = Math.round(paragraph.yPx);
  const widthPx = Math.max(1, Math.round(paragraph.widthPx));
  const heightPx = Math.max(1, Math.round(paragraph.heightPx));
  if (paragraph.backgroundColor) {
    setCanvasFillStyle(context, paragraph.backgroundColor, "transparent");
    context.fillRect(xPx, yPx, widthPx, heightPx);
  }
  drawDirectThumbnailTextRuns({
    context,
    runs: paragraph.runs,
    xPx: xPx + 1,
    yPx,
    widthPx: Math.max(1, widthPx - 2),
    heightPx,
    align: paragraph.align,
    lineHeightPx: paragraph.lineHeightPx,
    startLineIndex: paragraph.startLineIndex,
  });
}

function drawDirectThumbnailImagePlaceholder(
  context: CanvasRenderingContext2D,
  image: DocxPageThumbnailImagePlaceholderSnapshot,
  hairlineSourcePx: number
): void {
  const xPx = Math.round(image.xPx);
  const yPx = Math.round(image.yPx);
  const widthPx = Math.max(1, Math.round(image.widthPx));
  const heightPx = Math.max(1, Math.round(image.heightPx));
  setCanvasFillStyle(
    context,
    image.backgroundColor,
    THUMBNAIL_DIRECT_IMAGE_BACKGROUND
  );
  context.fillRect(xPx, yPx, widthPx, heightPx);
  setCanvasStrokeStyle(
    context,
    image.borderColor,
    THUMBNAIL_DIRECT_TABLE_BORDER_COLOR
  );
  context.lineWidth = hairlineSourcePx;
  context.strokeRect(xPx, yPx, widthPx, heightPx);
}

function drawDirectThumbnailImage(
  context: CanvasRenderingContext2D,
  image: DocxPageThumbnailImageSnapshot,
  decoded: HTMLImageElement | undefined,
  hairlineSourcePx: number
): void {
  const xPx = Math.round(image.xPx);
  const yPx = Math.round(image.yPx);
  const widthPx = Math.max(1, Math.round(image.widthPx));
  const heightPx = Math.max(1, Math.round(image.heightPx));
  if (decoded && decoded.naturalWidth > 0 && decoded.naturalHeight > 0) {
    try {
      context.drawImage(decoded, xPx, yPx, widthPx, heightPx);
      return;
    } catch {
      // Drawing can throw for sources the decoder accepted but the canvas
      // refuses (e.g. cross-origin taint); fall back to the placeholder box.
    }
  }
  setCanvasFillStyle(
    context,
    image.backgroundColor,
    THUMBNAIL_DIRECT_IMAGE_BACKGROUND
  );
  context.fillRect(xPx, yPx, widthPx, heightPx);
  setCanvasStrokeStyle(
    context,
    image.borderColor,
    THUMBNAIL_DIRECT_TABLE_BORDER_COLOR
  );
  context.lineWidth = hairlineSourcePx;
  context.strokeRect(xPx, yPx, widthPx, heightPx);
}

function drawDirectThumbnailTable(
  context: CanvasRenderingContext2D,
  table: DocxPageThumbnailTableSnapshot,
  hairlineSourcePx: number
): void {
  const tableXPx = Math.round(table.xPx);
  const tableYPx = Math.round(table.yPx);
  const tableWidthPx = Math.max(1, Math.round(table.widthPx));
  const tableHeightPx = Math.max(1, Math.round(table.heightPx));

  context.save();
  context.beginPath();
  context.rect(tableXPx, tableYPx, tableWidthPx, tableHeightPx);
  context.clip();
  setCanvasStrokeStyle(
    context,
    table.borderColor,
    THUMBNAIL_DIRECT_TABLE_BORDER_COLOR
  );
  context.lineWidth = hairlineSourcePx;

  table.cells.forEach((cell) => {
    const xPx = tableXPx + Math.round(cell.xPx);
    const yPx = tableYPx + Math.round(cell.yPx);
    const widthPx = Math.max(1, Math.round(cell.widthPx));
    const heightPx = Math.max(1, Math.round(cell.heightPx));
    if (cell.backgroundColor) {
      setCanvasFillStyle(context, cell.backgroundColor, "transparent");
      context.fillRect(xPx, yPx, widthPx, heightPx);
    }
    context.strokeRect(xPx, yPx, widthPx, heightPx);
    if (cell.runs?.length) {
      drawDirectThumbnailTextRuns({
        context,
        runs: cell.runs,
        xPx: xPx + 3,
        yPx: yPx + 2,
        widthPx: Math.max(1, widthPx - 6),
        heightPx: Math.max(1, heightPx - 4),
        lineHeightPx: 13,
      });
    }
  });

  context.restore();
}

/**
 * Paints a thumbnail directly from a layout/model snapshot. This skips the
 * expensive DOM clone -> SVG foreignObject -> image decode path and is intended
 * as the default fast path for virtualized thumbnail rails.
 *
 * Embedded images are decoded (and cached) before painting so image-dominated
 * pages — e.g. scanned `.doc` documents where every page is a single full-page
 * bitmap — render their real content instead of an empty placeholder box.
 * Pages with no images resolve without awaiting, keeping the text fast path
 * effectively synchronous.
 */
export async function renderDocxThumbnailSnapshotSurface(params: {
  snapshot: DocxPageThumbnailRenderSnapshot;
  widthPx: number;
  heightPx: number;
  pixelWidthPx: number;
  pixelHeightPx: number;
}): Promise<HTMLCanvasElement> {
  if (typeof document === "undefined") {
    throw new Error("DOCX thumbnails require a browser environment.");
  }

  const sourceWidthPx = directThumbnailPositivePx(params.snapshot.sourceWidthPx);
  const sourceHeightPx = directThumbnailPositivePx(params.snapshot.sourceHeightPx);
  const pixelWidthPx = Math.max(1, Math.round(params.pixelWidthPx));
  const pixelHeightPx = Math.max(1, Math.round(params.pixelHeightPx));
  const surface = document.createElement("canvas");
  surface.width = pixelWidthPx;
  surface.height = pixelHeightPx;
  const context = surface.getContext("2d");
  if (!context) {
    throw new Error("2D canvas context is unavailable for DOCX thumbnails.");
  }

  const elements = params.snapshot.elements.slice(0, THUMBNAIL_DIRECT_MAX_ELEMENTS);
  const decodedImagesBySrc = new Map<string, HTMLImageElement | undefined>();
  const imageSrcs = new Set<string>();
  for (const element of elements) {
    if (element.kind === "image" && element.src) {
      imageSrcs.add(element.src);
    }
  }
  if (imageSrcs.size > 0) {
    await Promise.all(
      Array.from(imageSrcs, async (src) => {
        decodedImagesBySrc.set(src, await getDecodedThumbnailImage(src));
      })
    );
  }

  const scaleX = pixelWidthPx / sourceWidthPx;
  const scaleY = pixelHeightPx / sourceHeightPx;
  const hairlineSourcePx = Math.max(0.75, 1 / Math.max(scaleX, scaleY));
  context.setTransform(scaleX, 0, 0, scaleY, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  setCanvasFillStyle(
    context,
    params.snapshot.pageBackgroundColor,
    "#ffffff"
  );
  context.fillRect(0, 0, sourceWidthPx, sourceHeightPx);

  elements.forEach((element) => {
    switch (element.kind) {
      case "paragraph":
        drawDirectThumbnailParagraph(context, element);
        break;
      case "image-placeholder":
        drawDirectThumbnailImagePlaceholder(
          context,
          element,
          hairlineSourcePx
        );
        break;
      case "image":
        drawDirectThumbnailImage(
          context,
          element,
          decodedImagesBySrc.get(element.src),
          hairlineSourcePx
        );
        break;
      case "table":
        drawDirectThumbnailTable(context, element, hairlineSourcePx);
        break;
    }
  });

  return surface;
}

async function buildDocxThumbnailSvgMarkup(params: {
  pageElement: HTMLElement;
  sourceWidthPx: number;
  sourceHeightPx: number;
  widthPx: number;
  heightPx: number;
}): Promise<string> {
  const { pageElement, sourceWidthPx, sourceHeightPx, widthPx, heightPx } =
    params;
  const clone = pageElement.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll(THUMBNAIL_EXCLUDED_CLONE_SELECTOR)
    .forEach((excluded) => {
      excluded.remove();
    });

  const cloneImages = Array.from(clone.querySelectorAll("img"));
  await Promise.all(
    cloneImages.map(async (cloneImage) => {
      const src = cloneImage.getAttribute("src");
      if (!src || !thumbnailImageSourceQualifiesForDownscale(src)) {
        return;
      }

      const downscaled = await getDownscaledThumbnailImageDataUri(src);
      if (downscaled) {
        cloneImage.setAttribute("src", downscaled);
      }
    })
  );

  const scaleX = widthPx / sourceWidthPx;
  const scaleY = heightPx / sourceHeightPx;
  const serializedPage = new XMLSerializer().serializeToString(clone);
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
      <foreignObject x="0" y="0" width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:${widthPx}px;height:${heightPx}px;overflow:hidden;">
          <div style="width:${sourceWidthPx}px;height:${sourceHeightPx}px;transform-origin:top left;transform:scale(${scaleX}, ${scaleY});">
            ${serializedPage}
          </div>
        </div>
      </foreignObject>
    </svg>
  `;
}

/**
 * Rasterizes a live page surface element to a fresh offscreen surface canvas
 * at the requested pixel resolution. The surface is cacheable and can be
 * blitted to any number of target canvases with {@link blitDocxThumbnailSurface}.
 */
export async function rasterizeDocxThumbnailSurface(params: {
  pageElement: HTMLElement;
  sourceWidthPx: number;
  sourceHeightPx: number;
  widthPx: number;
  heightPx: number;
  pixelWidthPx: number;
  pixelHeightPx: number;
}): Promise<HTMLCanvasElement> {
  if (typeof window === "undefined" || typeof XMLSerializer === "undefined") {
    throw new Error("DOCX thumbnails require a browser environment.");
  }

  const safeSourceWidthPx = Math.max(1, Math.round(params.sourceWidthPx));
  const safeSourceHeightPx = Math.max(1, Math.round(params.sourceHeightPx));
  const svgMarkup = await buildDocxThumbnailSvgMarkup({
    pageElement: params.pageElement,
    sourceWidthPx: safeSourceWidthPx,
    sourceHeightPx: safeSourceHeightPx,
    widthPx: params.widthPx,
    heightPx: params.heightPx,
  });
  // Load the foreignObject SVG via a data: URL rather than a blob: URL.
  // WebKit/Safari still taints a canvas drawn from a blob:-backed SVG image
  // (bug 156176), but a data:-URI SVG is explicitly exempted (bug 180301), and
  // Chrome/Firefox never taint either way. Keeping the canvas clean lets
  // callers run toDataURL()/toBlob() for client-side thumbnail export.
  const image = await loadThumbnailImage(thumbnailSvgDataUri(svgMarkup));

  const surface = document.createElement("canvas");
  surface.width = Math.max(1, Math.round(params.pixelWidthPx));
  surface.height = Math.max(1, Math.round(params.pixelHeightPx));
  const context = surface.getContext("2d");
  if (!context) {
    throw new Error("2D canvas context is unavailable for DOCX thumbnails.");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, surface.width, surface.height);
  return surface;
}

/** Copies a cached thumbnail surface onto a target canvas. */
export function blitDocxThumbnailSurface(
  surface: HTMLCanvasElement,
  canvas: HTMLCanvasElement,
  resolution: {
    widthPx: number;
    heightPx: number;
    pixelWidthPx: number;
    pixelHeightPx: number;
  }
): void {
  const pixelWidth = Math.max(1, Math.round(resolution.pixelWidthPx));
  const pixelHeight = Math.max(1, Math.round(resolution.pixelHeightPx));
  const cssWidth = `${Math.max(1, Math.round(resolution.widthPx))}px`;
  const cssHeight = `${Math.max(1, Math.round(resolution.heightPx))}px`;

  // Writing canvas.width/height resets (and clears) the backing store even when
  // the value is unchanged, so only do it on an actual size change.
  let bufferResized = false;
  if (canvas.width !== pixelWidth) {
    canvas.width = pixelWidth;
    bufferResized = true;
  }
  if (canvas.height !== pixelHeight) {
    canvas.height = pixelHeight;
    bufferResized = true;
  }
  if (canvas.style.width !== cssWidth) {
    canvas.style.width = cssWidth;
  }
  if (canvas.style.height !== cssHeight) {
    canvas.style.height = cssHeight;
  }

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2D canvas context is unavailable for DOCX thumbnails.");
  }

  context.setTransform(1, 0, 0, 1, 0, 0);
  // A resize already cleared the buffer; otherwise clear stale pixels first.
  if (!bufferResized) {
    context.clearRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(surface, 0, 0, canvas.width, canvas.height);
}

/**
 * Insertion-ordered LRU keyed by string. Values are typically surface
 * canvases (~4 bytes per pixel), so the entry cap bounds memory directly.
 */
export class DocxThumbnailSurfaceCache<T> {
  private readonly entries = new Map<string, T>();

  constructor(private readonly maxEntries: number) {}

  get size(): number {
    return this.entries.size;
  }

  get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (value === undefined) {
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.entries.delete(oldestKey);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

interface SerialIdleTaskQueueEntry<K> {
  key: K;
  run: () => Promise<void>;
  resolvers: Array<() => void>;
  priority: number;
  sequence: number;
}

export interface SerialIdleTaskQueueOptions {
  /**
   * Schedules the next queue pump. Defaults to `requestIdleCallback` with a
   * timeout, falling back to a short `setTimeout`.
   */
  scheduleTask?: (callback: () => void) => void;
  /** Schedules a pump after a specific delay (throttle wake-ups). */
  scheduleDelayed?: (callback: () => void, delayMs: number) => void;
  /** Minimum interval between runs that share the same key. */
  minTaskIntervalMs?: number;
  now?: () => number;
}

export interface SerialIdleTaskQueueEnqueueOptions {
  /**
   * Lower values run first. Entries with the same priority keep FIFO order.
   *
   * @defaultValue `0`
   */
  priority?: number;
}

const IDLE_TASK_TIMEOUT_MS = 300;

function defaultScheduleTask(callback: () => void): void {
  const idleWindow =
    typeof window === "undefined"
      ? undefined
      : (window as Window & {
          requestIdleCallback?: (
            idleCallback: () => void,
            options?: { timeout?: number }
          ) => number;
          cancelIdleCallback?: (handle: number) => void;
        });
  if (!idleWindow || typeof idleWindow.requestIdleCallback !== "function") {
    setTimeout(callback, 16);
    return;
  }

  // Chrome suspends idle callbacks entirely while the document is hidden —
  // including ones with a timeout — which would starve the queue in
  // background tabs. Race the idle callback against a plain timer so the
  // queue always makes progress; whichever fires first wins.
  let invoked = false;
  const runOnce = (): void => {
    if (invoked) {
      return;
    }
    invoked = true;
    callback();
  };
  const idleHandle = idleWindow.requestIdleCallback(runOnce, {
    timeout: IDLE_TASK_TIMEOUT_MS,
  });
  setTimeout(() => {
    if (invoked) {
      return;
    }
    if (typeof idleWindow.cancelIdleCallback === "function") {
      idleWindow.cancelIdleCallback(idleHandle);
    }
    runOnce();
  }, IDLE_TASK_TIMEOUT_MS + 50);
}

function defaultScheduleDelayed(callback: () => void, delayMs: number): void {
  setTimeout(callback, delayMs);
}

/**
 * Runs async tasks strictly one at a time during idle periods. A newer task
 * with the same key replaces the queued one (its waiters resolve with the
 * newer run), and runs sharing a key are throttled to `minTaskIntervalMs`.
 */
export class SerialIdleTaskQueue<K> {
  private readonly pending: SerialIdleTaskQueueEntry<K>[] = [];
  private readonly lastRunAtByKey = new Map<K, number>();
  private readonly scheduleTask: (callback: () => void) => void;
  private readonly scheduleDelayed: (
    callback: () => void,
    delayMs: number
  ) => void;
  private readonly minTaskIntervalMs: number;
  private readonly now: () => number;
  private pumpScheduled = false;
  private running = false;
  private nextSequence = 0;

  constructor(options?: SerialIdleTaskQueueOptions) {
    this.scheduleTask = options?.scheduleTask ?? defaultScheduleTask;
    this.scheduleDelayed = options?.scheduleDelayed ?? defaultScheduleDelayed;
    this.minTaskIntervalMs = Math.max(0, options?.minTaskIntervalMs ?? 0);
    this.now = options?.now ?? (() => Date.now());
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  enqueue(
    key: K,
    run: () => Promise<void>,
    options?: SerialIdleTaskQueueEnqueueOptions
  ): Promise<void> {
    const priority = Number.isFinite(options?.priority)
      ? Number(options?.priority)
      : 0;
    return new Promise<void>((resolve) => {
      const existing = this.pending.find((entry) => entry.key === key);
      if (existing) {
        existing.run = run;
        existing.resolvers.push(resolve);
        existing.priority = Math.min(existing.priority, priority);
      } else {
        this.pending.push({
          key,
          run,
          resolvers: [resolve],
          priority,
          sequence: this.nextSequence,
        });
        this.nextSequence += 1;
      }
      this.schedulePump();
    });
  }

  /** Drops queued work for a single key, resolving its waiters. */
  cancel(key: K): void {
    const remaining: SerialIdleTaskQueueEntry<K>[] = [];
    this.pending.forEach((entry) => {
      if (entry.key === key) {
        entry.resolvers.forEach((resolveEntry) => {
          resolveEntry();
        });
        return;
      }

      remaining.push(entry);
    });
    this.pending.splice(0, this.pending.length, ...remaining);
  }

  /** Drops all queued tasks, resolving their waiters without running them. */
  clear(): void {
    const dropped = this.pending.splice(0, this.pending.length);
    this.lastRunAtByKey.clear();
    dropped.forEach((entry) => {
      entry.resolvers.forEach((resolveEntry) => {
        resolveEntry();
      });
    });
  }

  private schedulePump(): void {
    if (this.pumpScheduled || this.running || this.pending.length === 0) {
      return;
    }
    this.pumpScheduled = true;
    this.scheduleTask(() => {
      this.pumpScheduled = false;
      void this.runNext();
    });
  }

  private takeNextEligibleEntry():
    | { entry: SerialIdleTaskQueueEntry<K> }
    | { retryDelayMs: number }
    | undefined {
    if (this.pending.length === 0) {
      return undefined;
    }

    const now = this.now();
    let earliestWaitMs: number | undefined;
    let bestIndex = -1;
    let bestEntry: SerialIdleTaskQueueEntry<K> | undefined;
    for (let index = 0; index < this.pending.length; index += 1) {
      const candidate = this.pending[index];
      if (!candidate) {
        continue;
      }
      const lastRunAt = this.lastRunAtByKey.get(candidate.key);
      const waitMs =
        lastRunAt === undefined
          ? 0
          : lastRunAt + this.minTaskIntervalMs - now;
      if (waitMs <= 0) {
        if (
          !bestEntry ||
          candidate.priority < bestEntry.priority ||
          (candidate.priority === bestEntry.priority &&
            candidate.sequence < bestEntry.sequence)
        ) {
          bestEntry = candidate;
          bestIndex = index;
        }
        continue;
      }
      earliestWaitMs =
        earliestWaitMs === undefined
          ? waitMs
          : Math.min(earliestWaitMs, waitMs);
    }

    if (bestEntry && bestIndex >= 0) {
      this.pending.splice(bestIndex, 1);
      return { entry: bestEntry };
    }

    return earliestWaitMs === undefined
      ? undefined
      : { retryDelayMs: earliestWaitMs };
  }

  private async runNext(): Promise<void> {
    if (this.running) {
      return;
    }

    const next = this.takeNextEligibleEntry();
    if (!next) {
      return;
    }
    if (!("entry" in next)) {
      this.scheduleDelayed(() => {
        this.schedulePump();
      }, next.retryDelayMs);
      return;
    }

    this.running = true;
    const { entry } = next;
    try {
      await entry.run();
    } catch {
      // Task bodies report their own failures; the queue only sequences them.
    } finally {
      this.lastRunAtByKey.set(entry.key, this.now());
      this.running = false;
      entry.resolvers.forEach((resolveEntry) => {
        resolveEntry();
      });
      this.schedulePump();
    }
  }
}
