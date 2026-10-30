import {
  cloneTableNode,
  projectCollapsedTableGrid,
  resolveTableGridSkipCount,
  tableGridColumnBound,
  type DocModel,
  type TableCellContentNode,
  type TableNode,
} from "@extend-ai/react-docx-doc-model";
import {
  commitNestedStructuralTableEdit,
  type NestedTablePathStep,
} from "./table-grid-edit";

export interface TableGridResizeTarget {
  tableIndex: number;
  path: readonly NestedTablePathStep[];
}

export interface TableGridResizeGeometry {
  widthsPx?: readonly number[];
  heightsPx?: readonly number[];
  initialWidthsPx?: readonly number[];
  initialHeightsPx?: readonly number[];
  resolvedBorderSpacingPx?: number;
}

export type TableGridResizeResult =
  | { kind: "unchanged"; model: DocModel }
  | { kind: "committed"; model: DocModel }
  | { kind: "rejected"; model: DocModel; reason: string };

function normalizedTwips(
  values: readonly number[],
  count: number,
  allowZero: boolean,
): number[] | undefined {
  if (values.length !== count) return undefined;
  const result: number[] = [];
  for (const value of values) {
    if (!Number.isFinite(value) || value < 0) return undefined;
    const twips = Math.round(value * 15);
    if (!Number.isSafeInteger(twips) || (allowZero ? twips < 0 : twips <= 0)) return undefined;
    result.push(twips);
  }
  return result;
}

function sameDimensions(left: readonly number[], right?: readonly number[]): boolean {
  return right !== undefined && left.length === right.length && left.every((value, index) => value === right[index]);
}

function targetTable(model: DocModel, target: TableGridResizeTarget): TableNode | undefined {
  if (!Number.isSafeInteger(target.tableIndex) || target.tableIndex < 0) return undefined;
  const root = model.nodes[target.tableIndex];
  if (!root || root.type !== "table") return undefined;
  let table: TableNode = root;
  for (const step of target.path) {
    if (![step.rowIndex, step.cellIndex, step.nodeIndex].every((value) => Number.isSafeInteger(value) && value >= 0)) return undefined;
    const child: TableCellContentNode | undefined = table.rows[step.rowIndex]?.cells[step.cellIndex]?.nodes[step.nodeIndex];
    if (!child || child.type !== "table") return undefined;
    table = child;
  }
  return table;
}

export function commitTableGridResize(
  model: DocModel,
  target: TableGridResizeTarget,
  expectedTarget: TableNode,
  geometry: TableGridResizeGeometry,
): TableGridResizeResult {
  const reject = (reason: string): TableGridResizeResult => ({ kind: "rejected", model, reason });
  const source = targetTable(model, target);
  if (!source) return reject("invalid-table-target");
  if (source !== expectedTarget) return reject("stale-table-target");
  if (geometry.widthsPx === undefined && geometry.heightsPx === undefined) return { kind: "unchanged", model };

  const projection = projectCollapsedTableGrid(source, { resolvedBorderSpacingPx: geometry.resolvedBorderSpacingPx });
  if (projection.kind === "rejected") return reject(projection.reason);
  const physical = projection.table;
  const columnCount = tableGridColumnBound(physical);
  const rowCount = physical.rows.length;
  const widths = geometry.widthsPx === undefined ? undefined : normalizedTwips(geometry.widthsPx, columnCount, true);
  const heights = geometry.heightsPx === undefined ? undefined : normalizedTwips(geometry.heightsPx, rowCount, false);
  if (geometry.widthsPx !== undefined && !widths) return reject("invalid-column-widths");
  if (geometry.heightsPx !== undefined && !heights) return reject("invalid-row-heights");
  const initialWidths = geometry.initialWidthsPx === undefined
    ? physical.style?.columnWidthsTwips
    : normalizedTwips(geometry.initialWidthsPx, columnCount, true);
  const initialHeights = geometry.initialHeightsPx === undefined
    ? physical.rows.map((row) => row.style?.heightTwips ?? Number.NaN)
    : normalizedTwips(geometry.initialHeightsPx, rowCount, false);
  if (geometry.initialWidthsPx !== undefined && !initialWidths) return reject("invalid-initial-column-widths");
  if (geometry.initialHeightsPx !== undefined && !initialHeights) return reject("invalid-initial-row-heights");
  const widthsChanged = widths !== undefined && !sameDimensions(widths, initialWidths);
  const changedRows = heights?.map((height, rowIndex) => height !== initialHeights?.[rowIndex]) ?? [];
  if (!widthsChanged && !changedRows.some(Boolean)) return { kind: "unchanged", model };

  const columnBoundaries = [0];
  const rowRanges: Array<{ before: number; after: number; cells: Array<{ start: number; end: number }> }> = [];
  if (widthsChanged && widths) {
    for (const width of widths) {
      const total = columnBoundaries[columnBoundaries.length - 1] + width;
      if (!Number.isSafeInteger(total)) return reject("column-width-total-overflow");
      columnBoundaries.push(total);
    }
    if (columnBoundaries[columnBoundaries.length - 1] <= 0) return reject("nonpositive-table-width");
    for (const row of physical.rows) {
      const before = resolveTableGridSkipCount(row.style?.gridBefore, columnCount);
      const after = resolveTableGridSkipCount(row.style?.gridAfter, columnCount);
      let cursor = before;
      const cells: Array<{ start: number; end: number }> = [];
      for (const cell of row.cells) {
        const span = cell.style?.gridSpan ?? 1;
        if (!Number.isSafeInteger(span) || span < 1 || cursor + span > columnCount) return reject("invalid-cell-grid-range");
        const end = cursor + span;
        if (columnBoundaries[end] - columnBoundaries[cursor] <= 0) return reject("nonpositive-cell-width");
        cells.push({ start: cursor, end });
        cursor = end;
      }
      if (cursor + after > columnCount) return reject("invalid-row-grid-range");
      rowRanges.push({ before, after, cells });
    }
  }

  const root = model.nodes[target.tableIndex];
  if (root.type !== "table") return reject("invalid-table-target");
  const commit = commitNestedStructuralTableEdit(root, target.path, "commit", (draft) => {
    if (widthsChanged && widths) {
      const total = columnBoundaries[columnBoundaries.length - 1];
      draft.style = {
        ...draft.style,
        columnWidthsTwips: widths,
        widthTwips: total,
        preferredWidth: { type: "dxa", value: total },
        sourceWidth: undefined,
      };
      draft.rows.forEach((row, rowIndex) => {
        const ranges = rowRanges[rowIndex];
        row.cells.forEach((cell, cellIndex) => {
          const range = ranges.cells[cellIndex];
          const width = columnBoundaries[range.end] - columnBoundaries[range.start];
          cell.style = { ...cell.style, widthTwips: width, preferredWidth: { type: "dxa", value: width }, sourceWidth: undefined };
        });
        const normalizedBefore = row.style?.gridBefore !== undefined && row.style.gridBefore !== ranges.before;
        const normalizedAfter = row.style?.gridAfter !== undefined && row.style.gridAfter !== ranges.after;
        if (ranges.before > 0 || ranges.after > 0 || normalizedBefore || normalizedAfter) {
          const cellsEnd = ranges.cells.at(-1)?.end ?? ranges.before;
          row.style = {
            ...row.style,
            ...(row.style?.gridBefore !== undefined || ranges.before > 0 ? { gridBefore: ranges.before } : {}),
            ...(row.style?.gridAfter !== undefined || ranges.after > 0 ? { gridAfter: ranges.after } : {}),
            ...(ranges.before > 0 ? { widthBefore: { type: "dxa" as const, value: columnBoundaries[ranges.before] } } : normalizedBefore ? { widthBefore: undefined } : {}),
            ...(ranges.after > 0 ? { widthAfter: { type: "dxa" as const, value: columnBoundaries[cellsEnd + ranges.after] - columnBoundaries[cellsEnd] } } : normalizedAfter ? { widthAfter: undefined } : {}),
            sourceRowGeometry: undefined,
          };
        }
      });
    }
    if (heights) {
      draft.rows.forEach((row, rowIndex) => {
        if (!changedRows[rowIndex]) return;
        row.style = {
          ...row.style,
          heightTwips: heights[rowIndex],
          heightRule: row.style?.heightRule === "exact" ? "exact" : "atLeast",
        };
      });
    }
    return { changed: true };
  }, { resolvedBorderSpacingPx: geometry.resolvedBorderSpacingPx, cloneTable: cloneTableNode });
  if (commit.kind === "rejected") return reject(commit.reason);
  if (commit.kind === "unchanged") return { kind: "unchanged", model };
  const nodes = [...model.nodes];
  nodes[target.tableIndex] = commit.table;
  return { kind: "committed", model: { ...model, nodes } };
}
