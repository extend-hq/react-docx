import { resolveImagePaintBounds, type ImagePaintRect, type ImageRunNode, type ParagraphNode } from "@extend-ai/react-docx-doc-model";

interface Element {
  name: string;
  attrs: Record<string, string>;
  start: number;
  openEnd: number;
  closeStart: number;
  end: number;
  children: Element[];
  parent?: Element;
}
interface Matrix { sx: number; sy: number; x: number; y: number }
export interface VmlStoryFrame { x: number; y: number; width: number; height: number }
export interface VmlCompositeStory {
  index: number;
  editable: boolean;
  text: string;
  sourceXml: string;
  paragraphs: readonly ParagraphNode[];
  frame: VmlStoryFrame;
  framePx: VmlStoryFrame;
}
export interface VmlCompositeStories {
  stories: readonly VmlCompositeStory[];
  artworkSrc: string;
  overlaySafe: boolean;
  paintBounds?: ImagePaintRect;
}
export type VmlStoryRenderer = (image: ImageRunNode) => string | undefined;
interface Story extends VmlCompositeStory {
  source: Element;
  shape: Element;
  sourceParagraphs: Element[];
  slot?: { start: number; end: number; parent: Element };
}
interface Mapping {
  source: string;
  svg: string;
  root: Element;
  stories: Story[];
  paintBounds?: ImagePaintRect;
}
const identity: Matrix = { sx: 1, sy: 1, x: 0, y: 0 };
const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const xmlNamespace = "http://www.w3.org/XML/1998/namespace";
const xmlSpace = /^[\x20\t\r\n]*$/;
const nameStart = "A-Z_a-z\\u00c0-\\u00d6\\u00d8-\\u00f6\\u00f8-\\u02ff\\u0370-\\u037d\\u037f-\\u1fff\\u200c-\\u200d\\u2070-\\u218f\\u2c00-\\u2fef\\u3001-\\ud7ff\\uf900-\\ufdcf\\ufdf0-\\ufffd\\u{10000}-\\u{effff}";
const nameChar = `${nameStart}.0-9\\u00b7\\u0300-\\u036f\\u203f-\\u2040\\-`;
const ncNameSource = `[${nameStart}][${nameChar}]*`;
const qNameSource = `${ncNameSource}(?::${ncNameSource})?`;
const ncName = new RegExp(`^${ncNameSource}$`, "u");
const xmlTag = new RegExp(`^<(\\/?)(${qNameSource})(?=[\\x20\\t\\r\\n/>])((?:[^<>"']|"[^"]*"|'[^']*')*)>`, "u");
const xmlAttribute = new RegExp(`^[\\x20\\t\\r\\n]+(${qNameSource})[\\x20\\t\\r\\n]*=[\\x20\\t\\r\\n]*(?:"([^"]*)"|'([^']*)')`, "u");
const xmlInstruction = new RegExp(`^<\\?([:${nameStart}][${nameChar}:]*)(?:[\\x20\\t\\r\\n][\\s\\S]*?)?\\?>$`, "u");
const numberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const sourceProperties = new Set("w:pPr w:rPr w:pStyle w:rFonts w:b w:bCs w:i w:iCs w:u w:strike w:dstrike w:sz w:szCs w:color w:lang w:spacing w:ind w:jc w:contextualSpacing w:keepNext w:keepLines w:widowControl w:shd w:rtl w:bidi w:outlineLvl w:snapToGrid".split(" "));
function xmlCharacter(code: number): boolean {
  return code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
}
function decode(value: string): string {
  return value.replace(/&([^;]*);|&/g, (whole, entity: string | undefined) => {
    const names: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (entity && Object.hasOwn(names, entity)) return names[entity];
    const numeric = entity?.match(/^#(x[0-9a-fA-F]+|[0-9]+)$/);
    const code = numeric ? Number.parseInt(numeric[1].replace(/^x/i, ""), /^x/i.test(numeric[1]) ? 16 : 10) : NaN;
    if (!Number.isInteger(code) || !xmlCharacter(code)) throw new Error("Invalid XML entity");
    return String.fromCodePoint(code);
  });
}
function escape(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}
function scan(xml: string): Element {
  for (const character of xml) if (!xmlCharacter(character.codePointAt(0)!)) throw new Error("Invalid XML character");
  const stack: Element[] = [];
  const roots: Element[] = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf("<", cursor);
    if (start < 0) { if (!xmlSpace.test(xml.slice(cursor)) && !stack.length) throw new Error("Trailing XML"); break; }
    if (!stack.length && !xmlSpace.test(xml.slice(cursor, start))) throw new Error("Outside XML text");
    if (xml.startsWith("<!--", start)) {
      const end = xml.indexOf("-->", start + 4); if (end < 0) throw new Error("Unclosed comment"); cursor = end + 3; continue;
    }
    if (xml.startsWith("<?", start)) {
      const end = xml.indexOf("?>", start + 2); if (end < 0) throw new Error("Unclosed instruction"); cursor = end + 2; continue;
    }
    if (xml.startsWith("<![CDATA[", start)) {
      const end = xml.indexOf("]]>", start + 9); if (end < 0) throw new Error("Unclosed character data"); cursor = end + 3; continue;
    }
    const match = xmlTag.exec(xml.slice(start));
    if (!match) throw new Error("Unsupported XML declaration");
    cursor = start + match[0].length;
    if (match[1]) {
      const node = stack.pop();
      if (!node || node.name !== match[2] || !xmlSpace.test(match[3])) throw new Error("Mismatched XML close");
      node.closeStart = start; node.end = cursor; continue;
    }
    const selfClosing = match[3].endsWith("/");
    let remaining = selfClosing ? match[3].slice(0, -1) : match[3];
    const attrs: Record<string, string> = Object.create(null);
    while (!xmlSpace.test(remaining)) {
      const attr = xmlAttribute.exec(remaining);
      if (!attr || Object.hasOwn(attrs, attr[1])) throw new Error("Invalid XML attribute");
      if ((attr[2] ?? attr[3]).includes("<")) throw new Error("Invalid XML attribute value");
      attrs[attr[1]] = decode((attr[2] ?? attr[3]).replace(/\r\n/g, "\n").replace(/[\t\r\n]/g, " ")); remaining = remaining.slice(attr[0].length);
    }
    for (const [name, value] of Object.entries(attrs)) {
      if (name !== "xmlns" && !name.startsWith("xmlns:")) continue;
      const prefix = name === "xmlns" ? "" : name.slice(6);
      if (prefix === "xmlns" || value === "http://www.w3.org/2000/xmlns/" || (prefix === "xml" ? value !== xmlNamespace : value === xmlNamespace) || (prefix && !value)) throw new Error("Invalid namespace declaration");
    }
    const parent = stack.at(-1);
    const node: Element = { name: match[2], attrs, start, openEnd: cursor, closeStart: cursor, end: cursor, children: [], parent };
    (parent?.children ?? roots).push(node);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length || roots.length !== 1) throw new Error("Incomplete XML");
  return roots[0];
}
function all(node: Element): Element[] { return [node, ...node.children.flatMap(all)]; }
function plain(node: Element, xml: string): string {
  if (node.children.length) throw new Error("Nested text");
  return decode(xml.slice(node.openEnd, node.closeStart));
}
function numeric(value: string | undefined, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (value === undefined || !numberPattern.test(value.trim())) throw new Error("Invalid coordinate");
  const n = Number(value); if (!Number.isFinite(n)) throw new Error("Invalid coordinate"); return n;
}
function pair(value: string | undefined, fallback?: [number, number]): [number, number] {
  if (value === undefined && fallback) return fallback;
  const values = value?.trim().split(/[\s,]+/); if (values?.length !== 2) throw new Error("Invalid pair");
  return [numeric(values[0]), numeric(values[1])];
}
function styles(value = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of value.split(";")) {
    if (!entry.trim()) continue;
    const colon = entry.indexOf(":"); if (colon < 0) throw new Error("Invalid style");
    const key = entry.slice(0, colon).trim().toLowerCase(); if (Object.hasOwn(result, key)) throw new Error("Duplicate style");
    result[key] = entry.slice(colon + 1).trim();
  }
  return result;
}
function multiply(a: Matrix, b: Matrix): Matrix { return { sx: a.sx * b.sx, sy: a.sy * b.sy, x: a.x + a.sx * b.x, y: a.y + a.sy * b.y }; }
function frame(node: Element): VmlStoryFrame {
  const s = styles(node.attrs.style);
  if (s.rotation || s.flip || node.attrs.rotation || node.attrs.flip) throw new Error("Unsupported shape transform");
  const result = { x: numeric(s.left, 0), y: numeric(s.top, 0), width: numeric(s.width), height: numeric(s.height) };
  if (result.width <= 0 || result.height <= 0) throw new Error("Empty frame"); return result;
}
function sourceFrame(shape: Element, root: Element): VmlStoryFrame {
  let matrix = identity;
  const parents: Element[] = [];
  for (let node = shape.parent; node && node !== root; node = node.parent) { if (node.name !== "v:group") throw new Error("Unsupported VML ancestor"); parents.unshift(node); }
  for (const node of parents) {
    const f = frame(node); const size = pair(node.attrs.coordsize); const origin = pair(node.attrs.coordorigin, [0, 0]);
    if (size.some((n) => n <= 0)) throw new Error("Invalid group size");
    const sx = f.width / size[0], sy = f.height / size[1]; matrix = multiply(matrix, { sx, sy, x: f.x - sx * origin[0], y: f.y - sy * origin[1] });
  }
  const f = frame(shape); return { x: matrix.x + f.x * matrix.sx, y: matrix.y + f.y * matrix.sy, width: f.width * matrix.sx, height: f.height * matrix.sy };
}
function svgData(src: string | undefined): string {
  if (!src) throw new Error("Missing SVG");
  const comma = src.indexOf(","); const header = src.slice(0, comma);
  if (comma < 0 || !/^data:image\/svg\+xml(?:;charset=utf-8)?(?:;base64)?$/i.test(header)) throw new Error("Unsupported SVG URI");
  return /;base64$/i.test(header) ? new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(src.slice(comma + 1)), (c) => c.charCodeAt(0))) : decodeURIComponent(src.slice(comma + 1));
}
function uri(svg: string): string { return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; }
function viewBox(node: Element): VmlStoryFrame {
  const values = node.attrs.viewBox?.trim().split(/[\s,]+/).map((n) => numeric(n));
  if (!values || values.length !== 4 || values[2] <= 0 || values[3] <= 0) throw new Error("Invalid view box");
  return { x: values[0], y: values[1], width: values[2], height: values[3] };
}
function transform(value = ""): Matrix {
  let result = identity, rest = value.trim();
  while (rest) {
    const match = /^(translate|scale|matrix)\s*\(([^)]*)\)\s*/.exec(rest); if (!match) throw new Error("Unsupported SVG transform");
    const n = match[2].trim().split(/[\s,]+/).map((x) => numeric(x)); let next: Matrix;
    if (match[1] === "translate" && (n.length === 1 || n.length === 2)) next = { sx: 1, sy: 1, x: n[0], y: n[1] ?? 0 };
    else if (match[1] === "scale" && (n.length === 1 || n.length === 2)) next = { sx: n[0], sy: n[1] ?? n[0], x: 0, y: 0 };
    else if (match[1] === "matrix" && n.length === 6 && n[1] === 0 && n[2] === 0) next = { sx: n[0], sy: n[3], x: n[4], y: n[5] };
    else throw new Error("Unsupported SVG transform");
    if (next.sx <= 0 || next.sy <= 0) throw new Error("Unsupported reflection");
    result = multiply(result, next); rest = rest.slice(match[0].length);
  }
  return result;
}
function svgMatrix(parent: Element, root: Element): Matrix {
  const ancestors: Element[] = []; for (let n: Element | undefined = parent; n && n !== root; n = n.parent) ancestors.unshift(n);
  let result = transform(root.attrs.transform);
  for (const node of ancestors) {
    if (node.name !== "svg" && node.name !== "g") throw new Error("Unsupported SVG ancestor");
    result = multiply(result, transform(node.attrs.transform));
    if (node.name === "svg") {
      const v = viewBox(node), width = numeric(node.attrs.width), height = numeric(node.attrs.height);
      if (width <= 0 || height <= 0 || (node.attrs.preserveAspectRatio && node.attrs.preserveAspectRatio !== "none")) throw new Error("Unsupported viewport");
      const sx = width / v.width, sy = height / v.height;
      if (!node.attrs.preserveAspectRatio && Math.abs(sx - sy) > 1e-8) throw new Error("Ambiguous aspect ratio");
      result = multiply(result, { sx, sy, x: numeric(node.attrs.x, 0) - sx * v.x, y: numeric(node.attrs.y, 0) - sy * v.y });
    }
  }
  return result;
}
function visible(node: Element): boolean {
  for (let n: Element | undefined = node; n; n = n.parent) {
    const s = styles(n.attrs.style);
    if (n.attrs.display === "none" || n.attrs.visibility === "hidden" || s.display === "none" || s.visibility === "hidden" || numeric(n.attrs.opacity, 1) === 0 || (s.opacity !== undefined && numeric(s.opacity) === 0)) return false;
    if (n.attrs["clip-path"] || n.attrs.mask || n.attrs.filter || s.transform || n.name === "defs" || n.name === "symbol") return false;
  }
  return true;
}
function textValue(node: Element, svg: string): string {
  if (!node.children.length) return plain(node, svg);
  let result = "", cursor = node.openEnd;
  for (const child of node.children) {
    if (child.name !== "tspan" || child.children.length) throw new Error("Unsupported SVG text");
    result += decode(svg.slice(cursor, child.start)) + plain(child, svg); cursor = child.end;
  }
  return result + decode(svg.slice(cursor, node.closeStart));
}
function paragraphText(node: Element, xml: string): string {
  for (const child of all(node)) {
    if (boundWordNamespace(child) !== wordNamespace) throw new Error("Invalid story namespace");
    if (!["w:p", "w:r", "w:t", "w:bookmarkStart", "w:bookmarkEnd"].includes(child.name) && !sourceProperties.has(child.name)) throw new Error("Unsupported story content");
  }
  if (node.children.some((c) => !["w:pPr", "w:r", "w:bookmarkStart", "w:bookmarkEnd"].includes(c.name))) throw new Error("Unsupported paragraph content");
  for (const run of node.children.filter((c) => c.name === "w:r")) if (run.children.some((c) => c.name !== "w:rPr" && c.name !== "w:t")) throw new Error("Unsupported run");
  return all(node).filter((c) => c.name === "w:t").map((c) => plain(c, xml)).join("");
}
function boundWordNamespace(node: Element): string {
  for (let current: Element | undefined = node; current; current = current.parent) {
    if (Object.hasOwn(current.attrs, "xmlns:w")) return current.attrs["xmlns:w"];
  }
  return wordNamespace;
}
function emptyBookmarkContent(marker: Element, xml: string): boolean {
  if (marker.children.length) return false;
  const whitespace = /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/;
  const content = xml.slice(marker.openEnd, marker.closeStart);
  let cursor = 0;
  while (cursor < content.length) {
    if (content.startsWith("<!--", cursor)) {
      const end = content.indexOf("-->", cursor + 4);
      if (end < 0 || !whitespace.test(content.slice(cursor + 4, end))) return false;
      cursor = end + 3;
    } else if (content.startsWith("<![CDATA[", cursor)) {
      const end = content.indexOf("]]>", cursor + 9);
      if (end < 0 || !whitespace.test(content.slice(cursor + 9, end))) return false;
      cursor = end + 3;
    } else if (content.startsWith("<?", cursor)) {
      const end = content.indexOf("?>", cursor + 2);
      if (end < 0) return false;
      const instruction = xmlInstruction.exec(content.slice(cursor, end + 2));
      if (!instruction || instruction[1].toLowerCase() === "xml") return false;
      cursor = end + 2;
    } else {
      const next = content.indexOf("<", cursor);
      const end = next < 0 ? content.length : next;
      if (end === cursor || !whitespace.test(decode(content.slice(cursor, end)))) return false;
      cursor = end;
    }
  }
  return true;
}
function paragraphBookmarks(node: Element, xml: string, seenIds = new Set<string>()): { side: "before" | "after"; xml: string }[] {
  if (all(node).some((child) => (child.name === "w:bookmarkStart" || child.name === "w:bookmarkEnd") && child.parent !== node)) throw new Error("Nested bookmark marker");
  const textRuns = node.children.filter((n) => n.name === "w:r" && all(n).some((c) => c.name === "w:t" && plain(c, xml).length > 0));
  const open = new Set<string>();
  const markers = node.children.filter((n) => n.name === "w:bookmarkStart" || n.name === "w:bookmarkEnd").map((marker) => {
    if (boundWordNamespace(marker) !== wordNamespace || Object.keys(marker.attrs).some((name) => name !== "xmlns" && !name.startsWith("xmlns:") && !(name.startsWith("w:") && ncName.test(name.slice(2)))) || !emptyBookmarkContent(marker, xml)) throw new Error("Unsupported bookmark XML");
    const id = marker.attrs["w:id"];
    if (id === undefined || id.length === 0 || (marker.name === "w:bookmarkStart" ? seenIds.has(id) : !open.has(id))) throw new Error("Unpaired or reused bookmark");
    if (marker.name === "w:bookmarkStart") { open.add(id); seenIds.add(id); } else open.delete(id);
    if (textRuns.length && marker.start > textRuns[0].start && marker.end < textRuns.at(-1)!.end) throw new Error("Interior bookmark boundary");
    const side = !textRuns.length || marker.start < textRuns[0].start ? "before" : "after";
    return { side: side as "before" | "after", xml: xml.slice(marker.start, marker.end) };
  });
  if (open.size) throw new Error("Cross-paragraph bookmark");
  return markers;
}
function typedText(node: ParagraphNode): string {
  let style: string | undefined;
  return node.children.map((child) => {
    if (child.type !== "text" || child.link || child.noteReference) throw new Error("Unsupported typed content");
    const paint = child.style;
    if (paint && (paint.allCaps || paint.smallCaps || paint.highlight || paint.backgroundColor || paint.verticalAlign || paint.runBorder || paint.rightToLeft || paint.complexScript || (paint.characterSpacingTwips !== undefined && paint.characterSpacingTwips !== 0) || (paint.characterScalePercent !== undefined && paint.characterScalePercent !== 100) || paint.kerningMinFontSizePt !== undefined || paint.ligatures !== undefined || paint.contextualAlternates !== undefined)) throw new Error("Unsupported typed paint");
    const next = JSON.stringify(Object.entries(child.style ?? {})
      .filter(([key]) => key !== "language" && key !== "languageEastAsia" && key !== "languageBidi")
      .sort(([a], [b]) => a.localeCompare(b)));
    if (child.text && style !== undefined && style !== next) throw new Error("Mixed text paint");
    if (child.text) style = next; return child.text;
  }).join("");
}
function aggregate(stories: readonly { text: string }[]): string { return stories.map((s) => s.text).filter((s) => s.length > 0).join("\n"); }
function plainContainer(node: Element): boolean {
  const allowed = new Set("xmlns xmlns:xlink xml:space x y width height viewBox preserveAspectRatio overflow transform data-docx-vml-story".split(" "));
  return ["svg", "g"].includes(node.name) && Object.keys(node.attrs).every((name) => allowed.has(name));
}
function sourcePaintStories(group: Element): Element[] {
  const ordered = group.children.map((node, index) => ({ node, index, z: numeric(styles(node.attrs.style)["z-index"], 0) })).sort((a, b) => a.z - b.z || a.index - b.index);
  return ordered.flatMap(({ node }) => node.name === "v:group" ? sourcePaintStories(node) : all(node).filter((n) => n.name === "w:txbxContent"));
}
function map(image: ImageRunNode): Mapping {
  if (!image.syntheticTextBox || !image.sourceXml || !image.contentNodes?.length) throw new Error("Missing source story");
  const source = image.sourceXml, sourceRoot = scan(source), groups = all(sourceRoot).filter((n) => n.name === "v:group");
  const outerGroups = groups.filter((n) => !groups.some((g) => g !== n && g.start < n.start && g.end > n.end));
  const group = outerGroups[0];
  if (outerGroups.length !== 1 || !group) throw new Error("Ambiguous VML group");
  if (groups.some((g) => { const s = styles(g.attrs.style); return s.rotation || s.flip || g.attrs.rotation || g.attrs.flip; })) throw new Error("Unsupported group transform");
  const svg = svgData(image.src), root = scan(svg); if (root.name !== "svg" || root.attrs.transform) throw new Error("Unsupported SVG root");
  const viewport = viewBox(root);
  const paintBounds = resolveImagePaintBounds(image);
  if (image.paintBounds) {
    if (!paintBounds) throw new Error("Invalid paint bounds");
    const reference = image.paintBounds;
    const size = pair(group.attrs.coordsize, [1000, 1000]);
    const origin = pair(group.attrs.coordorigin, [0, 0]);
    const groupStyle = styles(group.attrs.style);
    const pixels = (value: string): number => {
      const match = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*(px|pt|in|cm|mm)?$/i.exec(value.trim());
      if (!match) throw new Error("Invalid layout unit");
      const factors: Record<string, number> = { px: 1, pt: 96 / 72, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };
      return numeric(match[1]) * factors[match[2]?.toLowerCase() ?? "px"];
    };
    if (size.some((value) => value <= 0) ||
        pixels(groupStyle.width ?? "") !== reference.layoutWidthPx ||
        pixels(groupStyle.height ?? "") !== reference.layoutHeightPx ||
        numeric(root.attrs.width) !== reference.widthPx || numeric(root.attrs.height) !== reference.heightPx ||
        (reference.layoutWidthPx === size[0] ? viewport.x - origin[0] : (viewport.x - origin[0]) * reference.layoutWidthPx / size[0]) !== reference.xPx ||
        (reference.layoutHeightPx === size[1] ? viewport.y - origin[1] : (viewport.y - origin[1]) * reference.layoutHeightPx / size[1]) !== reference.yPx ||
        (reference.layoutWidthPx === size[0] ? viewport.width : viewport.width === size[0] ? reference.layoutWidthPx : viewport.width * reference.layoutWidthPx / size[0]) !== reference.widthPx ||
        (reference.layoutHeightPx === size[1] ? viewport.height : viewport.height === size[1] ? reference.layoutHeightPx : viewport.height * reference.layoutHeightPx / size[1]) !== reference.heightPx) throw new Error("Incoherent paint bounds");
  }
  const displayWidth = paintBounds?.widthPx ?? image.widthPx ?? numeric(root.attrs.width), displayHeight = paintBounds?.heightPx ?? image.heightPx ?? numeric(root.attrs.height);
  const aspectRatio = root.attrs.preserveAspectRatio;
  if (aspectRatio !== "none" && ((aspectRatio !== undefined && aspectRatio !== "xMidYMid meet") || Math.abs(displayWidth / viewport.width - displayHeight / viewport.height) > 1e-8)) throw new Error("Unsupported root aspect ratio");
  const svgNodes = all(root);
  if (svgNodes.some((n) => n.name === "style")) throw new Error("Unsupported stylesheet");
  if (!svgNodes.some((n) => n.name === "image" && visible(n) && /^data:image\//.test(n.attrs.href ?? n.attrs["xlink:href"] ?? "") && numeric(n.attrs.width, 0) > 0 && numeric(n.attrs.height, 0) > 0)) throw new Error("Missing bitmap artwork");
  const texts = svgNodes.filter((n) => n.name === "text");
  if (texts.some((n) => !visible(n))) throw new Error("Hidden or unsupported text");
  const sourceStories = all(group).filter((n) => n.name === "w:txbxContent");
  if (JSON.stringify(sourcePaintStories(group).map((n) => n.start)) !== JSON.stringify(sourceStories.map((n) => n.start))) throw new Error("Reordered story paint");
  let paragraphOffset = 0, textOffset = 0;
  const bookmarkIds = new Set<string>();
  const stories: Story[] = sourceStories.map((sourceStory, index) => {
    if (boundWordNamespace(sourceStory) !== wordNamespace) throw new Error("Invalid story namespace");
    const shape = sourceStory.parent?.parent;
    if (sourceStory.parent?.name !== "v:textbox" || shape?.name !== "v:shape" || !/#?_x0000_t202$/.test(shape.attrs.type ?? "") || all(shape).filter((n) => n.name === "w:txbxContent").length !== 1) throw new Error("Unsupported textbox shape");
    if (!sourceStory.children.length || sourceStory.children.some((n) => n.name !== "w:p")) throw new Error("Unsupported story structure");
    const sourceParagraphs = sourceStory.children;
    sourceParagraphs.forEach((p) => paragraphBookmarks(p, source, bookmarkIds));
    const paragraphs = image.contentNodes!.slice(paragraphOffset, paragraphOffset + sourceParagraphs.length);
    paragraphOffset += sourceParagraphs.length;
    if (paragraphs.length !== sourceParagraphs.length || paragraphs.some((p) => p.type !== "paragraph")) throw new Error("Typed paragraph count mismatch");
    const typed = paragraphs as ParagraphNode[];
    const values = sourceParagraphs.map((p) => paragraphText(p, source));
    if (values.some((text, i) => text !== typedText(typed[i]))) throw new Error("Source text mismatch");
    const marker = svgNodes.filter((n) => n.attrs["data-docx-vml-story"] === String(index));
    if (marker.length > 1) throw new Error("Duplicate story marker");
    const expected = values.filter((text) => text !== "");
    const count = marker.length ? all(marker[0]).filter((n) => n.name === "text").length : expected.length;
    const slots = texts.slice(textOffset, textOffset + count); textOffset += count;
    const actual = slots.map((n) => textValue(n, svg));
    if (JSON.stringify(actual.filter((text) => text !== "")) !== JSON.stringify(expected)) throw new Error("Rendered text mismatch");
    let slot: Story["slot"];
    if (marker.length) {
      const wrapper = marker[0];
      if (wrapper.name !== "g" || !wrapper.parent || Object.keys(wrapper.attrs).some((name) => name !== "data-docx-vml-story") || wrapper.children.length !== 1 || wrapper.children[0].name !== "svg" || slots.some((n) => n.start < wrapper.start || n.end > wrapper.end) || all(wrapper).some((n) => !["text", "tspan"].includes(n.name) && !plainContainer(n))) throw new Error("Invalid story marker");
      slot = { start: wrapper.start, end: wrapper.end, parent: wrapper.parent };
    } else if (slots.length) {
      const owned = (n: Element) => all(n).every((c) => ["text", "tspan"].includes(c.name) || plainContainer(c)) && all(n).filter((c) => c.name === "text").every((c) => slots.includes(c));
      let first = slots[0], last = slots.at(-1)!;
      while (first.parent && first.parent !== root && owned(first.parent)) first = first.parent;
      while (last.parent && last.parent !== root && owned(last.parent)) last = last.parent;
      if (!first.parent || first.parent !== last.parent) throw new Error("Split text paint");
      const siblings = first.parent.children.filter((n) => n.start >= first.start && n.end <= last.end);
      if (siblings.some((n) => !owned(n))) throw new Error("Interleaved artwork");
      slot = { start: first.start, end: last.end, parent: first.parent };
    }
    const f = sourceFrame(shape, group);
    if (slot) for (let ancestor: Element | undefined = slot.parent; ancestor; ancestor = ancestor.parent) if (!plainContainer(ancestor)) throw new Error("Unsupported inherited SVG paint");
    if (marker.length) {
      const wrapper = marker[0], viewport = wrapper.children[0], m = svgMatrix(wrapper.parent!, root);
      const actual = { x: m.x + m.sx * numeric(viewport.attrs.x), y: m.y + m.sy * numeric(viewport.attrs.y), width: m.sx * numeric(viewport.attrs.width), height: m.sy * numeric(viewport.attrs.height) };
      if (Object.keys(f).some((key) => Math.abs(actual[key as keyof VmlStoryFrame] - f[key as keyof VmlStoryFrame]) > 1e-6)) throw new Error("Stale story frame");
    }
    for (const textNode of slots) {
      if (!textValue(textNode, svg)) continue;
      if (!textNode.parent || textNode.attrs.dx || textNode.attrs.dy || textNode.attrs.style || textNode.attrs.class) throw new Error("Unsupported text position");
      const m = multiply(svgMatrix(textNode.parent, root), transform(textNode.attrs.transform));
      const x = numeric(textNode.attrs.x, 0), y = numeric(textNode.attrs.y, 0);
      const globalX = m.x + m.sx * x, globalY = m.y + m.sy * y;
      if (!marker.length && (globalX < f.x - 1e-6 || globalX > f.x + f.width + 1e-6 || globalY < f.y - 1e-6 || globalY > f.y + f.height + 1e-6)) throw new Error("Text outside source frame");
    }
    const width = displayWidth, height = displayHeight;
    if (width <= 0 || height <= 0) throw new Error("Invalid display size");
    return { index, editable: Boolean(slot), sourceXml: source.slice(shape.start, shape.end), source: sourceStory, shape, sourceParagraphs, paragraphs: typed, text: values.join("\n"), frame: f, framePx: { x: (paintBounds?.xPx ?? 0) + (f.x - viewport.x) * width / viewport.width, y: (paintBounds?.yPx ?? 0) + (f.y - viewport.y) * height / viewport.height, width: f.width * width / viewport.width, height: f.height * height / viewport.height }, slot };
  });
  if (!stories.length || paragraphOffset !== image.contentNodes.length || textOffset !== texts.length || svgNodes.some((n) => n.attrs["data-docx-vml-story"] !== undefined && !stories.some((s) => String(s.index) === n.attrs["data-docx-vml-story"]))) throw new Error("Unmapped content");
  if (image.textBoxText !== undefined && image.textBoxText !== aggregate(stories)) throw new Error("Stale aggregate text");
  for (const story of stories) if (story.slot) svgMatrix(story.slot.parent, root);
  return { source, svg, root, stories, paintBounds };
}
function replacements(text: string, edits: { start: number; end: number; value: string }[]): string {
  let boundary = text.length;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    if (edit.end > boundary || edit.start > edit.end) throw new Error("Overlapping replacement");
    text = text.slice(0, edit.start) + edit.value + text.slice(edit.end); boundary = edit.start;
  }
  return text;
}
function rectanglePaints(node: Element): boolean {
  const paint = (property: "fill" | "stroke", initial: string): string => {
    for (let current: Element | undefined = node; current; current = current.parent) {
      const value = styles(current.attrs.style)[property] ?? current.attrs[property];
      if (value === undefined || value === "inherit" || value === "unset") continue;
      return value === "initial" ? initial : value;
    }
    return initial;
  };
  return paint("fill", "black") !== "none" || paint("stroke", "none") !== "none";
}
export function mapVmlCompositeStories(image: ImageRunNode): VmlCompositeStories | undefined {
  try {
    const mapping = map(image);
    const slots = mapping.stories.flatMap((story) => story.slot ? [story.slot] : []);
    const firstPaint = Math.min(...slots.map((slot) => slot.start));
    const graphicElements = new Set("image rect path line polygon polyline circle ellipse use foreignObject".split(" "));
    const overlaySafe = slots.length > 0 && !all(mapping.root).some((node) => node.start > firstPaint && graphicElements.has(node.name) && visible(node) && (node.name !== "rect" || rectanglePaints(node)) && !slots.some((slot) => node.start >= slot.start && node.end <= slot.end));
    return { stories: mapping.stories.map(({ index, editable, text, sourceXml, paragraphs, frame, framePx }) => ({ index, editable, text, sourceXml, paragraphs, frame, framePx })), artworkSrc: uri(replacements(mapping.svg, slots.map((slot) => ({ ...slot, value: "" })))), overlaySafe, paintBounds: mapping.paintBounds };
  } catch { return undefined; }
}
function paragraphXml(xml: string, template: Element, text: string, before: string, after: string, existing: boolean): string {
  const props = template.children.find((n) => n.name === "w:pPr");
  const runs = template.children.filter((n) => n.name === "w:r");
  const run = runs.find((n) => n.children.some((c) => c.name === "w:t" && plain(c, xml).length > 0)) ?? runs[0];
  const runProps = run?.children.find((n) => n.name === "w:rPr");
  const raw = (n: Element | undefined) => n ? xml.slice(n.start, n.end) : "";
  const opening = existing && template.closeStart !== template.openEnd ? xml.slice(template.start, template.openEnd) : "<w:p>";
  return `${opening}${raw(props)}${before}<w:r>${raw(runProps)}<w:t xml:space="preserve">${escape(text)}</w:t></w:r>${after}</w:p>`;
}
export function editVmlCompositeStory(image: ImageRunNode, text: string, renderStory: VmlStoryRenderer, storyIndex?: number): ImageRunNode | undefined {
  try {
    const mapping = map(image);
    if (storyIndex !== undefined && (!Number.isInteger(storyIndex) || !mapping.stories[storyIndex])) return undefined;
    const normalized = text.replace(/\r\n?/g, "\n");
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(normalized)) return undefined;
    const svgEdits: { start: number; end: number; value: string }[] = [], sourceEdits: typeof svgEdits = [];
    const stories = mapping.stories.map((story) => {
      if (storyIndex !== undefined && story.index !== storyIndex) return story;
      if (!story.slot) throw new Error("No proven paint slot");
      const next = storyIndex !== undefined || story.index === 0 ? normalized : "";
      const lines = next.split("\n");
      const paragraphs: ParagraphNode[] = lines.map((line, i) => {
        const old = story.paragraphs[i] ?? story.paragraphs[0];
        const run = old.children.find((n) => n.type === "text" && n.text.length > 0) ?? old.children.find((n) => n.type === "text");
        return { ...old, blockId: i < story.paragraphs.length ? old.blockId : undefined, sourceXml: undefined, sourceTextPatch: undefined, children: [{ type: "text", text: line, style: run?.type === "text" ? run.style : undefined }] };
      });
      const markers = lines.map(() => ({ before: "", after: "" }));
      story.sourceParagraphs.forEach((p, i) => {
        for (const marker of paragraphBookmarks(p, mapping.source)) markers[Math.min(i, lines.length - 1)][i >= lines.length ? "after" : marker.side] += marker.xml;
      });
      const xml = lines.map((line, i) => paragraphXml(mapping.source, story.sourceParagraphs[i] ?? story.sourceParagraphs[0], line, markers[i].before, markers[i].after, i < story.sourceParagraphs.length)).join("");
      sourceEdits.push({ start: story.source.openEnd, end: story.source.closeStart, value: xml });
      const storySource = replacements(mapping.source.slice(story.shape.start, story.shape.end), [{ start: story.source.openEnd - story.shape.start, end: story.source.closeStart - story.shape.start, value: xml }]);
      const generated = svgData(renderStory({ ...image, sourceXml: storySource, contentNodes: paragraphs, textBoxText: next, widthPx: story.framePx.width, heightPx: story.framePx.height, paintBounds: undefined, src: undefined, data: undefined, partName: undefined }));
      const rendered = scan(generated), generatedNodes = all(rendered);
      if (rendered.name !== "svg" || generatedNodes.some((n) => !["svg", "g", "text", "tspan"].includes(n.name) || !visible(n))) throw new Error("Unsupported generated paint");
      const renderedTexts = generatedNodes.filter((n) => n.name === "text").map((n) => textValue(n, generated));
      if (JSON.stringify(renderedTexts.filter((s) => s !== "")) !== JSON.stringify(lines.filter((s) => s !== ""))) throw new Error("Renderer omitted text");
      const box = viewBox(rendered), matrix = svgMatrix(story.slot.parent, mapping.root), f = story.frame;
      const x = (f.x - matrix.x) / matrix.sx, y = (f.y - matrix.y) / matrix.sy, width = f.width / matrix.sx, height = f.height / matrix.sy;
      const inner = generated.slice(rendered.openEnd, rendered.closeStart);
      const value = `<g data-docx-vml-story="${story.index}"><svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="${box.x} ${box.y} ${box.width} ${box.height}" preserveAspectRatio="none" overflow="visible" xml:space="preserve">${inner}</svg></g>`;
      svgEdits.push({ ...story.slot, value });
      return { ...story, text: next, paragraphs };
    });
    const result: ImageRunNode = { ...image, src: uri(replacements(mapping.svg, svgEdits)), data: undefined, partName: undefined, contentType: "image/svg+xml", sourceXml: replacements(mapping.source, sourceEdits), contentNodes: stories.flatMap((s) => [...s.paragraphs]), textBoxText: aggregate(stories) };
    map(result);
    return result;
  } catch { return undefined; }
}
