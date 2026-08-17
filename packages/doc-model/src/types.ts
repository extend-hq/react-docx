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
  /** Resolved single-family fallback retained for backwards compatibility. */
  fontFamily?: string;
  /** @internal Import-time fallback used to detect fontFamily edits. */
  sourceFontFamily?: string;
  /** Explicit OOXML w:rFonts slots. */
  fontFamilyAscii?: string;
  fontFamilyHAnsi?: string;
  fontFamilyEastAsia?: string;
  fontFamilyCs?: string;
  fontThemeAscii?: string;
  fontThemeHAnsi?: string;
  fontThemeEastAsia?: string;
  fontThemeCs?: string;
  /** @internal Concrete families resolved from the document theme per slot. */
  resolvedFontFamilyAscii?: string;
  /** @internal Concrete families resolved from the document theme per slot. */
  resolvedFontFamilyHAnsi?: string;
  /** @internal Concrete families resolved from the document theme per slot. */
  resolvedFontFamilyEastAsia?: string;
  /** @internal Concrete families resolved from the document theme per slot. */
  resolvedFontFamilyCs?: string;
  fontHint?: string;
  /** OOXML w:lang slots and complex-script direction controls. */
  language?: string;
  languageEastAsia?: string;
  languageBidi?: string;
  rightToLeft?: boolean;
  complexScript?: boolean;
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

export interface ParagraphTabStop {
  alignment?: "left" | "center" | "right" | "decimal" | "bar";
  leader?: "none" | "dot" | "hyphen" | "underscore" | "middleDot";
  positionTwips?: number;
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
  /** Stable identity for measurement caches; survives edits via cloneParagraph. */
  blockId?: string;
  children: ParagraphChildNode[];
  style?: ParagraphStyle;
  paragraphMarkDeleted?: boolean;
  sourceXml?: string;
  /** @internal Validated provenance for a surgical plain-text sourceXml patch. */
  sourceTextPatch?: {
    runs: Array<{
      style?: TextStyle;
      link?: string;
      noteReference?: TextRunNode["noteReference"];
    }>;
  };
  /** @internal Immutable import-time run metadata used by surgical editors. */
  sourceRunProvenance?: {
    runs: Array<{
      style?: TextStyle;
      link?: string;
      noteReference?: TextRunNode["noteReference"];
    }>;
  };
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
  isHeader?: boolean;
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
  /** Stable identity for measurement caches; survives edits via cloneTable. */
  blockId?: string;
  rows: TableRowNode[];
  style?: TableStyle;
  sourceXml?: string;
  /** @internal Validated text-only descendant replacements for sourceXml. */
  sourceTextPatches?: Array<{
    sourceParagraphXml: string;
    paragraph: ParagraphNode;
  }>;
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
  /**
   * `w:lvlRestart`: one-based level whose use restarts this level; 0 means the
   * level never restarts. Absent means the OOXML default (restart when any
   * shallower level is used).
   */
  lvlRestart?: number;
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

export interface DocumentCommentDefinition {
  id: number;
  author?: string;
  initials?: string;
  date?: string;
  text: string;
  /** Comment id this comment replies to (from commentsExtended threading). */
  parentId?: number;
  /** True when the comment thread is marked done in commentsExtended. */
  resolved?: boolean;
  /** @internal Original `w:comment` block retained for lossless serialization. */
  sourceXml?: string;
  /** @internal Final comment paragraph id used by `commentsExtended.xml`. */
  extendedParagraphId?: string;
  /** @internal Resolution state read from `commentsExtended.xml`. */
  sourceResolved?: boolean;
  /** @internal True when `resolved` differs from the imported state. */
  resolutionDirty?: boolean;
  /** @internal True for a comment created in the editor rather than imported. */
  isNew?: boolean;
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
    comments?: DocumentCommentDefinition[];
  };
}
