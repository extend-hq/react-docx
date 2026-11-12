import * as React from "react";
import type { ImageRunNode } from "@extend-ai/react-docx-doc-model";

const tags = new Set([
  "math",
  "mrow",
  "mi",
  "mn",
  "mo",
  "mtext",
  "mfrac",
  "msub",
  "msup",
  "msubsup",
  "mmultiscripts",
  "mprescripts",
  "msqrt",
  "mroot",
  "munder",
  "mover",
  "munderover",
  "mtable",
  "mtr",
  "mtd",
  "mphantom",
]);
// Wrappers drawn as a plain group. LibreOffice puts every formula in
// <semantics> beside an <annotation> of its source text, which is dropped
// like any other unlisted element, and styles parts of one with <mstyle>.
const groupTags = new Set(["semantics", "mstyle"]);
const cache = new Map<string, React.ReactNode>();

export function mathContent(image: ImageRunNode): React.ReactNode {
  if (!image.mathMl || typeof DOMParser === "undefined") return image.alt;
  const cached = cache.get(image.mathMl);
  if (cached) return cached;
  const document = new DOMParser().parseFromString(
    image.mathMl,
    "application/xml"
  );
  function render(node: Node, key: number): React.ReactNode {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (!(node instanceof Element)) return null;
    const group = groupTags.has(node.localName);
    if (!group && !tags.has(node.localName)) return null;
    return React.createElement(
      group ? "mrow" : node.localName,
      { key },
      Array.from(node.childNodes).map(render)
    );
  }
  const result = render(document.documentElement, 0);
  if (cache.size >= 256) cache.delete(cache.keys().next().value!);
  cache.set(image.mathMl, result);
  return result;
}
