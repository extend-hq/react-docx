export function collectImportTransferables(value: unknown): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  const visited = new Set<object>();
  const pending = [value];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || visited.has(current)) {
      continue;
    }
    visited.add(current);

    if (current instanceof ArrayBuffer) {
      buffers.add(current);
    } else if (ArrayBuffer.isView(current)) {
      if (current.buffer instanceof ArrayBuffer) {
        buffers.add(current.buffer);
      }
    } else if (current instanceof Map) {
      for (const [key, entry] of current) {
        pending.push(key, entry);
      }
    } else {
      for (const entry of Object.values(current)) {
        pending.push(entry);
      }
    }
  }

  return [...buffers];
}
