import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Effect = () => void | (() => void);

const mocks = vi.hoisted(() => ({
  importDocxBuffer: vi.fn(),
  canUseConfiguredWasmSourceInWorker: vi.fn(() => true),
  effects: [] as Array<{ effect: Effect; deps?: readonly unknown[] }>,
}));

// Server rendering never runs effects. Collect them so the import effect in
// useDocxModel can be run by hand.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: Effect, deps?: readonly unknown[]) => {
    mocks.effects.push({ effect, deps });
  },
}));

vi.mock("../../packages/react-viewer/src/docx-import", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../packages/react-viewer/src/docx-import")>();
  mocks.importDocxBuffer.mockImplementation(actual.importDocxBuffer);
  return { ...actual, importDocxBuffer: mocks.importDocxBuffer };
});

vi.mock("../../packages/react-viewer/src/wasm-source", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/react-viewer/src/wasm-source")>()),
  canUseConfiguredWasmSourceInWorker: mocks.canUseConfiguredWasmSourceInWorker,
}));

import {
  useDocxEditor,
  type DocxEditorController,
  type UseDocxEditorOptions,
} from "../../packages/react-viewer/src/editor";
import {
  useDocxModel,
  type UseDocxModelOptions,
} from "../../packages/react-viewer/src/index";

type WorkerMode = UseDocxEditorOptions["useWorker"];

const STOP = new Error("stop after recording the import options");

function captureEditor(options?: UseDocxEditorOptions): DocxEditorController {
  let controller: DocxEditorController | undefined;
  renderToStaticMarkup(
    React.createElement(function EditorProbe(): null {
      controller = useDocxEditor(options);
      return null;
    })
  );
  return controller!;
}

function stubWorkerThatCannotStart(): Error {
  // What Chromium and Safari do for a worker script on another origin.
  const cause = new DOMException(
    "Script cannot be accessed from origin",
    "SecurityError"
  );
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        throw cause;
      }
    }
  );
  return cause;
}

function lastImportOptions(): { useWorker?: WorkerMode } {
  return mocks.importDocxBuffer.mock.calls.at(-1)![1];
}

function lastImportResult(): Promise<{ source: string }> {
  return mocks.importDocxBuffer.mock.results.at(-1)!.value;
}

beforeEach(() => {
  mocks.importDocxBuffer.mockClear();
  mocks.canUseConfiguredWasmSourceInWorker.mockReturnValue(true);
  mocks.effects.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useDocxEditor useWorker option", () => {
  async function editorImportMode(
    options?: UseDocxEditorOptions
  ): Promise<WorkerMode> {
    mocks.importDocxBuffer.mockClear();
    mocks.importDocxBuffer.mockRejectedValueOnce(STOP);
    await captureEditor(options).importDocxFile(
      new File([new Uint8Array(4)], "sample.docx")
    );
    expect(mocks.importDocxBuffer).toHaveBeenCalledTimes(1);
    return lastImportOptions().useWorker;
  }

  it("requires the worker when the option is omitted", async () => {
    await expect(editorImportMode()).resolves.toBe("required");
    await expect(editorImportMode({})).resolves.toBe("required");
  });

  it("keeps avoiding the worker by default for a WASM source it cannot receive", async () => {
    mocks.canUseConfiguredWasmSourceInWorker.mockReturnValue(false);
    await expect(editorImportMode()).resolves.toBe(false);
  });

  it.each([false, true, "required"] as const)(
    "passes useWorker: %s through to the import",
    async (useWorker) => {
      await expect(editorImportMode({ useWorker })).resolves.toBe(useWorker);
    }
  );

  it("does not let the default override an explicit mode", async () => {
    mocks.canUseConfiguredWasmSourceInWorker.mockReturnValue(false);
    await expect(editorImportMode({ useWorker: true })).resolves.toBe(true);
    await expect(editorImportMode({ useWorker: "required" })).resolves.toBe(
      "required"
    );
  });

  describe("when the worker cannot be constructed", () => {
    async function importStarterDocument(
      options?: UseDocxEditorOptions
    ): Promise<void> {
      const editor = captureEditor(options);
      const bytes = await editor.getDocxBytes();
      await editor.importDocxFile(new File([bytes], "starter.docx"));
    }

    it("still fails the import by default", async () => {
      const cause = stubWorkerThatCannotStart();
      await importStarterDocument();
      await expect(lastImportResult()).rejects.toMatchObject({
        message: "Unable to start the DOCX import worker",
        cause,
      });
    });

    it.each([true, false] as const)(
      "parses on the main thread with useWorker: %s",
      async (useWorker) => {
        stubWorkerThatCannotStart();
        await importStarterDocument({ useWorker });
        const result = await lastImportResult();
        expect(result.source).toBe("main-thread");
      }
    );
  });
});

describe("useDocxModel useWorker option", () => {
  function modelImport(
    file: ArrayBuffer,
    ...rest: [] | [UseDocxModelOptions]
  ): { useWorker?: WorkerMode; deps?: readonly unknown[] } {
    mocks.importDocxBuffer.mockRejectedValueOnce(STOP);
    renderToStaticMarkup(
      React.createElement(function ModelProbe(): null {
        useDocxModel(file, ...rest);
        return null;
      })
    );
    expect(mocks.effects).toHaveLength(1);
    const { effect, deps } = mocks.effects[0]!;
    mocks.effects.length = 0;
    const cleanup = effect();
    expect(mocks.importDocxBuffer).toHaveBeenCalledTimes(1);
    expect(mocks.importDocxBuffer.mock.calls[0]![0]).toBe(file);
    const { useWorker } = lastImportOptions();
    mocks.importDocxBuffer.mockClear();
    if (typeof cleanup === "function") {
      cleanup();
    }
    return { useWorker, deps };
  }

  it("requires the worker when the option is omitted", () => {
    const file = new ArrayBuffer(4);
    expect(modelImport(file).useWorker).toBe("required");
    expect(modelImport(file, {}).useWorker).toBe("required");
  });

  it.each([false, true, "required"] as const)(
    "passes useWorker: %s through to the import",
    (useWorker) => {
      expect(modelImport(new ArrayBuffer(4), { useWorker }).useWorker).toBe(
        useWorker
      );
    }
  );

  it("imports again when the mode changes", () => {
    const file = new ArrayBuffer(4);
    expect(modelImport(file).deps).toEqual([file, "required"]);
    expect(modelImport(file, { useWorker: false }).deps).toEqual([file, false]);
  });
});
