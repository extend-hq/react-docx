import type {
  DocModel,
  DocNode,
  ImageRunNode,
  ParagraphChildNode,
  TableCellContentNode
} from "./types";

function normalizeUint8Array(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value as number[]);
  }
  return undefined;
}

function normalizeParagraphChild(child: ParagraphChildNode): ParagraphChildNode {
  if (child.type !== "image") {
    return child;
  }

  const image = child as ImageRunNode;
  const data = normalizeUint8Array(image.data);
  if (data === image.data) {
    return child;
  }

  return {
    ...image,
    data
  };
}

function normalizeTableCellContent(node: TableCellContentNode): TableCellContentNode {
  if (node.type === "table") {
    return normalizeDocNode(node) as TableCellContentNode;
  }

  return {
    ...node,
    children: node.children.map(normalizeParagraphChild)
  };
}

function normalizeDocNode(node: DocNode): DocNode {
  if (node.type === "paragraph") {
    return {
      ...node,
      children: node.children.map(normalizeParagraphChild)
    };
  }

  return {
    ...node,
    rows: node.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => ({
        ...cell,
        nodes: cell.nodes.map(normalizeTableCellContent)
      }))
    }))
  };
}

export function normalizeDocModel(model: DocModel): DocModel {
  return {
    ...model,
    nodes: model.nodes.map(normalizeDocNode),
    metadata: {
      ...model.metadata,
      headerSections: model.metadata.headerSections.map((section) => ({
        ...section,
        nodes: section.nodes.map(normalizeDocNode)
      })),
      footerSections: model.metadata.footerSections.map((section) => ({
        ...section,
        nodes: section.nodes.map(normalizeDocNode)
      })),
      sections: model.metadata.sections?.map((section) => ({
        ...section,
        headerSections: section.headerSections.map((header) => ({
          ...header,
          nodes: header.nodes.map(normalizeDocNode)
        })),
        footerSections: section.footerSections.map((footer) => ({
          ...footer,
          nodes: footer.nodes.map(normalizeDocNode)
        }))
      })),
      footnotes: model.metadata.footnotes?.map((note) => ({
        ...note,
        nodes: note.nodes?.map(normalizeDocNode)
      })),
      endnotes: model.metadata.endnotes?.map((note) => ({
        ...note,
        nodes: note.nodes?.map(normalizeDocNode)
      }))
    }
  };
}
