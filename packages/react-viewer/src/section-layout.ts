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

export interface DocumentPageBorderEdge {
  cssBorder?: string;
  offsetPx?: number;
  shadow?: boolean;
}

export interface DocumentPageBorders {
  top?: DocumentPageBorderEdge;
  right?: DocumentPageBorderEdge;
  bottom?: DocumentPageBorderEdge;
  left?: DocumentPageBorderEdge;
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

function readStringAttribute(
  tagXml: string | undefined,
  attribute: string
): string | undefined {
  if (!tagXml) {
    return undefined;
  }

  return tagXml.match(new RegExp(`${attribute}="([^"]+)"`, "i"))?.[1];
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

  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return normalized;
  }

  return undefined;
}

function borderTypeToCssStyle(rawType?: string): string | undefined {
  const value = rawType?.trim().toLowerCase();
  if (!value || value === "none" || value === "nil") {
    return undefined;
  }

  if (value === "double") {
    return "double";
  }

  if (
    value === "dashed" ||
    value === "dashsmallgap" ||
    value === "dotdash" ||
    value === "dotdotdash"
  ) {
    return "dashed";
  }

  if (value === "dotted") {
    return "dotted";
  }

  return "solid";
}

function pointsToPixels(points?: number): number | undefined {
  if (!Number.isFinite(points)) {
    return undefined;
  }

  return Math.max(0, Math.round((points as number) * (96 / 72)));
}

function parseSectionPageBorderEdge(
  sectionPropertiesXml: string | undefined,
  edge: "top" | "right" | "bottom" | "left"
): DocumentPageBorderEdge | undefined {
  if (!sectionPropertiesXml) {
    return undefined;
  }

  const bordersXml = sectionPropertiesXml.match(
    /<w:pgBorders\b[\s\S]*?<\/w:pgBorders>/i
  )?.[0];
  if (!bordersXml) {
    return undefined;
  }

  const edgeTag = bordersXml.match(new RegExp(`<w:${edge}\\b[^>]*/?>`, "i"))?.[0];
  if (!edgeTag) {
    return undefined;
  }

  const cssStyle = borderTypeToCssStyle(readStringAttribute(edgeTag, "w:val"));
  if (!cssStyle) {
    return undefined;
  }

  const sizeEighthPt = Number(readStringAttribute(edgeTag, "w:sz"));
  const widthPx =
    Number.isFinite(sizeEighthPt) && sizeEighthPt > 0
      ? Math.max(0.5, Number((sizeEighthPt / 6).toFixed(2)))
      : 1;
  const color =
    normalizeHexColor(readStringAttribute(edgeTag, "w:color")) ?? "#000000";
  const offsetPoints = Number(readStringAttribute(edgeTag, "w:space"));

  return {
    cssBorder: `${widthPx}px ${cssStyle} ${color}`,
    offsetPx: pointsToPixels(offsetPoints) ?? 0,
    shadow:
      readStringAttribute(edgeTag, "w:shadow")?.trim().toLowerCase() === "1" ||
      readStringAttribute(edgeTag, "w:shadow")?.trim().toLowerCase() === "true",
  };
}

export function parseSectionPageBorders(
  sectionPropertiesXml?: string
): DocumentPageBorders | undefined {
  if (!sectionPropertiesXml || !/<w:pgBorders\b/i.test(sectionPropertiesXml)) {
    return undefined;
  }

  const borders: DocumentPageBorders = {
    top: parseSectionPageBorderEdge(sectionPropertiesXml, "top"),
    right: parseSectionPageBorderEdge(sectionPropertiesXml, "right"),
    bottom: parseSectionPageBorderEdge(sectionPropertiesXml, "bottom"),
    left: parseSectionPageBorderEdge(sectionPropertiesXml, "left"),
  };

  return borders.top || borders.right || borders.bottom || borders.left
    ? borders
    : undefined;
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
