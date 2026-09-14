import { expect, test, type Page } from "@playwright/test";
import { createZip } from "../unit/helpers/zip";

const MIN_ZOOM = 50;
const MAX_ZOOM = 200;
const PAGE_COUNT = 15;
const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function multiPageDocxBuffer(): Buffer {
  const paragraphs: string[] = [];
  for (let page = 1; page <= PAGE_COUNT; page += 1) {
    paragraphs.push(`<w:p><w:r><w:t>Page ${page}</w:t></w:r></w:p>`);
    if (page < PAGE_COUNT) {
      paragraphs.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    }
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paragraphs.join("")}</w:body>
</w:document>`;
  return Buffer.from(
    createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELS_XML },
      { name: "word/document.xml", content: documentXml },
    ])
  );
}

async function resolvedZoom(page: Page): Promise<number> {
  return Number(
    await page
      .getByTestId("docx-editor-viewer")
      .getAttribute("data-docx-resolved-zoom")
  );
}

async function expectedZoom(
  page: Page,
  mode: "automatic" | "fit-page" | "fit-width"
): Promise<number> {
  return page.evaluate((nextMode) => {
    const viewport = document.querySelector<HTMLElement>(
      '[data-testid="zoom-viewport"]'
    )!;
    const pageWrapper = document.querySelector<HTMLElement>(
      '[data-docx-page-wrapper="true"]'
    )!;
    const viewportStyle = getComputedStyle(viewport);
    const rootStyle = getComputedStyle(
      document.querySelector<HTMLElement>('[data-testid="docx-editor-viewer"]')!
    );
    const availableWidth =
      viewport.clientWidth -
      parseFloat(viewportStyle.paddingLeft) -
      parseFloat(viewportStyle.paddingRight) -
      parseFloat(rootStyle.paddingLeft) -
      parseFloat(rootStyle.paddingRight);
    const availableHeight =
      viewport.clientHeight -
      parseFloat(viewportStyle.paddingTop) -
      parseFloat(viewportStyle.paddingBottom) -
      parseFloat(rootStyle.paddingTop) -
      parseFloat(rootStyle.paddingBottom);
    const contentWidth = parseFloat(pageWrapper.style.width);
    const contentHeight = parseFloat(pageWrapper.style.minHeight);
    const fitWidth = (availableWidth / contentWidth) * 100;
    const fitHeight = (availableHeight / contentHeight) * 100;
    const raw =
      nextMode === "fit-page"
        ? Math.min(fitWidth, fitHeight)
        : nextMode === "automatic"
          ? Math.min(fitWidth, 100)
          : fitWidth;
    return Math.max(50, Math.min(200, raw));
  }, mode);
}

for (const controlled of [false, true]) {
  test(`${controlled ? "controlled" : "uncontrolled"} responsive modes recalculate and keep their level`, async ({
    page,
  }) => {
    await page.goto(
      `/\?zoom-harness=1${controlled ? "&controlled=1" : ""}`
    );
    const viewer = page.getByTestId("docx-editor-viewer");

    for (const mode of ["fit-width", "fit-page", "automatic"] as const) {
      await page.getByRole("button", { name: mode === "fit-width" ? "Fit width" : mode === "fit-page" ? "Fit page" : "Automatic" }).click();
      await expect(viewer).toHaveAttribute("data-docx-zoom-level", mode);
      await expect
        .poll(() => resolvedZoom(page))
        .toBeCloseTo(await expectedZoom(page, mode), 1);

      await page.getByRole("button", { name: "Resize viewport" }).click();
      await expect(viewer).toHaveAttribute("data-docx-zoom-level", mode);
      await expect
        .poll(() => resolvedZoom(page))
        .toBeCloseTo(await expectedZoom(page, mode), 1);
      await page.getByRole("button", { name: "Resize viewport" }).click();
    }
  });
}

test("numeric zoom exits responsive mode and zoom buttons start at its resolution", async ({
  page,
}) => {
  await page.goto("/?zoom-harness=1");
  const viewer = page.getByTestId("docx-editor-viewer");

  await page.getByRole("button", { name: "Fit page" }).click();
  const responsive = await resolvedZoom(page);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect
    .poll(() => resolvedZoom(page))
    .toBeCloseTo(Math.min(MAX_ZOOM, responsive + 10), 1);
  await expect(viewer).not.toHaveAttribute("data-docx-zoom-level", "fit-page");

  const numeric = await resolvedZoom(page);
  await page.getByRole("button", { name: "Resize viewport" }).click();
  await expect.poll(() => resolvedZoom(page)).toBeCloseTo(numeric, 2);

  await page.getByRole("button", { name: "Fit width" }).click();
  const fitWidth = await resolvedZoom(page);
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await expect
    .poll(() => resolvedZoom(page))
    .toBeCloseTo(Math.max(MIN_ZOOM, fitWidth - 10), 1);
});

test("recalculation preserves the page position and scales page geometry", async ({
  page,
}) => {
  await page.goto("/?zoom-harness=1");
  const viewer = page.getByTestId("docx-editor-viewer");
  const viewport = page.getByTestId("zoom-viewport");
  const pageWrapper = page.locator('[data-docx-page-wrapper="true"]');

  await expect(viewer).toHaveAttribute("data-docx-zoom-level", "fit-width");
  await expect.poll(() => resolvedZoom(page)).toBeGreaterThan(100);
  await viewport.evaluate((element) => {
    element.scrollTop = 300;
  });
  const before = await page.evaluate(() => {
    const viewportElement = document.querySelector<HTMLElement>(
      '[data-testid="zoom-viewport"]'
    )!;
    const pageElement = document.querySelector<HTMLElement>(
      '[data-docx-page-wrapper="true"]'
    )!;
    const viewportRect = viewportElement.getBoundingClientRect();
    const pageRect = pageElement.getBoundingClientRect();
    return (viewportRect.top - pageRect.top) / pageRect.height;
  });

  await page.getByRole("button", { name: "Resize viewport" }).click();
  await expect.poll(() => resolvedZoom(page)).toBeLessThan(100);
  const after = await page.evaluate(() => {
    const viewportElement = document.querySelector<HTMLElement>(
      '[data-testid="zoom-viewport"]'
    )!;
    const pageElement = document.querySelector<HTMLElement>(
      '[data-docx-page-wrapper="true"]'
    )!;
    const viewportRect = viewportElement.getBoundingClientRect();
    const pageRect = pageElement.getBoundingClientRect();
    return (viewportRect.top - pageRect.top) / pageRect.height;
  });
  expect(after).toBeCloseTo(before, 1);

  const geometry = await pageWrapper.evaluate((element) => ({
    logicalWidth: parseFloat((element as HTMLElement).style.width),
    visualWidth: element.getBoundingClientRect().width,
  }));
  expect(geometry.visualWidth / geometry.logicalWidth).toBeCloseTo(
    (await resolvedZoom(page)) / 100,
    2
  );
});

test("virtualization reaches the last page at the resolved responsive scale", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "webdriver", {
      get: () => false,
      configurable: true,
    });
  });
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"][accept*=".doc"]').setInputFiles({
    name: "responsive.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: multiPageDocxBuffer(),
  });

  const wrappers = page.locator("[data-docx-page-wrapper]");
  await expect
    .poll(async () => wrappers.count(), { timeout: 20000 })
    .toBeGreaterThan(5);
  await expect(
    page.locator('[data-docx-page-window-spacer="after"]')
  ).toBeAttached({ timeout: 20000 });

  const zoomSelect = page.getByRole("combobox", { name: "Zoom" });
  await zoomSelect.click();
  await page.getByRole("option", { name: "Fit width" }).click();
  await expect(page.getByTestId("docx-editor-viewer")).toHaveAttribute(
    "data-docx-zoom-level",
    "fit-width"
  );

  await page.evaluate(() => {
    const wrapper = document.querySelector("[data-docx-page-wrapper]");
    let node = wrapper?.parentElement ?? null;
    let scroller: HTMLElement | null = null;
    while (node) {
      const overflowY = window.getComputedStyle(node).overflowY;
      if (
        (overflowY === "auto" || overflowY === "scroll") &&
        node.scrollHeight > node.clientHeight
      ) {
        scroller = node;
        break;
      }
      node = node.parentElement;
    }
    const target = scroller ?? (document.scrollingElement as HTMLElement);
    target.scrollTop = target.scrollHeight;
  });

  await expect(wrappers.last()).toHaveAttribute(
    "data-docx-page-index",
    String(PAGE_COUNT - 1),
    { timeout: 10000 }
  );
});
