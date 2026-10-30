export interface GridCell {
  style?: {
    gridSpan?: number;
  };
}

export interface GridRow {
  cells: GridCell[];
  style?: {
    gridBefore?: number;
    gridAfter?: number;
  };
}

export interface GridTable {
  rows: GridRow[];
  sourceXml?: string;
  sourceTextPatches?: unknown;
  style?: {
    layout?: string;
    columnWidthsTwips?: number[];
    collapsedGridColumns?: number[];
    cellSpacingTwips?: number;
  };
}

export interface GridProjectionOptions {
  /** Effective border spacing after the consumer has resolved inherited styles. */
  resolvedBorderSpacingPx?: number;
}

export interface LogicalBoundaryRange {
  start: number;
  end: number;
}

export type GridProjectionResult<T extends GridTable> =
  | { kind: 'identity'; sourceTable: T; table: T }
  /** A marked grid rejected here must not be passed to a physical layout consumer. */
  | { kind: 'rejected'; sourceTable: T; reason: string }
  | {
      kind: 'projected';
      sourceTable: T;
      table: T;
      logicalToPhysicalBoundary: number[];
      physicalToLogicalBoundaryRanges: LogicalBoundaryRange[];
      physicalToLogicalColumn: number[];
      collapsedGridColumns: number[];
    };

/** Produces a physical view while retaining the original logical model and source provenance. */
export function projectCollapsedTableGrid<T extends GridTable>(
  sourceTable: T,
  options: GridProjectionOptions = {},
): GridProjectionResult<T> {
  const marker = sourceTable.style?.collapsedGridColumns;
  if (marker === undefined || (Array.isArray(marker) && marker.length === 0)) {
    return { kind: 'identity', sourceTable, table: sourceTable };
  }
  const reject = (reason: string): GridProjectionResult<T> => ({ kind: 'rejected', sourceTable, reason });
  if (!Array.isArray(marker)) return reject('invalid-collapsed-marker');
  if (sourceTable.style?.layout !== 'fixed') return reject('fixed-layout-required');
  if (options.resolvedBorderSpacingPx !== 0) return reject('zero-resolved-spacing-not-confirmed');
  if (sourceTable.style.cellSpacingTwips !== undefined && sourceTable.style.cellSpacingTwips !== 0) {
    return reject('nonzero-source-cell-spacing');
  }
  const widths = sourceTable.style.columnWidthsTwips;
  if (!Array.isArray(widths) || widths.length === 0 ||
      widths.some((value) => !Number.isFinite(value) || value < 0)) {
    return reject('invalid-logical-grid');
  }
  const collapsed = new Set<number>();
  for (const index of marker) {
    if (!Number.isInteger(index) || index < 0 || index >= widths.length) return reject('invalid-collapsed-index');
    if (collapsed.has(index)) return reject('duplicate-collapsed-index');
    if (widths[index] !== 0) return reject('marked-column-has-positive-width');
    collapsed.add(index);
  }
  const logicalToPhysicalBoundary = [0];
  const physicalToLogicalColumn: number[] = [];
  const physicalWidths: number[] = [];
  for (let index = 0; index < widths.length; index += 1) {
    if (!collapsed.has(index)) {
      if (widths[index] === 0) return reject('unmarked-zero-column');
      physicalToLogicalColumn.push(index);
      physicalWidths.push(widths[index]);
    }
    logicalToPhysicalBoundary.push(physicalWidths.length);
  }
  if (physicalWidths.length === 0) return reject('empty-physical-grid');
  const physicalToLogicalBoundaryRanges: LogicalBoundaryRange[] = [];
  for (let logical = 0; logical < logicalToPhysicalBoundary.length; logical += 1) {
    const physical = logicalToPhysicalBoundary[logical];
    const range = physicalToLogicalBoundaryRanges[physical];
    if (range) range.end = logical;
    else physicalToLogicalBoundaryRanges[physical] = { start: logical, end: logical };
  }
  const physicalSums = [0];
  for (const value of physicalWidths) {
    const total = physicalSums.at(-1)! + value;
    if (!Number.isFinite(total)) return reject('invalid-physical-grid-width');
    physicalSums.push(total);
  }
  if (!(physicalSums.at(-1)! > 0)) return reject('invalid-physical-grid-width');
  const rows: GridRow[] = [];
  for (const row of sourceTable.rows) {
    if ((row.style?.gridBefore ?? 0) !== 0 || (row.style?.gridAfter ?? 0) !== 0) {
      return reject('row-grid-gaps-not-supported');
    }
    let logicalStart = 0;
    let changed = false;
    const cells: GridCell[] = [];
    for (const cell of row.cells) {
      const sourceSpan = cell.style?.gridSpan ?? 1;
      if (!Number.isInteger(sourceSpan) || sourceSpan <= 0) return reject('invalid-cell-span');
      const logicalEnd = logicalStart + sourceSpan;
      if (logicalEnd > widths.length) return reject('cell-exceeds-logical-grid');
      const physicalStart = logicalToPhysicalBoundary[logicalStart];
      const physicalEnd = logicalToPhysicalBoundary[logicalEnd];
      const span = physicalEnd - physicalStart;
      if (span <= 0) return reject('cell-collapses-to-empty-span');
      if (!(physicalSums[physicalEnd] - physicalSums[physicalStart] > 0)) {
        return reject('cell-has-nonpositive-physical-width');
      }
      if (span === sourceSpan) {
        cells.push(cell);
      } else {
        changed = true;
        const style = { ...cell.style };
        if (span === 1) delete style.gridSpan;
        else style.gridSpan = span;
        cells.push({ ...cell, style });
      }
      logicalStart = logicalEnd;
    }
    rows.push(changed ? { ...row, cells } : row);
  }
  const { collapsedGridColumns: _marker, ...style } = sourceTable.style;
  const table = { ...sourceTable, style: { ...style, columnWidthsTwips: physicalWidths }, rows } as T;
  return {
    kind: 'projected', sourceTable, table,
    logicalToPhysicalBoundary, physicalToLogicalBoundaryRanges, physicalToLogicalColumn,
    collapsedGridColumns: [...collapsed].sort((left, right) => left - right),
  };
}

/** Invalidates only the projected table's source provenance at a committed structural edit. */
export function materializeCollapsedTableGrid<T extends GridTable>(
  sourceTable: T,
  options: GridProjectionOptions = {},
): GridProjectionResult<T> {
  const projection = projectCollapsedTableGrid(sourceTable, options);
  if (projection.kind !== 'projected') return projection;
  const table = { ...projection.table };
  delete table.sourceXml;
  delete table.sourceTextPatches;
  return { ...projection, table };
}
