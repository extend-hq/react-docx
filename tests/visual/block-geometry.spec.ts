import path from "node:path";
import { expect, test } from "@playwright/test";

for (const zoom of [0.75, 1, 1.5]) {
  test(`fits paragraph highlights to visible text at ${zoom * 100}% zoom`, async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async ({ modulePath, zoom }) => {
      const api = await import(modulePath);
      const root = document.createElement("div");
      root.dataset.docxDocumentId = "geometry-document";
      Object.assign(root.style, { position: "absolute", left: "0", top: "0" });
      document.body.append(root);
      const makePage = (index: number) => {
        const wrapper = document.createElement("div");
        wrapper.dataset.docxPageIndex = String(index);
        const surface = document.createElement("div");
        surface.dataset.docxPageSurface = "true";
        Object.assign(surface.style, {
          position: "relative", width: "600px", height: "1000px", padding: "30px",
          boxSizing: "border-box", overflow: "hidden", font: "20px monospace",
          transform: `scale(${zoom})`, transformOrigin: "top left",
        });
        wrapper.append(surface);
        root.append(wrapper);
        return surface;
      };
      const surface = makePage(0);
      const source = (id: string) => ({
        documentId: "geometry-document", nodeId: id, partName: "word/document.xml",
        story: "body", offsetEncoding: "utf-16",
      });
      const paragraph = (id: string, text: string) => {
        const element = document.createElement("div");
        element.dataset.docxSourceId = id;
        element.dataset.docxParagraphHost = "true";
        Object.assign(element.style, { width: "500px", lineHeight: "60px", padding: "5px 15px", boxSizing: "border-box" });
        element.textContent = text;
        surface.append(element);
        return element;
      };
      const geometry = (id: string) => api.resolveDocxSourceGeometry(root, [source(id)]);
      const heading = paragraph("heading", "  Compact title  ");
      heading.style.textAlign = "center";
      const range = document.createRange();
      range.setStart(heading.firstChild!, 2);
      range.setEnd(heading.firstChild!, 15);
      const ink = range.getBoundingClientRect(), paper = surface.getBoundingClientRect();
      const expected = {
        left: (ink.left - paper.left) / zoom, top: (ink.top - paper.top) / zoom,
        right: (ink.right - paper.left) / zoom, bottom: (ink.bottom - paper.top) / zoom,
      };
      const headingGeometry = geometry("heading");
      const word = api.resolveDocxSourceGeometry(root, [{ ...source("heading"), start: 2, end: 9 }]);
      const list = paragraph("list", "Item");
      const label = document.createElement("span");
      label.dataset.docxNumberingLabel = "true";
      label.textContent = "1.a)";
      Object.assign(label.style, { display: "inline-block", width: "60px" });
      list.prepend(label);
      const listGeometry = geometry("list");
      const listWord = api.resolveDocxWordGeometries(root, [{
        id: "list-word", blockId: "list", content: "Item",
        sourceRefs: [{ ...source("list"), start: 0, end: 4 }],
      }]).get("list-word");
      const picture = document.createElement("img");
      picture.width = 12;
      picture.height = 12;
      picture.setAttribute("aria-hidden", "true");
      label.replaceChildren(picture);
      const pictureListGeometry = geometry("list");
      const wrapped = paragraph("wrapped", "Alpha beta gamma delta epsilon zeta eta theta");
      wrapped.style.width = "150px";
      wrapped.style.lineHeight = "30px";
      paragraph("empty", "   ");
      const mark = paragraph("mark", "");
      mark.style.textAlign = "center";
      const markSpan = document.createElement("span");
      markSpan.style.fontFamily = "Arial";
      markSpan.textContent = "\u0336";
      mark.append(markSpan);
      const markRange = document.createRange();
      markRange.selectNodeContents(markSpan);
      const markAdvance = markRange.getBoundingClientRect().width;
      const markGeometry = geometry("mark");
      const clippedMark = paragraph("clipped-mark", "");
      const clippedMarkSpan = markSpan.cloneNode(true) as HTMLElement;
      Object.assign(clippedMarkSpan.style, { display: "inline-block", width: "0", overflow: "hidden" });
      clippedMark.append(clippedMarkSpan);
      paragraph("format-control", "\u200c");
      paragraph("variation-selector", "\ufe0f");
      const textBox = paragraph("text-box", "Nested text");
      delete textBox.dataset.docxParagraphHost;
      const block = {
        object: "block", id: "text-box", type: "text", content: "Nested text",
        details: { kind: "paragraph" }, sourceRefs: [source("text-box")], children: [],
      };
      const nested = api.resolveDocxBlockGeometries(root, [block]).get(block.id);
      const structural = document.createElement("div");
      structural.dataset.docxSourceId = "table";
      Object.assign(structural.style, { width: "450px", height: "50px", boxSizing: "border-box" });
      surface.append(structural);
      const cell = document.createElement("div");
      cell.dataset.docxSourceId = "cell";
      Object.assign(cell.style, { width: "180px", height: "35px" });
      structural.append(cell);
      const clip = document.createElement("div");
      Object.assign(clip.style, { width: "100px", height: "40px", overflow: "hidden" });
      surface.append(clip);
      const clipped = paragraph("clipped", "Hidden");
      Object.assign(clipped.style, { width: "250px", padding: "0", textAlign: "right", lineHeight: "30px" });
      clip.append(clipped);
      const split = paragraph("split", "First fragment");
      const second = split.cloneNode(true) as HTMLElement;
      second.textContent = "Second fragment";
      makePage(1).append(second);
      const result = {
        heading: headingGeometry, expected, word, listGeometry, listWord, pictureListGeometry, wrapped: geometry("wrapped"),
        mark: markGeometry, markAdvance, clippedMark: geometry("clipped-mark"),
        formatControl: geometry("format-control"), variationSelector: geometry("variation-selector"),
        empty: geometry("empty"), nested, table: geometry("table"), cell: geometry("cell"),
        clipped: geometry("clipped"), split: geometry("split"),
        wrong: api.resolveDocxSourceGeometry(root, [{ ...source("heading"), documentId: "different" }]),
      };
      root.remove();
      return result;
    }, { modulePath: `/@fs${path.resolve("packages/react-viewer/src/block-geometry.tsx")}`, zoom });

    const [label, item] = result.listGeometry.fragments;
    expect(result.listGeometry.fragments).toHaveLength(2);
    expect(label.boundingBox.right).toBeLessThan(item.boundingBox.left);
    expect(result.listWord.status).toBe("rendered");
    expect(result.listWord.fragments.map((fragment: { boundingBox: unknown }) => fragment.boundingBox)).toEqual([item.boundingBox]);
    expect(result.pictureListGeometry.fragments).toHaveLength(2);
    const picture = result.pictureListGeometry.fragments[0].boundingBox;
    expect(picture.right - picture.left).toBeCloseTo(12, 1);
    expect(result.heading.status).toBe("rendered");
    expect(result.heading.fragments).toHaveLength(1);
    const heading = result.heading.fragments[0].boundingBox;
    for (const key of ["left", "top", "right", "bottom"] as const) {
      expect(heading[key]).toBeCloseTo(result.expected[key], 2);
    }
    expect(heading.right - heading.left).toBeLessThan(200);
    expect(heading.bottom - heading.top).toBeLessThan(30);
    expect(result.word.status).toBe("rendered");
    expect(result.word.fragments[0].boundingBox.right).toBeLessThan(heading.right);
    expect(result.wrapped.fragments.length).toBeGreaterThanOrEqual(3);
    expect(result.empty.status).toBe("not_visible");
    expect(result.empty.fragments).toHaveLength(0);
    expect(result.markAdvance).toBe(0);
    expect(result.mark.status).toBe("rendered");
    expect(result.mark.fragments).toHaveLength(1);
    const mark = result.mark.fragments[0].boundingBox;
    expect(mark.right - mark.left).toBeGreaterThan(0);
    expect(mark.right - mark.left).toBeLessThan(20);
    expect(result.clippedMark.status).toBe("not_visible");
    expect(result.formatControl.status).toBe("not_visible");
    expect(result.variationSelector.status).toBe("not_visible");
    expect(result.nested.status).toBe("rendered");
    const nested = result.nested.fragments[0].boundingBox;
    expect(nested.right - nested.left).toBeLessThan(150);
    for (const [geometry, width] of [[result.table, 450], [result.cell, 180]] as const) {
      const box = geometry.fragments[0].boundingBox;
      expect(box.right - box.left).toBeCloseTo(width, 2);
    }
    expect(result.clipped.status).toBe("not_visible");
    expect(result.clipped.fragments).toHaveLength(0);
    expect(result.split.fragments.map((fragment: { pageIndex: number }) => fragment.pageIndex)).toEqual([0, 1]);
    expect(result.wrong.status).toBe("unresolved");
    expect(result.wrong.fragments).toHaveLength(0);
  });
}
