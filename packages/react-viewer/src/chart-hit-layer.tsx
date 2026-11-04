import * as React from "react";

const geometry = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text"]);
const dimensions = ["x", "y", "x1", "x2", "y1", "y2", "width", "height", "rx", "ry", "cx", "cy", "r", "d", "points", "transform", "textAnchor", "fontSize", "fontFamily"];

function chartHitLayer(src: string, prefix: string): React.ReactNode {
  if (!src.startsWith("data:image/svg+xml;charset=utf-8,")) return null;
  let root: Element;
  try {
    root = new DOMParser().parseFromString(decodeURIComponent(src.slice(src.indexOf(",") + 1)), "image/svg+xml").documentElement;
  } catch {
    return null;
  }
  if (root.localName !== "svg") return null;
  function visit(node: Element, key: number, series: string | null, filled: boolean, clip = false): React.ReactNode {
    const tag = node.localName;
    series = node.getAttribute("data-docx-series") ?? series;
    if (node.hasAttribute("fill")) filled = node.getAttribute("fill") !== "none";
    const props: Record<string, string | number> = { key };
    for (const attr of dimensions) {
      const value = node.getAttribute(attr.replace(/[A-Z]/g, ch => "-" + ch.toLowerCase()));
      if (value !== null) props[attr] = value;
    }
    if (tag === "g" || tag === "defs" || tag === "clipPath") {
      const ref = node.getAttribute("clip-path")?.match(/^url\(#([\w-]+)\)$/);
      if (ref) props.clipPath = `url(#${prefix}-${ref[1]})`;
      if (tag === "clipPath") props.id = prefix + "-" + node.id;
      const children = Array.from(node.children, (child, i) => visit(child, i, series, filled, clip || tag === "clipPath")).filter(Boolean);
      return children.length ? React.createElement(tag, props, children) : null;
    }
    if (!geometry.has(tag) || (!clip && series === null)) return null;
    if (!clip) {
      props["data-docx-chart-series"] = series!;
      props.pointerEvents = filled ? "all" : "stroke";
      props.strokeWidth = filled ? 1.5 : Math.max(6, Number(node.getAttribute("stroke-width")) || 0);
      props.fill = filled ? "currentColor" : "none";
      props.stroke = "currentColor";
      props.vectorEffect = "non-scaling-stroke";
    }
    return React.createElement(tag, props, tag === "text" ? node.textContent : undefined);
  }
  return <svg viewBox={root.getAttribute("viewBox") ?? undefined} aria-hidden="true"
    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", color: "#2563eb" }}>
    {Array.from(root.children, (n, i) => visit(n, i, null, true))}
  </svg>;
}

export function ChartHitLayer({ src, selected }: { src: string; selected?: number }) {
  const prefix = "docx-chart-" + React.useId().replace(/[^\w-]/g, "");
  const overlay = React.useMemo(() => chartHitLayer(src, prefix), [src, prefix]);
  return <span id={prefix} data-docx-thumbnail-exclude="true">
    <style>{`#${prefix} [data-docx-chart-series]{opacity:0;cursor:pointer}
      #${prefix} [data-docx-chart-series="${selected}"]{opacity:.32}
      #${prefix} [data-docx-chart-series]:hover{opacity:.22}`}</style>
    {overlay}
  </span>;
}
