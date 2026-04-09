import type {
  DocModel,
  FooterSection,
  HeaderSection,
  ParagraphNode,
  TableCellContentNode,
  TableNode
} from "@extend-ai/react-docx-doc-model";

const TWIPS_PER_PIXEL = 15;
const PAGE_BREAK_XML_PATTERN = /<w:br\b[^>]*w:type="page"[^>]*\/?>/i;
const LAST_RENDERED_PAGE_BREAK_XML_PATTERN = /<w:lastRenderedPageBreak\b[^>]*\/?>/i;
const PAGE_BREAK_BEFORE_XML_PATTERN = /<w:pageBreakBefore\b[^>]*\/?>/i;
const SECTION_PROPERTIES_XML_PATTERN = /<w:sectPr\b[\s\S]*?<\/w:sectPr>/i;
const SECTION_TYPE_XML_PATTERN = /<w:type\b[^>]*w:val="([^"]+)"/i;
const paragraphBreakFlagsBySourceXml = new Map<
  string,
  {
    explicitPageBreak: boolean;
    lastRenderedPageBreak: boolean;
    pageBreakBefore: boolean;
    sectionBreakStartsNewPage: boolean;
  }
>();
const tableExplicitPageBreakInfoBySourceXml = new Map<string, TableExplicitPageBreakInfo>();

export interface ResolvedModelSection {
  startNodeIndex: number;
  sectionPropertiesXml?: string;
  headerSections: HeaderSection[];
  footerSections: FooterSection[];
}

function normalizeSectionReferenceType(referenceType?: string): string {
  const normalized = referenceType?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : "default";
}

function inheritSectionReferences<T extends HeaderSection | FooterSection>(
  sections: ResolvedModelSection[],
  sectionKey: "headerSections" | "footerSections"
): ResolvedModelSection[] {
  const inheritedByType = new Map<string, T>();

  return sections.map((section) => {
    const explicitSections = section[sectionKey] as T[];
    if (explicitSections.length > 0) {
      explicitSections.forEach((entry) => {
        inheritedByType.set(normalizeSectionReferenceType(entry.referenceType), entry);
      });
    }

    return {
      ...section,
      [sectionKey]: [...inheritedByType.values()]
    };
  });
}

function resolveInheritedSectionHeaderFooterReferences(
  sections: ResolvedModelSection[]
): ResolvedModelSection[] {
  if (sections.length === 0) {
    return sections;
  }

  return inheritSectionReferences(
    inheritSectionReferences(sections, "headerSections"),
    "footerSections"
  );
}

export interface PaginationSectionMetrics {
  startNodeIndex: number;
  pageContentWidthPx: number;
  pageContentHeightPx: number;
  docGridLinePitchPx?: number;
}

export interface TableExplicitPageBreakInfo {
  startRowIndexes: number[];
  breakAfterTable: boolean;
}

export interface DocumentPageRange {
  startNodeIndex: number;
  endNodeIndex: number;
}

function twipsToPixels(twips?: number): number | undefined {
  if (!Number.isFinite(twips)) {
    return undefined;
  }

  return Math.max(0, Math.round((twips as number) / TWIPS_PER_PIXEL));
}

function isOnOffTagEnabled(tagXml: string | undefined): boolean {
  if (!tagXml) {
    return false;
  }

  const valueMatch = tagXml.match(/\bw:val="([^"]+)"/i)?.[1]?.trim().toLowerCase();
  if (!valueMatch) {
    return true;
  }

  return !["0", "false", "off", "no"].includes(valueMatch);
}

function paragraphHasImage(paragraph: ParagraphNode): boolean {
  return paragraph.children.some((child) => child.type === "image");
}

function paragraphHasFormField(paragraph: ParagraphNode): boolean {
  return paragraph.children.some((child) => child.type === "form-field");
}

function paragraphHasVisibleText(paragraph: ParagraphNode): boolean {
  return paragraph.children.some(
    (child) =>
      (child.type === "text" && child.text.trim().length > 0) ||
      (child.type === "form-field" && (child.value ?? "").trim().length > 0)
  );
}

function paragraphIsOnlyExplicitPageBreak(paragraph: ParagraphNode): boolean {
  if (!paragraphHasExplicitPageBreak(paragraph)) {
    return false;
  }

  return (
    !paragraphHasVisibleText(paragraph) &&
    !paragraphHasImage(paragraph) &&
    !paragraphHasFormField(paragraph)
  );
}

function tableCellDirectParagraphs(nodeContent: TableCellContentNode[]): ParagraphNode[] {
  return nodeContent.filter((entry): entry is ParagraphNode => entry.type === "paragraph");
}

function tableRowHasSubstantiveContentOutsideBreakOnlyParagraphs(
  row: TableNode["rows"][number]
): boolean {
  return row.cells.some((cell) =>
    tableCellDirectParagraphs(cell.nodes).some((paragraph) => {
      if (paragraphIsOnlyExplicitPageBreak(paragraph)) {
        return false;
      }

      return (
        paragraphHasVisibleText(paragraph) ||
        paragraphHasImage(paragraph) ||
        paragraphHasFormField(paragraph) ||
        paragraphHasExplicitPageBreak(paragraph)
      );
    })
  );
}

function tableRowSubstantiveCellIndexes(row: TableNode["rows"][number]): number[] {
  const indexes: number[] = [];
  row.cells.forEach((cell, cellIndex) => {
    const substantive = tableCellDirectParagraphs(cell.nodes).some((paragraph) => {
      if (paragraphIsOnlyExplicitPageBreak(paragraph)) {
        return false;
      }

      return (
        paragraphHasVisibleText(paragraph) ||
        paragraphHasImage(paragraph) ||
        paragraphHasFormField(paragraph) ||
        paragraphHasExplicitPageBreak(paragraph)
      );
    });
    if (substantive) {
      indexes.push(cellIndex);
    }
  });
  return indexes;
}

function tableRowUsesTrailingSignatureCellBreakPattern(
  table: TableNode,
  row: TableNode["rows"][number]
): boolean {
  if (table.rows.length !== 1 || row.cells.length < 4) {
    return false;
  }

  const substantiveIndexes = tableRowSubstantiveCellIndexes(row);
  return substantiveIndexes.length === 1 && substantiveIndexes[0] >= row.cells.length - 1;
}

export function sectionBreakPropertiesStartNewPage(sectionPropertiesXml: string): boolean {
  const sectionType =
    sectionPropertiesXml.match(SECTION_TYPE_XML_PATTERN)?.[1]?.trim().toLowerCase() ?? "nextpage";

  if (sectionType === "continuous") {
    return false;
  }

  if (sectionType === "nextcolumn") {
    const columnsTag = sectionPropertiesXml.match(/<w:cols\b[^>]*\/?>/i)?.[0];
    const columnsCount = Number.parseInt(columnsTag?.match(/\bw:num="(\d+)"/i)?.[1] ?? "", 10);
    return !Number.isFinite(columnsCount) || columnsCount <= 1;
  }

  return true;
}

export function paragraphHasExplicitPageBreak(paragraph: ParagraphNode): boolean {
  const xml = paragraph.sourceXml ?? "";
  if (!xml) {
    return false;
  }

  const cached = paragraphBreakFlagsBySourceXml.get(xml);
  if (cached) {
    return cached.explicitPageBreak;
  }

  const flags = {
    explicitPageBreak: PAGE_BREAK_XML_PATTERN.test(xml),
    lastRenderedPageBreak: LAST_RENDERED_PAGE_BREAK_XML_PATTERN.test(xml),
    pageBreakBefore: isOnOffTagEnabled(xml.match(PAGE_BREAK_BEFORE_XML_PATTERN)?.[0]),
    sectionBreakStartsNewPage: (() => {
      const sectionProperties = xml.match(SECTION_PROPERTIES_XML_PATTERN)?.[0];
      if (!sectionProperties) {
        return false;
      }

      return sectionBreakPropertiesStartNewPage(sectionProperties);
    })()
  };
  paragraphBreakFlagsBySourceXml.set(xml, flags);
  return flags.explicitPageBreak;
}

export function paragraphHasPageBreakBefore(paragraph: ParagraphNode): boolean {
  if (paragraph.style?.pageBreakBefore === true) {
    return true;
  }

  const xml = paragraph.sourceXml ?? "";
  if (!xml) {
    return false;
  }

  const cached = paragraphBreakFlagsBySourceXml.get(xml);
  if (cached) {
    return cached.pageBreakBefore;
  }

  paragraphHasExplicitPageBreak(paragraph);
  return paragraphBreakFlagsBySourceXml.get(xml)?.pageBreakBefore ?? false;
}

export function sectionBreakAfterParagraphStartsNewPage(paragraph: ParagraphNode): boolean {
  const xml = paragraph.sourceXml ?? "";
  if (!xml) {
    return false;
  }

  const cached = paragraphBreakFlagsBySourceXml.get(xml);
  if (cached) {
    return cached.sectionBreakStartsNewPage;
  }

  paragraphHasExplicitPageBreak(paragraph);
  return paragraphBreakFlagsBySourceXml.get(xml)?.sectionBreakStartsNewPage ?? false;
}

export function paragraphHasLastRenderedPageBreak(paragraph: ParagraphNode): boolean {
  const xml = paragraph.sourceXml ?? "";
  if (!xml) {
    return false;
  }

  const cached = paragraphBreakFlagsBySourceXml.get(xml);
  if (cached) {
    return cached.lastRenderedPageBreak;
  }

  paragraphHasExplicitPageBreak(paragraph);
  return paragraphBreakFlagsBySourceXml.get(xml)?.lastRenderedPageBreak ?? false;
}

export function paragraphStartsWithLastRenderedPageBreak(paragraph: ParagraphNode): boolean {
  const xml = paragraph.sourceXml ?? "";
  if (!xml || !paragraphHasLastRenderedPageBreak(paragraph)) {
    return false;
  }

  const breakMatch = xml.match(LAST_RENDERED_PAGE_BREAK_XML_PATTERN);
  if (!breakMatch || breakMatch.index === undefined) {
    return false;
  }

  const leadingXml = xml
    .slice(0, breakMatch.index)
    .replace(/^<w:p\b[^>]*>/i, "")
    .replace(/<w:pPr\b(?:[^/>]*\/>|[\s\S]*?<\/w:pPr>)/i, "")
    .replace(/<w:rPr\b[\s\S]*?<\/w:rPr>/gi, "")
    .replace(/<\/?w:r\b[^>]*>/gi, "")
    .replace(/<w:(?:proofErr|bookmarkStart|bookmarkEnd|permStart|permEnd)\b[^>]*\/?>/gi, "")
    .replace(/<\/?w:(?:ins|smartTag)\b[^>]*>/gi, "")
    .replace(/\s+/g, "");

  return leadingXml.length === 0;
}

export function paragraphBeforeSpacingPx(paragraph: ParagraphNode): number {
  return twipsToPixels(paragraph.style?.spacing?.beforeTwips) ?? 0;
}

export function paragraphAfterSpacingPx(paragraph: ParagraphNode): number {
  return twipsToPixels(paragraph.style?.spacing?.afterTwips) ?? 0;
}

export function resolveParagraphBeforeSpacingPx(
  model: DocModel,
  nodeIndex: number,
  paragraph: ParagraphNode,
  pageConsumedHeightPx: number,
  suppressSpacingBeforeAfterPageBreak: boolean
): number {
  const beforeSpacingPx = paragraphBeforeSpacingPx(paragraph);
  if (!suppressSpacingBeforeAfterPageBreak) {
    return beforeSpacingPx;
  }

  if (pageConsumedHeightPx <= 0 && nodeIndex > 0) {
    const previousNode = model.nodes[nodeIndex - 1];
    if (previousNode?.type === "paragraph") {
      if (paragraphIsOnlyExplicitPageBreak(previousNode)) {
        return 0;
      }

      if (paragraphHasPageBreakBefore(previousNode)) {
        return 0;
      }
    }
  }

  return beforeSpacingPx;
}

export function resolveDocumentSectionsFromMetadata(
  metadata: DocModel["metadata"]
): ResolvedModelSection[] {
  const normalizedSections = (metadata.sections ?? [])
    .map((section): ResolvedModelSection => ({
      startNodeIndex:
        Number.isFinite(section.startNodeIndex) && (section.startNodeIndex as number) >= 0
          ? Math.round(section.startNodeIndex as number)
          : 0,
      sectionPropertiesXml: section.sectionPropertiesXml,
      headerSections: section.headerSections ?? [],
      footerSections: section.footerSections ?? []
    }))
    .sort((left, right) => left.startNodeIndex - right.startNodeIndex);

  if (normalizedSections.length > 0) {
    if (normalizedSections[0].startNodeIndex > 0) {
      normalizedSections.unshift({
        startNodeIndex: 0,
        sectionPropertiesXml: normalizedSections[0].sectionPropertiesXml,
        headerSections: normalizedSections[0].headerSections,
        footerSections: normalizedSections[0].footerSections
      });
    }
    return resolveInheritedSectionHeaderFooterReferences(normalizedSections);
  }

  return [
    {
      startNodeIndex: 0,
      sectionPropertiesXml: metadata.sectionPropertiesXml,
      headerSections: metadata.headerSections ?? [],
      footerSections: metadata.footerSections ?? []
    }
  ];
}

export function sectionTitlePageEnabled(sectionPropertiesXml?: string): boolean {
  if (!sectionPropertiesXml) {
    return false;
  }

  const titlePageTag = sectionPropertiesXml.match(/<w:titlePg\b[^>]*\/?>/i)?.[0];
  return isOnOffTagEnabled(titlePageTag);
}

export function selectSectionVariantForPage<T extends HeaderSection | FooterSection>(
  sections: T[],
  sectionPropertiesXml: string | undefined,
  pageIndex: number,
  options?: {
    evenAndOddHeaders?: boolean;
  }
): T | undefined {
  if (sections.length === 0) {
    return undefined;
  }

  const titlePage = sectionTitlePageEnabled(sectionPropertiesXml);
  const normalizeType = (value: string | undefined): string => value?.trim().toLowerCase() ?? "";
  const first = sections.find((section) => normalizeType(section.referenceType) === "first");
  const defaultSection = sections.find((section) => {
    const referenceType = normalizeType(section.referenceType);
    return referenceType === "default" || referenceType === "";
  });
  const even = sections.find((section) => normalizeType(section.referenceType) === "even");
  const evenAndOddHeadersEnabled = options?.evenAndOddHeaders ?? true;

  const safePageIndex = Number.isFinite(pageIndex) ? Math.max(0, Math.round(pageIndex)) : 0;
  const oddPageNumber = safePageIndex % 2 === 0;

  if (safePageIndex === 0 && titlePage) {
    return first;
  }

  if (evenAndOddHeadersEnabled && !oddPageNumber && even) {
    return even;
  }

  if (defaultSection) {
    return defaultSection;
  }

  return first ?? even ?? sections[0];
}

export function resolveSectionIndexForNodeIndex(
  sections: Pick<ResolvedModelSection, "startNodeIndex">[],
  nodeIndex: number,
  previousSectionIndex: number
): number {
  if (sections.length === 0) {
    return 0;
  }

  const safePrevious = Math.max(0, Math.min(previousSectionIndex, sections.length - 1));
  let sectionIndex = safePrevious;

  if (nodeIndex < sections[sectionIndex].startNodeIndex) {
    sectionIndex = 0;
  }

  while (
    sectionIndex + 1 < sections.length &&
    sections[sectionIndex + 1].startNodeIndex <= nodeIndex
  ) {
    sectionIndex += 1;
  }

  return sectionIndex;
}

export function resolveSectionPropertiesXmlForNodeIndex(
  sections: ResolvedModelSection[],
  nodeIndex: number,
  fallbackSectionPropertiesXml?: string
): string | undefined {
  if (sections.length === 0) {
    return fallbackSectionPropertiesXml;
  }

  const sectionIndex = resolveSectionIndexForNodeIndex(sections, nodeIndex, 0);
  return sections[sectionIndex]?.sectionPropertiesXml ?? fallbackSectionPropertiesXml;
}

export function resolvePaginationSectionMetricsIndexForNodeIndex(
  metricsBySection: PaginationSectionMetrics[],
  nodeIndex: number,
  previousSectionIndex: number
): number {
  if (metricsBySection.length === 0) {
    return 0;
  }

  const safePrevious = Math.max(0, Math.min(previousSectionIndex, metricsBySection.length - 1));
  let sectionIndex = safePrevious;
  if (nodeIndex < metricsBySection[sectionIndex].startNodeIndex) {
    sectionIndex = 0;
  }

  while (
    sectionIndex + 1 < metricsBySection.length &&
    metricsBySection[sectionIndex + 1].startNodeIndex <= nodeIndex
  ) {
    sectionIndex += 1;
  }

  return sectionIndex;
}

export function scalePaginationSectionMetricsHeights(
  metricsBySection: PaginationSectionMetrics[],
  heightScale: number
): PaginationSectionMetrics[] {
  if (!Number.isFinite(heightScale) || Math.abs(heightScale - 1) < 0.001) {
    return metricsBySection;
  }

  return metricsBySection.map((metrics) => ({
    ...metrics,
    pageContentHeightPx: Math.max(120, Math.round(metrics.pageContentHeightPx * heightScale))
  }));
}

export function collectTableExplicitPageBreakInfo(table: TableNode): TableExplicitPageBreakInfo {
  const sourceXml = table.sourceXml ?? "";
  if (sourceXml) {
    const cached = tableExplicitPageBreakInfoBySourceXml.get(sourceXml);
    if (cached) {
      return cached;
    }
  }

  const startRowIndexes = new Set<number>();
  let breakAfterTable = false;

  table.rows.forEach((row, rowIndex) => {
    let rowBreakTarget: number | undefined;

    row.cells.forEach((cell) => {
      tableCellDirectParagraphs(cell.nodes).forEach((paragraph) => {
        if (!paragraphHasExplicitPageBreak(paragraph)) {
          return;
        }

        if (
          paragraphIsOnlyExplicitPageBreak(paragraph) &&
          rowIndex === 0 &&
          tableRowHasSubstantiveContentOutsideBreakOnlyParagraphs(row) &&
          !tableRowUsesTrailingSignatureCellBreakPattern(table, row)
        ) {
          return;
        }

        const breakTarget = paragraphIsOnlyExplicitPageBreak(paragraph) ? rowIndex : rowIndex + 1;
        if (rowBreakTarget === undefined || breakTarget < rowBreakTarget) {
          rowBreakTarget = breakTarget;
        }
      });
    });

    if (rowBreakTarget === undefined) {
      return;
    }

    if (rowBreakTarget >= table.rows.length) {
      breakAfterTable = true;
      return;
    }

    startRowIndexes.add(Math.max(0, rowBreakTarget));
  });

  const info: TableExplicitPageBreakInfo = {
    startRowIndexes: [...startRowIndexes].sort((left, right) => left - right),
    breakAfterTable
  };

  if (sourceXml) {
    tableExplicitPageBreakInfoBySourceXml.set(sourceXml, info);
  }

  return info;
}

export function collectTopLevelExplicitPageBreakStartNodeIndexes(
  nodes: DocModel["nodes"]
): Set<number> {
  const breaks = new Set<number>();

  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const node = nodes[nodeIndex];
    const hasNextNode = nodeIndex + 1 < nodes.length;

    if (node.type === "paragraph") {
      if (paragraphHasPageBreakBefore(node)) {
        breaks.add(nodeIndex);
      }

      if (hasNextNode && paragraphHasExplicitPageBreak(node)) {
        breaks.add(nodeIndex + 1);
      }
      continue;
    }

    const tableBreakInfo = collectTableExplicitPageBreakInfo(node);
    if (tableBreakInfo.startRowIndexes.includes(0) && nodeIndex > 0) {
      breaks.add(nodeIndex);
    }

    if (hasNextNode && tableBreakInfo.breakAfterTable) {
      breaks.add(nodeIndex + 1);
    }
  }

  for (const breakIndex of [...breaks]) {
    if (breakIndex <= 0 || breakIndex >= nodes.length) {
      breaks.delete(breakIndex);
    }
  }

  return breaks;
}

export function collectDocxHardPageBreakStartNodeIndexes(model: DocModel): Set<number> {
  const breaks = collectTopLevelExplicitPageBreakStartNodeIndexes(model.nodes);

  const sections = resolveDocumentSectionsFromMetadata(model.metadata);
  for (let sectionIndex = 1; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex];
    const startNodeIndex = Math.max(0, Math.round(section.startNodeIndex));
    if (startNodeIndex <= 0 || startNodeIndex >= model.nodes.length) {
      continue;
    }

    const sectionPropertiesXml = section.sectionPropertiesXml;
    if (!sectionPropertiesXml) {
      continue;
    }

    if (sectionBreakPropertiesStartNewPage(sectionPropertiesXml)) {
      breaks.add(startNodeIndex);
    }
  }

  for (const breakIndex of [...breaks]) {
    if (breakIndex <= 0 || breakIndex >= model.nodes.length) {
      breaks.delete(breakIndex);
    }
  }

  return breaks;
}

export function collectDocxLastRenderedPageBreakStartNodeIndexes(model: DocModel): number[] {
  const breaks: number[] = [];

  model.nodes.forEach((node, nodeIndex) => {
    if (node.type === "paragraph" && paragraphHasLastRenderedPageBreak(node)) {
      breaks.push(nodeIndex);
    }
  });

  return breaks;
}

export function buildDocumentPageRanges(
  nodeCount: number,
  pageBreakStartNodeIndexes: Iterable<number>
): DocumentPageRange[] {
  if (nodeCount <= 0) {
    return [];
  }

  const sortedBreakStartIndexes = [...pageBreakStartNodeIndexes]
    .filter((index) => index > 0 && index < nodeCount)
    .sort((left, right) => left - right);

  const ranges: DocumentPageRange[] = [];
  let startNodeIndex = 0;

  for (const breakStartIndex of sortedBreakStartIndexes) {
    if (breakStartIndex <= startNodeIndex) {
      continue;
    }

    ranges.push({
      startNodeIndex,
      endNodeIndex: breakStartIndex
    });
    startNodeIndex = breakStartIndex;
  }

  ranges.push({
    startNodeIndex,
    endNodeIndex: nodeCount
  });

  return ranges;
}
