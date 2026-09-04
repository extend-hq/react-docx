import { buildDocModelFromBytes } from "@extend-ai/react-docx-doc-model";
import { setWasmSource } from "@extend-ai/react-docx-wasm";
import { collectImportTransferables } from "./import-transferables";

import type {
  DocxImportWorkerRequest,
  DocxImportWorkerResponse,
  DocxImportWorkerTimings,
} from "./docx-import";

function performanceNow(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function serializeError(error: unknown): {
  name?: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

self.addEventListener(
  "message",
  async (event: MessageEvent<DocxImportWorkerRequest>) => {
    const request = event.data;
    if (!request || request.type !== "import-docx") {
      return;
    }

    try {
      if (request.wasmSource !== undefined) {
        setWasmSource(request.wasmSource);
      }
      const startedAt = performanceNow();
      const result = await buildDocModelFromBytes(request.buffer);
      const finishedAt = performanceNow();
      const timings: DocxImportWorkerTimings = {
        totalMs: finishedAt - startedAt,
        parseMs: result.timings.parseMs,
        buildModelMs: result.timings.buildModelMs,
      };
      const response: DocxImportWorkerResponse = {
        id: request.id,
        type: "success",
        package: result.package,
        model: result.model,
        timings,
      };
      self.postMessage(response, {
        transfer: collectImportTransferables(response),
      });
    } catch (error) {
      const response: DocxImportWorkerResponse = {
        id: request.id,
        type: "error",
        error: serializeError(error),
      };
      self.postMessage(response);
    }
  }
);
