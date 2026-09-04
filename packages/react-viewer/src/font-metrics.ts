let revision = 0;
let observedFonts: FontFaceSet | undefined;
const invalidators = new Set<() => void>();
const listeners = new Set<() => void>();

export function invalidateFontMetrics(): void {
  revision += 1;
  invalidators.forEach((invalidate) => invalidate());
  listeners.forEach((listener) => listener());
}

function observeFonts(): void {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (fonts === observedFonts || !fonts?.addEventListener) {
    return;
  }
  observedFonts?.removeEventListener("loadingdone", invalidateFontMetrics);
  observedFonts = fonts;
  fonts.addEventListener("loadingdone", invalidateFontMetrics);
}

export function registerFontMetricCache(invalidate: () => void): void {
  invalidators.add(invalidate);
  observeFonts();
}

export function subscribeFontMetrics(listener: () => void): () => void {
  observeFonts();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getFontMetricsRevision(): number {
  observeFonts();
  return revision;
}

export function getServerFontMetricsRevision(): number {
  return 0;
}
