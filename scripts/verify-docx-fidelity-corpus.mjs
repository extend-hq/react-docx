import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

const docs = [
  "<LOCAL_DOCX_TESTING_ROOT>/<LOCAL_DOCX_FIXTURE>.docx",
  "<LOCAL_DOCX_TESTING_ROOT>/sample3.docx",
  "<LOCAL_DOCX_TESTING_ROOT>/2026-03-24_15-53-14/<HASHED_LOCAL_DOCX>.docx",
  "<LOCAL_DOCX_FIXTURE>.docx",
];

function pdfPageCount(pdfPath) {
  const result = spawnSync("/opt/homebrew/bin/pdfinfo", [pdfPath], {
    encoding: "utf8",
  });
  const match = result.stdout.match(/^Pages:\s+(\d+)/m);
  if (!match) {
    throw new Error(`Could not parse pdfinfo output for ${pdfPath}`);
  }
  return Number(match[1]);
}

async function convertToPdf(docxPath) {
  const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), "react-docx-verify-"));
  const profileDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), "react-docx-soffice-profile-")
  );
  const result = spawnSync(
    "/opt/homebrew/bin/soffice",
    [
      `-env:UserInstallation=file://${profileDir}`,
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
  const pdfPath = path.join(outDir, `${path.basename(docxPath, path.extname(docxPath))}.pdf`);
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

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 2200 },
});

const results = [];

for (const docPath of docs) {
  const basename = path.basename(docPath);
  const { pdfPath, cleanup } = await convertToPdf(docPath);
  try {
    const librePageCount = pdfPageCount(pdfPath);
    await page.goto("http://localhost:5177/", { waitUntil: "networkidle" });
    const startedAt = Date.now();
    await page.locator("input[type=file]").first().setInputFiles(docPath);
    await page.waitForFunction(
      (name) => document.body.textContent?.includes(`Loaded ${name}`),
      basename,
      { timeout: 120_000 }
    );
    await page.waitForTimeout(basename.includes("<REDACTED_CUSTOMER>") ? 2000 : 1200);
    const importMs = Date.now() - startedAt;
    const metrics = await page.evaluate(() => {
      const pageEls = Array.from(document.querySelectorAll("[data-docx-page-index]"));
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
        ).filter((el) => !el.closest('[data-docx-header-footer-region="footer"]'));
        const maxBottom = paragraphs.reduce(
          (max, el) => Math.max(max, el.getBoundingClientRect().bottom),
          -Infinity
        );
        return Number.isFinite(maxBottom) && maxBottom > footerTop;
      }).length;

      return {
        viewerPageCount: pageEls.length,
        footerOverlapPages,
        slicedRowCount: document.querySelectorAll('[data-docx-row-sliced="true"]')
          .length,
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

await browser.close();

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
