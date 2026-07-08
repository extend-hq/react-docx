import type { DocModel } from "./types";

function deepFreezeValue(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    return;
  }
  // Freezing a typed array throws; image byte payloads stay unfrozen.
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return;
  }
  if (Object.isFrozen(value)) {
    return;
  }

  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      deepFreezeValue(entry);
    }
    return;
  }

  for (const key of Object.keys(value)) {
    deepFreezeValue((value as Record<string, unknown>)[key]);
  }
}

/**
 * Dev-only commit guard: freezes a committed model so in-place mutation of
 * structure shared with history snapshots throws instead of corrupting them.
 * Already-frozen subtrees are skipped, so once a model is frozen, freezing a
 * structurally shared successor only pays for the changed nodes.
 */
export function deepFreezeDocModel(model: DocModel): DocModel {
  deepFreezeValue(model);
  return model;
}
