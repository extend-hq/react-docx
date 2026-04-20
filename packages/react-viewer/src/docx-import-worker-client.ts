/**
 * Main-thread client for the DOCX import worker.
 *
 * Hides the `new Worker(new URL(...))` construction, message correlation,
 * and graceful fallback to main-thread parsing when Web Workers are not
 * available (SSR, old browsers, or bundlers that do not resolve the
 * worker URL at build time).
 *
 * The client lazily spawns a single worker on first use and reuses it for
 * subsequent imports. Workers are relatively cheap once warmed.
 */

import { buildDocModel, type DocModel } from "@extend-ai/react-docx-doc-model";
import { parseDocx, type OoxmlPackage } from "@extend-ai/react-docx-ooxml-core";

import type {
  DocxImportWorkerImportRequest,
  DocxImportWorkerResponseMessage,
} from "./docx-import-worker-protocol";

export interface DocxImportResult {
  pkg: OoxmlPackage;
  model: DocModel;
}

let cachedWorker: Worker | undefined;
let cachedWorkerUnavailable = false;
let nextRequestId = 1;

function resolveWorker(): Worker | undefined {
  if (cachedWorkerUnavailable) {
    return undefined;
  }

  if (cachedWorker) {
    return cachedWorker;
  }

  if (
    typeof window === "undefined" ||
    typeof Worker === "undefined" ||
    typeof URL === "undefined"
  ) {
    cachedWorkerUnavailable = true;
    return undefined;
  }

  try {
    // `new URL(..., import.meta.url)` is the portable way to reference a
    // worker source. Vite, webpack 5, Rollup, and esbuild all detect this
    // pattern at bundle time and ship the worker as a separate chunk.
    const workerUrl = new URL(
      "./docx-import-worker.ts",
      import.meta.url
    );
    cachedWorker = new Worker(workerUrl, {
      type: "module",
      name: "docx-import",
    });
    return cachedWorker;
  } catch {
    cachedWorkerUnavailable = true;
    cachedWorker = undefined;
    return undefined;
  }
}

async function importDocxOnMainThread(
  buffer: ArrayBuffer
): Promise<DocxImportResult> {
  const pkg = await parseDocx(buffer);
  const model = buildDocModel(pkg);
  return { pkg, model };
}

/**
 * Parse a `.docx` buffer and build its `DocModel` off the main thread.
 *
 * Falls back to running `parseDocx` + `buildDocModel` synchronously on the
 * main thread when a worker cannot be constructed (e.g. server-side
 * rendering). The return shape is identical either way.
 *
 * `buffer` is transferred into the worker — do not reuse it after calling
 * this function.
 */
export async function importDocxViaWorker(
  buffer: ArrayBuffer
): Promise<DocxImportResult> {
  const worker = resolveWorker();
  if (!worker) {
    return importDocxOnMainThread(buffer);
  }

  const requestId = nextRequestId;
  nextRequestId += 1;

  return new Promise<DocxImportResult>((resolve, reject) => {
    const handleMessage = (event: MessageEvent): void => {
      const data = event.data as DocxImportWorkerResponseMessage | undefined;
      if (!data || data.requestId !== requestId) {
        return;
      }

      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      worker.removeEventListener("messageerror", handleMessageError);

      if (data.type === "imported") {
        resolve({ pkg: data.pkg, model: data.model });
      } else {
        reject(new Error(data.message));
      }
    };

    const handleError = (event: ErrorEvent | Event): void => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      worker.removeEventListener("messageerror", handleMessageError);
      const message =
        event instanceof ErrorEvent && event.message
          ? event.message
          : "DOCX import worker crashed";
      // Invalidate the cached worker so the next import starts fresh.
      try {
        worker.terminate();
      } catch {
        // Best-effort termination.
      }
      if (cachedWorker === worker) {
        cachedWorker = undefined;
      }
      reject(new Error(message));
    };

    const handleMessageError = (): void => {
      handleError(new Event("messageerror"));
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    worker.addEventListener("messageerror", handleMessageError);

    const request: DocxImportWorkerImportRequest = {
      type: "import",
      requestId,
      buffer,
    };

    try {
      worker.postMessage(request, [buffer]);
    } catch (error) {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      worker.removeEventListener("messageerror", handleMessageError);
      // Most likely: the buffer couldn't be transferred. Fall back to
      // main thread but warn in the console to aid debugging.
      if (typeof console !== "undefined") {
        console.warn(
          "DOCX import worker postMessage failed; falling back to main thread.",
          error
        );
      }
      importDocxOnMainThread(buffer).then(resolve, reject);
    }
  });
}
