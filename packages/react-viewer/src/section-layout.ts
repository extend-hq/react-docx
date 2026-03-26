import type { DocModel } from "@react-docx/doc-model";

export interface DocumentLayoutMetrics {
  pageWidthPx: number;
  pageHeightPx: number;
  marginsPx: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  headerDistancePx: number;
  footerDistancePx: number;
  docGridLinePitchPx?: number;
}

export const DEFAULT_DOC_PAGE_WIDTH = 900;
export const DEFAULT_DOC_PAGE_HEIGHT = 1200;
export const DEFAULT_DOC_PAGE_MARGIN = 56;
export const TWIPS_PER_PIXEL = 15;

export const DEFAULT_DOCUMENT_LAYOUT: DocumentLayoutMetrics = {
  pageWidthPx: DEFAULT_DOC_PAGE_WIDTH,
  pageHeightPx: DEFAULT_DOC_PAGE_HEIGHT,
  marginsPx: {
    top: DEFAULT_DOC_PAGE_MARGIN,
    right: DEFAULT_DOC_PAGE_MARGIN,
    bottom: DEFAULT_DOC_PAGE_MARGIN,
    left: DEFAULT_DOC_PAGE_MARGIN
  },
  headerDistancePx: DEFAULT_DOC_PAGE_MARGIN,
  footerDistancePx: DEFAULT_DOC_PAGE_MARGIN,
  docGridLinePitchPx: undefined
};

export function twipsToPixels(twips?: number): number | undefined {
  if (!Number.isFinite(twips)) {
    return undefined;
  }

  return Math.max(0, Math.round((twips as number) / TWIPS_PER_PIXEL));
}

function readTwipsAttribute(tagXml: string | undefined, attribute: string): number | undefined {
  if (!tagXml) {
    return undefined;
  }

  const match = tagXml.match(new RegExp(`${attribute}="(\\d+)"`, "i"));
  if (!match?.[1]) {
    return undefined;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseSectionLayout(sectionPropertiesXml?: string): DocumentLayoutMetrics {
  if (!sectionPropertiesXml) {
    return DEFAULT_DOCUMENT_LAYOUT;
  }

  const pageSizeTag = sectionPropertiesXml.match(/<w:pgSz\b[^>]*>/i)?.[0];
  const pageMarginTag = sectionPropertiesXml.match(/<w:pgMar\b[^>]*>/i)?.[0];
  const docGridTag = sectionPropertiesXml.match(/<w:docGrid\b[^>]*\/?>/i)?.[0];

  const pageWidthPx =
    twipsToPixels(readTwipsAttribute(pageSizeTag, "w:w")) ?? DEFAULT_DOCUMENT_LAYOUT.pageWidthPx;
  const pageHeightPx =
    twipsToPixels(readTwipsAttribute(pageSizeTag, "w:h")) ?? DEFAULT_DOCUMENT_LAYOUT.pageHeightPx;
  const topMarginPx =
    twipsToPixels(readTwipsAttribute(pageMarginTag, "w:top")) ?? DEFAULT_DOCUMENT_LAYOUT.marginsPx.top;
  const rightMarginPx =
    twipsToPixels(readTwipsAttribute(pageMarginTag, "w:right")) ?? DEFAULT_DOCUMENT_LAYOUT.marginsPx.right;
  const bottomMarginPx =
    twipsToPixels(readTwipsAttribute(pageMarginTag, "w:bottom")) ?? DEFAULT_DOCUMENT_LAYOUT.marginsPx.bottom;
  const leftMarginPx =
    twipsToPixels(readTwipsAttribute(pageMarginTag, "w:left")) ?? DEFAULT_DOCUMENT_LAYOUT.marginsPx.left;
  const headerDistancePx =
    twipsToPixels(readTwipsAttribute(pageMarginTag, "w:header")) ?? DEFAULT_DOCUMENT_LAYOUT.headerDistancePx;
  const footerDistancePx =
    twipsToPixels(readTwipsAttribute(pageMarginTag, "w:footer")) ?? DEFAULT_DOCUMENT_LAYOUT.footerDistancePx;
  const docGridLinePitchPx =
    twipsToPixels(readTwipsAttribute(docGridTag, "w:linePitch")) ?? DEFAULT_DOCUMENT_LAYOUT.docGridLinePitchPx;

  return {
    pageWidthPx,
    pageHeightPx,
    marginsPx: {
      top: topMarginPx,
      right: rightMarginPx,
      bottom: bottomMarginPx,
      left: leftMarginPx
    },
    headerDistancePx,
    footerDistancePx,
    docGridLinePitchPx
  };
}

export function resolveDocumentSectionPropertiesXml(model: DocModel): string | undefined {
  return model.metadata.sections?.[0]?.sectionPropertiesXml ?? model.metadata.sectionPropertiesXml;
}

export function resolveDocumentLayout(model: DocModel): DocumentLayoutMetrics {
  return parseSectionLayout(resolveDocumentSectionPropertiesXml(model));
}
