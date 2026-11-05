import type { CSSProperties } from "react";
import type { TextStyle } from "@extend-ai/react-docx-doc-model";

function rgba(color: string, opacity: number): string | undefined {
  if (!/^#[\da-f]{6}$/i.test(color) || !Number.isFinite(opacity)) return undefined;
  const value = Number.parseInt(color.slice(1), 16);
  return `rgba(${value >>> 16},${(value >>> 8) & 255},${value & 255},${Math.max(0, Math.min(1, opacity))})`;
}

export function textEffectCss(style?: TextStyle): CSSProperties {
  const result: CSSProperties = {};
  const shadow = style?.textShadow;
  if (shadow && [shadow.offsetXPx, shadow.offsetYPx, shadow.blurRadiusPx].every(
    value => Number.isFinite(value) && Math.abs(value) <= 1000
  ) && shadow.blurRadiusPx >= 0) {
    const color = rgba(shadow.color, shadow.opacity);
    if (color) result.textShadow = `${shadow.offsetXPx}px ${shadow.offsetYPx}px ${shadow.blurRadiusPx * 2 / 3}px ${color}`;
  }
  const outline = style?.textOutline;
  if (outline && Number.isFinite(outline.widthPx) && outline.widthPx >= 0 && outline.widthPx <= 100) {
    const color = rgba(outline.color, outline.opacity);
    if (color) {
      result.WebkitTextStrokeWidth = `${outline.widthPx}px`;
      result.WebkitTextStrokeColor = color;
      result.paintOrder = "fill stroke";
    }
  }
  return result;
}

export function textEffectSvgAttributes(style?: TextStyle): string {
  const css = textEffectCss(style);
  const attributes: string[] = [];
  if (css.textShadow) attributes.push(`style="text-shadow:${css.textShadow}"`);
  const outline = style?.textOutline;
  if (outline && css.WebkitTextStrokeColor !== undefined) {
    const join = ["round", "bevel", "miter"].includes(outline.lineJoin) ? outline.lineJoin : "round";
    attributes.push(`stroke="${css.WebkitTextStrokeColor}" stroke-width="${outline.widthPx}" stroke-linejoin="${join}" paint-order="fill stroke"`);
  }
  return attributes.join(" ");
}
