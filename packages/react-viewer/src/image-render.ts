import type { ImageRunNode } from "@extend-ai/react-docx-doc-model";
import { convertEmfToDataUrl, convertWmfToDataUrl } from "emf-converter";
import { encode as encodePng } from "fast-png";
import UTIFModule from "utif";

type ImageRenderSource = Pick<ImageRunNode, "src" | "contentType" | "data">;

interface TiffIfd {
  width?: number;
  height?: number;
  subIFD?: TiffIfd[];
  t256?: number;
  t257?: number;
}

interface UtifModule {
  decode(buffer: ArrayBufferLike): TiffIfd[];
  decodeImage(buffer: ArrayBufferLike, image: TiffIfd, ifds?: TiffIfd[]): void;
  toRGBA8(image: TiffIfd): Uint8Array;
}

const TIFF_CONTENT_TYPES = new Set(["image/tiff", "image/tif"]);
const PLACEHOLDER_FALLBACK_CONTENT_TYPES = new Set([
  "image/x-emf",
  "image/emf",
  "image/x-wmf",
  "image/wmf"
]);
const TIFF_DATA_URI_PREFIXES = ["data:image/tiff", "data:image/tif"];
const EMF_DATA_URI_PREFIXES = ["data:image/emf", "data:image/x-emf"];
const WMF_DATA_URI_PREFIXES = ["data:image/wmf", "data:image/x-wmf"];
const UTIF = UTIFModule as unknown as UtifModule;
const convertedTiffSrcCache = new Map<string, string | undefined>();
const convertedMetafileSrcCache = new Map<string, string | null>();
const pendingMetafileConversions = new Map<string, Promise<string | undefined>>();
const renderableImageSourceListeners = new Set<() => void>();

function normalizeImageContentType(image: ImageRenderSource): string | undefined {
  return image.contentType?.trim().toLowerCase();
}

function normalizeImageSrc(image: ImageRenderSource): string | undefined {
  return image.src?.trim();
}

function imageHasTiffContent(image: ImageRenderSource): boolean {
  const contentType = normalizeImageContentType(image);
  if (contentType && TIFF_CONTENT_TYPES.has(contentType)) {
    return true;
  }

  const src = normalizeImageSrc(image)?.toLowerCase();
  return Boolean(src && TIFF_DATA_URI_PREFIXES.some((prefix) => src.startsWith(prefix)));
}

function imageHasMetafileContent(image: ImageRenderSource): boolean {
  const contentType = normalizeImageContentType(image);
  if (contentType && PLACEHOLDER_FALLBACK_CONTENT_TYPES.has(contentType)) {
    return true;
  }

  const src = normalizeImageSrc(image)?.toLowerCase();
  return Boolean(
    src &&
      (EMF_DATA_URI_PREFIXES.some((prefix) => src.startsWith(prefix)) ||
        WMF_DATA_URI_PREFIXES.some((prefix) => src.startsWith(prefix)))
  );
}

function imageUsesEmfContent(image: ImageRenderSource): boolean {
  const contentType = normalizeImageContentType(image);
  if (contentType === "image/x-emf" || contentType === "image/emf") {
    return true;
  }

  const src = normalizeImageSrc(image)?.toLowerCase();
  return Boolean(src && EMF_DATA_URI_PREFIXES.some((prefix) => src.startsWith(prefix)));
}

function imageUsesWmfContent(image: ImageRenderSource): boolean {
  const contentType = normalizeImageContentType(image);
  if (contentType === "image/x-wmf" || contentType === "image/wmf") {
    return true;
  }

  const src = normalizeImageSrc(image)?.toLowerCase();
  return Boolean(src && WMF_DATA_URI_PREFIXES.some((prefix) => src.startsWith(prefix)));
}

function metafileCacheKey(image: ImageRenderSource): string | undefined {
  const src = normalizeImageSrc(image);
  if (src) {
    return src;
  }

  const bytes = image.data;
  if (!bytes?.byteLength) {
    return undefined;
  }

  const base64 = bytesToBase64(bytes);
  const contentType = normalizeImageContentType(image) ?? "application/octet-stream";
  return base64 ? `data:${contentType};base64,${base64}` : undefined;
}

function notifyRenderableImageSourceListeners(): void {
  renderableImageSourceListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // Ignore listener errors to avoid breaking image conversion updates.
    }
  });
}

export function imageUsesPlaceholderFallback(image: ImageRenderSource): boolean {
  const contentType = normalizeImageContentType(image);
  if (!contentType || !PLACEHOLDER_FALLBACK_CONTENT_TYPES.has(contentType)) {
    return false;
  }

  const cacheKey = metafileCacheKey(image);
  if (!cacheKey) {
    return true;
  }

  return convertedMetafileSrcCache.get(cacheKey) == null;
}

export function unsupportedImageFallbackLabel(
  image: ImageRenderSource,
  widthPx?: number,
  heightPx?: number
): string {
  const isSmallIcon = (widthPx ?? 0) <= 56 && (heightPx ?? 0) <= 56;
  const contentType = normalizeImageContentType(image);
  if (contentType === "image/x-emf" || contentType === "image/emf") {
    return isSmallIcon ? "e" : "EMF";
  }
  if (contentType === "image/x-wmf" || contentType === "image/wmf") {
    return isSmallIcon ? "w" : "WMF";
  }
  return isSmallIcon ? "e" : "TIFF";
}

function dataUriToBytes(dataUri: string): Uint8Array | undefined {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) {
    return undefined;
  }

  const [, , base64] = match;
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }

  if (typeof atob !== "function") {
    return undefined;
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string | undefined {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  if (typeof btoa !== "function") {
    return undefined;
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.byteLength; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBufferLike {
  const { buffer, byteOffset, byteLength } = bytes;
  if (byteOffset === 0 && byteLength === buffer.byteLength) {
    return buffer;
  }

  return buffer.slice(byteOffset, byteOffset + byteLength);
}

function toStrictArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const arrayBuffer = toArrayBuffer(bytes);
  if (arrayBuffer instanceof ArrayBuffer) {
    return arrayBuffer;
  }

  return Uint8Array.from(bytes).buffer;
}

function resolveTiffBytes(image: ImageRenderSource): Uint8Array | undefined {
  if (image.data?.byteLength) {
    return image.data;
  }

  const src = normalizeImageSrc(image);
  return src ? dataUriToBytes(src) : undefined;
}

function selectPrimaryTiffPage(ifds: TiffIfd[]): TiffIfd | undefined {
  if (ifds.length === 0) {
    return undefined;
  }

  let candidates = ifds;
  if (Array.isArray(ifds[0]?.subIFD) && ifds[0].subIFD.length > 0) {
    candidates = candidates.concat(ifds[0].subIFD);
  }

  let best: TiffIfd | undefined;
  let maxArea = -1;
  for (const candidate of candidates) {
    const width = candidate.width ?? candidate.t256 ?? 0;
    const height = candidate.height ?? candidate.t257 ?? 0;
    if (!width || !height) {
      continue;
    }

    const area = width * height;
    if (best === undefined || area > maxArea) {
      best = candidate;
      maxArea = area;
    }
  }

  return best ?? ifds[0];
}

function convertTiffToPngDataUri(bytes: Uint8Array): string | undefined {
  const tiffBuffer = toArrayBuffer(bytes);
  const ifds = UTIF.decode(tiffBuffer);
  const page = selectPrimaryTiffPage(ifds);
  if (!page) {
    return undefined;
  }

  UTIF.decodeImage(tiffBuffer, page, ifds);
  const width = page.width ?? page.t256 ?? 0;
  const height = page.height ?? page.t257 ?? 0;
  const rgba = UTIF.toRGBA8(page);
  if (!width || !height || rgba.byteLength !== width * height * 4) {
    return undefined;
  }

  const pngBytes = encodePng({
    width,
    height,
    data: rgba,
    channels: 4,
    depth: 8
  });

  const base64 = bytesToBase64(pngBytes);
  return base64 ? `data:image/png;base64,${base64}` : undefined;
}

export function resolveRenderableImageSource(image: ImageRenderSource): string | undefined {
  const src = normalizeImageSrc(image);
  if (!src) {
    return undefined;
  }

  if (imageHasMetafileContent(image)) {
    const cacheKey = metafileCacheKey(image);
    if (!cacheKey) {
      return undefined;
    }

    if (convertedMetafileSrcCache.has(cacheKey)) {
      return convertedMetafileSrcCache.get(cacheKey) ?? undefined;
    }

    if (!pendingMetafileConversions.has(cacheKey)) {
      const bytes = resolveTiffBytes(image);
      if (bytes) {
        const conversionPromise = (async (): Promise<string | undefined> => {
          try {
            const arrayBuffer = toStrictArrayBuffer(bytes);
            const converted = imageUsesEmfContent(image)
              ? await convertEmfToDataUrl(arrayBuffer, undefined, undefined, { dpiScale: 1 })
              : imageUsesWmfContent(image)
              ? await convertWmfToDataUrl(arrayBuffer, undefined, undefined, { dpiScale: 1 })
              : null;
            const normalized = converted ?? undefined;
            convertedMetafileSrcCache.set(cacheKey, normalized ?? null);
            notifyRenderableImageSourceListeners();
            return normalized;
          } catch {
            convertedMetafileSrcCache.set(cacheKey, null);
            notifyRenderableImageSourceListeners();
            return undefined;
          } finally {
            pendingMetafileConversions.delete(cacheKey);
          }
        })();

        pendingMetafileConversions.set(cacheKey, conversionPromise);
      } else {
        convertedMetafileSrcCache.set(cacheKey, null);
      }
    }

    return undefined;
  }

  if (!imageHasTiffContent(image)) {
    return src;
  }

  const cached = convertedTiffSrcCache.get(src);
  if (cached !== undefined || convertedTiffSrcCache.has(src)) {
    return cached;
  }

  let converted: string | undefined;
  try {
    const bytes = resolveTiffBytes(image);
    if (bytes) {
      converted = convertTiffToPngDataUri(bytes);
    }
  } catch {
    converted = undefined;
  }

  convertedTiffSrcCache.set(src, converted);
  return converted;
}

export function subscribeRenderableImageSourceUpdates(listener: () => void): () => void {
  renderableImageSourceListeners.add(listener);
  return () => {
    renderableImageSourceListeners.delete(listener);
  };
}
