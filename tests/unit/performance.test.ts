import { describe, expect, it } from "vitest";
import type { DocModel } from "@extend-ai/react-docx-doc-model";
import { buildDocModel } from "@extend-ai/react-docx-doc-model";
import { layoutDocument } from "@extend-ai/react-docx-layout-engine";
import { parseDocx } from "@extend-ai/react-docx-ooxml-core";
import { serializeDocx } from "@extend-ai/react-docx-serializer";

function createLargeModel(paragraphCount: number): DocModel {
  return {
    nodes: Array.from({ length: paragraphCount }, (_, index) => ({
      type: "paragraph" as const,
      style: {
        headingLevel: index % 25 === 0 ? 2 : undefined,
        align: index % 8 === 0 ? "justify" : "left"
      },
      children: [
        {
          type: "text" as const,
          text: `Paragraph ${index + 1}: The quick brown fox jumps over the lazy dog ${index}.`,
          style: {
            bold: index % 10 === 0,
            italic: index % 6 === 0,
            underline: index % 14 === 0,
            highlight: index % 7 === 0 ? "yellow" : undefined,
            fontSizePt: index % 25 === 0 ? 14 : 11
          }
        }
      ]
    })),
    metadata: {
      sourceParts: 1,
      warnings: [],
      headerSections: [],
      footerSections: [],
      paragraphStyles: [],
      defaultParagraphStyleId: "Normal"
    }
  };
}

describe("performance", () => {
  it("parses, models, lays out, and serializes a large document within baseline budgets", async () => {
    const sourceModel = createLargeModel(2000);

    const serializeStart = performance.now();
    const serialized = await serializeDocx(sourceModel);
    const serializeDuration = performance.now() - serializeStart;

    const parseStart = performance.now();
    const parsed = await parseDocx(serialized);
    const parseDuration = performance.now() - parseStart;

    const modelStart = performance.now();
    const model = await buildDocModel(parsed);
    const modelDuration = performance.now() - modelStart;

    const layoutStart = performance.now();
    const pages = layoutDocument(model);
    const layoutDuration = performance.now() - layoutStart;
    // Keep this visible in CI/local logs so baseline regressions are easy to spot.
    console.info(
      `performance-baseline serialize=${serializeDuration.toFixed(1)}ms parse=${parseDuration.toFixed(
        1
      )}ms model=${modelDuration.toFixed(1)}ms layout=${layoutDuration.toFixed(1)}ms pages=${pages.length}`
    );

    expect(pages.length).toBeGreaterThan(1);
    expect(serializeDuration).toBeLessThan(3500);
    expect(parseDuration).toBeLessThan(3500);
    expect(modelDuration).toBeLessThan(2500);
    expect(layoutDuration).toBeLessThan(2500);
  });
});
