import { cloneDocModel, cloneTableNode, type DocModel, type TableNode } from "@extend-ai/react-docx-doc-model";
import {
  projectCollapsedTableGrid,
  type GridTable,
} from "@extend-ai/react-docx-doc-model";

export type StructuralTableIntent = "preview" | "cancel" | "commit";

export type StructuralTableCommitResult<T extends GridTable> =
  | { kind: "unchanged"; table: T; originalTable: T }
  | { kind: "rejected"; table: T; originalTable: T; reason: string }
  | { kind: "committed"; table: T; originalTable: T; materialized: boolean };

export interface StructuralTableCommitOptions<T extends GridTable> {
  resolvedBorderSpacingPx?: number;
  cloneTable: (table: T) => T;
}

export interface StructuralTableMutation<T extends GridTable> {
  changed: boolean;
  table?: T;
}

export interface NestedTablePathStep {
  rowIndex: number;
  cellIndex: number;
  nodeIndex: number;
}

export type NestedStructuralTableCommitResult<T extends GridTable> =
  | { kind: "unchanged"; table: T; originalTable: T }
  | { kind: "rejected"; table: T; originalTable: T; reason: string }
  | {
      kind: "committed";
      table: T;
      originalTable: T;
      targetTable: T;
      originalTargetTable: T;
      targetMaterialized: boolean;
      invalidatedAncestorCount: number;
    };

export function commitNestedStructuralTableEdit<T extends GridTable>(
  originalTable: T,
  path: readonly NestedTablePathStep[],
  intent: StructuralTableIntent,
  mutatePhysicalTable: (draft: T) => StructuralTableMutation<T>,
  options: StructuralTableCommitOptions<T>,
): NestedStructuralTableCommitResult<T> {
  if (intent !== "commit") {
    return { kind: "unchanged", table: originalTable, originalTable };
  }
  type Cell = T["rows"][number]["cells"][number] & { nodes?: unknown[] };
  const ancestors: Array<{ table: T; step: NestedTablePathStep }> = [];
  let target = originalTable;
  for (const step of path) {
    if (![step.rowIndex, step.cellIndex, step.nodeIndex].every((value) => Number.isSafeInteger(value) && value >= 0)) {
      return { kind: "rejected", table: originalTable, originalTable, reason: "invalid-table-path" };
    }
    const cell = target.rows[step.rowIndex]?.cells[step.cellIndex] as Cell | undefined;
    const child = cell?.nodes?.[step.nodeIndex];
    if (typeof child !== "object" || child === null || !("type" in child) || child.type !== "table" || !("rows" in child) || !Array.isArray(child.rows)) {
      return { kind: "rejected", table: originalTable, originalTable, reason: "invalid-table-path" };
    }
    ancestors.push({ table: target, step });
    target = child as T;
  }
  const result = commitStructuralTableEdit(target, "commit", mutatePhysicalTable, options);
  if (result.kind === "rejected") {
    return { kind: "rejected", table: originalTable, originalTable, reason: result.reason };
  }
  if (result.kind === "unchanged") {
    return { kind: "unchanged", table: originalTable, originalTable };
  }
  let replacement = result.table;
  for (let index = ancestors.length - 1; index >= 0; index--) {
    const { table, step } = ancestors[index];
    const row = table.rows[step.rowIndex];
    const cell = row.cells[step.cellIndex] as Cell;
    const nodes = [...cell.nodes!];
    nodes[step.nodeIndex] = replacement;
    const cells = [...row.cells];
    const updatedCell = { ...cell, nodes };
    cells[step.cellIndex] = updatedCell;
    const rows = [...table.rows];
    rows[step.rowIndex] = { ...row, cells };
    replacement = { ...table, rows };
    clearTableSourceProvenance(replacement);
  }
  return {
    kind: "committed",
    table: replacement,
    originalTable,
    targetTable: result.table,
    originalTargetTable: target,
    targetMaterialized: result.materialized,
    invalidatedAncestorCount: ancestors.length,
  };
}

export function commitStructuralTableEdit<T extends GridTable>(
  originalTable: T,
  intent: StructuralTableIntent,
  mutatePhysicalTable: (draft: T) => StructuralTableMutation<T>,
  options: StructuralTableCommitOptions<T>,
): StructuralTableCommitResult<T> {
  if (intent !== "commit") {
    return { kind: "unchanged", table: originalTable, originalTable };
  }
  const projection = projectCollapsedTableGrid(originalTable, {
    resolvedBorderSpacingPx: options.resolvedBorderSpacingPx,
  });
  if (projection.kind === "rejected") {
    return {
      kind: "rejected",
      table: originalTable,
      originalTable,
      reason: projection.reason,
    };
  }
  const draft = options.cloneTable(projection.table);
  clearTableSourceGeometry(draft);
  const mutation = mutatePhysicalTable(draft);
  if (!mutation.changed) {
    return { kind: "unchanged", table: originalTable, originalTable };
  }
  const table = mutation.table ?? draft;
  if (table === originalTable) {
    throw new Error("A structural commit must return an isolated table");
  }
  clearTableSourceGeometry(table);
  return {
    kind: "committed",
    table,
    originalTable,
    materialized: projection.kind === "projected",
  };
}

function clearTableSourceGeometry<T extends GridTable>(table: T): void {
  clearTableSourceProvenance(table);
  if (table.style) {
    delete table.style.collapsedGridColumns;
  }
}

function clearTableSourceProvenance<T extends GridTable>(table: T): void {
  const mutable = table as T & { sourceXml?: string; sourceTextPatches?: unknown };
  delete mutable.sourceXml;
  delete mutable.sourceTextPatches;
}

export function prepareModelForTableStructuralEdit(model: DocModel, tableIndex: number): DocModel | undefined {
  const table = model.nodes[tableIndex];
  if (!table || table.type !== "table") return undefined;
  const projection = projectCollapsedTableGrid(table, {
    resolvedBorderSpacingPx: (table.style?.cellSpacingTwips ?? 0) / 15,
  });
  if (projection.kind === "rejected") return undefined;
  const next = cloneDocModel(model);
  const draft = projection.kind === "projected"
    ? cloneTableNode(projection.table)
    : next.nodes[tableIndex] as TableNode;
  next.nodes[tableIndex] = draft;
  if (projection.kind === "projected") clearTableSourceGeometry(draft);
  return next;
}
