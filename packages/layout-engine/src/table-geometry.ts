export type TableRowHeightRule = "auto" | "atLeast" | "exact";

export interface TableRowHeightConstraint {
  /** Intrinsic outer height already includes cell padding. */
  intrinsicHeight: number;
  declaredHeight?: number;
  heightRule?: TableRowHeightRule;
  maximumBottomPadding?: number;
}

export interface ResolvedTableRowHeight {
  height: number;
  exact: boolean;
  contentHeightLimit?: number;
}

function nonnegativeHeight(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value as number) : 0;
}

export function normalizeTableRowHeightTwips(height?: number): number | undefined {
  if (!Number.isFinite(height) || (height as number) <= 0) return undefined;
  return Math.min(31680, Math.round(height as number));
}

/** Measurements must use the same unit; border geometry is resolved separately. */
export function resolveTableRowHeight(
  constraint: TableRowHeightConstraint
): ResolvedTableRowHeight {
  const intrinsicHeight = nonnegativeHeight(constraint.intrinsicHeight);
  const declaredHeight = nonnegativeHeight(constraint.declaredHeight);
  if (constraint.heightRule === "auto" || declaredHeight === 0) {
    return { height: intrinsicHeight, exact: false };
  }
  const bottomPadding = nonnegativeHeight(constraint.maximumBottomPadding);
  if (constraint.heightRule === "exact") {
    return {
      height: declaredHeight + bottomPadding,
      exact: true,
      contentHeightLimit: declaredHeight,
    };
  }
  return {
    height: Math.max(intrinsicHeight, declaredHeight + bottomPadding),
    exact: false,
  };
}

export function resolveTableCellContentClipHeight(
  rowHeightLimit: number,
  cellTopPadding = 0,
  cellBottomPadding = 0,
  outerRowHeight = rowHeightLimit
): number {
  const topPadding = nonnegativeHeight(cellTopPadding);
  return Math.max(
    0,
    Math.min(
      nonnegativeHeight(rowHeightLimit) - topPadding,
      nonnegativeHeight(outerRowHeight) - topPadding - nonnegativeHeight(cellBottomPadding)
    )
  );
}
