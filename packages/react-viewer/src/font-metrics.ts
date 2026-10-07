let revision = 0;
let observedFonts: FontFaceSet | undefined;
let observedProfileWindow: Window | undefined;
let stopObservingProfile: (() => void) | undefined;
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

function observeRenderingProfile(): void {
  const targetWindow = typeof window !== "undefined" ? window : undefined;
  if (
    !targetWindow ||
    typeof targetWindow.addEventListener !== "function" ||
    targetWindow === observedProfileWindow
  ) {
    return;
  }
  stopObservingProfile?.();
  observedProfileWindow = targetWindow;
  const profile = (): string =>
    `${targetWindow.devicePixelRatio || 1}\u0000${targetWindow.visualViewport?.scale || 1}`;
  let currentProfile = profile();
  let resolutionQuery: MediaQueryList | undefined;
  const removeResolutionListener = (): void => {
    if (resolutionQuery?.removeEventListener) {
      resolutionQuery.removeEventListener("change", handleProfileChange);
    } else {
      resolutionQuery?.removeListener?.(handleProfileChange);
    }
  };
  const watchResolution = (): void => {
    removeResolutionListener();
    resolutionQuery =
      typeof targetWindow.matchMedia === "function"
        ? targetWindow.matchMedia(
            `(resolution: ${targetWindow.devicePixelRatio || 1}dppx)`
          )
        : undefined;
    if (resolutionQuery?.addEventListener) {
      resolutionQuery.addEventListener("change", handleProfileChange);
    } else {
      resolutionQuery?.addListener?.(handleProfileChange);
    }
  };
  function handleProfileChange(): void {
    const nextProfile = profile();
    if (nextProfile === currentProfile) return;
    currentProfile = nextProfile;
    watchResolution();
    invalidateFontMetrics();
  }
  targetWindow.addEventListener("resize", handleProfileChange);
  const viewport = targetWindow.visualViewport;
  viewport?.addEventListener?.("resize", handleProfileChange);
  watchResolution();
  stopObservingProfile = () => {
    targetWindow.removeEventListener?.("resize", handleProfileChange);
    viewport?.removeEventListener?.("resize", handleProfileChange);
    removeResolutionListener();
  };
}

export function registerFontMetricCache(invalidate: () => void): void {
  invalidators.add(invalidate);
  observeFonts();
  observeRenderingProfile();
}

export function subscribeFontMetrics(listener: () => void): () => void {
  observeFonts();
  observeRenderingProfile();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getFontMetricsRevision(): number {
  observeFonts();
  observeRenderingProfile();
  return revision;
}

export function getServerFontMetricsRevision(): number {
  return 0;
}
