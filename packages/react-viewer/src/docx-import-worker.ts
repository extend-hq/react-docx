import { buildDocModel } from "@extend-ai/react-docx-doc-model";
import { parseDocx } from "@extend-ai/react-docx-ooxml-core";

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
      const startedAt = performanceNow();
      const pkg = await parseDocx(request.buffer);
      const parsedAt = performanceNow();
      const model = await buildDocModel(pkg);
      const finishedAt = performanceNow();
      const timings: DocxImportWorkerTimings = {
        totalMs: finishedAt - startedAt,
        parseMs: parsedAt - startedAt,
        buildModelMs: finishedAt - parsedAt,
      };
      const response: DocxImportWorkerResponse = {
        id: request.id,
        type: "success",
        package: pkg,
        model,
        timings,
      };
      self.postMessage(response);
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

