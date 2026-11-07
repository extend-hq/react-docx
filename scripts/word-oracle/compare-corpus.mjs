import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { diffChars } from "diff";
import {
  fileSha256,
  readEvidenceJson,
  referenceQualificationErrors,
} from "./corpus-evidence.mjs";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
if (args.includes("--help")) {
  console.log(
    "Usage: node scripts/word-oracle/compare-corpus.mjs --output PATH [--variants baseline,migrated] [--result comparison.json]"
  );
  process.exit(0);
}
const outputOption = option("--output", null);
if (!outputOption) throw new Error("--output is required");
const output = path.resolve(outputOption);
const inventoryPath = path.resolve(
  option("--inventory", path.join(output, "inventory.json"))
);
const variants = option("--variants", "baseline,migrated").split(",");
const profileSha256 = crypto
  .createHash("sha256")
  .update(await fs.readFile(fileURLToPath(import.meta.url)))
  .digest("hex");
const resultName = option("--result", "comparison.json");
const inventory = JSON.parse(await fs.readFile(inventoryPath, "utf8"));
let sourceFeatureAudit = null;
try {
  sourceFeatureAudit = JSON.parse(
    await fs.readFile(path.join(output, "feature-audit.json"), "utf8")
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const expectedCaptureProfile = await readJsonProfile();
async function readJsonProfile() {
  try {
    return JSON.parse(
      await fs.readFile(path.join(output, "capture-profile.json"), "utf8")
    );
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
const sourceFeaturesByHash = new Map(
  (sourceFeatureAudit?.documents ?? []).map((document) => [
    document.sourceSha256,
    document,
  ])
);
const identities = JSON.parse(
  await fs.readFile(path.join(output, "build-identities.json"), "utf8")
);
const wordEnvironment = await readEvidenceJson(
  path.join(output, "word-capture-environment.json")
);
const errorCategory = (message) => {
  const value = String(message ?? "");
  return /out of memory|Data cannot be cloned/i.test(value)
    ? "worker-transfer-memory"
    : /Unexpected end of JSON|JSON.*position|JSON.*parse/i.test(value)
    ? "parser-json-decoding"
    : /deadline|did not settle|Timeout/i.test(value)
    ? "capture-timeout-or-layout-unsettled"
    : /Source changed after inventory/i.test(value)
    ? "source-identity-changed"
    : /font|woff/i.test(value)
    ? "font-loading"
    : "renderer-error";
};
const normal = (text) =>
  String(text ?? "")
    .normalize("NFKC")
    .replace(/[\s\p{Cf}]/gu, "")
    .replace(/[\u2010\u2011]/gu, "-");
const number = (value) =>
  Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : null;
const ratio = (a, b) => (b ? number(a / b) : null);
const percentile = (values, fraction) =>
  values.length
    ? values.slice().sort((a, b) => a - b)[
        Math.floor((values.length - 1) * fraction)
      ]
    : null;
const readJson = readEvidenceJson;

function stream(pages, kind) {
  const chars = [];
  const charWords = [];
  const words = [];
  const pageTexts = [];
  const pageRanges = [];
  const lineBreaks = [];
  for (const [pageIndex, page] of pages.entries()) {
    const pageStart = chars.length;
    let priorLine = null;
    let renderLine = 0;
    let priorWord = null;
    const sourceWords =
      kind === "word"
        ? page.lines.flatMap((line, lineIndex) =>
            line.words.map((word) => ({ ...word, lineIndex }))
          )
        : page.words;
    for (const raw of sourceWords) {
      const normalized = [...normal(raw.text)];
      if (!normalized.length) continue;
      const bbox =
        kind === "word"
          ? [
              raw.bboxPt[0] / page.widthPt,
              raw.bboxPt[1] / page.heightPt,
              raw.bboxPt[2] / page.widthPt,
              raw.bboxPt[3] / page.heightPt,
            ]
          : raw.bbox;
      if (kind !== "word" && priorWord) {
        const overlap =
          Math.min(priorWord.bbox[3], bbox[3]) -
          Math.max(priorWord.bbox[1], bbox[1]);
        const minHeight = Math.min(
          priorWord.bbox[3] - priorWord.bbox[1],
          bbox[3] - bbox[1]
        );
        if (
          raw.paragraphId !== priorWord.paragraphId ||
          overlap < minHeight * 0.3
        )
          renderLine++;
      }
      const lineId = `${pageIndex}:${
        kind === "word" ? raw.lineIndex : renderLine
      }`;
      if (priorLine !== null && priorLine !== lineId)
        lineBreaks.push(chars.length);
      const word = {
        text: raw.text,
        normalized: normalized.join(""),
        start: chars.length,
        end: chars.length + normalized.length,
        pageIndex,
        lineId,
        bbox,
        paragraphId: raw.paragraphId,
        clippedFraction: raw.clippedFraction ?? 0,
      };
      const wordIndex = words.length;
      words.push(word);
      for (const character of normalized) {
        chars.push(character);
        charWords.push(wordIndex);
      }
      priorLine = lineId;
      priorWord = word;
    }
    pageTexts.push(chars.slice(pageStart).join(""));
    pageRanges.push([pageStart, chars.length]);
    if (pageIndex < pages.length - 1) lineBreaks.push(chars.length);
  }
  return {
    chars,
    text: chars.join(""),
    charWords,
    words,
    pageTexts,
    pageRanges,
    lineBreaks: new Set(
      lineBreaks.filter((boundary) => boundary > 0 && boundary < chars.length)
    ),
  };
}

function alignment(left, right) {
  const mapping = new Int32Array(left.length).fill(-1);
  const runLengths = new Int32Array(left.length);
  let unresolvedCharacters = 0;
  let remainingEditWork = 1048576;
  const apply = (parts, offsetA, offsetB) => {
    let a = offsetA;
    let b = offsetB;
    for (const part of parts) {
      if (part.added) b += part.count;
      else if (part.removed) a += part.count;
      else {
        for (let i = 0; i < part.count; i++) {
          mapping[a + i] = b + i;
          runLengths[a + i] = part.count;
        }
        a += part.count;
        b += part.count;
      }
    }
  };
  const direct = diffChars(left.join(""), right.join(""), {
    maxEditLength: 256,
  });
  if (direct) {
    apply(direct, 0, 0);
    return { mapping, runLengths, unresolvedCharacters, method: "exact-myers" };
  }
  const size = 24;
  const wanted = new Map();
  for (let i = 0; i + size <= left.length; i += size) {
    const key = left.slice(i, i + size).join("");
    if (wanted.has(key)) wanted.set(key, null);
    else wanted.set(key, i);
  }
  const found = new Map();
  for (let i = 0; i + size <= right.length; i++) {
    const key = right.slice(i, i + size).join("");
    if (wanted.get(key) != null) {
      if (found.has(key)) found.set(key, null);
      else found.set(key, i);
    }
  }
  const candidates = [...wanted]
    .flatMap(([key, a]) =>
      a != null && found.get(key) != null ? [{ a, b: found.get(key) }] : []
    )
    .sort((a, b) => a.a - b.a);
  const tails = [];
  const tailIndices = [];
  const previous = new Int32Array(candidates.length).fill(-1);
  for (const [i, candidate] of candidates.entries()) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const middle = (lo + hi) >>> 1;
      if (tails[middle] < candidate.b) lo = middle + 1;
      else hi = middle;
    }
    if (lo) previous[i] = tailIndices[lo - 1];
    tails[lo] = candidate.b;
    tailIndices[lo] = i;
  }
  const anchors = [];
  for (let i = tailIndices.at(-1); i != null && i >= 0; i = previous[i])
    anchors.push(candidates[i]);
  anchors.reverse();
  let a = 0;
  let b = 0;
  const finishGap = (aEnd, bEnd) => {
    let prefix = 0;
    while (
      a + prefix < aEnd &&
      b + prefix < bEnd &&
      left[a + prefix] === right[b + prefix]
    )
      prefix++;
    for (let i = 0; i < prefix; i++) {
      mapping[a + i] = b + i;
      runLengths[a + i] = prefix;
    }
    a += prefix;
    b += prefix;
    if (a < aEnd && b < bEnd) {
      const budget = Math.min(
        512,
        aEnd - a + bEnd - b,
        Math.floor(Math.sqrt(Math.max(0, remainingEditWork)))
      );
      remainingEditWork -= budget * budget;
      const parts =
        budget > 0
          ? diffChars(
              left.slice(a, aEnd).join(""),
              right.slice(b, bEnd).join(""),
              {
                maxEditLength: budget,
              }
            )
          : undefined;
      if (parts) apply(parts, a, b);
      else unresolvedCharacters += aEnd - a;
    }
    a = aEnd;
    b = bEnd;
  };
  for (const anchor of anchors) {
    if (anchor.a < a || anchor.b < b) continue;
    finishGap(anchor.a, anchor.b);
    for (let i = 0; i < size; i++) {
      mapping[a + i] = b + i;
      runLengths[a + i] = size;
    }
    a += size;
    b += size;
  }
  finishGap(left.length, right.length);
  return {
    mapping,
    runLengths,
    unresolvedCharacters,
    method: "unique-24-character-anchors-with-bounded-myers",
  };
}

function compare(reference, capture, receipt, alignmentCache) {
  const source = stream(reference.pages, "word");
  const target = stream(capture.geometry.pages, "renderer");
  let aligned = alignmentCache.get(target.text);
  if (!aligned) {
    aligned = alignment(source.chars, target.chars);
    alignmentCache.set(target.text, aligned);
  }
  let matched = 0;
  let fullyVisibleMatched = 0;
  let fullyVisibleCorrectPage = 0;
  let correctPage = 0;
  let trusted = 0;
  let trustedCorrectPage = 0;
  const perPage = reference.pages.map((page, i) => ({
    pageIndex: i,
    expectedCharacters: source.pageTexts[i].length,
    matchedCharacters: 0,
    correctPageCharacters: 0,
    rendererCharacters: target.pageTexts[i]?.length ?? 0,
    exactText: source.pageTexts[i] === target.pageTexts[i],
    referenceWidthPt: page.widthPt,
    referenceHeightPt: page.heightPt,
    rendererWidthCssPx: capture.geometry.pages[i]?.widthCssPx ?? null,
    rendererHeightCssPx: capture.geometry.pages[i]?.heightCssPx ?? null,
  }));
  for (let i = 0; i < aligned.mapping.length; i++) {
    const j = aligned.mapping[i];
    if (j < 0) continue;
    matched++;
    const page = source.words[source.charWords[i]].pageIndex;
    const samePage = page === target.words[target.charWords[j]].pageIndex;
    perPage[page].matchedCharacters++;
    if (target.words[target.charWords[j]].clippedFraction <= 0.01) {
      fullyVisibleMatched++;
      if (samePage) fullyVisibleCorrectPage++;
    }
    if (samePage) {
      correctPage++;
      perPage[page].correctPageCharacters++;
    }
    if (aligned.runLengths[i] >= 16) {
      trusted++;
      if (samePage) trustedCorrectPage++;
    }
  }
  const positionMatches = new Map();
  const xErrors = [];
  const yErrors = [];
  const heightErrors = [];
  const widthErrors = [];
  const positions = [];
  let positionCharacters = 0;
  let positionedWithin2Pt = 0;
  let positionedWithin5Pt = 0;
  for (const word of source.words) {
    const start = aligned.mapping[word.start];
    if (start < 0 || aligned.runLengths[word.start] < 16) continue;
    let complete = true;
    for (let i = word.start; i < word.end; i++) {
      if (aligned.mapping[i] !== start + i - word.start) {
        complete = false;
        break;
      }
    }
    if (!complete) continue;
    const end = start + word.end - word.start;
    const first = target.words[target.charWords[start]];
    const last = target.words[target.charWords[end - 1]];
    if (
      first.start !== start ||
      last.end !== end ||
      first.pageIndex !== word.pageIndex ||
      last.pageIndex !== word.pageIndex ||
      first.lineId !== last.lineId
    )
      continue;
    const matchedWords = target.words.slice(
      target.charWords[start],
      target.charWords[end - 1] + 1
    );
    if (matchedWords.some((matchedWord) => matchedWord.clippedFraction > 0.01))
      continue;
    const bbox = [
      Math.min(...matchedWords.map((w) => w.bbox[0])),
      Math.min(...matchedWords.map((w) => w.bbox[1])),
      Math.max(...matchedWords.map((w) => w.bbox[2])),
      Math.max(...matchedWords.map((w) => w.bbox[3])),
    ];
    const page = reference.pages[word.pageIndex];
    const x = Math.abs(word.bbox[0] - bbox[0]) * page.widthPt;
    const y = Math.abs(word.bbox[1] - bbox[1]) * page.heightPt;
    const width =
      Math.abs(word.bbox[2] - word.bbox[0] - (bbox[2] - bbox[0])) *
      page.widthPt;
    const height =
      Math.abs(word.bbox[3] - word.bbox[1] - (bbox[3] - bbox[1])) *
      page.heightPt;
    const length = word.end - word.start;
    positionCharacters += length;
    positionMatches.set(`${word.start}:${word.end}`, {
      x,
      y,
      width,
      height,
      characters: length,
    });
    if (x <= 2 && y <= 2) positionedWithin2Pt += length;
    if (x <= 5 && y <= 5) positionedWithin5Pt += length;
    xErrors.push(x);
    yErrors.push(y);
    widthErrors.push(width);
    heightErrors.push(height);
    if (positions.length < 25 && (x > 5 || y > 5))
      positions.push({
        text: word.text,
        pageIndex: word.pageIndex,
        referenceBbox: word.bbox,
        rendererBbox: bbox,
        xErrorPt: number(x),
        yErrorPt: number(y),
      });
  }
  let exactPageBoundaries = 0;
  const boundaries = [];
  for (let page = 1; page < source.pageRanges.length; page++) {
    const boundary = source.pageRanges[page][0];
    const beforeStart = Math.max(source.pageRanges[page - 1][0], boundary - 32);
    const afterEnd = Math.min(source.pageRanges[page][1], boundary + 32);
    let exact = beforeStart < boundary && afterEnd > boundary;
    for (let i = beforeStart; exact && i < afterEnd; i++) {
      const j = aligned.mapping[i];
      if (
        j < 0 ||
        target.words[target.charWords[j]].pageIndex !==
          (i < boundary ? page - 1 : page)
      )
        exact = false;
    }
    if (exact) exactPageBoundaries++;
    boundaries.push({
      beforePageIndex: page - 1,
      afterPageIndex: page,
      exactAnchors: exact,
      referenceBefore: source.chars.slice(beforeStart, boundary).join(""),
      referenceAfter: source.chars.slice(boundary, afterEnd).join(""),
    });
  }
  let exactLineBreaks = 0;
  for (const boundary of source.lineBreaks) {
    if (boundary <= 0 || boundary >= source.chars.length) continue;
    const before = aligned.mapping[boundary - 1];
    const after = aligned.mapping[boundary];
    if (
      before >= 0 &&
      after === before + 1 &&
      target.lineBreaks.has(after) &&
      aligned.runLengths[boundary - 1] >= 16 &&
      aligned.runLengths[boundary] >= 16
    )
      exactLineBreaks++;
  }
  const expected = source.chars.length;
  const actual = target.chars.length;
  const exactPageCount = reference.pages.length === capture.geometry.pageCount;
  const failedImages = capture.geometry.pages.reduce(
    (sum, page) => sum + page.images.filter((image) => !image.loaded).length,
    0
  );
  const clippedWordCount = capture.geometry.pages.reduce(
    (sum, page) =>
      sum + page.words.filter((word) => word.clippedFraction > 0.01).length,
    0
  );
  const zoom = capture.geometry.resolvedZoom / 100;
  const pageSizeErrors = reference.pages.map((page, i) => {
    const rendered = capture.geometry.pages[i];
    return rendered && zoom > 0
      ? {
          pageIndex: i,
          widthErrorPt: number(
            Math.abs((rendered.widthCssPx / zoom) * 0.75 - page.widthPt)
          ),
          heightErrorPt: number(
            Math.abs((rendered.heightCssPx / zoom) * 0.75 - page.heightPt)
          ),
        }
      : { pageIndex: i, widthErrorPt: null, heightErrorPt: null };
  });
  const pageSizeMatches =
    exactPageCount &&
    pageSizeErrors.every(
      (page) =>
        page.widthErrorPt !== null &&
        page.widthErrorPt <= 0.75 &&
        page.heightErrorPt !== null &&
        page.heightErrorPt <= 0.75
    );
  const allTextAligned =
    matched === expected &&
    matched === actual &&
    aligned.unresolvedCharacters === 0;
  const bodyText = normal(
    capture.geometry.pages
      .flatMap((page) =>
        page.words
          .filter((word) => word.region === "body")
          .map((word) => word.text)
      )
      .join("")
  );
  const result = {
    status: "ok",
    normalizedTextSha256: crypto
      .createHash("sha256")
      .update(target.text)
      .digest("hex"),
    referencePageCount: reference.pages.length,
    rendererPageCount: capture.geometry.pageCount,
    exactPageCount,
    exactPageCountWithCompleteText:
      exactPageCount &&
      allTextAligned &&
      fullyVisibleMatched === expected &&
      clippedWordCount === 0 &&
      failedImages === 0,
    qualifiedPageParity:
      expected > 0
        ? exactPageCount &&
          pageSizeMatches &&
          correctPage === expected &&
          perPage.every((page) => page.exactText) &&
          allTextAligned &&
          fullyVisibleMatched === expected &&
          clippedWordCount === 0 &&
          failedImages === 0
        : null,
    pageSizeMatches,
    pageSizeErrors,
    exactPageText: exactPageCount && perPage.every((page) => page.exactText),
    exactPageTextCount: perPage.filter((page) => page.exactText).length,
    expectedCharacters: expected,
    rendererCharacters: actual,
    matchedCharacters: matched,
    missingOrUnalignedCharacters: expected - matched,
    extraOrUnalignedCharacters: actual - matched,
    textRecall: ratio(matched, expected),
    fullyVisibleTextRecall: ratio(fullyVisibleMatched, expected),
    fullyVisiblePageMembershipRecall: ratio(fullyVisibleCorrectPage, expected),
    fullyVisibleMatchedCharacters: fullyVisibleMatched,
    fullyVisibleCorrectPageCharacters: fullyVisibleCorrectPage,
    textPrecision: ratio(matched, actual),
    correctPageCharacters: correctPage,
    pageMembershipRecall: ratio(correctPage, expected),
    alignedPageMembership: ratio(correctPage, matched),
    trustedMatchedCharacters: trusted,
    trustedCorrectPageCharacters: trustedCorrectPage,
    trustedPageMembershipRecall: ratio(trustedCorrectPage, expected),
    wordPositionCount: xErrors.length,
    wordPositionCharacters: positionCharacters,
    wordPositionCoverage: ratio(positionCharacters, expected),
    positionWithin2PtRecall: ratio(positionedWithin2Pt, expected),
    positionWithin5PtRecall: ratio(positionedWithin5Pt, expected),
    xErrorPtMedian: number(percentile(xErrors, 0.5)),
    xErrorPtP95: number(percentile(xErrors, 0.95)),
    yErrorPtMedian: number(percentile(yErrors, 0.5)),
    yErrorPtP95: number(percentile(yErrors, 0.95)),
    widthErrorPtMedian: number(percentile(widthErrors, 0.5)),
    heightErrorPtMedian: number(percentile(heightErrors, 0.5)),
    lineBreakCount: source.lineBreaks.size,
    exactLineBreaks,
    lineBreakRecall: ratio(exactLineBreaks, source.lineBreaks.size),
    physicalPageBoundaryCount: boundaries.length,
    pageBoundaryCount: boundaries.filter(
      (boundary) => boundary.referenceBefore && boundary.referenceAfter
    ).length,
    exactPageBoundaries,
    pageBoundaryRecall: ratio(
      exactPageBoundaries,
      boundaries.filter(
        (boundary) => boundary.referenceBefore && boundary.referenceAfter
      ).length
    ),
    alignmentMethod: aligned.method,
    unresolvedCharacters: aligned.unresolvedCharacters,
    sourceMainStoryCharacters: [...normal(capture.geometry.sourceMainStoryText)]
      .length,
    visibleBodyCharacters: [...bodyText].length,
    nativeTextEmptyPageIndices: reference.pages.flatMap((page, i) =>
      source.pageTexts[i].length ? [] : [i]
    ),
    rendererNativeTextEmptyPageIndices: capture.geometry.pages.flatMap(
      (page, i) => (target.pageTexts[i].length ? [] : [i])
    ),
    reportedPageCount: capture.geometry.reportedPageCount,
    resolvedZoom: capture.geometry.resolvedZoom,
    readyMs: capture.readyMs,
    extractMs: capture.extractMs,
    elapsedMs: capture.elapsedMs,
    wordExportSeconds: receipt.elapsedSeconds,
    httpFailures: capture.httpFailures ?? [],
    failedFontFaces: (capture.geometry.fontFaceStatuses ?? []).filter(
      (face) => face.status === "error"
    ),
    requestedFontFamilies: capture.geometry.requestedFontFamilies ?? [],
    imageCount: capture.geometry.pages.reduce(
      (sum, page) => sum + page.images.length,
      0
    ),
    failedImages,
    clippedWordCount,
    perPage,
    pageBoundaries: boundaries,
    positionSamples: positions,
    printedPageLabelParity: "unqualified-footer-candidates-only",
    printedPageLabelCandidates: reference.pages.map((page, i) => ({
      pageIndex: i,
      referenceBottomText: page.lines
        .filter((line) => line.bboxPt[1] / page.heightPt >= 0.85)
        .map((line) => line.text)
        .join(" "),
      rendererFooterText: capture.geometry.pages[i]?.footerText ?? "",
    })),
  };
  Object.defineProperty(result, "positionMatches", {
    value: positionMatches,
    enumerable: false,
  });
  return result;
}

const rows = [];
for (const document of inventory.documents) {
  const row = {
    id: document.id,
    sourceSha256: document.sha256,
    sourcePath: document.sourcePath,
    format: document.format,
    group: document.group ?? "unknown",
    cohort: document.cohort ?? "unknown",
    eligible: document.eligible,
    classificationReason: document.classificationReason,
    byteSize: document.byteSize,
    provenance: document.provenance,
    variants: {},
  };
  const sourceFeatures = sourceFeaturesByHash.get(document.sha256);
  row.sourceFeatureStatus = sourceFeatures?.status ?? "unavailable";
  row.complexity = sourceFeatures?.complexity ?? null;
  const features = sourceFeatures?.features?.allStories;
  row.sourceFeatures = features
    ? {
        tables: features.tables,
        nestedTables: features.nestedTables,
        multiColumnSections: features.multiColumnSections,
        floatingDrawings: features.floatingDrawings,
        legacyPositionedShapes: features.legacyPositionedShapes,
        textBoxes: features.textBoxes,
        footnoteReferences: features.footnoteReferences,
        endnoteReferences: features.endnoteReferences,
        pageNumberFields: features.fields?.pageNumberFields,
        explicitPageBreaks: features.explicitPageBreaks,
        cjkCharacters: features.cjkCharacterCount,
        bidiScriptCharacters: features.bidiScriptCharacterCount,
        directKeepNextEnabled: features.settings?.keepNext?.explicitEnabled,
        directKeepLinesEnabled: features.settings?.keepLines?.explicitEnabled,
        directWidowControlEnabled:
          features.settings?.widowControl?.explicitEnabled,
      }
    : null;
  rows.push(row);
  if (!document.eligible) {
    row.status = "ineligible";
    continue;
  }
  const receipt = await readJson(
    path.join(output, "word-references", `${document.sha256}.receipt.json`)
  );
  row.wordStatus = receipt?.status ?? "pending";
  row.wordError = receipt?.error ?? null;
  row.referencePageCount =
    receipt?.status === "ok" ? receipt.physicalPageCount : null;
  row.referenceNativeWordCount =
    receipt?.status === "ok" ? receipt.wordCount : null;
  row.wordRepairsObserved = Boolean(
    receipt?.wordRepairsObserved || receipt?.observation?.wordRepairsObserved
  );
  row.wordRepairObservation = receipt?.observation ?? null;
  row.wordReceiptSha256 = receipt?.artifactSha256 ?? null;
  row.wordPdfSha256 = receipt?.pdfSha256 ?? null;
  row.wordGeometrySha256 = receipt?.geometrySha256 ?? null;
  row.wordEnvironmentSha256 = receipt?.environmentSha256 ?? null;
  if (receipt?.sourceSha256 !== document.sha256 && receipt) {
    row.wordStatus = "source-hash-mismatch";
  }
  if (row.wordStatus === "ok") {
    const errors = referenceQualificationErrors(
      receipt,
      document.sha256,
      wordEnvironment
    );
    if (errors.length) {
      row.wordStatus = "reference-profile-unqualified";
      row.wordError = errors.join("; ");
    } else {
      try {
        if ((await fileSha256(document.sourcePath)) !== document.sha256)
          throw new Error("Current source hash mismatch");
        if ((await fileSha256(receipt.pdfPath)) !== receipt.pdfSha256)
          throw new Error("PDF hash mismatch");
      } catch (error) {
        row.wordStatus = "invalid-reference";
        row.wordError = String(error);
      }
    }
  }
  const captures = new Map();
  for (const variant of variants)
    captures.set(
      variant,
      await readJson(
        path.join(output, "renderer", variant, `${document.sha256}.json`)
      )
    );
  const hasQualifiedCapture = variants.some((variant) => {
    const capture = captures.get(variant);
    return (
      capture?.status === "ok" &&
      capture.sourceSha256 === document.sha256 &&
      capture.buildSha256 === identities.builds[variant].buildSha256 &&
      expectedCaptureProfile &&
      capture.captureProfileSha256 ===
        expectedCaptureProfile.captureProfileSha256 &&
      capture.captureConfiguration?.mode === "read-only"
    );
  });
  let reference = null;
  if (row.wordStatus === "ok" && hasQualifiedCapture) {
    try {
      const bytes = await fs.readFile(receipt.geometryPath);
      if (
        crypto.createHash("sha256").update(bytes).digest("hex") !==
        receipt.geometrySha256
      )
        throw new Error("Geometry hash mismatch");
      reference = JSON.parse(bytes);
      if (
        reference.pages.length !== receipt.physicalPageCount ||
        reference.pages.some(
          (page, i) =>
            (page.pageIndex0 ?? page.pageIndex) !== i ||
            !Number.isFinite(page.widthPt) ||
            !Number.isFinite(page.heightPt) ||
            page.widthPt <= 0 ||
            page.heightPt <= 0
        )
      )
        throw new Error("Physical page index or dimensions invalid");
    } catch (error) {
      reference = null;
      row.wordStatus = "invalid-reference";
      row.wordError = String(error);
    }
  } else if (row.wordStatus === "ok") {
    try {
      if ((await fileSha256(receipt.geometryPath)) !== receipt.geometrySha256)
        throw new Error("Geometry hash mismatch");
    } catch (error) {
      row.wordStatus = "invalid-reference";
      row.wordError = String(error);
    }
  }
  row.captureIdentities = Object.fromEntries(
    variants.map((variant) => {
      const capture = captures.get(variant);
      return [
        variant,
        capture
          ? {
              captureSha256: capture.artifactSha256,
              buildSha256: capture.buildSha256,
              captureProfileSha256: capture.captureProfileSha256,
              sourceSha256: capture.sourceSha256,
            }
          : null,
      ];
    })
  );
  const alignmentCache = new Map();
  for (const variant of variants) {
    const capture = captures.get(variant);
    if (!capture) {
      row.variants[variant] = { status: "capture-pending" };
      continue;
    }
    if (
      !expectedCaptureProfile ||
      capture.captureProfileSha256 !==
        expectedCaptureProfile.captureProfileSha256 ||
      capture.captureConfiguration?.mode !== "read-only"
    ) {
      row.variants[variant] = { status: "capture-profile-unqualified" };
      continue;
    }
    if (
      capture.sourceSha256 !== document.sha256 ||
      capture.buildSha256 !== identities.builds[variant].buildSha256
    ) {
      row.variants[variant] = { status: "capture-identity-mismatch" };
      continue;
    }
    if (capture.status !== "ok") {
      row.variants[variant] = {
        status: "capture-failed",
        errorCategory: errorCategory(capture.error),
        error: capture.error,
        elapsedMs: capture.elapsedMs,
      };
      continue;
    }
    if (!reference) {
      row.variants[variant] = {
        status: "reference-unavailable",
        rendererPageCount: capture.geometry.pageCount,
        readyMs: capture.readyMs,
        elapsedMs: capture.elapsedMs,
      };
      continue;
    }
    row.variants[variant] = compare(
      reference,
      capture,
      receipt,
      alignmentCache
    );
  }
  const [before, after] = variants.map((variant) => row.variants[variant]);
  if (before?.status === "ok" && after?.status === "ok") {
    const commonPositions = [...before.positionMatches].flatMap(
      ([key, position]) =>
        after.positionMatches.has(key)
          ? [{ before: position, after: after.positionMatches.get(key) }]
          : []
    );
    row.commonGeometry = {
      comparedWords: commonPositions.length,
      comparedCharacters: commonPositions.reduce(
        (sum, position) => sum + position.before.characters,
        0
      ),
      xErrorPtMedianBefore: number(
        percentile(
          commonPositions.map((position) => position.before.x),
          0.5
        )
      ),
      xErrorPtMedianAfter: number(
        percentile(
          commonPositions.map((position) => position.after.x),
          0.5
        )
      ),
      yErrorPtMedianBefore: number(
        percentile(
          commonPositions.map((position) => position.before.y),
          0.5
        )
      ),
      yErrorPtMedianAfter: number(
        percentile(
          commonPositions.map((position) => position.after.y),
          0.5
        )
      ),
    };
    const deltaQualified =
      (before.unresolvedCharacters === 0 && after.unresolvedCharacters === 0) ||
      before.normalizedTextSha256 === after.normalizedTextSha256;
    row.deltaQualification = deltaQualified
      ? "same-alignment-coverage"
      : "unresolved-alignment";
    const change = (metric) =>
      !deltaQualified && metric !== "readyMs"
        ? null
        : before[metric] == null || after[metric] == null
        ? null
        : number(after[metric] - before[metric]);
    row.delta = {
      textRecall: change("textRecall"),
      fullyVisibleTextRecall: change("fullyVisibleTextRecall"),
      fullyVisiblePageMembershipRecall: change(
        "fullyVisiblePageMembershipRecall"
      ),
      pageMembershipRecall: change("pageMembershipRecall"),
      lineBreakRecall: change("lineBreakRecall"),
      positionWithin2PtRecall: change("positionWithin2PtRecall"),
      xErrorPtMedian:
        deltaQualified && commonPositions.length
          ? number(
              row.commonGeometry.xErrorPtMedianAfter -
                row.commonGeometry.xErrorPtMedianBefore
            )
          : null,
      yErrorPtMedian:
        deltaQualified && commonPositions.length
          ? number(
              row.commonGeometry.yErrorPtMedianAfter -
                row.commonGeometry.yErrorPtMedianBefore
            )
          : null,
      readyMs: change("readyMs"),
      pageCountError:
        Math.abs(after.rendererPageCount - after.referencePageCount) -
        Math.abs(before.rendererPageCount - before.referencePageCount),
      lostAlignedCharacters: deltaQualified
        ? Math.max(0, before.matchedCharacters - after.matchedCharacters)
        : null,
    };
  }
}
const aggregate = {};
for (const variant of variants) {
  const all = rows
    .filter((row) => row.eligible)
    .map((row) => row.variants[variant]);
  const independentlyComparable = all.filter((row) => row.status === "ok");
  const comparable = rows
    .filter(
      (row) =>
        row.eligible &&
        !row.wordRepairsObserved &&
        variants.every((name) => row.variants[name]?.status === "ok")
    )
    .map((row) => row.variants[variant]);
  const comparableRows = rows.filter(
    (row) =>
      row.eligible &&
      !row.wordRepairsObserved &&
      variants.every((name) => row.variants[name]?.status === "ok")
  );
  const fidelityComparable = comparableRows
    .filter((row) => row.deltaQualification === "same-alignment-coverage")
    .map((row) => row.variants[variant]);
  const macro = (key) => {
    const values = fidelityComparable
      .map((row) => row[key])
      .filter(Number.isFinite);
    return values.length
      ? number(values.reduce((sum, value) => sum + value, 0) / values.length)
      : null;
  };
  const referenceRows = rows.filter(
    (row) => row.eligible && row.wordStatus === "ok" && !row.wordRepairsObserved
  );
  const failedReferenceRows = referenceRows.filter(
    (row) => row.variants[variant]?.status === "capture-failed"
  );
  const sumAll = (key) =>
    comparable.reduce((value, row) => value + (row[key] ?? 0), 0);
  const sum = (key) =>
    fidelityComparable.reduce((value, row) => value + (row[key] ?? 0), 0);
  aggregate[variant] = {
    statusCounts: Object.fromEntries(
      [...new Set(all.map((row) => row.status))].map((status) => [
        status,
        all.filter((row) => row.status === status).length,
      ])
    ),
    independentlyComparableDocuments: independentlyComparable.length,
    comparableDocuments: comparable.length,
    referenceAvailableDocuments: referenceRows.length,
    referenceAvailablePages: referenceRows.reduce(
      (sum, row) => sum + (row.referencePageCount ?? 0),
      0
    ),
    rendererFailedReferenceDocuments: failedReferenceRows.length,
    rendererFailedReferencePages: failedReferenceRows.reduce(
      (sum, row) => sum + (row.referencePageCount ?? 0),
      0
    ),
    pairedReferencePages: comparable.reduce(
      (sum, row) => sum + row.referencePageCount,
      0
    ),
    fullyVisibleTextRecallMacro: macro("fullyVisibleTextRecall"),
    fullyVisiblePageMembershipRecallMacro: macro(
      "fullyVisiblePageMembershipRecall"
    ),
    lineBreakRecallMacro: macro("lineBreakRecall"),
    positionWithin2PtRecallMacro: macro("positionWithin2PtRecall"),
    comparisonCohort: "paired-successful-unrepaired-documents-only",
    fidelityComparisonCohort:
      "same-alignment-coverage-paired-unrepaired-documents-only",
    fidelityComparableDocuments: fidelityComparable.length,
    unresolvedAlignmentDocuments: comparable.filter(
      (row) => row.unresolvedCharacters > 0
    ).length,
    unresolvedCharacters: sumAll("unresolvedCharacters"),
    allComparableExpectedCharacters: sumAll("expectedCharacters"),
    allComparableTextRecallLowerBound: ratio(
      sumAll("matchedCharacters"),
      sumAll("expectedCharacters")
    ),
    repairedReferenceDocuments: rows.filter(
      (row) => row.wordRepairsObserved && row.variants[variant]?.status === "ok"
    ).length,
    exactPageCount: comparable.filter((row) => row.exactPageCount).length,
    exactPageCountWithCompleteText: comparable.filter(
      (row) => row.exactPageCountWithCompleteText
    ).length,
    qualifiedPageParity: comparable.filter((row) => row.qualifiedPageParity)
      .length,
    exactPageText: comparable.filter((row) => row.exactPageText).length,
    expectedCharacters: sum("expectedCharacters"),
    matchedCharacters: sum("matchedCharacters"),
    missingOrUnalignedCharacters: sum("missingOrUnalignedCharacters"),
    correctPageCharacters: sum("correctPageCharacters"),
    textRecall: ratio(sum("matchedCharacters"), sum("expectedCharacters")),
    fullyVisibleTextRecall: ratio(
      sum("fullyVisibleMatchedCharacters"),
      sum("expectedCharacters")
    ),
    fullyVisiblePageMembershipRecall: ratio(
      sum("fullyVisibleCorrectPageCharacters"),
      sum("expectedCharacters")
    ),
    pageMembershipRecall: ratio(
      sum("correctPageCharacters"),
      sum("expectedCharacters")
    ),
    lineBreakRecall: ratio(sum("exactLineBreaks"), sum("lineBreakCount")),
    wordPositionCoverage: ratio(
      sum("wordPositionCharacters"),
      sum("expectedCharacters")
    ),
    readyMsMedian: number(
      percentile(
        comparable.map((row) => row.readyMs),
        0.5
      )
    ),
    readyMsP95: number(
      percentile(
        comparable.map((row) => row.readyMs),
        0.95
      )
    ),
  };
}
const paired = rows.filter((row) => row.delta && !row.wordRepairsObserved);
const sourceGroups = Object.fromEntries(
  [...new Set(rows.map((row) => row.group))].map((group) => {
    const members = rows.filter((row) => row.group === group);
    const qualified = members.filter(
      (row) =>
        row.delta &&
        !row.wordRepairsObserved &&
        row.deltaQualification === "same-alignment-coverage"
    );
    return [
      group,
      {
        inventoriedDocuments: members.length,
        eligibleDocuments: members.filter((row) => row.eligible).length,
        fidelityPairedDocuments: qualified.length,
        variants: Object.fromEntries(
          variants.map((variant) => {
            const records = qualified.map((row) => row.variants[variant]);
            const expected = records.reduce(
              (sum, record) => sum + record.expectedCharacters,
              0
            );
            return [
              variant,
              {
                expectedCharacters: expected,
                fullyVisiblePageMembershipRecall: ratio(
                  records.reduce(
                    (sum, record) =>
                      sum + record.fullyVisibleCorrectPageCharacters,
                    0
                  ),
                  expected
                ),
                exactPageCount: records.filter(
                  (record) => record.exactPageCount
                ).length,
                qualifiedPageParity: records.filter(
                  (record) => record.qualifiedPageParity
                ).length,
              },
            ];
          })
        ),
      },
    ];
  })
);
const result = {
  schemaVersion: 1,
  sourceGroups,
  generatedAt: new Date().toISOString(),
  comparisonProfileSha256: profileSha256,
  evidencePolicySha256: await fileSha256(
    new URL("./corpus-evidence.mjs", import.meta.url)
  ),
  wordEnvironmentSha256: wordEnvironment?.artifactSha256 ?? null,
  inventoryPath,
  variants,
  corpusDocuments: rows.length,
  eligibleDocuments: rows.filter((row) => row.eligible).length,
  pairedDocuments: paired.length,
  aggregate,
  changes: Object.fromEntries(
    [
      "pageMembershipRecall",
      "fullyVisiblePageMembershipRecall",
      "lineBreakRecall",
      "textRecall",
      "fullyVisibleTextRecall",
      "positionWithin2PtRecall",
    ].map((metric) => [
      metric,
      {
        improved: paired.filter((row) => row.delta[metric] > 0.000001).length,
        regressed: paired.filter((row) => row.delta[metric] < -0.000001).length,
        unchanged: paired.filter(
          (row) =>
            Number.isFinite(row.delta[metric]) &&
            Math.abs(row.delta[metric]) <= 0.000001
        ).length,
        unavailable: paired.filter((row) => !Number.isFinite(row.delta[metric]))
          .length,
      },
    ])
  ),
  methods: {
    normalization:
      "Unicode NFKC, whitespace and format controls removed, U+2010/U+2011 mapped to ASCII hyphen; case retained",
    alignment:
      "Deterministic character diff (256 edit direct limit;24-character unique anchors;512edit gap cap;1048576 allocated gap edit-work budget), cached for identical variant text; unresolved characters stay in recall denominators but changed-text deltas with unresolved alignment are unavailable",
    geometry:
      "Complete aligned words in exact runs of at least16characters, same physical page and line, unclipped; renderer boxes normalized by actual page rectangle then converted to reference PDF points",
    limitations: [
      "Native PDF text only; rasterized chart/image text may be unaligned without being visually absent; zero-text references have no qualified text-layout parity result",
      "PDF glyph boxes and DOM inline boxes have different vertical metrics; y residuals are comparative proxies",
      "Printed page labels are footer candidates retained for audit; physical page ordinal is scored independently",
      "Page-count equality receives complete-text credit only when all normalized reference and renderer characters align, no words are partially clipped by more than1%, and all images loaded; qualified page parity also checks actual page dimensions within0.75point",
      "Font diagnostics observe registered FontFaceSet entries and HTTP failures; they do not prove the absence of system fallback or embedded faces discarded after load failure",
      "Single cold browser context per variant and document; ready latency includes font/image settling and stable-paint guard",
    ],
  },
  documents: rows,
};
await fs.writeFile(
  path.join(output, resultName + ".tmp"),
  JSON.stringify(result)
);
await fs.rename(
  path.join(output, resultName + ".tmp"),
  path.join(output, resultName)
);
console.log(
  JSON.stringify(
    {
      generatedAt: result.generatedAt,
      pairedDocuments: result.pairedDocuments,
      aggregate: result.aggregate,
      changes: result.changes,
    },
    null,
    2
  )
);
