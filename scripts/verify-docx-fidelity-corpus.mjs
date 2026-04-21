import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const defaultCorpusDir = path.join(
  repoRoot,
  "tests",
  "fixtures",
  "docx-regression-local"
);

function printUsage() {
  console.log(`Usage:
  pnpm run test:docx-vs-libreoffice -- --docx <path>
  pnpm run test:docx-vs-libreoffice -- --corpus-dir <path>

Options:
  --docx <path>        DOCX file to verify. Can be repeated.
  --corpus-dir <path>  Directory scanned recursively for .docx files.
                       Defaults to DOCX_FIDELITY_CORPUS_DIR or tests/fixtures/docx-regression-local.
  --base-url <url>     Running playground URL. Defaults to DOCX_FIDELITY_BASE_URL or http://localhost:5177/.

Environment:
  SOFFICE_BIN          LibreOffice executable override.
  PDFINFO_BIN          pdfinfo executable override.`);
}

function parseArgs(argv) {
  const options = {
    docxPaths: [],
    corpusDir: process.env.DOCX_FIDELITY_CORPUS_DIR || defaultCorpusDir,
    baseUrl: process.env.DOCX_FIDELITY_BASE_URL || "http://localhost:5177/",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--docx":
        options.docxPaths.push(path.resolve(argv[index + 1] ?? ""));
        index += 1;
        break;
      case "--corpus-dir":
        options.corpusDir = path.resolve(argv[index + 1] ?? "");
        index += 1;
        break;
      case "--base-url":
        options.baseUrl = argv[index + 1] ?? options.baseUrl;
        index += 1;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function commandExists(candidate, args = ["--version"]) {
  if (!candidate) {
    return false;
  }

  const result = spawnSync(candidate, args, {
    encoding: "utf8",
    stdio: "ignore",
  });
  return !result.error && result.status === 0;
}

function resolveCommand(envName, candidates, probeArgs) {
  const attemptList = [process.env[envName], ...candidates].filter(
    (value, index, values) => Boolean(value) && values.indexOf(value) === index
  );

  for (const candidate of attemptList) {
    if (commandExists(candidate, probeArgs)) {
      return candidate;
    }
  }

  throw new Error(
    `Unable to find ${envName}. Tried: ${attemptList.join(", ")}`
  );
}

async function findDocxFiles(dir) {
  const entries = await fsp
    .readdir(dir, { withFileTypes: true })
    .catch(() => []);
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findDocxFiles(entryPath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".docx")) {
      files.push(entryPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function pdfPageCount(pdfPath, pdfinfoBin) {
  const result = spawnSync(pdfinfoBin, [pdfPath], {
    encoding: "utf8",
  });
  const match = result.stdout.match(/^Pages:\s+(\d+)/m);
  if (!match) {
    throw new Error(`Could not parse pdfinfo output for ${pdfPath}`);
  }
  return Number(match[1]);
}

async function convertToPdf(docxPath, sofficeBin) {
  const outDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), "react-docx-verify-")
  );
  const profileDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), "react-docx-soffice-profile-")
  );
  const result = spawnSync(
    sofficeBin,
    [
      `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
      "--headless",
      "--convert-to",
      "pdf:writer_pdf_Export",
      "--outdir",
      outDir,
      docxPath,
    ],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "soffice failed");
  }
  const pdfPath = path.join(
    outDir,
    `${path.basename(docxPath, path.extname(docxPath))}.pdf`
  );
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`Missing PDF output for ${docxPath}`);
  }
  return {
    pdfPath,
    cleanup: async () => {
      await fsp.rm(outDir, { recursive: true, force: true });
      await fsp.rm(profileDir, { recursive: true, force: true });
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const docPaths =
    options.docxPaths.length > 0
      ? options.docxPaths
      : await findDocxFiles(options.corpusDir);

  if (docPaths.length === 0) {
    throw new Error(
      `No DOCX files found. Pass --docx <path> or place fixtures in ${options.corpusDir}.`
    );
  }

  const sofficeBin = resolveCommand(
    "SOFFICE_BIN",
    [
      "soffice",
      "/Applications/LibreOffice.app/Contents/MacOS/soffice",
      "/opt/homebrew/bin/soffice",
      "/usr/local/bin/soffice",
    ],
    ["--version"]
  );
  const pdfinfoBin = resolveCommand(
    "PDFINFO_BIN",
    ["pdfinfo", "/opt/homebrew/bin/pdfinfo", "/usr/local/bin/pdfinfo"],
    ["-v"]
  );

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 2200 },
  });

  const results = [];

  try {
    for (const docPath of docPaths) {
      const basename = path.basename(docPath);
      const { pdfPath, cleanup } = await convertToPdf(docPath, sofficeBin);
      try {
        const librePageCount = pdfPageCount(pdfPath, pdfinfoBin);
        await page.goto(options.baseUrl, { waitUntil: "networkidle" });
        const startedAt = Date.now();
        await page.locator("input[type=file]").first().setInputFiles(docPath);
        await page.waitForFunction(
          (name) => document.body.textContent?.includes(`Loaded ${name}`),
          basename,
          { timeout: 120_000 }
        );
        await page.waitForTimeout(1200);
        const importMs = Date.now() - startedAt;
        const metrics = await page.evaluate(() => {
          const pageEls = Array.from(
            document.querySelectorAll("[data-docx-page-index]")
          );
          const footerOverlapPages = pageEls.filter((pageEl) => {
            const footer = pageEl.querySelector(
              '[data-docx-header-footer-region="footer"]'
            );
            if (!footer) {
              return false;
            }
            const footerTop = footer.getBoundingClientRect().top;
            const paragraphs = Array.from(
              pageEl.querySelectorAll('[data-docx-paragraph-host="true"]')
            ).filter(
              (el) => !el.closest('[data-docx-header-footer-region="footer"]')
            );
            const maxBottom = paragraphs.reduce(
              (max, el) => Math.max(max, el.getBoundingClientRect().bottom),
              -Infinity
            );
            return Number.isFinite(maxBottom) && maxBottom > footerTop;
          }).length;

          return {
            viewerPageCount: pageEls.length,
            footerOverlapPages,
            slicedRowCount: document.querySelectorAll(
              '[data-docx-row-sliced="true"]'
            ).length,
          };
        });
        results.push({
          basename,
          librePageCount,
          importMs,
          ...metrics,
        });
      } finally {
        await cleanup();
      }
    }
  } finally {
    await browser.close();
  }

  const pageCountDeltaTotal = results.reduce(
    (sum, item) => sum + Math.abs(item.viewerPageCount - item.librePageCount),
    0
  );
  const footerOverlapPages = results.reduce(
    (sum, item) => sum + item.footerOverlapPages,
    0
  );
  const totalImportMs = results.reduce((sum, item) => sum + item.importMs, 0);
  const docsFailed = results.filter(
    (item) =>
      Math.abs(item.viewerPageCount - item.librePageCount) > 0 ||
      item.footerOverlapPages > 0
  ).length;

  console.log(
    JSON.stringify(
      {
        layout_penalty_score: pageCountDeltaTotal + footerOverlapPages,
        page_count_delta_total: pageCountDeltaTotal,
        footer_overlap_pages: footerOverlapPages,
        total_import_ms: totalImportMs,
        docs_failed: docsFailed,
        results,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  printUsage();
  process.exit(1);
});
