import { expect, test, type Locator } from "@playwright/test";

import { createZip } from "../unit/helpers/zip";

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELATIONSHIPS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Fidelity smoke page one</w:t></w:r></w:p>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>
    <w:p><w:r><w:t>Fidelity smoke page two</w:t></w:r></w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

function smokeDocx(): Buffer {
  return Buffer.from(
    createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELATIONSHIPS_XML },
      { name: "word/document.xml", content: DOCUMENT_XML },
    ])
  );
}

test("keeps automatic text lines clear while honoring explicit exact spacing", async ({ page }) => {
  const paragraph = (rule: string, spacing: number) => `<w:p><w:pPr><w:jc w:val="both"/><w:spacing w:line="${spacing}" w:lineRule="${rule}"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Verdana" w:hAnsi="Verdana"/><w:sz w:val="21"/></w:rPr><w:t>Upper glyphs</w:t><w:br/><w:t>Lower glyphs</w:t></w:r></w:p>`;
  const xml = DOCUMENT_XML.replace(
    /<w:p>[\s\S]*?<w:sectPr>/,
    `${paragraph("auto", 240)}${paragraph("auto", 237)}${paragraph("exact", 120)}<w:sectPr>`
  );
  await page.goto("/");
  await page.locator('input[type="file"][accept*=".doc"]').setInputFiles({
    name: "line-height.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELATIONSHIPS_XML },
      { name: "word/document.xml", content: xml },
    ])),
  });
  const paragraphs = page.locator('[data-docx-paragraph-kind="paragraph"][data-docx-paragraph-host]');
  await expect(paragraphs.first()).toContainText("Upper glyphs", { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  const geometry = await paragraphs.evaluateAll(elements => elements.slice(0, 3).map(element => {
    const style = getComputedStyle(element);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const tops: number[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent?.includes("glyphs")) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) if (rect.width > 0) tops.push(rect.top);
    }
    const rows = [...new Set(tops.map(top => Math.round(top * 64) / 64))].sort((a, b) => a - b);
    return { lineHeight: parseFloat(style.lineHeight), family: style.fontFamily.toLowerCase(), advance: rows[1]! - rows[0]! };
  }));
  expect(geometry).toHaveLength(3);
  expect(geometry[0]!.family).toContain("verdana");
  expect(geometry[0]!.lineHeight).toBeGreaterThan(14);
  expect(geometry[0]!.advance).toBeGreaterThan(14);
  expect(geometry[1]!.advance).toBeGreaterThan(14);
  expect(geometry[1]!.advance / geometry[0]!.advance).toBeCloseTo(237 / 240, 2);
  expect(geometry[2]!.lineHeight).toBe(8);
  expect(geometry[2]!.advance).toBeCloseTo(8, 1);
});

test("preserves merged columns and rotated text across page fragments", async ({ page }) => {
  const rows = Array.from({ length: 8 }, (_, index) => `<w:tr><w:trPr><w:trHeight w:val="1200" w:hRule="exact"/><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/><w:vMerge ${index === 0 ? 'w:val="restart"' : ""}/>${index === 0 ? '<w:textDirection w:val="btLr"/><w:vAlign w:val="center"/>' : ""}</w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>${index === 0 ? "Vertical label" : ""}</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Row ${index + 1}</w:t></w:r></w:p></w:tc></w:tr>`).join("");
  const xml = DOCUMENT_XML.replace(/<w:p>[\s\S]*?<w:sectPr>/,
    `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="600"/><w:gridCol w:w="3000"/></w:tblGrid>${rows}</w:tbl><w:sectPr>`)
    .replace('w:h="15840"', 'w:h="7200"');
  await page.goto("/");
  await page.locator('input[type="file"][accept*=".doc"]').setInputFiles({
    name: "merged-vertical.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELATIONSHIPS_XML },
      { name: "word/document.xml", content: xml },
    ])),
  });
  const fragments = page.locator('[data-docx-merged-fragment]');
  const toggle = page.getByText("Read only", { exact: true }).locator("..").getByRole("switch");
  await toggle.click();
  await expect(fragments.first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => fragments.count()).toBeGreaterThan(1);
  const geometry = await page.locator('[data-docx-page-surface]').evaluateAll(surfaces => surfaces.flatMap(surface => {
    const row = surface.querySelector('tr[data-docx-row-index]');
    if (!row) return [];
    const cells = [...row.querySelectorAll(':scope > td')];
    const first = cells[0]!.getBoundingClientRect(), second = cells[1]!.getBoundingClientRect();
    const flow = row.querySelector('[data-docx-merged-fragment] [style*="writing-mode"]');
    return [{ cells: cells.length, leftWidth: first.width, gap: second.left - first.right,
      direction: flow ? getComputedStyle(flow).writingMode : null,
      orientation: flow ? getComputedStyle(flow).textOrientation : null }];
  }));
  expect(geometry.length).toBeGreaterThan(1);
  for (const fragment of geometry) {
    expect(fragment.cells).toBe(2);
    expect(fragment.leftWidth).toBeCloseTo(40, 0);
    expect(Math.abs(fragment.gap)).toBeLessThan(1);
    expect(fragment.direction).toBe("vertical-rl");
    expect(fragment.orientation).toBe("sideways");
  }
  await toggle.click();
  const anchor = page.locator('td[data-docx-row-index="0"][data-docx-cell-index="0"]').first();
  await anchor.click({ position: { x: 15, y: 20 } });
  const input = anchor.locator('[contenteditable="true"][data-docx-cell-key]');
  await expect(input).toBeVisible();
  await input.fill("Updated vertical label");
  await input.blur();
  await toggle.click();
  await expect(fragments.first()).toContainText("Updated vertical label");
  await expect(fragments.first().locator('[style*="writing-mode"]')).toHaveCSS("writing-mode", "vertical-rl");
});

test("keeps paragraph-relative drawings at the body margin beside a page background", async ({ page }) => {
  const drawing = (name: string, pageAnchor: boolean, width: number, height: number) => `<w:r><w:drawing><wp:anchor behindDoc="${pageAnchor ? 1 : 0}" distL="0" distR="0" distT="0" distB="0"><wp:positionH relativeFrom="${pageAnchor ? "page" : "column"}"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="${pageAnchor ? "page" : "paragraph"}"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="${width * 9525}" cy="${height * 9525}"/>${pageAnchor ? "<wp:wrapNone/>" : '<wp:wrapSquare wrapText="bothSides"/>'}<wp:docPr id="${pageAnchor ? 1 : 2}" name="${name}"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
  const xml = DOCUMENT_XML.replace('<w:document ', '<w:document xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ')
    .replace(/<w:p>[\s\S]*?<w:sectPr>/, `<w:p>${drawing("Background", true, 816, 1056)}${drawing("Foreground", false, 80, 24)}</w:p><w:sectPr>`);
  await page.goto("/");
  await page.locator('input[type="file"][accept*=".doc"]').setInputFiles({
    name: "drawing-origins.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML.replace("</Types>", '<Default Extension="svg" ContentType="image/svg+xml"/></Types>') },
      { name: "_rels/.rels", content: ROOT_RELATIONSHIPS_XML },
      { name: "word/document.xml", content: xml },
      { name: "word/_rels/document.xml.rels", content: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/shape.svg"/></Relationships>' },
      { name: "word/media/shape.svg", content: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="24"><rect width="80" height="24" fill="blue"/></svg>' },
    ])),
  });
  const image = page.getByRole("img", { name: "Foreground", exact: true });
  await expect(image).toBeVisible({ timeout: 20_000 });
  const point = await image.evaluate(element => {
    const surface = element.closest('[data-docx-page-surface]')!;
    const p = surface.getBoundingClientRect(), r = element.getBoundingClientRect();
    const scale = p.width / 816;
    return { x: (r.left - p.left) / scale, y: (r.top - p.top) / scale };
  });
  expect(point.x).toBeCloseTo(96, 0);
  expect(point.y).toBeCloseTo(96, 0);
});

async function selectTextOffsets(
  paragraph: Locator,
  startOffset: number,
  endOffset: number
): Promise<void> {
  const wrappedSurface = paragraph.locator(
    '[data-docx-wrapped-paragraph-root="true"]'
  );
  if (await wrappedSurface.count()) {
    await wrappedSurface.click();
    const input = wrappedSurface.getByRole("textbox", {
      name: "Wrapped paragraph text",
    });
    await expect(input).toBeFocused();
    await input.evaluate(
      (element, offsets) => {
        const textarea = element as HTMLTextAreaElement;
        textarea.setSelectionRange(offsets.startOffset, offsets.endOffset);
        textarea.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      },
      { startOffset, endOffset }
    );
    return;
  }
  await paragraph.evaluate(
    (element, offsets) => {
      const resolvePosition = (targetOffset: number): [Node, number] => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let cursor = 0;
        let lastTextNode: Text | undefined;
        while (walker.nextNode()) {
          const textNode = walker.currentNode;
          if (!(textNode instanceof Text)) {
            continue;
          }
          lastTextNode = textNode;
          const nextCursor = cursor + textNode.data.length;
          if (targetOffset <= nextCursor) {
            return [textNode, Math.max(0, targetOffset - cursor)];
          }
          cursor = nextCursor;
        }
        if (!lastTextNode) {
          throw new Error("Expected editable paragraph text");
        }
        return [lastTextNode, lastTextNode.data.length];
      };

      const [startNode, start] = resolvePosition(offsets.startOffset);
      const [endNode, end] = resolvePosition(offsets.endOffset);
      element.focus();
      const selection = window.getSelection();
      if (!selection) {
        throw new Error("Selection API is unavailable");
      }
      selection.setBaseAndExtent(startNode, start, endNode, end);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    },
    { startOffset, endOffset }
  );
}

test("keeps continued table paragraphs and following rows in flow", async ({ page }) => {
  const text = "A continued paragraph must keep every visible line inside its table cell. ".repeat(5);
  const paragraphs = Array.from({ length: 12 }, (_, i) => `<w:p><w:pPr><w:jc w:val="both"/><w:ind w:left="360"/><w:spacing w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Verdana" w:hAnsi="Verdana"/><w:sz w:val="21"/></w:rPr><w:t>${i + 1}. ${text}</w:t></w:r></w:p>`).join("");
  const table = `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="1800"/><w:gridCol w:w="7200"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Label</w:t></w:r></w:p></w:tc><w:tc>${paragraphs}</w:tc></w:tr><w:tr><w:tc><w:p/></w:tc><w:tc><w:p><w:r><w:t>Following row</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
  const xml = DOCUMENT_XML.replace(/<w:p>[\s\S]*?<w:sectPr>/, `${table}<w:sectPr>`);
  await page.goto("/");
  await page.locator('input[type="file"][accept*=".doc"]').setInputFiles({
    name: "continued-table.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELATIONSHIPS_XML },
      { name: "word/document.xml", content: xml },
    ])),
  });
  await expect(page.getByText("Following row", { exact: true }).first()).toBeAttached({ timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => page.locator('[data-docx-page-surface]').count()).toBeGreaterThan(1);
  await expect(page.locator('[data-docx-row-sliced="true"]').first()).toBeAttached();
  const collisions = await page.evaluate(() => {
    const issues: string[] = [];
    for (const surface of document.querySelectorAll('[data-docx-page-surface]')) {
      const tables = [...surface.querySelectorAll('table')];
      tables.slice(1).forEach((table, index) => {
        if (tables[index]!.getBoundingClientRect().bottom > table.getBoundingClientRect().top + 1) issues.push("table overlap");
      });
      for (const paragraph of surface.querySelectorAll('td [data-docx-paragraph-host]')) {
        const cell = paragraph.closest('td')!;
        if (paragraph.getBoundingClientRect().bottom > cell.getBoundingClientRect().bottom + 2) issues.push("cell overflow");
      }
    }
    return issues;
  });
  expect(collisions).toEqual([]);
});

test("keeps single-line table rows at the text and cell-padding height", async ({ page }) => {
  const row = '<w:tr><w:tc><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr><w:t>Single line</w:t></w:r></w:p></w:tc></w:tr>';
  const table = `<w:tbl><w:tblPr><w:tblW w:w="7200" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="7200"/></w:tblGrid>${row.repeat(40)}</w:tbl>`;
  const xml = DOCUMENT_XML.replace(/<w:p>[\s\S]*?<w:sectPr>/, `${table}<w:sectPr>`);
  await page.goto("/");
  await page.locator('input[type="file"][accept*=".doc"]').setInputFiles({
    name: "table-row-height.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELATIONSHIPS_XML },
      { name: "word/document.xml", content: xml },
    ])),
  });
  const paragraph = page.locator('td [data-docx-paragraph-host]').first();
  await expect(paragraph).toHaveText("Single line", { timeout: 20_000 });
  await expect.poll(() => paragraph.evaluate(element => {
    const cell = element.closest('td')!;
    const style = getComputedStyle(cell);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    return cell.getBoundingClientRect().height - element.getBoundingClientRect().height - padding;
  })).toBeLessThan(2);
});

test("keeps complete form values visible when switching between editing and read-only", async ({ page }) => {
  const field = '<w:p><w:r><w:t>Value: </w:t></w:r><w:sdt><w:sdtPr><w:id w:val="1"/><w:text/></w:sdtPr><w:sdtContent><w:r><w:t>Initial field value</w:t></w:r></w:sdtContent></w:sdt></w:p>';
  const xml = DOCUMENT_XML.replace(/<w:p>[\s\S]*?<w:sectPr>/, `${field}<w:sectPr>`);
  await page.goto("/");
  await page.locator('input[type="file"][accept*=".doc"]').setInputFiles({
    name: "form-value.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELATIONSHIPS_XML },
      { name: "word/document.xml", content: xml },
    ])),
  });
  const input = page.locator('input[data-docx-form-field="true"]').first();
  await expect(input).toHaveValue("Initial field value", { timeout: 20_000 });
  const value = "A revised form value with enough text to exceed a compact input box";
  await input.click();
  await input.fill(value);
  await input.blur();
  await expect(input).toHaveValue(value);
  const toggle = page.getByText("Read only", { exact: true }).locator("..").getByRole("switch");
  await toggle.click();
  await expect(page.locator('input[data-docx-form-field="true"]')).toHaveCount(0);
  await expect(page.locator('span[data-docx-form-field="true"]').first()).toHaveText(value);
  await toggle.click();
  await expect(input).toHaveValue(value);
});

test("loads a generated DOCX and settles on its explicit page geometry", async ({
  page,
}) => {
  await page.goto("/");

  await page.locator('input[type="file"][accept*=".doc"]').setInputFiles({
    name: "fidelity-smoke.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: smokeDocx(),
  });

  await expect(page.getByText("Fidelity smoke page one").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Fidelity smoke page two").first()).toBeVisible();

  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const renderedPages = page.locator("[data-docx-page-index]");
  await expect.poll(() => renderedPages.count()).toBe(2);
  await expect(renderedPages.nth(0)).toContainText("Fidelity smoke page one");
  await expect(renderedPages.nth(1)).toContainText("Fidelity smoke page two");
});

test("collapses selection after deleting selected text", async ({
  page,
}) => {
  await page.goto("/");

  await page.locator('input[type="file"][accept*=".doc"]').setInputFiles({
    name: "selection-delete.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: smokeDocx(),
  });

  const paragraph = page
    .locator(
      '[data-docx-paragraph-kind="paragraph"][data-docx-paragraph-node-index="0"]'
    )
    .first();
  await expect(paragraph).toBeVisible({ timeout: 20_000 });
  await expect(paragraph).toContainText("Fidelity smoke page one");

  await selectTextOffsets(paragraph, 9, 15);
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe("smoke ");

  await page.keyboard.press("Delete");

  await expect(paragraph).toContainText("Fidelity page one");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const selection = window.getSelection();
        return {
          collapsed: selection?.isCollapsed,
          selectedText: selection?.toString(),
        };
      })
    )
    .toEqual({ collapsed: true, selectedText: "" });
});

test("applies and toggles toolbar styles on each new selection", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('input[type="file"][accept*=".doc"]').setInputFiles({
    name: "toolbar-selection.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: smokeDocx(),
  });

  const paragraph = page
    .locator(
      '[data-docx-paragraph-kind="paragraph"][data-docx-paragraph-node-index="0"]'
    )
    .first();
  await expect(paragraph).toContainText("Fidelity smoke page one", {
    timeout: 20_000,
  });

  const rangeState = (start: number, end: number) =>
    page.evaluate(
      ({ start, end }) =>
        (window as any).__DOCX_TEST_HOOKS__.getRangeState({
          start: {
            location: { kind: "paragraph", nodeIndex: 0 },
            offset: start,
          },
          end: { location: { kind: "paragraph", nodeIndex: 0 }, offset: end },
        }),
      { start, end }
    );
  const boldButton = page.getByRole("button", { name: "Bold", exact: true });
  const italicButton = page.getByRole("button", {
    name: "Italic",
    exact: true,
  });

  await selectTextOffsets(paragraph, 0, 8);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const range = (window as any).__DOCX_TEST_HOOKS__.getActionState()
          .activeTextRange;
        return range ? [range.start.offset, range.end.offset] : null;
      })
    )
    .toEqual([0, 8]);
  await boldButton.click();
  await expect
    .poll(async () =>
      (
        await rangeState(0, 8)
      )?.styles.every((style: { bold: boolean | null }) => style.bold === true)
    )
    .toBe(true);

  await selectTextOffsets(paragraph, 9, 14);
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe("smoke");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const range = (window as any).__DOCX_TEST_HOOKS__.getActionState()
          .activeTextRange;
        const selectedRunStyle = (
          window as any
        ).__DOCX_TEST_HOOKS__.getActionState().selectedRunStyle;
        return range
          ? {
              start: range.start.offset,
              end: range.end.offset,
              nodeIndex: range.start.location.nodeIndex,
              bold: selectedRunStyle.bold,
            }
          : null;
      })
    )
    .toEqual({ start: 9, end: 14, nodeIndex: 0, bold: null });
  await boldButton.click();
  expect(
    await page.evaluate(() => {
      const hooks = (window as any).__DOCX_TEST_HOOKS__;
      const actionRange = hooks.getActionState().activeTextRange;
      const range = (start: number, end: number) =>
        hooks.getRangeState({
          start: {
            location: { kind: "paragraph", nodeIndex: 0 },
            offset: start,
          },
          end: { location: { kind: "paragraph", nodeIndex: 0 }, offset: end },
        });
      return {
        selectedText: window.getSelection()?.toString(),
        actionRange: actionRange
          ? [actionRange.start.offset, actionRange.end.offset]
          : null,
        firstBold: range(0, 8)?.styles.map((style: any) => style.bold),
        secondBold: range(9, 14)?.styles.map((style: any) => style.bold),
      };
    })
  ).toEqual({
    selectedText: "smoke",
    actionRange: [9, 14],
    firstBold: [true],
    secondBold: [true],
  });
  await expect
    .poll(async () =>
      (
        await rangeState(9, 14)
      )?.styles.map((style: { bold: boolean | null }) => style.bold)
    )
    .toEqual([true]);
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe("smoke");

  await boldButton.click();
  await expect
    .poll(async () =>
      (
        await rangeState(9, 14)
      )?.styles.every((style: { bold: boolean | null }) => style.bold === false)
    )
    .toBe(true);

  await italicButton.click();
  await expect
    .poll(async () =>
      (
        await rangeState(9, 14)
      )?.styles.every(
        (style: { italic: boolean | null }) => style.italic === true
      )
    )
    .toBe(true);
  await italicButton.click();
  await expect
    .poll(async () =>
      (
        await rangeState(9, 14)
      )?.styles.every(
        (style: { italic: boolean | null }) => style.italic === false
      )
    )
    .toBe(true);

  await expect
    .poll(async () =>
      (
        await rangeState(0, 8)
      )?.styles.every((style: { bold: boolean | null }) => style.bold === true)
    )
    .toBe(true);
});
