import type {
  TableAlignment,
  TablePreferredWidth,
  TableStyle,
} from "@extend-ai/react-docx-doc-model";
import { resolveTableGridSkipCount } from "@extend-ai/react-docx-doc-model";
export { resolveTableGridSkipCount } from "@extend-ai/react-docx-doc-model";

export type TableWidthDefinition = Pick<
  TableStyle,
  "preferredWidth" | "widthTwips" | "sourceWidth"
>;

function samePreferredWidth(
  left: TablePreferredWidth | undefined,
  right: TablePreferredWidth | undefined
): boolean {
  return left?.type === right?.type &&
    (left?.type !== "dxa" && left?.type !== "pct" ||
      (right?.type === left.type && left.value === right.value));
}

function legacyWidth(widthTwips?: number): TablePreferredWidth | undefined {
  return Number.isFinite(widthTwips) && (widthTwips as number) >= 0
    ? { type: "dxa", value: widthTwips as number }
    : undefined;
}

export function resolveEffectiveTablePreferredWidth(
  style: TableWidthDefinition | undefined
): TablePreferredWidth | undefined {
  if (!style) return undefined;
  if (style.sourceWidth) {
    if (!samePreferredWidth(style.preferredWidth, style.sourceWidth.preferredWidth)) {
      return style.preferredWidth ?? style.sourceWidth.inheritedPreferredWidth;
    }
    if (style.widthTwips !== style.sourceWidth.widthTwips) {
      return legacyWidth(style.widthTwips) ?? style.sourceWidth.inheritedPreferredWidth;
    }
  }
  return style.preferredWidth ?? legacyWidth(style.widthTwips);
}

/** The reference is page text width for tables and resolved table width for cells. */
export function resolveTablePreferredWidthTwips(
  style: TableWidthDefinition | undefined,
  percentageReferenceWidthTwips?: number
): number | undefined {
  const width = resolveEffectiveTablePreferredWidth(style);
  if (!width || width.type === "auto" || width.type === "nil") return undefined;
  if (!Number.isFinite(width.value) || width.value < 0) return undefined;
  if (width.type === "dxa") return width.value;
  return Number.isFinite(percentageReferenceWidthTwips) &&
    (percentageReferenceWidthTwips as number) >= 0
    ? (percentageReferenceWidthTwips as number) * width.value / 100
    : undefined;
}

/** Convert table source widths to CSS pixels without a device-pixel rounding step. */
export function tableWidthTwipsToPixels(widthTwips?: number): number | undefined {
  return Number.isFinite(widthTwips) && (widthTwips as number) >= 0
    ? (widthTwips as number) / 15
    : undefined;
}

/** Reduce fixed-layout grid widths proportionally when they exceed the table width. */
export function reduceFixedTableColumnWidths(
  columnWidths: readonly number[],
  tableWidth: number
): number[] {
  const widths = columnWidths.map((width) =>
    Number.isFinite(width) && width >= 0 ? width : 0
  );
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (!Number.isFinite(tableWidth) || tableWidth < 0 || total <= tableWidth || total <= 0) {
    return widths;
  }
  const scale = tableWidth / total;
  return widths.map((width) => width * scale);
}

export interface FixedTableCellWidth {
  gridSpan?: number;
  preferredWidth?: number;
}

export interface FixedTableRowWidths {
  gridBefore?: number;
  gridAfter?: number;
  beforeWidth?: number;
  afterWidth?: number;
  cells: readonly FixedTableCellWidth[];
}

/** Resolve ordered fixed-layout grid requests in a single measurement unit. */
export function resolveFixedTableGridWidths(params: {
  initialGridWidths?: readonly number[];
  rows: readonly FixedTableRowWidths[];
  preferredTableWidth?: number;
}): number[] {
  let widths = (params.initialGridWidths ?? []).map((width) =>
    Number.isFinite(width) && width >= 0 ? width : 0
  );
  const target = Number.isFinite(params.preferredTableWidth) &&
    (params.preferredTableWidth as number) > 0
    ? params.preferredTableWidth : undefined;
  const gridCount = (value: number | undefined, fallback: number): number =>
    Number.isFinite(value) && (value as number) >= 0
      ? Math.floor(value as number) : fallback;
  const parentGridCount = params.initialGridWidths?.length ?? Math.max(0,
    ...params.rows.map((row) => row.cells.reduce((count, cell) =>
      count + Math.max(1, gridCount(cell.gridSpan, 1)), 0)));
  const ensureColumns = (count: number): void => {
    while (widths.length < count) widths.push(0);
  };
  const constrain = (): void => {
    if (target !== undefined) widths = reduceFixedTableColumnWidths(widths, target);
  };
  const requestSpan = (
    start: number,
    span: number,
    request: number | undefined,
    firstRow: boolean
  ): void => {
    if (span <= 0) return;
    ensureColumns(start + span);
    if (!Number.isFinite(request) || (request as number) < 0) return;
    const requestedWidth = request as number;
    const currentWidth = widths.slice(start, start + span)
      .reduce((sum, width) => sum + width, 0);
    if (firstRow && currentWidth === 0) {
      for (let column = start; column < start + span; column += 1) {
        widths[column] = requestedWidth / span;
      }
    } else if (firstRow && requestedWidth < currentWidth) {
      const scale = requestedWidth / currentWidth;
      for (let column = start; column < start + span; column += 1) {
        widths[column] *= scale;
      }
    } else if (requestedWidth > currentWidth) {
      widths[start + span - 1] += requestedWidth - currentWidth;
    }
    if (!firstRow || (target !== undefined &&
      widths.slice(0, start + span).reduce((sum, width) => sum + width, 0) > target)) {
      constrain();
    }
  };

  params.rows.forEach((row, rowIndex) => {
    const before = resolveTableGridSkipCount(row.gridBefore, parentGridCount);
    const after = resolveTableGridSkipCount(row.gridAfter, parentGridCount);
    let column = before;
    requestSpan(0, before, row.beforeWidth, rowIndex === 0);
    for (const cell of row.cells) {
      const span = Math.max(1, gridCount(cell.gridSpan, 1));
      requestSpan(column, span, cell.preferredWidth, rowIndex === 0);
      column += span;
    }
    requestSpan(column, after, row.afterWidth, rowIndex === 0);
    ensureColumns(column + after);
    constrain();
  });
  return widths;
}

export function resolveEffectiveTableAlignment(
  style: Pick<TableStyle, "alignment" | "sourceAlignment" | "sourceInheritedAlignment"> | undefined
): TableAlignment | undefined {
  return style?.alignment ?? style?.sourceInheritedAlignment;
}

export function resolveEffectiveTableBidiVisual(
  style: Pick<TableStyle, "bidiVisual" | "sourceBidiVisual" | "sourceInheritedBidiVisual"> | undefined
): boolean | undefined {
  return style?.bidiVisual ?? style?.sourceInheritedBidiVisual;
}

export function resolveTableLeadingIndent(
  alignment: TableAlignment | undefined,
  indent = 0
): number {
  return (alignment ?? "left") === "left" && Number.isFinite(indent) ? indent : 0;
}

export function resolveTableAlignmentOffset(params: {
  alignment?: TableAlignment;
  bidiVisual?: boolean;
  availableWidth: number;
  tableWidth: number;
  indent?: number;
}): number {
  const availableWidth = Number.isFinite(params.availableWidth)
    ? Math.max(0, params.availableWidth) : 0;
  const tableWidth = Number.isFinite(params.tableWidth)
    ? Math.max(0, params.tableWidth) : 0;
  const remainingWidth = availableWidth - tableWidth;
  const alignment = params.alignment ?? "left";
  if (alignment === "center") return remainingWidth / 2;
  const indent = resolveTableLeadingIndent(alignment, params.indent);
  if (alignment === "right") return params.bidiVisual ? 0 : remainingWidth;
  return params.bidiVisual ? remainingWidth - indent : indent;
}
