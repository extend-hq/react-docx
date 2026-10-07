import type { TableNode, TableRowNode } from "./types";

/** The parent grid bounds skipped-column counts without changing their source values. */
export function tableGridColumnBound(table: Pick<TableNode, "style" | "rows">): number {
  if (table.style?.columnWidthsTwips !== undefined) return table.style.columnWidthsTwips.length;
  return Math.max(0, ...table.rows.map((row) => row.cells.reduce((total, cell) => {
    const span = cell.style?.gridSpan;
    return total + (Number.isFinite(span) && (span as number) > 0 ? Math.max(1, Math.floor(span as number)) : 1);
  }, 0)));
}

/** Ignore skipped-grid counts that exceed the parent grid. */
export function resolveTableGridSkipCount(count: number | undefined, gridColumnCount: number): number {
  const value = Number.isFinite(count) && (count as number) >= 0 ? Math.floor(count as number) : 0;
  return Number.isFinite(gridColumnCount) && gridColumnCount >= value ? value : 0;
}

export function tableRowGridSkipCount(
  table: Pick<TableNode, "style" | "rows">,
  row: TableRowNode,
  edge: "before" | "after"
): number {
  return resolveTableGridSkipCount(
    edge === "before" ? row.style?.gridBefore : row.style?.gridAfter,
    tableGridColumnBound(table)
  );
}
