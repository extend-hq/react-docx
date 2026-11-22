import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  importDocxBuffer,
  type DocxImportOptions,
  type DocxImportResult,
  type DocxImportWorkerMessage,
  type DocxImportWorkerRequest,
} from "../../packages/react-viewer/src/docx-import";
import { createZip } from "./helpers/zip";

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

function docxBytes(): ArrayBuffer {
  return createZip([
    { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
    { name: "_rels/.rels", content: ROOT_RELATIONSHIPS_XML },
    { name: "word/document.xml", content: DOCUMENT_XML },
  ]);
}

/** A worker that is constructed fine and then does only what the test says. */
class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  readonly posted: DocxImportWorkerRequest[] = [];
  terminated = false;

  constructor() {
    super();
    FakeWorker.instances.push(this);
  }

  postMessage(request: DocxImportWorkerRequest, transfer: Transferable[] = []): void {
    this.posted.push(request);
    if (transfer.length > 0) {
      // Detach the caller's buffer, as a real transfer does.
      structuredClone(request.buffer, { transfer });
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  /** The script could not be fetched or evaluated. */
  failToLoad(): void {
    this.dispatchEvent(Object.assign(new Event("error"), { message: "" }));
  }

  crash(message: string): void {
    this.dispatchEvent(Object.assign(new Event("error"), { message }));
  }

  send(message: DocxImportWorkerMessage): void {
    this.dispatchEvent(new MessageEvent("message", { data: message }));
  }
}

function startImport(
  buffer: ArrayBuffer,
  options: DocxImportOptions
): { worker: FakeWorker; result: Promise<DocxImportResult> } {
  const result = importDocxBuffer(buffer, options);
  // Keep a rejection from being reported before the test asserts on it.
  result.catch(() => undefined);
  expect(FakeWorker.instances).toHaveLength(1);
  return { worker: FakeWorker.instances[0]!, result };
}

const FALLBACK_MODES = [undefined, true] as const;

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("import worker that fails to load", () => {
  describe.each(FALLBACK_MODES)("with useWorker: %s", (useWorker) => {
    it("parses on the main thread", async () => {
      const { worker, result } = startImport(docxBytes(), { useWorker });
      worker.failToLoad();

      const imported = await result;
      expect(imported.source).toBe("main-thread");
      expect(imported.model.nodes.length).toBeGreaterThan(0);
      expect(worker.terminated).toBe(true);
    });

    it("keeps a buffer it may transfer until the worker has loaded", async () => {
      const buffer = docxBytes();
      const byteLength = buffer.byteLength;
      const { worker, result } = startImport(buffer, {
        useWorker,
        transferBuffer: true,
      });
      expect(worker.posted).toHaveLength(0);
      worker.failToLoad();

      const imported = await result;
      expect(worker.posted).toHaveLength(0);
      expect(buffer.byteLength).toBe(byteLength);
      expect(imported.source).toBe("main-thread");
    });

    it("transfers the buffer once the worker has loaded", async () => {
      const reference = await importDocxBuffer(docxBytes(), { useWorker: false });
      const buffer = docxBytes();
      const { worker, result } = startImport(buffer, {
        useWorker,
        transferBuffer: true,
      });
      worker.send({ type: "ready" });
      expect(worker.posted).toHaveLength(1);
      expect(buffer.byteLength).toBe(0);

      worker.send({
        id: worker.posted[0]!.id,
        type: "success",
        package: reference.package,
        model: reference.model,
        timings: { totalMs: 1, parseMs: 1, buildModelMs: 0 },
      });
      await expect(result).resolves.toMatchObject({ source: "worker" });
    });

    it("posts a buffer it keeps without waiting for the worker", () => {
      const { worker } = startImport(docxBytes(), { useWorker });
      expect(worker.posted).toHaveLength(1);
      worker.send({ type: "ready" });
      expect(worker.posted).toHaveLength(1);
    });

    it("does not parse again when the loaded worker reports a parse error", async () => {
      const { worker, result } = startImport(docxBytes(), { useWorker });
      worker.send({ type: "ready" });
      worker.send({
        id: worker.posted[0]!.id,
        type: "error",
        error: { name: "SyntaxError", message: "Not a DOCX package" },
      });

      await expect(result).rejects.toMatchObject({
        name: "SyntaxError",
        message: "Not a DOCX package",
      });
    });

    it("does not parse again when the loaded worker crashes", async () => {
      const { worker, result } = startImport(docxBytes(), { useWorker });
      worker.send({ type: "ready" });
      worker.crash("out of memory");

      await expect(result).rejects.toThrow("out of memory");
    });

    it("stops waiting for the worker when the import is aborted", async () => {
      const controller = new AbortController();
      const { worker, result } = startImport(docxBytes(), {
        useWorker,
        transferBuffer: true,
        signal: controller.signal,
      });
      controller.abort();

      await expect(result).rejects.toMatchObject({ name: "AbortError" });
      expect(worker.terminated).toBe(true);
      expect(worker.posted).toHaveLength(0);
    });

    it("honors an abort that arrives with the load failure", async () => {
      const controller = new AbortController();
      const { worker, result } = startImport(docxBytes(), {
        useWorker,
        signal: controller.signal,
      });
      worker.failToLoad();
      controller.abort();

      await expect(result).rejects.toMatchObject({ name: "AbortError" });
    });
  });

  describe('with useWorker: "required"', () => {
    it("rejects without parsing on the main thread", async () => {
      const { worker, result } = startImport(docxBytes(), {
        useWorker: "required",
      });
      worker.failToLoad();

      await expect(result).rejects.toThrow("DOCX import worker failed");
      expect(worker.terminated).toBe(true);
    });

    it("still transfers the buffer immediately", () => {
      const buffer = docxBytes();
      const { worker } = startImport(buffer, {
        useWorker: "required",
        transferBuffer: true,
      });
      expect(worker.posted).toHaveLength(1);
      expect(buffer.byteLength).toBe(0);
    });
  });
});
