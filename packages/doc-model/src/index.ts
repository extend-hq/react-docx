import type { OoxmlPackage } from "@extend-ai/react-docx-ooxml-core";

export type ParagraphAlignment = "left" | "center" | "right" | "justify";
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface TextRunBorderStyle {
  type: string;
  color?: string;
  sizeEighthPt?: number;
  spacePt?: number;
  frame?: boolean;
  shadow?: boolean;
}

export interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  highlight?: string;
  backgroundColor?: string;
  fontSizePt?: number;
  fontFamily?: string;
  characterSpacingTwips?: number;
  verticalAlign?: "superscript" | "subscript";
  runBorder?: TextRunBorderStyle;
}

export interface TextRunNode {
  type: "text";
  text: string;
  style?: TextStyle;
  link?: string;
  noteReference?: {
    kind: "footnote" | "endnote";
    id: number;
  };
}

export interface ImageRunNode {
  type: "image";
  src?: string;
  alt?: string;
  widthPx?: number;
  heightPx?: number;
  partName?: string;
  contentType?: string;
  data?: Uint8Array;
  sourceXml?: string;
  crop?: {
    leftFraction?: number;
    topFraction?: number;
    rightFraction?: number;
    bottomFraction?: number;
  };
  cssFilter?: string;
  cssOpacity?: number;
  floating?: {
    xPx?: number;
    yPx?: number;
    horizontalAlign?: "left" | "center" | "right" | "inside" | "outside";
    verticalAlign?: "top" | "center" | "bottom" | "inside" | "outside";
    horizontalRelativeTo?: string;
    verticalRelativeTo?: string;
    distLPx?: number;
    distRPx?: number;
    distTPx?: number;
    distBPx?: number;
    wrapType?: "none" | "square" | "tight" | "through" | "topAndBottom";
    wrapText?: "bothSides" | "left" | "right" | "largest";
    behindDocument?: boolean;
    zIndex?: number;
  };
  syntheticTextBox?: boolean;
  textBoxText?: string;
}

export type FormFieldType = "checkbox" | "text" | "date" | "dropdown";

export type FormFieldSourceKind = "sdt" | "legacy";

export interface FormFieldOption {
  displayText: string;
  value?: string;
}

export interface FormFieldTextWidgetSettings {
  inputType?:
    | "regular"
    | "number"
    | "date"
    | "currentDate"
    | "currentTime"
    | "calculated"
    | (string & {});
  defaultText?: string;
  maxLength?: number;
  textFormat?: string;
}

export interface FormFieldCheckboxWidgetSettings {
  defaultChecked?: boolean;
  sizeMode?: "auto" | "exact";
  sizePt?: number;
}

export interface FormFieldDropdownWidgetSettings {
  defaultValue?: string;
}

export interface FormFieldWidgetSettings {
  name?: string;
  enabled?: boolean;
  calcOnExit?: boolean;
  text?: FormFieldTextWidgetSettings;
  checkbox?: FormFieldCheckboxWidgetSettings;
  dropdown?: FormFieldDropdownWidgetSettings;
}

export interface FormFieldRunNode {
  type: "form-field";
  fieldType: FormFieldType;
  sourceKind?: FormFieldSourceKind;
  id?: number;
  tag?: string;
  title?: string;
  placeholder?: string;
  checked?: boolean;
  value?: string;
  options?: FormFieldOption[];
  widget?: FormFieldWidgetSettings;
  checkedSymbol?: string;
  uncheckedSymbol?: string;
  style?: TextStyle;
  link?: string;
  sourceXml?: string;
}

export type ParagraphChildNode = TextRunNode | ImageRunNode | FormFieldRunNode;

export interface ParagraphNumbering {
  numId: number;
  ilvl: number;
}

export interface ParagraphSpacing {
  beforeTwips?: number;
  afterTwips?: number;
  lineTwips?: number;
  lineRule?: "auto" | "exact" | "atLeast";
}

export interface ParagraphIndent {
  leftTwips?: number;
  rightTwips?: number;
  firstLineTwips?: number;
  hangingTwips?: number;
}

export interface ParagraphBorderStyle {
  type: string;
  color?: string;
  sizeEighthPt?: number;
  spacePt?: number;
  frame?: boolean;
  shadow?: boolean;
}

export interface ParagraphBorderSet {
  top?: ParagraphBorderStyle;
  right?: ParagraphBorderStyle;
  bottom?: ParagraphBorderStyle;
  left?: ParagraphBorderStyle;
  between?: ParagraphBorderStyle;
  bar?: ParagraphBorderStyle;
}

export interface ParagraphStyle {
  align?: ParagraphAlignment;
  headingLevel?: HeadingLevel;
  styleId?: string;
  styleName?: string;
  numbering?: ParagraphNumbering;
  spacing?: ParagraphSpacing;
  indent?: ParagraphIndent;
  backgroundColor?: string;
  borders?: ParagraphBorderSet;
  tabStops?: ParagraphTabStop[];
  contextualSpacing?: boolean;
  keepNext?: boolean;
  keepLines?: boolean;
  widowControl?: boolean;
  pageBreakBefore?: boolean;
  dropCap?: {
    type: "drop" | "margin";
    lines?: number;
    wrap?: string;
    horizontalAnchor?: string;
    verticalAnchor?: string;
    xTwips?: number;
    yTwips?: number;
    horizontalSpaceTwips?: number;
    verticalSpaceTwips?: number;
  };
}

export interface ParagraphNode {
  type: "paragraph";
  children: ParagraphChildNode[];
  style?: ParagraphStyle;
  paragraphMarkDeleted?: boolean;
  sourceXml?: string;
}

export interface TableBoxSpacing {
  topTwips?: number;
  rightTwips?: number;
  bottomTwips?: number;
  leftTwips?: number;
}

export interface TableBorderStyle {
  type: string;
  color?: string;
  sizeEighthPt?: number;
}

export interface TableBorderSet {
  top?: TableBorderStyle;
  right?: TableBorderStyle;
  bottom?: TableBorderStyle;
  left?: TableBorderStyle;
  insideH?: TableBorderStyle;
  insideV?: TableBorderStyle;
  tl2br?: TableBorderStyle;
  tr2bl?: TableBorderStyle;
}

export interface TableCellStyle {
  backgroundColor?: string;
  gridSpan?: number;
  rowSpan?: number;
  vMergeContinuation?: boolean;
  widthTwips?: number;
  marginTwips?: TableBoxSpacing;
  verticalAlign?: "top" | "center" | "bottom";
  borders?: TableBorderSet;
}

export type TableCellContentNode = ParagraphNode | TableNode;

function isParagraphCellContent(node: TableCellContentNode): node is ParagraphNode {
  return node.type === "paragraph";
}

function isTableCellContentTable(node: TableCellContentNode): node is TableNode {
  return node.type === "table";
}

function cellParagraphsFromContent(nodes: TableCellContentNode[]): ParagraphNode[] {
  const paragraphs: ParagraphNode[] = [];

  const walk = (items: TableCellContentNode[]): void => {
    for (const item of items) {
      if (isParagraphCellContent(item)) {
        paragraphs.push(item);
        continue;
      }

      if (isTableCellContentTable(item)) {
        for (const row of item.rows) {
          for (const cell of row.cells) {
            walk(cell.nodes);
          }
        }
      }
    }
  };

  walk(nodes);
  return paragraphs;
}

function cloneTableCellContent(nodes: TableCellContentNode[]): TableCellContentNode[] {
  return nodes.map((node) => {
    if (isParagraphCellContent(node)) {
      return cloneParagraph(node);
    }

    if (isTableCellContentTable(node)) {
      return cloneTable(node);
    }

    return node;
  });
}

function applyRunStyleToTableCellContent(nodes: TableCellContentNode[], runStyle: TextStyle): void {
  for (const node of nodes) {
    if (isParagraphCellContent(node)) {
      applyRunStyleToParagraph(node, runStyle);
      continue;
    }

    if (isTableCellContentTable(node)) {
      applyRunStyleToTable(node, runStyle);
    }
  }
}

function applyRunStyleToTable(table: TableNode, runStyle: TextStyle): void {
  for (const row of table.rows) {
    for (const cell of row.cells) {
      applyRunStyleToTableCellContent(cell.nodes, runStyle);
    }
  }
}

export interface TableCellNode {
  type: "table-cell";
  nodes: TableCellContentNode[];
  style?: TableCellStyle;
}

export interface TableRowStyle {
  backgroundColor?: string;
  heightTwips?: number;
  heightRule?: "auto" | "atLeast" | "exact";
  cantSplit?: boolean;
}

export interface TableRowNode {
  type: "table-row";
  cells: TableCellNode[];
  style?: TableRowStyle;
}

export interface TableStyle {
  widthTwips?: number;
  indentTwips?: number;
  layout?: "fixed" | "autofit";
  cellSpacingTwips?: number;
  cellMarginTwips?: TableBoxSpacing;
  columnWidthsTwips?: number[];
  borders?: TableBorderSet;
  floating?: {
    xTwips?: number;
    yTwips?: number;
    leftFromTextTwips?: number;
    rightFromTextTwips?: number;
    topFromTextTwips?: number;
    bottomFromTextTwips?: number;
    horizontalAnchor?: string;
    verticalAnchor?: string;
    horizontalAlign?: "left" | "center" | "right" | "inside" | "outside";
    verticalAlign?: "top" | "center" | "bottom" | "inside" | "outside";
  };
}

export interface TableNode {
  type: "table";
  rows: TableRowNode[];
  style?: TableStyle;
  sourceXml?: string;
}

export type DocNode = ParagraphNode | TableNode;

export interface HeaderSection {
  partName: string;
  referenceType?: string;
  nodes: DocNode[];
}

export interface FooterSection {
  partName: string;
  referenceType?: string;
  nodes: DocNode[];
}

export interface DocumentSection {
  startNodeIndex: number;
  sectionPropertiesXml?: string;
  headerSections: HeaderSection[];
  footerSections: FooterSection[];
}

export interface ParagraphStyleDefinition {
  id: string;
  name: string;
  basedOnId?: string;
  nextStyleId?: string;
  align?: ParagraphAlignment;
  headingLevel?: HeadingLevel;
  numbering?: ParagraphNumbering;
  spacing?: ParagraphSpacing;
  indent?: ParagraphIndent;
  backgroundColor?: string;
  borders?: ParagraphBorderSet;
  tabStops?: ParagraphTabStop[];
  contextualSpacing?: boolean;
  keepNext?: boolean;
  keepLines?: boolean;
  widowControl?: boolean;
  pageBreakBefore?: boolean;
  runStyle?: TextStyle;
  uiPriority?: number;
  isDefault?: boolean;
  isPrimary?: boolean;
}

export interface NumberingLevelDefinition {
  ilvl: number;
  start?: number;
  format?: string;
  text?: string;
  suffix?: "tab" | "space" | "nothing";
  indent?: ParagraphIndent;
  runStyle?: TextStyle;
  bulletFontFamily?: string;
  bulletColor?: string;
  pictureBulletId?: number;
  pictureBullet?: NumberingPictureBulletDefinition;
}

export interface NumberingAbstractDefinition {
  abstractNumId: number;
  levels: NumberingLevelDefinition[];
}

export interface NumberingInstanceDefinition {
  numId: number;
  abstractNumId: number;
  levelStartOverrides?: Record<string, number>;
  levelOverrides?: NumberingLevelDefinition[];
}

export interface NumberingDefinitionSet {
  abstracts: NumberingAbstractDefinition[];
  instances: NumberingInstanceDefinition[];
}

export interface NumberingPictureBulletDefinition {
  numPicBulletId: number;
  src?: string;
  widthPx?: number;
  heightPx?: number;
  partName?: string;
  contentType?: string;
}

export interface DocumentNoteDefinition {
  id: number;
  text: string;
  nodes?: DocNode[];
}

export interface DocumentCompatibilitySettings {
  suppressSpacingBeforeAfterPageBreak?: boolean;
  usePrinterMetrics?: boolean;
  useFixedHtmlParagraphSpacing?: boolean;
  doNotBreakWrappedTables?: boolean;
  doNotBreakConstrainedForcedTable?: boolean;
  evenAndOddHeaders?: boolean;
}

export interface DocModel {
  nodes: DocNode[];
  metadata: {
    sourceParts: number;
    warnings: string[];
    documentPageCount?: number;
    documentOpenTag?: string;
    documentBackgroundColor?: string;
    sectionPropertiesXml?: string;
    sections?: DocumentSection[];
    headerSections: HeaderSection[];
    footerSections: FooterSection[];
    paragraphStyles: ParagraphStyleDefinition[];
    defaultParagraphStyleId?: string;
    numberingDefinitions?: NumberingDefinitionSet;
    compatibility?: DocumentCompatibilitySettings;
    footnotes?: DocumentNoteDefinition[];
    endnotes?: DocumentNoteDefinition[];
  };
}

interface ContentTypeLookup {
  defaultByExtension: Map<string, string>;
  overrideByPartName: Map<string, string>;
}

interface ParseContext {
  relationships: Map<string, string>;
  contentTypes: ContentTypeLookup;
  parts: OoxmlPackage["parts"];
  binaryAssets: Map<string, Uint8Array>;
  styleSheet: ParsedStyleSheet;
  warnings: string[];
}

function parseDocumentBackgroundColor(documentXml: string): string | undefined {
  const backgroundTag = documentXml.match(/<w:background\b[^>]*>/i)?.[0];
  if (!backgroundTag) {
    return undefined;
  }

  return normalizeHexColor(
    backgroundTag.match(/\bw:color="([^"]+)"/i)?.[1]
  );
}

interface RawStyleDefinition {
  id: string;
  type: "paragraph" | "character" | "numbering" | "table";
  name: string;
  basedOnId?: string;
  nextStyleId?: string;
  align?: ParagraphAlignment;
  headingLevel?: HeadingLevel;
  numbering?: ParagraphNumbering;
  spacing?: ParagraphSpacing;
  indent?: ParagraphIndent;
  backgroundColor?: string;
  borders?: ParagraphBorderSet;
  tabStops?: ParagraphTabStop[];
  contextualSpacing?: boolean;
  keepNext?: boolean;
  keepLines?: boolean;
  widowControl?: boolean;
  pageBreakBefore?: boolean;
  runStyle?: TextStyle;
  uiPriority?: number;
  isDefault?: boolean;
  isPrimary?: boolean;
}

interface ThemeFontMap {
  majorLatin?: string;
  minorLatin?: string;
  majorEastAsia?: string;
  minorEastAsia?: string;
  majorComplexScript?: string;
  minorComplexScript?: string;
}

type ThemeColorToken = string;

interface ThemeColorMap {
  [token: ThemeColorToken]: string;
}

interface ParagraphTabStop {
  alignment?: "left" | "center" | "right" | "decimal" | "bar";
  leader?: "none" | "dot" | "hyphen" | "underscore" | "middleDot";
  positionTwips?: number;
}

interface ParsedStyleSheet {
  paragraphStyles: ParagraphStyleDefinition[];
  paragraphStyleById: Map<string, ParagraphStyleDefinition>;
  runStyleById: Map<string, TextStyle>;
  tableStyleById: Map<string, ParsedTableStyleDefinition>;
  defaultParagraphStyle?: ParagraphStyle;
  defaultParagraphStyleId?: string;
  defaultRunStyle?: TextStyle;
  themeFonts: ThemeFontMap;
  themeColors: ThemeColorMap;
}

type TableConditionalStyleType =
  | "wholeTable"
  | "firstRow"
  | "lastRow"
  | "firstCol"
  | "lastCol"
  | "band1Horz"
  | "band2Horz"
  | "band1Vert"
  | "band2Vert"
  | "nwCell"
  | "neCell"
  | "swCell"
  | "seCell";

interface ParsedTableStyleCondition {
  rowBackgroundColor?: string;
  cellBackgroundColor?: string;
  paragraphAlign?: ParagraphAlignment;
  runStyle?: TextStyle;
  tableBorders?: TableBorderSet;
  cellBorders?: TableBorderSet;
  tableProperties?: ParsedTableProperties;
  tableLook?: ParsedTableLook;
}

interface ParsedTableStyleDefinition {
  id: string;
  basedOnId?: string;
  name: string;
  conditions: Partial<Record<TableConditionalStyleType, ParsedTableStyleCondition>>;
  floating?: NonNullable<TableStyle["floating"]>;
  properties?: ParsedTableProperties;
}

interface ParsedTableProperties {
  widthTwips?: number;
  indentTwips?: number;
  layout?: "fixed" | "autofit";
  cellSpacingTwips?: number;
  cellMarginTwips?: TableBoxSpacing;
  floating?: NonNullable<TableStyle["floating"]>;
}

interface ParsedTableLook {
  firstRow: boolean;
  lastRow: boolean;
  firstCol: boolean;
  lastCol: boolean;
  noHBand: boolean;
  noVBand: boolean;
  rowBandSize: number;
  colBandSize: number;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  wmf: "image/wmf",
  emf: "image/emf",
  webp: "image/webp",
  svg: "image/svg+xml"
};

function decodeXmlEntities(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface TagRange {
  start: number;
  end: number;
}

function extractBalancedTagRanges(xml: string, tagName: string): TagRange[] {
  const escapedTagName = escapeRegExp(tagName);
  const tokenPattern = new RegExp(`<${escapedTagName}\\b[^>]*\\/?>|<\\/${escapedTagName}>`, "gi");
  const ranges: TagRange[] = [];
  const startStack: number[] = [];

  for (const token of xml.matchAll(tokenPattern)) {
    const tokenXml = token[0];
    const tokenIndex = token.index;
    if (tokenIndex === undefined || tokenIndex < 0) {
      continue;
    }

    if (tokenXml.startsWith("</")) {
      const start = startStack.pop();
      if (start === undefined) {
        continue;
      }

      if (startStack.length === 0) {
        ranges.push({
          start,
          end: tokenIndex + tokenXml.length
        });
      }
      continue;
    }

    const selfClosing = /\/>\s*$/i.test(tokenXml);
    if (selfClosing) {
      if (startStack.length === 0) {
        ranges.push({
          start: tokenIndex,
          end: tokenIndex + tokenXml.length
        });
      }
      continue;
    }

    startStack.push(tokenIndex);
  }

  return ranges;
}

function extractBalancedTagBlocks(xml: string, tagName: string): string[] {
  return extractBalancedTagRanges(xml, tagName).map((range) => xml.slice(range.start, range.end));
}

interface TaggedRange extends TagRange {
  tagName: string;
}

function extractBalancedTagBlocksInOrder(xml: string, tagNames: string[]): TaggedRange[] {
  const ranges = tagNames.flatMap((tagName) =>
    extractBalancedTagRanges(xml, tagName).map((range) => ({
      ...range,
      tagName
    }))
  );

  ranges.sort((left, right) => {
    if (left.start !== right.start) {
      return left.start - right.start;
    }
    return left.end - right.end;
  });

  const topLevelRanges: TaggedRange[] = [];
  for (const range of ranges) {
    const nestedInsideParent = topLevelRanges.some(
      (parentRange) => range.start >= parentRange.start && range.end <= parentRange.end
    );
    if (nestedInsideParent) {
      continue;
    }
    topLevelRanges.push(range);
  }

  return topLevelRanges;
}

function parseOnOffAttribute(xml: string, tagName: string): boolean | undefined {
  const match = xml.match(new RegExp(`<w:${tagName}\\b([^>]*)\\/?>`, "i"));
  if (!match) {
    return undefined;
  }

  const attributes = match[1] ?? "";
  const valueMatch = attributes.match(/w:val="([^"]+)"/i);
  if (!valueMatch) {
    return true;
  }

  const value = valueMatch[1].toLowerCase();
  return value !== "0" && value !== "false" && value !== "none" && value !== "off";
}

function parseUnderlineAttribute(xml: string): boolean | undefined {
  const match = xml.match(/<w:u\b([^>]*)\/?>/i);
  if (!match) {
    return undefined;
  }

  const attributes = match[1] ?? "";
  const valueMatch = attributes.match(/\bw:val="([^"]+)"/i);
  if (valueMatch) {
    const value = valueMatch[1].toLowerCase();
    return value !== "0" && value !== "false" && value !== "none" && value !== "off";
  }

  const compactAttributes = attributes.replace(/\s+/g, "").replace(/\/+$/g, "");
  if (!compactAttributes) {
    // <w:u/> explicitly enables underline.
    return true;
  }

  // Word documents generated by some tools emit color-only underline tags in
  // textbox runs (e.g. <w:u w:color="FFFFFF"/>). Treat these as "inherit"
  // rather than forcing underline on.
  const nonDecorationAttributes = compactAttributes
    .replace(/\bw:color="[^"]*"/gi, "")
    .replace(/\bw:themeColor="[^"]*"/gi, "")
    .replace(/\bw:themeTint="[^"]*"/gi, "")
    .replace(/\bw:themeShade="[^"]*"/gi, "")
    .replace(/\/+$/g, "");

  if (!nonDecorationAttributes) {
    return undefined;
  }

  return true;
}

function normalizeAlignment(rawAlignment?: string): ParagraphAlignment | undefined {
  if (!rawAlignment) {
    return undefined;
  }

  const value = rawAlignment.toLowerCase();
  if (value === "both" || value === "distribute" || value === "thaidistribute") {
    return "justify";
  }

  if (value === "left" || value === "center" || value === "right" || value === "justify") {
    return value;
  }

  return undefined;
}

function normalizeHeadingLevel(value?: string): HeadingLevel | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.match(/heading\s*([1-6])/i);
  if (!match?.[1]) {
    return undefined;
  }

  return Number(match[1]) as HeadingLevel;
}

function normalizeHexColor(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized || normalized.toLowerCase() === "auto") {
    return undefined;
  }

  if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return `#${normalized}`;
  }

  if (/^[0-9a-fA-F]{3}$/.test(normalized)) {
    const expanded = normalized
      .split("")
      .map((character) => character + character)
      .join("");
    return `#${expanded}`;
  }

  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return normalized;
  }

  return undefined;
}

const DEFAULT_DRAWING_SCHEME_COLORS: ThemeColorMap = {
  bg1: "#ffffff",
  bg2: "#f3f4f6",
  tx1: "#000000",
  tx2: "#1f2937",
  dk1: "#000000",
  dk2: "#1f2937",
  lt1: "#ffffff",
  lt2: "#f3f4f6",
  accent1: "#4472c4",
  accent2: "#ed7d31",
  accent3: "#70ad47",
  accent4: "#5b9bd5",
  accent5: "#7030a0",
  accent6: "#ffc000",
  hlink: "#0563c1",
  folhlink: "#954f72",
  followedhyperlink: "#954f72"
};

function emuToPixels(value: number | string | undefined): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Number((parsed / 9525).toFixed(3));
}

function resolveDrawingColorFromXml(
  colorXml: string | undefined,
  themeColors: ThemeColorMap
): { color: string; opacity?: number } | undefined {
  if (!colorXml) {
    return undefined;
  }

  const srgb = normalizeHexColor(colorXml.match(/<a:srgbClr\b[^>]*val="([^"]+)"/i)?.[1]);
  const sys = normalizeHexColor(colorXml.match(/<a:sysClr\b[^>]*lastClr="([^"]+)"/i)?.[1]);
  const schemeToken = colorXml.match(/<a:schemeClr\b[^>]*val="([^"]+)"/i)?.[1]?.trim().toLowerCase();
  const scheme =
    (schemeToken ? themeColors[schemeToken] : undefined) ??
    (schemeToken ? DEFAULT_DRAWING_SCHEME_COLORS[schemeToken] : undefined);
  const color = srgb ?? sys ?? scheme;
  if (!color) {
    return undefined;
  }

  const alphaRaw = colorXml.match(/<a:alpha\b[^>]*val="(\d+)"/i)?.[1];
  const alpha = alphaRaw ? Number(alphaRaw) : undefined;
  const opacity =
    Number.isFinite(alpha) && (alpha as number) >= 0
      ? Math.max(0, Math.min(1, (alpha as number) / 100000))
      : undefined;

  return {
    color,
    opacity
  };
}

function gradientVectorForAngle(angleDegrees: number): {
  x1: string;
  y1: string;
  x2: string;
  y2: string;
} {
  const radians = (angleDegrees * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);

  return {
    x1: `${50 - dx * 50}%`,
    y1: `${50 - dy * 50}%`,
    x2: `${50 + dx * 50}%`,
    y2: `${50 + dy * 50}%`
  };
}

function svgRotationTransform(
  rotationDegrees: number | undefined,
  widthPx: number,
  heightPx: number
): string {
  if (!Number.isFinite(rotationDegrees) || Math.abs(rotationDegrees as number) < 0.01) {
    return "";
  }

  return ` transform="rotate(${(rotationDegrees as number).toFixed(3)} ${Math.round(widthPx / 2)} ${Math.round(
    heightPx / 2
  )})"`;
}

function svgRotationLayout(
  rotationDegrees: number | undefined,
  widthPx: number,
  heightPx: number
): {
  transformAttribute: string;
  viewBoxWidthPx: number;
  viewBoxHeightPx: number;
  preserveAspectRatio?: "none";
} {
  const safeWidth = Math.max(1, Math.round(widthPx));
  const safeHeight = Math.max(1, Math.round(heightPx));
  if (!Number.isFinite(rotationDegrees) || Math.abs(rotationDegrees as number) < 0.01) {
    return {
      transformAttribute: "",
      viewBoxWidthPx: safeWidth,
      viewBoxHeightPx: safeHeight
    };
  }

  const radians = ((rotationDegrees as number) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const centerX = safeWidth / 2;
  const centerY = safeHeight / 2;
  const corners = [
    { x: 0, y: 0 },
    { x: safeWidth, y: 0 },
    { x: safeWidth, y: safeHeight },
    { x: 0, y: safeHeight }
  ].map(({ x, y }) => {
    const deltaX = x - centerX;
    const deltaY = y - centerY;
    return {
      x: centerX + deltaX * cos - deltaY * sin,
      y: centerY + deltaX * sin + deltaY * cos
    };
  });
  const minX = Math.min(...corners.map((corner) => corner.x));
  const maxX = Math.max(...corners.map((corner) => corner.x));
  const minY = Math.min(...corners.map((corner) => corner.y));
  const maxY = Math.max(...corners.map((corner) => corner.y));
  const viewBoxWidthPx = Math.max(1, Math.ceil(maxX - minX));
  const viewBoxHeightPx = Math.max(1, Math.ceil(maxY - minY));

  return {
    transformAttribute: ` transform="translate(${(-minX).toFixed(2)} ${(-minY).toFixed(2)}) rotate(${(
      rotationDegrees as number
    ).toFixed(3)} ${centerX.toFixed(2)} ${centerY.toFixed(2)})"`,
    viewBoxWidthPx,
    viewBoxHeightPx,
    preserveAspectRatio: "none"
  };
}

function drawingShapeFillMarkup(
  shapePropertiesXml: string,
  themeColors: ThemeColorMap,
  gradientId: string
): { fillAttribute: string; defs: string[] } {
  const fillScopeXml = shapePropertiesXml
    .replace(/<a:ln\b[\s\S]*?<\/a:ln>/gi, "")
    .replace(/<a:ln\b[^>]*\/>/gi, "")
    .replace(/<a:extLst\b[\s\S]*?<\/a:extLst>/gi, "")
    .replace(/<a:extLst\b[^>]*\/>/gi, "");
  const solidFillXml = extractBalancedTagBlocks(fillScopeXml, "a:solidFill")[0];
  if (solidFillXml) {
    const resolved = resolveDrawingColorFromXml(solidFillXml, themeColors);
    if (resolved) {
      return {
        fillAttribute: `fill="${resolved.color}"${
          resolved.opacity !== undefined ? ` fill-opacity="${resolved.opacity}"` : ""
        }`,
        defs: []
      };
    }
  }

  const gradientFillXml = extractBalancedTagBlocks(fillScopeXml, "a:gradFill")[0];
  if (gradientFillXml) {
    const gradientStops = extractBalancedTagBlocks(gradientFillXml, "a:gs")
      .map((stopXml) => {
        const rawPosition = Number(getAttribute(stopXml.match(/<a:gs\b[^>]*>/i)?.[0] ?? "", "pos"));
        const resolved = resolveDrawingColorFromXml(stopXml, themeColors);
        if (!resolved) {
          return undefined;
        }

        const clampedPosition = Number.isFinite(rawPosition) ? Math.max(0, Math.min(100, rawPosition / 1000)) : 0;
        return `<stop offset="${clampedPosition}%" stop-color="${resolved.color}"${
          resolved.opacity !== undefined ? ` stop-opacity="${resolved.opacity}"` : ""
        }/>`;
      })
      .filter((stop): stop is string => Boolean(stop));

    if (gradientStops.length > 0) {
      const angleRaw = Number(getAttribute(gradientFillXml.match(/<a:lin\b[^>]*>/i)?.[0] ?? "", "ang"));
      const angleDegrees = Number.isFinite(angleRaw) ? angleRaw / 60000 : 90;
      const vector = gradientVectorForAngle(angleDegrees);

      return {
        fillAttribute: `fill="url(#${gradientId})"`,
        defs: [
          `<linearGradient id="${gradientId}" x1="${vector.x1}" y1="${vector.y1}" x2="${vector.x2}" y2="${vector.y2}">${gradientStops.join(
            ""
          )}</linearGradient>`
        ]
      };
    }
  }

  if (/<a:noFill\b/i.test(fillScopeXml)) {
    return {
      fillAttribute: 'fill="none"',
      defs: []
    };
  }

  const styleFillRefXml = extractBalancedTagBlocks(shapePropertiesXml, "a:fillRef")[0];
  if (styleFillRefXml) {
    const resolved = resolveDrawingColorFromXml(styleFillRefXml, themeColors);
    if (resolved) {
      return {
        fillAttribute: `fill="${resolved.color}"${
          resolved.opacity !== undefined ? ` fill-opacity="${resolved.opacity}"` : ""
        }`,
        defs: []
      };
    }
  }

  return {
    fillAttribute: 'fill="none"',
    defs: []
  };
}

function drawingShapeStrokeMarkup(shapePropertiesXml: string, themeColors: ThemeColorMap): string {
  const lineXml =
    extractBalancedTagBlocks(shapePropertiesXml, "a:ln")[0] ??
    shapePropertiesXml.match(/<a:ln\b[^>]*\/>/i)?.[0] ??
    "";
  if (!lineXml || /<a:noFill\b/i.test(lineXml)) {
    return 'stroke="none"';
  }

  const lineWidthEmu = parseIntegerAttribute(lineXml.match(/<a:ln\b[^>]*>/i)?.[0] ?? "", "w");
  if (Number.isFinite(lineWidthEmu) && (lineWidthEmu as number) <= 0) {
    return 'stroke="none"';
  }

  const resolved =
    resolveDrawingColorFromXml(lineXml, themeColors) ??
    resolveDrawingColorFromXml(extractBalancedTagBlocks(shapePropertiesXml, "a:lnRef")[0], themeColors);
  const widthPx = emuToPixels(lineWidthEmu);

  return `stroke="${resolved?.color ?? "#000000"}"${
    resolved?.opacity !== undefined ? ` stroke-opacity="${resolved.opacity}"` : ""
  } stroke-width="${Math.max(1, widthPx ?? 1)}"`;
}

function drawingShapePathData(pathXml: string, widthPx: number, heightPx: number): string | undefined {
  const pathTag = pathXml.match(/<a:path\b[^>]*>/i)?.[0] ?? "";
  const baseWidth = Math.max(1, parseIntegerAttribute(pathTag, "w") ?? 21600);
  const baseHeight = Math.max(1, parseIntegerAttribute(pathTag, "h") ?? 21600);
  const commandMatches = [
    ...pathXml.matchAll(/<(a:moveTo|a:lnTo|a:cubicBezTo|a:close)\b[\s\S]*?(?:<\/\1>|\/>)/gi)
  ];
  if (commandMatches.length === 0) {
    return undefined;
  }

  const scalePoint = (xRaw: string, yRaw: string): string | undefined => {
    const x = Number(xRaw);
    const y = Number(yRaw);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return undefined;
    }

    const scaledX = Number(((x / baseWidth) * widthPx).toFixed(2));
    const scaledY = Number(((y / baseHeight) * heightPx).toFixed(2));
    return `${scaledX} ${scaledY}`;
  };

  const commands = commandMatches
    .map((match) => {
      const commandType = match[1].toLowerCase();
      const commandXml = match[0];
      if (commandType.includes("close")) {
        return "Z";
      }

      const pointMatches = [...commandXml.matchAll(/<a:pt\b[^>]*x="([^"]+)"[^>]*y="([^"]+)"[^>]*\/>/gi)];
      if (commandType.includes("moveto") || commandType.includes("lnto")) {
        const point = pointMatches[0];
        if (!point) {
          return undefined;
        }
        const scaledPoint = scalePoint(point[1], point[2]);
        if (!scaledPoint) {
          return undefined;
        }
        return `${commandType.includes("moveto") ? "M" : "L"}${scaledPoint}`;
      }

      if (commandType.includes("cubicbezto")) {
        if (pointMatches.length < 3) {
          return undefined;
        }
        const scaledPoints = pointMatches
          .slice(0, 3)
          .map((point) => scalePoint(point[1], point[2]));
        if (scaledPoints.some((point) => !point)) {
          return undefined;
        }
        return `C${scaledPoints.join(" ")}`;
      }

      return undefined;
    })
    .filter((command): command is string => Boolean(command));
  if (commands.length === 0) {
    return undefined;
  }

  return commands.join(" ");
}

function ellipsePathData(widthPx: number, heightPx: number): string {
  const safeWidth = Math.max(1, Math.round(widthPx));
  const safeHeight = Math.max(1, Math.round(heightPx));
  const rx = safeWidth / 2;
  const ry = safeHeight / 2;
  return `M${rx} 0 C${safeWidth - rx * 0.45} 0 ${safeWidth} ${ry * 0.45} ${safeWidth} ${ry} C${safeWidth} ${safeHeight - ry * 0.45} ${safeWidth - rx * 0.45} ${safeHeight} ${rx} ${safeHeight} C${rx * 0.45} ${safeHeight} 0 ${safeHeight - ry * 0.45} 0 ${ry} C0 ${ry * 0.45} ${rx * 0.45} 0 ${rx} 0 Z`;
}

function capsulePathData(widthPx: number, heightPx: number): string {
  const safeWidth = Math.max(1, Math.round(widthPx));
  const safeHeight = Math.max(1, Math.round(heightPx));
  if (safeHeight >= safeWidth) {
    const rx = safeWidth / 2;
    return `M${rx} 0 C${safeWidth - rx * 0.45} 0 ${safeWidth} ${rx * 0.45} ${safeWidth} ${rx} L${safeWidth} ${safeHeight - rx} C${safeWidth} ${safeHeight - rx * 0.45} ${safeWidth - rx * 0.45} ${safeHeight} ${rx} ${safeHeight} C${rx * 0.45} ${safeHeight} 0 ${safeHeight - rx * 0.45} 0 ${safeHeight - rx} L0 ${rx} C0 ${rx * 0.45} ${rx * 0.45} 0 ${rx} 0 Z`;
  }

  const ry = safeHeight / 2;
  return `M0 ${ry} C0 ${ry * 0.45} ${ry * 0.45} 0 ${ry} 0 L${safeWidth - ry} 0 C${safeWidth - ry * 0.45} 0 ${safeWidth} ${ry * 0.45} ${safeWidth} ${ry} C${safeWidth} ${safeHeight - ry * 0.45} ${safeWidth - ry * 0.45} ${safeHeight} ${safeWidth - ry} ${safeHeight} L${ry} ${safeHeight} C${ry * 0.45} ${safeHeight} 0 ${safeHeight - ry * 0.45} 0 ${ry} Z`;
}

function drawingShapeHeuristicPathData(
  pathXml: string,
  widthPx: number,
  heightPx: number
): string | undefined {
  const cubicCount = (pathXml.match(/<a:cubicBezTo\b/gi) ?? []).length;
  const lineCount = (pathXml.match(/<a:lnTo\b/gi) ?? []).length;
  if (cubicCount === 0) {
    return undefined;
  }

  if (cubicCount >= 4 && lineCount === 0) {
    return ellipsePathData(widthPx, heightPx);
  }

  if (cubicCount >= 2 && lineCount === 2) {
    return capsulePathData(widthPx, heightPx);
  }

  return undefined;
}

function flowChartDelayPathData(widthPx: number, heightPx: number): string {
  const safeWidth = Math.max(1, Math.round(widthPx));
  const safeHeight = Math.max(1, Math.round(heightPx));
  const radius = Math.max(1, Math.min(Math.round(safeHeight / 2), safeWidth - 1));
  const arcX = safeWidth - radius;
  return `M0 0 H${arcX} A${radius} ${radius} 0 0 1 ${arcX} ${safeHeight} H0 Z`;
}

function renderGroupedPictureSvgElement(
  pictureXml: string,
  childOffsetX: number,
  childOffsetY: number,
  scaleX: number,
  scaleY: number,
  context: ParseContext
): string | undefined {
  const picturePropertiesXml = extractBalancedTagBlocks(pictureXml, "pic:spPr")[0] ?? "";
  const transformXml = extractBalancedTagBlocks(picturePropertiesXml, "a:xfrm")[0] ?? "";
  const offTag = transformXml.match(/<a:off\b[^>]*\/>/i)?.[0] ?? "";
  const extTag = transformXml.match(/<a:ext\b[^>]*\/>/i)?.[0] ?? "";
  const offXPx = (parseIntegerAttribute(offTag, "x") ?? 0) - childOffsetX;
  const offYPx = (parseIntegerAttribute(offTag, "y") ?? 0) - childOffsetY;
  const extXPx = parseIntegerAttribute(extTag, "cx") ?? 0;
  const extYPx = parseIntegerAttribute(extTag, "cy") ?? 0;
  const x = Math.round(offXPx * scaleX);
  const y = Math.round(offYPx * scaleY);
  const widthPx = Math.max(1, Math.round(extXPx * scaleX));
  const heightPx = Math.max(1, Math.round(extYPx * scaleY));
  const relationshipId =
    pictureXml.match(/<a:blip\b[^>]*r:embed="([^"]+)"/i)?.[1] ??
    pictureXml.match(/<a:blip\b[^>]*r:link="([^"]+)"/i)?.[1];
  if (!relationshipId) {
    return undefined;
  }

  const partName = context.relationships.get(relationshipId);
  if (!partName) {
    context.warnings.push(`Missing relationship target for ${relationshipId}`);
    return undefined;
  }

  const binary = context.binaryAssets.get(partName);
  if (!binary) {
    context.warnings.push(`Missing image asset ${partName}`);
    return undefined;
  }

  const mimeType = contentTypeForPart(partName, context.contentTypes) ?? "application/octet-stream";
  const src = `data:${mimeType};base64,${bytesToBase64(binary)}`;
  return `<image href="${src}" x="${x}" y="${y}" width="${widthPx}" height="${heightPx}" preserveAspectRatio="none"/>`;
}

function renderStandaloneWordShapeSvg(
  runXml: string,
  widthPx: number | undefined,
  heightPx: number | undefined,
  context: ParseContext
): string | undefined {
  const groupXml = extractBalancedTagBlocks(runXml, "wpg:wgp")[0];
  if (groupXml) {
    const groupTransformXml = extractBalancedTagBlocks(groupXml, "a:xfrm")[0];
    const childOffsetTag =
      groupTransformXml.match(/<a:chOff\b[^>]*\/?>/i)?.[0] ?? "";
    const childExtentTag =
      groupTransformXml.match(/<a:chExt\b[^>]*\/?>/i)?.[0] ?? "";
    const childOffsetX = parseIntegerAttribute(childOffsetTag, "x") ?? 0;
    const childOffsetY = parseIntegerAttribute(childOffsetTag, "y") ?? 0;
    const childExtentX = Math.max(1, parseIntegerAttribute(childExtentTag, "cx") ?? 1);
    const childExtentY = Math.max(1, parseIntegerAttribute(childExtentTag, "cy") ?? 1);
    const safeWidth = clamp(Math.round(widthPx ?? 320), 8, 2400);
    const safeHeight = clamp(Math.round(heightPx ?? 120), 8, 2400);
    const scaleX = safeWidth / childExtentX;
    const scaleY = safeHeight / childExtentY;
    const pictureElements = extractBalancedTagBlocks(groupXml, "pic:pic")
      .map((pictureXml) =>
        renderGroupedPictureSvgElement(
          pictureXml,
          childOffsetX,
          childOffsetY,
          scaleX,
          scaleY,
          context
        )
      )
      .filter((element): element is string => Boolean(element));
    const shapeElements = extractBalancedTagBlocks(groupXml, "wps:wsp")
      .map((shapeXml, shapeIndex) => {
        const shapePropertiesXml = extractBalancedTagBlocks(shapeXml, "wps:spPr")[0] ?? "";
        const transformXml = extractBalancedTagBlocks(shapePropertiesXml, "a:xfrm")[0];
        const offTag = transformXml.match(/<a:off\b[^>]*\/?>/i)?.[0] ?? "";
        const extTag = transformXml.match(/<a:ext\b[^>]*\/?>/i)?.[0] ?? "";
        const offXPx = (parseIntegerAttribute(offTag, "x") ?? 0) - childOffsetX;
        const offYPx = (parseIntegerAttribute(offTag, "y") ?? 0) - childOffsetY;
        const extXPx = parseIntegerAttribute(extTag, "cx") ?? 0;
        const extYPx = parseIntegerAttribute(extTag, "cy") ?? 0;
        const shapeWidth = Math.max(1, Math.round(extXPx * scaleX));
        const shapeHeight = Math.max(1, Math.round(extYPx * scaleY));
        const x = Math.round(offXPx * scaleX);
        const y = Math.round(offYPx * scaleY);
        const preset = getAttribute(shapePropertiesXml.match(/<a:prstGeom\b[^>]*>/i)?.[0] ?? "", "prst")?.trim();
        const fill = drawingShapeFillMarkup(
          `${shapePropertiesXml}${extractBalancedTagBlocks(shapeXml, "wps:style")[0] ?? ""}`,
          context.styleSheet.themeColors,
          `group-fill-${shapeIndex}`
        );
        const stroke = drawingShapeStrokeMarkup(
          `${shapePropertiesXml}${extractBalancedTagBlocks(shapeXml, "wps:style")[0] ?? ""}`,
          context.styleSheet.themeColors
        );
        const textBoxParagraphs = parseTextBoxParagraphs(shapeXml, context);
        const textBoxLayout = parseTextBoxLayout(shapeXml);
        const textBoxSvg =
          textBoxParagraphs.length > 0
            ? renderTextBoxSvg(
                textBoxParagraphs,
                shapeWidth,
                shapeHeight,
                textBoxLayout
              )
            : undefined;
        const positionedTextBoxSvg = textBoxSvg
          ? textBoxSvg.replace(
              /^<svg\b/i,
              `<svg x="${x}" y="${y}"`
            )
          : "";

        if (preset === "line") {
          return `<line x1="${x}" y1="${y}" x2="${x + shapeWidth}" y2="${y + shapeHeight}" ${stroke} fill="none"/>`;
        }

        const pathXml = extractBalancedTagBlocks(shapePropertiesXml, "a:path")[0];
        const directPathData = pathXml ? drawingShapePathData(pathXml, shapeWidth, shapeHeight) : undefined;
        const pathData =
          pathXml &&
          /<a:cubicBezTo\b/i.test(pathXml) &&
          (!directPathData || !directPathData.includes("C"))
            ? drawingShapeHeuristicPathData(pathXml, shapeWidth, shapeHeight) ?? directPathData
            : directPathData;
        if (pathData) {
          return `${fill.defs.join("")}<path d="${pathData}" transform="translate(${x} ${y})" ${fill.fillAttribute} ${stroke}/>${positionedTextBoxSvg}`;
        }

        if (preset === "flowChartDelay") {
          return `${fill.defs.join("")}<path d="${flowChartDelayPathData(
            shapeWidth,
            shapeHeight
          )}" transform="translate(${x} ${y})" ${fill.fillAttribute} ${stroke}/>${positionedTextBoxSvg}`;
        }

        return `${fill.defs.join("")}<rect x="${x}" y="${y}" width="${shapeWidth}" height="${shapeHeight}" ${fill.fillAttribute} ${stroke}/>${positionedTextBoxSvg}`;
      })
      .filter((element): element is string => Boolean(element));

    const elements = [...pictureElements, ...shapeElements];
    if (elements.length > 0) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}">${elements.join(
        ""
      )}</svg>`;
    }
  }

  const shapeXml = extractBalancedTagBlocks(runXml, "wps:wsp")[0];
  if (!shapeXml || /<w:txbxContent\b/i.test(shapeXml)) {
    return undefined;
  }

  const shapePropertiesXml = extractBalancedTagBlocks(shapeXml, "wps:spPr")[0] ?? "";
  if (!shapePropertiesXml) {
    return undefined;
  }

  const safeWidth = clamp(Math.round(widthPx ?? 320), 8, 2400);
  const safeHeight = clamp(Math.round(heightPx ?? 240), 8, 2400);
  const rotationRaw = Number(getAttribute(extractBalancedTagBlocks(shapePropertiesXml, "a:xfrm")[0] ?? "", "rot"));
  const rotationDegrees = Number.isFinite(rotationRaw) ? rotationRaw / 60000 : undefined;
  const rotationLayout = svgRotationLayout(rotationDegrees, safeWidth, safeHeight);
  const preset = getAttribute(shapePropertiesXml.match(/<a:prstGeom\b[^>]*>/i)?.[0] ?? "", "prst")?.trim();
  const fill = drawingShapeFillMarkup(
    `${shapePropertiesXml}${extractBalancedTagBlocks(shapeXml, "wps:style")[0] ?? ""}`,
    context.styleSheet.themeColors,
    "shape-fill"
  );
  const stroke = drawingShapeStrokeMarkup(
    `${shapePropertiesXml}${extractBalancedTagBlocks(shapeXml, "wps:style")[0] ?? ""}`,
    context.styleSheet.themeColors
  );
  const pathXml = extractBalancedTagBlocks(shapePropertiesXml, "a:path")[0];
  const directPathData = pathXml ? drawingShapePathData(pathXml, safeWidth, safeHeight) : undefined;
  const pathData =
    pathXml &&
    /<a:cubicBezTo\b/i.test(pathXml) &&
    (!directPathData || !directPathData.includes("C"))
      ? drawingShapeHeuristicPathData(pathXml, safeWidth, safeHeight) ?? directPathData
      : directPathData;
  let body = "";

  if (preset === "line") {
    body = `<line x1="0" y1="${Math.round(safeHeight / 2)}" x2="${safeWidth}" y2="${Math.round(
      safeHeight / 2
    )}" ${stroke} fill="none"${rotationLayout.transformAttribute}/>`;
  } else if (pathData) {
    body = `<path d="${pathData}" ${fill.fillAttribute} ${stroke}${rotationLayout.transformAttribute}/>`;
  } else if (preset === "flowChartDelay") {
    body = `<path d="${flowChartDelayPathData(
      safeWidth,
      safeHeight
    )}" ${fill.fillAttribute} ${stroke}${rotationLayout.transformAttribute}/>`;
  } else {
    body = `<rect x="0" y="0" width="${safeWidth}" height="${safeHeight}" ${fill.fillAttribute} ${stroke}${rotationLayout.transformAttribute}/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${rotationLayout.viewBoxWidthPx} ${rotationLayout.viewBoxHeightPx}"${
    rotationLayout.preserveAspectRatio ? ` preserveAspectRatio="${rotationLayout.preserveAspectRatio}"` : ""
  }><defs>${fill.defs.join(
    ""
  )}</defs>${body}</svg>`;
}

function getAttribute(tagXml: string, attribute: string): string | undefined {
  const escapedAttribute = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tagXml.match(new RegExp(`${escapedAttribute}=(?:"([^"]+)"|'([^']+)')`, "i"));
  return match?.[1] ?? match?.[2];
}

function parseIntegerAttribute(tagXml: string, attribute: string): number | undefined {
  const raw = getAttribute(tagXml, attribute);
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.round(parsed);
}

function parseParagraphNumberingFromXml(xml: string): ParagraphNumbering | undefined {
  if (!xml) {
    return undefined;
  }

  const numberingXml = extractBalancedTagBlocks(xml, "w:numPr")[0] ?? xml.match(/<w:numPr\b[^>]*\/>/i)?.[0] ?? "";
  if (!numberingXml) {
    return undefined;
  }

  const numIdRaw = numberingXml.match(/<w:numId\b[^>]*w:val="(-?\d+)"/i)?.[1];
  if (!numIdRaw) {
    return undefined;
  }

  const numId = Number(numIdRaw);
  if (!Number.isFinite(numId) || numId <= 0) {
    return undefined;
  }

  const ilvlRaw = numberingXml.match(/<w:ilvl\b[^>]*w:val="(-?\d+)"/i)?.[1];
  const ilvlValue = ilvlRaw ? Number(ilvlRaw) : 0;

  return {
    numId: Math.round(numId),
    ilvl: Number.isFinite(ilvlValue) ? Math.max(0, Math.round(ilvlValue)) : 0
  };
}

function parseParagraphSpacingFromXml(xml: string): ParagraphSpacing | undefined {
  if (!xml) {
    return undefined;
  }

  const spacingTag = xml.match(/<w:spacing\b[^>]*\/?>/i)?.[0];
  if (!spacingTag) {
    return undefined;
  }

  const lineRuleRaw = getAttribute(spacingTag, "w:lineRule")?.toLowerCase();
  const lineRule =
    lineRuleRaw === "auto" || lineRuleRaw === "exact" || lineRuleRaw === "atleast"
      ? (lineRuleRaw === "atleast" ? "atLeast" : lineRuleRaw)
      : undefined;

  const spacing: ParagraphSpacing = {
    beforeTwips: parseIntegerAttribute(spacingTag, "w:before"),
    afterTwips: parseIntegerAttribute(spacingTag, "w:after"),
    lineTwips: parseIntegerAttribute(spacingTag, "w:line"),
    lineRule
  };

  if (
    spacing.beforeTwips === undefined &&
    spacing.afterTwips === undefined &&
    spacing.lineTwips === undefined &&
    spacing.lineRule === undefined
  ) {
    return undefined;
  }

  return spacing;
}

function parseParagraphIndentFromXml(xml: string): ParagraphIndent | undefined {
  if (!xml) {
    return undefined;
  }

  const indentTag = xml.match(/<w:ind\b[^>]*\/?>/i)?.[0];
  if (!indentTag) {
    return undefined;
  }

  const indent: ParagraphIndent = {
    leftTwips: parseIntegerAttribute(indentTag, "w:left"),
    rightTwips: parseIntegerAttribute(indentTag, "w:right"),
    firstLineTwips: parseIntegerAttribute(indentTag, "w:firstLine"),
    hangingTwips: parseIntegerAttribute(indentTag, "w:hanging")
  };

  if (
    indent.leftTwips === undefined &&
    indent.rightTwips === undefined &&
    indent.firstLineTwips === undefined &&
    indent.hangingTwips === undefined
  ) {
    return undefined;
  }

  return indent;
}

function normalizeTabStopAlignment(
  value?: string
): ParagraphTabStop["alignment"] | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase();
  if (
    normalized === "left" ||
    normalized === "center" ||
    normalized === "right" ||
    normalized === "decimal" ||
    normalized === "bar"
  ) {
    return normalized;
  }

  return undefined;
}

function normalizeTabStopLeader(
  value?: string
): ParagraphTabStop["leader"] | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase();
  if (
    normalized === "none" ||
    normalized === "dot" ||
    normalized === "hyphen" ||
    normalized === "underscore" ||
    normalized === "middleDot"
  ) {
    return normalized as ParagraphTabStop["leader"];
  }

  return undefined;
}

function parseParagraphTabStopsFromXml(xml: string): ParagraphTabStop[] {
  if (!xml) {
    return [];
  }

  const tabsTag = xml.match(/<w:tabs\b[^>]*>[\s\S]*?<\/w:tabs>|<w:tabs\b[^>]*\/>/i)?.[0];
  const tabsXml = tabsTag ?? "";
  if (!tabsXml) {
    return [];
  }

  const tabStops: ParagraphTabStop[] = [];
  for (const match of tabsXml.matchAll(/<w:tab\b[^>]*\/>/gi)) {
    const tabTag = match[0];
    if (!tabTag) {
      continue;
    }

    const alignment = normalizeTabStopAlignment(getAttribute(tabTag, "w:val"));
    const leader = normalizeTabStopLeader(getAttribute(tabTag, "w:leader"));
    const positionTwips = parseIntegerAttribute(tabTag, "w:pos");
    if (positionTwips === undefined) {
      continue;
    }

    tabStops.push({
      alignment: alignment ?? "left",
      leader: leader ?? "none",
      positionTwips
    });
  }

  return tabStops.sort((left, right) => (left.positionTwips ?? 0) - (right.positionTwips ?? 0));
}

function parseParagraphShadingFromXml(xml: string): string | undefined {
  if (!xml) {
    return undefined;
  }

  const shadingTag = xml.match(/<w:shd\b[^>]*\/?>/i)?.[0];
  if (!shadingTag) {
    return undefined;
  }

  const fill = getAttribute(shadingTag, "w:fill");
  return normalizeHexColor(fill);
}

function parseOnOffValue(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return normalized !== "0" && normalized !== "false" && normalized !== "none" && normalized !== "off";
}

function parseParagraphBorderStyle(tagXml: string | undefined): ParagraphBorderStyle | undefined {
  if (!tagXml) {
    return undefined;
  }

  const type = getAttribute(tagXml, "w:val")?.trim().toLowerCase();
  if (!type) {
    return undefined;
  }

  const sizeEighthPt = parseIntegerAttribute(tagXml, "w:sz");
  const spacePt = parseIntegerAttribute(tagXml, "w:space");
  const rawColor = getAttribute(tagXml, "w:color");
  const color =
    rawColor?.trim().toLowerCase() === "auto"
      ? "#000000"
      : normalizeHexColor(rawColor);
  const frame = parseOnOffValue(getAttribute(tagXml, "w:frame"));
  const shadow = parseOnOffValue(getAttribute(tagXml, "w:shadow"));

  return {
    type,
    ...(sizeEighthPt !== undefined && sizeEighthPt >= 0 ? { sizeEighthPt } : undefined),
    ...(spacePt !== undefined && spacePt >= 0 ? { spacePt } : undefined),
    ...(color ? { color } : undefined),
    ...(frame !== undefined ? { frame } : undefined),
    ...(shadow !== undefined ? { shadow } : undefined)
  };
}

function parseTextRunBorderStyle(tagXml: string | undefined): TextRunBorderStyle | undefined {
  if (!tagXml) {
    return undefined;
  }

  const type = getAttribute(tagXml, "w:val")?.trim().toLowerCase();
  if (!type) {
    return undefined;
  }

  const sizeEighthPt = parseIntegerAttribute(tagXml, "w:sz");
  const spacePt = parseIntegerAttribute(tagXml, "w:space");
  const rawColor = getAttribute(tagXml, "w:color");
  const color =
    rawColor?.trim().toLowerCase() === "auto"
      ? undefined
      : normalizeHexColor(rawColor);
  const frame = parseOnOffValue(getAttribute(tagXml, "w:frame"));
  const shadow = parseOnOffValue(getAttribute(tagXml, "w:shadow"));

  return {
    type,
    ...(sizeEighthPt !== undefined && sizeEighthPt >= 0 ? { sizeEighthPt } : undefined),
    ...(spacePt !== undefined && spacePt >= 0 ? { spacePt } : undefined),
    ...(color ? { color } : undefined),
    ...(frame !== undefined ? { frame } : undefined),
    ...(shadow !== undefined ? { shadow } : undefined)
  };
}

function parseParagraphBorderSetFromXml(xml: string): ParagraphBorderSet | undefined {
  if (!xml) {
    return undefined;
  }

  const paragraphBorderXml =
    extractBalancedTagBlocks(xml, "w:pBdr")[0] ?? xml.match(/<w:pBdr\b[^>]*\/?>/i)?.[0] ?? "";
  if (!paragraphBorderXml) {
    return undefined;
  }

  const top = parseParagraphBorderStyle(paragraphBorderXml.match(/<w:top\b[^>]*\/?>/i)?.[0]);
  const right = parseParagraphBorderStyle(paragraphBorderXml.match(/<w:right\b[^>]*\/?>/i)?.[0]);
  const bottom = parseParagraphBorderStyle(paragraphBorderXml.match(/<w:bottom\b[^>]*\/?>/i)?.[0]);
  const left = parseParagraphBorderStyle(paragraphBorderXml.match(/<w:left\b[^>]*\/?>/i)?.[0]);
  const between = parseParagraphBorderStyle(paragraphBorderXml.match(/<w:between\b[^>]*\/?>/i)?.[0]);
  const bar = parseParagraphBorderStyle(paragraphBorderXml.match(/<w:bar\b[^>]*\/?>/i)?.[0]);

  if (!top && !right && !bottom && !left && !between && !bar) {
    return undefined;
  }

  return {
    top,
    right,
    bottom,
    left,
    between,
    bar
  };
}

function parseTableBoxSpacing(xml: string): TableBoxSpacing | undefined {
  const topMatch = xml.match(/<w:top\b[^>]*>/i)?.[0];
  const rightMatch = xml.match(/<w:right\b[^>]*>/i)?.[0];
  const bottomMatch = xml.match(/<w:bottom\b[^>]*>/i)?.[0];
  const leftMatch = xml.match(/<w:left\b[^>]*>/i)?.[0];

  const spacing: TableBoxSpacing = {
    topTwips: topMatch ? parseIntegerAttribute(topMatch, "w:w") : undefined,
    rightTwips: rightMatch ? parseIntegerAttribute(rightMatch, "w:w") : undefined,
    bottomTwips: bottomMatch ? parseIntegerAttribute(bottomMatch, "w:w") : undefined,
    leftTwips: leftMatch ? parseIntegerAttribute(leftMatch, "w:w") : undefined
  };

  if (
    spacing.topTwips === undefined &&
    spacing.rightTwips === undefined &&
    spacing.bottomTwips === undefined &&
    spacing.leftTwips === undefined
  ) {
    return undefined;
  }

  return spacing;
}

function parseTableBorderStyle(tagXml: string | undefined): TableBorderStyle | undefined {
  if (!tagXml) {
    return undefined;
  }

  const type = getAttribute(tagXml, "w:val")?.trim().toLowerCase();
  if (!type) {
    return undefined;
  }

  const sizeEighthPt = parseIntegerAttribute(tagXml, "w:sz");
  const rawColor = getAttribute(tagXml, "w:color");
  const color =
    rawColor?.trim().toLowerCase() === "auto"
      ? "#000000"
      : normalizeHexColor(rawColor);

  return {
    type,
    ...(sizeEighthPt !== undefined && sizeEighthPt >= 0 ? { sizeEighthPt } : undefined),
    ...(color ? { color } : undefined)
  };
}

function parseTableBorderSet(xml: string): TableBorderSet | undefined {
  const top = parseTableBorderStyle(xml.match(/<w:top\b[^>]*\/?>/i)?.[0]);
  const right = parseTableBorderStyle(xml.match(/<w:right\b[^>]*\/?>/i)?.[0]);
  const bottom = parseTableBorderStyle(xml.match(/<w:bottom\b[^>]*\/?>/i)?.[0]);
  const left = parseTableBorderStyle(xml.match(/<w:left\b[^>]*\/?>/i)?.[0]);
  const insideH = parseTableBorderStyle(xml.match(/<w:insideH\b[^>]*\/?>/i)?.[0]);
  const insideV = parseTableBorderStyle(xml.match(/<w:insideV\b[^>]*\/?>/i)?.[0]);
  const tl2br = parseTableBorderStyle(xml.match(/<w:tl2br\b[^>]*\/?>/i)?.[0]);
  const tr2bl = parseTableBorderStyle(xml.match(/<w:tr2bl\b[^>]*\/?>/i)?.[0]);

  if (!top && !right && !bottom && !left && !insideH && !insideV && !tl2br && !tr2bl) {
    return undefined;
  }

  return {
    top,
    right,
    bottom,
    left,
    insideH,
    insideV,
    tl2br,
    tr2bl
  };
}

function hasTableProperties(properties: ParsedTableProperties | undefined): boolean {
  if (!properties) {
    return false;
  }

  return (
    properties.widthTwips !== undefined ||
    properties.indentTwips !== undefined ||
    properties.layout !== undefined ||
    properties.cellSpacingTwips !== undefined ||
    properties.floating !== undefined ||
    properties.cellMarginTwips !== undefined
  );
}

function parseTableStylePropertiesFromXml(tablePropertiesXml: string | undefined): ParsedTableProperties | undefined {
  if (!tablePropertiesXml) {
    return undefined;
  }

  const tableWidthTag = tablePropertiesXml.match(/<w:tblW\b[^>]*>/i)?.[0];
  const tableWidthType = tableWidthTag ? getAttribute(tableWidthTag, "w:type")?.toLowerCase() : undefined;
  const tableWidthRaw = tableWidthTag ? parseIntegerAttribute(tableWidthTag, "w:w") : undefined;
  const widthTwips =
    tableWidthType === "dxa" && tableWidthRaw !== undefined && tableWidthRaw > 0 ? tableWidthRaw : undefined;

  const tableIndentTag = tablePropertiesXml.match(/<w:tblInd\b[^>]*>/i)?.[0];
  const tableIndentType = tableIndentTag ? getAttribute(tableIndentTag, "w:type")?.toLowerCase() : undefined;
  const tableIndentRaw = tableIndentTag ? parseIntegerAttribute(tableIndentTag, "w:w") : undefined;
  const indentTwips =
    tableIndentType === "dxa" && tableIndentRaw !== undefined && tableIndentRaw !== 0
      ? tableIndentRaw
      : undefined;

  const tableLayoutTag = tablePropertiesXml.match(/<w:tblLayout\b[^>]*>/i)?.[0];
  const tableLayoutRaw = tableLayoutTag ? getAttribute(tableLayoutTag, "w:type")?.toLowerCase() : undefined;
  const layout = tableLayoutRaw === "fixed" || tableLayoutRaw === "autofit" ? tableLayoutRaw : undefined;

  const tableCellSpacingTag = tablePropertiesXml.match(/<w:tblCellSpacing\b[^>]*\/?>/i)?.[0];
  const tableCellSpacingType = tableCellSpacingTag
    ? getAttribute(tableCellSpacingTag, "w:type")?.toLowerCase()
    : undefined;
  const tableCellSpacingRaw = tableCellSpacingTag
    ? parseIntegerAttribute(tableCellSpacingTag, "w:w")
    : undefined;
  const cellSpacingTwips =
    tableCellSpacingType === "dxa" &&
    tableCellSpacingRaw !== undefined &&
    tableCellSpacingRaw >= 0
      ? tableCellSpacingRaw
      : undefined;

  const tableCellMarginXml = tablePropertiesXml.match(/<w:tblCellMar\b[\s\S]*?<\/w:tblCellMar>|<w:tblCellMar\b[^>]*\/>/i)?.[0];
  const cellMarginTwips = tableCellMarginXml ? parseTableBoxSpacing(tableCellMarginXml) : undefined;
  const floating = parseFloatingTableStyle(tablePropertiesXml);

  return {
    ...(widthTwips !== undefined ? { widthTwips } : undefined),
    ...(indentTwips !== undefined ? { indentTwips } : undefined),
    ...(layout !== undefined ? { layout } : undefined),
    ...(cellSpacingTwips !== undefined ? { cellSpacingTwips } : undefined),
    ...(cellMarginTwips !== undefined ? { cellMarginTwips } : undefined),
    ...(floating !== undefined ? { floating } : undefined)
  };
}

function mergeTableStyleProperties(
  inherited: ParsedTableProperties | undefined,
  direct: ParsedTableProperties | undefined
): ParsedTableProperties | undefined {
  if (!inherited && !direct) {
    return undefined;
  }

  const merged: ParsedTableProperties = {
    widthTwips: direct?.widthTwips ?? inherited?.widthTwips,
    indentTwips: direct?.indentTwips ?? inherited?.indentTwips,
    layout: direct?.layout ?? inherited?.layout,
    cellSpacingTwips: direct?.cellSpacingTwips ?? inherited?.cellSpacingTwips,
    floating: direct?.floating ?? inherited?.floating,
    cellMarginTwips:
      direct?.cellMarginTwips !== undefined
        ? { ...direct.cellMarginTwips }
        : inherited?.cellMarginTwips !== undefined
          ? { ...inherited.cellMarginTwips }
          : undefined
  };

  if (!hasTableProperties(merged)) {
    return undefined;
  }

  return merged;
}

const DEFAULT_TABLE_LOOK: ParsedTableLook = {
  firstRow: false,
  lastRow: false,
  firstCol: false,
  lastCol: false,
  noHBand: true,
  noVBand: true,
  rowBandSize: 1,
  colBandSize: 1
};

function mergeTableLook(
  direct: ParsedTableLook | undefined,
  inherited: ParsedTableLook | undefined
): ParsedTableLook {
  return {
    ...DEFAULT_TABLE_LOOK,
    ...(inherited ?? {}),
    ...(direct ?? {})
  };
}

const TABLE_CONDITIONAL_STYLE_TYPES: TableConditionalStyleType[] = [
  "wholeTable",
  "firstRow",
  "lastRow",
  "firstCol",
  "lastCol",
  "band1Horz",
  "band2Horz",
  "band1Vert",
  "band2Vert",
  "nwCell",
  "neCell",
  "swCell",
  "seCell"
];

function normalizeTableConditionalStyleType(value?: string): TableConditionalStyleType | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  switch (normalized) {
    case "wholtable":
    case "wholetable":
      return "wholeTable";
    case "firstrow":
      return "firstRow";
    case "lastrow":
      return "lastRow";
    case "firstcol":
      return "firstCol";
    case "lastcol":
      return "lastCol";
    case "band1horz":
      return "band1Horz";
    case "band2horz":
      return "band2Horz";
    case "band1vert":
      return "band1Vert";
    case "band2vert":
      return "band2Vert";
    case "nwcell":
      return "nwCell";
    case "necell":
      return "neCell";
    case "swcell":
      return "swCell";
    case "secell":
      return "seCell";
    default:
      return undefined;
  }
}

function parseTableConditionalStyleFromXml(
  xml: string,
  themeFonts: ThemeFontMap
): ParsedTableStyleCondition | undefined {
  if (!xml) {
    return undefined;
  }

  const tablePropertiesXml = extractBalancedTagBlocks(xml, "w:tblPr")[0] ?? "";
  const paragraphPropertiesXml = extractBalancedTagBlocks(xml, "w:pPr")[0] ?? "";
  const rowPropertiesXml = extractBalancedTagBlocks(xml, "w:trPr")[0] ?? "";
  const cellPropertiesXml = extractBalancedTagBlocks(xml, "w:tcPr")[0] ?? "";
  const runPropertiesXml = resolveStylePropertiesBlock(xml, "w:rPr");
  const tableLook = parseTableLook(tablePropertiesXml);
  const paragraphAlignmentMatch = paragraphPropertiesXml.match(/<w:jc\b[^>]*w:val="([^"]+)"/i);
  const paragraphAlign = normalizeAlignment(paragraphAlignmentMatch?.[1]);

  const rowShadingTag = rowPropertiesXml.match(/<w:shd\b[^>]*\/?>/i)?.[0];
  const cellShadingTag =
    cellPropertiesXml.match(/<w:shd\b[^>]*\/?>/i)?.[0] ??
    tablePropertiesXml.match(/<w:shd\b[^>]*\/?>/i)?.[0];
  const rowBackgroundColor = normalizeHexColor(rowShadingTag ? getAttribute(rowShadingTag, "w:fill") : undefined);
  const cellBackgroundColor = normalizeHexColor(
    cellShadingTag ? getAttribute(cellShadingTag, "w:fill") : undefined
  );
  const runStyle = parseTextStyleFromXml(runPropertiesXml, themeFonts);
  const tableBordersXml = tablePropertiesXml.match(
    /<w:tblBorders\b[\s\S]*?<\/w:tblBorders>|<w:tblBorders\b[^>]*\/>/i
  )?.[0];
  const cellBordersXml = cellPropertiesXml.match(
    /<w:tcBorders\b[\s\S]*?<\/w:tcBorders>|<w:tcBorders\b[^>]*\/>/i
  )?.[0];
  const tableBorders = tableBordersXml ? parseTableBorderSet(tableBordersXml) : undefined;
  const cellBorders = cellBordersXml ? parseTableBorderSet(cellBordersXml) : undefined;
  const tableProperties = parseTableStylePropertiesFromXml(tablePropertiesXml);

  if (
    rowBackgroundColor === undefined &&
    cellBackgroundColor === undefined &&
    paragraphAlign === undefined &&
    runStyle === undefined &&
    tableBorders === undefined &&
    cellBorders === undefined &&
    !hasTableProperties(tableProperties) &&
    !tableLook
  ) {
    return undefined;
  }

  return {
    rowBackgroundColor,
    cellBackgroundColor,
    paragraphAlign,
    runStyle,
    tableBorders,
    cellBorders,
    tableProperties,
    tableLook
  };
}

function mergeTableBorderSets(
  inherited: TableBorderSet | undefined,
  direct: TableBorderSet | undefined
): TableBorderSet | undefined {
  if (!inherited && !direct) {
    return undefined;
  }

  const merged: TableBorderSet = {
    top: direct?.top ?? inherited?.top,
    right: direct?.right ?? inherited?.right,
    bottom: direct?.bottom ?? inherited?.bottom,
    left: direct?.left ?? inherited?.left,
    insideH: direct?.insideH ?? inherited?.insideH,
    insideV: direct?.insideV ?? inherited?.insideV,
    tl2br: direct?.tl2br ?? inherited?.tl2br,
    tr2bl: direct?.tr2bl ?? inherited?.tr2bl
  };

  if (
    !merged.top &&
    !merged.right &&
    !merged.bottom &&
    !merged.left &&
    !merged.insideH &&
    !merged.insideV &&
    !merged.tl2br &&
    !merged.tr2bl
  ) {
    return undefined;
  }

  return merged;
}

function mergeTableConditionalStyle(
  inherited: ParsedTableStyleCondition | undefined,
  direct: ParsedTableStyleCondition | undefined
): ParsedTableStyleCondition | undefined {
  if (!inherited && !direct) {
    return undefined;
  }

  const merged: ParsedTableStyleCondition = {
    rowBackgroundColor: direct?.rowBackgroundColor ?? inherited?.rowBackgroundColor,
    cellBackgroundColor: direct?.cellBackgroundColor ?? inherited?.cellBackgroundColor,
    paragraphAlign: direct?.paragraphAlign ?? inherited?.paragraphAlign,
    runStyle: mergeTextStyles(inherited?.runStyle, direct?.runStyle),
    tableBorders: mergeTableBorderSets(inherited?.tableBorders, direct?.tableBorders),
    cellBorders: mergeTableBorderSets(inherited?.cellBorders, direct?.cellBorders),
    tableProperties: mergeTableStyleProperties(inherited?.tableProperties, direct?.tableProperties),
    tableLook: mergeTableLook(direct?.tableLook, inherited?.tableLook)
  };

  if (
    merged.rowBackgroundColor === undefined &&
    merged.cellBackgroundColor === undefined &&
    merged.paragraphAlign === undefined &&
    merged.runStyle === undefined &&
    merged.tableBorders === undefined &&
    merged.cellBorders === undefined &&
    merged.tableProperties === undefined &&
    merged.tableLook === undefined
  ) {
    return undefined;
  }

  return merged;
}

const EMPTY_STYLE_SHEET: ParsedStyleSheet = {
  paragraphStyles: [],
  paragraphStyleById: new Map(),
  runStyleById: new Map(),
  tableStyleById: new Map(),
  themeColors: {},
  themeFonts: {}
};

function mergeTextStyles(...styles: Array<TextStyle | undefined>): TextStyle | undefined {
  const merged: TextStyle = {};

  for (const style of styles) {
    if (!style) {
      continue;
    }

    if (style.bold !== undefined) {
      merged.bold = style.bold;
    }
    if (style.italic !== undefined) {
      merged.italic = style.italic;
    }
    if (style.underline !== undefined) {
      merged.underline = style.underline;
    }
    if (style.strike !== undefined) {
      merged.strike = style.strike;
    }
    if (style.color !== undefined) {
      merged.color = style.color;
    }
    if (style.highlight !== undefined) {
      merged.highlight = style.highlight;
    }
    if (style.backgroundColor !== undefined) {
      merged.backgroundColor = style.backgroundColor;
    }
    if (style.fontSizePt !== undefined) {
      merged.fontSizePt = style.fontSizePt;
    }
    if (style.fontFamily !== undefined) {
      merged.fontFamily = style.fontFamily;
    }
    if (style.characterSpacingTwips !== undefined) {
      merged.characterSpacingTwips = style.characterSpacingTwips;
    }
    if (style.verticalAlign !== undefined) {
      merged.verticalAlign = style.verticalAlign;
    }
    if (style.runBorder !== undefined) {
      merged.runBorder = { ...style.runBorder };
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mergeParagraphSpacing(
  inherited: ParagraphSpacing | undefined,
  direct: ParagraphSpacing | undefined
): ParagraphSpacing | undefined {
  if (!inherited && !direct) {
    return undefined;
  }

  const merged: ParagraphSpacing = {
    beforeTwips: direct?.beforeTwips ?? inherited?.beforeTwips,
    afterTwips: direct?.afterTwips ?? inherited?.afterTwips,
    lineTwips: direct?.lineTwips ?? inherited?.lineTwips,
    lineRule: direct?.lineRule ?? inherited?.lineRule
  };

  if (
    merged.beforeTwips === undefined &&
    merged.afterTwips === undefined &&
    merged.lineTwips === undefined &&
    merged.lineRule === undefined
  ) {
    return undefined;
  }

  return merged;
}

function mergeParagraphIndent(
  inherited: ParagraphIndent | undefined,
  direct: ParagraphIndent | undefined
): ParagraphIndent | undefined {
  if (!inherited && !direct) {
    return undefined;
  }

  const merged: ParagraphIndent = {
    leftTwips: direct?.leftTwips ?? inherited?.leftTwips,
    rightTwips: direct?.rightTwips ?? inherited?.rightTwips,
    firstLineTwips: direct?.firstLineTwips ?? inherited?.firstLineTwips,
    hangingTwips: direct?.hangingTwips ?? inherited?.hangingTwips
  };

  if (
    merged.leftTwips === undefined &&
    merged.rightTwips === undefined &&
    merged.firstLineTwips === undefined &&
    merged.hangingTwips === undefined
  ) {
    return undefined;
  }

  return merged;
}

function mergeParagraphBackgroundColor(
  inherited: string | undefined,
  direct: string | undefined
): string | undefined {
  return direct ?? inherited;
}

function mergeParagraphBorderStyle(
  inherited: ParagraphBorderStyle | undefined,
  direct: ParagraphBorderStyle | undefined
): ParagraphBorderStyle | undefined {
  if (!inherited && !direct) {
    return undefined;
  }

  const type = direct?.type ?? inherited?.type;
  if (!type) {
    return undefined;
  }

  return {
    type,
    color: direct?.color ?? inherited?.color,
    sizeEighthPt: direct?.sizeEighthPt ?? inherited?.sizeEighthPt,
    spacePt: direct?.spacePt ?? inherited?.spacePt,
    frame: direct?.frame ?? inherited?.frame,
    shadow: direct?.shadow ?? inherited?.shadow
  };
}

function mergeParagraphBorderSets(
  inherited: ParagraphBorderSet | undefined,
  direct: ParagraphBorderSet | undefined
): ParagraphBorderSet | undefined {
  if (!inherited && !direct) {
    return undefined;
  }

  const merged: ParagraphBorderSet = {
    top: mergeParagraphBorderStyle(inherited?.top, direct?.top),
    right: mergeParagraphBorderStyle(inherited?.right, direct?.right),
    bottom: mergeParagraphBorderStyle(inherited?.bottom, direct?.bottom),
    left: mergeParagraphBorderStyle(inherited?.left, direct?.left),
    between: mergeParagraphBorderStyle(inherited?.between, direct?.between),
    bar: mergeParagraphBorderStyle(inherited?.bar, direct?.bar)
  };

  if (!merged.top && !merged.right && !merged.bottom && !merged.left && !merged.between && !merged.bar) {
    return undefined;
  }

  return merged;
}

function mergeParagraphTabStops(
  inherited: ParagraphTabStop[] | undefined,
  direct: ParagraphTabStop[] | undefined
): ParagraphTabStop[] | undefined {
  if (!inherited && !direct) {
    return undefined;
  }

  const combined: ParagraphTabStop[] = [];
  const byPosition = new Map<number, ParagraphTabStop>();

  for (const stop of inherited ?? []) {
    if (stop.positionTwips === undefined) {
      continue;
    }
    byPosition.set(stop.positionTwips, stop);
  }

  for (const stop of direct ?? []) {
    if (stop.positionTwips === undefined) {
      continue;
    }
    byPosition.set(stop.positionTwips, stop);
  }

  for (const stop of byPosition.values()) {
    combined.push(stop);
  }

  return combined.length > 0
    ? combined.sort((left, right) => (left.positionTwips ?? 0) - (right.positionTwips ?? 0))
    : undefined;
}

function mergeParagraphBoolean(
  inherited: boolean | undefined,
  direct: boolean | undefined
): boolean | undefined {
  if (direct !== undefined) {
    return direct;
  }

  return inherited;
}

function parseParagraphDropCapFromXml(
  paragraphPropertiesXml: string
): NonNullable<ParagraphStyle["dropCap"]> | undefined {
  const framePrTag = paragraphPropertiesXml.match(/<w:framePr\b[^>]*\/?>/i)?.[0] ?? "";
  if (!framePrTag) {
    return undefined;
  }

  const dropCapRaw = getAttribute(framePrTag, "w:dropCap")?.trim().toLowerCase();
  if (dropCapRaw !== "drop" && dropCapRaw !== "margin") {
    return undefined;
  }

  const lines = parseIntegerAttribute(framePrTag, "w:lines");
  const wrap = getAttribute(framePrTag, "w:wrap")?.trim();
  const horizontalAnchor = getAttribute(framePrTag, "w:hAnchor")?.trim();
  const verticalAnchor = getAttribute(framePrTag, "w:vAnchor")?.trim();
  const xTwips = parseIntegerAttribute(framePrTag, "w:x");
  const yTwips = parseIntegerAttribute(framePrTag, "w:y");
  const horizontalSpaceTwips = parseIntegerAttribute(framePrTag, "w:hSpace");
  const verticalSpaceTwips = parseIntegerAttribute(framePrTag, "w:vSpace");

  return {
    type: dropCapRaw,
    ...(Number.isFinite(lines) && (lines as number) > 0
      ? { lines: Math.round(lines as number) }
      : undefined),
    ...(wrap ? { wrap } : undefined),
    ...(horizontalAnchor ? { horizontalAnchor } : undefined),
    ...(verticalAnchor ? { verticalAnchor } : undefined),
    ...(xTwips !== undefined ? { xTwips } : undefined),
    ...(yTwips !== undefined ? { yTwips } : undefined),
    ...(horizontalSpaceTwips !== undefined ? { horizontalSpaceTwips } : undefined),
    ...(verticalSpaceTwips !== undefined ? { verticalSpaceTwips } : undefined)
  };
}

function resolveThemeFont(themeToken: string | undefined, themeFonts: ThemeFontMap): string | undefined {
  if (!themeToken) {
    return undefined;
  }

  const normalized = themeToken.toLowerCase();
  if (normalized.startsWith("major")) {
    if (normalized.includes("eastasia")) {
      return themeFonts.majorEastAsia ?? themeFonts.majorLatin;
    }
    if (normalized.includes("bidi") || normalized.includes("cs")) {
      return themeFonts.majorComplexScript ?? themeFonts.majorLatin;
    }
    return themeFonts.majorLatin;
  }
  if (normalized.startsWith("minor")) {
    if (normalized.includes("eastasia")) {
      return themeFonts.minorEastAsia ?? themeFonts.minorLatin;
    }
    if (normalized.includes("bidi") || normalized.includes("cs")) {
      return themeFonts.minorComplexScript ?? themeFonts.minorLatin;
    }
    return themeFonts.minorLatin;
  }

  return undefined;
}

function parseTextStyleFromXml(xml: string, themeFonts: ThemeFontMap = {}): TextStyle | undefined {
  if (!xml) {
    return undefined;
  }

  const bold = parseOnOffAttribute(xml, "b");
  const italic = parseOnOffAttribute(xml, "i");
  const underline = parseUnderlineAttribute(xml);
  const strike = parseOnOffAttribute(xml, "strike");

  const colorMatch = xml.match(/<w:color\b[^>]*w:val="([^"]+)"/i);
  const highlightMatch = xml.match(/<w:highlight\b[^>]*w:val="([^"]+)"/i);
  const shadingTag = xml.match(/<w:shd\b[^>]*\/?>/i)?.[0];
  const characterSpacingMatch = xml.match(/<w:spacing\b[^>]*w:val="(-?\d+)"/i);
  const sizeMatch =
    xml.match(/<w:sz\b[^>]*w:val="(\d+)"/i) ??
    xml.match(/<w:szCs\b[^>]*w:val="(\d+)"/i);
  const runFontsTag = xml.match(/<w:rFonts\b[^>]*\/?>/i)?.[0] ?? "";
  const asciiFont = runFontsTag ? getAttribute(runFontsTag, "w:ascii") : undefined;
  const hAnsiFont = runFontsTag ? getAttribute(runFontsTag, "w:hAnsi") : undefined;
  const eastAsiaFont = runFontsTag ? getAttribute(runFontsTag, "w:eastAsia") : undefined;
  const complexScriptFont = runFontsTag ? getAttribute(runFontsTag, "w:cs") : undefined;
  const asciiThemeFont = runFontsTag ? getAttribute(runFontsTag, "w:asciiTheme") : undefined;
  const hAnsiThemeFont = runFontsTag ? getAttribute(runFontsTag, "w:hAnsiTheme") : undefined;
  const eastAsiaThemeFont = runFontsTag ? getAttribute(runFontsTag, "w:eastAsiaTheme") : undefined;
  const complexScriptThemeFont = runFontsTag ? getAttribute(runFontsTag, "w:csTheme") : undefined;
  const verticalAlignMatch = xml.match(/<w:vertAlign\b[^>]*w:val="([^"]+)"/i);
  const drawingBoldMatch = xml.match(/<a:rPr\b[^>]*\bb="([^"]+)"/i);
  const drawingItalicMatch = xml.match(/<a:rPr\b[^>]*\bi="([^"]+)"/i);
  const drawingUnderlineMatch = xml.match(/<a:rPr\b[^>]*\bu="([^"]+)"/i);
  const drawingStrikeMatch = xml.match(/<a:rPr\b[^>]*\b(?:strike|s)="([^"]+)"/i);
  const drawingColorMatch = xml.match(
    /<a:rPr\b[\s\S]*?<a:(?:solidFill|srgbClr)\b[\s\S]*?<a:srgbClr\b[^>]*val="([^"]+)"/i
  );
  const drawingSizeMatch = xml.match(/<a:rPr\b[^>]*\bsz="(\d+)"/i);
  const drawingFontMatch = xml.match(/<a:rPr\b[\s\S]*?<a:latin\b[^>]*typeface="([^"]+)"/i);
  const drawingDefaultFontMatch = xml.match(/<a:defRPr\b[\s\S]*?<a:latin\b[^>]*typeface="([^"]+)"/i);
  const drawingAnyLatinMatch = xml.match(/<a:latin\b[^>]*typeface="([^"]+)"/i);
  const runBorderTag = xml.match(/<w:bdr\b[^>]*\/?>/i)?.[0];
  const decodedTextSamples = [...xml.matchAll(/<(?:w|a):t\b[^>]*>([\s\S]*?)<\/(?:w|a):t>/gi)]
    .map((match) => decodeXmlEntities(match[1] ?? ""))
    .join("");
  const containsEastAsiaGlyphs = /[\u2e80-\u9fff\u3040-\u30ff\uac00-\ud7af]/i.test(decodedTextSamples);
  const containsComplexScriptGlyphs = /[\u0590-\u08ff\ufb1d-\ufefc]/i.test(decodedTextSamples);

  const style: TextStyle = {};
  if (bold !== undefined) {
    style.bold = bold;
  }
  if (italic !== undefined) {
    style.italic = italic;
  }
  if (underline !== undefined) {
    style.underline = underline;
  }
  if (strike !== undefined) {
    style.strike = strike;
  }
  if (style.bold === undefined && drawingBoldMatch?.[1]) {
    const value = drawingBoldMatch[1].toLowerCase();
    style.bold = value !== "0" && value !== "false";
  }
  if (style.italic === undefined && drawingItalicMatch?.[1]) {
    const value = drawingItalicMatch[1].toLowerCase();
    style.italic = value !== "0" && value !== "false";
  }
  if (style.underline === undefined && drawingUnderlineMatch?.[1]) {
    const value = drawingUnderlineMatch[1].toLowerCase();
    style.underline = value !== "none" && value !== "false" && value !== "0";
  }
  if (style.strike === undefined && drawingStrikeMatch?.[1]) {
    const value = drawingStrikeMatch[1].toLowerCase();
    style.strike = value !== "nostrike" && value !== "none" && value !== "false" && value !== "0";
  }

  const color = normalizeHexColor(colorMatch?.[1]);
  if (color) {
    style.color = color;
  } else {
    const drawingColor = normalizeHexColor(drawingColorMatch?.[1]);
    if (drawingColor) {
      style.color = drawingColor;
    }
  }

  if (highlightMatch?.[1]) {
    style.highlight = highlightMatch[1];
  }

  const shadingFill = normalizeHexColor(shadingTag ? getAttribute(shadingTag, "w:fill") : undefined);
  if (shadingFill) {
    style.backgroundColor = shadingFill;
  }

  if (characterSpacingMatch?.[1]) {
    style.characterSpacingTwips = Number(characterSpacingMatch[1]);
  }

  if (sizeMatch?.[1]) {
    style.fontSizePt = Number(sizeMatch[1]) / 2;
  } else if (drawingSizeMatch?.[1]) {
    style.fontSizePt = Number(drawingSizeMatch[1]) / 100;
  }

  const runFontFamily = asciiFont ?? hAnsiFont;
  const runThemeFontToken = asciiThemeFont ?? hAnsiThemeFont;
  const eastAsiaFallbackFont = containsEastAsiaGlyphs ? eastAsiaFont : undefined;
  const eastAsiaFallbackThemeToken = containsEastAsiaGlyphs ? eastAsiaThemeFont : undefined;
  const complexScriptFallbackFont = containsComplexScriptGlyphs ? complexScriptFont : undefined;
  const complexScriptFallbackThemeToken = containsComplexScriptGlyphs
    ? complexScriptThemeFont
    : undefined;
  const symbolFallbackFont =
    (eastAsiaFont ?? complexScriptFont) &&
    /(symbol|emoji|dingbats?|wingdings|webdings)/i.test(eastAsiaFont ?? complexScriptFont ?? "")
      ? eastAsiaFont ?? complexScriptFont
      : undefined;

  if (runFontFamily) {
    style.fontFamily = runFontFamily;
  } else if (runThemeFontToken) {
    const themeFontFamily = resolveThemeFont(runThemeFontToken, themeFonts);
    if (themeFontFamily) {
      style.fontFamily = themeFontFamily;
    }
  } else if (eastAsiaFallbackFont) {
    style.fontFamily = eastAsiaFallbackFont;
  } else if (eastAsiaFallbackThemeToken) {
    const themeFontFamily = resolveThemeFont(eastAsiaFallbackThemeToken, themeFonts);
    if (themeFontFamily) {
      style.fontFamily = themeFontFamily;
    }
  } else if (complexScriptFallbackFont) {
    style.fontFamily = complexScriptFallbackFont;
  } else if (complexScriptFallbackThemeToken) {
    const themeFontFamily = resolveThemeFont(complexScriptFallbackThemeToken, themeFonts);
    if (themeFontFamily) {
      style.fontFamily = themeFontFamily;
    }
  } else if (symbolFallbackFont) {
    style.fontFamily = symbolFallbackFont;
  } else if (drawingFontMatch?.[1]) {
    style.fontFamily = drawingFontMatch[1];
  } else if (drawingDefaultFontMatch?.[1]) {
    style.fontFamily = drawingDefaultFontMatch[1];
  } else if (drawingAnyLatinMatch?.[1]) {
    style.fontFamily = drawingAnyLatinMatch[1];
  }

  const verticalAlignValue = verticalAlignMatch?.[1]?.toLowerCase();
  if (verticalAlignValue === "superscript" || verticalAlignValue === "subscript") {
    style.verticalAlign = verticalAlignValue;
  }

  const runBorder = parseTextRunBorderStyle(runBorderTag);
  if (runBorder) {
    style.runBorder = runBorder;
  }

  return Object.keys(style).length > 0 ? style : undefined;
}

function parseParagraphAlignFromXml(xml: string): ParagraphAlignment | undefined {
  const alignmentMatch = xml.match(/<w:jc\b[^>]*w:val="([^"]+)"/i);
  return normalizeAlignment(alignmentMatch?.[1]);
}

function parseHeadingLevelFromOutline(xml: string): HeadingLevel | undefined {
  const outlineMatch = xml.match(/<w:outlineLvl\b[^>]*w:val="([0-5])"/i);
  if (!outlineMatch?.[1]) {
    return undefined;
  }

  const level = Number(outlineMatch[1]) + 1;
  if (level >= 1 && level <= 6) {
    return level as HeadingLevel;
  }

  return undefined;
}

function parseStyleType(value?: string): RawStyleDefinition["type"] | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase();
  if (
    normalized === "paragraph" ||
    normalized === "character" ||
    normalized === "numbering" ||
    normalized === "table"
  ) {
    return normalized;
  }

  return undefined;
}

function resolveStylePropertiesBlock(styleXml: string, tagName: "w:pPr" | "w:rPr"): string {
  const balanced = extractBalancedTagBlocks(styleXml, tagName)[0];
  if (balanced) {
    return balanced;
  }

  return styleXml.match(new RegExp(`<${tagName}\\b[^>]*\\/?>`, "i"))?.[0] ?? "";
}

function stripTableConditionalStyleBlocks(styleXml: string): string {
  if (!styleXml) {
    return styleXml;
  }

  return styleXml
    .replace(/<w:tblStylePr\b[\s\S]*?<\/w:tblStylePr>/gi, "")
    .replace(/<w:tblStylePr\b[^>]*\/>/gi, "");
}

function parseThemeFonts(pkg: OoxmlPackage): ThemeFontMap {
  const themeXml = pkg.parts.get("word/theme/theme1.xml")?.content;
  if (!themeXml) {
    return {};
  }

  const readTypeface = (xml: string, tagName: "latin" | "ea" | "cs"): string | undefined => {
    const value = xml.match(new RegExp(`<a:${tagName}\\b[^>]*typeface="([^"]*)"`, "i"))?.[1]?.trim();
    return value ? value : undefined;
  };

  const majorFontXml = extractBalancedTagBlocks(themeXml, "a:majorFont")[0] ?? "";
  const minorFontXml = extractBalancedTagBlocks(themeXml, "a:minorFont")[0] ?? "";

  return {
    majorLatin: readTypeface(majorFontXml, "latin"),
    majorEastAsia: readTypeface(majorFontXml, "ea"),
    majorComplexScript: readTypeface(majorFontXml, "cs"),
    minorLatin: readTypeface(minorFontXml, "latin"),
    minorEastAsia: readTypeface(minorFontXml, "ea"),
    minorComplexScript: readTypeface(minorFontXml, "cs")
  };
}

function parseThemeColors(pkg: OoxmlPackage): ThemeColorMap {
  const themeXml = pkg.parts.get("word/theme/theme1.xml")?.content;
  if (!themeXml) {
    return {};
  }

  const colorSchemeXml = extractBalancedTagBlocks(themeXml, "a:clrScheme")[0] ?? "";
  if (!colorSchemeXml) {
    return {};
  }

  const parseThemeColorFromTag = (colorXml: string): string | undefined => {
    const explicit = colorXml.match(/<a:srgbClr\b[^>]*\bw:val="([^"]+)"/i)?.[1];
    if (explicit) {
      return normalizeHexColor(explicit);
    }

    const fallback = colorXml.match(/<a:sysClr\b[^>]*\blastClr="([^"]+)"/i)?.[1];
    return normalizeHexColor(fallback);
  };

  const colorNames = [
    "dk1",
    "lt1",
    "dk2",
    "lt2",
    "accent1",
    "accent2",
    "accent3",
    "accent4",
    "accent5",
    "accent6",
    "hlink",
    "folHlink",
    "bg1",
    "bg2",
    "tx1",
    "tx2",
    "followedHyperlink"
  ];

  const colors: ThemeColorMap = {};
  for (const name of colorNames) {
    const tagMatch = colorSchemeXml.match(
      new RegExp(`<a:${name}\\b[^>]*>[\\s\\S]*?<\\/a:${name}>|<a:${name}\\b[^>]*/>`, "i")
    )?.[0];
    if (!tagMatch) {
      continue;
    }

    const color = parseThemeColorFromTag(tagMatch);
    if (color) {
      colors[name.toLowerCase()] = color;
    }
  }

  return colors;
}

function parseStyleSheet(pkg: OoxmlPackage): ParsedStyleSheet {
  const stylesXml = pkg.parts.get("word/styles.xml")?.content;
  if (!stylesXml) {
    return EMPTY_STYLE_SHEET;
  }

  const themeFonts = parseThemeFonts(pkg);
  const themeColors = parseThemeColors(pkg);
  const docDefaultsXml = extractBalancedTagBlocks(stylesXml, "w:docDefaults")[0] ?? "";
  const defaultParagraphStyle: ParagraphStyle | undefined = (() => {
    const paragraphDefaults = resolveStylePropertiesBlock(docDefaultsXml, "w:pPr");
    const defaultParagraphHasNumPr = /<w:numPr\b/i.test(paragraphDefaults);
    const align = parseParagraphAlignFromXml(paragraphDefaults);
    const spacing = parseParagraphSpacingFromXml(paragraphDefaults);
    const indent = parseParagraphIndentFromXml(paragraphDefaults);
    const backgroundColor = parseParagraphShadingFromXml(paragraphDefaults);
    const borders = parseParagraphBorderSetFromXml(paragraphDefaults);
    const tabStops = parseParagraphTabStopsFromXml(paragraphDefaults);
    const parsedDefaultNumbering = parseParagraphNumberingFromXml(paragraphDefaults);
    const numbering =
      defaultParagraphHasNumPr && !parsedDefaultNumbering
        ? { numId: 0, ilvl: 0 }
        : parsedDefaultNumbering;
    const contextualSpacing = parseOnOffAttribute(paragraphDefaults, "contextualSpacing");
    const keepNext = parseOnOffAttribute(paragraphDefaults, "keepNext");
    const keepLines = parseOnOffAttribute(paragraphDefaults, "keepLines");
    const widowControl = parseOnOffAttribute(paragraphDefaults, "widowControl");
    const pageBreakBefore = parseOnOffAttribute(paragraphDefaults, "pageBreakBefore");

    if (
      !align &&
      !spacing &&
      !indent &&
      !backgroundColor &&
      !borders &&
      (!tabStops || tabStops.length === 0) &&
      !numbering &&
      contextualSpacing === undefined &&
      keepNext === undefined &&
      keepLines === undefined &&
      widowControl === undefined &&
      pageBreakBefore === undefined
    ) {
      return undefined;
    }

    return {
      align,
      spacing,
      indent,
      backgroundColor,
      borders,
      tabStops,
      numbering,
      contextualSpacing,
      keepNext,
      keepLines,
      widowControl,
      pageBreakBefore
    };
  })();
  const defaultRunStyle = parseTextStyleFromXml(
    resolveStylePropertiesBlock(docDefaultsXml, "w:rPr"),
    themeFonts
  );

  const rawStylesById = new Map<string, RawStyleDefinition>();
  const rawTableStylesById = new Map<string, ParsedTableStyleDefinition>();

  for (const styleXml of extractBalancedTagBlocks(stylesXml, "w:style")) {
    const styleTag = styleXml.match(/<w:style\b[^>]*>/i)?.[0] ?? "";
    const styleId = getAttribute(styleTag, "w:styleId");
    const styleType = parseStyleType(getAttribute(styleTag, "w:type"));
    if (!styleId || !styleType) {
      continue;
    }

    const nameTag = styleXml.match(/<w:name\b[^>]*\/?>/i)?.[0] ?? "";
    const basedOnTag = styleXml.match(/<w:basedOn\b[^>]*\/?>/i)?.[0] ?? "";
    const nextTag = styleXml.match(/<w:next\b[^>]*\/?>/i)?.[0] ?? "";
    const uiPriorityTag = styleXml.match(/<w:uiPriority\b[^>]*\/?>/i)?.[0] ?? "";
    const paragraphPropertiesXml = resolveStylePropertiesBlock(styleXml, "w:pPr");
    const styleHasParagraphNumPr = /<w:numPr\b/i.test(paragraphPropertiesXml);
    const runPropertiesXml = resolveStylePropertiesBlock(styleXml, "w:rPr");

    const headingLevel =
      normalizeHeadingLevel(styleId) ||
      normalizeHeadingLevel(getAttribute(nameTag, "w:val")) ||
      parseHeadingLevelFromOutline(paragraphPropertiesXml);

    const parsedStyleNumbering = parseParagraphNumberingFromXml(paragraphPropertiesXml);
    rawStylesById.set(styleId, {
      id: styleId,
      type: styleType,
      name: getAttribute(nameTag, "w:val") ?? styleId,
      basedOnId: getAttribute(basedOnTag, "w:val"),
      nextStyleId: getAttribute(nextTag, "w:val"),
      align: parseParagraphAlignFromXml(paragraphPropertiesXml),
      headingLevel,
      numbering:
        styleHasParagraphNumPr && !parsedStyleNumbering
          ? { numId: 0, ilvl: 0 }
          : parsedStyleNumbering,
      spacing: parseParagraphSpacingFromXml(paragraphPropertiesXml),
      indent: parseParagraphIndentFromXml(paragraphPropertiesXml),
      backgroundColor: parseParagraphShadingFromXml(paragraphPropertiesXml),
      borders: parseParagraphBorderSetFromXml(paragraphPropertiesXml),
      tabStops: parseParagraphTabStopsFromXml(paragraphPropertiesXml),
      contextualSpacing: parseOnOffAttribute(paragraphPropertiesXml, "contextualSpacing"),
      keepNext: parseOnOffAttribute(paragraphPropertiesXml, "keepNext"),
      keepLines: parseOnOffAttribute(paragraphPropertiesXml, "keepLines"),
      widowControl: parseOnOffAttribute(paragraphPropertiesXml, "widowControl"),
      pageBreakBefore: parseOnOffAttribute(paragraphPropertiesXml, "pageBreakBefore"),
      runStyle: parseTextStyleFromXml(runPropertiesXml, themeFonts),
      uiPriority: Number(getAttribute(uiPriorityTag, "w:val")),
      isDefault: getAttribute(styleTag, "w:default") === "1",
      isPrimary: /<w:qFormat\b[^>]*\/?>/i.test(styleXml)
    });

    if (styleType === "table") {
      const conditions: Partial<Record<TableConditionalStyleType, ParsedTableStyleCondition>> = {};
      const wholeTableSourceXml = stripTableConditionalStyleBlocks(styleXml);
      const wholeTableCondition = parseTableConditionalStyleFromXml(wholeTableSourceXml, themeFonts);
      if (wholeTableCondition) {
        conditions.wholeTable = wholeTableCondition;
      }

      for (const conditionalStyleXml of extractBalancedTagBlocks(styleXml, "w:tblStylePr")) {
        const conditionalStyleTag = conditionalStyleXml.match(/<w:tblStylePr\b[^>]*>/i)?.[0] ?? "";
        const conditionalType = normalizeTableConditionalStyleType(
          getAttribute(conditionalStyleTag, "w:type")
        );
        if (!conditionalType) {
          continue;
        }

        const condition = parseTableConditionalStyleFromXml(conditionalStyleXml, themeFonts);
        if (!condition) {
          continue;
        }
        conditions[conditionalType] = condition;
      }

      rawTableStylesById.set(styleId, {
        id: styleId,
        basedOnId: getAttribute(basedOnTag, "w:val"),
        name: getAttribute(nameTag, "w:val") ?? styleId,
        conditions
      });
    }
  }

  const runStyleCache = new Map<string, TextStyle | undefined>();
  const resolveRunStyle = (styleId: string, stack = new Set<string>()): TextStyle | undefined => {
    if (runStyleCache.has(styleId)) {
      return runStyleCache.get(styleId);
    }

    if (stack.has(styleId)) {
      return undefined;
    }
    stack.add(styleId);

    const style = rawStylesById.get(styleId);
    if (!style) {
      runStyleCache.set(styleId, undefined);
      stack.delete(styleId);
      return undefined;
    }

    const inherited = style.basedOnId ? resolveRunStyle(style.basedOnId, stack) : undefined;
    const resolved = mergeTextStyles(inherited, style.runStyle);
    runStyleCache.set(styleId, resolved);
    stack.delete(styleId);
    return resolved;
  };

  const paragraphStyleCache = new Map<string, ParagraphStyleDefinition | undefined>();
  const resolveParagraphStyle = (
    styleId: string,
    stack = new Set<string>()
  ): ParagraphStyleDefinition | undefined => {
    if (paragraphStyleCache.has(styleId)) {
      return paragraphStyleCache.get(styleId);
    }

    if (stack.has(styleId)) {
      return undefined;
    }
    stack.add(styleId);

    const style = rawStylesById.get(styleId);
    if (!style || style.type !== "paragraph") {
      paragraphStyleCache.set(styleId, undefined);
      stack.delete(styleId);
      return undefined;
    }

    const inherited =
      style.basedOnId && rawStylesById.get(style.basedOnId)?.type === "paragraph"
        ? resolveParagraphStyle(style.basedOnId, stack)
        : undefined;

    const resolved: ParagraphStyleDefinition = {
      id: style.id,
      name: style.name,
      basedOnId: style.basedOnId,
      nextStyleId: style.nextStyleId,
      align: style.align ?? inherited?.align,
      headingLevel: style.headingLevel ?? inherited?.headingLevel,
      numbering: style.numbering ?? inherited?.numbering,
      spacing: mergeParagraphSpacing(inherited?.spacing, style.spacing),
      indent: mergeParagraphIndent(inherited?.indent, style.indent),
      backgroundColor: mergeParagraphBackgroundColor(inherited?.backgroundColor, style.backgroundColor),
      borders: mergeParagraphBorderSets(inherited?.borders, style.borders),
      tabStops: mergeParagraphTabStops(inherited?.tabStops, style.tabStops),
      contextualSpacing: mergeParagraphBoolean(inherited?.contextualSpacing, style.contextualSpacing),
      keepNext: mergeParagraphBoolean(inherited?.keepNext, style.keepNext),
      keepLines: mergeParagraphBoolean(inherited?.keepLines, style.keepLines),
      widowControl: mergeParagraphBoolean(inherited?.widowControl, style.widowControl),
      pageBreakBefore: mergeParagraphBoolean(inherited?.pageBreakBefore, style.pageBreakBefore),
      runStyle: mergeTextStyles(inherited?.runStyle, style.runStyle),
      uiPriority: Number.isFinite(style.uiPriority) ? style.uiPriority : inherited?.uiPriority,
      isDefault: style.isDefault,
      isPrimary: style.isPrimary
    };

    paragraphStyleCache.set(styleId, resolved);
    stack.delete(styleId);
    return resolved;
  };

  const paragraphStyles = Array.from(rawStylesById.values())
    .filter((style) => style.type === "paragraph")
    .map((style) => resolveParagraphStyle(style.id))
    .filter((style): style is ParagraphStyleDefinition => Boolean(style))
    .sort((left, right) => {
      const leftPriority = Number.isFinite(left.uiPriority) ? (left.uiPriority as number) : 9999;
      const rightPriority = Number.isFinite(right.uiPriority) ? (right.uiPriority as number) : 9999;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return left.name.localeCompare(right.name);
    });

  const paragraphStyleById = new Map(paragraphStyles.map((style) => [style.id, style]));
  const runStyleById = new Map<string, TextStyle>();
  for (const styleId of rawStylesById.keys()) {
    const resolved = resolveRunStyle(styleId);
    if (resolved) {
      runStyleById.set(styleId, resolved);
    }
  }

  const tableStyleCache = new Map<string, ParsedTableStyleDefinition | undefined>();
  const resolveTableStyle = (
    styleId: string,
    stack = new Set<string>()
  ): ParsedTableStyleDefinition | undefined => {
    if (tableStyleCache.has(styleId)) {
      return tableStyleCache.get(styleId);
    }

    if (stack.has(styleId)) {
      return undefined;
    }
    stack.add(styleId);

    const style = rawTableStylesById.get(styleId);
    if (!style) {
      tableStyleCache.set(styleId, undefined);
      stack.delete(styleId);
      return undefined;
    }

    const inherited = style.basedOnId ? resolveTableStyle(style.basedOnId, stack) : undefined;
    const conditions: Partial<Record<TableConditionalStyleType, ParsedTableStyleCondition>> = {};
    for (const conditionalType of TABLE_CONDITIONAL_STYLE_TYPES) {
      const mergedCondition = mergeTableConditionalStyle(
        inherited?.conditions[conditionalType],
        style.conditions[conditionalType]
      );
      if (mergedCondition) {
        conditions[conditionalType] = mergedCondition;
      }
    }

    const resolved: ParsedTableStyleDefinition = {
      id: style.id,
      basedOnId: style.basedOnId,
      name: style.name,
      conditions
    };

    tableStyleCache.set(styleId, resolved);
    stack.delete(styleId);
    return resolved;
  };

  const tableStyleById = new Map<string, ParsedTableStyleDefinition>();
  for (const styleId of rawTableStylesById.keys()) {
    const resolved = resolveTableStyle(styleId);
    if (resolved) {
      tableStyleById.set(styleId, resolved);
    }
  }

  const defaultParagraphStyleId =
    paragraphStyles.find((style) => style.isDefault)?.id ??
    (paragraphStyleById.has("Normal") ? "Normal" : undefined);
  const resolvedDefaultParagraphStyle = defaultParagraphStyleId
    ? paragraphStyleById.get(defaultParagraphStyleId)
    : undefined;

  return {
    paragraphStyles,
    paragraphStyleById,
    runStyleById,
    tableStyleById,
    defaultParagraphStyle: {
      align: resolvedDefaultParagraphStyle?.align ?? defaultParagraphStyle?.align,
      headingLevel: resolvedDefaultParagraphStyle?.headingLevel,
      numbering: resolvedDefaultParagraphStyle?.numbering ?? defaultParagraphStyle?.numbering,
      spacing: mergeParagraphSpacing(defaultParagraphStyle?.spacing, resolvedDefaultParagraphStyle?.spacing),
      indent: mergeParagraphIndent(defaultParagraphStyle?.indent, resolvedDefaultParagraphStyle?.indent),
      backgroundColor: mergeParagraphBackgroundColor(
        defaultParagraphStyle?.backgroundColor,
        resolvedDefaultParagraphStyle?.backgroundColor
      ),
      borders: mergeParagraphBorderSets(defaultParagraphStyle?.borders, resolvedDefaultParagraphStyle?.borders),
      tabStops: mergeParagraphTabStops(defaultParagraphStyle?.tabStops, resolvedDefaultParagraphStyle?.tabStops),
      keepNext: mergeParagraphBoolean(defaultParagraphStyle?.keepNext, resolvedDefaultParagraphStyle?.keepNext),
      keepLines: mergeParagraphBoolean(defaultParagraphStyle?.keepLines, resolvedDefaultParagraphStyle?.keepLines),
      widowControl: mergeParagraphBoolean(
        defaultParagraphStyle?.widowControl,
        resolvedDefaultParagraphStyle?.widowControl
      ),
      pageBreakBefore: mergeParagraphBoolean(
        defaultParagraphStyle?.pageBreakBefore,
        resolvedDefaultParagraphStyle?.pageBreakBefore
      ),
      styleId: defaultParagraphStyleId,
      styleName: resolvedDefaultParagraphStyle?.name
    },
    defaultParagraphStyleId,
    defaultRunStyle: mergeTextStyles(defaultRunStyle, resolvedDefaultParagraphStyle?.runStyle),
    themeColors,
    themeFonts
  };
}

function parseContentTypes(pkg: OoxmlPackage): ContentTypeLookup {
  const defaultByExtension = new Map<string, string>();
  const overrideByPartName = new Map<string, string>();

  const xml = pkg.parts.get("[Content_Types].xml")?.content;
  if (!xml) {
    return { defaultByExtension, overrideByPartName };
  }

  for (const match of xml.matchAll(/<Default\b[^>]*>/g)) {
    const tag = match[0];
    const extension = getAttribute(tag, "Extension")?.toLowerCase();
    const contentType = getAttribute(tag, "ContentType");
    if (!extension || !contentType) {
      continue;
    }
    defaultByExtension.set(extension, contentType);
  }

  for (const match of xml.matchAll(/<Override\b[^>]*>/g)) {
    const tag = match[0];
    const partName = getAttribute(tag, "PartName");
    const contentType = getAttribute(tag, "ContentType");
    if (!partName || !contentType) {
      continue;
    }
    overrideByPartName.set(partName, contentType);
    if (!partName.startsWith("/")) {
      overrideByPartName.set(`/${partName}`, contentType);
    }
  }

  return {
    defaultByExtension,
    overrideByPartName
  };
}

function resolvePartPath(basePartName: string, target: string): string {
  if (!target) {
    return "";
  }

  // External relationship targets should not be resolved relative to the part.
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) {
    return target;
  }

  if (target.startsWith("/")) {
    return target.slice(1);
  }

  const baseSegments = basePartName.split("/").slice(0, -1);
  const targetSegments = target.split("/");
  const output: string[] = [...baseSegments];

  for (const segment of targetSegments) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      output.pop();
      continue;
    }

    output.push(segment);
  }

  return output.join("/");
}

function relationshipPartNameForPart(partName: string): string {
  const segments = partName.split("/");
  const fileName = segments.pop();
  if (!fileName) {
    return "";
  }

  const folder = segments.join("/");
  return folder.length > 0 ? `${folder}/_rels/${fileName}.rels` : `_rels/${fileName}.rels`;
}

function parsePartRelationships(pkg: OoxmlPackage, partName: string): Map<string, string> {
  const map = new Map<string, string>();
  const relationshipsPartName = relationshipPartNameForPart(partName);
  const relationshipsPart = pkg.parts.get(relationshipsPartName)?.content;
  if (!relationshipsPart) {
    return map;
  }

  for (const match of relationshipsPart.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0];
    const id = getAttribute(tag, "Id");
    const target = getAttribute(tag, "Target");
    if (!id || !target) {
      continue;
    }
    map.set(id, resolvePartPath(partName, target));
  }

  return map;
}

function extensionFromPartName(partName: string): string | undefined {
  const lastDot = partName.lastIndexOf(".");
  if (lastDot < 0 || lastDot === partName.length - 1) {
    return undefined;
  }
  return partName.slice(lastDot + 1).toLowerCase();
}

function contentTypeForPart(partName: string, contentTypes: ContentTypeLookup): string | undefined {
  const override =
    contentTypes.overrideByPartName.get(partName) || contentTypes.overrideByPartName.get(`/${partName}`);
  if (override) {
    return override;
  }

  const extension = extensionFromPartName(partName);
  if (!extension) {
    return undefined;
  }

  return contentTypes.defaultByExtension.get(extension) ?? MIME_BY_EXTENSION[extension];
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.byteLength; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  if (typeof btoa === "function") {
    return btoa(binary);
  }

  throw new Error("No base64 encoder available in this environment");
}

function isNodeRuntime(): boolean {
  return Boolean(
    typeof process !== "undefined" &&
      process?.versions &&
      typeof process.versions.node === "string"
  );
}

function resolveNodeBuiltin<T = unknown>(moduleName: string): T | undefined {
  if (!isNodeRuntime()) {
    return undefined;
  }

  const processWithBuiltins = process as typeof process & {
    getBuiltinModule?: (name: string) => unknown;
  };
  if (typeof processWithBuiltins.getBuiltinModule === "function") {
    return processWithBuiltins.getBuiltinModule(moduleName) as T | undefined;
  }

  try {
    const maybeRequire = Function(
      "return typeof require !== 'undefined' ? require : undefined;"
    )() as ((name: string) => T) | undefined;
    return maybeRequire ? maybeRequire(moduleName) : undefined;
  } catch {
    return undefined;
  }
}

function isWindowsMetafileContentType(contentType: string | undefined, partName?: string): boolean {
  const normalizedContentType = contentType?.trim().toLowerCase();
  if (
    normalizedContentType === "image/wmf" ||
    normalizedContentType === "image/x-wmf" ||
    normalizedContentType === "application/x-wmf" ||
    normalizedContentType === "image/emf" ||
    normalizedContentType === "image/x-emf" ||
    normalizedContentType === "application/x-emf"
  ) {
    return true;
  }

  const extension = partName ? extensionFromPartName(partName) : undefined;
  return extension === "wmf" || extension === "emf";
}

function rasterizeWindowsMetafileToPngDataUri(
  bytes: Uint8Array,
  partName?: string
): string | undefined {
  if (!isNodeRuntime()) {
    return undefined;
  }

  const fs = resolveNodeBuiltin<{
    mkdtempSync(prefix: string): string;
    writeFileSync(path: string, data: Uint8Array): void;
    existsSync(path: string): boolean;
    readFileSync(path: string): Uint8Array;
    rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  }>("node:fs");
  const os = resolveNodeBuiltin<{ tmpdir(): string }>("node:os");
  const path = resolveNodeBuiltin<{
    join(...parts: string[]): string;
    basename(path: string, suffix?: string): string;
    extname(path: string): string;
  }>("node:path");
  const childProcess = resolveNodeBuiltin<{
    execFileSync(
      file: string,
      args: string[],
      options?: {
        stdio?: "ignore";
      }
    ): void;
  }>("node:child_process");

  if (!fs || !os || !path || !childProcess) {
    return undefined;
  }

  const sourceExtension = extensionFromPartName(partName ?? "") ?? "wmf";
  const baseName = "metafile-image";
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "react-docx-metafile-"));
  const sourcePath = path.join(tempDir, `${baseName}.${sourceExtension}`);
  const outputPath = path.join(tempDir, `${baseName}.png`);
  const sofficeCandidates = [
    process.env.SOFFICE_PATH,
    "soffice",
    "/opt/homebrew/bin/soffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice"
  ].filter((candidate): candidate is string => Boolean(candidate));

  try {
    fs.writeFileSync(sourcePath, bytes);

    for (const sofficePath of sofficeCandidates) {
      try {
        childProcess.execFileSync(
          sofficePath,
          ["--headless", "--convert-to", "png", "--outdir", tempDir, sourcePath],
          { stdio: "ignore" }
        );
      } catch {
        continue;
      }

      if (fs.existsSync(outputPath)) {
        trimRasterizedMetafilePng(outputPath, childProcess);
        const pngBytes = fs.readFileSync(outputPath);
        return `data:image/png;base64,${bytesToBase64(new Uint8Array(pngBytes))}`;
      }
    }

    return undefined;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort temp cleanup only.
    }
  }
}

function trimRasterizedMetafilePng(
  pngPath: string,
  childProcess: {
    execFileSync(
      file: string,
      args: string[],
      options?: {
        stdio?: "ignore";
      }
    ): void;
  }
): void {
  const pythonCandidates = [process.env.PYTHON, "python3", "python"].filter(
    (candidate): candidate is string => Boolean(candidate)
  );
  const trimScript = `
from PIL import Image
import sys

path = sys.argv[1]
try:
    image = Image.open(path).convert("RGBA")
except Exception:
    raise SystemExit(0)

width, height = image.size
if width <= 0 or height <= 0:
    raise SystemExit(0)

pixels = image.load()
left = width
top = height
right = -1
bottom = -1

for y in range(height):
    for x in range(width):
        r, g, b, a = pixels[x, y]
        if a <= 8:
            continue
        if r >= 248 and g >= 248 and b >= 248:
            continue
        if x < left:
            left = x
        if y < top:
            top = y
        if x > right:
            right = x
        if y > bottom:
            bottom = y

if right < left or bottom < top:
    raise SystemExit(0)

trimmed_width = right - left + 1
trimmed_height = bottom - top + 1
if trimmed_width >= width * 0.96 and trimmed_height >= height * 0.96:
    raise SystemExit(0)

occupancy_x = trimmed_width / width if width else 1
occupancy_y = trimmed_height / height if height else 1

if occupancy_x < 0.75 or occupancy_y < 0.75:
    target_occupancy = 0.82
    padded_width = min(width, max(trimmed_width, round(trimmed_width / target_occupancy)))
    padded_height = min(height, max(trimmed_height, round(trimmed_height / target_occupancy)))
    pad_x = max(4, round((padded_width - trimmed_width) / 2))
    pad_y = max(4, round((padded_height - trimmed_height) / 2))
else:
    pad_x = max(4, round(trimmed_width * 0.03))
    pad_y = max(4, round(trimmed_height * 0.03))

crop_left = max(0, left - pad_x)
crop_top = max(0, top - pad_y)
crop_right = min(width, right + pad_x + 1)
crop_bottom = min(height, bottom + pad_y + 1)

cropped = image.crop((crop_left, crop_top, crop_right, crop_bottom))
cropped.save(path, format="PNG")
`;

  for (const pythonPath of pythonCandidates) {
    try {
      childProcess.execFileSync(pythonPath, ["-c", trimScript, pngPath], {
        stdio: "ignore"
      });
      return;
    } catch {
      continue;
    }
  }
}

function parseRunStyle(
  runXml: string,
  context: ParseContext,
  paragraphStyleId?: string
): TextStyle | undefined {
  const runStyleId = runXml.match(/<w:rStyle\b[^>]*w:val="([^"]+)"/i)?.[1];
  const textBoxRunXml = extractBalancedTagBlocks(
    extractBalancedTagBlocks(preferAlternateContentChoice(runXml), "w:txbxContent")[0] ?? "",
    "w:r"
  )[0];
  const direct = parseTextStyleFromXml(textBoxRunXml ?? runXml, context.styleSheet.themeFonts);
  const inheritedParagraphRunStyle = paragraphStyleId
    ? context.styleSheet.paragraphStyleById.get(paragraphStyleId)?.runStyle
    : undefined;
  const inheritedRunStyle = runStyleId ? context.styleSheet.runStyleById.get(runStyleId) : undefined;

  return mergeTextStyles(
    context.styleSheet.defaultRunStyle,
    inheritedParagraphRunStyle,
    inheritedRunStyle,
    direct
  );
}

function preferAlternateContentChoice(xml: string): string {
  if (!xml.includes("<mc:AlternateContent")) {
    return xml;
  }

  return xml.replace(/<mc:AlternateContent\b[\s\S]*?<\/mc:AlternateContent>/gi, (alternateXml) => {
    const choiceXml = alternateXml.match(/<mc:Choice\b[\s\S]*?<\/mc:Choice>/i)?.[0];
    if (!choiceXml) {
      return alternateXml;
    }

    return choiceXml
      .replace(/<mc:Choice\b[^>]*>/i, "")
      .replace(/<\/mc:Choice>/i, "");
  });
}

interface ParsedRunTextToken {
  text: string;
  noteReference?: {
    kind: "footnote" | "endnote";
    id: number;
  };
}

function parseRunTextTokens(runXml: string): ParsedRunTextToken[] {
  const normalizedRunXml = preferAlternateContentChoice(runXml);
  const tokenPattern =
    /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<a:t\b[^>]*>([\s\S]*?)<\/a:t>|<w:footnoteReference\b[^>]*w:id="(-?\d+)"[^>]*\/>|<w:endnoteReference\b[^>]*w:id="(-?\d+)"[^>]*\/>|<w:tab\b[^>]*\/>|<a:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:cr\b[^>]*\/>|<a:br\b[^>]*\/>|<\/w:p>/g;
  const tokens = normalizedRunXml.matchAll(tokenPattern);
  const parts: ParsedRunTextToken[] = [];

  for (const token of tokens) {
    if (token[1] !== undefined) {
      parts.push({ text: decodeXmlEntities(token[1]) });
      continue;
    }
    if (token[2] !== undefined) {
      parts.push({ text: decodeXmlEntities(token[2]) });
      continue;
    }
  if (token[3] !== undefined) {
      const referenceId = Number.parseInt(token[3], 10);
      const safeId = Number.isFinite(referenceId) ? Math.round(referenceId) : undefined;
      if (safeId === undefined || safeId <= 0) {
        continue;
      }

      parts.push({
        text: "",
        noteReference: {
          kind: "footnote",
          id: safeId
        }
      });
      continue;
    }
    if (token[4] !== undefined) {
      const referenceId = Number.parseInt(token[4], 10);
      const safeId = Number.isFinite(referenceId) ? Math.round(referenceId) : undefined;
      if (safeId === undefined || safeId <= 0) {
        continue;
      }

      parts.push({
        text: "",
        noteReference: {
          kind: "endnote",
          id: safeId
        }
      });
      continue;
    }

    const marker = token[0].toLowerCase();
    if (marker === "</w:p>") {
      parts.push({ text: "\n" });
    } else if (marker.startsWith("<w:tab") || marker.startsWith("<a:tab")) {
      parts.push({ text: "\t" });
    } else {
      parts.push({ text: "\n" });
    }
  }

  return parts;
}

function parseRunText(runXml: string): string {
  return parseRunTextTokens(runXml)
    .map((token) => token.text)
    .join("");
}

function stripTextBoxContent(xml: string): string {
  return xml.replace(/<w:txbxContent\b[\s\S]*?<\/w:txbxContent>/gi, "");
}

function parseFloatingAnchorFromRunXml(
  runXml: string
): ImageRunNode["floating"] | undefined {
  const anchorTag = runXml.match(/<wp:anchor\b[^>]*>/i)?.[0];
  if (!anchorTag) {
    return undefined;
  }

  const positionHBlock = runXml.match(/<wp:positionH\b[^>]*>[\s\S]*?<\/wp:positionH>/i)?.[0];
  const positionVBlock = runXml.match(/<wp:positionV\b[^>]*>[\s\S]*?<\/wp:positionV>/i)?.[0];
  const positionHTag = positionHBlock?.match(/<wp:positionH\b[^>]*>/i)?.[0];
  const positionVTag = positionVBlock?.match(/<wp:positionV\b[^>]*>/i)?.[0];
  const wrapTag = runXml.match(/<wp:(?:wrapNone|wrapSquare|wrapTight|wrapThrough|wrapTopAndBottom)\b[^>]*\/?>/i)?.[0];

  const xOffsetRaw = positionHBlock?.match(/<wp:posOffset>(-?\d+)<\/wp:posOffset>/i)?.[1];
  const yOffsetRaw = positionVBlock?.match(/<wp:posOffset>(-?\d+)<\/wp:posOffset>/i)?.[1];
  const horizontalAlignRaw = positionHBlock?.match(/<wp:align>([^<]+)<\/wp:align>/i)?.[1];
  const verticalAlignRaw = positionVBlock?.match(/<wp:align>([^<]+)<\/wp:align>/i)?.[1];
  const distLRaw = getAttribute(anchorTag, "distL");
  const distRRaw = getAttribute(anchorTag, "distR");
  const distTRaw = getAttribute(anchorTag, "distT");
  const distBRaw = getAttribute(anchorTag, "distB");
  const zIndexRaw = getAttribute(anchorTag, "relativeHeight");

  const xPx = emuToPixels(xOffsetRaw);
  const yPx = emuToPixels(yOffsetRaw);
  const toPxFromEmu = (value?: string): number | undefined => {
    const resolved = emuToPixels(value);
    return resolved === undefined ? undefined : Math.max(0, resolved);
  };
  const zIndex = zIndexRaw && Number.isFinite(Number(zIndexRaw)) ? Number(zIndexRaw) : undefined;
  const horizontalRelativeTo = positionHTag ? getAttribute(positionHTag, "relativeFrom") : undefined;
  const verticalRelativeTo = positionVTag ? getAttribute(positionVTag, "relativeFrom") : undefined;
  const horizontalAlign = horizontalAlignRaw?.trim().toLowerCase();
  const verticalAlign = verticalAlignRaw?.trim().toLowerCase();
  const distLPx = toPxFromEmu(distLRaw);
  const distRPx = toPxFromEmu(distRRaw);
  const distTPx = toPxFromEmu(distTRaw);
  const distBPx = toPxFromEmu(distBRaw);
  const wrapTypeRaw = wrapTag?.match(/<wp:(wrapNone|wrapSquare|wrapTight|wrapThrough|wrapTopAndBottom)\b/i)?.[1];
  const wrapTextRaw = wrapTag ? getAttribute(wrapTag, "wrapText")?.trim() : undefined;
  const behindDocument = getAttribute(anchorTag, "behindDoc") === "1";
  const wrapType =
    wrapTypeRaw === "wrapNone"
      ? "none"
      : wrapTypeRaw === "wrapSquare"
        ? "square"
        : wrapTypeRaw === "wrapTight"
          ? "tight"
          : wrapTypeRaw === "wrapThrough"
            ? "through"
            : wrapTypeRaw === "wrapTopAndBottom"
              ? "topAndBottom"
              : undefined;
  const wrapText =
    wrapTextRaw === "bothSides" ||
    wrapTextRaw === "left" ||
    wrapTextRaw === "right" ||
    wrapTextRaw === "largest"
      ? wrapTextRaw
      : undefined;

  if (
    xPx === undefined &&
    yPx === undefined &&
    !horizontalAlign &&
    !verticalAlign &&
    !horizontalRelativeTo &&
    !verticalRelativeTo &&
    distLPx === undefined &&
    distRPx === undefined &&
    distTPx === undefined &&
    distBPx === undefined &&
    !wrapType &&
    !wrapText &&
    zIndex === undefined &&
    !behindDocument
  ) {
    return undefined;
  }

  return {
    xPx,
    yPx,
    horizontalAlign:
      horizontalAlign === "left" ||
      horizontalAlign === "center" ||
      horizontalAlign === "right" ||
      horizontalAlign === "inside" ||
      horizontalAlign === "outside"
        ? horizontalAlign
        : undefined,
    verticalAlign:
      verticalAlign === "top" ||
      verticalAlign === "center" ||
      verticalAlign === "bottom" ||
      verticalAlign === "inside" ||
      verticalAlign === "outside"
        ? verticalAlign
        : undefined,
    horizontalRelativeTo,
    verticalRelativeTo,
    distLPx,
    distRPx,
    distTPx,
    distBPx,
    wrapType,
    wrapText,
    behindDocument,
    zIndex
  };
}

interface ParsedTextBoxParagraph {
  text: string;
  style?: TextStyle;
  align?: ParagraphAlignment;
}

interface ParsedTextBoxLayout {
  paddingLeftPx?: number;
  paddingTopPx?: number;
  paddingRightPx?: number;
  paddingBottomPx?: number;
  verticalAnchor?: "top" | "center" | "bottom";
}

function parseTextBoxParagraphs(
  runXml: string,
  context: ParseContext
): ParsedTextBoxParagraph[] {
  const normalizedRunXml = preferAlternateContentChoice(runXml);
  const textBoxXml = extractBalancedTagBlocks(normalizedRunXml, "w:txbxContent")[0];
  if (!textBoxXml) {
    return [];
  }

  const paragraphs = extractBalancedTagBlocks(textBoxXml, "w:p");
  const resolved: ParsedTextBoxParagraph[] = [];

  for (const paragraphXml of paragraphs) {
    const paragraphText = parseRunText(paragraphXml).replace(/\n+$/g, "");
    if (paragraphText.length === 0) {
      continue;
    }

    const paragraphPropertiesXml =
      extractBalancedTagBlocks(paragraphXml, "w:pPr")[0] ?? paragraphXml.match(/<w:pPr\b[^>]*\/?>/i)?.[0] ?? "";
    const paragraphStyleId = paragraphPropertiesXml.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/i)?.[1];
    const paragraphStyle = paragraphStyleId ? context.styleSheet.paragraphStyleById.get(paragraphStyleId) : undefined;

    const firstRunXml = extractBalancedTagBlocks(paragraphXml, "w:r")[0];
    const runPropertiesXml = firstRunXml
      ? extractBalancedTagBlocks(firstRunXml, "w:rPr")[0] ?? firstRunXml.match(/<w:rPr\b[^>]*\/?>/i)?.[0] ?? ""
      : "";
    const paragraphRunPropertiesXml =
      extractBalancedTagBlocks(paragraphPropertiesXml, "w:rPr")[0] ??
      paragraphPropertiesXml.match(/<w:rPr\b[^>]*\/?>/i)?.[0] ??
      "";

    const style = mergeTextStyles(
      context.styleSheet.defaultRunStyle,
      paragraphStyle?.runStyle,
      parseTextStyleFromXml(paragraphRunPropertiesXml, context.styleSheet.themeFonts),
      parseTextStyleFromXml(runPropertiesXml, context.styleSheet.themeFonts)
    );
    const align = parseParagraphAlignFromXml(paragraphPropertiesXml) ?? paragraphStyle?.align;

    resolved.push({
      text: paragraphText,
      style,
      align
    });
  }

  return resolved;
}

function parseTextBoxLayout(runXml: string): ParsedTextBoxLayout | undefined {
  const normalizedRunXml = preferAlternateContentChoice(runXml);
  const bodyPrXml =
    extractBalancedTagBlocks(normalizedRunXml, "wps:bodyPr")[0] ??
    normalizedRunXml.match(/<wps:bodyPr\b[^>]*\/?>/i)?.[0] ??
    "";
  if (!bodyPrXml) {
    return undefined;
  }

  const anchorRaw = getAttribute(bodyPrXml, "anchor")?.trim().toLowerCase();
  const verticalAnchor =
    anchorRaw === "ctr"
      ? "center"
      : anchorRaw === "b"
      ? "bottom"
      : "top";

  return {
    paddingLeftPx: emuToPixels(getAttribute(bodyPrXml, "lIns")),
    paddingTopPx: emuToPixels(getAttribute(bodyPrXml, "tIns")),
    paddingRightPx: emuToPixels(getAttribute(bodyPrXml, "rIns")),
    paddingBottomPx: emuToPixels(getAttribute(bodyPrXml, "bIns")),
    verticalAnchor,
  };
}

function parseDrawingImageCssFilter(runXml: string): string | undefined {
  const filters: string[] = [];

  if (/<a14:artisticPastelsSmooth\b/i.test(runXml)) {
    filters.push("saturate(0.76)", "contrast(0.94)", "brightness(1.04)");
  }

  const colorTemperatureRaw = runXml.match(/<a14:colorTemperature\b[^>]*colorTemp="(\d+)"/i)?.[1];
  const colorTemperature = colorTemperatureRaw ? Number(colorTemperatureRaw) : undefined;
  if (Number.isFinite(colorTemperature)) {
    if ((colorTemperature as number) >= 9000) {
      filters.push("hue-rotate(-6deg)", "saturate(1.04)");
    } else if ((colorTemperature as number) <= 4500) {
      filters.push("sepia(0.1)", "saturate(1.02)");
    }
  }

  const hasDuotoneAccent3 = /<a:duotone>[\s\S]*?<a:schemeClr\b[^>]*val="accent3"/i.test(runXml);
  if (hasDuotoneAccent3) {
    filters.push("grayscale(1)", "sepia(0.55)", "hue-rotate(35deg)", "saturate(1.55)", "brightness(0.9)");
  }

  return filters.length > 0 ? filters.join(" ") : undefined;
}

function parseDrawingImageOpacity(runXml: string): number | undefined {
  const alphaRaw = runXml.match(/<a:alphaModFix\b[^>]*amt="(\d+)"/i)?.[1];
  if (!alphaRaw) {
    return undefined;
  }

  const alpha = Number(alphaRaw);
  if (!Number.isFinite(alpha)) {
    return undefined;
  }

  return Math.max(0, Math.min(1, alpha / 100000));
}

function parseDrawingImageCrop(
  runXml: string
): ImageRunNode["crop"] | undefined {
  const srcRectTag =
    runXml.match(/<a:srcRect\b[^>]*\/>/i)?.[0] ??
    runXml.match(/<a:srcRect\b[^>]*>[\s\S]*?<\/a:srcRect>/i)?.[0];
  if (!srcRectTag) {
    return undefined;
  }

  const parseCropFraction = (attributeName: string): number | undefined => {
    const rawValue = getAttribute(srcRectTag, attributeName);
    if (!rawValue) {
      return undefined;
    }

    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      return undefined;
    }

    return Math.max(0, Math.min(1, value / 100000));
  };

  const crop = {
    leftFraction: parseCropFraction("l"),
    topFraction: parseCropFraction("t"),
    rightFraction: parseCropFraction("r"),
    bottomFraction: parseCropFraction("b")
  };

  return Object.values(crop).some((value) => Number.isFinite(value) && (value as number) > 0)
    ? crop
    : undefined;
}

function renderTextBoxSvg(
  paragraphs: ParsedTextBoxParagraph[],
  widthPx: number | undefined,
  heightPx: number | undefined,
  layout?: ParsedTextBoxLayout
): string {
  const safeWidth = clamp(Math.round(widthPx ?? 320), 80, 2400);
  const lineHeights = paragraphs.map((paragraph) => {
    const fontSizePt = paragraph.style?.fontSizePt ?? 12;
    const fontSizePx = Math.max(10, Math.round((fontSizePt * 96) / 72));
    return Math.max(14, Math.round(fontSizePx * 1.24));
  });
  const estimatedHeight = lineHeights.reduce((sum, lineHeight) => sum + lineHeight, 24);
  const safeHeight = clamp(Math.round(heightPx ?? estimatedHeight), 48, 2400);
  const horizontalInset = Math.max(
    8,
    Math.round(layout?.paddingLeftPx ?? safeWidth * 0.03)
  );
  const topInset = Math.max(
    8,
    Math.round(layout?.paddingTopPx ?? safeHeight * 0.04)
  );
  const rightInset = Math.max(
    8,
    Math.round(layout?.paddingRightPx ?? horizontalInset)
  );
  const bottomInset = Math.max(
    8,
    Math.round(layout?.paddingBottomPx ?? topInset)
  );
  const maxTextWidth = Math.max(20, safeWidth - horizontalInset * 2);
  const totalTextHeight = lineHeights.reduce(
    (sum, lineHeight) => sum + lineHeight,
    0
  );
  const availableHeight = Math.max(0, safeHeight - topInset - bottomInset);
  const startOffsetY =
    layout?.verticalAnchor === "center"
      ? topInset + Math.max(0, Math.round((availableHeight - totalTextHeight) / 2))
      : layout?.verticalAnchor === "bottom"
      ? Math.max(topInset, safeHeight - bottomInset - totalTextHeight)
      : topInset;

  let cursorY = startOffsetY;
  const lines: string[] = [];

  for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
    const fontSizePt = paragraph.style?.fontSizePt ?? 12;
    const fontSizePx = Math.max(10, Math.round((fontSizePt * 96) / 72));
    const estimatedTextWidth = estimateTextWidthPx(paragraph.text, fontSizePx);
    const overflowRatio = estimatedTextWidth > 0 ? maxTextWidth / estimatedTextWidth : 1;
    const fittedFontSizePx = overflowRatio < 1 ? Math.max(10, Math.round(fontSizePx * overflowRatio)) : fontSizePx;
    const textLengthAttr =
      estimatedTextWidth > maxTextWidth + 1
        ? ` textLength="${Math.round(maxTextWidth)}" lengthAdjust="spacingAndGlyphs"`
        : "";
    const lineHeight = lineHeights[paragraphIndex] ?? Math.max(14, Math.round(fittedFontSizePx * 1.24));
    cursorY += lineHeight;
    if (cursorY > safeHeight - 4) {
      break;
    }

    const textAlign = paragraph.align ?? "left";
    const anchor =
      textAlign === "center"
        ? "middle"
        : textAlign === "right"
          ? "end"
          : "start";
    const x =
      textAlign === "center"
        ? Math.round(safeWidth / 2)
        : textAlign === "right"
          ? safeWidth - rightInset
          : horizontalInset;
    const textDecoration = [
      paragraph.style?.underline ? "underline" : "",
      paragraph.style?.strike ? "line-through" : ""
    ]
      .filter(Boolean)
      .join(" ");

    lines.push(
      `<text xml:space="preserve" x="${x}" y="${cursorY}" text-anchor="${anchor}" font-size="${fittedFontSizePx}" fill="${
        paragraph.style?.color ?? "#111111"
      }" font-family="${escapeXmlText(resolveSvgFontFamily(paragraph.style?.fontFamily))}" font-weight="${
        paragraph.style?.bold ? "700" : "400"
      }" font-style="${paragraph.style?.italic ? "italic" : "normal"}"${
        textDecoration ? ` text-decoration="${textDecoration}"` : ""
      }${textLengthAttr}>${escapeXmlText(paragraph.text)}</text>`
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}">
    <rect x="0" y="0" width="${safeWidth}" height="${safeHeight}" fill="none"/>
    ${lines.join("")}
  </svg>`;
}

function cssLengthToPixels(value: string, unit: string): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  switch (unit.toLowerCase()) {
    case "px":
      return Math.round(numeric);
    case "pt":
      return Math.round((numeric * 96) / 72);
    case "in":
      return Math.round(numeric * 96);
    case "cm":
      return Math.round((numeric * 96) / 2.54);
    case "mm":
      return Math.round((numeric * 96) / 25.4);
    default:
      return undefined;
  }
}

function parseCssStyleDeclarations(styleValue: string): Map<string, string> {
  const declarations = new Map<string, string>();

  styleValue
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .forEach((entry) => {
      const separatorIndex = entry.indexOf(":");
      if (separatorIndex <= 0) {
        return;
      }

      const key = entry.slice(0, separatorIndex).trim().toLowerCase();
      const value = entry.slice(separatorIndex + 1).trim();
      if (!key || !value) {
        return;
      }

      declarations.set(key, value);
    });

  return declarations;
}

function parseCssLengthPixels(styleToken: string | undefined): number | undefined {
  if (!styleToken) {
    return undefined;
  }

  const match = styleToken.match(/(-?[0-9]+(?:\.[0-9]+)?)\s*(px|pt|in|cm|mm)\b/i);
  if (!match?.[1] || !match?.[2]) {
    return undefined;
  }

  return cssLengthToPixels(match[1], match[2]);
}

function parseVmlSize(runXml: string): { widthPx?: number; heightPx?: number } {
  const shapeTagMatch = runXml.match(/<v:shape\b[^>]*>/i);
  const shapeTag = shapeTagMatch?.[0] ?? "";
  const style = getAttribute(shapeTag, "style");
  if (!style) {
    return {};
  }

  const widthMatch = style.match(/width:\s*([0-9.]+)\s*(px|pt|in|cm|mm)/i);
  const heightMatch = style.match(/height:\s*([0-9.]+)\s*(px|pt|in|cm|mm)/i);

  return {
    widthPx: widthMatch?.[1] && widthMatch?.[2] ? cssLengthToPixels(widthMatch[1], widthMatch[2]) : undefined,
    heightPx:
      heightMatch?.[1] && heightMatch?.[2] ? cssLengthToPixels(heightMatch[1], heightMatch[2]) : undefined
  };
}

function parseVmlFloatingAnchorFromRunXml(
  runXml: string
): ImageRunNode["floating"] | undefined {
  type Floating = NonNullable<ImageRunNode["floating"]>;
  const shapeTag = runXml.match(/<v:shape\b[^>]*>/i)?.[0] ?? "";
  const styleValue = getAttribute(shapeTag, "style");
  if (!styleValue) {
    return undefined;
  }

  const declarations = parseCssStyleDeclarations(styleValue);
  if (declarations.size === 0) {
    return undefined;
  }

  const normalizeRelativeTo = (
    raw: string | undefined,
    axis: "horizontal" | "vertical"
  ): string | undefined => {
    const normalized = raw?.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }

    if (
      normalized === "page" ||
      normalized === "margin" ||
      normalized === "column" ||
      normalized === "paragraph" ||
      normalized === "line"
    ) {
      return normalized;
    }

    if (normalized === "text") {
      return axis === "horizontal" ? "paragraph" : "paragraph";
    }

    if (normalized === "char" || normalized === "character") {
      return axis === "horizontal" ? "line" : "line";
    }

    return undefined;
  };

  const normalizeAlign = (
    raw: string | undefined
  ): Floating["horizontalAlign"] | Floating["verticalAlign"] => {
    const normalized = raw?.trim().toLowerCase();
    if (
      normalized === "left" ||
      normalized === "center" ||
      normalized === "right" ||
      normalized === "inside" ||
      normalized === "outside" ||
      normalized === "top" ||
      normalized === "bottom"
    ) {
      return normalized as
        | "left"
        | "center"
        | "right"
        | "inside"
        | "outside"
        | "top"
        | "bottom";
    }

    return undefined;
  };

  const normalizeWrapType = (
    raw: string | undefined
  ): Floating["wrapType"] => {
    const normalized = raw?.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }

    if (normalized === "square") {
      return "square";
    }
    if (normalized === "tight") {
      return "tight";
    }
    if (normalized === "through") {
      return "through";
    }
    if (
      normalized === "topandbottom" ||
      normalized === "top-and-bottom" ||
      normalized === "topbottom"
    ) {
      return "topAndBottom";
    }
    if (normalized === "none" || normalized === "inline") {
      return "none";
    }

    return undefined;
  };

  const parseNumeric = (raw: string | undefined): number | undefined => {
    if (!raw) {
      return undefined;
    }
    const parsed = Number(raw.trim());
    if (!Number.isFinite(parsed)) {
      return undefined;
    }
    return Math.round(parsed);
  };

  const xPx =
    parseCssLengthPixels(declarations.get("left")) ??
    parseCssLengthPixels(declarations.get("margin-left"));
  const yPx =
    parseCssLengthPixels(declarations.get("top")) ??
    parseCssLengthPixels(declarations.get("margin-top"));
  const horizontalRelativeTo = normalizeRelativeTo(
    declarations.get("mso-position-horizontal-relative"),
    "horizontal"
  );
  const verticalRelativeTo = normalizeRelativeTo(
    declarations.get("mso-position-vertical-relative"),
    "vertical"
  );
  const horizontalPositionMode = declarations
    .get("mso-position-horizontal")
    ?.trim()
    .toLowerCase();
  const verticalPositionMode = declarations
    .get("mso-position-vertical")
    ?.trim()
    .toLowerCase();
  const horizontalAlign =
    horizontalPositionMode && horizontalPositionMode !== "absolute"
      ? (normalizeAlign(horizontalPositionMode) as Floating["horizontalAlign"])
      : undefined;
  const verticalAlign =
    verticalPositionMode && verticalPositionMode !== "absolute"
      ? (normalizeAlign(verticalPositionMode) as Floating["verticalAlign"])
      : undefined;
  const distLPx = parseCssLengthPixels(declarations.get("mso-wrap-distance-left"));
  const distRPx = parseCssLengthPixels(declarations.get("mso-wrap-distance-right"));
  const distTPx = parseCssLengthPixels(declarations.get("mso-wrap-distance-top"));
  const distBPx = parseCssLengthPixels(declarations.get("mso-wrap-distance-bottom"));
  const wrapType = normalizeWrapType(declarations.get("mso-wrap-style"));
  const zIndex = parseNumeric(declarations.get("z-index"));
  const behindDocument = zIndex !== undefined ? zIndex < 0 : undefined;

  if (
    xPx === undefined &&
    yPx === undefined &&
    !horizontalRelativeTo &&
    !verticalRelativeTo &&
    !horizontalAlign &&
    !verticalAlign &&
    distLPx === undefined &&
    distRPx === undefined &&
    distTPx === undefined &&
    distBPx === undefined &&
    !wrapType &&
    zIndex === undefined
  ) {
    return undefined;
  }

  return {
    xPx,
    yPx,
    horizontalAlign,
    verticalAlign,
    horizontalRelativeTo,
    verticalRelativeTo,
    distLPx: distLPx !== undefined ? Math.max(0, distLPx) : undefined,
    distRPx: distRPx !== undefined ? Math.max(0, distRPx) : undefined,
    distTPx: distTPx !== undefined ? Math.max(0, distTPx) : undefined,
    distBPx: distBPx !== undefined ? Math.max(0, distBPx) : undefined,
    wrapType,
    behindDocument: behindDocument === true,
    zIndex,
  };
}

interface ParsedChartSeries {
  name: string;
  values: number[];
  categories: string[];
  color: string;
}

interface ParsedChartData {
  kind: "bar" | "line" | "pie" | "doughnut";
  title?: string;
  categories: string[];
  series: ParsedChartSeries[];
}

const CHART_COLOR_PALETTE = [
  "#2563eb",
  "#f97316",
  "#22c55e",
  "#eab308",
  "#a855f7",
  "#06b6d4",
  "#ef4444",
  "#14b8a6"
];

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function estimateTextWidthPx(text: string, fontSizePx: number): number {
  if (!text) {
    return 0;
  }

  let widthUnits = 0;
  for (const char of text) {
    if (/\s/.test(char)) {
      widthUnits += 0.34;
    } else if (/[A-Z]/.test(char)) {
      widthUnits += 0.66;
    } else if (/[a-z]/.test(char)) {
      widthUnits += 0.55;
    } else if (/[0-9]/.test(char)) {
      widthUnits += 0.57;
    } else if (/[\u2e80-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(char)) {
      widthUnits += 1;
    } else {
      widthUnits += 0.45;
    }
  }

  return widthUnits * fontSizePx;
}

function resolveSvgFontFamily(fontFamily: string | undefined): string {
  const trimmed = (fontFamily ?? "").trim();
  if (!trimmed) {
    return "Calibri, Arial, sans-serif";
  }

  if (trimmed.includes(",")) {
    return trimmed;
  }

  if (/times|georgia|garamond|serif/i.test(trimmed)) {
    return `${trimmed}, serif`;
  }

  return `${trimmed}, Arial, sans-serif`;
}

function chartColor(rawColor: string | undefined, index: number): string {
  const normalized = normalizeHexColor(rawColor);
  if (normalized) {
    return normalized;
  }

  return CHART_COLOR_PALETTE[index % CHART_COLOR_PALETTE.length];
}

function parseChartPoints(xml: string): string[] {
  const values = [...xml.matchAll(/<c:pt\b[\s\S]*?<c:v>([\s\S]*?)<\/c:v>[\s\S]*?<\/c:pt>/gi)].map(
    (match) => decodeXmlEntities(match[1] ?? "").trim()
  );

  if (values.length > 0) {
    return values;
  }

  const fallback = [...xml.matchAll(/<c:v>([\s\S]*?)<\/c:v>/gi)].map((match) =>
    decodeXmlEntities(match[1] ?? "").trim()
  );
  return fallback;
}

function parseChartTitle(chartXml: string): string | undefined {
  const titleXml = chartXml.match(/<c:title\b[\s\S]*?<\/c:title>/i)?.[0];
  if (!titleXml) {
    return undefined;
  }

  const title = [...titleXml.matchAll(/<(?:a:t|c:v)\b[^>]*>([\s\S]*?)<\/(?:a:t|c:v)>/gi)]
    .map((match) => decodeXmlEntities(match[1] ?? ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return title || undefined;
}

function parseChartType(chartXml: string): ParsedChartData["kind"] | undefined {
  if (/<c:barChart\b/i.test(chartXml)) {
    return "bar";
  }
  if (/<c:lineChart\b/i.test(chartXml)) {
    return "line";
  }
  if (/<c:pieChart\b/i.test(chartXml)) {
    return "pie";
  }
  if (/<c:doughnutChart\b/i.test(chartXml)) {
    return "doughnut";
  }

  return undefined;
}

function parseChartNumber(rawValue: string): number {
  const parsed = Number(rawValue.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseChartData(chartXml: string): ParsedChartData | undefined {
  const kind = parseChartType(chartXml);
  if (!kind) {
    return undefined;
  }

  const seriesBlocks = extractBalancedTagBlocks(chartXml, "c:ser");
  const series = seriesBlocks
    .map((seriesXml, index): ParsedChartSeries | undefined => {
      const name =
        parseChartPoints(seriesXml.match(/<c:tx\b[\s\S]*?<\/c:tx>/i)?.[0] ?? "")[0] ??
        `Series ${index + 1}`;
      const values = parseChartPoints(seriesXml.match(/<c:val\b[\s\S]*?<\/c:val>/i)?.[0] ?? "").map(
        parseChartNumber
      );
      const categories = parseChartPoints(seriesXml.match(/<c:cat\b[\s\S]*?<\/c:cat>/i)?.[0] ?? "");
      const color = chartColor(seriesXml.match(/<a:srgbClr\b[^>]*val="([^"]+)"/i)?.[1], index);

      if (values.length === 0) {
        return undefined;
      }

      return {
        name: name.trim() || `Series ${index + 1}`,
        values,
        categories,
        color
      };
    })
    .filter((item): item is ParsedChartSeries => Boolean(item));

  if (series.length === 0) {
    return undefined;
  }

  const pointCount = Math.max(...series.map((item) => Math.max(item.values.length, item.categories.length)), 0);
  const categoriesTemplate = series.find((item) => item.categories.length > 0)?.categories ?? [];
  const categories = Array.from({ length: pointCount }, (_, index) => {
    const label = categoriesTemplate[index] ?? `Item ${index + 1}`;
    return label.trim() || `Item ${index + 1}`;
  });

  return {
    kind,
    title: parseChartTitle(chartXml),
    categories,
    series: series.map((item) => ({
      ...item,
      values: Array.from({ length: pointCount }, (_, index) =>
        Number.isFinite(item.values[index]) ? item.values[index] : 0
      )
    }))
  };
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function renderCartesianChartSvg(
  chart: ParsedChartData,
  widthPx: number,
  heightPx: number
): string {
  const title = chart.title ? `<text x="16" y="20" font-size="14" fill="#111827">${escapeXmlText(chart.title)}</text>` : "";

  const margin = {
    top: chart.title ? 34 : 22,
    right: 20,
    bottom: 54,
    left: 54
  };
  const plotWidth = Math.max(40, widthPx - margin.left - margin.right);
  const plotHeight = Math.max(40, heightPx - margin.top - margin.bottom);

  const allValues = chart.series.flatMap((series) => series.values);
  const maxValue = Math.max(1, ...allValues, 0);
  const gridLines = 4;
  const grid = Array.from({ length: gridLines + 1 }, (_, step) => {
    const value = (maxValue * (gridLines - step)) / gridLines;
    const y = margin.top + (plotHeight * step) / gridLines;
    return `<line x1="${margin.left}" y1="${y}" x2="${margin.left + plotWidth}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/><text x="${margin.left - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#6b7280">${value.toFixed(1)}</text>`;
  }).join("");

  const categoryCount = Math.max(1, chart.categories.length);
  const groupWidth = plotWidth / categoryCount;
  const categoryLabels = chart.categories
    .map((category, index) => {
      const x = margin.left + groupWidth * index + groupWidth / 2;
      return `<text x="${x}" y="${margin.top + plotHeight + 18}" text-anchor="middle" font-size="10" fill="#4b5563">${escapeXmlText(category)}</text>`;
    })
    .join("");

  let seriesMarkup = "";
  if (chart.kind === "bar") {
    const seriesCount = Math.max(1, chart.series.length);
    const barGroupWidth = groupWidth * 0.8;
    const barWidth = Math.max(2, barGroupWidth / seriesCount - 2);

    seriesMarkup = chart.series
      .map((series, seriesIndex) =>
        series.values
          .map((value, pointIndex) => {
            const safeValue = Math.max(0, value);
            const barHeight = (safeValue / maxValue) * plotHeight;
            const x =
              margin.left +
              pointIndex * groupWidth +
              (groupWidth - barGroupWidth) / 2 +
              seriesIndex * (barGroupWidth / seriesCount);
            const y = margin.top + plotHeight - barHeight;
            return `<rect x="${x}" y="${y}" width="${barWidth}" height="${Math.max(
              1,
              barHeight
            )}" fill="${series.color}" rx="1.5"/>`;
          })
          .join("")
      )
      .join("");
  } else {
    seriesMarkup = chart.series
      .map((series) => {
        const points = series.values
          .map((value, index) => {
            const safeValue = Math.max(0, value);
            const x = margin.left + groupWidth * index + groupWidth / 2;
            const y = margin.top + plotHeight - (safeValue / maxValue) * plotHeight;
            return { x, y };
          })
          .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

        if (points.length === 0) {
          return "";
        }

        const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");
        const circles = points
          .map((point) => `<circle cx="${point.x}" cy="${point.y}" r="2.5" fill="${series.color}" />`)
          .join("");
        return `<path d="${path}" fill="none" stroke="${series.color}" stroke-width="2" />${circles}`;
      })
      .join("");
  }

  const legend = chart.series
    .map((series, index) => {
      const x = margin.left + index * 120;
      const y = 8;
      return `<rect x="${x}" y="${y}" width="10" height="10" rx="2" fill="${series.color}"/><text x="${
        x + 14
      }" y="${y + 9}" font-size="10" fill="#374151">${escapeXmlText(series.name)}</text>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
    <rect x="0" y="0" width="${widthPx}" height="${heightPx}" fill="#ffffff"/>
    ${title}
    ${grid}
    <line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${margin.left + plotWidth}" y2="${margin.top + plotHeight}" stroke="#9ca3af"/>
    <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}" stroke="#9ca3af"/>
    ${seriesMarkup}
    ${categoryLabels}
    ${legend}
  </svg>`;
}

function polarToCartesian(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians)
  };
}

function renderPieChartSvg(chart: ParsedChartData, widthPx: number, heightPx: number): string {
  const baseSeries = chart.series[0];
  const values = baseSeries?.values ?? [];
  const total = Math.max(0.0001, values.reduce((sum, value) => sum + Math.max(0, value), 0));
  const categories =
    chart.categories.length > 0 ? chart.categories : values.map((_, index) => `Item ${index + 1}`);
  const colors = chart.series.length > 1 ? chart.series.map((item) => item.color) : CHART_COLOR_PALETTE;

  const centerX = Math.round(widthPx * 0.34);
  const centerY = Math.round(heightPx * 0.56);
  const outerRadius = Math.max(30, Math.min(Math.round(Math.min(widthPx, heightPx) * 0.26), 160));
  const innerRadius = chart.kind === "doughnut" ? Math.round(outerRadius * 0.55) : 0;

  let startAngle = 0;
  const slices = values
    .map((value, index) => {
      const safeValue = Math.max(0, value);
      const angle = (safeValue / total) * 360;
      const endAngle = startAngle + Math.max(0.001, angle);
      const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
      const fill = colors[index % colors.length];

      const startOuter = polarToCartesian(centerX, centerY, outerRadius, startAngle);
      const endOuter = polarToCartesian(centerX, centerY, outerRadius, endAngle);

      let path = "";
      if (innerRadius > 0) {
        const startInner = polarToCartesian(centerX, centerY, innerRadius, startAngle);
        const endInner = polarToCartesian(centerX, centerY, innerRadius, endAngle);
        path = `M ${startOuter.x} ${startOuter.y} A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${endOuter.x} ${endOuter.y} L ${endInner.x} ${endInner.y} A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${startInner.x} ${startInner.y} Z`;
      } else {
        path = `M ${centerX} ${centerY} L ${startOuter.x} ${startOuter.y} A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${endOuter.x} ${endOuter.y} Z`;
      }

      startAngle = endAngle;
      return `<path d="${path}" fill="${fill}" stroke="#ffffff" stroke-width="1"/>`;
    })
    .join("");

  const title = chart.title
    ? `<text x="16" y="20" font-size="14" fill="#111827">${escapeXmlText(chart.title)}</text>`
    : "";

  const legend = categories
    .map((category, index) => {
      const x = Math.round(widthPx * 0.63);
      const y = 36 + index * 18;
      const color = colors[index % colors.length];
      const value = values[index] ?? 0;
      return `<rect x="${x}" y="${y - 8}" width="10" height="10" rx="2" fill="${color}"/><text x="${
        x + 14
      }" y="${y}" font-size="10" fill="#374151">${escapeXmlText(category)} (${value})</text>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
    <rect x="0" y="0" width="${widthPx}" height="${heightPx}" fill="#ffffff"/>
    ${title}
    ${slices}
    ${legend}
  </svg>`;
}

function chartXmlToSvgDataUri(
  chartXml: string,
  widthPx: number | undefined,
  heightPx: number | undefined
): string | undefined {
  const chart = parseChartData(chartXml);
  if (!chart) {
    return undefined;
  }

  const safeWidth = clamp(Math.round(widthPx ?? 640), 240, 1600);
  const safeHeight = clamp(Math.round(heightPx ?? 360), 180, 1200);

  const svg =
    chart.kind === "pie" || chart.kind === "doughnut"
      ? renderPieChartSvg(chart, safeWidth, safeHeight)
      : renderCartesianChartSvg(chart, safeWidth, safeHeight);

  return svgDataUri(svg);
}

function resolvePreferredDrawingRelationshipId(runXml: string): string | undefined {
  return (
    runXml.match(
      /<a:ext\b[^>]*>[\s\S]*?<asvg:svgBlip\b[^>]*r:embed="([^"]+)"/i
    )?.[1] ??
    runXml.match(
      /<a:ext\b[^>]*>[\s\S]*?<asvg:svgBlip\b[^>]*r:link="([^"]+)"/i
    )?.[1] ??
    runXml.match(/<a:blip\b[^>]*r:embed="([^"]+)"/i)?.[1] ??
    runXml.match(/<a:blip\b[^>]*r:link="([^"]+)"/i)?.[1]
  );
}

function parseRunImageBlock(runXml: string, context: ParseContext): ImageRunNode | undefined {
  const normalizedRunXml = preferAlternateContentChoice(runXml);
  let activeRunXml = normalizedRunXml;
  let extentMatch = activeRunXml.match(/<wp:extent\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"/i);
  let vmlSize = parseVmlSize(activeRunXml);
  let widthPx = extentMatch?.[1] ? emuToPixels(extentMatch[1]) : vmlSize.widthPx;
  let heightPx = extentMatch?.[2] ? emuToPixels(extentMatch[2]) : vmlSize.heightPx;
  let floating =
    parseFloatingAnchorFromRunXml(activeRunXml) ??
    parseVmlFloatingAnchorFromRunXml(activeRunXml);

  const docPrMatch = activeRunXml.match(/<wp:docPr\b[^>]*>/i);
  const docPrTag = docPrMatch?.[0] ?? "";
  const alt =
    getAttribute(docPrTag, "descr") || getAttribute(docPrTag, "title") || getAttribute(docPrTag, "name");

  let chartRelationshipId = activeRunXml.match(/<c:chart\b[^>]*r:id="([^"]+)"/i)?.[1];
  let relationshipId =
    resolvePreferredDrawingRelationshipId(activeRunXml) ??
    activeRunXml.match(/<v:imagedata\b[^>]*r:id="([^"]+)"/i)?.[1] ??
    chartRelationshipId;

  // Prefer the mc:Choice branch when present, but fall back to the full run XML
  // if no image/chart relationship is available there.
  if (!relationshipId && normalizedRunXml !== runXml) {
    activeRunXml = runXml;
    chartRelationshipId = activeRunXml.match(/<c:chart\b[^>]*r:id="([^"]+)"/i)?.[1];
    relationshipId =
      resolvePreferredDrawingRelationshipId(activeRunXml) ??
      activeRunXml.match(/<v:imagedata\b[^>]*r:id="([^"]+)"/i)?.[1] ??
      chartRelationshipId;

    extentMatch = activeRunXml.match(/<wp:extent\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"/i);
    vmlSize = parseVmlSize(activeRunXml);
    widthPx = extentMatch?.[1] ? emuToPixels(extentMatch[1]) : vmlSize.widthPx;
    heightPx = extentMatch?.[2] ? emuToPixels(extentMatch[2]) : vmlSize.heightPx;
    floating =
      parseFloatingAnchorFromRunXml(activeRunXml) ??
      parseVmlFloatingAnchorFromRunXml(activeRunXml);
  }

  const partName = relationshipId ? context.relationships.get(relationshipId) : undefined;
  if (relationshipId && !partName) {
    context.warnings.push(`Missing relationship target for ${relationshipId}`);
  }

  const contentType = partName ? contentTypeForPart(partName, context.contentTypes) : undefined;
  const binary = partName ? context.binaryAssets.get(partName) : undefined;
  const crop = parseDrawingImageCrop(activeRunXml);
  const cssFilter = parseDrawingImageCssFilter(activeRunXml);
  const cssOpacity = parseDrawingImageOpacity(activeRunXml);

  const likelyChartPart =
    Boolean(chartRelationshipId) ||
    partName?.includes("/charts/") ||
    contentType === "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";

  const standaloneShapeSvg = renderStandaloneWordShapeSvg(activeRunXml, widthPx, heightPx, context);
  const containsGroupedOrStandaloneShape = /<wpg:wgp\b|<wps:wsp\b/i.test(activeRunXml);
  const containsTextBoxContent = /<w:txbxContent\b/i.test(activeRunXml);
  if (standaloneShapeSvg && (containsGroupedOrStandaloneShape || !relationshipId)) {
    return {
      type: "image",
      src: svgDataUri(standaloneShapeSvg),
      alt: alt ?? (containsTextBoxContent ? "Text box" : "Shape"),
      widthPx,
      heightPx,
      contentType: "image/svg+xml",
      sourceXml: activeRunXml,
      crop,
      cssFilter,
      cssOpacity,
      floating,
      syntheticTextBox: containsTextBoxContent || undefined
    };
  }

  if (likelyChartPart) {
    const chartXml = partName ? context.parts.get(partName)?.content : undefined;
    if (!chartXml && partName) {
      context.warnings.push(`Missing chart part ${partName}`);
    }

    const chartSrc = chartXml ? chartXmlToSvgDataUri(chartXml, widthPx, heightPx) : undefined;
    if (chartSrc) {
      return {
        type: "image",
        src: chartSrc,
        alt: alt ?? "Chart",
        widthPx,
        heightPx,
        contentType: "image/svg+xml",
        sourceXml: activeRunXml,
        crop,
        cssFilter,
        cssOpacity,
        floating
      };
    }
  }

  if (!relationshipId) {
    const textBoxParagraphs = parseTextBoxParagraphs(activeRunXml, context);
    if (textBoxParagraphs.length === 0) {
      return undefined;
    }

    const textBoxSrc = svgDataUri(
      renderTextBoxSvg(
        textBoxParagraphs,
        widthPx,
        heightPx,
        parseTextBoxLayout(activeRunXml)
      )
    );
    return {
      type: "image",
      src: textBoxSrc,
      alt: alt ?? "Text box",
      widthPx,
      heightPx,
      contentType: "image/svg+xml",
      sourceXml: activeRunXml,
      crop,
      cssFilter,
      cssOpacity,
      floating,
      syntheticTextBox: true
    };
  }

  let src: string | undefined;
  let resolvedContentType = contentType;
  let resolvedCssOpacity = cssOpacity;
  if (binary) {
    const mimeType = contentTypeForPart(partName ?? "", context.contentTypes) ?? contentType ?? "application/octet-stream";
    if (isWindowsMetafileContentType(mimeType, partName)) {
      src = rasterizeWindowsMetafileToPngDataUri(binary, partName);
      if (src) {
        resolvedContentType = "image/png";
        // OOXML alpha modifiers on legacy metafiles do not map cleanly after rasterization.
        // Keeping the CSS opacity as well makes these imports appear doubly faded.
        resolvedCssOpacity = undefined;
      }
    }

    if (!src) {
      src = `data:${mimeType};base64,${bytesToBase64(binary)}`;
      resolvedContentType = mimeType;
    }
  }

  return {
    type: "image",
    src,
    alt,
    widthPx,
    heightPx,
    partName,
    contentType: resolvedContentType,
    data: binary ? new Uint8Array(binary) : undefined,
    sourceXml: activeRunXml,
    crop,
    cssFilter,
    cssOpacity: resolvedCssOpacity,
    floating
  };
}

function parseRunImages(runXml: string, context: ParseContext): ImageRunNode[] {
  const candidateRanges = extractBalancedTagBlocksInOrder(runXml, [
    "mc:AlternateContent",
    "w:drawing",
    "w:pict",
    "w:object"
  ]);
  const candidateXmlBlocks =
    candidateRanges.length > 0
      ? candidateRanges.map((range) => runXml.slice(range.start, range.end))
      : [runXml];

  const images: ImageRunNode[] = [];
  const seenKeys = new Set<string>();
  for (const candidateXml of candidateXmlBlocks) {
    const image = parseRunImageBlock(candidateXml, context);
    if (!image) {
      continue;
    }

    const dedupeKey = JSON.stringify({
      src: image.src,
      contentType: image.contentType,
      widthPx: image.widthPx,
      heightPx: image.heightPx,
      floating: image.floating,
      syntheticTextBox: image.syntheticTextBox
    });
    if (seenKeys.has(dedupeKey)) {
      continue;
    }
    seenKeys.add(dedupeKey);
    images.push(image);
  }

  return images;
}

function parseRelationshipsFromParts(
  parts: OoxmlPackage["parts"],
  partName: string
): Map<string, string> {
  const map = new Map<string, string>();
  const relationshipsPartName = relationshipPartNameForPart(partName);
  const relationshipsPart = parts.get(relationshipsPartName)?.content;
  if (!relationshipsPart) {
    return map;
  }

  for (const match of relationshipsPart.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0];
    const id = getAttribute(tag, "Id");
    const target = getAttribute(tag, "Target");
    if (!id || !target) {
      continue;
    }
    map.set(id, resolvePartPath(partName, target));
  }

  return map;
}

function decodeActiveXBinaryMarkup(binary: Uint8Array): string {
  const utf16 = new TextDecoder("utf-16le", { fatal: false }).decode(binary);
  if (/input\s+type=/i.test(utf16)) {
    return utf16;
  }

  return new TextDecoder("latin1", { fatal: false }).decode(binary);
}

function parseRunActiveXCheckboxField(
  runXml: string,
  context: ParseContext,
  style?: TextStyle,
  link?: string
): FormFieldRunNode | undefined {
  if (!/<w:object\b/i.test(runXml) || !/<w:control\b/i.test(runXml)) {
    return undefined;
  }

  const controlTag = runXml.match(/<w:control\b[^>]*\/?>/i)?.[0];
  const controlRelationshipId = controlTag
    ? getAttribute(controlTag, "r:id")
    : undefined;
  const activeXPartName = controlRelationshipId
    ? context.relationships.get(controlRelationshipId)
    : undefined;
  if (!activeXPartName) {
    return undefined;
  }

  const activeXXml = context.parts.get(activeXPartName)?.content;
  if (!activeXXml) {
    return undefined;
  }

  const binaryRelationshipId = getAttribute(
    activeXXml.match(/<ax:ocx\b[^>]*\/?>/i)?.[0] ?? "",
    "r:id"
  );
  if (!binaryRelationshipId) {
    return undefined;
  }

  const activeXRelationships = parseRelationshipsFromParts(
    context.parts,
    activeXPartName
  );
  const activeXBinaryPartName = activeXRelationships.get(binaryRelationshipId);
  if (!activeXBinaryPartName) {
    return undefined;
  }

  const activeXBinary = context.binaryAssets.get(activeXBinaryPartName);
  if (!activeXBinary || activeXBinary.byteLength === 0) {
    return undefined;
  }

  const markup = decodeActiveXBinaryMarkup(activeXBinary);
  if (!/input\s+type\s*=\s*"checkbox"/i.test(markup)) {
    return undefined;
  }

  const name =
    markup.match(/\bname\s*=\s*"([^"]+)"/i)?.[1]?.trim() || undefined;

  return {
    type: "form-field",
    fieldType: "checkbox",
    sourceKind: "legacy",
    checked: /\bchecked\b/i.test(markup),
    checkedSymbol: "☒",
    uncheckedSymbol: "☐",
    widget: {
      name,
    },
    style,
    link,
    sourceXml: runXml,
  };
}

interface ParagraphRunToken {
  xml: string;
  start: number;
  end: number;
  link?: string;
}

function hyperlinkHrefFromTag(hyperlinkTag: string, context: ParseContext): string | undefined {
  const relationshipId = getAttribute(hyperlinkTag, "r:id");
  const anchor = getAttribute(hyperlinkTag, "w:anchor");

  const relationshipTarget = relationshipId ? context.relationships.get(relationshipId) : undefined;
  if (relationshipId && !relationshipTarget) {
    context.warnings.push(`Missing hyperlink relationship target for ${relationshipId}`);
  }

  if (anchor && relationshipTarget) {
    return relationshipTarget.includes("#") ? relationshipTarget : `${relationshipTarget}#${anchor}`;
  }
  if (relationshipTarget) {
    return relationshipTarget;
  }
  if (anchor) {
    return `#${anchor}`;
  }

  return undefined;
}

function hyperlinkHrefFromFieldInstruction(rawInstruction: string): string | undefined {
  if (!rawInstruction) {
    return undefined;
  }

  const instruction = decodeXmlEntities(rawInstruction).replace(/\s+/g, " ").trim();
  if (!/\bHYPERLINK\b/i.test(instruction)) {
    return undefined;
  }

  const anchorMatch = instruction.match(/\\l\s+"([^"]+)"/i);
  const explicitTargetMatch = instruction.match(/\bHYPERLINK\b\s+(?:"([^"]+)"|([^\s\\]+))/i);

  const target = explicitTargetMatch?.[1] ?? explicitTargetMatch?.[2];
  if (target) {
    if (anchorMatch?.[1] && !target.includes("#")) {
      return `${target}#${anchorMatch[1]}`;
    }
    return target;
  }

  if (anchorMatch?.[1]) {
    return `#${anchorMatch[1]}`;
  }

  return undefined;
}

function parseParagraphRuns(paragraphXml: string, context: ParseContext): ParagraphRunToken[] {
  const runRanges = extractBalancedTagRanges(paragraphXml, "w:r");
  if (runRanges.length === 0) {
    return [];
  }

  const hyperlinkRanges = extractBalancedTagRanges(paragraphXml, "w:hyperlink").map((range) => {
    const hyperlinkXml = paragraphXml.slice(range.start, range.end);
    const hyperlinkTag = hyperlinkXml.match(/<w:hyperlink\b[^>]*>/i)?.[0] ?? "";

    return {
      ...range,
      href: hyperlinkHrefFromTag(hyperlinkTag, context)
    };
  });

  const fieldLinksByRun = new Map<number, string>();
  let fieldDepth = 0;
  let instructionParts: string[] = [];
  let activeFieldLink: string | undefined;

  runRanges.forEach((range, runIndex) => {
    const runXml = paragraphXml.slice(range.start, range.end);

    const beginCount = [...runXml.matchAll(/<w:fldChar\b[^>]*w:fldCharType="begin"[^>]*\/?>/gi)].length;
    const separateCount = [...runXml.matchAll(/<w:fldChar\b[^>]*w:fldCharType="separate"[^>]*\/?>/gi)].length;
    const endCount = [...runXml.matchAll(/<w:fldChar\b[^>]*w:fldCharType="end"[^>]*\/?>/gi)].length;

    if (beginCount > 0 && fieldDepth === 0) {
      instructionParts = [];
      activeFieldLink = undefined;
    }
    fieldDepth += beginCount;

    if (fieldDepth > 0 && activeFieldLink === undefined) {
      for (const instructionMatch of runXml.matchAll(/<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/gi)) {
        instructionParts.push(instructionMatch[1] ?? "");
      }
    }

    if (fieldDepth > 0 && separateCount > 0 && activeFieldLink === undefined) {
      activeFieldLink = hyperlinkHrefFromFieldInstruction(instructionParts.join(" "));
    }

    if (fieldDepth > 0 && activeFieldLink) {
      if (/<(?:w:t|a:t)\b/i.test(runXml) || /<w:(?:drawing|pict)\b/i.test(runXml)) {
        fieldLinksByRun.set(runIndex, activeFieldLink);
      }
    }

    if (endCount > 0) {
      fieldDepth = Math.max(0, fieldDepth - endCount);
      if (fieldDepth === 0) {
        instructionParts = [];
        activeFieldLink = undefined;
      }
    }
  });

  return runRanges.map((range, runIndex) => {
    const link = hyperlinkRanges.find(
      (hyperlinkRange) =>
        range.start >= hyperlinkRange.start &&
        range.end <= hyperlinkRange.end &&
        hyperlinkRange.href
    )?.href ?? fieldLinksByRun.get(runIndex);

    return {
      xml: paragraphXml.slice(range.start, range.end),
      start: range.start,
      end: range.end,
      link
    };
  });
}

interface ParagraphFormFieldToken {
  start: number;
  end: number;
  field: FormFieldRunNode;
}

function onOffValueToBoolean(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (["0", "false", "off", "no"].includes(normalized)) {
    return false;
  }

  return true;
}

function decodeHexCodePoint(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().replace(/^0x/i, "");
  if (!/^[0-9a-f]+$/i.test(normalized)) {
    return undefined;
  }

  const codePoint = Number.parseInt(normalized, 16);
  if (!Number.isFinite(codePoint) || codePoint <= 0) {
    return undefined;
  }

  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return undefined;
  }
}

function decodeXmlAttribute(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return decodeXmlEntities(value);
}

function parseOnOffTagValue(
  tagXml: string | undefined,
  attributes: string[] = ["w:val"]
): boolean | undefined {
  if (!tagXml) {
    return undefined;
  }

  for (const attribute of attributes) {
    const rawValue = getAttribute(tagXml, attribute);
    if (rawValue !== undefined) {
      return onOffValueToBoolean(rawValue);
    }
  }

  return true;
}

function normalizeLegacyFormDisplayValue(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value
    .replace(/\u2002/g, " ")
    .replace(/\u2003/g, " ")
    .replace(/\u00a0/g, " ");
  return normalized.trim().length > 0 ? normalized : undefined;
}

function parseLegacyFormFieldFromRange(
  paragraphXml: string,
  runs: ParagraphRunToken[],
  context: ParseContext,
  paragraphStyleId: string | undefined,
  startRunIndex: number,
  separateRunIndex: number | undefined,
  endRunIndex: number,
  rawInstruction: string,
  ffDataXml: string | undefined
): FormFieldRunNode | undefined {
  const instruction = decodeXmlEntities(rawInstruction).replace(/\s+/g, " ").trim();
  const normalizedInstruction = instruction.toUpperCase();
  const fieldType: FormFieldType | undefined = normalizedInstruction.includes("FORMCHECKBOX")
    ? "checkbox"
    : normalizedInstruction.includes("FORMDROPDOWN")
      ? "dropdown"
      : normalizedInstruction.includes("FORMTEXT")
        ? "text"
        : undefined;

  if (!fieldType) {
    return undefined;
  }

  const resultStartRunIndex =
    separateRunIndex !== undefined ? separateRunIndex + 1 : Math.min(endRunIndex, startRunIndex + 1);
  const resultRuns =
    resultStartRunIndex < endRunIndex ? runs.slice(resultStartRunIndex, endRunIndex) : [];
  const fallbackResultText = normalizeLegacyFormDisplayValue(
    resultRuns.map((run) => parseRunText(run.xml)).join("")
  );
  const styleRunXml =
    resultRuns.find((run) => {
      const text = parseRunText(run.xml);
      return text.trim().length > 0 || /<w:sym\b/i.test(run.xml);
    })?.xml ?? runs[startRunIndex]?.xml;
  const style = styleRunXml ? parseRunStyle(styleRunXml, context, paragraphStyleId) : undefined;
  const link = runs
    .slice(startRunIndex, Math.min(runs.length, endRunIndex + 1))
    .map((run) => run.link)
    .find((candidate): candidate is string => typeof candidate === "string");
  const fieldXml =
    runs[startRunIndex] && runs[endRunIndex]
      ? paragraphXml.slice(runs[startRunIndex].start, runs[endRunIndex].end)
      : undefined;

  const nameTag = ffDataXml?.match(/<w:name\b[^>]*\/?>/i)?.[0];
  const enabled = ffDataXml ? parseOnOffAttribute(ffDataXml, "enabled") : undefined;
  const calcOnExit = ffDataXml ? parseOnOffAttribute(ffDataXml, "calcOnExit") : undefined;
  const widgetSettings: FormFieldWidgetSettings = {
    name: decodeXmlAttribute(nameTag ? getAttribute(nameTag, "w:val") : undefined),
    enabled,
    calcOnExit
  };

  if (fieldType === "checkbox") {
    const checkboxXml =
      extractBalancedTagBlocks(ffDataXml ?? "", "w:checkBox")[0] ??
      ffDataXml?.match(/<w:checkBox\b[^>]*\/?>/i)?.[0];
    const defaultTag = checkboxXml?.match(/<w:default\b[^>]*\/?>/i)?.[0];
    const checkedTag = checkboxXml?.match(/<w:checked\b[^>]*\/?>/i)?.[0];
    const sizeAutoTag = checkboxXml?.match(/<w:sizeAuto\b[^>]*\/?>/i)?.[0];
    const sizeTag = checkboxXml?.match(/<w:size\b[^>]*\/?>/i)?.[0];
    const defaultChecked = parseOnOffTagValue(defaultTag);
    const checked = parseOnOffTagValue(checkedTag) ?? defaultChecked;
    const sizeValue = sizeTag ? parseIntegerAttribute(sizeTag, "w:val") : undefined;
    const sizePt =
      Number.isFinite(sizeValue) && (sizeValue as number) > 0
        ? Number(((sizeValue as number) / 2).toFixed(2))
        : undefined;
    const sizeMode = sizeAutoTag ? "auto" : sizePt ? "exact" : undefined;

    if (defaultChecked !== undefined || sizeMode !== undefined || sizePt !== undefined) {
      widgetSettings.checkbox = {
        defaultChecked,
        sizeMode,
        sizePt
      };
    }

    return {
      type: "form-field",
      fieldType: "checkbox",
      sourceKind: "legacy",
      checked: checked ?? false,
      checkedSymbol: "☒",
      uncheckedSymbol: "☐",
      widget: widgetSettings,
      style,
      link,
      sourceXml: fieldXml
    };
  }

  if (fieldType === "dropdown") {
    const dropdownXml =
      extractBalancedTagBlocks(ffDataXml ?? "", "w:ddList")[0] ??
      ffDataXml?.match(/<w:ddList\b[^>]*\/?>/i)?.[0];
    const options = dropdownXml
      ? [...dropdownXml.matchAll(/<w:listEntry\b[^>]*\/?>/gi)]
          .map((match) => decodeXmlAttribute(getAttribute(match[0], "w:val"))?.trim())
          .filter((entry): entry is string => Boolean(entry))
          .map((entry) => ({
            displayText: entry,
            value: entry
          }))
      : [];
    const defaultTag = dropdownXml?.match(/<w:default\b[^>]*\/?>/i)?.[0];
    const defaultValue = decodeXmlAttribute(defaultTag ? getAttribute(defaultTag, "w:val") : undefined)?.trim();
    if (defaultValue) {
      widgetSettings.dropdown = {
        defaultValue
      };
    }
    const value = fallbackResultText ?? defaultValue ?? options[0]?.displayText;

    return {
      type: "form-field",
      fieldType: "dropdown",
      sourceKind: "legacy",
      value: value || undefined,
      options: options.length > 0 ? options : undefined,
      widget: widgetSettings,
      style,
      link,
      sourceXml: fieldXml
    };
  }

  const textInputXml =
    extractBalancedTagBlocks(ffDataXml ?? "", "w:textInput")[0] ??
    ffDataXml?.match(/<w:textInput\b[^>]*\/?>/i)?.[0];
  const typeTag = textInputXml?.match(/<w:type\b[^>]*\/?>/i)?.[0];
  const defaultTag = textInputXml?.match(/<w:default\b[^>]*\/?>/i)?.[0];
  const maxLengthTag = textInputXml?.match(/<w:maxLength\b[^>]*\/?>/i)?.[0];
  const formatTag = textInputXml?.match(/<w:format\b[^>]*\/?>/i)?.[0];
  const inputTypeRaw = decodeXmlAttribute(typeTag ? getAttribute(typeTag, "w:val") : undefined)?.trim();
  const inputType = inputTypeRaw
    ? (inputTypeRaw as FormFieldTextWidgetSettings["inputType"])
    : undefined;
  const defaultText = decodeXmlAttribute(defaultTag ? getAttribute(defaultTag, "w:val") : undefined);
  const maxLength = maxLengthTag ? parseIntegerAttribute(maxLengthTag, "w:val") : undefined;
  const textFormat = decodeXmlAttribute(formatTag ? getAttribute(formatTag, "w:val") : undefined);
  if (
    inputType !== undefined ||
    defaultText !== undefined ||
    maxLength !== undefined ||
    textFormat !== undefined
  ) {
    widgetSettings.text = {
      inputType,
      defaultText,
      maxLength,
      textFormat
    };
  }
  const value = fallbackResultText ?? defaultText;

  return {
    type: "form-field",
    fieldType: "text",
    sourceKind: "legacy",
    value: value || undefined,
    widget: widgetSettings,
    style,
    link,
    sourceXml: fieldXml
  };
}

function parseLegacyParagraphFormFieldTokens(
  paragraphXml: string,
  runs: ParagraphRunToken[],
  context: ParseContext,
  paragraphStyleId?: string
): ParagraphFormFieldToken[] {
  if (runs.length === 0) {
    return [];
  }

  const tokens: ParagraphFormFieldToken[] = [];
  const stack: Array<{
    startRunIndex: number;
    separateRunIndex?: number;
    instructionParts: string[];
    ffDataXml?: string;
  }> = [];
  const inlineTokenPattern =
    /<w:fldChar\b[^>]*\bw:fldCharType="(begin|separate|end)"[^>]*>([\s\S]*?)<\/w:fldChar>|<w:fldChar\b[^>]*\bw:fldCharType="(begin|separate|end)"[^>]*\/>|<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/gi;

  runs.forEach((run, runIndex) => {
    const runXml = run.xml;
    let match: RegExpExecArray | null;
    while ((match = inlineTokenPattern.exec(runXml)) !== null) {
      const instructionChunk = match[4];
      if (instructionChunk !== undefined) {
        const current = stack[stack.length - 1];
        if (current) {
          current.instructionParts.push(instructionChunk);
        }
        continue;
      }

      const fieldType = (match[1] ?? match[3] ?? "").toLowerCase();
      if (fieldType === "begin") {
        const fieldXml = match[0];
        const ffDataXml =
          extractBalancedTagBlocks(fieldXml, "w:ffData")[0] ??
          fieldXml.match(/<w:ffData\b[^>]*\/?>/i)?.[0];
        stack.push({
          startRunIndex: runIndex,
          instructionParts: [],
          ffDataXml
        });
        continue;
      }

      if (fieldType === "separate") {
        const current = stack[stack.length - 1];
        if (current && current.separateRunIndex === undefined) {
          current.separateRunIndex = runIndex;
        }
        continue;
      }

      if (fieldType === "end") {
        const current = stack.pop();
        if (!current) {
          continue;
        }

        const field = parseLegacyFormFieldFromRange(
          paragraphXml,
          runs,
          context,
          paragraphStyleId,
          current.startRunIndex,
          current.separateRunIndex,
          runIndex,
          current.instructionParts.join(" "),
          current.ffDataXml
        );
        if (!field) {
          continue;
        }

        const start = runs[current.startRunIndex]?.start;
        const end = runs[runIndex]?.end;
        if (start === undefined || end === undefined || end <= start) {
          continue;
        }

        tokens.push({
          start,
          end,
          field
        });
      }
    }
  });

  return tokens;
}

function parseFormFieldFromSdtXml(
  sdtXml: string,
  context: ParseContext,
  paragraphStyleId?: string,
  link?: string
): FormFieldRunNode | undefined {
  const sdtPropertiesXml =
    extractBalancedTagBlocks(sdtXml, "w:sdtPr")[0] ?? sdtXml.match(/<w:sdtPr\b[^>]*\/>/i)?.[0] ?? "";
  const sdtContentXml = extractBalancedTagBlocks(sdtXml, "w:sdtContent")[0] ?? "";
  if (!sdtPropertiesXml) {
    return undefined;
  }

  const aliasTag = sdtPropertiesXml.match(/<w:alias\b[^>]*\/?>/i)?.[0];
  const tagTag = sdtPropertiesXml.match(/<w:tag\b[^>]*\/?>/i)?.[0];
  const idTag = sdtPropertiesXml.match(/<w:id\b[^>]*\/?>/i)?.[0];
  const placeholderTag = sdtPropertiesXml.match(/<w:placeholder\b[\s\S]*?<\/w:placeholder>/i)?.[0];
  const placeholderDocPartTag = placeholderTag?.match(/<w:docPart\b[^>]*\/?>/i)?.[0];
  const title = decodeXmlAttribute(aliasTag ? getAttribute(aliasTag, "w:val") : undefined);
  const tag = decodeXmlAttribute(tagTag ? getAttribute(tagTag, "w:val") : undefined);
  const idValue = idTag ? parseIntegerAttribute(idTag, "w:val") : undefined;
  const placeholder = decodeXmlAttribute(
    placeholderDocPartTag ? getAttribute(placeholderDocPartTag, "w:val") : undefined
  );
  const firstRunXml = extractBalancedTagBlocks(sdtContentXml, "w:r")[0];
  const style = firstRunXml ? parseRunStyle(firstRunXml, context, paragraphStyleId) : undefined;
  const contentText = parseRunText(sdtContentXml);
  const trimmedContentText = contentText.trim();

  if (/<w14:checkbox\b/i.test(sdtPropertiesXml)) {
    const checkedTag = sdtPropertiesXml.match(/<w14:checked\b[^>]*\/?>/i)?.[0];
    const checkedValue = checkedTag
      ? getAttribute(checkedTag, "w14:val") ?? getAttribute(checkedTag, "w:val")
      : undefined;
    const checkedStateTag = sdtPropertiesXml.match(/<w14:checkedState\b[^>]*\/?>/i)?.[0];
    const uncheckedStateTag = sdtPropertiesXml.match(/<w14:uncheckedState\b[^>]*\/?>/i)?.[0];
    const checkedSymbol = decodeHexCodePoint(
      checkedStateTag
        ? getAttribute(checkedStateTag, "w14:val") ?? getAttribute(checkedStateTag, "w:val")
        : undefined
    ) ?? "☒";
    const uncheckedSymbol = decodeHexCodePoint(
      uncheckedStateTag
        ? getAttribute(uncheckedStateTag, "w14:val") ?? getAttribute(uncheckedStateTag, "w:val")
        : undefined
    ) ?? "☐";
    const checked =
      onOffValueToBoolean(checkedValue) ??
      (trimmedContentText ? trimmedContentText.includes(checkedSymbol) : undefined);

    return {
      type: "form-field",
      fieldType: "checkbox",
      sourceKind: "sdt",
      id: idValue,
      tag,
      title,
      placeholder,
      checked: checked ?? false,
      checkedSymbol,
      uncheckedSymbol,
      style,
      link,
      sourceXml: sdtXml
    };
  }

  if (/<w:(?:dropDownList|comboBox)\b/i.test(sdtPropertiesXml)) {
    const options: FormFieldOption[] = [];
    for (const match of sdtPropertiesXml.matchAll(/<w:listItem\b[^>]*\/?>/gi)) {
      const listItemTag = match[0];
      const displayText = decodeXmlAttribute(getAttribute(listItemTag, "w:displayText"));
      const value = decodeXmlAttribute(getAttribute(listItemTag, "w:value"));
      const fallbackText = (displayText ?? value ?? "").trim();
      if (!fallbackText) {
        continue;
      }

      options.push({
        displayText: (displayText ?? value ?? "").trim(),
        value: value?.trim() || undefined
      });
    }
    const lastValueTag = sdtPropertiesXml.match(/<w:lastValue\b[^>]*\/?>/i)?.[0];
    const lastValue = decodeXmlAttribute(lastValueTag ? getAttribute(lastValueTag, "w:val") : undefined)?.trim();
    const selectedValue = trimmedContentText || lastValue;

    return {
      type: "form-field",
      fieldType: "dropdown",
      sourceKind: "sdt",
      id: idValue,
      tag,
      title,
      placeholder,
      value: selectedValue || undefined,
      options: options.length > 0 ? options : undefined,
      style,
      link,
      sourceXml: sdtXml
    };
  }

  if (/<w:date\b/i.test(sdtPropertiesXml)) {
    const fullDateTag = sdtPropertiesXml.match(/<w:fullDate\b[^>]*\/?>/i)?.[0];
    const fullDate = decodeXmlAttribute(fullDateTag ? getAttribute(fullDateTag, "w:val") : undefined)?.trim();
    const value = trimmedContentText || fullDate;

    return {
      type: "form-field",
      fieldType: "date",
      sourceKind: "sdt",
      id: idValue,
      tag,
      title,
      placeholder,
      value: value || undefined,
      style,
      link,
      sourceXml: sdtXml
    };
  }

  if (/<w:(?:text|richText)\b/i.test(sdtPropertiesXml)) {
    return {
      type: "form-field",
      fieldType: "text",
      sourceKind: "sdt",
      id: idValue,
      tag,
      title,
      placeholder,
      value: contentText,
      style,
      link,
      sourceXml: sdtXml
    };
  }

  return undefined;
}

function parseParagraphFormFieldTokens(
  paragraphXml: string,
  context: ParseContext,
  paragraphStyleId?: string,
  runs?: ParagraphRunToken[]
): ParagraphFormFieldToken[] {
  const paragraphRuns = runs ?? parseParagraphRuns(paragraphXml, context);
  const sdtRanges = extractBalancedTagRanges(paragraphXml, "w:sdt");
  const sdtTokens: ParagraphFormFieldToken[] = [];
  const legacyTokens = parseLegacyParagraphFormFieldTokens(
    paragraphXml,
    paragraphRuns,
    context,
    paragraphStyleId
  );

  if (sdtRanges.length === 0) {
    return legacyTokens;
  }

  const hyperlinkRanges = extractBalancedTagRanges(paragraphXml, "w:hyperlink").map((range) => {
    const hyperlinkXml = paragraphXml.slice(range.start, range.end);
    const hyperlinkTag = hyperlinkXml.match(/<w:hyperlink\b[^>]*>/i)?.[0] ?? "";
    return {
      ...range,
      href: hyperlinkHrefFromTag(hyperlinkTag, context)
    };
  });

  sdtRanges
    .map((range) => {
      const sdtXml = paragraphXml.slice(range.start, range.end);
      const link = hyperlinkRanges.find(
        (hyperlinkRange) =>
          range.start >= hyperlinkRange.start &&
          range.end <= hyperlinkRange.end &&
          hyperlinkRange.href
      )?.href;
      const field = parseFormFieldFromSdtXml(sdtXml, context, paragraphStyleId, link);
      if (!field) {
        return undefined;
      }

      return {
        start: range.start,
        end: range.end,
        field
      };
    })
    .filter((token): token is ParagraphFormFieldToken => token !== undefined)
    .forEach((token) => {
      sdtTokens.push(token);
    });

  return [...legacyTokens, ...sdtTokens].sort((left, right) => left.start - right.start);
}

function parseParagraphStyle(paragraphXml: string, context: ParseContext): ParagraphStyle | undefined {
  const paragraphPropertiesXml =
    extractBalancedTagBlocks(paragraphXml, "w:pPr")[0] ?? paragraphXml.match(/<w:pPr\b[^>]*\/>/i)?.[0] ?? "";
  const alignmentMatch = paragraphPropertiesXml.match(/<w:jc\b[^>]*w:val="([^"]+)"/i);
  const pStyleMatch = paragraphPropertiesXml.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/i);
  const directSpacing = parseParagraphSpacingFromXml(paragraphPropertiesXml);
  const directIndent = parseParagraphIndentFromXml(paragraphPropertiesXml);
  const directBackgroundColor = parseParagraphShadingFromXml(paragraphPropertiesXml);
  const directBorders = parseParagraphBorderSetFromXml(paragraphPropertiesXml);
  const directNumbering = parseParagraphNumberingFromXml(paragraphPropertiesXml);
  const directTabStops = parseParagraphTabStopsFromXml(paragraphPropertiesXml);
  const directDropCap = parseParagraphDropCapFromXml(paragraphPropertiesXml);
  const directContextualSpacing = parseOnOffAttribute(paragraphPropertiesXml, "contextualSpacing");
  const directKeepNext = parseOnOffAttribute(paragraphPropertiesXml, "keepNext");
  const directKeepLines = parseOnOffAttribute(paragraphPropertiesXml, "keepLines");
  const directWidowControl = parseOnOffAttribute(paragraphPropertiesXml, "widowControl");
  const directPageBreakBefore = parseOnOffAttribute(paragraphPropertiesXml, "pageBreakBefore");
  const hasDirectNumPr = /<w:numPr\b/i.test(paragraphPropertiesXml);

  const explicitStyleId = pStyleMatch?.[1];
  const styleId = explicitStyleId ?? context.styleSheet.defaultParagraphStyleId;
  const inherited = styleId ? context.styleSheet.paragraphStyleById.get(styleId) : undefined;
  const defaultParagraphStyle = context.styleSheet.defaultParagraphStyle;

  const align =
    normalizeAlignment(alignmentMatch?.[1]) ??
    inherited?.align ??
    defaultParagraphStyle?.align;
  const headingLevel =
    normalizeHeadingLevel(explicitStyleId) ??
    inherited?.headingLevel ??
    defaultParagraphStyle?.headingLevel;
  const numbering = hasDirectNumPr
    ? directNumbering
    : directNumbering ?? inherited?.numbering ?? defaultParagraphStyle?.numbering;
  const spacing = mergeParagraphSpacing(
    mergeParagraphSpacing(defaultParagraphStyle?.spacing, inherited?.spacing),
    directSpacing
  );
  const indent = mergeParagraphIndent(
    mergeParagraphIndent(defaultParagraphStyle?.indent, inherited?.indent),
    directIndent
  );
  const backgroundColor = mergeParagraphBackgroundColor(
    mergeParagraphBackgroundColor(defaultParagraphStyle?.backgroundColor, inherited?.backgroundColor),
    directBackgroundColor
  );
  const borders = mergeParagraphBorderSets(
    mergeParagraphBorderSets(defaultParagraphStyle?.borders, inherited?.borders),
    directBorders
  );
  const tabStops = mergeParagraphTabStops(
    mergeParagraphTabStops(defaultParagraphStyle?.tabStops, inherited?.tabStops),
    directTabStops
  );
  const contextualSpacing = mergeParagraphBoolean(
    mergeParagraphBoolean(defaultParagraphStyle?.contextualSpacing, inherited?.contextualSpacing),
    directContextualSpacing
  );
  const keepNext = mergeParagraphBoolean(
    mergeParagraphBoolean(defaultParagraphStyle?.keepNext, inherited?.keepNext),
    directKeepNext
  );
  const keepLines = mergeParagraphBoolean(
    mergeParagraphBoolean(defaultParagraphStyle?.keepLines, inherited?.keepLines),
    directKeepLines
  );
  const widowControl = mergeParagraphBoolean(
    mergeParagraphBoolean(defaultParagraphStyle?.widowControl, inherited?.widowControl),
    directWidowControl
  );
  const pageBreakBefore = mergeParagraphBoolean(
    mergeParagraphBoolean(defaultParagraphStyle?.pageBreakBefore, inherited?.pageBreakBefore),
    directPageBreakBefore
  );
  const styleName = inherited?.name;

    if (
      !align &&
      !headingLevel &&
      !styleId &&
      !styleName &&
      !numbering &&
      !spacing &&
      !indent &&
      !backgroundColor &&
      !borders &&
      (!tabStops || tabStops.length === 0) &&
      !directDropCap &&
      contextualSpacing === undefined &&
      keepNext === undefined &&
      keepLines === undefined &&
      widowControl === undefined &&
      pageBreakBefore === undefined
  ) {
    return undefined;
  }

  return {
    align,
    headingLevel,
    styleId,
    styleName,
    numbering,
    spacing,
    indent,
    backgroundColor,
    borders,
    tabStops,
    dropCap: directDropCap,
    contextualSpacing,
    keepNext,
    keepLines,
    widowControl,
    pageBreakBefore
  };
}

function parseParagraph(paragraphXml: string, context: ParseContext): ParagraphNode {
  const children: ParagraphChildNode[] = [];
  const paragraphStyle = parseParagraphStyle(paragraphXml, context);
  const paragraphMarkDeleted = /<w:pPr\b[\s\S]*?<w:rPr\b[\s\S]*?<w:del\b/i.test(paragraphXml);
  const runs = parseParagraphRuns(paragraphXml, context);
  const formFieldTokens = parseParagraphFormFieldTokens(
    paragraphXml,
    context,
    paragraphStyle?.styleId,
    runs
  );
  const contentTokens: Array<
    | {
        kind: "run";
        start: number;
        token: ParagraphRunToken;
      }
    | {
        kind: "form-field";
        start: number;
        token: ParagraphFormFieldToken;
      }
  > = [];

  for (const run of runs) {
    const insideFormField = formFieldTokens.some(
      (formFieldToken) => run.start >= formFieldToken.start && run.end <= formFieldToken.end
    );
    if (insideFormField) {
      continue;
    }

    contentTokens.push({
      kind: "run",
      start: run.start,
      token: run
    });
  }

  for (const formFieldToken of formFieldTokens) {
    contentTokens.push({
      kind: "form-field",
      start: formFieldToken.start,
      token: formFieldToken
    });
  }

  contentTokens.sort((left, right) => left.start - right.start);

  for (const contentToken of contentTokens) {
    if (contentToken.kind === "form-field") {
      children.push(contentToken.token.field);
      continue;
    }

    const run = contentToken.token;
    const style = parseRunStyle(run.xml, context, paragraphStyle?.styleId);
    const activeXCheckboxField = parseRunActiveXCheckboxField(
      run.xml,
      context,
      style,
      run.link
    );
    if (activeXCheckboxField) {
      children.push(activeXCheckboxField);
      continue;
    }

    const images = parseRunImages(run.xml, context);
    const parsedTokens = parseRunTextTokens(
      images.some((image) => image.syntheticTextBox)
        ? stripTextBoxContent(run.xml)
        : run.xml
    );

  for (const token of parsedTokens) {
      if (token.text.length === 0 && !token.noteReference) {
        continue;
      }

      children.push({
        type: "text",
        text: token.text,
        style,
        link: run.link,
        noteReference: token.noteReference
      });
    }

    for (const image of images) {
      children.push(image);
    }
  }

  if (children.length === 0) {
    children.push({ type: "text", text: "" });
  }

  return {
    type: "paragraph",
    style: paragraphStyle,
    paragraphMarkDeleted: paragraphMarkDeleted || undefined,
    children,
    sourceXml: paragraphXml
  };
}

interface ParsedTableCellResult {
  cell: TableCellNode;
  vMerge?: "restart" | "continue";
}

function parseTableCellContent(
  cellXml: string,
  context: ParseContext
): TableCellContentNode[] {
  const blockRanges = extractBalancedTagBlocksInOrder(cellXml, ["w:p", "w:tbl"]);

  const parsed = blockRanges
    .map((block) => {
      const blockXml = cellXml.slice(block.start, block.end);
      if (blockXml.startsWith("<w:p")) {
        return parseParagraph(blockXml, context);
      }
      if (blockXml.startsWith("<w:tbl")) {
        return parseTable(blockXml, context);
      }
      return undefined;
    })
    .filter((block): block is TableCellContentNode => Boolean(block));

  if (parsed.length > 0) {
    return parsed;
  }

  return [parseParagraph("<w:p><w:r><w:t/></w:r></w:p>", context)];
}

function parseTableCell(cellXml: string, context: ParseContext): ParsedTableCellResult {
  const nodes = parseTableCellContent(cellXml, context);

  const cellPropertiesXml =
    extractBalancedTagBlocks(cellXml, "w:tcPr")[0] ?? cellXml.match(/<w:tcPr\b[^>]*\/?>/i)?.[0];
  const fillMatch = cellPropertiesXml?.match(/<w:shd\b[^>]*w:fill="([^"]+)"/i);
  const backgroundColor = normalizeHexColor(fillMatch?.[1]);
  const gridSpanMatch = cellPropertiesXml?.match(/<w:gridSpan\b[^>]*w:val="(\d+)"/i);
  const gridSpan = gridSpanMatch?.[1] ? Number(gridSpanMatch[1]) : undefined;
  const cellWidthTag = cellPropertiesXml?.match(/<w:tcW\b[^>]*>/i)?.[0];
  const cellWidthType = cellWidthTag ? getAttribute(cellWidthTag, "w:type")?.toLowerCase() : undefined;
  const widthTwipsRaw = cellWidthTag ? parseIntegerAttribute(cellWidthTag, "w:w") : undefined;
  const widthTwips =
    cellWidthType === "dxa" && widthTwipsRaw !== undefined && widthTwipsRaw > 0 ? widthTwipsRaw : undefined;
  const cellMarginXml = cellPropertiesXml?.match(/<w:tcMar\b[\s\S]*?<\/w:tcMar>/i)?.[0];
  const marginTwips = cellMarginXml ? parseTableBoxSpacing(cellMarginXml) : undefined;
  const cellBordersXml = cellPropertiesXml?.match(
    /<w:tcBorders\b[\s\S]*?<\/w:tcBorders>|<w:tcBorders\b[^>]*\/>/i
  )?.[0];
  const borders = cellBordersXml ? parseTableBorderSet(cellBordersXml) : undefined;
  const verticalAlignTag = cellPropertiesXml?.match(/<w:vAlign\b[^>]*>/i)?.[0];
  const verticalAlignRaw = verticalAlignTag ? getAttribute(verticalAlignTag, "w:val")?.toLowerCase() : undefined;
  const verticalAlign =
    verticalAlignRaw === "top" || verticalAlignRaw === "center" || verticalAlignRaw === "bottom"
      ? verticalAlignRaw
      : undefined;
  const vMergeTag = cellPropertiesXml?.match(/<w:vMerge\b[^>]*\/?>/i)?.[0];
  const vMergeRaw = vMergeTag ? getAttribute(vMergeTag, "w:val")?.toLowerCase() : undefined;
  const vMerge =
    vMergeTag !== undefined ? (vMergeRaw === "restart" ? "restart" : "continue") : undefined;
  const hasCellStyle =
    backgroundColor !== undefined ||
    (gridSpan !== undefined && gridSpan > 1) ||
    widthTwips !== undefined ||
    marginTwips !== undefined ||
    verticalAlign !== undefined ||
    borders !== undefined;
  return {
    cell: {
      type: "table-cell",
      style:
        hasCellStyle
          ? {
              backgroundColor,
              gridSpan: gridSpan && gridSpan > 1 ? gridSpan : undefined,
              widthTwips,
              marginTwips,
              verticalAlign,
              borders
            }
          : undefined,
      nodes
    },
    vMerge
  };
}

function parseTableLook(tablePropertiesXml: string | undefined): ParsedTableLook | undefined {
  const tableLookTag = tablePropertiesXml?.match(/<w:tblLook\b[^>]*\/?>/i)?.[0] ?? "";
  if (!tableLookTag) {
    return undefined;
  }
  const lookMaskRaw = getAttribute(tableLookTag, "w:val");
  const lookMask = lookMaskRaw ? Number.parseInt(lookMaskRaw, 16) : undefined;
  const rowBandSizeTag =
    tablePropertiesXml?.match(/<w:tblStyleRowBandSize\b[^>]*\/?>/i)?.[0] ??
    extractBalancedTagBlocks(tablePropertiesXml ?? "", "w:tblStyleRowBandSize")[0];
  const colBandSizeTag =
    tablePropertiesXml?.match(/<w:tblStyleColBandSize\b[^>]*\/?>/i)?.[0] ??
    extractBalancedTagBlocks(tablePropertiesXml ?? "", "w:tblStyleColBandSize")[0];
  const rowBandSizeRaw = parseIntegerAttribute(
    rowBandSizeTag ?? "",
    "w:val"
  ) ?? 1;
  const colBandSizeRaw = parseIntegerAttribute(
    colBandSizeTag ?? "",
    "w:val"
  ) ?? 1;
  const rowBandSize = Math.max(1, rowBandSizeRaw);
  const colBandSize = Math.max(1, colBandSizeRaw);

  const resolveOnOffAttribute = (attribute: string): boolean | undefined => {
    const value = getAttribute(tableLookTag, attribute)?.toLowerCase();
    if (!value) {
      return undefined;
    }
    if (value === "1" || value === "true" || value === "on") {
      return true;
    }
    if (value === "0" || value === "false" || value === "off") {
      return false;
    }
    return undefined;
  };

  const hasLookMask = Number.isFinite(lookMask);
  const maskValue = hasLookMask ? (lookMask as number) : 0;

  return {
    firstRow: resolveOnOffAttribute("w:firstRow") ?? Boolean(maskValue & 0x0020),
    lastRow: resolveOnOffAttribute("w:lastRow") ?? Boolean(maskValue & 0x0040),
    firstCol: resolveOnOffAttribute("w:firstColumn") ?? Boolean(maskValue & 0x0080),
    lastCol: resolveOnOffAttribute("w:lastColumn") ?? Boolean(maskValue & 0x0100),
    noHBand: resolveOnOffAttribute("w:noHBand") ?? Boolean(maskValue & 0x0200),
    noVBand: resolveOnOffAttribute("w:noVBand") ?? Boolean(maskValue & 0x0400),
    rowBandSize,
    colBandSize
  };
}

function parseFloatingTableStyle(
  tablePropertiesXml: string | undefined
): NonNullable<TableStyle["floating"]> | undefined {
  const floatingTag = tablePropertiesXml?.match(/<w:tblpPr\b[^>]*\/?>/i)?.[0];
  if (!floatingTag) {
    return undefined;
  }

  const xTwips = parseIntegerAttribute(floatingTag, "w:tblpX");
  const yTwips = parseIntegerAttribute(floatingTag, "w:tblpY");
  const leftFromTextTwips = parseIntegerAttribute(floatingTag, "w:leftFromText");
  const rightFromTextTwips = parseIntegerAttribute(floatingTag, "w:rightFromText");
  const topFromTextTwips = parseIntegerAttribute(floatingTag, "w:topFromText");
  const bottomFromTextTwips = parseIntegerAttribute(floatingTag, "w:bottomFromText");
  const horizontalAnchor = getAttribute(floatingTag, "w:horzAnchor");
  const verticalAnchor = getAttribute(floatingTag, "w:vertAnchor");
  const horizontalAlignRaw = getAttribute(floatingTag, "w:tblpXSpec")?.trim().toLowerCase();
  const verticalAlignRaw = getAttribute(floatingTag, "w:tblpYSpec")?.trim().toLowerCase();
  const horizontalAlign =
    horizontalAlignRaw === "left" ||
    horizontalAlignRaw === "center" ||
    horizontalAlignRaw === "right" ||
    horizontalAlignRaw === "inside" ||
    horizontalAlignRaw === "outside"
      ? horizontalAlignRaw
      : undefined;
  const verticalAlign =
    verticalAlignRaw === "top" ||
    verticalAlignRaw === "center" ||
    verticalAlignRaw === "bottom" ||
    verticalAlignRaw === "inside" ||
    verticalAlignRaw === "outside"
      ? verticalAlignRaw
      : undefined;

  if (
    xTwips === undefined &&
    yTwips === undefined &&
    leftFromTextTwips === undefined &&
    rightFromTextTwips === undefined &&
    topFromTextTwips === undefined &&
    bottomFromTextTwips === undefined &&
    horizontalAnchor === undefined &&
    verticalAnchor === undefined &&
    horizontalAlign === undefined &&
    verticalAlign === undefined
  ) {
    return undefined;
  }

  return {
    xTwips,
    yTwips,
    leftFromTextTwips,
    rightFromTextTwips,
    topFromTextTwips,
    bottomFromTextTwips,
    horizontalAnchor,
    verticalAnchor,
    horizontalAlign,
    verticalAlign
  };
}

function applyRunStyleToParagraph(paragraph: ParagraphNode, runStyle: TextStyle): void {
  paragraph.children = paragraph.children.map((child) => {
    if (child.type === "text") {
      return {
        ...child,
        style: mergeTextStyles(child.style, runStyle)
      };
    }

    if (child.type === "form-field") {
      return {
        ...child,
        style: mergeTextStyles(child.style, runStyle)
      };
    }

    return child;
  });
}

function paragraphHasDirectAlignment(paragraph: ParagraphNode): boolean {
  if (!paragraph.sourceXml) {
    return false;
  }

  const paragraphPropertiesXml =
    extractBalancedTagBlocks(paragraph.sourceXml, "w:pPr")[0] ??
    paragraph.sourceXml.match(/<w:pPr\b[^>]*\/>/i)?.[0] ??
    "";
  if (!paragraphPropertiesXml) {
    return false;
  }

  return /<w:jc\b/i.test(paragraphPropertiesXml);
}

function applyParagraphAlignmentToTableCellContent(
  nodes: TableCellContentNode[],
  paragraphAlign: ParagraphAlignment
): void {
  for (const node of nodes) {
    if (isParagraphCellContent(node)) {
      if (paragraphHasDirectAlignment(node)) {
        continue;
      }

      node.style = {
        ...(node.style ?? {}),
        align: paragraphAlign
      };
      continue;
    }

    if (isTableCellContentTable(node)) {
      for (const row of node.rows) {
        for (const cell of row.cells) {
          applyParagraphAlignmentToTableCellContent(cell.nodes, paragraphAlign);
        }
      }
    }
  }
}

function resolveTableConditionForCell(
  tableStyle: ParsedTableStyleDefinition,
  tableLook: ParsedTableLook,
  rowIndex: number,
  rowCount: number,
  startColumnIndex: number,
  endColumnIndex: number,
  columnCount: number
): ParsedTableStyleCondition | undefined {
  const conditionTypes: TableConditionalStyleType[] = ["wholeTable"];
  const isFirstRow = rowIndex === 0;
  const isLastRow = rowIndex === rowCount - 1;
  const isFirstColumn = startColumnIndex === 0;
  const isLastColumn = endColumnIndex >= columnCount - 1;
  const rowBandSize = Math.max(1, tableLook.rowBandSize);
  const colBandSize = Math.max(1, tableLook.colBandSize);

  if (!tableLook.noHBand) {
    const bandRowIndex = rowIndex - (tableLook.firstRow ? 1 : 0);
    if (bandRowIndex >= 0) {
      const bandRowGroup = Math.floor(bandRowIndex / rowBandSize);
      conditionTypes.push(bandRowGroup % 2 === 0 ? "band1Horz" : "band2Horz");
    }
  }

  if (!tableLook.noVBand) {
    const bandColumnIndex = startColumnIndex - (tableLook.firstCol ? 1 : 0);
    if (bandColumnIndex >= 0) {
      const bandColumnGroup = Math.floor(bandColumnIndex / colBandSize);
      conditionTypes.push(bandColumnGroup % 2 === 0 ? "band1Vert" : "band2Vert");
    }
  }

  if (tableLook.firstRow && isFirstRow) {
    conditionTypes.push("firstRow");
  }
  if (tableLook.lastRow && isLastRow) {
    conditionTypes.push("lastRow");
  }
  if (tableLook.firstCol && isFirstColumn) {
    conditionTypes.push("firstCol");
  }
  if (tableLook.lastCol && isLastColumn) {
    conditionTypes.push("lastCol");
  }
  if (tableLook.firstRow && tableLook.firstCol && isFirstRow && isFirstColumn) {
    conditionTypes.push("nwCell");
  }
  if (tableLook.firstRow && tableLook.lastCol && isFirstRow && isLastColumn) {
    conditionTypes.push("neCell");
  }
  if (tableLook.lastRow && tableLook.firstCol && isLastRow && isFirstColumn) {
    conditionTypes.push("swCell");
  }
  if (tableLook.lastRow && tableLook.lastCol && isLastRow && isLastColumn) {
    conditionTypes.push("seCell");
  }

  let resolvedCondition: ParsedTableStyleCondition | undefined;
  for (const conditionType of conditionTypes) {
    resolvedCondition = mergeTableConditionalStyle(
      resolvedCondition,
      tableStyle.conditions[conditionType]
    );
  }

  return resolvedCondition;
}

function parseTable(tableXml: string, context: ParseContext): TableNode {
  const tablePropertiesXml =
    extractBalancedTagBlocks(tableXml, "w:tblPr")[0] ?? tableXml.match(/<w:tblPr\b[^>]*\/?>/i)?.[0];
  const tableStyleId = tablePropertiesXml?.match(/<w:tblStyle\b[^>]*w:val="([^"]+)"/i)?.[1];
  const tableStyle = tableStyleId ? context.styleSheet.tableStyleById.get(tableStyleId) : undefined;
  const styleTableProperties = tableStyle?.conditions.wholeTable?.tableProperties;
  const styleTableLook = tableStyle?.conditions.wholeTable?.tableLook;

  const explicitProperties = parseTableStylePropertiesFromXml(tablePropertiesXml);
  const mergedProperties = mergeTableStyleProperties(styleTableProperties, explicitProperties);

  const widthTwips = mergedProperties?.widthTwips;
  const indentTwips = mergedProperties?.indentTwips;
  const layout = mergedProperties?.layout;
  const cellSpacingTwips = mergedProperties?.cellSpacingTwips;
  const floating = mergedProperties?.floating;
  const cellMarginTwips = mergedProperties?.cellMarginTwips;

  const tableBordersXml = tablePropertiesXml?.match(
    /<w:tblBorders\b[\s\S]*?<\/w:tblBorders>|<w:tblBorders\b[^>]*\/>/i
  )?.[0];
  const explicitBorders = tableBordersXml ? parseTableBorderSet(tableBordersXml) : undefined;
  const tableGridXml = tableXml.match(/<w:tblGrid\b[\s\S]*?<\/w:tblGrid>/i)?.[0];
  const columnWidthsTwips = tableGridXml
    ? [...tableGridXml.matchAll(/<w:gridCol\b[^>]*>/gi)]
        .map((columnMatch) => parseIntegerAttribute(columnMatch[0], "w:w"))
        .filter((width): width is number => width !== undefined && width > 0)
    : [];

  const tableLook = mergeTableLook(parseTableLook(tablePropertiesXml), styleTableLook);
  const rows: TableRowNode[] = [];
  const activeVerticalMergeByColumn = new Map<number, TableCellNode>();

  for (const rowXml of extractBalancedTagBlocks(tableXml, "w:tr")) {
    const rowPropertiesXml =
      extractBalancedTagBlocks(rowXml, "w:trPr")[0] ?? rowXml.match(/<w:trPr\b[^>]*\/?>/i)?.[0];
    const rowFillMatch = rowPropertiesXml?.match(/<w:shd\b[^>]*w:fill="([^"]+)"/i);
    const rowBackgroundColor = normalizeHexColor(rowFillMatch?.[1]);
    const rowHeightTag = rowPropertiesXml?.match(/<w:trHeight\b[^>]*>/i)?.[0];
    const rowHeightRaw = rowHeightTag ? parseIntegerAttribute(rowHeightTag, "w:val") : undefined;
    const rowHeightTwips = rowHeightRaw !== undefined && rowHeightRaw > 0 ? rowHeightRaw : undefined;
    const rowHeightRuleRaw = rowHeightTag ? getAttribute(rowHeightTag, "w:hRule")?.toLowerCase() : undefined;
    const rowHeightRule =
      rowHeightRuleRaw === "atleast" || rowHeightRuleRaw === "exact" || rowHeightRuleRaw === "auto"
        ? (rowHeightRuleRaw === "atleast" ? "atLeast" : rowHeightRuleRaw)
        : undefined;
    const rowCantSplit = rowPropertiesXml ? parseOnOffAttribute(rowPropertiesXml, "cantSplit") : undefined;

    const parsedCells = extractBalancedTagBlocks(rowXml, "w:tc").map((cellXml) =>
      parseTableCell(cellXml, context)
    );
    if (parsedCells.length === 0) {
      continue;
    }

    const cells: TableCellNode[] = [];
    let columnCursor = 0;
    for (const parsedCell of parsedCells) {
      const cell = parsedCell.cell;
      const columnSpan = Math.max(1, cell.style?.gridSpan ?? 1);
      const startColumn = columnCursor;
      const endColumn = startColumn + columnSpan - 1;
      columnCursor += columnSpan;

      if (parsedCell.vMerge === "continue") {
        const continuationAnchors = new Set<TableCellNode>();
        for (let columnIndex = startColumn; columnIndex <= endColumn; columnIndex += 1) {
          const anchor = activeVerticalMergeByColumn.get(columnIndex);
          if (anchor) {
            continuationAnchors.add(anchor);
          }
        }

        if (continuationAnchors.size > 0) {
          continuationAnchors.forEach((anchorCell) => {
            const anchorStyle = anchorCell.style ?? {};
            anchorCell.style = {
              ...anchorStyle,
              rowSpan: Math.max(1, anchorStyle.rowSpan ?? 1) + 1
            };
          });

          cell.style = {
            ...(cell.style ?? {}),
            vMergeContinuation: true
          };
          cells.push(cell);
          continue;
        }
      }

      if (parsedCell.vMerge === "restart") {
        cell.style = {
          ...(cell.style ?? {}),
          rowSpan: 1
        };
        for (let columnIndex = startColumn; columnIndex <= endColumn; columnIndex += 1) {
          activeVerticalMergeByColumn.set(columnIndex, cell);
        }
      } else {
        for (let columnIndex = startColumn; columnIndex <= endColumn; columnIndex += 1) {
          activeVerticalMergeByColumn.delete(columnIndex);
        }
      }

      cells.push(cell);
    }

    rows.push({
      type: "table-row",
      cells,
      style:
        rowBackgroundColor !== undefined ||
        rowHeightTwips !== undefined ||
        rowHeightRule !== undefined ||
        rowCantSplit !== undefined
          ? {
              backgroundColor: rowBackgroundColor,
              heightTwips: rowHeightTwips,
              ...(rowHeightRule !== undefined ? { heightRule: rowHeightRule } : undefined),
              ...(rowCantSplit !== undefined ? { cantSplit: rowCantSplit } : undefined)
            }
          : undefined
    });
  }

  const columnCount = Math.max(
    columnWidthsTwips.length,
    ...rows.map((row) =>
      row.cells.reduce(
        (total, cell) => total + (cell.style?.gridSpan && cell.style.gridSpan > 1 ? cell.style.gridSpan : 1),
        0
      )
    ),
    1
  );

  if (tableStyle) {
    rows.forEach((row, rowIndex) => {
      let columnCursor = 0;
      row.cells.forEach((cell) => {
        const columnSpan = Math.max(1, cell.style?.gridSpan ?? 1);
        const startColumnIndex = columnCursor;
        const endColumnIndex = startColumnIndex + columnSpan - 1;
        columnCursor += columnSpan;

        if (cell.style?.vMergeContinuation) {
          return;
        }

        const condition = resolveTableConditionForCell(
          tableStyle,
          tableLook,
          rowIndex,
          rows.length,
          startColumnIndex,
          endColumnIndex,
          columnCount
        );
        if (!condition) {
          return;
        }

        if (condition.rowBackgroundColor && row.style?.backgroundColor === undefined) {
          row.style = {
            ...(row.style ?? {}),
            backgroundColor: condition.rowBackgroundColor
          };
        }

        if (
          condition.cellBackgroundColor &&
          cell.style?.backgroundColor === undefined &&
          row.style?.backgroundColor === undefined
        ) {
          cell.style = {
            ...(cell.style ?? {}),
            backgroundColor: condition.cellBackgroundColor
          };
        }

        if (condition.cellBorders) {
          cell.style = {
            ...(cell.style ?? {}),
            borders: mergeTableBorderSets(condition.cellBorders, cell.style?.borders)
          };
        }

        if (condition.paragraphAlign) {
          applyParagraphAlignmentToTableCellContent(cell.nodes, condition.paragraphAlign);
        }

        if (condition.runStyle) {
          applyRunStyleToTableCellContent(cell.nodes, condition.runStyle as TextStyle);
        }
      });
    });
  }

  const resolvedTableBorders = mergeTableBorderSets(
    tableStyle?.conditions.wholeTable?.tableBorders,
    explicitBorders
  );

  const hasTableStyle =
    widthTwips !== undefined ||
    indentTwips !== undefined ||
    layout !== undefined ||
    cellSpacingTwips !== undefined ||
    floating !== undefined ||
    cellMarginTwips !== undefined ||
    columnWidthsTwips.length > 0 ||
    resolvedTableBorders !== undefined;

  return {
    type: "table",
    rows,
    style: hasTableStyle
      ? {
          widthTwips,
          indentTwips,
          layout,
          cellSpacingTwips,
          floating,
          cellMarginTwips,
          columnWidthsTwips: columnWidthsTwips.length > 0 ? columnWidthsTwips : undefined,
          borders: resolvedTableBorders
        }
      : undefined,
    sourceXml: tableXml
  };
}

function extractBodyXml(documentXml: string): string {
  const bodyMatch = documentXml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/i);
  return bodyMatch?.[1] ?? documentXml;
}

function extractDocumentOpenTag(documentXml: string): string | undefined {
  const match = documentXml.match(/<w:document\b[^>]*>/i);
  return match?.[0];
}

function extractSectionPropertiesXml(documentXml: string): string | undefined {
  const bodyXml = extractBodyXml(documentXml);
  const matches = [...bodyXml.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/gi)];
  if (matches.length === 0) {
    return undefined;
  }
  return matches[matches.length - 1][0];
}

function parseReferencedSections(
  pkg: OoxmlPackage,
  documentXml: string,
  documentRelationships: Map<string, string>,
  contentTypes: ContentTypeLookup,
  styleSheet: ParsedStyleSheet,
  relationshipTagName: "headerReference" | "footerReference",
  missingTargetPrefix: string,
  missingPartPrefix: string,
  warnings: string[]
): Array<{ partName: string; referenceType?: string; nodes: DocNode[] }> {
  const sections: Array<{ partName: string; referenceType?: string; nodes: DocNode[] }> = [];
  const seenPartNames = new Set<string>();

  const tokenPattern = new RegExp(`<w:${relationshipTagName}\\b[^>]*>`, "gi");
  for (const reference of documentXml.matchAll(tokenPattern)) {
    const tag = reference[0];
    const relationshipId = getAttribute(tag, "r:id");
    if (!relationshipId) {
      continue;
    }

    const targetPartName = documentRelationships.get(relationshipId);
    if (!targetPartName) {
      warnings.push(`${missingTargetPrefix} ${relationshipId}`);
      continue;
    }

    if (seenPartNames.has(targetPartName)) {
      continue;
    }
    seenPartNames.add(targetPartName);

    const headerXml = pkg.parts.get(targetPartName)?.content;
    if (!headerXml) {
      warnings.push(`${missingPartPrefix} ${targetPartName}`);
      continue;
    }

    const headerContext: ParseContext = {
      relationships: parsePartRelationships(pkg, targetPartName),
      contentTypes,
      parts: pkg.parts,
      binaryAssets: pkg.binaryAssets,
      styleSheet,
      warnings
    };

    sections.push({
      partName: targetPartName,
      referenceType: getAttribute(tag, "w:type"),
      nodes: parseDocumentXml(headerXml, headerContext)
    });
  }

  return sections;
}

function parseHeaderSections(
  pkg: OoxmlPackage,
  documentXml: string,
  documentRelationships: Map<string, string>,
  contentTypes: ContentTypeLookup,
  styleSheet: ParsedStyleSheet,
  warnings: string[]
): HeaderSection[] {
  return parseReferencedSections(
    pkg,
    documentXml,
    documentRelationships,
    contentTypes,
    styleSheet,
    "headerReference",
    "Missing header relationship target for",
    "Missing header part",
    warnings
  );
}

function parseFooterSections(
  pkg: OoxmlPackage,
  documentXml: string,
  documentRelationships: Map<string, string>,
  contentTypes: ContentTypeLookup,
  styleSheet: ParsedStyleSheet,
  warnings: string[]
): FooterSection[] {
  return parseReferencedSections(
    pkg,
    documentXml,
    documentRelationships,
    contentTypes,
    styleSheet,
    "footerReference",
    "Missing footer relationship target for",
    "Missing footer part",
    warnings
  );
}

function parseSectionReferencesFromProperties(
  sectionPropertiesXml: string | undefined,
  relationshipTagName: "headerReference" | "footerReference",
  documentRelationships: Map<string, string>,
  resolvePartNodes: (
    partName: string,
    relationshipTagName: "headerReference" | "footerReference"
  ) => DocNode[] | undefined,
  warnings: string[]
): Array<{ partName: string; referenceType?: string; nodes: DocNode[] }> {
  if (!sectionPropertiesXml) {
    return [];
  }

  const references: Array<{ partName: string; referenceType?: string; nodes: DocNode[] }> = [];
  const seenReferences = new Set<string>();
  const tokenPattern = new RegExp(`<w:${relationshipTagName}\\b[^>]*\\/?>`, "gi");
  for (const reference of sectionPropertiesXml.matchAll(tokenPattern)) {
    const tag = reference[0];
    const relationshipId = getAttribute(tag, "r:id");
    if (!relationshipId) {
      continue;
    }

    const targetPartName = documentRelationships.get(relationshipId);
    if (!targetPartName) {
      warnings.push(
        `${relationshipTagName === "headerReference" ? "Missing header relationship target for" : "Missing footer relationship target for"} ${relationshipId}`
      );
      continue;
    }

    const referenceType = getAttribute(tag, "w:type");
    const dedupeKey = `${targetPartName}::${referenceType ?? ""}`;
    if (seenReferences.has(dedupeKey)) {
      continue;
    }
    seenReferences.add(dedupeKey);

    const nodes = resolvePartNodes(targetPartName, relationshipTagName);
    if (!nodes) {
      continue;
    }

    references.push({
      partName: targetPartName,
      referenceType,
      nodes
    });
  }

  return references;
}

function parseDocumentSections(
  pkg: OoxmlPackage,
  documentXml: string,
  documentRelationships: Map<string, string>,
  contentTypes: ContentTypeLookup,
  styleSheet: ParsedStyleSheet,
  warnings: string[]
): DocumentSection[] {
  const bodyXml = extractBodyXml(documentXml);
  const tokenRanges = extractBodyTokenRanges(bodyXml);
  const parsedPartNodesByName = new Map<string, DocNode[]>();
  let nodeCount = 0;
  let sectionStartNodeIndex = 0;
  const sections: DocumentSection[] = [];

  const resolvePartNodes = (
    partName: string,
    relationshipTagName: "headerReference" | "footerReference"
  ): DocNode[] | undefined => {
    const cachedNodes = parsedPartNodesByName.get(partName);
    if (cachedNodes) {
      return cachedNodes;
    }

    const partXml = pkg.parts.get(partName)?.content;
    if (!partXml) {
      warnings.push(
        `${relationshipTagName === "headerReference" ? "Missing header part" : "Missing footer part"} ${partName}`
      );
      return undefined;
    }

    const partContext: ParseContext = {
      relationships: parsePartRelationships(pkg, partName),
      contentTypes,
      parts: pkg.parts,
      binaryAssets: pkg.binaryAssets,
      styleSheet,
      warnings
    };

    const nodes = parseDocumentXml(partXml, partContext);
    parsedPartNodesByName.set(partName, nodes);
    return nodes;
  };

  for (const token of tokenRanges) {
    const tokenXml = bodyXml.slice(token.start, token.end);
    const producedNode = token.kind === "table" || !isGoBackBookmarkParagraph(tokenXml);
    if (token.kind === "paragraph") {
      const sectionPropertiesXml = tokenXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/i)?.[0];
      if (sectionPropertiesXml) {
        sections.push({
          startNodeIndex: sectionStartNodeIndex,
          sectionPropertiesXml,
          headerSections: parseSectionReferencesFromProperties(
            sectionPropertiesXml,
            "headerReference",
            documentRelationships,
            resolvePartNodes,
            warnings
          ),
          footerSections: parseSectionReferencesFromProperties(
            sectionPropertiesXml,
            "footerReference",
            documentRelationships,
            resolvePartNodes,
            warnings
          )
        });
        sectionStartNodeIndex = nodeCount + (producedNode ? 1 : 0);
      }
    }

    if (producedNode) {
      nodeCount += 1;
    }
  }

  const finalSectionPropertiesXml = extractSectionPropertiesXml(documentXml);
  if (finalSectionPropertiesXml) {
    sections.push({
      startNodeIndex: sectionStartNodeIndex,
      sectionPropertiesXml: finalSectionPropertiesXml,
      headerSections: parseSectionReferencesFromProperties(
        finalSectionPropertiesXml,
        "headerReference",
        documentRelationships,
        resolvePartNodes,
        warnings
      ),
      footerSections: parseSectionReferencesFromProperties(
        finalSectionPropertiesXml,
        "footerReference",
        documentRelationships,
        resolvePartNodes,
        warnings
      )
    });
  }

  const normalizedSections: DocumentSection[] = [];
  for (const section of sections) {
    if (nodeCount > 0 && section.startNodeIndex > nodeCount) {
      continue;
    }

    const previous = normalizedSections[normalizedSections.length - 1];
    if (
      previous &&
      previous.startNodeIndex === section.startNodeIndex &&
      previous.sectionPropertiesXml === section.sectionPropertiesXml
    ) {
      continue;
    }
    normalizedSections.push(section);
  }

  if (normalizedSections.length === 0) {
    normalizedSections.push({
      startNodeIndex: 0,
      sectionPropertiesXml: finalSectionPropertiesXml,
      headerSections: [],
      footerSections: []
    });
  }

  normalizedSections.sort((left, right) => left.startNodeIndex - right.startNodeIndex);
  return normalizedSections;
}

function paragraphPlainText(paragraph: ParagraphNode): string {
  return paragraph.children
    .map((child) => {
      if (child.type === "text") {
        return child.text;
      }

      if (child.type === "form-field") {
        if (child.fieldType === "checkbox") {
          const isChecked = child.checked ?? child.widget?.checkbox?.defaultChecked ?? false;
          return isChecked ? child.checkedSymbol ?? "☒" : child.uncheckedSymbol ?? "☐";
        }
        if (child.fieldType === "text") {
          return child.value ?? child.widget?.text?.defaultText ?? "";
        }
        return child.value ?? "";
      }

      return "";
    })
    .join("");
}

function noteTextFromNodes(nodes: DocNode[]): string {
  const lines: string[] = [];

  const appendParagraph = (paragraph: ParagraphNode): void => {
    const text = paragraphPlainText(paragraph).trimEnd();
    if (text.length > 0) {
      lines.push(text);
    }
  };

  const appendParagraphFromNode = (node: ParagraphNode | TableNode): void => {
    if (node.type === "paragraph") {
      appendParagraph(node);
      return;
    }

    for (const row of node.rows) {
      for (const cell of row.cells) {
        for (const paragraph of cellParagraphsFromContent(cell.nodes)) {
          appendParagraph(paragraph);
        }
      }
    }
  };

  for (const node of nodes) {
    appendParagraphFromNode(node);
  }

  const joined = lines.join("\n").trim();
  return joined.replace(/^\[[0-9]+\]\s*/, "");
}

function parseDocumentNotesFromPart(
  pkg: OoxmlPackage,
  partName: string,
  tagName: "w:footnote" | "w:endnote",
  contentTypes: ContentTypeLookup,
  styleSheet: ParsedStyleSheet,
  warnings: string[]
): DocumentNoteDefinition[] {
  const notesXml = pkg.parts.get(partName)?.content;
  if (!notesXml) {
    return [];
  }

  const context: ParseContext = {
    relationships: parsePartRelationships(pkg, partName),
    contentTypes,
    parts: pkg.parts,
    binaryAssets: pkg.binaryAssets,
    styleSheet,
    warnings
  };

  const notes: DocumentNoteDefinition[] = [];
  for (const noteXml of extractBalancedTagBlocks(notesXml, tagName)) {
    const noteTag = noteXml.match(new RegExp(`<${escapeRegExp(tagName)}\\b[^>]*>`, "i"))?.[0] ?? "";
    if (getAttribute(noteTag, "w:type")) {
      continue;
    }

    const noteId = parseIntegerAttribute(noteTag, "w:id");
    if (noteId === undefined || noteId < 0) {
      continue;
    }

    const parsedNodes = parseDocumentXml(noteXml, context);
    const text = noteTextFromNodes(parsedNodes);
    if (!text) {
      continue;
    }

    notes.push({
      id: noteId,
      text,
      nodes: parsedNodes
    });
  }

  return notes.sort((left, right) => left.id - right.id);
}

function pointsToPixels(points: number): number {
  return Math.max(1, Math.round((points * 96) / 72));
}

function parseCssPointValue(styleValue: string | undefined, cssProperty: string): number | undefined {
  if (!styleValue) {
    return undefined;
  }

  const escapedProperty = escapeRegExp(cssProperty);
  const match = styleValue.match(new RegExp(`${escapedProperty}\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)pt`, "i"));
  if (!match?.[1]) {
    return undefined;
  }

  const parsed = Number.parseFloat(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return pointsToPixels(parsed);
}

function parseNumberingPictureBulletDefinitions(
  pkg: OoxmlPackage,
  numberingXml: string,
  contentTypes: ContentTypeLookup
): Map<number, NumberingPictureBulletDefinition> {
  const pictureBullets = new Map<number, NumberingPictureBulletDefinition>();
  const numberingRelationships = parsePartRelationships(pkg, "word/numbering.xml");

  for (const numPicBulletXml of extractBalancedTagBlocks(numberingXml, "w:numPicBullet")) {
    const numPicBulletTag = numPicBulletXml.match(/<w:numPicBullet\b[^>]*>/i)?.[0] ?? "";
    const numPicBulletIdRaw = getAttribute(numPicBulletTag, "w:numPicBulletId");
    const numPicBulletId = numPicBulletIdRaw ? Number(numPicBulletIdRaw) : Number.NaN;
    if (!Number.isFinite(numPicBulletId)) {
      continue;
    }

    const shapeTag = numPicBulletXml.match(/<v:shape\b[^>]*>/i)?.[0];
    const shapeStyle = shapeTag ? getAttribute(shapeTag, "style") : undefined;
    const widthPx = parseCssPointValue(shapeStyle, "width");
    const heightPx = parseCssPointValue(shapeStyle, "height");

    const imageTag = numPicBulletXml.match(/<v:imagedata\b[^>]*\/?>/i)?.[0];
    const relationshipId = imageTag ? getAttribute(imageTag, "r:id") : undefined;
    const imagePartName = relationshipId ? numberingRelationships.get(relationshipId) : undefined;
    const imageBytes = imagePartName ? pkg.binaryAssets.get(imagePartName) : undefined;
    const imageContentType =
      imagePartName ? contentTypeForPart(imagePartName, contentTypes) : undefined;
    const src =
      imagePartName && imageBytes && imageContentType
        ? `data:${imageContentType};base64,${bytesToBase64(imageBytes)}`
        : undefined;

    pictureBullets.set(Math.round(numPicBulletId), {
      numPicBulletId: Math.round(numPicBulletId),
      src,
      widthPx,
      heightPx,
      partName: imagePartName,
      contentType: imageContentType
    });
  }

  return pictureBullets;
}

function parseNumberingLevelDefinition(
  levelXml: string,
  pictureBulletsById: Map<number, NumberingPictureBulletDefinition>
): NumberingLevelDefinition | undefined {
  if (!levelXml) {
    return undefined;
  }

  const levelTag = levelXml.match(/<w:lvl\b[^>]*>/i)?.[0] ?? "";
  const ilvlRaw = getAttribute(levelTag, "w:ilvl");
  const ilvl = ilvlRaw ? Number(ilvlRaw) : Number.NaN;
  if (!Number.isFinite(ilvl)) {
    return undefined;
  }

  const startTag = levelXml.match(/<w:start\b[^>]*\/?>/i)?.[0];
  const numFmtTag = levelXml.match(/<w:numFmt\b[^>]*\/?>/i)?.[0];
  const lvlTextTag = levelXml.match(/<w:lvlText\b[^>]*\/?>/i)?.[0];
  const suffixTag = levelXml.match(/<w:suff\b[^>]*\/?>/i)?.[0];
  const levelRunPropertiesXml =
    extractBalancedTagBlocks(levelXml, "w:rPr")[0] ?? levelXml.match(/<w:rPr\b[^>]*\/>/i)?.[0] ?? "";
  const levelParagraphPropertiesXml =
    extractBalancedTagBlocks(levelXml, "w:pPr")[0] ?? levelXml.match(/<w:pPr\b[^>]*\/?>/i)?.[0] ?? "";
  const levelFontsTag = levelRunPropertiesXml.match(/<w:rFonts\b[^>]*\/?>/i)?.[0];
  const levelColorTag = levelRunPropertiesXml.match(/<w:color\b[^>]*\/?>/i)?.[0];
  const levelRunStyle = parseTextStyleFromXml(levelRunPropertiesXml);
  const pictureBulletTag = levelXml.match(/<w:lvlPicBulletId\b[^>]*\/?>/i)?.[0];
  const suffixRaw = suffixTag ? getAttribute(suffixTag, "w:val")?.toLowerCase() : undefined;
  const pictureBulletIdRaw = pictureBulletTag ? getAttribute(pictureBulletTag, "w:val") : undefined;
  const pictureBulletId = pictureBulletIdRaw ? Number(pictureBulletIdRaw) : Number.NaN;
  const bulletFontFamily = decodeXmlAttribute(
    levelFontsTag
      ? getAttribute(levelFontsTag, "w:ascii") ??
        getAttribute(levelFontsTag, "w:hAnsi") ??
        getAttribute(levelFontsTag, "w:eastAsia") ??
        getAttribute(levelFontsTag, "w:cs")
      : undefined
  )?.trim();
  const bulletColor = normalizeHexColor(
    levelColorTag ? getAttribute(levelColorTag, "w:val") : undefined
  );

  const suffix =
    suffixRaw === "tab" || suffixRaw === "space" || suffixRaw === "nothing"
      ? suffixRaw
      : undefined;
  const indent = levelParagraphPropertiesXml
    ? parseParagraphIndentFromXml(levelParagraphPropertiesXml)
    : undefined;

  return {
    ilvl: Math.max(0, Math.round(ilvl)),
    start: startTag ? parseIntegerAttribute(startTag, "w:val") : undefined,
    format: numFmtTag ? getAttribute(numFmtTag, "w:val") : undefined,
    text: lvlTextTag ? getAttribute(lvlTextTag, "w:val") : undefined,
    suffix,
    indent,
    runStyle: levelRunStyle,
    bulletFontFamily,
    bulletColor,
    pictureBulletId: Number.isFinite(pictureBulletId) ? Math.round(pictureBulletId) : undefined,
    pictureBullet: Number.isFinite(pictureBulletId)
      ? pictureBulletsById.get(Math.round(pictureBulletId))
      : undefined
  };
}

function parseNumberingDefinitions(
  pkg: OoxmlPackage,
  contentTypes: ContentTypeLookup
): NumberingDefinitionSet | undefined {
  const numberingXml = pkg.parts.get("word/numbering.xml")?.content;
  if (!numberingXml) {
    return undefined;
  }
  const pictureBulletsById = parseNumberingPictureBulletDefinitions(pkg, numberingXml, contentTypes);

  const parsedAbstracts = extractBalancedTagBlocks(numberingXml, "w:abstractNum")
    .map((abstractXml) => {
      const abstractTag = abstractXml.match(/<w:abstractNum\b[^>]*>/i)?.[0] ?? "";
      const abstractNumIdRaw = getAttribute(abstractTag, "w:abstractNumId");
      const abstractNumId = abstractNumIdRaw ? Number(abstractNumIdRaw) : Number.NaN;
      if (!Number.isFinite(abstractNumId)) {
        return undefined;
      }

      const styleLinkTag = abstractXml.match(/<w:styleLink\b[^>]*\/?>/i)?.[0];
      const numStyleLinkTag = abstractXml.match(/<w:numStyleLink\b[^>]*\/?>/i)?.[0];
      const levels = extractBalancedTagBlocks(abstractXml, "w:lvl")
        .map((levelXml) => parseNumberingLevelDefinition(levelXml, pictureBulletsById))
        .filter((level): level is NumberingLevelDefinition => Boolean(level))
        .sort((left, right) => left.ilvl - right.ilvl);

      return {
        abstractNumId: Math.round(abstractNumId),
        styleLink: styleLinkTag ? getAttribute(styleLinkTag, "w:val") : undefined,
        numStyleLink: numStyleLinkTag ? getAttribute(numStyleLinkTag, "w:val") : undefined,
        levels
      };
    })
    .filter(
      (
        entry
      ): entry is {
        abstractNumId: number;
        styleLink: string | undefined;
        numStyleLink: string | undefined;
        levels: NumberingLevelDefinition[];
      } => Boolean(entry)
    );

  const styleLinkedLevels = new Map<string, NumberingLevelDefinition[]>();
  for (const abstractDefinition of parsedAbstracts) {
    if (!abstractDefinition.styleLink || abstractDefinition.levels.length === 0) {
      continue;
    }
    styleLinkedLevels.set(abstractDefinition.styleLink, abstractDefinition.levels);
  }

  const abstracts: NumberingAbstractDefinition[] = parsedAbstracts.map((abstractDefinition) => {
    const linkedLevels =
      abstractDefinition.levels.length > 0
        ? abstractDefinition.levels
        : abstractDefinition.numStyleLink
          ? styleLinkedLevels.get(abstractDefinition.numStyleLink) ?? []
          : [];

    return {
      abstractNumId: abstractDefinition.abstractNumId,
      levels: linkedLevels.map((level) => ({ ...level }))
    };
  });

  const instances = extractBalancedTagBlocks(numberingXml, "w:num")
    .map((numXml): NumberingInstanceDefinition | undefined => {
      const numTag = numXml.match(/<w:num\b[^>]*>/i)?.[0] ?? "";
      const numIdRaw = getAttribute(numTag, "w:numId");
      const numId = numIdRaw ? Number(numIdRaw) : Number.NaN;
      if (!Number.isFinite(numId)) {
        return undefined;
      }

      const abstractNumIdTag = numXml.match(/<w:abstractNumId\b[^>]*\/?>/i)?.[0];
      const abstractNumIdRaw = abstractNumIdTag ? getAttribute(abstractNumIdTag, "w:val") : undefined;
      const abstractNumId = abstractNumIdRaw ? Number(abstractNumIdRaw) : Number.NaN;
      if (!Number.isFinite(abstractNumId)) {
        return undefined;
      }

      const levelStartOverrides: Record<string, number> = {};
      const levelOverrides: NumberingLevelDefinition[] = [];
      for (const overrideXml of extractBalancedTagBlocks(numXml, "w:lvlOverride")) {
        const overrideTag = overrideXml.match(/<w:lvlOverride\b[^>]*>/i)?.[0] ?? "";
        const overrideLevelRaw = getAttribute(overrideTag, "w:ilvl");
        const overrideLevel = overrideLevelRaw ? Number(overrideLevelRaw) : Number.NaN;
        if (!Number.isFinite(overrideLevel)) {
          continue;
        }

        const startOverrideTag = overrideXml.match(/<w:startOverride\b[^>]*\/?>/i)?.[0];
        const startOverride = startOverrideTag
          ? parseIntegerAttribute(startOverrideTag, "w:val")
          : undefined;
        if (startOverride !== undefined && startOverride > 0) {
          levelStartOverrides[String(Math.max(0, Math.round(overrideLevel)))] = startOverride;
        }

        const levelXml = extractBalancedTagBlocks(overrideXml, "w:lvl")[0];
        const parsedLevel = levelXml
          ? parseNumberingLevelDefinition(levelXml, pictureBulletsById)
          : undefined;
        if (parsedLevel) {
          levelOverrides.push(parsedLevel);
        }
      }

      return {
        numId: Math.round(numId),
        abstractNumId: Math.round(abstractNumId),
        levelStartOverrides: Object.keys(levelStartOverrides).length > 0 ? levelStartOverrides : undefined,
        levelOverrides: levelOverrides.length > 0 ? levelOverrides : undefined
      };
    })
    .filter((instance): instance is NumberingInstanceDefinition => Boolean(instance));

  if (abstracts.length === 0 && instances.length === 0) {
    return undefined;
  }

  return {
    abstracts,
    instances
  };
}

function isGoBackBookmarkParagraph(paragraphXml: string): boolean {
  if (!/w:name="_GoBack"/i.test(paragraphXml)) {
    return false;
  }

  return !/<w:r\b/i.test(paragraphXml) && !/<w:drawing\b/i.test(paragraphXml);
}

type BodyTokenRange = {
  start: number;
  end: number;
  kind: "table" | "paragraph";
};

function extractBodyTokenRanges(bodyXml: string): BodyTokenRange[] {
  return extractBalancedTagBlocksInOrder(bodyXml, ["w:tbl", "w:p"]).map(
    (range) => ({
      start: range.start,
      end: range.end,
      kind: range.tagName === "w:tbl" ? ("table" as const) : ("paragraph" as const),
    })
  );
}

export function parseDocumentXml(documentXml: string, context?: ParseContext): DocNode[] {
  const parseContext: ParseContext =
    context ?? {
      relationships: new Map(),
      contentTypes: { defaultByExtension: new Map(), overrideByPartName: new Map() },
      parts: new Map(),
      binaryAssets: new Map(),
      styleSheet: EMPTY_STYLE_SHEET,
      warnings: []
    };

  const nodes: DocNode[] = [];
  const bodyXml = extractBodyXml(documentXml);
  const tokenRanges = extractBodyTokenRanges(bodyXml);

  for (const token of tokenRanges) {
    const tokenXml = bodyXml.slice(token.start, token.end);
    if (tokenXml.startsWith("<w:tbl")) {
      nodes.push(parseTable(tokenXml, parseContext));
    } else {
      if (isGoBackBookmarkParagraph(tokenXml)) {
        continue;
      }
      nodes.push(parseParagraph(tokenXml, parseContext));
    }
  }

  if (nodes.length === 0) {
    nodes.push({
      type: "paragraph",
      children: [{ type: "text", text: "" }]
    });
  }

  return nodes;
}

function parseDocumentPageCountFromAppProperties(pkg: OoxmlPackage): number | undefined {
  const appXml = pkg.parts.get("docProps/app.xml")?.content ?? "";
  if (!appXml) {
    return undefined;
  }

  const pagesRaw = appXml.match(/<Pages>(\d+)<\/Pages>/i)?.[1];
  if (!pagesRaw) {
    return undefined;
  }

  const parsed = Number.parseInt(pagesRaw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseFirstOnOffSetting(
  settingsXml: string,
  tagNames: string[]
): boolean | undefined {
  for (const tagName of tagNames) {
    const parsed = parseOnOffAttribute(settingsXml, tagName);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}

function parseDocumentCompatibilitySettings(
  pkg: OoxmlPackage
): DocumentCompatibilitySettings | undefined {
  const settingsXml = pkg.parts.get("word/settings.xml")?.content ?? "";
  if (!settingsXml) {
    return undefined;
  }

  const compatXml =
    extractBalancedTagBlocks(settingsXml, "w:compat")[0] ??
    settingsXml.match(/<w:compat\b[^>]*\/>/i)?.[0] ??
    "";
  if (!compatXml) {
    return undefined;
  }

  const suppressSpacingBeforeAfterPageBreak = parseFirstOnOffSetting(compatXml, [
    "suppressSpBfAfterPgBrk"
  ]);
  const usePrinterMetrics = parseFirstOnOffSetting(compatXml, ["usePrinterMetrics"]);
  const useFixedHtmlParagraphSpacing = parseFirstOnOffSetting(compatXml, [
    "doNotUseHTMLParagraphAutoSpacing"
  ]);
  const doNotBreakWrappedTables = parseFirstOnOffSetting(compatXml, [
    "doNotBreakWrappedTables",
    "dontBreakWrappedTables"
  ]);
  const doNotBreakConstrainedForcedTable = parseFirstOnOffSetting(compatXml, [
    "doNotBreakConstrainedForcedTable",
    "dontBreakConstrainedForcedTable"
  ]);
  const evenAndOddHeaders = parseFirstOnOffSetting(settingsXml, ["evenAndOddHeaders"]);

  if (
    suppressSpacingBeforeAfterPageBreak === undefined &&
    usePrinterMetrics === undefined &&
    useFixedHtmlParagraphSpacing === undefined &&
    doNotBreakWrappedTables === undefined &&
    doNotBreakConstrainedForcedTable === undefined &&
    evenAndOddHeaders === undefined
  ) {
    return undefined;
  }

  return {
    suppressSpacingBeforeAfterPageBreak,
    usePrinterMetrics,
    useFixedHtmlParagraphSpacing,
    doNotBreakWrappedTables,
    doNotBreakConstrainedForcedTable,
    evenAndOddHeaders
  };
}

export function buildDocModel(pkg: OoxmlPackage): DocModel {
  const warnings: string[] = [];
  const documentXml = pkg.parts.get("word/document.xml")?.content;
  if (!documentXml) {
    warnings.push("Missing word/document.xml");
  }

  const resolvedDocumentXml = documentXml ?? "";
  const documentOpenTag = extractDocumentOpenTag(resolvedDocumentXml);
  const documentBackgroundColor =
    parseDocumentBackgroundColor(resolvedDocumentXml);
  const documentPageCount = parseDocumentPageCountFromAppProperties(pkg);
  const compatibility = parseDocumentCompatibilitySettings(pkg);
  const sectionPropertiesXml = extractSectionPropertiesXml(resolvedDocumentXml);
  const contentTypes = parseContentTypes(pkg);
  const styleSheet = parseStyleSheet(pkg);
  const numberingDefinitions = parseNumberingDefinitions(pkg, contentTypes);
  const documentRelationships = parsePartRelationships(pkg, "word/document.xml");

  const context: ParseContext = {
    relationships: documentRelationships,
    contentTypes,
    parts: pkg.parts,
    binaryAssets: pkg.binaryAssets,
    styleSheet,
    warnings
  };
  const headerSections = parseHeaderSections(
    pkg,
    resolvedDocumentXml,
    documentRelationships,
    contentTypes,
    styleSheet,
    warnings
  );
  const footerSections = parseFooterSections(
    pkg,
    resolvedDocumentXml,
    documentRelationships,
    contentTypes,
    styleSheet,
    warnings
  );
  const sections = parseDocumentSections(
    pkg,
    resolvedDocumentXml,
    documentRelationships,
    contentTypes,
    styleSheet,
    warnings
  );
  const footnotes = parseDocumentNotesFromPart(
    pkg,
    "word/footnotes.xml",
    "w:footnote",
    contentTypes,
    styleSheet,
    warnings
  );
  const endnotes = parseDocumentNotesFromPart(
    pkg,
    "word/endnotes.xml",
    "w:endnote",
    contentTypes,
    styleSheet,
    warnings
  );

  return {
    nodes: parseDocumentXml(resolvedDocumentXml, context),
    metadata: {
      sourceParts: pkg.parts.size,
      warnings,
      documentPageCount,
      documentOpenTag,
      documentBackgroundColor,
      sectionPropertiesXml,
      sections,
      headerSections,
      footerSections,
      paragraphStyles: styleSheet.paragraphStyles.map((style) => ({
        ...style,
        runStyle: style.runStyle ? { ...style.runStyle } : undefined,
        numbering: style.numbering ? { ...style.numbering } : undefined,
        spacing: style.spacing ? { ...style.spacing } : undefined,
        indent: style.indent ? { ...style.indent } : undefined,
        borders: style.borders
          ? {
              top: style.borders.top ? { ...style.borders.top } : undefined,
              right: style.borders.right ? { ...style.borders.right } : undefined,
              bottom: style.borders.bottom ? { ...style.borders.bottom } : undefined,
              left: style.borders.left ? { ...style.borders.left } : undefined,
              between: style.borders.between ? { ...style.borders.between } : undefined,
              bar: style.borders.bar ? { ...style.borders.bar } : undefined
            }
          : undefined
      })),
      defaultParagraphStyleId: styleSheet.defaultParagraphStyleId,
      numberingDefinitions: numberingDefinitions
        ? {
            abstracts: numberingDefinitions.abstracts.map((abstractDefinition) => ({
              abstractNumId: abstractDefinition.abstractNumId,
              levels: abstractDefinition.levels.map((level) => ({
                ...level,
                pictureBullet: level.pictureBullet ? { ...level.pictureBullet } : undefined
              }))
            })),
            instances: numberingDefinitions.instances.map((instanceDefinition) => ({
              numId: instanceDefinition.numId,
              abstractNumId: instanceDefinition.abstractNumId,
              levelStartOverrides: instanceDefinition.levelStartOverrides
                ? { ...instanceDefinition.levelStartOverrides }
                : undefined,
              levelOverrides: instanceDefinition.levelOverrides
                ? instanceDefinition.levelOverrides.map((level) => ({
                    ...level,
                    pictureBullet: level.pictureBullet ? { ...level.pictureBullet } : undefined
                  }))
                : undefined
            }))
          }
        : undefined,
      compatibility: compatibility ? { ...compatibility } : undefined,
      footnotes:
        footnotes.length > 0
          ? footnotes.map((note) => ({
              ...note,
              nodes: note.nodes?.map(cloneDocNode)
            }))
          : undefined,
      endnotes:
        endnotes.length > 0
          ? endnotes.map((note) => ({
              ...note,
              nodes: note.nodes?.map(cloneDocNode)
            }))
          : undefined
    }
  };
}

function cloneParagraphNumbering(
  numbering?: ParagraphNumbering
): ParagraphNumbering | undefined {
  return numbering ? { ...numbering } : undefined;
}

function cloneParagraphSpacing(
  spacing?: ParagraphSpacing
): ParagraphSpacing | undefined {
  return spacing ? { ...spacing } : undefined;
}

function cloneParagraphIndent(
  indent?: ParagraphIndent
): ParagraphIndent | undefined {
  return indent ? { ...indent } : undefined;
}

function cloneParagraphBorderStyle(
  border?: ParagraphBorderStyle
): ParagraphBorderStyle | undefined {
  return border ? { ...border } : undefined;
}

function cloneParagraphBorderSet(
  borders?: ParagraphBorderSet
): ParagraphBorderSet | undefined {
  if (!borders) {
    return undefined;
  }

  return {
    top: cloneParagraphBorderStyle(borders.top),
    right: cloneParagraphBorderStyle(borders.right),
    bottom: cloneParagraphBorderStyle(borders.bottom),
    left: cloneParagraphBorderStyle(borders.left),
    between: cloneParagraphBorderStyle(borders.between),
    bar: cloneParagraphBorderStyle(borders.bar)
  };
}

function cloneParagraphStyle(
  style?: ParagraphStyle
): ParagraphStyle | undefined {
  if (!style) {
    return undefined;
  }

  return {
    ...style,
    numbering: cloneParagraphNumbering(style.numbering),
    spacing: cloneParagraphSpacing(style.spacing),
    indent: cloneParagraphIndent(style.indent),
    borders: cloneParagraphBorderSet(style.borders),
    dropCap: style.dropCap
      ? {
          ...style.dropCap
        }
      : undefined
  };
}

function cloneParagraph(paragraph: ParagraphNode): ParagraphNode {
  return {
    type: "paragraph",
    style: cloneParagraphStyle(paragraph.style),
    paragraphMarkDeleted: paragraph.paragraphMarkDeleted,
    sourceXml: paragraph.sourceXml,
    children: paragraph.children.map((child) => {
      if (child.type === "text") {
        return {
          type: "text" as const,
          text: child.text,
          style: child.style ? { ...child.style } : undefined,
          link: child.link
        };
      }

      if (child.type === "form-field") {
        return {
          type: "form-field" as const,
          fieldType: child.fieldType,
          sourceKind: child.sourceKind,
          id: child.id,
          tag: child.tag,
          title: child.title,
          placeholder: child.placeholder,
          checked: child.checked,
          value: child.value,
          options: child.options?.map((option) => ({
            displayText: option.displayText,
            value: option.value
          })),
          widget: child.widget
            ? {
                name: child.widget.name,
                enabled: child.widget.enabled,
                calcOnExit: child.widget.calcOnExit,
                text: child.widget.text
                  ? {
                      inputType: child.widget.text.inputType,
                      defaultText: child.widget.text.defaultText,
                      maxLength: child.widget.text.maxLength,
                      textFormat: child.widget.text.textFormat
                    }
                  : undefined,
                checkbox: child.widget.checkbox
                  ? {
                      defaultChecked: child.widget.checkbox.defaultChecked,
                      sizeMode: child.widget.checkbox.sizeMode,
                      sizePt: child.widget.checkbox.sizePt
                    }
                  : undefined,
                dropdown: child.widget.dropdown
                  ? {
                      defaultValue: child.widget.dropdown.defaultValue
                    }
                  : undefined
              }
            : undefined,
          checkedSymbol: child.checkedSymbol,
          uncheckedSymbol: child.uncheckedSymbol,
          style: child.style ? { ...child.style } : undefined,
          link: child.link,
          sourceXml: child.sourceXml
        };
      }

      return {
        type: "image" as const,
        src: child.src,
        alt: child.alt,
        widthPx: child.widthPx,
        heightPx: child.heightPx,
        partName: child.partName,
        contentType: child.contentType,
        data: child.data ? new Uint8Array(child.data) : undefined,
        sourceXml: child.sourceXml,
        crop: child.crop ? { ...child.crop } : undefined,
        cssFilter: child.cssFilter,
        cssOpacity: child.cssOpacity,
        floating: child.floating ? { ...child.floating } : undefined,
        syntheticTextBox: child.syntheticTextBox,
        textBoxText: child.textBoxText
      };
    })
  };
}

function cloneTableBoxSpacing(spacing?: TableBoxSpacing): TableBoxSpacing | undefined {
  if (!spacing) {
    return undefined;
  }

  return {
    topTwips: spacing.topTwips,
    rightTwips: spacing.rightTwips,
    bottomTwips: spacing.bottomTwips,
    leftTwips: spacing.leftTwips
  };
}

function cloneTableBorderStyle(border?: TableBorderStyle): TableBorderStyle | undefined {
  if (!border) {
    return undefined;
  }

  return {
    type: border.type,
    color: border.color,
    sizeEighthPt: border.sizeEighthPt
  };
}

function cloneTableBorderSet(borders?: TableBorderSet): TableBorderSet | undefined {
  if (!borders) {
    return undefined;
  }

  return {
    top: cloneTableBorderStyle(borders.top),
    right: cloneTableBorderStyle(borders.right),
    bottom: cloneTableBorderStyle(borders.bottom),
    left: cloneTableBorderStyle(borders.left),
    insideH: cloneTableBorderStyle(borders.insideH),
    insideV: cloneTableBorderStyle(borders.insideV),
    tl2br: cloneTableBorderStyle(borders.tl2br),
    tr2bl: cloneTableBorderStyle(borders.tr2bl)
  };
}

function cloneTableFloatingStyle(
  floating?: NonNullable<TableStyle["floating"]>
): NonNullable<TableStyle["floating"]> | undefined {
  if (!floating) {
    return undefined;
  }

  return {
    xTwips: floating.xTwips,
    yTwips: floating.yTwips,
    leftFromTextTwips: floating.leftFromTextTwips,
    rightFromTextTwips: floating.rightFromTextTwips,
    topFromTextTwips: floating.topFromTextTwips,
    bottomFromTextTwips: floating.bottomFromTextTwips,
    horizontalAnchor: floating.horizontalAnchor,
    verticalAnchor: floating.verticalAnchor,
    horizontalAlign: floating.horizontalAlign,
    verticalAlign: floating.verticalAlign
  };
}

function cloneTable(table: TableNode): TableNode {
  return {
    type: "table",
    sourceXml: table.sourceXml,
    style: table.style
      ? {
          widthTwips: table.style.widthTwips,
          indentTwips: table.style.indentTwips,
          layout: table.style.layout,
          cellSpacingTwips: table.style.cellSpacingTwips,
          floating: cloneTableFloatingStyle(table.style.floating),
          cellMarginTwips: cloneTableBoxSpacing(table.style.cellMarginTwips),
          columnWidthsTwips: table.style.columnWidthsTwips
            ? [...table.style.columnWidthsTwips]
            : undefined,
          borders: cloneTableBorderSet(table.style.borders)
        }
      : undefined,
    rows: table.rows.map((row) => ({
      type: "table-row",
      style: row.style ? { ...row.style } : undefined,
      cells: row.cells.map((cell) => ({
        type: "table-cell",
        style: cell.style
          ? {
              ...cell.style,
              marginTwips: cloneTableBoxSpacing(cell.style.marginTwips),
              borders: cloneTableBorderSet(cell.style.borders)
            }
          : undefined,
        nodes: cloneTableCellContent(cell.nodes)
      }))
    }))
  };
}

function cloneDocNode(node: DocNode): DocNode {
  return node.type === "paragraph" ? cloneParagraph(node) : cloneTable(node);
}

function cloneNumberingDefinitions(
  numberingDefinitions?: NumberingDefinitionSet
): NumberingDefinitionSet | undefined {
  if (!numberingDefinitions) {
    return undefined;
  }

  return {
    abstracts: numberingDefinitions.abstracts.map((abstractDefinition) => ({
      abstractNumId: abstractDefinition.abstractNumId,
      levels: abstractDefinition.levels.map((level) => ({
        ...level,
        runStyle: level.runStyle ? { ...level.runStyle } : undefined,
        pictureBullet: level.pictureBullet ? { ...level.pictureBullet } : undefined
      }))
    })),
    instances: numberingDefinitions.instances.map((instanceDefinition) => ({
      numId: instanceDefinition.numId,
      abstractNumId: instanceDefinition.abstractNumId,
      levelStartOverrides: instanceDefinition.levelStartOverrides
        ? { ...instanceDefinition.levelStartOverrides }
        : undefined,
      levelOverrides: instanceDefinition.levelOverrides
        ? instanceDefinition.levelOverrides.map((level) => ({
            ...level,
            runStyle: level.runStyle ? { ...level.runStyle } : undefined,
            pictureBullet: level.pictureBullet ? { ...level.pictureBullet } : undefined
          }))
        : undefined
    }))
  };
}

export function cloneDocModel(model: DocModel): DocModel {
  return {
    nodes: model.nodes.map(cloneDocNode),
    metadata: {
      sourceParts: model.metadata.sourceParts,
      warnings: [...model.metadata.warnings],
      documentPageCount: model.metadata.documentPageCount,
      documentOpenTag: model.metadata.documentOpenTag,
      documentBackgroundColor: model.metadata.documentBackgroundColor,
      sectionPropertiesXml: model.metadata.sectionPropertiesXml,
      sections: model.metadata.sections?.map((section) => ({
        startNodeIndex: section.startNodeIndex,
        sectionPropertiesXml: section.sectionPropertiesXml,
        headerSections: (section.headerSections ?? []).map((headerSection) => ({
          partName: headerSection.partName,
          referenceType: headerSection.referenceType,
          nodes: headerSection.nodes.map(cloneDocNode)
        })),
        footerSections: (section.footerSections ?? []).map((footerSection) => ({
          partName: footerSection.partName,
          referenceType: footerSection.referenceType,
          nodes: footerSection.nodes.map(cloneDocNode)
        }))
      })),
      headerSections: (model.metadata.headerSections ?? []).map((section) => ({
        partName: section.partName,
        referenceType: section.referenceType,
        nodes: section.nodes.map(cloneDocNode)
      })),
      footerSections: (model.metadata.footerSections ?? []).map((section) => ({
        partName: section.partName,
        referenceType: section.referenceType,
        nodes: section.nodes.map(cloneDocNode)
      })),
      paragraphStyles: (model.metadata.paragraphStyles ?? []).map((style) => ({
        ...style,
        runStyle: style.runStyle ? { ...style.runStyle } : undefined,
        numbering: cloneParagraphNumbering(style.numbering),
        spacing: cloneParagraphSpacing(style.spacing),
        indent: cloneParagraphIndent(style.indent),
        borders: cloneParagraphBorderSet(style.borders)
      })),
      defaultParagraphStyleId: model.metadata.defaultParagraphStyleId,
      numberingDefinitions: cloneNumberingDefinitions(model.metadata.numberingDefinitions),
      compatibility: model.metadata.compatibility ? { ...model.metadata.compatibility } : undefined,
      footnotes: model.metadata.footnotes?.map((note) => ({
        ...note,
        nodes: note.nodes?.map(cloneDocNode)
      })),
      endnotes: model.metadata.endnotes?.map((note) => ({
        ...note,
        nodes: note.nodes?.map(cloneDocNode)
      }))
    }
  };
}
