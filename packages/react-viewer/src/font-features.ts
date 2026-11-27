import type { TextStyle } from "@extend-ai/react-docx-doc-model";

export interface DocxTypographyOptions {
  compatibilityMode?: number;
  enableOpenTypeFeatures?: boolean;
  adjustLineHeightInTable?: boolean | null;
}

export const DISABLED_DOCX_FONT_FEATURE_SETTINGS =
  '"liga" 0, "clig" 0, "dlig" 0, "hlig" 0, "calt" 0';

export function resolveDocxFontFeatureSettings(
  style?: TextStyle,
  options?: DocxTypographyOptions
): string {
  if (options?.enableOpenTypeFeatures === false) {
    return DISABLED_DOCX_FONT_FEATURE_SETTINGS;
  }
  const ligatures = style?.ligatures?.toLowerCase() ?? "none";
  const enabled = (kind: string) =>
    ligatures === "all" || ligatures.includes(kind) ? 1 : 0;
  return `"liga" ${enabled("standard")}, "clig" ${enabled("contextual")}, "dlig" ${enabled("discretional")}, "hlig" ${enabled("historical")}, "calt" ${style?.contextualAlternates === true ? 1 : 0}`;
}

type CanvasFeatureContext = {
  canvas?: HTMLCanvasElement | OffscreenCanvas;
  textRendering?: string;
};

const contextsByDocument = new WeakMap<Document, CanvasRenderingContext2D>();
let fallbackContext: OffscreenCanvasRenderingContext2D | undefined;
const settingsByCanvas = new WeakMap<
  HTMLCanvasElement,
  { requested: string; serialized: string }
>();

function connectMeasurementCanvas(canvas: HTMLCanvasElement): void {
  if (canvas.isConnected) return;
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.all = "initial";
  canvas.style.position = "fixed";
  canvas.style.left = "0";
  canvas.style.top = "0";
  canvas.style.width = "0";
  canvas.style.height = "0";
  canvas.style.visibility = "hidden";
  canvas.style.pointerEvents = "none";
  canvas.ownerDocument.documentElement.appendChild(canvas);
}

export function createDocxTextMeasurementContext():
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D
  | undefined {
  if (typeof document !== "undefined") {
    const cached = contextsByDocument.get(document);
    if (cached) return cached;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d");
      if (context) {
        connectMeasurementCanvas(canvas);
        contextsByDocument.set(document, context);
        return context;
      }
    } catch {
      // Nonvisual hosts can still provide an offscreen measurement context.
    }
  }
  if (fallbackContext) return fallbackContext;
  if (typeof OffscreenCanvas !== "undefined") {
    fallbackContext = new OffscreenCanvas(1, 1).getContext("2d") ?? undefined;
  }
  return fallbackContext;
}

export function setCanvasFontFeatureSettings(
  context: CanvasFeatureContext,
  settings?: string
): void {
  const canvas = context.canvas;
  if (
    canvas &&
    typeof HTMLCanvasElement !== "undefined" &&
    canvas instanceof HTMLCanvasElement
  ) {
    connectMeasurementCanvas(canvas);
    const value = settings ?? "normal";
    const previous = settingsByCanvas.get(canvas);
    if (
      previous?.requested !== value ||
      previous.serialized !== canvas.style.fontFeatureSettings
    ) {
      canvas.style.fontFeatureSettings = value;
      settingsByCanvas.set(canvas, {
        requested: value,
        serialized: canvas.style.fontFeatureSettings,
      });
    }
    if (typeof context.textRendering === "string") context.textRendering = "auto";
    return;
  }
  if (typeof context.textRendering === "string") {
    context.textRendering = settings === DISABLED_DOCX_FONT_FEATURE_SETTINGS
      ? "optimizeSpeed"
      : "auto";
  }
}
