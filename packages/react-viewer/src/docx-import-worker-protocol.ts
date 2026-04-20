/**
 * Message types exchanged between the main thread and the DOCX import
 * worker. Kept in their own module so both sides can import them without
 * pulling the worker's heavy dependencies onto the main thread bundle.
 */

import type { DocModel } from "@extend-ai/react-docx-doc-model";
import type { OoxmlPackage } from "@extend-ai/react-docx-ooxml-core";

export interface DocxImportWorkerImportRequest {
  type: "import";
  requestId: number;
  buffer: ArrayBuffer;
}

export type DocxImportWorkerRequestMessage = DocxImportWorkerImportRequest;

export interface DocxImportWorkerImportedResponse {
  type: "imported";
  requestId: number;
  pkg: OoxmlPackage;
  model: DocModel;
}

export interface DocxImportWorkerErrorResponse {
  type: "error";
  requestId: number;
  message: string;
}

export type DocxImportWorkerResponseMessage =
  | DocxImportWorkerImportedResponse
  | DocxImportWorkerErrorResponse;
