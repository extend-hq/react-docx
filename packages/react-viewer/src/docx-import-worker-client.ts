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

class DocxImportWorkerTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocxImportWorkerTransportError";
  }
}

function canUseWorker(): boolean {
  if (cachedWorkerUnavailable) {
    return false;
  }

  if (
    typeof window === "undefined" ||
    typeof Worker === "undefined" ||
    typeof URL === "undefined"
  ) {
    cachedWorkerUnavailable = true;
    return false;
  }

  return true;
}

function createWorker(): Worker | undefined {
  if (!canUseWorker()) {
    return undefined;
  }

  try {
    // Keep this exact static shape so Vite/Rollup recognize and bundle the
    // worker source. The package build emits the same path into `dist/`, so
    // downstream apps can load the worker from npm without source TS.
    return new Worker(new URL("./docx-import-worker.js", import.meta.url), {
      type: "module",
      name: "docx-import",
    });
  } catch {
    cachedWorker = undefined;
    return undefined;
  }
}

function resolveWorker(): Worker | undefined {
  if (cachedWorker) {
    return cachedWorker;
  }

  const worker = createWorker();
  if (!worker) {
    return undefined;
  }

  cachedWorker = worker;
  return cachedWorker;
}

async function importDocxOnMainThread(
  buffer: ArrayBuffer
): Promise<DocxImportResult> {
  const pkg = await parseDocx(buffer);
  const model = buildDocModel(pkg);
  return { pkg, model };
}

function invalidateWorker(worker: Worker): void {
  try {
    worker.terminate();
  } catch {
    // Best-effort termination.
  }
  if (cachedWorker === worker) {
    cachedWorker = undefined;
  }
}

function warnWorkerFallback(reason: unknown): void {
  if (typeof console === "undefined") {
    return;
  }

  console.warn(
    "DOCX import worker failed; falling back to main thread parsing.",
    reason
  );
}

function importDocxWithWorker(
  worker: Worker,
  buffer: ArrayBuffer
): Promise<DocxImportResult> {
  const requestId = nextRequestId;
  nextRequestId += 1;

  return new Promise<DocxImportResult>((resolve, reject) => {
    const cleanup = (): void => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      worker.removeEventListener("messageerror", handleMessageError);
    };

    const handleMessage = (event: MessageEvent): void => {
      const data = event.data as DocxImportWorkerResponseMessage | undefined;
      if (!data || data.requestId !== requestId) {
        return;
      }

      cleanup();

      if (data.type === "imported") {
        resolve({ pkg: data.pkg, model: data.model });
      } else {
        reject(new Error(data.message));
      }
    };

    const handleError = (event: ErrorEvent | Event): void => {
      cleanup();
      const message =
        event instanceof ErrorEvent && event.message
          ? event.message
          : "DOCX import worker crashed";
      invalidateWorker(worker);
      reject(new DocxImportWorkerTransportError(message));
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
      // Do not transfer/detach the buffer here. Keeping the main-thread copy
      // lets us retry a packaged worker URL or fall back to main-thread parsing
      // if a production host fails to load the worker chunk.
      worker.postMessage(request);
    } catch (error) {
      cleanup();
      invalidateWorker(worker);
      reject(
        new DocxImportWorkerTransportError(
          error instanceof Error ? error.message : "DOCX import worker failed"
        )
      );
    }
  });
}

/**
 * Parse a `.docx` buffer and build its `DocModel` off the main thread.
 *
 * Falls back to running `parseDocx` + `buildDocModel` synchronously on the
 * main thread when a worker cannot be constructed (e.g. server-side
 * rendering). The return shape is identical either way.
 *
 * The worker message keeps a main-thread copy of `buffer` so production
 * builds can recover if a host fails to load the worker chunk.
 */
export async function importDocxViaWorker(
  buffer: ArrayBuffer
): Promise<DocxImportResult> {
  const worker = resolveWorker();
  if (!worker) {
    return importDocxOnMainThread(buffer);
  }

  try {
    return await importDocxWithWorker(worker, buffer);
  } catch (error) {
    if (!(error instanceof DocxImportWorkerTransportError)) {
      throw error;
    }

    warnWorkerFallback(error);
    cachedWorkerUnavailable = true;
    cachedWorker = undefined;
    return importDocxOnMainThread(buffer);
  }
}
