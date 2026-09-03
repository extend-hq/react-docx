import path from "node:path";
import { expect, test } from "@playwright/test";

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
    <w:p><w:r><w:t>Cover content</w:t></w:r></w:p>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>
    <w:p><w:r><w:t>Later content</w:t></w:r></w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;

function thumbnailDocx(): Buffer {
  return Buffer.from(
    createZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: ROOT_RELATIONSHIPS_XML },
      { name: "word/document.xml", content: DOCUMENT_XML },
    ])
  );
}

test("renders one immediate cover from a reusable parsed document", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const modulePath = `/@fs${path.resolve(
    process.cwd(),
    "packages/react-viewer/src/index.tsx"
  )}`;
  const bytes = Array.from(thumbnailDocx());

  const result = await page.evaluate(
    async ({ modulePath, bytes }) => {
      const api = await import(modulePath);
      const source = new Uint8Array(bytes);
      const documentModel = await api.parseDocxForViewer(source, {
        loadEmbeddedFonts: false,
        useWorker: false,
      });
      const renderer = api.createDocxThumbnailRenderer(documentModel, {
        scheduling: "immediate",
        pixelRatio: 1,
        pageIndexes: [0],
      });
      const thumbnail = await renderer.renderPage(0, {
        maxWidth: 240,
        output: "blob",
      });
      const canvas = document.createElement("canvas");
      const canvasThumbnail = await renderer.renderPage(0, {
        canvas,
        maxWidth: 180,
        output: "canvas",
        scheduling: "immediate",
      });
      const bitmapThumbnail = await renderer.renderPage(0, {
        maxWidth: 120,
        output: "imageBitmap",
        scheduling: "immediate",
      });
      const mountedPages = Array.from(
        document.querySelectorAll("[data-docx-thumbnail-page-index]")
      ).map((element) => element.textContent ?? "");
      const summary = {
        blobSize: thumbnail.blob?.size ?? 0,
        mountedPages,
        pageCount: renderer.pageCount,
        width: thumbnail.width,
        callerCanvasReused: canvasThumbnail.canvas === canvas,
        canvasPixelWidth: canvas.width,
        bitmapWidth: bitmapThumbnail.imageBitmap?.width ?? 0,
        timings: thumbnail.timings,
        parseTimings: documentModel.timings,
      };
      bitmapThumbnail.imageBitmap?.close();
      renderer.dispose();
      documentModel.dispose();
      return summary;
    },
    { modulePath, bytes }
  );

  expect(result.pageCount).toBe(2);
  expect(result.width).toBeLessThanOrEqual(240);
  expect(result.blobSize).toBeGreaterThan(0);
  expect(result.callerCanvasReused).toBe(true);
  expect(result.canvasPixelWidth).toBeGreaterThan(0);
  expect(result.bitmapWidth).toBeGreaterThan(0);
  expect(result.mountedPages).toHaveLength(1);
  expect(result.mountedPages[0]).toContain("Cover content");
  expect(result.mountedPages[0]).not.toContain("Later content");
  expect(result.parseTimings).toEqual(
    expect.objectContaining({
      fileReadMs: expect.any(Number),
      parseMs: expect.any(Number),
      modelConstructionMs: expect.any(Number),
      fontLoadingMs: expect.any(Number),
    })
  );
  expect(result.timings).toEqual(
    expect.objectContaining({
      paginationMs: expect.any(Number),
      pageMountMs: expect.any(Number),
      rasterizationMs: expect.any(Number),
      encodingMs: expect.any(Number),
    })
  );
  await testInfo.attach("thumbnail-cold-start-timings", {
    body: JSON.stringify(
      { parse: result.parseTimings, render: result.timings },
      null,
      2
    ),
    contentType: "application/json",
  });
});
