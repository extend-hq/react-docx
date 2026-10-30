import {
  projectCollapsedTableGrid,
  type DocModel,
  type DocNode,
  type TableNode,
} from "@extend-ai/react-docx-doc-model";

const nodeViews = new WeakMap<DocNode, DocNode>();
const documentViews = new WeakMap<DocModel, DocModel>();
const metadataViews = new WeakMap<DocModel["metadata"], DocModel["metadata"]>();

function mapUnchanged<T>(values: T[], project: (value: T) => T): T[] {
  let result: T[] | undefined;
  values.forEach((value, index) => {
    const next = project(value);
    if (next !== value && !result) result = [...values];
    if (result) result[index] = next;
  });
  return result ?? values;
}

function physicalNodeView(node: DocNode): DocNode {
  const cached = nodeViews.get(node);
  if (cached) return cached;
  let result: DocNode;
  if (node.type === "paragraph") {
    const children = mapUnchanged(node.children, (child) => {
      if (child.type !== "image" || !child.contentNodes) return child;
      const contentNodes = mapUnchanged(child.contentNodes, physicalNodeView);
      return contentNodes === child.contentNodes ? child : { ...child, contentNodes };
    });
    result = children === node.children ? node : { ...node, children };
  } else {
    const marker = node.style?.collapsedGridColumns;
    if (Array.isArray(marker) && marker.length !== 0) {
      if (node.style?.styleId !== node.style?.sourceStyleId) {
        throw new Error("Collapsed table grid must be materialized before changing table style");
      }
      const hasVisibleTableBorder = Object.values(node.style?.borders ?? {}).some(
        (border) => border && border.type !== "none" && border.type !== "nil",
      );
      if (hasVisibleTableBorder) {
        throw new Error("Collapsed table grid requires confirmed zero border spacing before rendering");
      }
    }
    const spacing = node.style?.cellSpacingTwips ?? 0;
    const projection = projectCollapsedTableGrid(node, {
      resolvedBorderSpacingPx: spacing / 15,
    });
    if (projection.kind === "rejected") {
      throw new Error(`Cannot render collapsed table grid: ${projection.reason}`);
    }
    const projected = projection.table;
    const rows = mapUnchanged(projected.rows, (row) => {
      const cells = mapUnchanged(row.cells, (cell) => {
        const nodes = mapUnchanged(cell.nodes, physicalNodeView);
        return nodes === cell.nodes ? cell : { ...cell, nodes };
      });
      return cells === row.cells ? row : { ...row, cells };
    });
    result = rows === projected.rows ? projected : { ...projected, rows };
  }
  nodeViews.set(node, result);
  nodeViews.set(result, result);
  return result;
}

export function physicalTableView(table: TableNode): TableNode {
  return physicalNodeView(table) as TableNode;
}

function physicalGroups<T extends { nodes?: DocNode[] }>(groups: T[] | undefined): T[] | undefined {
  if (!groups) return groups;
  return mapUnchanged(groups, (group) => {
    if (!group.nodes) return group;
    const nodes = mapUnchanged(group.nodes, physicalNodeView);
    return nodes === group.nodes ? group : { ...group, nodes };
  });
}

function physicalMetadataView(metadata: DocModel["metadata"]): DocModel["metadata"] {
  const cached = metadataViews.get(metadata);
  if (cached) return cached;
  const headerSections = physicalGroups(metadata.headerSections)!;
  const footerSections = physicalGroups(metadata.footerSections)!;
  const sections = metadata.sections && mapUnchanged(metadata.sections, (section) => {
    const headers = physicalGroups(section.headerSections)!;
    const footers = physicalGroups(section.footerSections)!;
    return headers === section.headerSections && footers === section.footerSections
      ? section
      : { ...section, headerSections: headers, footerSections: footers };
  });
  const footnotes = physicalGroups(metadata.footnotes);
  const endnotes = physicalGroups(metadata.endnotes);
  const comments = physicalGroups(metadata.comments);
  const result = headerSections === metadata.headerSections && footerSections === metadata.footerSections &&
    sections === metadata.sections && footnotes === metadata.footnotes && endnotes === metadata.endnotes &&
    comments === metadata.comments
    ? metadata
    : { ...metadata, headerSections, footerSections, sections, footnotes, endnotes, comments };
  metadataViews.set(metadata, result);
  metadataViews.set(result, result);
  return result;
}

export function documentWithPhysicalTableGrids(model: DocModel): DocModel {
  const cached = documentViews.get(model);
  if (cached) return cached;
  const nodes = mapUnchanged(model.nodes, physicalNodeView);
  const metadata = physicalMetadataView(model.metadata);
  const result = nodes === model.nodes && metadata === model.metadata
    ? model
    : { ...model, nodes, metadata };
  documentViews.set(model, result);
  documentViews.set(result, result);
  return result;
}
