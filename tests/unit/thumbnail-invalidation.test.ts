import { describe, expect, it } from "vitest";
import type { DocModel } from "@extend-ai/react-docx-doc-model";
import { cloneDocModel } from "@extend-ai/react-docx-doc-model";
import {
  docModelThumbnailMetadataSignature,
  docNodeContentSignature,
} from "../../packages/react-viewer/src/content-signature";
import {
  DocxThumbnailSurfaceCache,
  renderDocxThumbnailSnapshotSurface,
  SerialIdleTaskQueue,
  thumbnailImageSourceQualifiesForDownscale,
} from "../../packages/react-viewer/src/thumbnail-raster";

function createTestModel(): DocModel {
  return {
    nodes: [
      {
        type: "paragraph",
        children: [{ type: "text", text: "Hello world" }],
      },
      {
        type: "paragraph",
        style: { align: "center" },
        children: [
          { type: "text", text: "Styled", style: { bold: true } },
          {
            type: "image",
            src: `data:image/png;base64,${"a".repeat(50_000)}`,
            widthPx: 100,
            heightPx: 80,
          },
        ],
      },
    ],
    metadata: {
      sourceParts: {},
      warnings: [],
      headerSections: [],
      footerSections: [],
    },
  } as unknown as DocModel;
}

describe("docNodeContentSignature", () => {
  it("is stable across deep clones with identical content", () => {
    const model = createTestModel();
    const clone = cloneDocModel(model);

    model.nodes.forEach((node, index) => {
      expect(node).not.toBe(clone.nodes[index]);
      expect(docNodeContentSignature(node)).toBe(
        docNodeContentSignature(clone.nodes[index])
      );
    });
  });

  it("changes when text content changes", () => {
    const model = createTestModel();
    const edited = cloneDocModel(model);
    (edited.nodes[0] as { children: Array<{ text: string }> }).children[0].text =
      "Hello world!";

    expect(docNodeContentSignature(model.nodes[0])).not.toBe(
      docNodeContentSignature(edited.nodes[0])
    );
    expect(docNodeContentSignature(model.nodes[1])).toBe(
      docNodeContentSignature(edited.nodes[1])
    );
  });

  it("changes when run styling changes", () => {
    const model = createTestModel();
    const edited = cloneDocModel(model);
    const styledRun = (
      edited.nodes[1] as {
        children: Array<{ style?: { bold?: boolean } }>;
      }
    ).children[0];
    styledRun.style = { bold: false };

    expect(docNodeContentSignature(model.nodes[1])).not.toBe(
      docNodeContentSignature(edited.nodes[1])
    );
  });

  it("distinguishes long strings by sampled content, not just length", () => {
    const left = { src: `data:image/png;base64,${"a".repeat(40_000)}` };
    const right = {
      src: `data:image/png;base64,${"a".repeat(20_000)}${"b".repeat(20_000)}`,
    };

    expect(docNodeContentSignature(left)).not.toBe(
      docNodeContentSignature(right)
    );
  });

  it("memoizes by object identity", () => {
    const node = createTestModel().nodes[0];
    expect(docNodeContentSignature(node)).toBe(docNodeContentSignature(node));
  });
});

describe("docModelThumbnailMetadataSignature", () => {
  it("ignores warnings and source parts", () => {
    const base = createTestModel().metadata as unknown as Record<
      string,
      unknown
    >;
    const noisy = {
      ...base,
      warnings: ["something happened"],
      sourceParts: { "word/document.xml": "<xml/>" },
    };

    expect(docModelThumbnailMetadataSignature(base)).toBe(
      docModelThumbnailMetadataSignature(noisy)
    );
  });

  it("changes when header content changes", () => {
    const base = createTestModel().metadata as unknown as Record<
      string,
      unknown
    >;
    const withHeader = {
      ...base,
      headerSections: [
        {
          partName: "word/header1.xml",
          nodes: [{ type: "paragraph", children: [] }],
        },
      ],
    };

    expect(docModelThumbnailMetadataSignature(base)).not.toBe(
      docModelThumbnailMetadataSignature(withHeader)
    );
  });
});

describe("DocxThumbnailSurfaceCache", () => {
  it("evicts the least recently used entry beyond the cap", () => {
    const cache = new DocxThumbnailSurfaceCache<string>(2);
    cache.set("a", "A");
    cache.set("b", "B");
    expect(cache.get("a")).toBe("A");

    cache.set("c", "C");

    expect(cache.size).toBe(2);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("A");
    expect(cache.get("c")).toBe("C");
  });

  it("clears all entries", () => {
    const cache = new DocxThumbnailSurfaceCache<string>(4);
    cache.set("a", "A");
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });
});

describe("thumbnailImageSourceQualifiesForDownscale", () => {
  it("accepts large raster data URIs only", () => {
    const largeRaster = `data:image/png;base64,${"a".repeat(40_000)}`;
    const largeJpeg = `data:image/jpeg;base64,${"a".repeat(40_000)}`;
    const smallRaster = `data:image/png;base64,${"a".repeat(100)}`;
    const largeSvg = `data:image/svg+xml;charset=utf-8,${"a".repeat(40_000)}`;
    const externalUrl = `https://example.com/${"a".repeat(40_000)}.png`;

    expect(thumbnailImageSourceQualifiesForDownscale(largeRaster)).toBe(true);
    expect(thumbnailImageSourceQualifiesForDownscale(largeJpeg)).toBe(true);
    expect(thumbnailImageSourceQualifiesForDownscale(smallRaster)).toBe(false);
    expect(thumbnailImageSourceQualifiesForDownscale(largeSvg)).toBe(false);
    expect(thumbnailImageSourceQualifiesForDownscale(externalUrl)).toBe(false);
  });
});

describe("renderDocxThumbnailSnapshotSurface", () => {
  it("keeps the direct renderer browser-only", () => {
    expect(() =>
      renderDocxThumbnailSnapshotSurface({
        snapshot: {
          key: "page",
          sourceWidthPx: 100,
          sourceHeightPx: 140,
          elements: [],
        },
        widthPx: 50,
        heightPx: 70,
        pixelWidthPx: 50,
        pixelHeightPx: 70,
      })
    ).toThrow(/browser environment/);
  });
});

interface ManualScheduler {
  flushIdle: () => void;
  flushDelayed: (advanceMs?: number) => void;
  pendingIdleCount: () => number;
  pendingDelayedCount: () => number;
  advance: (deltaMs: number) => void;
  queueOptions: {
    scheduleTask: (callback: () => void) => void;
    scheduleDelayed: (callback: () => void, delayMs: number) => void;
    now: () => number;
  };
}

function createManualScheduler(): ManualScheduler {
  let currentTime = 0;
  const idleCallbacks: Array<() => void> = [];
  const delayedCallbacks: Array<{ callback: () => void; runAt: number }> = [];

  return {
    flushIdle: () => {
      const callbacks = idleCallbacks.splice(0, idleCallbacks.length);
      callbacks.forEach((callback) => {
        callback();
      });
    },
    flushDelayed: () => {
      const ready = delayedCallbacks.filter(
        (entry) => entry.runAt <= currentTime
      );
      delayedCallbacks.splice(
        0,
        delayedCallbacks.length,
        ...delayedCallbacks.filter((entry) => entry.runAt > currentTime)
      );
      ready.forEach((entry) => {
        entry.callback();
      });
    },
    pendingIdleCount: () => idleCallbacks.length,
    pendingDelayedCount: () => delayedCallbacks.length,
    advance: (deltaMs: number) => {
      currentTime += deltaMs;
    },
    queueOptions: {
      scheduleTask: (callback) => {
        idleCallbacks.push(callback);
      },
      scheduleDelayed: (callback, delayMs) => {
        delayedCallbacks.push({ callback, runAt: currentTime + delayMs });
      },
      now: () => currentTime,
    },
  };
}

async function settleMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

describe("SerialIdleTaskQueue", () => {
  it("runs tasks one at a time in idle slices", async () => {
    const scheduler = createManualScheduler();
    const queue = new SerialIdleTaskQueue<string>(scheduler.queueOptions);
    const runs: string[] = [];

    const first = queue.enqueue("a", async () => {
      runs.push("a");
    });
    const second = queue.enqueue("b", async () => {
      runs.push("b");
    });

    expect(runs).toEqual([]);
    scheduler.flushIdle();
    await settleMicrotasks();
    expect(runs).toEqual(["a"]);
    await first;

    scheduler.flushIdle();
    await settleMicrotasks();
    expect(runs).toEqual(["a", "b"]);
    await second;
  });

  it("coalesces queued tasks that share a key, keeping the newest run", async () => {
    const scheduler = createManualScheduler();
    const queue = new SerialIdleTaskQueue<string>(scheduler.queueOptions);
    const runs: string[] = [];

    const first = queue.enqueue("page-1", async () => {
      runs.push("stale");
    });
    const second = queue.enqueue("page-1", async () => {
      runs.push("fresh");
    });

    scheduler.flushIdle();
    await settleMicrotasks();

    expect(runs).toEqual(["fresh"]);
    await Promise.all([first, second]);
  });

  it("runs eligible higher-priority tasks before lower-priority work", async () => {
    const scheduler = createManualScheduler();
    const queue = new SerialIdleTaskQueue<string>(scheduler.queueOptions);
    const runs: string[] = [];

    const low = queue.enqueue(
      "low",
      async () => {
        runs.push("low");
      },
      { priority: 2 }
    );
    const high = queue.enqueue(
      "high",
      async () => {
        runs.push("high");
      },
      { priority: 0 }
    );
    const middle = queue.enqueue(
      "middle",
      async () => {
        runs.push("middle");
      },
      { priority: 1 }
    );

    scheduler.flushIdle();
    await settleMicrotasks();
    expect(runs).toEqual(["high"]);
    await high;

    scheduler.flushIdle();
    await settleMicrotasks();
    expect(runs).toEqual(["high", "middle"]);
    await middle;

    scheduler.flushIdle();
    await settleMicrotasks();
    expect(runs).toEqual(["high", "middle", "low"]);
    await low;
  });

  it("throttles repeat runs for the same key to the minimum interval", async () => {
    const scheduler = createManualScheduler();
    const queue = new SerialIdleTaskQueue<string>({
      ...scheduler.queueOptions,
      minTaskIntervalMs: 200,
    });
    const runs: string[] = [];

    const first = queue.enqueue("page-1", async () => {
      runs.push("first");
    });
    scheduler.flushIdle();
    await settleMicrotasks();
    await first;
    expect(runs).toEqual(["first"]);

    void queue.enqueue("page-1", async () => {
      runs.push("second");
    });
    scheduler.flushIdle();
    await settleMicrotasks();
    // Too soon for page-1; the run is deferred via the delayed scheduler.
    expect(runs).toEqual(["first"]);
    expect(scheduler.pendingDelayedCount()).toBe(1);

    scheduler.advance(250);
    scheduler.flushDelayed();
    scheduler.flushIdle();
    await settleMicrotasks();
    expect(runs).toEqual(["first", "second"]);
  });

  it("lets other keys run while one key is throttled", async () => {
    const scheduler = createManualScheduler();
    const queue = new SerialIdleTaskQueue<string>({
      ...scheduler.queueOptions,
      minTaskIntervalMs: 200,
    });
    const runs: string[] = [];

    const first = queue.enqueue("page-1", async () => {
      runs.push("page-1");
    });
    scheduler.flushIdle();
    await settleMicrotasks();
    await first;

    void queue.enqueue("page-1", async () => {
      runs.push("page-1-again");
    });
    const other = queue.enqueue("page-2", async () => {
      runs.push("page-2");
    });
    scheduler.flushIdle();
    await settleMicrotasks();
    expect(runs).toEqual(["page-1", "page-2"]);
    await other;
  });

  it("clear() drops pending tasks but resolves their waiters", async () => {
    const scheduler = createManualScheduler();
    const queue = new SerialIdleTaskQueue<string>(scheduler.queueOptions);
    const runs: string[] = [];

    const pending = queue.enqueue("a", async () => {
      runs.push("a");
    });
    queue.clear();
    scheduler.flushIdle();
    await settleMicrotasks();

    await pending;
    expect(runs).toEqual([]);
    expect(queue.pendingCount).toBe(0);
  });

  it("keeps sequencing after a task throws", async () => {
    const scheduler = createManualScheduler();
    const queue = new SerialIdleTaskQueue<string>(scheduler.queueOptions);
    const runs: string[] = [];

    const failing = queue.enqueue("a", async () => {
      throw new Error("boom");
    });
    const following = queue.enqueue("b", async () => {
      runs.push("b");
    });

    scheduler.flushIdle();
    await settleMicrotasks();
    await failing;

    scheduler.flushIdle();
    await settleMicrotasks();
    await following;
    expect(runs).toEqual(["b"]);
  });
});
