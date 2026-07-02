import type { DocModel, DocNode, TableCellContentNode } from "./types";

let nextBlockIdValue = 1;

/** Returns a fresh block id, unique for the lifetime of this module instance. */
export function allocateBlockId(): string {
  const value = nextBlockIdValue;
  nextBlockIdValue += 1;
  return `b${value}`;
}

function ensureNodeBlockIds(node: DocNode | TableCellContentNode): void {
  if (!node.blockId) {
    node.blockId = allocateBlockId();
  }

  if (node.type !== "table") {
    return;
  }

  for (const row of node.rows) {
    for (const cell of row.cells) {
      for (const child of cell.nodes) {
        ensureNodeBlockIds(child);
      }
    }
  }
}

/**
 * Assigns a fresh block id to every paragraph/table node (body, headers,
 * footers, footnotes, endnotes, nested table content) that does not already
 * have one. Mutates the model in place and returns it.
 */
export function ensureDocModelBlockIds(model: DocModel): DocModel {
  model.nodes.forEach(ensureNodeBlockIds);

  for (const section of model.metadata.headerSections ?? []) {
    section.nodes.forEach(ensureNodeBlockIds);
  }
  for (const section of model.metadata.footerSections ?? []) {
    section.nodes.forEach(ensureNodeBlockIds);
  }
  for (const section of model.metadata.sections ?? []) {
    for (const headerSection of section.headerSections ?? []) {
      headerSection.nodes.forEach(ensureNodeBlockIds);
    }
    for (const footerSection of section.footerSections ?? []) {
      footerSection.nodes.forEach(ensureNodeBlockIds);
    }
  }
  for (const note of model.metadata.footnotes ?? []) {
    note.nodes?.forEach(ensureNodeBlockIds);
  }
  for (const note of model.metadata.endnotes ?? []) {
    note.nodes?.forEach(ensureNodeBlockIds);
  }

  return model;
}

function collectNodeBlockIds(
  node: DocNode | TableCellContentNode,
  seen: Set<string>,
  duplicates: Set<string>
): void {
  if (node.blockId) {
    if (seen.has(node.blockId)) {
      duplicates.add(node.blockId);
    }
    seen.add(node.blockId);
  }

  if (node.type !== "table") {
    return;
  }

  for (const row of node.rows) {
    for (const cell of row.cells) {
      for (const child of cell.nodes) {
        collectNodeBlockIds(child, seen, duplicates);
      }
    }
  }
}

/**
 * Returns block ids that appear on more than one node within the same
 * container (body, a header/footer part, a note). Nodes without ids are
 * ignored, and the same id may legitimately recur across containers (section
 * views reference the same header/footer parts as the flat metadata lists).
 */
export function collectDuplicateDocModelBlockIds(model: DocModel): string[] {
  const duplicates = new Set<string>();

  const visitContainer = (nodes: DocNode[] | undefined): void => {
    if (!nodes) {
      return;
    }
    const seen = new Set<string>();
    nodes.forEach((node) => collectNodeBlockIds(node, seen, duplicates));
  };

  visitContainer(model.nodes);
  for (const section of model.metadata.headerSections ?? []) {
    visitContainer(section.nodes);
  }
  for (const section of model.metadata.footerSections ?? []) {
    visitContainer(section.nodes);
  }
  for (const note of model.metadata.footnotes ?? []) {
    visitContainer(note.nodes);
  }
  for (const note of model.metadata.endnotes ?? []) {
    visitContainer(note.nodes);
  }

  return Array.from(duplicates);
}
