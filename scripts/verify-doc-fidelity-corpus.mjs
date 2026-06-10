// Legacy .doc corpus fidelity runner (adapted from verify-docx-fidelity-corpus.mjs).
// For each .doc: LibreOffice PDF page count (reference) + playground viewer
// metrics (page count, footer overlaps, sliced rows). Results stream to
// --out (JSON) so the run is resumable.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const options = {
    corpusDir: process.env.DOC_FIDELITY_CORPUS_DIR ||
      path.join(os.homedir(), "Documents", "DOC testing"),
    baseUrl: process.env.DOC_FIDELITY_BASE_URL || "http://localhost:5177/",
    outPath: "/tmp/viewer-doc-page-counts.json",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--corpus-dir") {
      options.corpusDir = path.resolve(argv[++index] ?? "");
    } else if (arg === "--base-url") {
      options.baseUrl = argv[++index] ?? options.baseUrl;
    } else if (arg === "--out") {
      options.outPath = path.resolve(argv[++index] ?? "");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function commandExists(candidate, args = ["--version"]) {
  if (!candidate) return false;
  const result = spawnSync(candidate, args, { encoding: "utf8", stdio: "ignore" });
  return !result.error && result.status === 0;
}

function resolveCommand(envName, candidates, probeArgs) {
  const attemptList = [process.env[envName], ...candidates].filter(
    (value, index, values) => Boolean(value) && values.indexOf(value) === index
  );
  for (const candidate of attemptList) {
    if (commandExists(candidate, probeArgs)) return candidate;
  }
  throw new Error(`Unable to find ${envName}. Tried: ${attemptList.join(", ")}`);
}

function pdfPageCount(pdfPath, pdfinfoBin) {
  const result = spawnSync(pdfinfoBin, [pdfPath], { encoding: "utf8" });
  const match = result.stdout.match(/^Pages:\s+(\d+)/m);
  if (!match) throw new Error(`Could not parse pdfinfo output for ${pdfPath}`);
  return Number(match[1]);
}

async function convertToPdf(docPath, sofficeBin) {
  const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), "react-doc-verify-"));
  const profileDir = await fsp.mkdtemp(path.join(os.tmpdir(), "react-doc-soffice-"));
  const result = spawnSync(
    sofficeBin,
    [
      `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
      "--headless",
      "--convert-to",
      "pdf:writer_pdf_Export",
      "--outdir",
      outDir,
      docPath,
    ],
    { encoding: "utf8", timeout: 120_000 }
  );
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "soffice failed").slice(0, 300));
  }
  const pdfPath = path.join(
    outDir,
    `${path.basename(docPath, path.extname(docPath))}.pdf`
  );
  if (!fs.existsSync(pdfPath)) throw new Error(`Missing PDF output for ${docPath}`);
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
  const entries = await fsp.readdir(options.corpusDir, { withFileTypes: true });
  const docPaths = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.toLowerCase().endsWith(".doc") &&
        !entry.name.startsWith("~$")
    )
    .map((entry) => path.join(options.corpusDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
  if (docPaths.length === 0) throw new Error(`No .doc files in ${options.corpusDir}`);

  const sofficeBin = resolveCommand(
    "SOFFICE_BIN",
    [
      "soffice",
      "/opt/homebrew/bin/soffice",
      "/Applications/LibreOffice.app/Contents/MacOS/soffice",
      "/usr/local/bin/soffice",
    ],
    ["--version"]
  );
  const pdfinfoBin = resolveCommand(
    "PDFINFO_BIN",
    ["pdfinfo", "/opt/homebrew/bin/pdfinfo", "/usr/local/bin/pdfinfo"],
    ["-v"]
  );

  const results = fs.existsSync(options.outPath)
    ? JSON.parse(fs.readFileSync(options.outPath, "utf8"))
    : {};
  const save = () =>
    fs.writeFileSync(options.outPath, JSON.stringify(results, null, 1));

  const browser = await chromium.launch({ headless: true });
  let page = await browser.newPage({ viewport: { width: 1440, height: 2200 } });
  const recreatePage = async () => {
    try {
      await page.close();
    } catch {
      // crashed pages cannot always be closed cleanly
    }
    page = await browser.newPage({ viewport: { width: 1440, height: 2200 } });
  };

  try {
    for (const docPath of docPaths) {
      const basename = path.basename(docPath);
      if (results[basename] && results[basename].viewerPageCount !== undefined) {
        continue;
      }
      const record = {};
      try {
        const { pdfPath, cleanup } = await convertToPdf(docPath, sofficeBin);
        try {
          record.librePageCount = pdfPageCount(pdfPath, pdfinfoBin);
        } finally {
          await cleanup();
        }
      } catch (error) {
        record.libreError = String(error.message || error).slice(0, 200);
      }

      try {
        await page.goto(options.baseUrl, { waitUntil: "networkidle" });
        const startedAt = Date.now();
        await page.locator("input[type=file]").first().setInputFiles(docPath);
        await page.waitForFunction(
          (name) =>
            document.body.textContent?.includes(`Loaded ${name}`) ||
            document.body.textContent?.includes("Failed to load file"),
          basename,
          { timeout: 120_000 }
        );
        const failed = await page.evaluate(() =>
          document.body.textContent?.includes("Failed to load file")
        );
        if (failed) {
          const status = await page.evaluate(() => {
            const text = document.body.textContent ?? "";
            const index = text.indexOf("Failed to load file");
            return text.slice(index, index + 160);
          });
          record.viewerError = status;
        } else {
          await page.waitForTimeout(1200);
          record.importMs = Date.now() - startedAt;
          const metrics = await page.evaluate(() => {
            const pageEls = Array.from(
              document.querySelectorAll("[data-docx-page-index]")
            );
            const footerOverlapPages = pageEls.filter((pageEl) => {
              const footer = pageEl.querySelector(
                '[data-docx-header-footer-region="footer"]'
              );
              if (!footer) return false;
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
          Object.assign(record, metrics);
        }
      } catch (error) {
        record.viewerError = String(error.message || error).slice(0, 200);
        // A crashed renderer poisons subsequent navigations; start fresh.
        await recreatePage();
      }

      results[basename] = record;
      save();
      console.log(`${basename}: ${JSON.stringify(record)}`);
    }
  } finally {
    await browser.close();
  }
  console.log("done");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
