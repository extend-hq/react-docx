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
  canvas.width = Math.max(1, Math.round(resolution.pixelWidthPx));
  canvas.height = Math.max(1, Math.round(resolution.pixelHeightPx));
  canvas.style.width = `${Math.max(1, Math.round(resolution.widthPx))}px`;
  canvas.style.height = `${Math.max(1, Math.round(resolution.heightPx))}px`;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2D canvas context is unavailable for DOCX thumbnails.");
  }

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
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

  constructor(options?: SerialIdleTaskQueueOptions) {
    this.scheduleTask = options?.scheduleTask ?? defaultScheduleTask;
    this.scheduleDelayed = options?.scheduleDelayed ?? defaultScheduleDelayed;
    this.minTaskIntervalMs = Math.max(0, options?.minTaskIntervalMs ?? 0);
    this.now = options?.now ?? (() => Date.now());
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  enqueue(key: K, run: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve) => {
      const existing = this.pending.find((entry) => entry.key === key);
      if (existing) {
        existing.run = run;
        existing.resolvers.push(resolve);
      } else {
        this.pending.push({ key, run, resolvers: [resolve] });
      }
      this.schedulePump();
    });
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
        this.pending.splice(index, 1);
        return { entry: candidate };
      }
      earliestWaitMs =
        earliestWaitMs === undefined
          ? waitMs
          : Math.min(earliestWaitMs, waitMs);
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
