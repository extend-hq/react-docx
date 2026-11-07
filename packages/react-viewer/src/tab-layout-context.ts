import type {
  DocModel,
  DocNode,
  ParagraphNode,
  TableCellContentNode,
} from "@extend-ai/react-docx-doc-model";

const DEFAULT_TAB_STOP_TWIPS = 720;
const TWIPS_PER_PIXEL = 15;
const resolvedTabStop = Symbol("resolved-default-tab-stop");
const resolvedWrappedTabRefit = Symbol("resolved-wrapped-tab-refit");
type ContextualNode = {
  [resolvedTabStop]?: number;
  [resolvedWrappedTabRefit]?: boolean;
};
const nodeViews = new WeakMap<object, Map<string, DocNode>>();
const originalNodes = new WeakMap<object, DocNode>();
const documentViews = new WeakMap<DocModel, Map<string, DocModel>>();
const resolvedDocuments = new WeakMap<DocModel, string>();
const metadataViews = new WeakMap<
  DocModel["metadata"],
  Map<string, DocModel["metadata"]>
>();

export function resolveDefaultTabStopPx(defaultTabStopTwips?: number): number {
  return Number.isFinite(defaultTabStopTwips) &&
    (defaultTabStopTwips as number) > 0
    ? (defaultTabStopTwips as number) / TWIPS_PER_PIXEL
    : DEFAULT_TAB_STOP_TWIPS / TWIPS_PER_PIXEL;
}

export function defaultTabStopPxForNode(node: object): number {
  return (node as ContextualNode)[resolvedTabStop] ?? resolveDefaultTabStopPx();
}

export function allowsWrappedLeftTabRefit(node: object): boolean {
  return (node as ContextualNode)[resolvedWrappedTabRefit] !== false;
}

export function tabPositionTwipsToPx(positionTwips?: number): number {
  return (positionTwips ?? Number.NaN) / TWIPS_PER_PIXEL;
}

export function nextDefaultTabStopPx(
  positionPx: number,
  intervalPx: number
): number {
  return (Math.floor((positionPx + 1e-7) / intervalPx) + 1) * intervalPx;
}

function contextualNode(
  node: DocNode,
  intervalPx: number,
  allowWrappedTabRefit = true
): DocNode {
  const contextKey = `${intervalPx}|refit:${allowWrappedTabRefit}`;
  let original = originalNodes.get(node) ?? node;
  if (intervalPx === resolveDefaultTabStopPx() && allowWrappedTabRefit) {
    if ((original as ContextualNode)[resolvedTabStop] !== undefined ||
      (original as ContextualNode)[resolvedWrappedTabRefit] !== undefined) {
      const { [resolvedTabStop]: _interval, [resolvedWrappedTabRefit]: _refit, ...plain } = original as DocNode &
        ContextualNode;
      original = plain;
    }
    if (original.type === "paragraph") return original;
    const table = original;
    const rows = table.rows.map((row) => {
      const cells = row.cells.map((cell) => {
        const children = cell.nodes.map(
          (child): TableCellContentNode =>
            child.type === "paragraph" || child.type === "table"
              ? contextualNode(child, intervalPx, allowWrappedTabRefit)
              : child
        );
        return children.every((child, index) => child === cell.nodes[index])
          ? cell
          : { ...cell, nodes: children };
      });
      return cells.every((cell, index) => cell === row.cells[index])
        ? row
        : { ...row, cells };
    });
    return rows.every((row, index) => row === table.rows[index])
      ? table
      : { ...table, rows };
  }
  let variants = nodeViews.get(original);
  const cached = variants?.get(contextKey);
  if (cached) return cached;
  if (!variants) {
    variants = new Map();
    nodeViews.set(original, variants);
  }
  const next: DocNode & ContextualNode =
    original.type === "paragraph"
      ? { ...original, [resolvedTabStop]: intervalPx, [resolvedWrappedTabRefit]: allowWrappedTabRefit }
      : {
          ...original,
          [resolvedTabStop]: intervalPx,
          [resolvedWrappedTabRefit]: allowWrappedTabRefit,
          rows: original.rows.map((row) => ({
            ...row,
            cells: row.cells.map((cell) => ({
              ...cell,
              nodes: cell.nodes.map(
                (child): TableCellContentNode =>
                  child.type === "paragraph" || child.type === "table"
                    ? contextualNode(child, intervalPx, allowWrappedTabRefit)
                    : child
              ),
            })),
          })),
        };
  variants.set(contextKey, next);
  originalNodes.set(next, original);
  return next;
}

export function paragraphWithDefaultTabStop(
  paragraph: ParagraphNode,
  defaultTabStopTwips: number
): ParagraphNode {
  return contextualNode(
    paragraph,
    resolveDefaultTabStopPx(defaultTabStopTwips),
    allowsWrappedLeftTabRefit(paragraph)
  ) as ParagraphNode;
}

export function documentWithDefaultTabLayout(
  model: DocModel,
  allowBodyWrappedTabRefit = true
): DocModel {
  const intervalPx = resolveDefaultTabStopPx(
    model.metadata.defaultTabStopTwips
  );
  const contextKey = `${intervalPx}|body-refit:${allowBodyWrappedTabRefit}`;
  if (resolvedDocuments.get(model) === contextKey) return model;
  const cached = documentViews.get(model)?.get(contextKey);
  if (cached) return cached;
  const nodes = (values: DocNode[], allowWrappedTabRefit = true) => {
    const next = values.map((node) => contextualNode(node, intervalPx, allowWrappedTabRefit));
    return next.every((node, index) => node === values[index]) ? values : next;
  };
  const sections = <T extends { nodes: DocNode[] }>(values: T[]): T[] => {
    if (!values) return values;
    const next = values.map((section) => {
      const nextNodes = nodes(section.nodes);
      return nextNodes === section.nodes
        ? section
        : { ...section, nodes: nextNodes };
    });
    return next.every((section, index) => section === values[index])
      ? values
      : next;
  };
  const notes = (values: DocModel["metadata"]["footnotes"]) => {
    if (!values) return values;
    const next = values.map((note) => {
      if (!note.nodes) return note;
      const nextNodes = nodes(note.nodes);
      return nextNodes === note.nodes ? note : { ...note, nodes: nextNodes };
    });
    return next.every((note, index) => note === values[index]) ? values : next;
  };
  const metadata = model.metadata;
  const nextNodes = nodes(model.nodes, allowBodyWrappedTabRefit);
  const headerSections = sections(metadata.headerSections);
  const footerSections = sections(metadata.footerSections);
  const resolvedSections = metadata.sections?.map((section) => {
    const headers = sections(section.headerSections);
    const footers = sections(section.footerSections);
    return headers === section.headerSections &&
      footers === section.footerSections
      ? section
      : { ...section, headerSections: headers, footerSections: footers };
  });
  const documentSections = resolvedSections?.every(
    (section, index) => section === metadata.sections?.[index]
  )
    ? metadata.sections
    : resolvedSections;
  const footnotes = notes(metadata.footnotes);
  const endnotes = notes(metadata.endnotes);
  const unchanged =
    intervalPx === resolveDefaultTabStopPx() &&
    allowBodyWrappedTabRefit &&
    nextNodes === model.nodes &&
    headerSections === metadata.headerSections &&
    footerSections === metadata.footerSections &&
    documentSections === metadata.sections &&
    footnotes === metadata.footnotes &&
    endnotes === metadata.endnotes;
  let resolvedMetadata = metadataViews.get(metadata)?.get(contextKey);
  if (!resolvedMetadata) {
    resolvedMetadata = unchanged
      ? metadata
      : {
          ...metadata,
          headerSections,
          footerSections,
          sections: documentSections,
          footnotes,
          endnotes,
        };
    let variants = metadataViews.get(metadata);
    if (!variants) {
      variants = new Map();
      metadataViews.set(metadata, variants);
    }
    variants.set(contextKey, resolvedMetadata);
  }
  const result = unchanged
    ? model
    : { ...model, nodes: nextNodes, metadata: resolvedMetadata };
  let variants = documentViews.get(model);
  if (!variants) {
    variants = new Map();
    documentViews.set(model, variants);
  }
  variants.set(contextKey, result);
  resolvedDocuments.set(result, contextKey);
  return result;
}
