import type {
  DocModel,
  FormFieldRunNode,
  ImageRunNode,
  ParagraphNode,
  ParagraphBorderSet,
  ParagraphBorderStyle,
  TableBorderSet,
  TableBorderStyle,
  TableCellContentNode,
  TableNode,
  TextStyle
} from "@extend-ai/react-docx-doc-model";
import type { OoxmlPackage } from "@extend-ai/react-docx-ooxml-core";
import { createMinimalDocxPackage, packageToArrayBuffer, withPart } from "@extend-ai/react-docx-ooxml-core";

interface Relationship {
  id: string;
  type: string;
  target: string;
  targetMode?: string;
}

interface ImageSerializationState {
  nextImageIndex: number;
  nextRelationshipIndex: number;
  relationships: Relationship[];
  relationshipByTarget: Map<string, Relationship>;
}

const REL_TYPE_IMAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const REL_TYPE_HYPERLINK =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const RELS_XMLNS = "http://schemas.openxmlformats.org/package/2006/relationships";
const WORD_MAIN_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const DRAWING_MAIN_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const DRAWING_WORD_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const DRAWING_PICTURE_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const WORD_2010_NS = "http://schemas.microsoft.com/office/word/2010/wordml";
const MARKUP_COMPATIBILITY_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006";

const DEFAULT_SECTION_PROPERTIES_XML =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  svg: "image/svg+xml"
};

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function shouldPreserveWhitespace(text: string): boolean {
  return /^\s/.test(text) || /\s$/.test(text) || /\s{2,}/.test(text);
}

function renderTextTokens(text: string): string {
  const tokens: string[] = [];
  let buffer = "";

  const flushBuffer = (): void => {
    if (buffer.length === 0) {
      return;
    }
    const preserve = shouldPreserveWhitespace(buffer) ? ' xml:space="preserve"' : "";
    tokens.push(`<w:t${preserve}>${escapeXml(buffer)}</w:t>`);
    buffer = "";
  };

  for (const character of text) {
    if (character === "\n") {
      flushBuffer();
      tokens.push("<w:br/>");
      continue;
    }
    if (character === "\t") {
      flushBuffer();
      tokens.push("<w:tab/>");
      continue;
    }
    buffer += character;
  }

  flushBuffer();
  if (tokens.length === 0) {
    tokens.push("<w:t/>");
  }

  return tokens.join("");
}

const HIGHLIGHT_TO_WORD: Record<string, string> = {
  "#ffff00": "yellow",
  "#ff0000": "red",
  "#00ff00": "green",
  "#00ffff": "cyan",
  "#0000ff": "blue",
  "#ff00ff": "magenta",
  "#000000": "black",
  "#ffffff": "white",
  "#808080": "darkGray",
  "#d3d3d3": "lightGray",
  yellow: "yellow",
  red: "red",
  green: "green",
  cyan: "cyan",
  blue: "blue",
  magenta: "magenta",
  black: "black",
  white: "white",
  darkgray: "darkGray",
  lightgray: "lightGray"
};

const WORD_HIGHLIGHT_HEX_VALUES: Array<{ hex: string; value: string }> = [
  { hex: "#ffff00", value: "yellow" },
  { hex: "#ff0000", value: "red" },
  { hex: "#00ff00", value: "green" },
  { hex: "#00ffff", value: "cyan" },
  { hex: "#0000ff", value: "blue" },
  { hex: "#ff00ff", value: "magenta" },
  { hex: "#000000", value: "black" },
  { hex: "#ffffff", value: "white" },
  { hex: "#808080", value: "darkGray" },
  { hex: "#d3d3d3", value: "lightGray" }
];

function normalizeHexColor(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  const threeDigit = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (threeDigit?.[1]) {
    const [r, g, b] = threeDigit[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  const sixDigit = /^#([0-9a-f]{6})$/i.exec(trimmed);
  if (sixDigit?.[1]) {
    return `#${sixDigit[1].toLowerCase()}`;
  }

  return undefined;
}

function parseHslColor(value: string): [number, number, number] | undefined {
  const match = value
    .trim()
    .match(
      /^hsla?\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)%\s*,\s*(-?\d+(?:\.\d+)?)%(?:\s*\/\s*\d+(?:\.\d+)?%?)?\s*\)$/i
    );
  if (!match) {
    return undefined;
  }

  const h = Number(match[1]);
  const s = Number(match[2]);
  const l = Number(match[3]);
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) {
    return undefined;
  }

  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const saturation = Math.min(100, Math.max(0, s)) / 100;
  const lightness = Math.min(100, Math.max(0, l)) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const huePrime = hue / 60;
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;

  if (huePrime >= 0 && huePrime < 1) {
    r = chroma;
    g = x;
  } else if (huePrime < 2) {
    r = x;
    g = chroma;
  } else if (huePrime < 3) {
    g = chroma;
    b = x;
  } else if (huePrime < 4) {
    g = x;
    b = chroma;
  } else if (huePrime < 5) {
    r = x;
    b = chroma;
  } else {
    r = chroma;
    b = x;
  }

  const m = lightness - chroma / 2;
  const toHex = (channel: number): string =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function colorDistance(a: string, b: string): number {
  const parse = (hex: string): [number, number, number] => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16)
  ];
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const dr = ar - br;
  const dg = ag - bg;
  const db = ab - bb;
  return dr * dr + dg * dg + db * db;
}

function closestWordHighlight(hex: string): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of WORD_HIGHLIGHT_HEX_VALUES) {
    const distance = colorDistance(hex, candidate.hex);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate.value;
    }
  }

  return best;
}

function normalizeWordHighlight(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const mapped = HIGHLIGHT_TO_WORD[normalized];
  if (mapped) {
    return mapped;
  }

  const hex = normalizeHexColor(normalized);
  if (hex) {
    return HIGHLIGHT_TO_WORD[hex] ?? closestWordHighlight(hex);
  }

  const hsl = parseHslColor(normalized);
  if (hsl) {
    const hslHex = hslToHex(hsl[0], hsl[1], hsl[2]);
    return HIGHLIGHT_TO_WORD[hslHex] ?? closestWordHighlight(hslHex);
  }

  return undefined;
}

function runPropertiesXml(style?: TextStyle): string {
  if (!style) {
    return "";
  }

  const fragments: string[] = [];
  if (style.bold) {
    fragments.push("<w:b/>");
  }
  if (style.italic) {
    fragments.push("<w:i/>");
  }
  if (style.underline) {
    fragments.push('<w:u w:val="single"/>');
  }
  if (style.strike) {
    fragments.push("<w:strike/>");
  }
  if (style.color) {
    fragments.push(`<w:color w:val="${style.color.replace("#", "")}"/>`);
  }

  const highlight = normalizeWordHighlight(style.highlight);
  if (highlight) {
    fragments.push(`<w:highlight w:val="${highlight}"/>`);
  }

  if (style.backgroundColor) {
    fragments.push(`<w:shd w:val="clear" w:color="auto" w:fill="${style.backgroundColor.replace("#", "").toUpperCase()}"/>`);
  }

  if (style.fontSizePt) {
    fragments.push(`<w:sz w:val="${Math.round(style.fontSizePt * 2)}"/>`);
  }

  if (style.fontFamily) {
    const escapedFont = escapeXml(style.fontFamily);
    fragments.push(`<w:rFonts w:ascii="${escapedFont}" w:hAnsi="${escapedFont}" w:cs="${escapedFont}"/>`);
  }

  if (style.verticalAlign === "superscript" || style.verticalAlign === "subscript") {
    fragments.push(`<w:vertAlign w:val="${style.verticalAlign}"/>`);
  }

  if (style.runBorder?.type) {
    const attrs = [`w:val="${escapeXml(style.runBorder.type.trim().toLowerCase())}"`];
    if (Number.isFinite(style.runBorder.sizeEighthPt) && (style.runBorder.sizeEighthPt as number) >= 0) {
      attrs.push(`w:sz="${Math.round(style.runBorder.sizeEighthPt as number)}"`);
    }
    if (Number.isFinite(style.runBorder.spacePt) && (style.runBorder.spacePt as number) >= 0) {
      attrs.push(`w:space="${Math.round(style.runBorder.spacePt as number)}"`);
    }
    attrs.push(`w:color="${style.runBorder.color ? style.runBorder.color.replace("#", "").toUpperCase() : "auto"}"`);
    if (style.runBorder.frame !== undefined) {
      attrs.push(`w:frame="${style.runBorder.frame ? "1" : "0"}"`);
    }
    if (style.runBorder.shadow !== undefined) {
      attrs.push(`w:shadow="${style.runBorder.shadow ? "1" : "0"}"`);
    }
    fragments.push(`<w:bdr ${attrs.join(" ")}/>`);
  }

  return fragments.length > 0 ? `<w:rPr>${fragments.join("")}</w:rPr>` : "";
}

function paragraphBorderEdgeXml(
  side: "top" | "right" | "bottom" | "left" | "between" | "bar",
  border: ParagraphBorderStyle | undefined
): string {
  if (!border?.type) {
    return "";
  }

  const type = border.type.trim().toLowerCase();
  if (!type) {
    return "";
  }

  const attrs = [`w:val="${type}"`];
  if (Number.isFinite(border.sizeEighthPt) && (border.sizeEighthPt as number) >= 0) {
    attrs.push(`w:sz="${Math.round(border.sizeEighthPt as number)}"`);
  }
  if (Number.isFinite(border.spacePt) && (border.spacePt as number) >= 0) {
    attrs.push(`w:space="${Math.round(border.spacePt as number)}"`);
  }
  attrs.push(`w:color="${border.color ? border.color.replace("#", "").toUpperCase() : "auto"}"`);
  if (border.frame !== undefined) {
    attrs.push(`w:frame="${border.frame ? "1" : "0"}"`);
  }
  if (border.shadow !== undefined) {
    attrs.push(`w:shadow="${border.shadow ? "1" : "0"}"`);
  }

  return `<w:${side} ${attrs.join(" ")}/>`;
}

function paragraphBordersXml(borders: ParagraphBorderSet | undefined): string {
  if (!borders) {
    return "";
  }

  const fragments = [
    paragraphBorderEdgeXml("top", borders.top),
    paragraphBorderEdgeXml("left", borders.left),
    paragraphBorderEdgeXml("bottom", borders.bottom),
    paragraphBorderEdgeXml("right", borders.right),
    paragraphBorderEdgeXml("between", borders.between),
    paragraphBorderEdgeXml("bar", borders.bar)
  ].filter((fragment) => fragment.length > 0);

  if (fragments.length === 0) {
    return "";
  }

  return `<w:pBdr>${fragments.join("")}</w:pBdr>`;
}

function paragraphPropertiesXml(style: ParagraphNode["style"]): string {
  if (!style) {
    return "";
  }

  const fragments: string[] = [];
  const paragraphStyleId =
    style.styleId ?? (style.headingLevel ? `Heading${style.headingLevel}` : undefined);
  if (paragraphStyleId) {
    fragments.push(`<w:pStyle w:val="${escapeXml(paragraphStyleId)}"/>`);
  }
  if (style.align) {
    fragments.push(`<w:jc w:val="${style.align}"/>`);
  }
  if (style.numbering && Number.isFinite(style.numbering.numId) && style.numbering.numId > 0) {
    const ilvl = Math.max(0, Math.round(style.numbering.ilvl ?? 0));
    const numId = Math.round(style.numbering.numId);
    fragments.push(`<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`);
  }

  const spacingFragments: string[] = [];
  const spacingBefore = twipsToXmlNonNegative(style.spacing?.beforeTwips);
  const spacingAfter = twipsToXmlNonNegative(style.spacing?.afterTwips);
  const spacingLine = twipsToXmlNonNegative(style.spacing?.lineTwips);
  if (spacingBefore !== undefined) {
    spacingFragments.push(`w:before="${spacingBefore}"`);
  }
  if (spacingAfter !== undefined) {
    spacingFragments.push(`w:after="${spacingAfter}"`);
  }
  if (spacingLine !== undefined) {
    spacingFragments.push(`w:line="${spacingLine}"`);
  }
  if (style.spacing?.lineRule) {
    const lineRule = style.spacing.lineRule === "atLeast" ? "atLeast" : style.spacing.lineRule;
    spacingFragments.push(`w:lineRule="${lineRule}"`);
  }
  if (spacingFragments.length > 0) {
    fragments.push(`<w:spacing ${spacingFragments.join(" ")}/>`);
  }

  const indentFragments: string[] = [];
  const indentLeft = twipsToXmlNonNegative(style.indent?.leftTwips);
  const indentRight = twipsToXmlNonNegative(style.indent?.rightTwips);
  const indentFirstLine = twipsToXmlNonNegative(style.indent?.firstLineTwips);
  const indentHanging = twipsToXmlNonNegative(style.indent?.hangingTwips);
  if (indentLeft !== undefined) {
    indentFragments.push(`w:left="${indentLeft}"`);
  }
  if (indentRight !== undefined) {
    indentFragments.push(`w:right="${indentRight}"`);
  }
  if (indentFirstLine !== undefined) {
    indentFragments.push(`w:firstLine="${indentFirstLine}"`);
  }
  if (indentHanging !== undefined) {
    indentFragments.push(`w:hanging="${indentHanging}"`);
  }
  if (indentFragments.length > 0) {
    fragments.push(`<w:ind ${indentFragments.join(" ")}/>`);
  }

  if (style.dropCap) {
    const frameFragments = [`w:dropCap="${escapeXml(style.dropCap.type)}"`];
    if (Number.isFinite(style.dropCap.lines) && (style.dropCap.lines as number) > 0) {
      frameFragments.push(`w:lines="${Math.round(style.dropCap.lines as number)}"`);
    }
    if (style.dropCap.wrap) {
      frameFragments.push(`w:wrap="${escapeXml(style.dropCap.wrap)}"`);
    }
    if (style.dropCap.horizontalAnchor) {
      frameFragments.push(`w:hAnchor="${escapeXml(style.dropCap.horizontalAnchor)}"`);
    }
    if (style.dropCap.verticalAnchor) {
      frameFragments.push(`w:vAnchor="${escapeXml(style.dropCap.verticalAnchor)}"`);
    }
    const x = twipsToXmlNonNegative(style.dropCap.xTwips);
    const y = twipsToXmlNonNegative(style.dropCap.yTwips);
    const hSpace = twipsToXmlNonNegative(style.dropCap.horizontalSpaceTwips);
    const vSpace = twipsToXmlNonNegative(style.dropCap.verticalSpaceTwips);
    if (x !== undefined) {
      frameFragments.push(`w:x="${x}"`);
    }
    if (y !== undefined) {
      frameFragments.push(`w:y="${y}"`);
    }
    if (hSpace !== undefined) {
      frameFragments.push(`w:hSpace="${hSpace}"`);
    }
    if (vSpace !== undefined) {
      frameFragments.push(`w:vSpace="${vSpace}"`);
    }
    fragments.push(`<w:framePr ${frameFragments.join(" ")}/>`);
  }

  const paragraphBorderXml = paragraphBordersXml(style.borders);
  if (paragraphBorderXml) {
    fragments.push(paragraphBorderXml);
  }

  return fragments.length > 0 ? `<w:pPr>${fragments.join("")}</w:pPr>` : "";
}

function twipsToXml(value?: number): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }
  const rounded = Math.round(value as number);
  return rounded > 0 ? rounded : undefined;
}

function twipsToXmlNonNegative(value?: number): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }
  const rounded = Math.round(value as number);
  return rounded >= 0 ? rounded : undefined;
}

function tableBoxSpacingXml(
  spacing:
    | {
        topTwips?: number;
        rightTwips?: number;
        bottomTwips?: number;
        leftTwips?: number;
      }
    | undefined,
  wrapperTagName: "w:tblCellMar" | "w:tcMar"
): string {
  if (!spacing) {
    return "";
  }

  const top = twipsToXml(spacing.topTwips);
  const right = twipsToXml(spacing.rightTwips);
  const bottom = twipsToXml(spacing.bottomTwips);
  const left = twipsToXml(spacing.leftTwips);

  const edges: string[] = [];
  if (top !== undefined) {
    edges.push(`<w:top w:w="${top}" w:type="dxa"/>`);
  }
  if (right !== undefined) {
    edges.push(`<w:right w:w="${right}" w:type="dxa"/>`);
  }
  if (bottom !== undefined) {
    edges.push(`<w:bottom w:w="${bottom}" w:type="dxa"/>`);
  }
  if (left !== undefined) {
    edges.push(`<w:left w:w="${left}" w:type="dxa"/>`);
  }

  if (edges.length === 0) {
    return "";
  }

  return `<${wrapperTagName}>${edges.join("")}</${wrapperTagName}>`;
}

function tableBorderEdgeXml(side: string, border: TableBorderStyle | undefined): string {
  if (!border?.type) {
    return "";
  }

  const type = border.type.trim().toLowerCase();
  if (!type) {
    return "";
  }

  const size =
    Number.isFinite(border.sizeEighthPt) && (border.sizeEighthPt as number) >= 0
      ? Math.round(border.sizeEighthPt as number)
      : type === "none" || type === "nil"
        ? 0
        : 4;
  const color = border.color ? border.color.replace("#", "").toUpperCase() : "auto";

  return `<w:${side} w:val="${type}" w:sz="${size}" w:space="0" w:color="${color}"/>`;
}

function tableBordersXml(
  borders: TableBorderSet | undefined,
  wrapperTagName: "w:tblBorders" | "w:tcBorders"
): string {
  if (!borders) {
    return "";
  }

  const edges = [
    tableBorderEdgeXml("top", borders.top),
    tableBorderEdgeXml("left", borders.left),
    tableBorderEdgeXml("bottom", borders.bottom),
    tableBorderEdgeXml("right", borders.right),
    tableBorderEdgeXml("insideH", borders.insideH),
    tableBorderEdgeXml("insideV", borders.insideV),
    tableBorderEdgeXml("tl2br", borders.tl2br),
    tableBorderEdgeXml("tr2bl", borders.tr2bl)
  ].filter((edge) => edge.length > 0);

  if (edges.length === 0) {
    return "";
  }

  return `<${wrapperTagName}>${edges.join("")}</${wrapperTagName}>`;
}

function parseRelationshipsXml(xml: string): Relationship[] {
  const relationships: Relationship[] = [];
  for (const match of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0];
    const id = tag.match(/\bId="([^"]+)"/i)?.[1];
    const type = tag.match(/\bType="([^"]+)"/i)?.[1];
    const target = tag.match(/\bTarget="([^"]+)"/i)?.[1];
    const targetMode = tag.match(/\bTargetMode="([^"]+)"/i)?.[1];

    if (!id || !type || !target) {
      continue;
    }

    relationships.push({ id, type, target, targetMode });
  }
  return relationships;
}

function normalizeWordPartName(partName: string): string {
  return partName.startsWith("/") ? partName.slice(1) : partName;
}

function relationshipPartNameForWordPart(partName: string): string {
  const normalizedPartName = normalizeWordPartName(partName);
  const slashIndex = normalizedPartName.lastIndexOf("/");
  if (slashIndex < 0) {
    return `_rels/${normalizedPartName}.rels`;
  }
  const directory = normalizedPartName.slice(0, slashIndex);
  const basename = normalizedPartName.slice(slashIndex + 1);
  return `${directory}/_rels/${basename}.rels`;
}

function renderRelationshipsXml(relationships: Relationship[]): string {
  const serialized = relationships
    .map((relationship) => {
      const targetMode = relationship.targetMode ? ` TargetMode="${escapeXml(relationship.targetMode)}"` : "";
      return `<Relationship Id="${escapeXml(relationship.id)}" Type="${escapeXml(relationship.type)}" Target="${escapeXml(relationship.target)}"${targetMode}/>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${RELS_XMLNS}">${serialized}</Relationships>`;
}

function nextRelationshipIndex(relationships: Relationship[]): number {
  return (
    relationships.reduce((largest, relationship) => {
      const parsed = Number(relationship.id.replace(/^rId/i, ""));
      return Number.isFinite(parsed) ? Math.max(largest, parsed + 1) : largest;
    }, 1) || 1
  );
}

function decodeDataUri(dataUri: string): { mimeType: string; data: Uint8Array } | undefined {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  const mimeType = match[1];
  const base64 = match[2];

  if (typeof Buffer !== "undefined") {
    return {
      mimeType,
      data: new Uint8Array(Buffer.from(base64, "base64"))
    };
  }

  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return {
      mimeType,
      data: bytes
    };
  }

  return undefined;
}

function extensionFromMimeType(mimeType?: string): string | undefined {
  if (!mimeType) {
    return undefined;
  }

  const normalized = mimeType.toLowerCase();
  const entry = Object.entries(MIME_BY_EXTENSION).find(([, candidate]) => candidate === normalized);
  return entry?.[0];
}

function extensionFromPartName(partName?: string): string | undefined {
  if (!partName) {
    return undefined;
  }

  const dotIndex = partName.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === partName.length - 1) {
    return undefined;
  }

  return partName.slice(dotIndex + 1).toLowerCase();
}

function targetFromPartName(partName: string): string {
  if (partName.startsWith("word/")) {
    return partName.slice("word/".length);
  }

  return partName;
}

function emuFromPx(px: number | undefined, fallbackPx: number): number {
  return Math.round((px ?? fallbackPx) * 9525);
}

function isExternalTarget(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target);
}

function ensureContentTypeDefault(
  pkg: OoxmlPackage,
  extension: string,
  contentType: string
): void {
  const part = pkg.parts.get("[Content_Types].xml");
  if (!part) {
    return;
  }

  if (new RegExp(`<Default\\b[^>]*Extension="${extension}"`, "i").test(part.content)) {
    return;
  }

  const defaultEntry = `<Default Extension="${extension}" ContentType="${contentType}"/>`;
  part.content = part.content.replace(/<\/Types>\s*$/i, `${defaultEntry}</Types>`);
  pkg.parts.set(part.name, part);
}

function ensureImagePartAndRelationship(
  image: ImageRunNode,
  pkg: OoxmlPackage,
  state: ImageSerializationState
): { relationshipId: string; widthPx: number; heightPx: number; alt: string } | undefined {
  let partName = image.partName;
  let imageData = image.data;
  let contentType = image.contentType;

  if ((!partName || !imageData) && image.src) {
    const decoded = decodeDataUri(image.src);
    if (decoded) {
      imageData = decoded.data;
      contentType = contentType ?? decoded.mimeType;
      if (!partName) {
        const extension = extensionFromMimeType(contentType) ?? "png";
        partName = `word/media/image${state.nextImageIndex}.${extension}`;
        state.nextImageIndex += 1;
      }
    }
  }

  if (!partName) {
    return undefined;
  }

  if (imageData && !pkg.binaryAssets.has(partName)) {
    pkg.binaryAssets.set(partName, new Uint8Array(imageData));
  }

  const extension = extensionFromPartName(partName) ?? extensionFromMimeType(contentType) ?? "png";
  const resolvedContentType = contentType ?? MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
  ensureContentTypeDefault(pkg, extension, resolvedContentType);

  const target = targetFromPartName(partName);
  let relationship = state.relationshipByTarget.get(target);

  if (!relationship) {
    relationship = {
      id: `rId${state.nextRelationshipIndex}`,
      type: REL_TYPE_IMAGE,
      target
    };
    state.nextRelationshipIndex += 1;
    state.relationships.push(relationship);
    state.relationshipByTarget.set(target, relationship);
  }

  return {
    relationshipId: relationship.id,
    widthPx: image.widthPx ?? 240,
    heightPx: image.heightPx ?? 160,
    alt: image.alt ?? "DOCX image"
  };
}

function ensureHyperlinkRelationship(
  target: string,
  state: ImageSerializationState
): string {
  const targetMode = isExternalTarget(target) ? "External" : undefined;
  let relationship = state.relationships.find(
    (candidate) =>
      candidate.type === REL_TYPE_HYPERLINK &&
      candidate.target === target &&
      candidate.targetMode === targetMode
  );

  if (!relationship) {
    relationship = {
      id: `rId${state.nextRelationshipIndex}`,
      type: REL_TYPE_HYPERLINK,
      target,
      targetMode
    };
    state.nextRelationshipIndex += 1;
    state.relationships.push(relationship);
  }

  return relationship.id;
}

function drawingRunXml(
  image: ImageRunNode,
  pkg: OoxmlPackage,
  state: ImageSerializationState,
  runId: number
): string {
  const resolved = ensureImagePartAndRelationship(image, pkg, state);
  if (!resolved) {
    return "";
  }

  const cx = emuFromPx(resolved.widthPx, 240);
  const cy = emuFromPx(resolved.heightPx, 160);
  const floating = image.floating;

  if (floating) {
    const distL = emuFromPx(floating.distLPx, 0);
    const distR = emuFromPx(floating.distRPx, 0);
    const distT = emuFromPx(floating.distTPx, 0);
    const distB = emuFromPx(floating.distBPx, 0);
    const relativeHeight =
      Number.isFinite(floating.zIndex) && (floating.zIndex as number) >= 0
        ? Math.round(floating.zIndex as number)
        : 251658240;
    const horizontalRelativeTo = floating.horizontalRelativeTo?.trim() || "margin";
    const verticalRelativeTo = floating.verticalRelativeTo?.trim() || "paragraph";
    const positionHXml =
      floating.horizontalAlign
        ? `<wp:positionH relativeFrom="${escapeXml(horizontalRelativeTo)}"><wp:align>${escapeXml(floating.horizontalAlign)}</wp:align></wp:positionH>`
        : `<wp:positionH relativeFrom="${escapeXml(horizontalRelativeTo)}"><wp:posOffset>${emuFromPx(floating.xPx, 0)}</wp:posOffset></wp:positionH>`;
    const positionVXml =
      floating.verticalAlign
        ? `<wp:positionV relativeFrom="${escapeXml(verticalRelativeTo)}"><wp:align>${escapeXml(floating.verticalAlign)}</wp:align></wp:positionV>`
        : `<wp:positionV relativeFrom="${escapeXml(verticalRelativeTo)}"><wp:posOffset>${emuFromPx(floating.yPx, 0)}</wp:posOffset></wp:positionV>`;
    const wrapXml = (() => {
      if (floating.wrapType === "none") {
        return "<wp:wrapNone/>";
      }

      if (floating.wrapType === "topAndBottom") {
        return "<wp:wrapTopAndBottom/>";
      }

      if (floating.wrapType === "tight") {
        const wrapText = floating.wrapText ? ` wrapText="${escapeXml(floating.wrapText)}"` : "";
        return `<wp:wrapTight${wrapText}/>`;
      }

      if (floating.wrapType === "through") {
        const wrapText = floating.wrapText ? ` wrapText="${escapeXml(floating.wrapText)}"` : "";
        return `<wp:wrapThrough${wrapText}/>`;
      }

      if (floating.wrapType === "square") {
        const wrapText = floating.wrapText ? ` wrapText="${escapeXml(floating.wrapText)}"` : "";
        return `<wp:wrapSquare${wrapText}/>`;
      }

      if (floating.wrapType === undefined) {
        return "<wp:wrapNone/>";
      }

      const wrapText = floating.wrapText ? ` wrapText="${escapeXml(floating.wrapText)}"` : "";
      return `<wp:wrapSquare${wrapText}/>`;
    })();

    return `<w:r><w:drawing><wp:anchor distT="${distT}" distB="${distB}" distL="${distL}" distR="${distR}" simplePos="0" relativeHeight="${relativeHeight}" behindDoc="${
      floating.behindDocument ? 1 : 0
    }" locked="0" layoutInCell="1" allowOverlap="1" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:simplePos x="0" y="0"/>${positionHXml}${positionVXml}<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${wrapXml}<wp:docPr id="${runId}" name="Picture ${runId}" descr="${escapeXml(resolved.alt)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="Picture ${runId}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${resolved.relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
  }

  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${runId}" name="Picture ${runId}" descr="${escapeXml(resolved.alt)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="Picture ${runId}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${resolved.relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function codePointHexFromSymbol(symbol: string | undefined, fallbackHex: string): string {
  if (!symbol) {
    return fallbackHex;
  }

  const first = [...symbol][0];
  if (!first) {
    return fallbackHex;
  }

  const codePoint = first.codePointAt(0);
  if (!Number.isFinite(codePoint) || (codePoint as number) <= 0) {
    return fallbackHex;
  }

  return Math.round(codePoint as number).toString(16).toUpperCase().padStart(4, "0");
}

function wrapWithHyperlinkXml(xml: string, link: string | undefined, state: ImageSerializationState): string {
  const normalizedLink = link?.trim();
  if (!normalizedLink) {
    return xml;
  }

  if (normalizedLink.startsWith("#")) {
    return `<w:hyperlink w:anchor="${escapeXml(normalizedLink.slice(1))}">${xml}</w:hyperlink>`;
  }

  const relationshipId = ensureHyperlinkRelationship(normalizedLink, state);
  return `<w:hyperlink r:id="${relationshipId}">${xml}</w:hyperlink>`;
}

function resolveDropdownDisplayValue(field: FormFieldRunNode): string {
  const selected = field.value?.trim();
  if (!selected) {
    return field.options?.[0]?.displayText ?? "";
  }

  const matchingOption = field.options?.find(
    (option) =>
      option.displayText.trim() === selected ||
      (option.value?.trim().length ? option.value.trim() === selected : false)
  );
  if (matchingOption) {
    return matchingOption.displayText;
  }

  return selected;
}

type LegacyTextInputType =
  | "regular"
  | "number"
  | "date"
  | "currentDate"
  | "currentTime"
  | "calculated";

function normalizeLegacyTextInputType(rawValue: string | undefined): LegacyTextInputType | undefined {
  if (!rawValue) {
    return undefined;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized === "regular") {
    return "regular";
  }
  if (normalized === "number") {
    return "number";
  }
  if (normalized === "date") {
    return "date";
  }
  if (normalized === "currentdate" || normalized === "current_date" || normalized === "current-date") {
    return "currentDate";
  }
  if (normalized === "currenttime" || normalized === "current_time" || normalized === "current-time") {
    return "currentTime";
  }
  if (normalized === "calculated" || normalized === "calculation") {
    return "calculated";
  }

  return undefined;
}

function legacyOnOffTagXml(tagName: string, value: boolean | undefined): string {
  if (value === undefined) {
    return "";
  }
  return `<w:${tagName} w:val="${value ? "1" : "0"}"/>`;
}

function legacyFormFieldRunXml(field: FormFieldRunNode, state: ImageSerializationState): string {
  const ffDataFragments: string[] = [];
  const widget = field.widget;

  if (widget?.name?.trim()) {
    ffDataFragments.push(`<w:name w:val="${escapeXml(widget.name.trim())}"/>`);
  }
  ffDataFragments.push(legacyOnOffTagXml("enabled", widget?.enabled));
  ffDataFragments.push(legacyOnOffTagXml("calcOnExit", widget?.calcOnExit));

  let instruction = "FORMTEXT";
  let displayValue = field.value ?? "";

  if (field.fieldType === "checkbox") {
    instruction = "FORMCHECKBOX";
    const checkedSymbol = field.checkedSymbol ?? "☒";
    const uncheckedSymbol = field.uncheckedSymbol ?? "☐";
    displayValue = field.checked ? checkedSymbol : uncheckedSymbol;

    const checkboxFragments: string[] = [];
    const defaultChecked = widget?.checkbox?.defaultChecked;
    checkboxFragments.push(legacyOnOffTagXml("default", defaultChecked));
    checkboxFragments.push(legacyOnOffTagXml("checked", field.checked));
    if (widget?.checkbox?.sizeMode === "auto") {
      checkboxFragments.push("<w:sizeAuto/>");
    } else if (
      widget?.checkbox?.sizeMode === "exact" &&
      Number.isFinite(widget.checkbox.sizePt) &&
      (widget.checkbox.sizePt as number) > 0
    ) {
      checkboxFragments.push(`<w:size w:val="${Math.round((widget.checkbox.sizePt as number) * 2)}"/>`);
    }
    if (checkboxFragments.length > 0) {
      ffDataFragments.push(`<w:checkBox>${checkboxFragments.join("")}</w:checkBox>`);
    } else {
      ffDataFragments.push("<w:checkBox/>");
    }
  } else if (field.fieldType === "dropdown") {
    instruction = "FORMDROPDOWN";
    displayValue = resolveDropdownDisplayValue(field);
    const dropdownFragments: string[] = [];
    const options = field.options ?? [];
    for (const option of options) {
      const displayText = option.displayText.trim();
      if (!displayText) {
        continue;
      }
      dropdownFragments.push(`<w:listEntry w:val="${escapeXml(displayText)}"/>`);
    }
    const defaultValue = widget?.dropdown?.defaultValue?.trim();
    if (defaultValue) {
      dropdownFragments.push(`<w:default w:val="${escapeXml(defaultValue)}"/>`);
    }
    if (dropdownFragments.length > 0) {
      ffDataFragments.push(`<w:ddList>${dropdownFragments.join("")}</w:ddList>`);
    } else {
      ffDataFragments.push("<w:ddList/>");
    }
  } else {
    // Legacy date fields are represented as FORMTEXT with a typed widget setting.
    instruction = "FORMTEXT";
    const textWidget = widget?.text;
    const normalizedInputType = normalizeLegacyTextInputType(textWidget?.inputType);
    const currentValue = field.value;
    const hasCurrentValue = Boolean(currentValue && currentValue.trim().length > 0);
    const configuredDefaultText = textWidget?.defaultText;
    const hasConfiguredDefaultText = Boolean(
      configuredDefaultText && configuredDefaultText.trim().length > 0
    );
    const defaultText =
      normalizedInputType === "number" && !hasCurrentValue && !hasConfiguredDefaultText
        ? "0"
        : configuredDefaultText;
    displayValue =
      currentValue ??
      defaultText ??
      (normalizedInputType === "number" ? "0" : "");
    const textFragments: string[] = [];
    if (normalizedInputType) {
      textFragments.push(`<w:type w:val="${escapeXml(normalizedInputType)}"/>`);
    }
    if (defaultText !== undefined) {
      textFragments.push(`<w:default w:val="${escapeXml(defaultText)}"/>`);
    }
    if (Number.isFinite(textWidget?.maxLength) && (textWidget?.maxLength as number) >= 0) {
      textFragments.push(`<w:maxLength w:val="${Math.round(textWidget?.maxLength as number)}"/>`);
    }
    const normalizedTextFormat = textWidget?.textFormat?.trim();
    if (normalizedTextFormat) {
      textFragments.push(`<w:format w:val="${escapeXml(normalizedTextFormat)}"/>`);
    } else if (normalizedInputType === "number") {
      textFragments.push('<w:format w:val="0"/>');
    }
    if (textFragments.length > 0) {
      ffDataFragments.push(`<w:textInput>${textFragments.join("")}</w:textInput>`);
    } else {
      ffDataFragments.push("<w:textInput/>");
    }
  }

  const ffDataXml = `<w:ffData>${ffDataFragments.join("")}</w:ffData>`;
  const resultRunXml = `<w:r>${runPropertiesXml(field.style)}${renderTextTokens(displayValue)}</w:r>`;
  const legacyFieldXml = [
    `<w:r><w:fldChar w:fldCharType="begin">${ffDataXml}</w:fldChar></w:r>`,
    `<w:r><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r>`,
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>',
    resultRunXml,
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
  ].join("");

  return wrapWithHyperlinkXml(legacyFieldXml, field.link, state);
}

function formFieldRunXml(field: FormFieldRunNode, state: ImageSerializationState): string {
  if (field.sourceXml) {
    return wrapWithHyperlinkXml(field.sourceXml, field.link, state);
  }

  if (field.sourceKind === "legacy") {
    return legacyFormFieldRunXml(field, state);
  }

  const properties: string[] = [];
  if (Number.isFinite(field.id)) {
    properties.push(`<w:id w:val="${Math.round(field.id as number)}"/>`);
  }
  if (field.title?.trim()) {
    properties.push(`<w:alias w:val="${escapeXml(field.title.trim())}"/>`);
  }
  if (field.tag?.trim()) {
    properties.push(`<w:tag w:val="${escapeXml(field.tag.trim())}"/>`);
  }
  if (field.placeholder?.trim()) {
    properties.push(
      `<w:placeholder><w:docPart w:val="${escapeXml(field.placeholder.trim())}"/></w:placeholder>`
    );
  }

  let displayValue = field.value ?? "";
  switch (field.fieldType) {
    case "checkbox": {
      const checkedSymbol = field.checkedSymbol ?? "☒";
      const uncheckedSymbol = field.uncheckedSymbol ?? "☐";
      const checkedHex = codePointHexFromSymbol(field.checkedSymbol, "2612");
      const uncheckedHex = codePointHexFromSymbol(field.uncheckedSymbol, "2610");
      properties.push(
        `<w14:checkbox><w14:checked w14:val="${field.checked ? "1" : "0"}"/><w14:checkedState w14:val="${checkedHex}" w14:font="MS Gothic"/><w14:uncheckedState w14:val="${uncheckedHex}" w14:font="MS Gothic"/></w14:checkbox>`
      );
      displayValue = field.checked ? checkedSymbol : uncheckedSymbol;
      break;
    }
    case "dropdown": {
      const optionsXml = (field.options ?? [])
        .map((option) => {
          const displayText = option.displayText.trim();
          const value = option.value?.trim() ?? displayText;
          if (!displayText) {
            return "";
          }
          return `<w:listItem w:displayText="${escapeXml(displayText)}" w:value="${escapeXml(value)}"/>`;
        })
        .join("");
      const lastValue = field.value?.trim();
      properties.push(
        `<w:dropDownList>${optionsXml}${lastValue ? `<w:lastValue w:val="${escapeXml(lastValue)}"/>` : ""}</w:dropDownList>`
      );
      displayValue = resolveDropdownDisplayValue(field);
      break;
    }
    case "date": {
      const normalizedDate = field.value?.trim();
      properties.push(`<w:date>${normalizedDate ? `<w:fullDate w:val="${escapeXml(normalizedDate)}"/>` : ""}</w:date>`);
      displayValue = normalizedDate ?? "";
      break;
    }
    default:
      properties.push("<w:text/>");
      displayValue = field.value ?? "";
      break;
  }

  const propertiesXml = properties.length > 0 ? `<w:sdtPr>${properties.join("")}</w:sdtPr>` : "<w:sdtPr/>";
  const contentXml = `<w:sdtContent><w:r>${runPropertiesXml(field.style)}${renderTextTokens(displayValue)}</w:r></w:sdtContent>`;
  const sdtXml = `<w:sdt>${propertiesXml}${contentXml}</w:sdt>`;
  return wrapWithHyperlinkXml(sdtXml, field.link, state);
}

function paragraphXml(
  paragraph: ParagraphNode,
  pkg: OoxmlPackage,
  state: ImageSerializationState,
  runIdRef: { current: number }
): string {
  if (paragraph.sourceXml) {
    return paragraph.sourceXml;
  }

  const runs = paragraph.children
    .map((child) => {
      if (child.type === "text") {
        const runXml = `<w:r>${runPropertiesXml(child.style)}${renderTextTokens(child.text)}</w:r>`;
        return wrapWithHyperlinkXml(runXml, child.link, state);
      }

      if (child.type === "form-field") {
        return formFieldRunXml(child, state);
      }

      runIdRef.current += 1;
      return drawingRunXml(child, pkg, state, runIdRef.current);
    })
    .filter((xml) => xml.length > 0)
    .join("");

  const paragraphRuns = runs.length > 0 ? runs : "<w:r><w:t/></w:r>";
  return `<w:p>${paragraphPropertiesXml(paragraph.style)}${paragraphRuns}</w:p>`;
}

function tableCellXmlContent(
  nodes: TableCellContentNode[],
  pkg: OoxmlPackage,
  state: ImageSerializationState,
  runIdRef: { current: number }
): string {
  return nodes
    .map((node) => {
      if (node.type === "paragraph") {
        return paragraphXml(node, pkg, state, runIdRef);
      }

      return tableXml(node, pkg, state, runIdRef);
    })
    .join("");
}

function tableXml(
  table: TableNode,
  pkg: OoxmlPackage,
  state: ImageSerializationState,
  runIdRef: { current: number }
): string {
  if (table.sourceXml) {
    return table.sourceXml;
  }

  const tableProps: string[] = [];
  const tableWidthTwips = twipsToXml(table.style?.widthTwips);
  if (tableWidthTwips !== undefined) {
    tableProps.push(`<w:tblW w:w="${tableWidthTwips}" w:type="dxa"/>`);
  } else {
    tableProps.push('<w:tblW w:w="0" w:type="auto"/>');
  }

  const tableIndentTwips = twipsToXml(table.style?.indentTwips);
  if (tableIndentTwips !== undefined) {
    tableProps.push(`<w:tblInd w:w="${tableIndentTwips}" w:type="dxa"/>`);
  }

  if (table.style?.layout === "fixed" || table.style?.layout === "autofit") {
    tableProps.push(`<w:tblLayout w:type="${table.style.layout}"/>`);
  }

  const tableCellSpacingTwips = twipsToXmlNonNegative(
    table.style?.cellSpacingTwips
  );
  if (tableCellSpacingTwips !== undefined) {
    tableProps.push(
      `<w:tblCellSpacing w:w="${tableCellSpacingTwips}" w:type="dxa"/>`
    );
  }

  const tableCellMarginXml = tableBoxSpacingXml(table.style?.cellMarginTwips, "w:tblCellMar");
  if (tableCellMarginXml) {
    tableProps.push(tableCellMarginXml);
  }
  const tableBorderXml = tableBordersXml(table.style?.borders, "w:tblBorders");
  if (tableBorderXml) {
    tableProps.push(tableBorderXml);
  }

  const tableGridXml = table.style?.columnWidthsTwips?.length
    ? `<w:tblGrid>${table.style.columnWidthsTwips
        .map((width) => twipsToXml(width))
        .filter((width): width is number => width !== undefined)
        .map((width) => `<w:gridCol w:w="${width}"/>`)
        .join("")}</w:tblGrid>`
    : "";

  const rows = table.rows
    .map((row) => {
      const rowProps: string[] = [];
      if (row.style?.backgroundColor) {
        const fill = row.style.backgroundColor.replace("#", "");
        rowProps.push(`<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`);
      }
      const rowHeightTwips = twipsToXml(row.style?.heightTwips);
      if (rowHeightTwips !== undefined) {
        const hRule =
          row.style?.heightRule === "exact" || row.style?.heightRule === "atLeast" || row.style?.heightRule === "auto"
            ? ` w:hRule="${row.style.heightRule}"`
            : "";
        rowProps.push(`<w:trHeight w:val="${rowHeightTwips}"${hRule}/>`);
      }
      if (row.style?.cantSplit === true) {
        rowProps.push("<w:cantSplit/>");
      }

      const cells = row.cells
        .map((cell) => {
          const serializedCells = tableCellXmlContent(cell.nodes, pkg, state, runIdRef);

          const cellProps: string[] = [];
          const cellWidthTwips = twipsToXml(cell.style?.widthTwips);
          if (cellWidthTwips !== undefined) {
            cellProps.push(`<w:tcW w:w="${cellWidthTwips}" w:type="dxa"/>`);
          }
          if (cell.style?.backgroundColor) {
            const fill = cell.style.backgroundColor.replace("#", "");
            cellProps.push(`<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`);
          }
          if (cell.style?.gridSpan && cell.style.gridSpan > 1) {
            cellProps.push(`<w:gridSpan w:val="${Math.round(cell.style.gridSpan)}"/>`);
          }
          const cellMarginXml = tableBoxSpacingXml(cell.style?.marginTwips, "w:tcMar");
          if (cellMarginXml) {
            cellProps.push(cellMarginXml);
          }
          const cellBorderXml = tableBordersXml(cell.style?.borders, "w:tcBorders");
          if (cellBorderXml) {
            cellProps.push(cellBorderXml);
          }
          if (
            cell.style?.verticalAlign &&
            (cell.style.verticalAlign === "top" ||
              cell.style.verticalAlign === "center" ||
              cell.style.verticalAlign === "bottom")
          ) {
            cellProps.push(`<w:vAlign w:val="${cell.style.verticalAlign}"/>`);
          }

          const tcPr = cellProps.length > 0 ? `<w:tcPr>${cellProps.join("")}</w:tcPr>` : "";
          return `<w:tc>${tcPr}${serializedCells || "<w:p><w:r><w:t/></w:r></w:p>"}</w:tc>`;
        })
        .join("");

      const trPr = rowProps.length > 0 ? `<w:trPr>${rowProps.join("")}</w:trPr>` : "";
      return `<w:tr>${trPr}${cells}</w:tr>`;
    })
    .join("");

  return `<w:tbl><w:tblPr>${tableProps.join("")}</w:tblPr>${tableGridXml}${rows}</w:tbl>`;
}

function createImageSerializationState(
  basePackage: OoxmlPackage,
  ownerPartName = "word/document.xml"
): ImageSerializationState {
  const relationshipPartName = relationshipPartNameForWordPart(ownerPartName);
  const relationshipsXml =
    basePackage.parts.get(relationshipPartName)?.content ??
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${RELS_XMLNS}"/>`;

  const relationships = parseRelationshipsXml(relationshipsXml);
  const relationshipByTarget = new Map(relationships.map((relationship) => [relationship.target, relationship]));

  const usedImageNumbers = Array.from(basePackage.binaryAssets.keys())
    .map((partName) => {
      const match = partName.match(/word\/media\/image(\d+)\./i);
      return match?.[1] ? Number(match[1]) : 0;
    })
    .filter((value) => Number.isFinite(value));

  return {
    nextImageIndex: Math.max(1, ...usedImageNumbers) + 1,
    nextRelationshipIndex: nextRelationshipIndex(relationships),
    relationships,
    relationshipByTarget
  };
}

function ensureWordSectionPartOpenTag(
  existingPartContent: string | undefined,
  rootTagName: "w:hdr" | "w:ftr"
): string {
  const existingOpenTag = existingPartContent?.match(new RegExp(`<${rootTagName}\\b[^>]*>`, "i"))?.[0];
  let openTag =
    existingOpenTag ??
    `<${rootTagName} xmlns:w="${WORD_MAIN_NS}" xmlns:r="${OFFICE_REL_NS}">`;

  openTag = ensureNamespace(openTag, "w", WORD_MAIN_NS);
  openTag = ensureNamespace(openTag, "r", OFFICE_REL_NS);
  openTag = ensureNamespace(openTag, "a", DRAWING_MAIN_NS);
  openTag = ensureNamespace(openTag, "wp", DRAWING_WORD_NS);
  openTag = ensureNamespace(openTag, "pic", DRAWING_PICTURE_NS);
  openTag = ensureNamespace(openTag, "w14", WORD_2010_NS);
  openTag = ensureNamespace(openTag, "mc", MARKUP_COMPATIBILITY_NS);
  openTag = ensureIgnorablePrefix(openTag, "w14");

  return openTag;
}

function serializeSectionPartXml(
  sectionNodes: DocModel["nodes"],
  rootTagName: "w:hdr" | "w:ftr",
  partName: string,
  pkg: OoxmlPackage
): { xml: string; relationships: Relationship[] } {
  const state = createImageSerializationState(pkg, partName);
  const runIdRef = { current: 1 };
  const bodyXml = sectionNodes
    .map((node) => {
      if (node.type === "paragraph") {
        return paragraphXml(node, pkg, state, runIdRef);
      }
      return tableXml(node, pkg, state, runIdRef);
    })
    .join("");
  const existingContent = pkg.parts.get(partName)?.content;
  const openTag = ensureWordSectionPartOpenTag(existingContent, rootTagName);
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${openTag}${bodyXml}</${rootTagName}>`;
  return {
    xml,
    relationships: state.relationships
  };
}

function sectionRootTagNameForPartName(partName: string): "w:hdr" | "w:ftr" {
  return /header/i.test(partName) ? "w:hdr" : "w:ftr";
}

function serializeHeaderFooterParts(model: DocModel, pkg: OoxmlPackage): void {
  const sectionsByPartName = new Map<string, DocModel["nodes"]>();
  const addSections = (sections: Array<{ partName: string; nodes: DocModel["nodes"] }> | undefined): void => {
    (sections ?? []).forEach((section) => {
      const normalizedPartName = normalizeWordPartName(section.partName);
      if (!normalizedPartName || sectionsByPartName.has(normalizedPartName)) {
        return;
      }
      sectionsByPartName.set(normalizedPartName, section.nodes);
    });
  };

  addSections(model.metadata.headerSections);
  addSections(model.metadata.footerSections);
  (model.metadata.sections ?? []).forEach((section) => {
    addSections(section.headerSections);
    addSections(section.footerSections);
  });

  sectionsByPartName.forEach((nodes, partName) => {
    const rootTagName = sectionRootTagNameForPartName(partName);
    const serialized = serializeSectionPartXml(nodes, rootTagName, partName, pkg);
    pkg.parts.set(partName, {
      name: partName,
      content: serialized.xml
    });
    const relationshipPartName = relationshipPartNameForWordPart(partName);
    pkg.parts.set(relationshipPartName, {
      name: relationshipPartName,
      content: renderRelationshipsXml(serialized.relationships)
    });
  });
}

function ensureNamespace(documentOpenTag: string, prefix: string, namespace: string): string {
  if (new RegExp(`\\sxmlns:${prefix}=["']`, "i").test(documentOpenTag)) {
    return documentOpenTag;
  }

  return documentOpenTag.replace(/>$/, ` xmlns:${prefix}="${namespace}">`);
}

function ensureIgnorablePrefix(documentOpenTag: string, prefix: string): string {
  const ignorableMatch = documentOpenTag.match(/\smc:Ignorable=(["'])([^"']*)\1/i);
  if (!ignorableMatch) {
    return documentOpenTag.replace(/>$/, ` mc:Ignorable="${prefix}">`);
  }

  const delimiter = ignorableMatch[1];
  const currentValue = ignorableMatch[2] ?? "";
  const tokens = currentValue
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.includes(prefix)) {
    return documentOpenTag;
  }

  const updatedValue = [...tokens, prefix].join(" ");
  return documentOpenTag.replace(
    /\smc:Ignorable=(["'])([^"']*)\1/i,
    ` mc:Ignorable=${delimiter}${updatedValue}${delimiter}`
  );
}

function ensureDocumentOpenTag(model: DocModel): string {
  let openTag =
    model.metadata.documentOpenTag ??
    `<w:document xmlns:w="${WORD_MAIN_NS}" xmlns:r="${OFFICE_REL_NS}">`;

  openTag = ensureNamespace(openTag, "w", WORD_MAIN_NS);
  openTag = ensureNamespace(openTag, "r", OFFICE_REL_NS);
  openTag = ensureNamespace(openTag, "a", DRAWING_MAIN_NS);
  openTag = ensureNamespace(openTag, "wp", DRAWING_WORD_NS);
  openTag = ensureNamespace(openTag, "pic", DRAWING_PICTURE_NS);
  openTag = ensureNamespace(openTag, "w14", WORD_2010_NS);
  openTag = ensureNamespace(openTag, "mc", MARKUP_COMPATIBILITY_NS);
  openTag = ensureIgnorablePrefix(openTag, "w14");

  return openTag;
}

export function modelToDocumentXml(model: DocModel, basePackage?: OoxmlPackage): string {
  const seed =
    basePackage ??
    createMinimalDocxPackage(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${WORD_MAIN_NS}"><w:body><w:p><w:r><w:t/></w:r></w:p></w:body></w:document>`
    );

  const documentPartName = "word/document.xml";
  const state = createImageSerializationState(seed, documentPartName);
  const runIdRef = { current: 1 };

  const bodyXml = model.nodes
    .map((node) => {
      if (node.type === "paragraph") {
        return paragraphXml(node, seed, state, runIdRef);
      }

      return tableXml(node, seed, state, runIdRef);
    })
    .join("");

  const documentRelationshipPartName = relationshipPartNameForWordPart(documentPartName);
  seed.parts.set(documentRelationshipPartName, {
    name: documentRelationshipPartName,
    content: renderRelationshipsXml(state.relationships)
  });

  const documentOpenTag = ensureDocumentOpenTag(model);
  const sectionPropertiesXml = model.metadata.sectionPropertiesXml ?? DEFAULT_SECTION_PROPERTIES_XML;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${documentOpenTag}<w:body>${bodyXml}${sectionPropertiesXml}</w:body></w:document>`;
}

export function serializeDocModel(model: DocModel, basePackage?: OoxmlPackage): OoxmlPackage {
  const seed: OoxmlPackage = basePackage
    ? {
        parts: new Map(basePackage.parts),
        binaryAssets: new Map(basePackage.binaryAssets)
      }
    : createMinimalDocxPackage();

  const documentXml = modelToDocumentXml(model, seed);
  const withDocument = withPart(seed, {
    name: "word/document.xml",
    content: documentXml
  });
  serializeHeaderFooterParts(model, withDocument);
  return withDocument;
}

export function serializeDocx(model: DocModel, basePackage?: OoxmlPackage): ArrayBuffer {
  return packageToArrayBuffer(serializeDocModel(model, basePackage));
}
