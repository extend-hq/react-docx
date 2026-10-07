import type { TableNode } from "@extend-ai/react-docx-doc-model";
import { resolveTableGridSkipCount, tableGridColumnBound } from "@extend-ai/react-docx-doc-model";

type TableRow = TableNode["rows"][number];

export interface TableCellPhysicalGridRange {
  cellIndex: number;
  startColumnIndex: number;
  endColumnIndex: number;
}

export type TableGridColumnInsertionRowPlan = { rowIndex: number } & (
  | { kind: "unchanged" }
  | { kind: "expand-before"; gridBefore: number }
  | { kind: "expand-after"; gridAfter: number }
  | { kind: "extend-cell"; cellIndex: number; gridSpan: number }
  | { kind: "insert-cell"; cellIndex: number; referenceCellIndex?: number }
);

export type TableGridColumnDeletionRowPlan = { rowIndex: number } & (
  | { kind: "unchanged" }
  | { kind: "reduce-before"; gridBefore: number }
  | { kind: "reduce-after"; gridAfter: number }
  | { kind: "shrink-cell"; cellIndex: number; gridSpan: number }
  | { kind: "remove-cell"; cellIndex: number; removesOnlyCell: boolean }
);

export interface TableGridColumnInsertionPlan {
  columnIndex: number;
  columnCount: number;
  rows: TableGridColumnInsertionRowPlan[];
}

export interface TableGridColumnDeletionPlan {
  columnIndex: number;
  columnCount: number;
  deletesLastPhysicalColumn: boolean;
  deletesAllActualCells: boolean;
  rows: TableGridColumnDeletionRowPlan[];
}

function gridCount(value: number | undefined): number {
  return Number.isFinite(value) && (value as number) > 0
    ? Math.floor(value as number)
    : 0;
}

function cellGridSpan(cell: TableRow["cells"][number]): number {
  return Math.max(1, gridCount(cell.style?.gridSpan));
}

function rowGridRanges(row: TableRow, gridColumnBound: number): TableCellPhysicalGridRange[] {
  let columnIndex = resolveTableGridSkipCount(row.style?.gridBefore, gridColumnBound);
  return row.cells.map((cell, cellIndex) => {
    const startColumnIndex = columnIndex;
    columnIndex += cellGridSpan(cell);
    return { cellIndex, startColumnIndex, endColumnIndex: columnIndex };
  });
}

export function tableCellPhysicalGridRange(
  row: TableRow,
  cellIndex: number,
  gridColumnBound: number
): TableCellPhysicalGridRange | undefined {
  return Number.isInteger(cellIndex) && cellIndex >= 0
    ? rowGridRanges(row, gridColumnBound)[cellIndex]
    : undefined;
}

export function tablePhysicalGridColumnCount(table: TableNode): number {
  const bound = tableGridColumnBound(table);
  return table.rows.reduce((largest, row) => {
    const columns = row.cells.reduce(
      (total, cell) => total + cellGridSpan(cell),
      resolveTableGridSkipCount(row.style?.gridBefore, bound) +
      resolveTableGridSkipCount(row.style?.gridAfter, bound)
    );
    return Math.max(largest, columns);
  }, bound);
}

export function planTableGridColumnInsertion(
  table: TableNode,
  columnIndex: number
): TableGridColumnInsertionPlan | undefined {
  const columnCount = tablePhysicalGridColumnCount(table);
  const bound = tableGridColumnBound(table);
  if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex > columnCount) {
    return undefined;
  }
  const rows = table.rows.map((row, rowIndex): TableGridColumnInsertionRowPlan => {
    const before = resolveTableGridSkipCount(row.style?.gridBefore, bound);
    const after = resolveTableGridSkipCount(row.style?.gridAfter, bound);
    const ranges = rowGridRanges(row, bound);
    const cellEnd = ranges.at(-1)?.endColumnIndex ?? before;
    if (columnIndex < before) {
      return { rowIndex, kind: "expand-before", gridBefore: before + 1 };
    }
    if (columnIndex > cellEnd) {
      return columnIndex <= cellEnd + after
        ? { rowIndex, kind: "expand-after", gridAfter: after + 1 }
        : { rowIndex, kind: "unchanged" };
    }
    for (const range of ranges) {
      if (columnIndex === range.startColumnIndex) {
        return { rowIndex, kind: "insert-cell", cellIndex: range.cellIndex, referenceCellIndex: range.cellIndex };
      }
      if (columnIndex > range.startColumnIndex && columnIndex < range.endColumnIndex) {
        return { rowIndex, kind: "extend-cell", cellIndex: range.cellIndex, gridSpan: range.endColumnIndex - range.startColumnIndex + 1 };
      }
    }
    return { rowIndex, kind: "insert-cell", cellIndex: row.cells.length, referenceCellIndex: row.cells.length > 0 ? row.cells.length - 1 : undefined };
  });
  return { columnIndex, columnCount, rows };
}

export function planTableGridColumnDeletion(
  table: TableNode,
  columnIndex: number
): TableGridColumnDeletionPlan | undefined {
  const columnCount = tablePhysicalGridColumnCount(table);
  const bound = tableGridColumnBound(table);
  if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= columnCount) {
    return undefined;
  }
  const rows = table.rows.map((row, rowIndex): TableGridColumnDeletionRowPlan => {
    const before = resolveTableGridSkipCount(row.style?.gridBefore, bound);
    const after = resolveTableGridSkipCount(row.style?.gridAfter, bound);
    const ranges = rowGridRanges(row, bound);
    const cellEnd = ranges.at(-1)?.endColumnIndex ?? before;
    if (columnIndex < before) {
      return { rowIndex, kind: "reduce-before", gridBefore: before - 1 };
    }
    for (const range of ranges) {
      if (columnIndex < range.startColumnIndex || columnIndex >= range.endColumnIndex) continue;
      const span = range.endColumnIndex - range.startColumnIndex;
      return span > 1
        ? { rowIndex, kind: "shrink-cell", cellIndex: range.cellIndex, gridSpan: span - 1 }
        : { rowIndex, kind: "remove-cell", cellIndex: range.cellIndex, removesOnlyCell: row.cells.length === 1 };
    }
    return columnIndex < cellEnd + after
      ? { rowIndex, kind: "reduce-after", gridAfter: after - 1 }
      : { rowIndex, kind: "unchanged" };
  });
  const deletesAllActualCells = table.rows.some((row) => row.cells.length > 0) && rows.every((plan) =>
    table.rows[plan.rowIndex].cells.length === 0 ||
    (plan.kind === "remove-cell" && plan.removesOnlyCell)
  );
  return { columnIndex, columnCount, deletesLastPhysicalColumn: columnCount === 1, deletesAllActualCells, rows };
}

export function tableCellsIntersectingGridRange(
  table: TableNode,
  startRowIndex: number,
  endRowIndex: number,
  startColumnIndex: number,
  endColumnIndex: number
): Array<{ rowIndex: number; cellIndex: number }> {
  const selected: Array<{ rowIndex: number; cellIndex: number }> = [];
  const bound = tableGridColumnBound(table);
  if (endColumnIndex <= startColumnIndex) return selected;
  table.rows.forEach((row, rowIndex) => {
    if (rowIndex < startRowIndex || rowIndex > endRowIndex) return;
    for (const range of rowGridRanges(row, bound)) {
      if (range.endColumnIndex > startColumnIndex && range.startColumnIndex < endColumnIndex) {
        selected.push({ rowIndex, cellIndex: range.cellIndex });
      }
    }
  });
  return selected;
}
