import {
  extractDocumentReviewSync,
  type DocModel, type DocNode, type ParagraphNode, type TableNode,
  type DocumentReview, type DocumentRevision, type DocumentComment, type WordProperty,
} from "@extend-ai/react-docx-doc-model";
import { initWasm, wasmReviewReady } from "@extend-ai/react-docx-wasm";

export type ReviewChangeKind = "insertion" | "deletion" | "move-from" | "move-to" | "format-change" | "paragraph-format-change";
export interface ParagraphReview {
  containerRevision?: DocumentRevision;
  revisions: DocumentRevision[];
  comments: { comment: DocumentComment; childStart: number; childEnd: number }[];
}
const documents = new WeakMap<DocModel, DocumentReview>();
const paragraphs = new WeakMap<ParagraphNode, ParagraphReview>();
const paragraphSources = new Map<string, ParagraphReview>();
const tables = new WeakMap<TableNode, DocumentRevision[]>();
const emptyParagraph: ParagraphReview = { revisions: [], comments: [] };
const emptyReview: DocumentReview = { schemaVersion: 1, revisions: [], comments: [] };
const emptyMetadata: DocModel["metadata"] = { sourceParts: 0, warnings: [], headerSections: [], footerSections: [], paragraphStyles: [] };

function paragraphKey(p: ParagraphNode): string {
  return `${p.blockId ?? ""}\0${p.sourceXml ?? ""}\0${p.children.map(c => c.type === "text" ? c.text : c.type).join("\0")}`;
}

export function documentReview(model: DocModel): DocumentReview {
  const cached = documents.get(model);
  if (cached) return cached;
  if (!wasmReviewReady() && typeof window !== "undefined") return emptyReview;
  const review = extractDocumentReviewSync(model);
  const byId = new Map<string, DocNode>();
  const allParagraphs: ParagraphNode[] = [];
  const walk = (nodes: readonly DocNode[], root: string): void => {
    nodes.forEach((node, index) => {
      const id = node.blockId ?? `${root}/${index}`;
      byId.set(id, node);
      if (node.type === "paragraph") {
        allParagraphs.push(node);
        paragraphs.set(node, { revisions: [], comments: [] });
        node.children.forEach((child, index) => {
          if (child.type === "image") {
            byId.set(child.blockId ?? `${id}/child/${index}`, node);
            if (child.contentNodes) walk(child.contentNodes, `${child.blockId ?? `${id}/child/${index}`}/content`);
          }
        });
      } else {
        tables.set(node, []);
        node.rows.forEach((row, ri) => row.cells.forEach((cell, ci) => walk(cell.nodes, `${id}/row/${ri}/cell/${ci}`)));
      }
    });
  };
  const root = `docx:${model.metadata.documentId ?? "unsaved"}`;
  const parts = model.metadata.sourcePartNames;
  walk(model.nodes, `${root}/${parts?.document ?? "word/document.xml"}/body`);
  const seen = new Set<string>();
  for (const section of [model.metadata, ...(model.metadata.sections ?? [])]) {
    for (const part of [...section.headerSections, ...section.footerSections]) {
      if (seen.has(part.partName)) continue;
      seen.add(part.partName);
      walk(part.nodes, `${root}/${part.partName}`);
    }
  }
  for (const [kind, notes] of [["footnote", model.metadata.footnotes], ["endnote", model.metadata.endnotes], ["comment", model.metadata.comments]] as const) {
    for (const note of notes ?? []) if (note.nodes) walk(note.nodes, `${root}/${parts?.[`${kind}s`] ?? `word/${kind}s.xml`}/${kind}/${note.id}`);
  }
  for (const revision of review.revisions) {
    const visited = new Set<DocNode>();
    for (const source of revision.sourceRefs) {
      let node = byId.get(source.nodeId);
      if (!node) {
        let id = source.nodeId;
        while (!node && id.includes("/")) { id = id.slice(0, id.lastIndexOf("/")); node = byId.get(id); }
      }
      if (!node || visited.has(node)) continue;
      visited.add(node);
      if (node.type === "paragraph") paragraphs.get(node)!.revisions.push(revision);
      else tables.get(node)!.push(revision);
    }
  }
  for (const comment of review.comments) {
    for (const target of comment.targets) {
      const node = byId.get(target.nodeId);
      if (node?.type === "paragraph") paragraphs.get(node)!.comments.push({ comment, childStart: target.childStart, childEnd: target.childEnd });
    }
  }
  for (const p of allParagraphs) {
    paragraphSources.set(paragraphKey(p), paragraphs.get(p)!);
  }
  while (paragraphSources.size > 2048) paragraphSources.delete(paragraphSources.keys().next().value!);
  documents.set(model, review);
  return review;
}

export async function initializeDocumentReview(): Promise<void> {
  await initWasm();
}

export { wasmReviewReady as documentReviewReady };

export function paragraphReview(paragraph: ParagraphNode): ParagraphReview {
  const cached = paragraphs.get(paragraph) ?? paragraphSources.get(paragraphKey(paragraph));
  if (cached) return cached;
  if (!paragraph.sourceXml) return emptyParagraph;
  documentReview({ nodes: [paragraph], metadata: emptyMetadata });
  return paragraphs.get(paragraph) ?? emptyParagraph;
}

export function tableRevisions(table: TableNode): DocumentRevision[] {
  return tables.get(table) ?? [];
}

export function reviewChangeKind(revision: DocumentRevision): ReviewChangeKind {
  switch (revision.kind) {
    case "move_from": return "move-from";
    case "move_to": return "move-to";
    case "formatting": return revision.scope === "text" ? "format-change" : "paragraph-format-change";
    case "cell_merge": return "paragraph-format-change";
    default: return revision.kind;
  }
}

export function reviewChangeText(revision: DocumentRevision): string | undefined {
  if (revision.kind === "cell_merge") return "Cell merge";
  if (revision.kind !== "formatting") {
    if (revision.text?.trim()) return revision.text;
    const text: string[] = [];
    const visit = (nodes: DocNode[]) => nodes.forEach(node => {
      if (node.type === "paragraph") text.push(node.children.map(c => c.type === "text" ? c.text : c.type === "image" ? "[image]" : c.value ?? "").join(""));
      else node.rows.forEach(row => row.cells.forEach(cell => visit(cell.nodes)));
    });
    visit(revision.content ?? []);
    return text.filter(Boolean).join(" ") || (revision.scope === "paragraph_mark" ? "Paragraph mark" : revision.scope.replaceAll("_", " "));
  }
  const labels: Record<string, string> = {
    "w:rFonts": "font", "w:sz": "size", "w:color": "color", "w:highlight": "highlight",
    "w:b": "bold", "w:bCs": "bold", "w:i": "italic", "w:iCs": "italic", "w:u": "underline",
    "w:strike": "strikethrough", "w:vertAlign": "baseline", "w:ind": "margins/indent",
    "w:spacing": "line spacing", "w:jc": "alignment", "w:tabs": "tabs", "w:numPr": "numbering",
    "w:pBdr": "borders", "w:shd": "shading", "w:rPr": "text style", "w:tblW": "width",
    "w:tcW": "width", "w:gridSpan": "width", "w:tblLayout": "layout", "w:tblInd": "indent",
    "w:tblCellMar": "margins", "w:tcMar": "margins", "w:tblBorders": "borders", "w:tcBorders": "borders",
    "w:trBorders": "borders", "w:trHeight": "row height", "w:vAlign": "vertical align",
  };
  const features = new Set<string>();
  const visit = (properties: WordProperty[]) => properties.forEach(property => {
    if (labels[property.name]) features.add(labels[property.name]);
    visit(property.children ?? []);
  });
  visit(revision.properties?.before ?? []);
  visit(revision.properties?.after ?? []);
  const names: Record<DocumentRevision["scope"], string> = { text: "Run", paragraph: "Paragraph", paragraph_mark: "Paragraph mark", section: "Section", table: "Table", table_grid: "Table grid", table_row: "Row", table_cell: "Cell" };
  const prefix = `${names[revision.scope]} formatting`;
  return features.size ? `${prefix}: ${[...features].join(", ")}` : prefix;
}

const displayDocuments = new WeakMap<DocModel, { model: DocModel; rowIndexes: Map<number, number[]> }>();

export function reviewDisplayModel(model: DocModel): { model: DocModel; rowIndexes: Map<number, number[]> } {
  if (!wasmReviewReady() && typeof window !== "undefined") return { model, rowIndexes: new Map() };
  const cached = displayDocuments.get(model);
  if (cached) return cached;
  const review = documentReview(model);
  const removed = new Map<string, DocumentRevision[]>();
  for (const revision of review.revisions) {
    if (revision.kind !== "deletion" || revision.scope !== "table_row" || revision.sourceIndex === undefined || !revision.content?.length) continue;
    const id = revision.sourceRefs[0]?.nodeId;
    if (id) removed.set(id, [...(removed.get(id) ?? []), revision]);
  }
  const rowIndexes = new Map<number, number[]>();
  const markRemoved = (nodes: DocNode[], revision: DocumentRevision, root: string): DocNode[] => nodes.map((node, index) => {
    const blockId = `${root}/${index}`;
    if (node.type === "paragraph") {
      const paragraph = { ...node, blockId, sourceXml: undefined, reviewContent: undefined };
      const data: ParagraphReview = { revisions: [], comments: [], containerRevision: revision };
      paragraphs.set(paragraph, data);
      paragraphSources.set(paragraphKey(paragraph), data);
      return paragraph;
    }
    return { ...node, blockId, sourceXml: undefined, reviewRows: undefined, rows: node.rows.map((row, ri) => ({ ...row,
      cells: row.cells.map((cell, ci) => ({ ...cell, nodes: markRemoved(cell.nodes, revision, `${blockId}/row/${ri}/cell/${ci}`) })),
    })) };
  });
  const project = (node: DocNode, topIndex?: number): DocNode => {
    if (node.type === "paragraph") return node;
    let changed = false;
    const rows = node.rows.map(row => ({ ...row, cells: row.cells.map(cell => {
      const nodes = cell.nodes.map(n => project(n));
      if (nodes.some((n, i) => n !== cell.nodes[i])) changed = true;
      return { ...cell, nodes };
    }) }));
    const indexes = rows.map((_, index) => index);
    for (const revision of (removed.get(node.blockId ?? "") ?? []).sort((a, b) => a.sourceIndex! - b.sourceIndex!)) {
      const table = revision.content?.find((n): n is TableNode => n.type === "table");
      const row = table?.rows[0];
      if (!row) continue;
      const index = Math.min(revision.sourceIndex!, rows.length);
      rows.splice(index, 0, { ...row, cells: row.cells.map((cell, ci) => ({ ...cell,
        nodes: markRemoved(cell.nodes, revision, `${revision.id}/content/cell/${ci}`),
      })) });
      indexes.forEach((value, i) => { if (value >= index) indexes[i]++; });
      changed = true;
    }
    if (!changed) return node;
    if (topIndex !== undefined) rowIndexes.set(topIndex, indexes);
    return { ...node, rows };
  };
  const nodes = model.nodes.map((node, index) => project(node, index));
  const result = { model: nodes.every((node, i) => node === model.nodes[i]) ? model : { ...model, nodes }, rowIndexes };
  displayDocuments.set(model, result);
  return result;
}
