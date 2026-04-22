/// <reference lib="webworker" />

/**
 * Source-build worker entry.
 *
 * The published package emits `dist/docx-import-worker.js` from the typed
 * worker source. This file gives Vite/Rollup a same-path worker entry while
 * developing from workspace source, so consumers never have to request a
 * missing `.ts` worker file.
 */

import { buildDocModel } from "@extend-ai/react-docx-doc-model";
import { parseDocx } from "@extend-ai/react-docx-ooxml-core";

const workerScope = self;

workerScope.addEventListener("message", async (event) => {
  const data = event.data;
  if (!data || data.type !== "import") {
    return;
  }

  const { requestId, buffer } = data;

  try {
    const pkg = await parseDocx(buffer);
    const model = buildDocModel(pkg);

    workerScope.postMessage({
      type: "imported",
      requestId,
      pkg,
      model,
    });
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      requestId,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});
