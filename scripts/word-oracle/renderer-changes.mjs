import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const args = process.argv.slice(2);
const i = args.indexOf("--output");
if (args.includes("--help")) {
  console.log(
    "Usage: node scripts/word-oracle/renderer-changes.mjs --output PATH"
  );
  process.exit(0);
}
if (i < 0) throw new Error("--output is required");
const output = path.resolve(args[i + 1]);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const beforeVariant = option("--before", "baseline");
const afterVariant = option("--after", "migrated");
const resultName = option("--result", "renderer-changes.json");
const priorityName = option("--priority", "word-priority.json");
const inventory = JSON.parse(
  await fs.readFile(
    path.resolve(option("--inventory", path.join(output, "inventory.json"))),
    "utf8"
  )
);
const expectedProfile = JSON.parse(
  await fs.readFile(path.join(output, "capture-profile.json"), "utf8")
);
const identities = JSON.parse(
  await fs.readFile(path.join(output, "build-identities.json"), "utf8")
);
const normal = (text) =>
  String(text ?? "")
    .normalize("NFKC")
    .replace(/[\s\p{Cf}]/gu, "")
    .replace(/[\u2010\u2011]/gu, "-");
const read = async (filename) => {
  try {
    return JSON.parse(await fs.readFile(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};
function paragraphNamespaces(capture) {
  const namespaces = new Set();
  for (const page of capture.geometry.pages)
    for (const word of page.words) {
      const prefix = /^docx:[a-f0-9]{64}(?=\/)/i.exec(
        word.paragraphId ?? ""
      )?.[0];
      if (prefix) namespaces.add(prefix);
    }
  return [...namespaces].sort();
}
function textAndLines(capture, convertedNamespace = null) {
  const pages = [];
  const lines = [];
  let clipped = 0;
  const positions = new Map();
  for (const page of capture.geometry.pages) {
    let line = "";
    let prior = null;
    for (const word of page.words) {
      const text = normal(word.text);
      if (!text) continue;
      if (prior) {
        const overlap =
          Math.min(prior.bbox[3], word.bbox[3]) -
          Math.max(prior.bbox[1], word.bbox[1]);
        const height = Math.min(
          prior.bbox[3] - prior.bbox[1],
          word.bbox[3] - word.bbox[1]
        );
        if (word.paragraphId !== prior.paragraphId || overlap < height * 0.3) {
          lines.push(line);
          line = "";
        }
      }
      line += text;
      prior = word;
      if (word.clippedFraction > 0.01) clipped += [...text].length;
      const paragraphId =
        convertedNamespace &&
        word.paragraphId?.startsWith(convertedNamespace + "/")
          ? "docx:<converted-document>" +
            word.paragraphId.slice(convertedNamespace.length)
          : word.paragraphId;
      const key = JSON.stringify([
        paragraphId,
        word.sourceStart,
        word.sourceEnd,
        text,
      ]);
      if (!positions.has(key)) positions.set(key, []);
      positions.get(key).push({
        pageIndex: page.pageIndex,
        bbox: word.bbox,
        widthPt:
          (page.widthCssPx * 0.75) / (capture.geometry.resolvedZoom / 100),
        heightPt:
          (page.heightCssPx * 0.75) / (capture.geometry.resolvedZoom / 100),
        text,
      });
    }
    if (line) lines.push(line);
    pages.push(page.words.map((word) => normal(word.text)).join(""));
  }
  return { pages, lines, text: pages.join(""), clipped, positions };
}
const changes = [];
const unchanged = [];
const sourceIdentityDiagnostics = [];
let pending = 0;
for (const document of inventory.documents.filter((item) => item.eligible)) {
  const before = await read(
    path.join(output, "renderer", beforeVariant, `${document.sha256}.json`)
  );
  const after = await read(
    path.join(output, "renderer", afterVariant, `${document.sha256}.json`)
  );
  if (
    !before ||
    !after ||
    before.sourceSha256 !== document.sha256 ||
    after.sourceSha256 !== document.sha256 ||
    before.buildSha256 !== identities.builds[beforeVariant]?.buildSha256 ||
    after.buildSha256 !== identities.builds[afterVariant]?.buildSha256 ||
    before.captureProfileSha256 !== expectedProfile.captureProfileSha256 ||
    after.captureProfileSha256 !== expectedProfile.captureProfileSha256 ||
    before.captureConfiguration?.mode !== "read-only" ||
    after.captureConfiguration?.mode !== "read-only"
  ) {
    pending++;
    continue;
  }
  const row = {
    id: document.id,
    sourceSha256: document.sha256,
    sourcePath: document.sourcePath,
    format: document.format,
    statusBefore: before.status,
    statusAfter: after.status,
  };
  if (before.status !== "ok" || after.status !== "ok") {
    row.score = before.status === after.status ? 0 : 100000;
    row.statusChanged = before.status !== after.status;
    row.errorBefore = before.error;
    row.errorAfter = after.error;
    changes.push(row);
    continue;
  }
  const namespacesBefore = paragraphNamespaces(before);
  const namespacesAfter = paragraphNamespaces(after);
  const normalizeConvertedNamespace =
    document.format === "doc" &&
    namespacesBefore.length === 1 &&
    namespacesAfter.length === 1;
  const a = textAndLines(
    before,
    normalizeConvertedNamespace ? namespacesBefore[0] : null
  );
  const b = textAndLines(
    after,
    normalizeConvertedNamespace ? namespacesAfter[0] : null
  );
  row.sourceIdentityNamespaceChanged =
    JSON.stringify(namespacesBefore) !== JSON.stringify(namespacesAfter);
  row.pagesBefore = before.geometry.pageCount;
  row.pagesAfter = after.geometry.pageCount;
  row.pageCountChanged = row.pagesBefore !== row.pagesAfter;
  row.pageTextChanged = JSON.stringify(a.pages) !== JSON.stringify(b.pages);
  row.lineTextChanged = JSON.stringify(a.lines) !== JSON.stringify(b.lines);
  row.textChanged = a.text !== b.text;
  row.charactersBefore = [...a.text].length;
  row.charactersAfter = [...b.text].length;
  row.characterDelta = row.charactersAfter - row.charactersBefore;
  row.lineCountBefore = a.lines.length;
  row.lineCountAfter = b.lines.length;
  row.clippedCharactersBefore = a.clipped;
  row.clippedCharactersAfter = b.clipped;
  row.fullyClippedCharactersBefore = before.geometry.skipped.clippedCharacters;
  row.fullyClippedCharactersAfter = after.geometry.skipped.clippedCharacters;
  row.clippingChanged =
    a.clipped !== b.clipped ||
    row.fullyClippedCharactersBefore !== row.fullyClippedCharactersAfter;
  row.readyMsBefore = before.readyMs;
  row.readyMsAfter = after.readyMs;
  row.positionMatchedWords = 0;
  row.positionMovedWords = 0;
  row.pageMovedWords = 0;
  row.maxXShiftPt = 0;
  row.maxYShiftPt = 0;
  const samples = [];
  for (const [key, prior] of a.positions) {
    const next = b.positions.get(key);
    if (!next || prior.length !== next.length) continue;
    for (let index = 0; index < prior.length; index++) {
      const one = prior[index];
      const two = next[index];
      row.positionMatchedWords++;
      if (one.pageIndex !== two.pageIndex) {
        row.pageMovedWords++;
        if (samples.length < 15)
          samples.push({
            text: one.text,
            pageBefore: one.pageIndex,
            pageAfter: two.pageIndex,
          });
        continue;
      }
      const dx = Math.abs(one.bbox[0] - two.bbox[0]) * one.widthPt;
      const dy = Math.abs(one.bbox[1] - two.bbox[1]) * one.heightPt;
      row.maxXShiftPt = Math.max(row.maxXShiftPt, dx);
      row.maxYShiftPt = Math.max(row.maxYShiftPt, dy);
      if (dx > 0.05 || dy > 0.05) {
        row.positionMovedWords++;
        if (samples.length < 15 && (dx > 2 || dy > 2))
          samples.push({
            text: one.text,
            pageIndex: one.pageIndex,
            dxPt: dx,
            dyPt: dy,
          });
      }
    }
  }
  row.positionSamples = samples;
  if (document.format === "doc" || row.sourceIdentityNamespaceChanged) {
    sourceIdentityDiagnostics.push({
      id: document.id,
      sourceSha256: document.sha256,
      namespacesBefore,
      namespacesAfter,
      namespaceChanged: row.sourceIdentityNamespaceChanged,
      positionKeyPolicy: normalizeConvertedNamespace
        ? "same-binary-source-converted-namespace-normalized"
        : "original-paragraph-identities",
      matchedGeometryWords: row.positionMatchedWords,
      unmatchedGeometryWordsBefore:
        [...a.positions.values()].reduce(
          (sum, words) => sum + words.length,
          0
        ) - row.positionMatchedWords,
      unmatchedGeometryWordsAfter:
        [...b.positions.values()].reduce(
          (sum, words) => sum + words.length,
          0
        ) - row.positionMatchedWords,
      textChanged: row.textChanged,
    });
  }
  row.score =
    Number(row.pageCountChanged) * 10000 +
    Number(row.textChanged) * 3000 +
    Number(row.pageTextChanged) * 1000 +
    Number(row.lineTextChanged) * 300 +
    Number(row.clippingChanged) * 100 +
    Math.min(300, row.pageMovedWords) +
    Math.min(100, row.maxYShiftPt) +
    Math.min(50, row.maxXShiftPt);
  if (row.score > 0.05) changes.push(row);
  else unchanged.push(row.id);
}
changes.sort((a, b) => b.score - a.score);
const result = {
  schemaVersion: 1,
  beforeVariant,
  afterVariant,
  generatedAt: new Date().toISOString(),
  eligibleDocuments: inventory.documents.filter((document) => document.eligible)
    .length,
  pairedDocuments: changes.length + unchanged.length,
  pendingDocuments: pending,
  changedOrFailedDocuments: changes.length,
  unchangedDocuments: unchanged.length,
  sourceIdentityDiagnostics,
  changes,
  unchanged,
};
await fs.writeFile(
  path.join(output, resultName + ".tmp"),
  JSON.stringify(result, null, 2)
);
await fs.rename(
  path.join(output, resultName + ".tmp"),
  path.join(output, resultName)
);
await fs.writeFile(
  path.join(output, priorityName + ".tmp"),
  JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: result.generatedAt,
      ids: changes.filter((row) => row.score > 0).map((row) => row.id),
      documents: changes
        .filter((row) => row.score > 0)
        .map(
          ({
            id,
            sourceSha256,
            score,
            pageCountChanged,
            pageTextChanged,
            lineTextChanged,
            textChanged,
            clippingChanged,
          }) => ({
            id,
            sourceSha256,
            score,
            pageCountChanged,
            pageTextChanged,
            lineTextChanged,
            textChanged,
            clippingChanged,
          })
        ),
    },
    null,
    2
  )
);
await fs.rename(
  path.join(output, priorityName + ".tmp"),
  path.join(output, priorityName)
);
console.log(
  JSON.stringify(
    {
      paired: result.pairedDocuments,
      changedOrFailed: changes.length,
      unchanged: unchanged.length,
      pending,
      priorities: changes
        .filter((row) => row.score > 0)
        .slice(0, 10)
        .map((row) => ({
          id: row.id,
          score: row.score,
          pagesBefore: row.pagesBefore,
          pagesAfter: row.pagesAfter,
          pageMovedWords: row.pageMovedWords,
        })),
    },
    null,
    2
  )
);
