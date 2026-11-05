import { wasmExtractDocumentReview, wasmExtractDocumentReviewSync } from "@extend-ai/react-docx-wasm";
import type { DocxSourceRef } from "./blocks";
import type { DocModel, DocNode } from "./types";

export interface WordProperty {
  name: string;
  attributes?: Record<string, string>;
  children?: WordProperty[];
}

export interface DocumentRevision {
  id: string;
  sourceId?: string;
  kind: "insertion" | "deletion" | "move_from" | "move_to" | "formatting" | "cell_merge";
  scope: "text" | "paragraph_mark" | "paragraph" | "section" | "table" | "table_grid" | "table_row" | "table_cell";
  author?: string;
  date?: string;
  moveName?: string;
  text?: string;
  properties?: { before: WordProperty[]; after: WordProperty[] };
  sourceRefs: DocxSourceRef[];
  content?: DocNode[];
  childStart?: number;
  childEnd?: number;
  sourceIndex?: number;
}

export interface CommentTarget extends DocxSourceRef {
  childStart: number;
  childEnd: number;
}

export interface DocumentComment {
  id: number;
  author?: string | null;
  initials?: string | null;
  date?: string | null;
  text: string;
  parentId?: number | null;
  resolved?: boolean | null;
  blockIds: string[];
  targets: CommentTarget[];
  reference?: DocxSourceRef | null;
}

export interface DocumentReview {
  schemaVersion: 1;
  revisions: DocumentRevision[];
  comments: DocumentComment[];
}

export async function extractDocumentReview(model: DocModel): Promise<DocumentReview> {
  return await wasmExtractDocumentReview(model) as DocumentReview;
}

export function extractDocumentReviewSync(model: DocModel): DocumentReview {
  return wasmExtractDocumentReviewSync(model) as DocumentReview;
}
