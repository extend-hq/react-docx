import {
  wasmExtractDocumentBlocks,
  wasmInspectDocumentSource,
} from "@extend-ai/react-docx-wasm";
import type { DocModel } from "./types";

export const DOCUMENT_BLOCK_TYPES = [
  "text",
  "heading",
  "section_heading",
  "figure",
  "table",
  "table_head",
  "table_cell",
  "key_value",
  "page_number",
  "barcode",
  "formula",
  "header",
  "footer",
  "watermark",
  "legend",
] as const;

export type DocumentBlockType = (typeof DOCUMENT_BLOCK_TYPES)[number];

export interface DocxSourceRef {
  documentId: string;
  nodeId: string;
  partName: string;
  story: string;
  start?: number;
  end?: number;
  offsetEncoding: "utf-16";
}

export interface ExtractDocumentBlocksOptions {
  includeWords?: boolean;
  include3dModels?: boolean;
}

export interface DocumentWord {
  object: "word";
  id: string;
  blockId: string;
  content: string;
  sourceRefs: DocxSourceRef[];
}

export interface DocumentBlock {
  object: "block";
  id: string;
  type: DocumentBlockType;
  content: string;
  details: Record<string, unknown>;
  sourceRefs: DocxSourceRef[];
  parentBlockId?: string;
  children: DocumentBlock[];
  words?: DocumentWord[];
}

export interface StructuredDocument {
  schemaVersion: 1;
  parserVersion: string;
  documentId: string;
  blocks: DocumentBlock[];
  warnings: string[];
  geometryStatus: "requires_layout";
}

export async function extractDocumentBlocks(
  model: DocModel,
  options: ExtractDocumentBlocksOptions = {}
): Promise<StructuredDocument> {
  return (await wasmExtractDocumentBlocks(model, options)) as StructuredDocument;
}

export function flattenDocumentBlocks(
  blocks: readonly DocumentBlock[]
): DocumentBlock[] {
  return blocks.flatMap((block) => [
    block,
    ...flattenDocumentBlocks(block.children),
  ]);
}

export interface SourceElement {
  id: string;
  kind: "document" | "element" | "text" | "comment" | "processing_instruction";
  namespace?: string;
  name?: string;
  text?: string;
  byteStart: number;
  byteEnd: number;
  attributes: Array<{ namespace: string | null; name: string; value: string }>;
  children: SourceElement[];
}

export interface DocumentSourceGraph {
  schemaVersion: 1;
  documentId: string;
  parts: Array<{
    name: string;
    byteLength: number;
    root: SourceElement | null;
    error: string | null;
  }>;
  assets: Array<{ name: string; byteLength: number; root: null; error: null }>;
  warnings: string[];
  preservedFeatures: Array<{
    partName: string;
    feature: string;
    occurrences: number;
    support: "preserved_only" | "approximate_rendering";
  }>;
}

export async function inspectDocumentSource(
  bytes: ArrayBuffer | Uint8Array
): Promise<DocumentSourceGraph> {
  return (await wasmInspectDocumentSource(bytes)) as DocumentSourceGraph;
}
