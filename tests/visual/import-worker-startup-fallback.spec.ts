import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { createZip } from "../unit/helpers/zip";

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELATIONSHIPS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Fallback content</w:t></w:r></w:p>
  </w:body>
</w:document>`;

const DOCX_BYTES = Array.from(
  new Uint8Array(
    createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELATIONSHIPS_XML },
      { name: "word/document.xml", content: DOCUMENT_XML },
    ])
  )
);

const MODULE_PATH = `/@fs${path.resolve(
  process.cwd(),
  "packages/react-viewer/src/docx-import.ts"
)}`;

const WORKER_SCRIPT = /docx-import-worker/;

interface ImportOutcome {
  source?: string;
  nodeCount?: number;
  error?: string;
  bufferByteLengthAfter: number;
}

async function importInPage(
  page: Page,
  options: { useWorker?: boolean | "required"; transferBuffer?: boolean }
): Promise<ImportOutcome> {
  return page.evaluate(
    async ({ modulePath, bytes, options }) => {
      const api = await import(modulePath);
      const buffer = new Uint8Array(bytes).buffer;
      try {
        const result = await api.importDocxBuffer(buffer, options);
        return {
          source: result.source,
          nodeCount: result.model.nodes.length,
          bufferByteLengthAfter: buffer.byteLength,
        };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
          bufferByteLengthAfter: buffer.byteLength,
        };
      }
    },
    { modulePath: MODULE_PATH, bytes: DOCX_BYTES, options }
  );
}

/** Serves a 404 for the worker script and reports how often it was requested. */
async function blockWorkerScript(page: Page): Promise<() => number> {
  let requests = 0;
  await page.route(WORKER_SCRIPT, async (route) => {
    requests += 1;
    await route.fulfill({ status: 404, body: "Not found" });
  });
  return () => requests;
}

test.describe("import worker startup", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("imports in the worker and transfers the buffer once it has loaded", async ({
    page,
  }) => {
    const outcome = await importInPage(page, { transferBuffer: true });

    expect(outcome.error).toBeUndefined();
    expect(outcome.source).toBe("worker");
    expect(outcome.nodeCount).toBeGreaterThan(0);
    expect(outcome.bufferByteLengthAfter).toBe(0);
  });

  test("imports in the worker when the worker is required", async ({ page }) => {
    const outcome = await importInPage(page, {
      useWorker: "required",
      transferBuffer: true,
    });

    expect(outcome.error).toBeUndefined();
    expect(outcome.source).toBe("worker");
  });

  for (const transferBuffer of [false, true]) {
    test(`parses on the main thread when the worker script is missing (transferBuffer: ${transferBuffer})`, async ({
      page,
    }) => {
      const workerRequests = await blockWorkerScript(page);

      const outcome = await importInPage(page, { transferBuffer });

      expect(workerRequests()).toBeGreaterThan(0);
      expect(outcome.error).toBeUndefined();
      expect(outcome.source).toBe("main-thread");
      expect(outcome.nodeCount).toBeGreaterThan(0);
      expect(outcome.bufferByteLengthAfter).toBe(DOCX_BYTES.length);
    });
  }

  test("reports an error when a required worker script is missing", async ({
    page,
  }) => {
    const workerRequests = await blockWorkerScript(page);

    const outcome = await importInPage(page, { useWorker: "required" });

    expect(workerRequests()).toBeGreaterThan(0);
    expect(outcome.source).toBeUndefined();
    expect(outcome.error).toBe("DOCX import worker failed");
  });
});
