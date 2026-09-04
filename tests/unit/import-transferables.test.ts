import { describe, expect, it } from "vitest";
import { collectImportTransferables } from "../../packages/react-viewer/src/import-transferables";

describe("import buffer transfer", () => {
  it("preserves shared buffers, view offsets, and nested model assets", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const nestedBytes = new Uint8Array([5, 6]);
    const result = {
      package: { binaryAssets: new Map([["asset", bytes]]) },
      model: {
        nodes: [{ children: [{ data: bytes.subarray(1, 3) }] }],
        metadata: { sections: [{ nodes: [{ data: nestedBytes }] }] },
      },
    };

    const transferred = structuredClone(result, {
      transfer: collectImportTransferables(result),
    });
    expect(bytes.byteLength).toBe(0);
    expect(nestedBytes.byteLength).toBe(0);
    const asset = transferred.package.binaryAssets.get("asset")!;
    const image = transferred.model.nodes[0].children[0].data;
    expect([...asset]).toEqual([1, 2, 3, 4]);
    expect([...image]).toEqual([2, 3]);
    expect(image.buffer).toBe(asset.buffer);
    expect([...transferred.model.metadata.sections[0].nodes[0].data]).toEqual([
      5, 6,
    ]);
  });

  it("handles cycles and excludes shared memory from the transfer list", () => {
    const shared = new Uint8Array(new SharedArrayBuffer(4));
    const result: { shared: Uint8Array; self?: unknown } = { shared };
    result.self = result;
    expect(collectImportTransferables(result)).toEqual([]);
    expect(structuredClone(result).shared.byteLength).toBe(4);
  });
});
