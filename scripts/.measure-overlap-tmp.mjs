import { chromium } from "playwright";

const docPath = "/Users/andrewluo/Documents/DOCX testing/failing.docx";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 2200 } });
await page.goto("http://localhost:5177/", { waitUntil: "networkidle" });
await page.locator("input[type=file]").first().setInputFiles(docPath);
await page.waitForFunction(
  (name) => document.body.textContent?.includes(`Loaded ${name}`),
  "failing.docx",
  { timeout: 120_000 }
);
await page.waitForTimeout(1500);
const overlaps = await page.evaluate(() => {
  const pageEls = Array.from(document.querySelectorAll("[data-docx-page-index]"));
  const rows = [];
  pageEls.forEach((pageEl, pageIndex) => {
    const footer = pageEl.querySelector('[data-docx-header-footer-region="footer"]');
    if (!footer) return;
    const footerTop = footer.getBoundingClientRect().top;
    const paragraphs = Array.from(
      pageEl.querySelectorAll('[data-docx-paragraph-host="true"]')
    ).filter((el) => !el.closest('[data-docx-header-footer-region="footer"]'));
    const maxBottom = paragraphs.reduce(
      (max, el) => Math.max(max, el.getBoundingClientRect().bottom),
      -Infinity
    );
    if (Number.isFinite(maxBottom) && maxBottom > footerTop) {
      rows.push({ page: pageIndex + 1, crossPx: Math.round((maxBottom - footerTop) * 10) / 10 });
    }
  });
  return rows;
});
console.log(JSON.stringify(overlaps, null, 1));
await browser.close();
