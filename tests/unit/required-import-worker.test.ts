import { afterEach, describe, expect, it, vi } from "vitest";
import { importDocxBuffer } from "../../packages/react-viewer/src/docx-import";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("required import worker", () => {
  it("rejects without parsing when workers are unavailable", async () => {
    vi.stubGlobal("Worker", undefined);
    await expect(
      importDocxBuffer(new ArrayBuffer(0), { useWorker: "required" })
    ).rejects.toThrow("requires a Web Worker");
  });

  it("preserves worker startup failures without parsing on the main thread", async () => {
    const cause = new Error("Worker construction blocked");
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw cause;
        }
      }
    );
    await expect(
      importDocxBuffer(new ArrayBuffer(0), { useWorker: "required" })
    ).rejects.toMatchObject({
      message: "Unable to start the DOCX import worker",
      cause,
    });
  });

  it("preserves cancellation before worker construction", async () => {
    const controller = new AbortController();
    controller.abort();
    const WorkerConstructor = vi.fn();
    vi.stubGlobal("Worker", WorkerConstructor);
    await expect(
      importDocxBuffer(new ArrayBuffer(0), {
        useWorker: "required",
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(WorkerConstructor).not.toHaveBeenCalled();
  });
});
