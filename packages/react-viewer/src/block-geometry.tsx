import * as React from "react";
import { createPortal } from "react-dom";
import type {
  DocumentBlock,
  DocumentWord,
  DocxSourceRef,
} from "@extend-ai/react-docx-doc-model";

export interface BlockBoundingBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface DocxBlockFragment {
  nodeId: string;
  pageIndex: number;
  pageWidth: number;
  pageHeight: number;
  boundingBox: BlockBoundingBox;
  polygon: Array<{ x: number; y: number }>;
  coordinateSpace: "page-css-px";
}
export interface DocxBlockGeometry {
  status:
    | "rendered"
    | "partially_rendered"
    | "not_mounted"
    | "not_visible"
    | "unresolved";
  scope: "mounted_pages";
  issues: Array<{
    nodeId: string;
    reason: "unsupported_range" | "document_mismatch" | "not_on_page" | "range_text_mismatch";
  }>;
  fragments: DocxBlockFragment[];
  unresolvedSourceIds: string[];
}

function intersect(a: BlockBoundingBox, b: BlockBoundingBox): BlockBoundingBox {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
}

function visibleBox(
  element: HTMLElement,
  surface: HTMLElement,
  bounds?: BlockBoundingBox
): BlockBoundingBox | undefined {
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden")
    return undefined;
  const rect = bounds ?? element.getBoundingClientRect();
  let box: BlockBoundingBox = {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  };
  for (
    let parent = element.parentElement;
    parent && parent !== surface;
    parent = parent.parentElement
  ) {
    const style = getComputedStyle(parent);
    if (style.display === "none" || style.visibility === "hidden")
      return undefined;
    const rect = parent.getBoundingClientRect();
    if (/hidden|clip|scroll|auto/.test(style.overflowX))
      box = {
        ...box,
        left: Math.max(box.left, rect.left),
        right: Math.min(box.right, rect.right),
      };
    if (/hidden|clip|scroll|auto/.test(style.overflowY))
      box = {
        ...box,
        top: Math.max(box.top, rect.top),
        bottom: Math.min(box.bottom, rect.bottom),
      };
  }
  box = intersect(box, surface.getBoundingClientRect());
  return box.right > box.left && box.bottom > box.top ? box : undefined;
}

export function resolveDocxSourceGeometry(
  root: HTMLElement,
  refs: readonly DocxSourceRef[]
): DocxBlockGeometry {
  return resolveSourceGeometry(root, refs);
}

function textNodes(element: HTMLElement, includeNumbering = false): Text[] {
  const nodes: Text[] = [];
  const ignored = "[data-docx-generated-text],[data-docx-pagination-ignore],button,textarea,select,[aria-hidden='true']";
  const excluded = includeNumbering ? ignored : `[data-docx-numbering-label],${ignored}`;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const parent = node.parentElement;
    if (!parent || parent.closest(excluded)) continue;
    const source = parent.closest<HTMLElement>("[data-docx-source-id]");
    if (source && source !== element) {
      const prefix = `${element.dataset.docxSourceId}/child/`;
      const id = source.dataset.docxSourceId ?? "";
      if (!id.startsWith(prefix) || !/^\d+$/.test(id.slice(prefix.length))) continue;
      if (source.matches("[data-docx-image-location],[role='math']") || parent.closest("svg")) continue;
    }
    nodes.push(node);
  }
  return nodes;
}

interface TextRangeEntry {
  node: Text;
  start: number;
  end: number;
}

interface TextRangeIndex {
  entries: TextRangeEntry[];
  prefixEnds: number[];
}

interface PageMetrics {
  rect: DOMRect;
  pageIndex: number;
  pageWidth: number;
  pageHeight: number;
  xScale: number;
  yScale: number;
}

interface GeometryCache {
  elementsById?: Map<string, HTMLElement[]>;
  boxes: Map<HTMLElement, BlockBoundingBox | undefined>;
  text: Map<HTMLElement, TextRangeIndex>;
  pages: Map<HTMLElement, PageMetrics | undefined>;
}

function createGeometryCache(): GeometryCache {
  return { boxes: new Map(), text: new Map(), pages: new Map() };
}

function cachedVisibleBox(element: HTMLElement, surface: HTMLElement, cache: GeometryCache): BlockBoundingBox | undefined {
  if (!cache.boxes.has(element)) cache.boxes.set(element, visibleBox(element, surface));
  return cache.boxes.get(element);
}

function textRangeIndex(element: HTMLElement, cache: GeometryCache): TextRangeIndex {
  const cached = cache.text.get(element);
  if (cached) return cached;
  const selector = "[data-docx-text-start][data-docx-text-end]";
  const annotated = [...element.querySelectorAll<HTMLElement>(selector)]
    .filter(node => node.closest("[data-docx-source-id]") === element);
  const chunks = new Map(annotated.map(node => [node, {
    offset: Number(node.dataset.docxTextStart), end: Number(node.dataset.docxTextEnd),
  }]));
  const fallback = { offset: 0, end: Number.POSITIVE_INFINITY };
  const entries: TextRangeEntry[] = [];
  for (const node of textNodes(element)) {
    const chunk = annotated.length
      ? chunks.get(node.parentElement!.closest<HTMLElement>(selector)!)
      : fallback;
    if (!chunk) continue;
    const start = chunk.offset;
    chunk.offset += node.length;
    const end = Math.min(chunk.offset, chunk.end);
    if (Number.isFinite(start) && end > start) entries.push({ node, start, end });
  }
  entries.sort((a, b) => a.start - b.start || a.end - b.end);
  let lastEnd = 0;
  const result = { entries, prefixEnds: entries.map(entry => lastEnd = Math.max(lastEnd, entry.end)) };
  cache.text.set(element, result);
  return result;
}

function pageMetrics(surface: HTMLElement, wrapper: HTMLElement, cache: GeometryCache): PageMetrics | undefined {
  if (!cache.pages.has(surface)) {
    const rect = surface.getBoundingClientRect();
    const style = getComputedStyle(surface);
    const pageWidth = parseFloat(style.width) || surface.offsetWidth;
    const pageHeight = parseFloat(style.height) || surface.offsetHeight;
    cache.pages.set(surface, rect.width && rect.height && pageWidth && pageHeight ? {
      rect, pageWidth, pageHeight, pageIndex: Number(wrapper.dataset.docxPageIndex),
      xScale: rect.width / pageWidth, yScale: rect.height / pageHeight,
    } : undefined);
  }
  return cache.pages.get(surface);
}

function rangeBoxes(
  element: HTMLElement,
  surface: HTMLElement,
  ref: DocxSourceRef,
  cache: GeometryCache,
  expectedText?: string
): { boxes: BlockBoundingBox[]; mismatch: boolean } {
  const input = element.matches("[data-docx-drop-cap]")
    ? element.querySelector<HTMLInputElement>("input") : null;
  if (input) {
    const mismatch = expectedText !== undefined && input.value.slice(ref.start, ref.end) !== expectedText;
    return { boxes: mismatch ? [] : inputTextBoxes(input, surface, ref.start!, ref.end!), mismatch };
  }
  const boxes: BlockBoundingBox[] = [];
  let mismatch = false;
  const start = ref.start!, end = ref.end!;
  const { entries, prefixEnds } = textRangeIndex(element, cache);
  let low = 0, high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (prefixEnds[middle] <= start) low = middle + 1;
    else high = middle;
  }
  for (let index = low; index < entries.length && entries[index].start < end; index++) {
    const { node, start: nodeStart, end: nodeEnd } = entries[index];
    const from = Math.max(start, nodeStart), to = Math.min(end, nodeEnd);
    if (to <= from) continue;
    if (expectedText !== undefined && node.data.slice(from - nodeStart, to - nodeStart) !== expectedText.slice(from - start, to - start)) {
      mismatch = true;
      continue;
    }
    const clip = cachedVisibleBox(node.parentElement!, surface, cache);
    if (!clip) continue;
    const range = document.createRange();
    range.setStart(node, from - nodeStart);
    range.setEnd(node, to - nodeStart);
    for (const rect of range.getClientRects()) {
      const box = intersect(rect, clip);
      if (box.right > box.left && box.bottom > box.top) boxes.push(box);
    }
  }
  return { boxes, mismatch };
}

function inputTextBoxes(
  input: HTMLInputElement,
  surface: HTMLElement,
  start = 0,
  end = input.value.length
): BlockBoundingBox[] {
  if (start >= input.value.length || end <= start) return [];
  const style = getComputedStyle(input);
  const frame = input.getBoundingClientRect();
  const px = (value: string) => parseFloat(value) || 0;
  const insetX = px(style.borderLeftWidth) + px(style.paddingLeft);
  const insetY = px(style.borderTopWidth) + px(style.paddingTop);
  const paddingX = insetX + px(style.borderRightWidth) + px(style.paddingRight);
  const paddingY = insetY + px(style.borderBottomWidth) + px(style.paddingBottom);
  const width = px(style.width) + (style.boxSizing === "border-box" ? 0 : paddingX);
  const height = px(style.height) + (style.boxSizing === "border-box" ? 0 : paddingY);
  if (!width || !height) return [];
  const xScale = frame.width / width, yScale = frame.height / height;
  const mirror = document.createElement("span");
  mirror.dataset.docxGeometryMeasure = "true";
  Object.assign(mirror.style, {
    position: "fixed", left: "-100000px", top: "0", visibility: "hidden",
    display: "inline-block", whiteSpace: "pre", margin: "0", padding: "0", border: "0",
  });
  for (const property of [
    "font-family", "font-size", "font-weight", "font-style", "font-stretch", "font-variant",
    "font-kerning", "font-feature-settings", "font-variation-settings", "font-size-adjust",
    "font-optical-sizing", "line-height", "letter-spacing", "word-spacing", "text-transform", "direction",
  ]) mirror.style.setProperty(property, style.getPropertyValue(property));
  mirror.textContent = input.value;
  document.body.append(mirror);
  try {
    const measured = mirror.getBoundingClientRect();
    const available = Math.max(0, width - paddingX - measured.width);
    const align = style.textAlign;
    const right = align === "right" || (align === "start" && style.direction === "rtl") ||
      (align === "end" && style.direction !== "rtl");
    const left = frame.left + (insetX + (right ? available : align === "center" ? available / 2 : 0) - input.scrollLeft) * xScale;
    const top = frame.top + (insetY + (height - paddingY - measured.height) / 2) * yScale;
    const range = document.createRange();
    range.setStart(mirror.firstChild!, start);
    range.setEnd(mirror.firstChild!, Math.min(end, input.value.length));
    return [...range.getClientRects()].flatMap(rect => {
      const box = visibleBox(input, surface, intersect(frame, {
        left: left + (rect.left - measured.left) * xScale,
        top: top + (rect.top - measured.top) * yScale,
        right: left + (rect.right - measured.left) * xScale,
        bottom: top + (rect.bottom - measured.top) * yScale,
      }));
      return box ? [box] : [];
    });
  } finally {
    mirror.remove();
  }
}

function combiningMarkBox(
  node: Text,
  surface: HTMLElement,
  xScale: number
): BlockBoundingBox | undefined {
  const value = node.data.trim();
  if (!/^\p{M}+$/u.test(value)) return undefined;
  const range = document.createRange();
  range.setStart(node, node.data.search(/\S/u));
  range.setEnd(node, node.data.trimEnd().length);
  const rect = range.getBoundingClientRect();
  if (rect.width || !rect.height) return undefined;
  const parent = node.parentElement!;
  const style = getComputedStyle(parent);
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return undefined;
  context.font = style.font || `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const metrics = context.measureText(value);
  if (metrics.width || metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight <= 0) return undefined;
  let bounds: BlockBoundingBox = {
    left: rect.left - metrics.actualBoundingBoxLeft * xScale,
    right: rect.right + metrics.actualBoundingBoxRight * xScale,
    top: rect.top,
    bottom: rect.bottom,
  };
  if (style.display !== "inline" && style.display !== "contents") {
    const frame = parent.getBoundingClientRect();
    if (/hidden|clip|scroll|auto/.test(style.overflowX))
      bounds = { ...bounds, left: Math.max(bounds.left, frame.left), right: Math.min(bounds.right, frame.right) };
    if (/hidden|clip|scroll|auto/.test(style.overflowY))
      bounds = { ...bounds, top: Math.max(bounds.top, frame.top), bottom: Math.min(bounds.bottom, frame.bottom) };
  }
  return visibleBox(parent, surface, bounds);
}

function paragraphTextBoxes(
  element: HTMLElement,
  surface: HTMLElement,
  cache: GeometryCache,
  xScale: number
): BlockBoundingBox[] {
  const input = element.matches("[data-docx-drop-cap]")
    ? element.querySelector<HTMLInputElement>("input") : null;
  if (input) return inputTextBoxes(input, surface);
  const boxes: BlockBoundingBox[] = [];
  let previousExtent: BlockBoundingBox | undefined;
  const nodes = textNodes(element, true);
  for (const picture of element.querySelectorAll<HTMLElement>("[data-docx-numbering-label] img")) {
    if (picture.closest("[data-docx-source-id]") !== element) continue;
    const box = cachedVisibleBox(picture, surface, cache);
    if (box) boxes.push(box);
  }
  const marksOnly = nodes.every(node => !node.data.trim() || /^\p{M}+$/u.test(node.data.trim()));
  for (const node of nodes) {
    const start = node.data.search(/\S/u);
    if (start < 0) continue;
    const end = node.data.trimEnd().length;
    const mark = marksOnly ? combiningMarkBox(node, surface, xScale) : undefined;
    if (mark) {
      boxes.push(mark);
      previousExtent = mark;
      continue;
    }
    const clip = cachedVisibleBox(node.parentElement!, surface, cache);
    if (!clip) continue;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const textRects = [...range.getClientRects()];
    range.selectNodeContents(node);
    const fullRects = start > 0 || end < node.length ? [...range.getClientRects()] : textRects;
    for (const rect of textRects) {
      const box = intersect(rect, clip);
      if (box.right <= box.left || box.bottom <= box.top) continue;
      const fullRect = fullRects.find(full => Math.abs(full.top - rect.top) < 0.5 &&
        Math.abs(full.bottom - rect.bottom) < 0.5 && full.left <= rect.left && full.right >= rect.right);
      const extent = intersect(fullRect ?? rect, clip);
      const previous = boxes[boxes.length - 1];
      if (previous && previousExtent && Math.abs(previous.top - box.top) < 0.5 &&
          Math.abs(previous.bottom - box.bottom) < 0.5 &&
          extent.left <= previousExtent.right + 0.5 && extent.right >= previousExtent.left - 0.5) {
        previous.left = Math.min(previous.left, box.left);
        previous.right = Math.max(previous.right, box.right);
        previous.top = Math.min(previous.top, box.top);
        previous.bottom = Math.max(previous.bottom, box.bottom);
        previousExtent = {
          left: Math.min(previousExtent.left, extent.left),
          right: Math.max(previousExtent.right, extent.right),
          top: Math.min(previousExtent.top, extent.top),
          bottom: Math.max(previousExtent.bottom, extent.bottom),
        };
      } else {
        boxes.push(box);
        previousExtent = extent;
      }
    }
  }
  return boxes;
}

function resolveSourceGeometry(
  root: HTMLElement,
  refs: readonly DocxSourceRef[],
  cache: GeometryCache = createGeometryCache(),
  expectedText?: string,
  paragraphContent = false
): DocxBlockGeometry {
  const fragments: DocxBlockFragment[] = [];
  const unresolvedSourceIds: string[] = [];
  let foundElement = false;
  const issues: DocxBlockGeometry["issues"] = [];
  let textOffset = 0;
  for (const ref of refs) {
    const ranged = ref.start !== undefined || ref.end !== undefined;
    const textLength = Math.max(0, (ref.end ?? 0) - (ref.start ?? 0));
    const sourceText = expectedText?.slice(textOffset, textOffset + textLength);
    textOffset += textLength;
    if (ranged && (!Number.isInteger(ref.start) || !Number.isInteger(ref.end) || ref.start! < 0 || ref.end! <= ref.start!)) {
      issues.push({ nodeId: ref.nodeId, reason: "unsupported_range" });
      unresolvedSourceIds.push(ref.nodeId);
      continue;
    }
    const elements = cache.elementsById
      ? cache.elementsById.get(ref.nodeId) ?? []
      : root.querySelectorAll<HTMLElement>(
          `[data-docx-source-id="${CSS.escape(ref.nodeId)}"]`
        );
    let resolved = false;
    for (const element of elements) {
      const documentId = element.closest<HTMLElement>("[data-docx-document-id]")
        ?.dataset.docxDocumentId;
      if (documentId && documentId !== ref.documentId) {
        issues.push({ nodeId: ref.nodeId, reason: "document_mismatch" });
        continue;
      }
      const surface = element.closest<HTMLElement>("[data-docx-page-surface]");
      const wrapper = surface?.closest<HTMLElement>("[data-docx-page-index]");
      if (!surface || !wrapper) {
        issues.push({ nodeId: ref.nodeId, reason: "not_on_page" });
        continue;
      }
      foundElement = true;
      const box = cachedVisibleBox(element, surface, cache);
      if (!box) continue;
      const metrics = pageMetrics(surface, wrapper, cache);
      if (!metrics) continue;
      const range = ranged ? rangeBoxes(element, surface, ref, cache, sourceText) : undefined;
      if (range?.mismatch) issues.push({ nodeId: ref.nodeId, reason: "range_text_mismatch" });
      const boxes = range ? range.boxes
        : paragraphContent || element.matches("[data-docx-paragraph-host],[data-docx-section-paragraph-host],[data-docx-table-cell-paragraph-host],[data-docx-source-kind='paragraph'],[data-docx-drop-cap]")
          ? paragraphTextBoxes(element, surface, cache, metrics.xScale)
        : [box];
      const { rect: page, pageWidth, pageHeight, pageIndex, xScale, yScale } = metrics;
      for (const box of boxes) {
      const boundingBox = {
        left: (box.left - page.left) / xScale,
        top: (box.top - page.top) / yScale,
        right: (box.right - page.left) / xScale,
        bottom: (box.bottom - page.top) / yScale,
      };
      const { left, top, right, bottom } = boundingBox;
      fragments.push({
        nodeId: ref.nodeId,
        pageIndex,
        pageWidth,
        pageHeight,
        boundingBox,
        polygon: [
          { x: left, y: top },
          { x: right, y: top },
          { x: right, y: bottom },
          { x: left, y: bottom },
        ],
        coordinateSpace: "page-css-px",
      });
      resolved = true;
      }
    }
    if (!resolved) unresolvedSourceIds.push(ref.nodeId);
  }
  return {
    status: fragments.length
      ? unresolvedSourceIds.length || issues.length
        ? "partially_rendered"
        : "rendered"
      : issues.length
      ? "unresolved"
      : foundElement
      ? "not_visible"
      : "not_mounted",
    scope: "mounted_pages",
    issues,
    fragments,
    unresolvedSourceIds,
  };
}

export function resolveDocxBlockGeometries(
  root: HTMLElement,
  blocks: readonly DocumentBlock[]
): Map<string, DocxBlockGeometry> {
  const elementsById = new Map<string, HTMLElement[]>();
  for (const element of root.querySelectorAll<HTMLElement>("[data-docx-source-id]")) {
    const id = element.dataset.docxSourceId!;
    const elements = elementsById.get(id) ?? [];
    elements.push(element);
    elementsById.set(id, elements);
  }
  const cache = createGeometryCache();
  cache.elementsById = elementsById;
  return new Map(blocks.map((block) => [
    block.id,
    resolveSourceGeometry(root, block.sourceRefs, cache,
      block.sourceRefs.every(ref => ref.start !== undefined && ref.end !== undefined) ? block.content : undefined,
      block.details.kind === "paragraph" || block.type === "heading" || block.type === "section_heading"),
  ]));
}

function wordTarget(word: DocumentWord): DocumentBlock {
  return { object: "block", id: word.id, type: "text", content: word.content,
    details: { kind: "word", blockId: word.blockId }, sourceRefs: word.sourceRefs, children: [] };
}

export function resolveDocxWordGeometries(
  root: HTMLElement,
  words: readonly DocumentWord[]
): Map<string, DocxBlockGeometry> {
  return resolveDocxBlockGeometries(root, words.map(wordTarget));
}

export function DocxWordHighlights({ word, words, ...props }: {
  rootRef: React.RefObject<HTMLElement | null>;
  word?: DocumentWord;
  words?: readonly DocumentWord[];
  color?: string;
  onGeometry?: (geometry: DocxBlockGeometry) => void;
}): React.JSX.Element {
  const active = React.useMemo(() => word ? wordTarget(word) : undefined, [word]);
  const targets = React.useMemo(() => words?.map(wordTarget), [words]);
  return <DocxBlockHighlights {...props} block={active} blocks={targets} />;
}

const revealSequences = new WeakMap<HTMLElement, number>();

export function revealDocxSource(root: HTMLElement, source: string | DocxSourceRef): void {
  const nodeId = typeof source === "string" ? source : source.nodeId;
  const ref = typeof source === "string" || source.start === undefined || source.end === undefined ? undefined : source;
  const sequence = (revealSequences.get(root) ?? 0) + 1;
  revealSequences.set(root, sequence);
  const revealRange = (): boolean => {
    if (!ref) return false;
    const fragment = resolveSourceGeometry(root, [ref]).fragments[0];
    if (!fragment) return false;
    const surface = root.querySelector<HTMLElement>(
      `[data-docx-page-index="${fragment.pageIndex}"] [data-docx-page-surface]`
    );
    if (!surface) return false;
    const target = document.createElement("span");
    target.setAttribute("aria-hidden", "true");
    target.setAttribute("data-docx-pagination-ignore", "true");
    const box = fragment.boundingBox;
    Object.assign(target.style, {
      position: "absolute", width: "1px", height: "1px", pointerEvents: "none",
      left: `${(box.left + box.right) / 2}px`, top: `${(box.top + box.bottom) / 2}px`,
    });
    surface.append(target);
    target.scrollIntoView({ block: "center", inline: "nearest" });
    target.remove();
    return true;
  };
  if (ref) {
    if (revealRange()) return;
  } else {
    const element = root.querySelector<HTMLElement>(
      `[data-docx-source-id="${CSS.escape(nodeId)}"]`
    );
    if (element) {
      element.scrollIntoView({ block: "center", inline: "nearest" });
      return;
    }
  }
  const viewer = root.querySelector<HTMLElement>("[data-docx-editor-root]");
  (viewer ?? root).dispatchEvent(
    new CustomEvent("docx-reveal-source", { detail: { nodeId, start: ref?.start, end: ref?.end } })
  );
  if (ref) {
    let attempts = 0;
    const retry = () => {
      if (revealSequences.get(root) !== sequence || !root.isConnected || revealRange()) return;
      if (++attempts < 30) requestAnimationFrame(retry);
    };
    requestAnimationFrame(retry);
  }
}

export interface DocxBlockHighlightsProps {
  rootRef: React.RefObject<HTMLElement | null>;
  block?: DocumentBlock;
  blocks?: readonly DocumentBlock[];
  color?: string;
  colorForBlock?: (block: DocumentBlock) => string;
  onGeometry?: (geometry: DocxBlockGeometry) => void;
}

export function DocxBlockHighlights({
  rootRef,
  block,
  blocks,
  color = "#2563eb",
  colorForBlock,
  onGeometry,
}: DocxBlockHighlightsProps): React.JSX.Element {
  const displayed = React.useMemo(() => {
    const unique = new Map((blocks ?? []).map((item) => [item.id, item]));
    if (block) unique.set(block.id, block);
    return [...unique.values()];
  }, [block, blocks]);
  const [geometries, setGeometries] = React.useState<Map<string, DocxBlockGeometry>>(new Map());
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || !displayed.length) {
      setGeometries(new Map());
      return;
    }
    let frame = 0;
    let stopped = false;
    const update = () => {
      frame = 0;
      if (stopped) return;
      const next = resolveDocxBlockGeometries(root, displayed);
      setGeometries((previous) =>
        JSON.stringify([...previous]) === JSON.stringify([...next]) ? previous : next
      );
      if (block) onGeometry?.(next.get(block.id)!);
    };
    const schedule = () => {
      if (!frame && !stopped) frame = requestAnimationFrame(update);
    };
    const mutations = new MutationObserver((records) => {
      const relevant = records.some((record) => {
        if (
          record.target instanceof Element &&
          record.target.closest("[data-docx-block-highlight],[data-docx-geometry-measure]")
        )
          return false;
        if (record.type === "attributes" || record.type === "characterData")
          return true;
        return [...record.addedNodes, ...record.removedNodes].some(
          (node) =>
            !(
              node instanceof Element &&
              node.matches("[data-docx-block-highlight],[data-docx-geometry-measure]")
            )
        );
      });
      if (relevant) schedule();
    });
    mutations.observe(root, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "data-docx-source-id"],
    });
    const resize = new ResizeObserver(schedule);
    resize.observe(root);
    root
      .querySelectorAll("[data-docx-page-surface]")
      .forEach((page) => resize.observe(page));
    document.fonts?.addEventListener("loadingdone", schedule);
    window.addEventListener("resize", schedule);
    root.addEventListener("scroll", schedule, true);
    root.addEventListener("load", schedule, true);
    root.addEventListener("error", schedule, true);
    void document.fonts?.ready.then(schedule);
    update();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resize.disconnect();
      document.fonts?.removeEventListener("loadingdone", schedule);
      window.removeEventListener("resize", schedule);
      root.removeEventListener("scroll", schedule, true);
      root.removeEventListener("load", schedule, true);
      root.removeEventListener("error", schedule, true);
    };
  }, [rootRef, displayed, block, onGeometry]);
  const surfaces = new Map<number, HTMLElement>();
  for (const surface of rootRef.current?.querySelectorAll<HTMLElement>("[data-docx-page-surface]") ?? []) {
    const index = surface.closest<HTMLElement>("[data-docx-page-index]")?.dataset.docxPageIndex;
    if (index !== undefined) surfaces.set(Number(index), surface);
  }
  return (
    <>
      {displayed.flatMap((item) => {
        const geometry = geometries.get(item.id);
        const fragments = geometry && item.details.kind === "paragraph" && item.details.dropCap
          ? toDocxPageBlocks(item, geometry).map(page => ({
              pageIndex: page.fragments[0].pageIndex, boundingBox: page.boundingBox,
            }))
          : geometry?.fragments ?? [];
        return fragments.map((fragment, index) => {
          const surface = surfaces.get(fragment.pageIndex);
          if (!surface) return null;
          const box = fragment.boundingBox;
          const tint = colorForBlock?.(item) ?? color;
          const active = item.id === block?.id;
          return createPortal(
            <div
              data-docx-block-highlight={item.id}
              data-docx-word-highlight={item.details.kind === "word" ? item.id : undefined}
              data-docx-block-type={item.type}
              data-docx-highlight-active={active || undefined}
              aria-hidden="true"
              style={{
                position: "absolute",
                pointerEvents: "none",
                zIndex: active ? 101 : 100,
                left: box.left,
                top: box.top,
                width: box.right - box.left,
                height: box.bottom - box.top,
                boxSizing: "border-box",
                border: `${active && blocks ? 2 : 1}px solid ${tint}`,
                backgroundColor: `${tint}${active || !blocks ? "20" : "08"}`,
              }}
            />,
            surface,
            `${item.id}-${index}`
          );
        });
      })}
    </>
  );
}

export function normalizedDocxBoundingBox(fragment: DocxBlockFragment): {
  pageIndex: number;
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const { boundingBox: box, pageWidth, pageHeight, pageIndex } = fragment;
  return {
    pageIndex,
    left: box.left / pageWidth,
    top: box.top / pageHeight,
    width: (box.right - box.left) / pageWidth,
    height: (box.bottom - box.top) / pageHeight,
  };
}

export interface DocxPageBlock
  extends Omit<DocumentBlock, "id" | "parentBlockId" | "children"> {
  id: string;
  sourceBlockId: string;
  parentBlockId?: string;
  metadata: { page: { number: number; width: number; height: number } };
  boundingBox: BlockBoundingBox;
  polygon: Array<{ x: number; y: number }>;
  fragments: DocxBlockFragment[];
}

export function toDocxPageBlocks(
  block: DocumentBlock,
  geometry: DocxBlockGeometry
): DocxPageBlock[] {
  const sourceIds = new Set(block.sourceRefs.map((ref) => ref.nodeId));
  const pages = new Map<number, DocxBlockFragment[]>();
  for (const fragment of geometry.fragments) {
    if (!sourceIds.has(fragment.nodeId)) continue;
    const list = pages.get(fragment.pageIndex) ?? [];
    list.push(fragment);
    pages.set(fragment.pageIndex, list);
  }
  return [...pages]
    .sort(([a], [b]) => a - b)
    .map(([pageIndex, fragments]) => {
      const box = {
        left: Math.min(...fragments.map((f) => f.boundingBox.left)),
        top: Math.min(...fragments.map((f) => f.boundingBox.top)),
        right: Math.max(...fragments.map((f) => f.boundingBox.right)),
        bottom: Math.max(...fragments.map((f) => f.boundingBox.bottom)),
      };
      const { children: _children, id, parentBlockId, ...content } = block;
      return {
        ...content,
        id: `${id}/page/${pageIndex}`,
        sourceBlockId: id,
        parentBlockId: parentBlockId
          ? `${parentBlockId}/page/${pageIndex}`
          : undefined,
        metadata: {
          page: {
            number: pageIndex + 1,
            width: fragments[0].pageWidth,
            height: fragments[0].pageHeight,
          },
        },
        boundingBox: box,
        polygon: [
          { x: box.left, y: box.top },
          { x: box.right, y: box.top },
          { x: box.right, y: box.bottom },
          { x: box.left, y: box.bottom },
        ],
        fragments,
      };
    });
}

export type ExtendParserBlockDetails =
  | { type: "text_details" }
  | { type: "table_details"; rowCount: number; columnCount: number }
  | { type: "table_cell_details"; rowIndex: number; columnIndex: number }
  | { type: "figure_details"; imageUrl?: string; figureType?: string }
  | { type: "barcode_details"; imageUrl?: string; decodedValue?: string; format?: string }
  | { type: "key_value_details"; ocrText?: string }
  | { type: "formula_details"; latex: string }
  | Record<string, never>;

export interface ExtendParserBlock
  extends Omit<DocxPageBlock, "details" | "fragments"> {
  details: ExtendParserBlockDetails;
  sourceDetails: DocumentBlock["details"];
  coordinateSpace: "page-points";
  children: ExtendParserBlock[];
}

function extendDetails(block: DocumentBlock): ExtendParserBlockDetails {
  const d = block.details;
  const string = (name: string) => typeof d[name] === "string" ? d[name] as string : undefined;
  const number = (name: string) => typeof d[name] === "number" ? d[name] as number : 0;
  switch (block.type) {
    case "table":
      return { type: "table_details", rowCount: number("rowCount"), columnCount: number("columnCount") };
    case "table_cell":
      return { type: "table_cell_details", rowIndex: number("rowIndex"), columnIndex: number("columnIndex") };
    case "figure":
      return { type: "figure_details", imageUrl: string("imageUrl"), figureType: string("figureType") };
    case "barcode":
      return { type: "barcode_details", imageUrl: string("imageUrl"), decodedValue: string("decodedValue"), format: string("format") };
    case "key_value":
      return { type: "key_value_details", ocrText: string("ocrText") };
    case "formula":
      return string("latex") !== undefined ? { type: "formula_details", latex: string("latex")! } : {};
    default:
      return { type: "text_details" };
  }
}

export function toExtendParserBlocks(
  blocks: readonly DocumentBlock[],
  geometries: ReadonlyMap<string, DocxBlockGeometry>
): ExtendParserBlock[] {
  const occurrences = new Map<string, ExtendParserBlock>();
  const visit = (block: DocumentBlock) => {
    const geometry = geometries.get(block.id);
    if (geometry) {
      for (const page of toDocxPageBlocks(block, geometry)) {
        const { fragments: _fragments, details: sourceDetails, ...value } = page;
        const points = (px: number) => px * 72 / 96;
        occurrences.set(page.id, {
          ...value,
          details: extendDetails(block),
          sourceDetails,
          coordinateSpace: "page-points",
          metadata: { page: {
            number: page.metadata.page.number,
            width: points(page.metadata.page.width),
            height: points(page.metadata.page.height),
          } },
          boundingBox: {
            left: points(page.boundingBox.left), top: points(page.boundingBox.top),
            right: points(page.boundingBox.right), bottom: points(page.boundingBox.bottom),
          },
          polygon: page.polygon.map(({ x, y }) => ({ x: points(x), y: points(y) })),
          children: [],
        });
      }
    }
    block.children.forEach(visit);
  };
  blocks.forEach(visit);
  const roots: ExtendParserBlock[] = [];
  for (const block of occurrences.values()) {
    const parent = block.parentBlockId ? occurrences.get(block.parentBlockId) : undefined;
    if (parent) parent.children.push(block);
    else {
      delete block.parentBlockId;
      roots.push(block);
    }
  }
  return roots;
}
