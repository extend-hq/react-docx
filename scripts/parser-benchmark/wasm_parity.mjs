import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [wasmPath, inputPath] = process.argv.slice(2);
const glue = await import(pathToFileURL(path.resolve('packages/wasm/src/generated/docx_wasm.js')));
await glue.default({ module_or_path: fs.readFileSync(wasmPath) });
const result = glue.build_doc_model_from_bytes(fs.readFileSync(inputPath));
const counts = {};
function digest(value, location = '') {
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array'
    : ArrayBuffer.isView(value) ? value.constructor.name : typeof value;
  counts[kind] = (counts[kind] ?? 0) + 1;
  const hash = createHash('sha256').update(kind);
  if (ArrayBuffer.isView(value)) {
    hash.update(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  } else if (Array.isArray(value)) {
    const children = value.map((child) => digest(child, `${location}[]`));
    if (location === 'model.metadata.paragraphStyles' || location === 'model.metadata.tableStyles') {
      children.sort(Buffer.compare);
    }
    for (const child of children) hash.update(child);
  } else if (kind === 'object') {
    for (const key of Object.keys(value).sort()) {
      hash.update(JSON.stringify(key));
      hash.update(digest(value[key], location ? `${location}.${key}` : key));
    }
  } else {
    hash.update(JSON.stringify(value) ?? 'undefined');
  }
  return hash.digest();
}
const sha256 = digest({ model: result.model, package: result.package }).toString('hex');
console.log(JSON.stringify({ sha256, counts }));
