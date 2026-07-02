import type { DocModel } from "@extend-ai/react-docx-doc-model";
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

export interface DocxImportOptions {
  signal?: AbortSignal;
  transferBuffer?: boolean;
  useWorker?: boolean;
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
  signal?: AbortSignal
): Promise<DocxImportResult> {
  if (signal?.aborted) {
    throw createAbortError();
  }

  const startedAt = performanceNow();
  const [{ parseDocx }, { buildDocModel, ensureDocModelBlockIds }] =
    await Promise.all([
      import("@extend-ai/react-docx-ooxml-core"),
      import("@extend-ai/react-docx-doc-model"),
    ]);
  const pkg = await parseDocx(buffer);
  const parsedAt = performanceNow();
  if (signal?.aborted) {
    throw createAbortError();
  }

  const model = ensureDocModelBlockIds(await buildDocModel(pkg));
  const finishedAt = performanceNow();
  if (signal?.aborted) {
    throw createAbortError();
  }

  return {
    package: pkg,
    model,
    source: "main-thread",
    timings: {
      totalMs: finishedAt - startedAt,
      parseMs: parsedAt - startedAt,
      buildModelMs: finishedAt - parsedAt,
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
    return importDocxOnMainThread(buffer, options.signal);
  }

  let worker: Worker;
  try {
    worker = createDocxImportWorker();
  } catch {
    return importDocxOnMainThread(buffer, options.signal);
  }

  const requestId = nextImportWorkerRequestId;
  nextImportWorkerRequestId += 1;

  const workerResult = new Promise<DocxImportResult>((resolve, reject) => {
    let settled = false;

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
      const message = event.message || "DOCX import worker failed";
      settle(() => reject(new Error(message)));
    };

    const handleMessageError = (): void => {
      settle(() => reject(new Error("DOCX import worker returned an unreadable response")));
    };

    const handleMessage = (
      event: MessageEvent<DocxImportWorkerResponse>
    ): void => {
      const response = event.data;
      if (!response || response.id !== requestId) {
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

    try {
      const request: DocxImportWorkerRequest = {
        id: requestId,
        type: "import-docx",
        buffer,
        wasmSource: getConfiguredWorkerWasmSource(),
      };
      const transfer = options.transferBuffer ? [buffer] : [];
      worker.postMessage(request, transfer);
    } catch (error) {
      settle(() =>
        reject(error instanceof Error ? error : new Error("Failed to start DOCX import worker"))
      );
    }
  });

  const result = await workerResult;
  // Block ids are assigned on the main thread so the allocation counter is
  // shared with editor ops that create nodes later.
  const { ensureDocModelBlockIds } = await import(
    "@extend-ai/react-docx-doc-model"
  );
  ensureDocModelBlockIds(result.model);
  return result;
}
