import type { ImageRunNode } from "./types";

export interface ImagePaintRect {
  xPx: number;
  yPx: number;
  widthPx: number;
  heightPx: number;
}

export function resolveImagePaintBounds(
  image: Pick<ImageRunNode, "paintBounds" | "widthPx" | "heightPx">,
  widthPx = image.widthPx,
  heightPx = image.heightPx,
): ImagePaintRect | undefined {
  const bounds = image.paintBounds;
  if (!bounds || !Number.isFinite(bounds.xPx) || !Number.isFinite(bounds.yPx)) return undefined;
  const positive = (value: number | undefined): value is number =>
    typeof value === "number" && Number.isFinite(value) && value > 0;
  if (![bounds.widthPx, bounds.heightPx, bounds.layoutWidthPx, bounds.layoutHeightPx].every(positive) ||
      !positive(widthPx) || !positive(heightPx)) return undefined;
  const scaleX = widthPx / bounds.layoutWidthPx;
  const scaleY = heightPx / bounds.layoutHeightPx;
  const paint = {
    xPx: bounds.xPx * scaleX,
    yPx: bounds.yPx * scaleY,
    widthPx: bounds.widthPx * scaleX,
    heightPx: bounds.heightPx * scaleY,
  };
  return Object.values(paint).every(Number.isFinite) && positive(paint.widthPx) && positive(paint.heightPx)
    ? paint : undefined;
}
