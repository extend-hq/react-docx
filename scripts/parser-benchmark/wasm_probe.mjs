import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [wasmPath, inputPath, repeatArgument = '5'] = process.argv.slice(2);
const glue = await import(pathToFileURL(path.resolve('packages/wasm/src/generated/docx_wasm.js')));
const wasmBytes = fs.readFileSync(wasmPath);
const input = fs.readFileSync(inputPath);
const start = performance.now();
await glue.default({ module_or_path: wasmBytes });
const initMs = performance.now() - start;
const samples = [];
let coldMs;
let modelNodes;
for (let index = 0; index <= Number(repeatArgument); index++) {
  globalThis.gc?.();
  const start = performance.now();
  const model = glue.build_doc_model_from_bytes(input);
  const elapsed = performance.now() - start;
  modelNodes = model.model.nodes.length;
  if (index === 0) coldMs = elapsed;
  else samples.push(elapsed);
}
console.log(JSON.stringify({ status: 'ok', init_ms: initMs, cold_ms: coldMs,
  samples_ms: samples, model_nodes: modelNodes, node: process.version }));
