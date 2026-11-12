import type {
  DocModel,
  DocNode,
  ImageRunNode,
  ParagraphChildNode,
  TableCellContentNode
} from "./types";
import { invalidateFormFieldSource, resolveFormFieldSourcePreview } from "./form-field";
import { imageDataSource, isOpenDocumentModel } from "./opendocument";

interface NormalizeContext {
  invalidated: Set<object>;
  /** OpenDocument images have no `src`; it is built from their bytes. */
  fillImageSources: boolean;
}

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
  context: NormalizeContext
): ParagraphChildNode {
  const { invalidated } = context;
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
    const normalizedImage = normalizeParagraphChild(image, context) as ImageRunNode;
    return normalizedImage === image
      ? child
      : { ...child, sourcePreview: { ...child.sourcePreview, image: normalizedImage } };
  }
  if (child.type !== "image") {
    return child;
  }

  const image = child as ImageRunNode;
  const data = normalizeUint8Array(image.data);
  const modelAsset = image.model3d?.asset;
  const modelData = normalizeUint8Array(modelAsset?.data);
  const model3d = modelAsset && modelData !== modelAsset.data
    ? { ...image.model3d!, asset: { ...modelAsset, data: modelData } }
    : image.model3d;
  const src = context.fillImageSources && !image.src && !image.contentNodes
    ? imageDataSource({ data, contentType: image.contentType })
    : image.src;
  if (data === image.data && model3d === image.model3d && src === image.src && !image.contentNodes) {
    return child;
  }

  return {
    ...image,
    ...(src === image.src ? {} : { src }),
    data,
    model3d,
    contentNodes: image.contentNodes?.map((node) => normalizeDocNode(node, context))
  };
}

function normalizeTableCellContent(node: TableCellContentNode, context: NormalizeContext): TableCellContentNode {
  return normalizeDocNode(node, context) as TableCellContentNode;
}

function normalizeDocNode(node: DocNode, context: NormalizeContext): DocNode {
  const { invalidated } = context;
  if (node.type === "paragraph") {
    const children = node.children.map((child) => normalizeParagraphChild(child, context));
    const stateChanged = invalidated.size > 0 && children.some((child) => invalidated.has(child));
    const normalized = {
      ...node,
      reviewContent: node.reviewContent?.map((fragment) => ({
        ...fragment,
        children: fragment.children.map((child) => normalizeParagraphChild(child, context)),
      })),
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
      nodes: cell.nodes.map((content) => normalizeTableCellContent(content, context))
    }))
  }));
  const stateChanged = invalidated.size > 0 && rows.some((row) => row.cells.some((cell) => cell.nodes.some((content) => invalidated.has(content))));
  const normalized = {
    ...node,
    reviewRows: node.reviewRows?.map((fragment) => ({
      ...fragment,
      row: (normalizeDocNode({ type: "table", rows: [fragment.row] }, context) as typeof node).rows[0],
    })),
    ...(stateChanged ? { sourceXml: undefined, sourceTextPatches: undefined } : {}),
    rows
  };
  if (stateChanged) invalidated.add(normalized);
  return normalized;
}

export function normalizeDocModel(model: DocModel): DocModel {
  const context: NormalizeContext = {
    invalidated: new Set<object>(),
    fillImageSources: isOpenDocumentModel(model),
  };
  const normalize = (node: DocNode): DocNode => normalizeDocNode(node, context);
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
