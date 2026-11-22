import type { DocModel, DocxParseOptions } from "@extend-ai/react-docx-doc-model";
import type { OoxmlPackage } from "@extend-ai/react-docx-ooxml-core";
import {
  canUseConfiguredWasmSourceInWorker,
  getConfiguredWorkerWasmSource,
  type WorkerWasmSource
} from "./wasm-source";

export interface DocxImportResult {
  package: OoxmlPackage;
  model: DocModel;
  source: "worker" | "main-thread";
  timings?: DocxImportWorkerTimings;
}

export interface DocxImportOptions extends DocxParseOptions {
  signal?: AbortSignal;
  transferBuffer?: boolean;
  useWorker?: boolean | "required";
}

export interface DocxImportWorkerTimings {
  totalMs: number;
  parseMs: number;
  buildModelMs: number;
}

export interface DocxImportWorkerRequest {
  id: number;
  type: "import-docx";
  buffer: ArrayBuffer;
  wasmSource?: WorkerWasmSource;
  parseOptions?: DocxParseOptions;
}

export interface DocxImportWorkerSuccessResponse {
  id: number;
  type: "success";
  package: OoxmlPackage;
  model: DocModel;
  timings: DocxImportWorkerTimings;
}

export interface DocxImportWorkerErrorResponse {
  id: number;
  type: "error";
  error: {
    name?: string;
    message: string;
    stack?: string;
  };
}

export type DocxImportWorkerResponse =
  | DocxImportWorkerSuccessResponse
  | DocxImportWorkerErrorResponse;

/** Posted once by the worker when its script and imports have loaded. */
export interface DocxImportWorkerReadyMessage {
  type: "ready";
}

export type DocxImportWorkerMessage =
  | DocxImportWorkerReadyMessage
  | DocxImportWorkerResponse;

const WORKER_DID_NOT_START = Symbol("docx-import-worker-did-not-start");

let nextImportWorkerRequestId = 1;

function createAbortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("DOCX import was aborted", "AbortError");
  }
  const error = new Error("DOCX import was aborted");
  error.name = "AbortError";
  return error;
}

function errorFromWorkerResponse(
  response: DocxImportWorkerErrorResponse
): Error {
  const error = new Error(response.error.message);
  error.name = response.error.name ?? "Error";
  if (response.error.stack) {
    error.stack = response.error.stack;
  }
  return error;
}

function canUseDocxImportWorker(options: DocxImportOptions): boolean {
  return (
    options.useWorker !== false &&
    typeof Worker !== "undefined" &&
    canUseConfiguredWasmSourceInWorker()
  );
}

function createDocxImportWorker(): Worker {
  return new Worker(new URL("./docx-import-worker.js", import.meta.url), {
    type: "module",
    name: "react-docx-import",
  });
}

async function importDocxOnMainThread(
  buffer: ArrayBuffer,
  options: DocxImportOptions
): Promise<DocxImportResult> {
  const { signal } = options;
  if (signal?.aborted) {
    throw createAbortError();
  }

  const startedAt = performanceNow();
  const { buildDocModelFromBytes, ensureDocModelBlockIds } = await import(
    "@extend-ai/react-docx-doc-model"
  );
  if (signal?.aborted) {
    throw createAbortError();
  }

  const result = await buildDocModelFromBytes(buffer, { include3dModels: options.include3dModels });
  const model = ensureDocModelBlockIds(result.model);
  const finishedAt = performanceNow();
  if (signal?.aborted) {
    throw createAbortError();
  }

  return {
    package: result.package,
    model,
    source: "main-thread",
    timings: {
      totalMs: finishedAt - startedAt,
      parseMs: result.timings.parseMs,
      buildModelMs: result.timings.buildModelMs,
    },
  };
}

function performanceNow(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export async function importDocxBuffer(
  buffer: ArrayBuffer,
  options: DocxImportOptions = {}
): Promise<DocxImportResult> {
  if (options.signal?.aborted) {
    throw createAbortError();
  }

  if (!canUseDocxImportWorker(options)) {
    if (options.useWorker === "required") {
      throw new Error("DOCX import requires a Web Worker and a worker-compatible WASM source");
    }
    return importDocxOnMainThread(buffer, options);
  }

  let worker: Worker;
  try {
    worker = createDocxImportWorker();
  } catch (error) {
    if (options.useWorker === "required") {
      throw new Error("Unable to start the DOCX import worker", { cause: error });
    }
    return importDocxOnMainThread(buffer, options);
  }

  const requestId = nextImportWorkerRequestId;
  nextImportWorkerRequestId += 1;

  const mayFallBack = options.useWorker !== "required";
  const transfer = options.transferBuffer ? [buffer] : [];
  // A transferred buffer is detached on this thread, which would leave nothing
  // to parse if the worker then failed to start. Hold it until the worker has
  // loaded whenever a fallback is allowed.
  const postWhenReady = mayFallBack && transfer.length > 0;

  const workerResult = new Promise<
    DocxImportResult | typeof WORKER_DID_NOT_START
  >((resolve, reject) => {
    let settled = false;
    let workerReady = false;
    let requestPosted = false;

    const cleanup = (): void => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      worker.removeEventListener("messageerror", handleMessageError);
      options.signal?.removeEventListener("abort", handleAbort);
      worker.terminate();
    };

    const settle = (
      resolver: () => void
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolver();
    };

    const handleAbort = (): void => {
      settle(() => reject(createAbortError()));
    };

    const handleError = (event: ErrorEvent): void => {
      // The constructor only throws for some startup failures. A script that
      // cannot be fetched or evaluated is reported here, before "ready".
      if (mayFallBack && !workerReady) {
        settle(() => resolve(WORKER_DID_NOT_START));
        return;
      }
      const message = event.message || "DOCX import worker failed";
      settle(() => reject(new Error(message)));
    };

    const handleMessageError = (): void => {
      settle(() => reject(new Error("DOCX import worker returned an unreadable response")));
    };

    const postRequest = (): void => {
      if (requestPosted) {
        return;
      }
      requestPosted = true;
      try {
        const request: DocxImportWorkerRequest = {
          id: requestId,
          type: "import-docx",
          buffer,
          wasmSource: getConfiguredWorkerWasmSource(),
          parseOptions: { include3dModels: options.include3dModels },
        };
        worker.postMessage(request, transfer);
      } catch (error) {
        settle(() =>
          reject(error instanceof Error ? error : new Error("Failed to start DOCX import worker"))
        );
      }
    };

    const handleMessage = (
      event: MessageEvent<DocxImportWorkerMessage>
    ): void => {
      const response = event.data;
      if (!response) {
        return;
      }
      if (response.type === "ready") {
        workerReady = true;
        postRequest();
        return;
      }
      if (response.id !== requestId) {
        return;
      }

      if (response.type === "error") {
        settle(() => reject(errorFromWorkerResponse(response)));
        return;
      }

      settle(() =>
        resolve({
          package: response.package,
          model: response.model,
          source: "worker",
          timings: response.timings,
        })
      );
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    worker.addEventListener("messageerror", handleMessageError);
    options.signal?.addEventListener("abort", handleAbort, { once: true });

    if (!postWhenReady) {
      postRequest();
    }
  });

  const result = await workerResult;
  if (result === WORKER_DID_NOT_START) {
    return importDocxOnMainThread(buffer, options);
  }
  // Block ids are assigned on the main thread so the allocation counter is
  // shared with editor ops that create nodes later.
  const { ensureDocModelBlockIds } = await import(
    "@extend-ai/react-docx-doc-model"
  );
  ensureDocModelBlockIds(result.model);
  return result;
}
