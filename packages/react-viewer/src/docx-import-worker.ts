/// <reference lib="webworker" />

/**
 * DOCX import worker.
 *
 * Runs the CPU-heavy `parseDocx` + `buildDocModel` work off the main thread
 * so the UI stays responsive while a large document is loading. The main
 * thread handles font loading (which requires DOM access) separately.
 *
 * Protocol:
 *   main -> worker: { type: "import", requestId, buffer: ArrayBuffer }
 *   worker -> main: { type: "imported", requestId, pkg, model }
 *                 | { type: "error",    requestId, message }
 *
 * The `buffer` is transferred (not copied). `pkg` contains only plain
 * objects plus `Map<string, OoxmlPart>` / `Map<string, Uint8Array>` which
 * are structured-cloneable; the `model` is a plain JS tree.
 */

import { buildDocModel } from "@extend-ai/react-docx-doc-model";
import { parseDocx } from "@extend-ai/react-docx-ooxml-core";

import type {
  DocxImportWorkerRequestMessage,
  DocxImportWorkerResponseMessage,
} from "./docx-import-worker-protocol";

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.addEventListener("message", async (event: MessageEvent) => {
  const data = event.data as DocxImportWorkerRequestMessage | undefined;
  if (!data || data.type !== "import") {
    return;
  }

  const { requestId, buffer } = data;

  try {
    const pkg = await parseDocx(buffer);
    const model = buildDocModel(pkg);

    const response: DocxImportWorkerResponseMessage = {
      type: "imported",
      requestId,
      pkg,
      model,
    };
    workerScope.postMessage(response);
  } catch (error) {
    const response: DocxImportWorkerResponseMessage = {
      type: "error",
      requestId,
      message: error instanceof Error ? error.message : "Unknown error",
    };
    workerScope.postMessage(response);
  }
});
