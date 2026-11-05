import type { CSSProperties } from "react";
import type { ImageRunNode } from "@extend-ai/react-docx-doc-model";

export function inlineDrawingEffectExtent(image: ImageRunNode): {
  left: number; top: number; right: number; bottom: number;
} {
  const extent = { left: 0, top: 0, right: 0, bottom: 0 };
  if (image.floating) return extent;
  const property = image.presentation?.properties?.find(node => node.name === "wp:effectExtent");
  const source = !property && image.sourceXml?.match(/<wp:inline\b[^>]*>[\s\S]*?<wp:effectExtent\b([^>]*)\/?\s*>/i)?.[1];
  for (const [edge, attribute] of [["left", "l"], ["top", "t"], ["right", "r"], ["bottom", "b"]] as const) {
    const value = Number(property?.attributes?.find(item => item.name === attribute)?.value ??
      (source ? new RegExp(`\\b${attribute}=["']([^"']+)["']`).exec(source)?.[1] : undefined));
    if (Number.isSafeInteger(value) && value > 0) extent[edge] = value / 9525;
  }
  return extent;
}

export function inlineDrawingEffectMargins(image: ImageRunNode): CSSProperties {
  const extent = inlineDrawingEffectExtent(image);
  return {
    ...(extent.left > 0 ? { marginLeft: extent.left } : undefined),
    ...(extent.top > 0 ? { marginTop: extent.top } : undefined),
    ...(extent.right > 0 ? { marginRight: extent.right } : undefined),
    ...(extent.bottom > 0 ? { marginBottom: extent.bottom } : undefined),
  };
}
