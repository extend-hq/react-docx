import type {
  DocModel,
  DocNode,
  ImageRunNode,
  ParagraphChildNode,
  TableCellContentNode
} from "./types";
import { invalidateFormFieldSource, resolveFormFieldSourcePreview } from "./form-field";

function normalizeUint8Array(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value as number[]);
  }
  return undefined;
}

function normalizeParagraphChild(
  child: ParagraphChildNode,
  invalidated: Set<object>
): ParagraphChildNode {
  if (child.type === "form-field" && child.sourcePreview) {
    const image = resolveFormFieldSourcePreview(child);
    if (!image) {
      const stateChanged = typeof child.sourcePreview.checked === "boolean" && (
        child.fieldType !== "checkbox" ||
        child.sourcePreview.checked !== Boolean(child.checked ?? child.widget?.checkbox?.defaultChecked)
      );
      const normalized = stateChanged
        ? invalidateFormFieldSource(child)
        : { ...child, sourcePreview: undefined };
      if (stateChanged) invalidated.add(normalized);
      return normalized;
    }
    const normalizedImage = normalizeParagraphChild(image, invalidated) as ImageRunNode;
    return normalizedImage === image
      ? child
      : { ...child, sourcePreview: { ...child.sourcePreview, image: normalizedImage } };
  }
  if (child.type !== "image") {
    return child;
  }

  const image = child as ImageRunNode;
  const data = normalizeUint8Array(image.data);
  if (data === image.data && !image.contentNodes) {
    return child;
  }

  return {
    ...image,
    data,
    contentNodes: image.contentNodes?.map((node) => normalizeDocNode(node, invalidated))
  };
}

function normalizeTableCellContent(node: TableCellContentNode, invalidated: Set<object>): TableCellContentNode {
  return normalizeDocNode(node, invalidated) as TableCellContentNode;
}

function normalizeDocNode(node: DocNode, invalidated: Set<object>): DocNode {
  if (node.type === "paragraph") {
    const children = node.children.map((child) => normalizeParagraphChild(child, invalidated));
    const stateChanged = invalidated.size > 0 && children.some((child) => invalidated.has(child));
    const normalized = {
      ...node,
      ...(stateChanged ? { sourceXml: undefined, sourceTextPatch: undefined } : {}),
      children
    };
    if (stateChanged) invalidated.add(normalized);
    return normalized;
  }

  const rows = node.rows.map((row) => ({
    ...row,
    cells: row.cells.map((cell) => ({
      ...cell,
      nodes: cell.nodes.map((content) => normalizeTableCellContent(content, invalidated))
    }))
  }));
  const stateChanged = invalidated.size > 0 && rows.some((row) => row.cells.some((cell) => cell.nodes.some((content) => invalidated.has(content))));
  const normalized = {
    ...node,
    ...(stateChanged ? { sourceXml: undefined, sourceTextPatches: undefined } : {}),
    rows
  };
  if (stateChanged) invalidated.add(normalized);
  return normalized;
}

export function normalizeDocModel(model: DocModel): DocModel {
  const invalidated = new Set<object>();
  const normalize = (node: DocNode): DocNode => normalizeDocNode(node, invalidated);
  return {
    ...model,
    nodes: model.nodes.map(normalize),
    metadata: {
      ...model.metadata,
      headerSections: model.metadata.headerSections.map((section) => ({
        ...section,
        nodes: section.nodes.map(normalize)
      })),
      footerSections: model.metadata.footerSections.map((section) => ({
        ...section,
        nodes: section.nodes.map(normalize)
      })),
      sections: model.metadata.sections?.map((section) => ({
        ...section,
        headerSections: section.headerSections.map((header) => ({
          ...header,
          nodes: header.nodes.map(normalize)
        })),
        footerSections: section.footerSections.map((footer) => ({
          ...footer,
          nodes: footer.nodes.map(normalize)
        }))
      })),
      footnotes: model.metadata.footnotes?.map((note) => ({
        ...note,
        nodes: note.nodes?.map(normalize)
      })),
      comments: model.metadata.comments?.map((comment) => ({
        ...comment,
        nodes: comment.nodes?.map(normalize)
      })),
      endnotes: model.metadata.endnotes?.map((note) => ({
        ...note,
        nodes: note.nodes?.map(normalize)
      }))
    }
  };
}
