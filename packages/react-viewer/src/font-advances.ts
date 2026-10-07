import { registerFontMetricCache } from "./font-metrics";

type CanvasAdvanceContext = Pick<CanvasRenderingContext2D, "font" | "measureText"> & {
  letterSpacing?: string;
  wordSpacing?: string;
  fontKerning?: string;
  direction?: string;
  textRendering?: string;
};

const MAX_FONT_ADVANCE_SCALES = 8192;
const advanceScaleByFont = new Map<string, number>();
const FONT_SIZE_RE =
  /(?:^|\s)([+]?(?:\d+(?:\.\d*)?|\.\d+))(px|pt)(?=\s|\/|$)/i;
const ADVANCE_PRECISION_PROBE = "Hamburgefontsiv 0123456789";

registerFontMetricCache(() => advanceScaleByFont.clear());

function isDesktopChromium(): boolean {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent;
  return (
    /(?:Chrome|Chromium|Edg)\/\d/.test(userAgent) &&
    !/Android|Mobile|iPhone|iPad|iPod|CriOS/i.test(userAgent)
  );
}

/** Restores nominal advances only when the current font measurement truncates its size. */
export function canvasFontAdvanceScale(
  context: CanvasAdvanceContext,
  font: string
): number {
  if (!isDesktopChromium()) return 1;
  const sizeMatch = FONT_SIZE_RE.exec(font);
  if (!sizeMatch) return 1;
  const requestedSizePx =
    Number(sizeMatch[1]) * (sizeMatch[2]?.toLowerCase() === "pt" ? 96 / 72 : 1);
  const effectiveSizePx =
    Math.floor(Math.fround(Math.fround(requestedSizePx) * 100)) / 100;
  if (
    !Number.isFinite(requestedSizePx) ||
    effectiveSizePx <= 0 ||
    effectiveSizePx >= requestedSizePx
  ) {
    return 1;
  }

  const cacheKey = `${font}\u0000${context.fontKerning ?? ""}\u0000${
    context.direction ?? ""
  }\u0000${context.textRendering ?? ""}`;
  const cached = advanceScaleByFont.get(cacheKey);
  if (cached !== undefined) return cached;

  const sizeStart = sizeMatch.index + sizeMatch[0].indexOf(sizeMatch[1]!);
  const sizeEnd = sizeStart + sizeMatch[1]!.length + sizeMatch[2]!.length;
  const effectiveFont = `${font.slice(0, sizeStart)}${effectiveSizePx}px${font.slice(
    sizeEnd
  )}`;
  const originalFont = context.font;
  const originalLetterSpacing = context.letterSpacing;
  const originalWordSpacing = context.wordSpacing;
  let scale = 1;

  try {
    if (typeof originalLetterSpacing === "string") context.letterSpacing = "0px";
    if (typeof originalWordSpacing === "string") context.wordSpacing = "0px";
    context.font = font;
    const requestedWidth = context.measureText(ADVANCE_PRECISION_PROBE).width;
    context.font = effectiveFont;
    const effectiveWidth = context.measureText(ADVANCE_PRECISION_PROBE).width;
    const tolerance =
      Number.EPSILON * Math.max(1, requestedWidth, effectiveWidth) * 8;
    if (
      requestedWidth > 0 &&
      Number.isFinite(requestedWidth) &&
      Number.isFinite(effectiveWidth) &&
      Math.abs(requestedWidth - effectiveWidth) <= tolerance
    ) {
      scale = requestedSizePx / effectiveSizePx;
    }
  } catch {
    scale = 1;
  } finally {
    context.font = originalFont;
    if (typeof originalLetterSpacing === "string") {
      context.letterSpacing = originalLetterSpacing;
    }
    if (typeof originalWordSpacing === "string") {
      context.wordSpacing = originalWordSpacing;
    }
  }

  advanceScaleByFont.set(cacheKey, scale);
  if (advanceScaleByFont.size > MAX_FONT_ADVANCE_SCALES) {
    const firstKey = advanceScaleByFont.keys().next().value;
    if (firstKey !== undefined) advanceScaleByFont.delete(firstKey);
  }
  return scale;
}

export function measureCanvasGlyphAdvance(
  context: CanvasAdvanceContext,
  font: string,
  text: string
): number {
  context.font = font;
  const scale = canvasFontAdvanceScale(context, font);
  const originalLetterSpacing = context.letterSpacing;
  const originalWordSpacing = context.wordSpacing;
  try {
    if (typeof originalLetterSpacing === "string") context.letterSpacing = "0px";
    if (typeof originalWordSpacing === "string") context.wordSpacing = "0px";
    return context.measureText(text).width * scale;
  } finally {
    if (typeof originalLetterSpacing === "string") {
      context.letterSpacing = originalLetterSpacing;
    }
    if (typeof originalWordSpacing === "string") {
      context.wordSpacing = originalWordSpacing;
    }
  }
}
