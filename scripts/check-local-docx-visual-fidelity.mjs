import { execFile, execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";

const DEFAULT_DOCX_TESTING_ROOT = "/Users/andrewluo/Documents/DOCX testing";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4173;
const DEFAULT_MEAN_ABS_THRESHOLD = 0.085;
const DEFAULT_MISMATCH_RATIO_THRESHOLD = 0.2;
const DEFAULT_COMPARISON_WIDTH = 396;
const DEFAULT_COMPARISON_HEIGHT = 560;
const DEFAULT_TOLERANCE = 18;

function parseArgs(argv) {
  const options = {
    docxTestingRoot: DEFAULT_DOCX_TESTING_ROOT,
    groundTruthRoot: "",
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    baseUrl: "",
    limit: undefined,
    filter: "",
    noServer: false,
    meanAbsThreshold: DEFAULT_MEAN_ABS_THRESHOLD,
    mismatchRatioThreshold: DEFAULT_MISMATCH_RATIO_THRESHOLD,
    comparisonWidth: DEFAULT_COMPARISON_WIDTH,
    comparisonHeight: DEFAULT_COMPARISON_HEIGHT,
    tolerance: DEFAULT_TOLERANCE
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--docx-testing-root":
        options.docxTestingRoot = argv[index + 1] ?? options.docxTestingRoot;
        index += 1;
        break;
      case "--ground-truth-root":
        options.groundTruthRoot = argv[index + 1] ?? options.groundTruthRoot;
        index += 1;
        break;
      case "--host":
        options.host = argv[index + 1] ?? options.host;
        index += 1;
        break;
      case "--port":
        options.port = Number.parseInt(argv[index + 1] ?? "", 10) || options.port;
        index += 1;
        break;
      case "--base-url":
        options.baseUrl = argv[index + 1] ?? options.baseUrl;
        index += 1;
        break;
      case "--limit":
        options.limit = Number.parseInt(argv[index + 1] ?? "", 10) || undefined;
        index += 1;
        break;
      case "--filter":
        options.filter = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--mean-abs-threshold":
        options.meanAbsThreshold =
          Number.parseFloat(argv[index + 1] ?? "") || options.meanAbsThreshold;
        index += 1;
        break;
      case "--mismatch-ratio-threshold":
        options.mismatchRatioThreshold =
          Number.parseFloat(argv[index + 1] ?? "") || options.mismatchRatioThreshold;
        index += 1;
        break;
      case "--comparison-width":
        options.comparisonWidth =
          Number.parseInt(argv[index + 1] ?? "", 10) || options.comparisonWidth;
        index += 1;
        break;
      case "--comparison-height":
        options.comparisonHeight =
          Number.parseInt(argv[index + 1] ?? "", 10) || options.comparisonHeight;
        index += 1;
        break;
      case "--tolerance":
        options.tolerance =
          Number.parseInt(argv[index + 1] ?? "", 10) || options.tolerance;
        index += 1;
        break;
      case "--no-server":
        options.noServer = true;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.groundTruthRoot =
    options.groundTruthRoot || path.join(options.docxTestingRoot, "docx page split testing");
  options.baseUrl = options.baseUrl || `http://${options.host}:${options.port}`;
  return options;
}

function printUsage() {
  console.log(`Usage:
  node scripts/check-local-docx-visual-fidelity.mjs [options]

Options:
  --docx-testing-root <path>         Defaults to ${DEFAULT_DOCX_TESTING_ROOT}
  --ground-truth-root <path>         Defaults to "<docx-testing-root>/docx page split testing"
  --host <host>                      Defaults to ${DEFAULT_HOST}
  --port <port>                      Defaults to ${DEFAULT_PORT}
  --base-url <url>                   Override the viewer URL directly
  --no-server                        Reuse an already-running viewer instead of starting one
  --filter <substring>               Only compare docs whose file name contains this substring
  --limit <count>                    Only compare the first N matching docs
  --mean-abs-threshold <ratio>       Defaults to ${DEFAULT_MEAN_ABS_THRESHOLD}
  --mismatch-ratio-threshold <ratio> Defaults to ${DEFAULT_MISMATCH_RATIO_THRESHOLD}
  --comparison-width <px>            Defaults to ${DEFAULT_COMPARISON_WIDTH}
  --comparison-height <px>           Defaults to ${DEFAULT_COMPARISON_HEIGHT}
  --tolerance <0-255>                Defaults to ${DEFAULT_TOLERANCE}`);
}

function slugify(value) {
  return value
    .replace(/\.docx$/i, "")
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function listPidsOnPort(port) {
  try {
    const output = execFileSync("lsof", ["-ti", `tcp:${port}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return output
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value) && value > 0);
  } catch {
    return [];
  }
}

async function freePort(port) {
  const pids = [...new Set(listPidsOnPort(port))].filter((pid) => pid !== process.pid);
  if (pids.length === 0) {
    return;
  }

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Ignore exited processes.
    }
  }

  await delay(250);

  const remaining = [...new Set(listPidsOnPort(port))].filter((pid) => pid !== process.pid);
  for (const pid of remaining) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Ignore exited processes.
    }
  }
}

async function waitForUrl(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) {
        return;
      }
    } catch {
      // Keep waiting.
    }
    await delay(400);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function startViewerServer(options) {
  await freePort(options.port);
  const child = spawn(
    "pnpm",
    [
      "--filter",
      "@react-docx/playground",
      "dev",
      "--host",
      options.host,
      "--port",
      String(options.port)
    ],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: process.platform === "win32"
    }
  );
  await waitForUrl(options.baseUrl);
  return child;
}

async function loadManifest(manifestPath, options) {
  const raw = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const filterNeedle = options.filter.trim().toLowerCase();
  const files = raw.files
    .filter((entry) => entry.status === "ok")
    .filter((entry) =>
      filterNeedle.length === 0 || path.basename(entry.input).toLowerCase().includes(filterNeedle)
    )
    .slice(0, options.limit ?? Number.POSITIVE_INFINITY);
  return files;
}

async function listGroundTruthPages(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^page-\d+\.png$/i.test(entry.name))
    .map((entry) => ({
      absolutePath: path.join(directory, entry.name),
      pageNumber: Number.parseInt(entry.name.match(/\d+/)?.[0] ?? "", 10)
    }))
    .filter((entry) => Number.isFinite(entry.pageNumber))
    .sort((left, right) => left.pageNumber - right.pageNumber);
}

async function waitForDocumentLoad(page, expectedFileName) {
  await page.waitForFunction(
    (fileName) => {
      const hooks = window.__DOCX_TEST_HOOKS__;
      const summary = hooks?.getSummary?.();
      const renderedPages = document.querySelectorAll("[data-docx-page-surface='true']").length;
      return summary?.fileName === fileName && renderedPages > 0;
    },
    expectedFileName,
    { timeout: 30_000 }
  );

  let previousCount = -1;
  let stableIterations = 0;
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const count = await page.evaluate(
      () => document.querySelectorAll("[data-docx-page-surface='true']").length
    );
    if (count === previousCount) {
      stableIterations += 1;
      if (stableIterations >= 3) {
        return count;
      }
    } else {
      stableIterations = 0;
      previousCount = count;
    }
    await delay(250);
  }

  return previousCount;
}

async function runPythonDiff(scriptPath, pairsManifestPath, outputPath, options) {
  await new Promise((resolve, reject) => {
    execFile(
      "python3",
      [
        scriptPath,
        pairsManifestPath,
        outputPath,
        "--width",
        String(options.comparisonWidth),
        "--height",
        String(options.comparisonHeight),
        "--tolerance",
        String(options.tolerance)
      ],
      (error, stdout, stderr) => {
        if (stdout) {
          process.stdout.write(stdout);
        }
        if (stderr) {
          process.stderr.write(stderr);
        }
        if (error) {
          reject(error);
          return;
        }
        resolve(undefined);
      }
    );
  });
}

function summarizeDoc(doc, options) {
  const comparedPages = doc.pages.filter((page) => page.status === "compared");
  const meanAbsAverage =
    comparedPages.length > 0
      ? comparedPages.reduce((sum, page) => sum + page.meanAbsoluteDiff, 0) / comparedPages.length
      : undefined;
  const mismatchRatioAverage =
    comparedPages.length > 0
      ? comparedPages.reduce((sum, page) => sum + page.mismatchRatio, 0) / comparedPages.length
      : undefined;
  const maxMeanAbs =
    comparedPages.length > 0
      ? Math.max(...comparedPages.map((page) => page.meanAbsoluteDiff))
      : undefined;
  const maxMismatchRatio =
    comparedPages.length > 0
      ? Math.max(...comparedPages.map((page) => page.mismatchRatio))
      : undefined;
  const pageCountMatches = doc.expectedPages === doc.actualPages;
  const visualPass =
    pageCountMatches &&
    comparedPages.length === doc.expectedPages &&
    (maxMeanAbs ?? Number.POSITIVE_INFINITY) <= options.meanAbsThreshold &&
    (maxMismatchRatio ?? Number.POSITIVE_INFINITY) <= options.mismatchRatioThreshold;

  return {
    ...doc,
    comparedPages: comparedPages.length,
    pageCountMatches,
    meanAbsoluteDiffAverage:
      meanAbsAverage !== undefined ? Number(meanAbsAverage.toFixed(6)) : undefined,
    mismatchRatioAverage:
      mismatchRatioAverage !== undefined ? Number(mismatchRatioAverage.toFixed(6)) : undefined,
    maxMeanAbsoluteDiff:
      maxMeanAbs !== undefined ? Number(maxMeanAbs.toFixed(6)) : undefined,
    maxMismatchRatio:
      maxMismatchRatio !== undefined ? Number(maxMismatchRatio.toFixed(6)) : undefined,
    visualPass
  };
}

function buildMarkdownReport(summary, reportJsonPath) {
  const lines = [
    "# Local DOCX visual fidelity report",
    "",
    `Source report: ${reportJsonPath}`,
    "",
    `Compared docs: ${summary.totalDocs}`,
    `Passing docs: ${summary.passingDocs}`,
    `Failing docs: ${summary.failingDocs}`,
    `Compared pages: ${summary.totalComparedPages}`,
    `Thresholds: mean abs <= ${summary.thresholds.meanAbsoluteDiff}, mismatch ratio <= ${summary.thresholds.mismatchRatio}`,
    "",
    "## Worst docs",
    "",
    "| DOCX | Expected | Actual | Avg diff | Max diff | Avg mismatch | Max mismatch | Result |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |"
  ];

  summary.docs
    .slice()
    .sort((left, right) => {
      const severityLeft =
        Math.abs(left.actualPages - left.expectedPages) * 10 +
        (left.maxMismatchRatio ?? 0) * 5 +
        (left.maxMeanAbsoluteDiff ?? 0);
      const severityRight =
        Math.abs(right.actualPages - right.expectedPages) * 10 +
        (right.maxMismatchRatio ?? 0) * 5 +
        (right.maxMeanAbsoluteDiff ?? 0);
      return severityRight - severityLeft;
    })
    .slice(0, 20)
    .forEach((doc) => {
      lines.push(
        `| ${path.basename(doc.input)} | ${doc.expectedPages} | ${doc.actualPages} | ${doc.meanAbsoluteDiffAverage ?? ""} | ${doc.maxMeanAbsoluteDiff ?? ""} | ${doc.mismatchRatioAverage ?? ""} | ${doc.maxMismatchRatio ?? ""} | ${doc.visualPass ? "pass" : "fail"} |`
      );
    });

  lines.push("", "## Worst pages", "", "| DOCX | Page | Mean diff | Mismatch ratio |", "| --- | ---: | ---: | ---: |");

  summary.docs
    .flatMap((doc) =>
      doc.pages
        .filter((page) => page.status === "compared")
        .map((page) => ({
          input: doc.input,
          pageNumber: page.pageNumber,
          meanAbsoluteDiff: page.meanAbsoluteDiff,
          mismatchRatio: page.mismatchRatio
        }))
    )
    .sort(
      (left, right) =>
        right.mismatchRatio - left.mismatchRatio ||
        right.meanAbsoluteDiff - left.meanAbsoluteDiff
    )
    .slice(0, 30)
    .forEach((page) => {
      lines.push(
        `| ${path.basename(page.input)} | ${page.pageNumber} | ${page.meanAbsoluteDiff} | ${page.mismatchRatio} |`
      );
    });

  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const groundTruthRoot = path.resolve(options.groundTruthRoot);
  const manifestPath = path.join(groundTruthRoot, "manifest.json");
  const reportJsonPath = path.join(groundTruthRoot, "viewer-visual-fidelity-report.json");
  const reportMarkdownPath = path.join(groundTruthRoot, "viewer-visual-fidelity-report.md");
  const artifactRoot = path.join(groundTruthRoot, "viewer-visual-fidelity-artifacts");
  const captureRoot = path.join(artifactRoot, "captures");
  const pairsManifestPath = path.join(artifactRoot, "comparison-pairs.json");
  const diffOutputPath = path.join(artifactRoot, "comparison-results.json");
  const pythonScriptPath = path.resolve(process.cwd(), "scripts/measure_png_visual_diff.py");

  await fs.mkdir(captureRoot, { recursive: true });

  const manifestFiles = await loadManifest(manifestPath, options);
  if (manifestFiles.length === 0) {
    throw new Error("No matching DOCX cases found in the local manifest.");
  }

  let serverProcess;
  if (!options.noServer) {
    serverProcess = await startViewerServer(options);
  } else {
    await waitForUrl(options.baseUrl, 10_000);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1200 },
    deviceScaleFactor: 1
  });

  const pairs = [];
  const docs = [];

  try {
    for (const entry of manifestFiles) {
      const docSlug = slugify(path.basename(entry.input));
      const groundTruthDir = path.dirname(entry.pdf);
      const groundTruthPages = await listGroundTruthPages(groundTruthDir);

      await page.goto(options.baseUrl, { waitUntil: "networkidle" });
      await page
        .locator('input[type="file"][accept=".docx"]')
        .setInputFiles(entry.input);
      const actualPages = await waitForDocumentLoad(page, path.basename(entry.input));

      const doc = {
        input: entry.input,
        expectedPages: groundTruthPages.length,
        actualPages,
        groundTruthDir,
        pages: []
      };

      const comparePageCount = Math.min(groundTruthPages.length, actualPages);
      for (let pageIndex = 0; pageIndex < comparePageCount; pageIndex += 1) {
        const pageNumber = pageIndex + 1;
        const captureDir = path.join(captureRoot, docSlug);
        await fs.mkdir(captureDir, { recursive: true });
        const capturePath = path.join(captureDir, `page-${String(pageNumber).padStart(2, "0")}.png`);
        const surface = page
          .locator('[data-docx-page-surface="true"]')
          .nth(pageIndex);
        await surface.scrollIntoViewIfNeeded();
        await delay(120);
        await surface.screenshot({ path: capturePath });

        doc.pages.push({
          pageNumber,
          status: "compared",
          groundTruthPath: groundTruthPages[pageIndex].absolutePath,
          viewerPath: capturePath
        });
        pairs.push({
          input: entry.input,
          pageNumber,
          groundTruthPath: groundTruthPages[pageIndex].absolutePath,
          viewerPath: capturePath
        });
      }

      for (let pageIndex = comparePageCount; pageIndex < groundTruthPages.length; pageIndex += 1) {
        doc.pages.push({
          pageNumber: pageIndex + 1,
          status: "missing-viewer-page",
          groundTruthPath: groundTruthPages[pageIndex].absolutePath
        });
      }

      for (let pageIndex = comparePageCount; pageIndex < actualPages; pageIndex += 1) {
        doc.pages.push({
          pageNumber: pageIndex + 1,
          status: "extra-viewer-page"
        });
      }

      docs.push(doc);
    }
  } finally {
    await browser.close();
    if (serverProcess) {
      serverProcess.kill("SIGINT");
    }
  }

  await fs.writeFile(pairsManifestPath, `${JSON.stringify(pairs, null, 2)}\n`, "utf8");
  await runPythonDiff(pythonScriptPath, pairsManifestPath, diffOutputPath, options);
  const diffResults = JSON.parse(await fs.readFile(diffOutputPath, "utf8"));
  const diffByKey = new Map(
    diffResults.results.map((result) => [`${result.input}::${result.pageNumber}`, result])
  );

  const summarizedDocs = docs.map((doc) => {
    const enrichedPages = doc.pages.map((page) => {
      if (page.status !== "compared") {
        return page;
      }
      const metrics = diffByKey.get(`${doc.input}::${page.pageNumber}`);
      return metrics
        ? {
            ...page,
            meanAbsoluteDiff: metrics.meanAbsoluteDiff,
            rootMeanSquareDiff: metrics.rootMeanSquareDiff,
            mismatchRatio: metrics.mismatchRatio
          }
        : page;
    });
    return summarizeDoc({ ...doc, pages: enrichedPages }, options);
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl: options.baseUrl,
    thresholds: {
      meanAbsoluteDiff: options.meanAbsThreshold,
      mismatchRatio: options.mismatchRatioThreshold
    },
    totalDocs: summarizedDocs.length,
    passingDocs: summarizedDocs.filter((doc) => doc.visualPass).length,
    failingDocs: summarizedDocs.filter((doc) => !doc.visualPass).length,
    totalComparedPages: summarizedDocs.reduce((sum, doc) => sum + doc.comparedPages, 0),
    docs: summarizedDocs
  };

  await fs.writeFile(reportJsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await fs.writeFile(
    reportMarkdownPath,
    buildMarkdownReport(summary, reportJsonPath),
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        reportJsonPath,
        reportMarkdownPath,
        totalDocs: summary.totalDocs,
        passingDocs: summary.passingDocs,
        failingDocs: summary.failingDocs,
        totalComparedPages: summary.totalComparedPages
      },
      null,
      2
    )
  );

  if (summary.failingDocs > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
