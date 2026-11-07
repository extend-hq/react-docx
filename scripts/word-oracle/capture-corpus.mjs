import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
if (args.includes("--help")) { console.log("Usage: node scripts/word-oracle/capture-corpus.mjs --output PATH [--inventory PATH] [--variants baseline,migrated,refined] [--workers 2] [--timeout-ms 120000] [--ids ID,...] [--limit N] [--retry-failures] [--force]"); process.exit(0); }
const outputOption = option("--output", null);
if (!outputOption) throw new Error("--output is required");
const output = path.resolve(outputOption);
const captureConfiguration = { mode: "read-only", zoom: 100, height: "auto", pageVirtualization: { enabled: false }, deferInitialPaginationPaint: true, showTrackedChanges: false, showComments: false, initialDocumentTheme: "light", viewport: { width: 1440, height: 1600 }, deviceScaleFactor: 1, locale: "en-US", timezoneId: "America/New_York" };
const inventoryPath = path.resolve(option("--inventory", path.join(output, "inventory.json")));
const captureProfileSha256 = crypto.createHash("sha256").update(await fsp.readFile(fileURLToPath(import.meta.url))).update(await fsp.readFile(path.join(repository, "scripts/word-oracle/corpus-page-metrics.mjs"))).digest("hex");
try { const expectedProfile = JSON.parse(await fsp.readFile(path.join(output, "capture-profile.json"), "utf8")); if (expectedProfile.captureProfileSha256 !== captureProfileSha256) throw new Error("Capture code differs from frozen capture profile"); } catch (error) { if (error.code !== "ENOENT") throw error; }
const variants = option("--variants", "baseline,migrated").split(",");
const concurrency = Math.max(1, Number(option("--workers", "2")));
const timeoutMs = Math.max(1000, Number(option("--timeout-ms", "120000")));
const selected = new Set((option("--ids", "") || "").split(",").filter(Boolean));
const limit = Number(option("--limit", "0"));
const inventory = JSON.parse(await fsp.readFile(inventoryPath, "utf8"));
const identities = JSON.parse(await fsp.readFile(path.join(output, "build-identities.json"), "utf8"));
let documents = inventory.documents.filter((document) => document.eligible && ["doc", "docx"].includes(document.format) && (!selected.size || selected.has(document.id) || selected.has(document.sha256)));
if (limit > 0) documents = documents.slice(0, limit);
const byId = new Map(documents.map((document) => [document.id, document]));
await fsp.mkdir(path.join(output, "vendor"), { recursive: true });
const require = createRequire(import.meta.resolve("tsup"));
await require("esbuild").build({ entryPoints: [path.join(repository, "packages/react-viewer/node_modules/fast-png/lib/index.js")], bundle: true, format: "esm", platform: "browser", outfile: path.join(output, "vendor/fast-png.js"), logLevel: "silent" });
const mime = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".woff": "font/woff", ".woff2": "font/woff2" };
const sendFile = async (response, filename) => {
  const stat = await fsp.stat(filename);
  response.writeHead(200, { "Content-Type": mime[path.extname(filename)] ?? "application/octet-stream", "Content-Length": stat.size, "Cache-Control": "no-cache" });
  fs.createReadStream(filename).pipe(response);
};
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/") {
      const variant = url.searchParams.get("variant");
      const id = url.searchParams.get("id");
      if (!variants.includes(variant) || !byId.has(id)) throw new Error("Unknown capture identity");
      const document = byId.get(id);
      const importMap = JSON.stringify({ imports: { "@extend-ai/react-docx/internal": `/builds/${variant}/internal.js`, "fast-png": "/vendor/fast-png.js" } });
      response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
      response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:white}#app{width:1440px}*{animation:none!important;transition:none!important;caret-color:transparent!important}</style><script type="importmap">${importMap}</script></head><body><div id="app"></div><script type="module">import{createDocxViewer,setWasmSource}from'/builds/${variant}/vanilla.js';import{collectCorpusPageMetrics}from'/metrics.mjs';setWasmSource('/builds/${variant}/docx_wasm_bg.wasm');window.collectCorpusPageMetrics=collectCorpusPageMetrics;window.viewer=createDocxViewer(document.querySelector('#app'),{src:${JSON.stringify(`/input/${id}.${document.format}`)},fileName:${JSON.stringify(path.basename(document.sourcePath))},mode:'read-only',height:'auto',zoom:100,pageVirtualization:{enabled:false},deferInitialPaginationPaint:true,showTrackedChanges:false,showComments:false,initialDocumentTheme:'light',onPageCountChange:n=>window.reportedPageCount=n});</script></body></html>`);
      return;
    }
    if (url.pathname === "/metrics.mjs") return await sendFile(response, path.join(repository, "scripts/word-oracle/corpus-page-metrics.mjs"));
    if (url.pathname.startsWith("/input/")) {
      const id = path.basename(url.pathname).replace(/\.(docx|doc)$/, "");
      const document = byId.get(id);
      if (!document) throw new Error("Unknown source identity");
      const bytes = await fsp.readFile(document.sourcePath);
      if (crypto.createHash("sha256").update(bytes).digest("hex") !== document.sha256) throw new Error("Source changed after inventory");
      response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": bytes.length }); response.end(bytes); return;
    }
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (!relative.startsWith("builds/") && !relative.startsWith("vendor/")) throw new Error("Unknown resource");
    const filename = path.resolve(output, relative);
    if (!filename.startsWith(output + path.sep)) throw new Error("Resource outside capture root");
    await sendFile(response, filename);
  } catch (error) { response.writeHead(404, { "Content-Type": "text/plain" }); response.end(String(error.message ?? error)); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const startedAt = new Date().toISOString();
await fsp.writeFile(path.join(output, `renderer-run-${variants.join("-")}.json`), JSON.stringify({ schemaVersion: 1, startedAt, variants, documentCount: documents.length, workers: concurrency, timeoutMs, inventoryPath, origin, builds: Object.fromEntries(variants.map((variant) => [variant, identities.builds[variant].buildSha256])) }, null, 2));
let nextIndex = 0;
let done = 0;
const deadline = async (promise, milliseconds) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Capture deadline exceeded after ${milliseconds}ms`)), milliseconds); })]); }
  finally { clearTimeout(timer); }
};
const waitForStable = async (page) => page.evaluate(async ({ timeoutMs }) => {
  const start = performance.now(); let stable = 0; let prior = "";
  const hash = (text) => { let value = 2166136261; for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619); return value >>> 0; };
  while (performance.now() - start < timeoutMs) {
    const controller = window.viewer?.getController();
    if (controller?.error) throw new Error(controller.error.message);
    const surfaces = [...document.querySelectorAll('[data-docx-page-surface="true"]')];
    const imagesReady = surfaces.every((surface) => [...surface.querySelectorAll("img")].every((image) => image.complete));
    const complete = surfaces.length === window.reportedPageCount && surfaces.every((surface, i) => Number(surface.closest('[data-docx-page-wrapper="true"]').getAttribute("data-docx-page-index")) === i);
    const visible = surfaces.every((surface) => getComputedStyle(surface.closest('[data-docx-page-wrapper="true"]')).visibility !== "hidden");
    if (controller?.hasDocument && !controller.isLoading && surfaces.length > 0 && complete && visible && document.fonts.status === "loaded" && imagesReady && !document.querySelector('[data-docx-initial-layout-overlay="true"]')) {
      const editableElements = surfaces.flatMap((surface) => [...surface.querySelectorAll('[contenteditable="true"],[contenteditable="plaintext-only"],input:not([disabled]):not([readonly]),textarea:not([disabled]):not([readonly])')]);
      if (editableElements.length) throw new Error(`Read-only capture contains ${editableElements.length} editable controls`);
      const signature = JSON.stringify(surfaces.map((surface) => {
        const rect = surface.getBoundingClientRect();
        const fragments = [...surface.querySelectorAll('[data-docx-text-start], [data-docx-paragraph-host="true"], [data-docx-paragraph-host="true"] span, [data-docx-header-footer-region], img, svg')].map((element) => [element.getAttribute("data-docx-text-start"), element.getAttribute("data-docx-text-end"), [...element.getClientRects()].map((box) => [box.x, box.y, box.width, box.height].map((value) => Math.round(value * 64))), hash(element.textContent ?? "")]);
        return [rect.width, rect.height, surface.scrollWidth, surface.scrollHeight, hash(surface.textContent ?? ""), fragments];
      }));
      stable = signature === prior ? stable + 1 : 1; prior = signature;
      if (stable >= 5) return { stableSamples: stable, settleMs: performance.now() - start, pageCount: surfaces.length, editableControlCount: editableElements.length, inputElementCount: surfaces.reduce((sum, surface) => sum + surface.querySelectorAll("input,textarea").length, 0) };
    } else { stable = 0; prior = ""; }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Viewer did not settle: ${window.viewer?.getController()?.status ?? "no controller"}`);
}, { timeoutMs });
const capture = async (browser, document, variant) => {
  const directory = path.join(output, "renderer", variant);
  await fsp.mkdir(directory, { recursive: true });
  const destination = path.join(directory, `${document.sha256}.json`);
  if (!args.includes("--force")) {
    try { const existing = JSON.parse(await fsp.readFile(destination, "utf8")); if (existing.captureProfileSha256 === captureProfileSha256 && existing.sourceSha256 === document.sha256 && existing.buildSha256 === identities.builds[variant].buildSha256 && (existing.status === "ok" || !args.includes("--retry-failures"))) return existing; } catch {}
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 }, deviceScaleFactor: 1, locale: "en-US", timezoneId: "America/New_York" });
  const page = await context.newPage();
  const failures = []; const httpFailures = []; const remote = []; const consoleErrors = [];
  await context.route("**/*", (route) => { const url = route.request().url(); if (/^https?:/.test(url) && !url.startsWith(origin + "/")) { remote.push(url); return route.abort(); } return route.continue(); });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  page.on("response", (response) => { if (response.status() >= 400) httpFailures.push({ url: response.url(), status: response.status() }); });
  page.on("requestfailed", (request) => failures.push({ url: request.url(), error: request.failure()?.errorText }));
  const begin = performance.now();
  const record = { schemaVersion: 1, captureProfileSha256, captureConfiguration, id: document.id, sourceSha256: document.sha256, sourcePath: document.sourcePath, format: document.format, variant, buildSha256: identities.builds[variant].buildSha256, capturedAt: new Date().toISOString(), status: "error" };
  try {
    await deadline((async () => {
      await page.goto(`${origin}/?variant=${variant}&id=${encodeURIComponent(document.id)}`, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      record.readiness = await waitForStable(page);
      record.readyMs = performance.now() - begin;
      const extractStart = performance.now();
      record.geometry = await page.evaluate(() => window.collectCorpusPageMetrics());
      if (record.geometry.resolvedZoom !== 100 || record.geometry.domResolvedZoom !== 100) throw new Error("Capture zoom did not resolve to100percent");
      record.extractMs = performance.now() - extractStart;
      record.status = "ok";
    })(), timeoutMs + 5000);
  } catch (error) { record.error = String(error?.stack ?? error); }
  record.elapsedMs = performance.now() - begin;
  record.httpFailures = httpFailures; record.requestFailures = failures; record.blockedRemoteRequests = remote; record.pageErrors = consoleErrors;
  await deadline(context.close(), 10000).catch(() => {});
  await fsp.writeFile(destination + ".tmp", JSON.stringify(record));
  await fsp.rename(destination + ".tmp", destination);
  await fsp.appendFile(path.join(output, "renderer-progress.jsonl"), JSON.stringify({ id: record.id, sourceSha256: record.sourceSha256, variant, status: record.status, pageCount: record.geometry?.pageCount ?? null, elapsedMs: record.elapsedMs, error: record.error ?? null }) + "\n");
  return record;
};
async function worker(workerIndex) {
  let browser = await chromium.launch({ headless: true });
  try {
    while (true) {
      const index = nextIndex++; if (index >= documents.length) break;
      const document = documents[index];
      const ordered = index % 2 ? [...variants].reverse() : variants;
      const summary = [];
      for (const variant of ordered) {
        if (!browser.isConnected()) browser = await chromium.launch({ headless: true });
        const record = await capture(browser, document, variant);
        summary.push(`${variant}:${record.status}:${record.geometry?.pageCount ?? "-"}`);
      }
      done++;
      console.log(JSON.stringify({ done, total: documents.length, worker: workerIndex, id: document.id, results: summary }));
    }
  } finally { await browser.close().catch(() => {}); }
}
try { await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i))); }
finally { await new Promise((resolve) => server.close(resolve)); }
