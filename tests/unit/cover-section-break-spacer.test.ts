import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "../../packages/doc-model/src";
import { parseDocx } from "../../packages/ooxml-core/src";
import { buildDocumentPageNodeSegments } from "../../packages/react-viewer/src/editor";
import { parseSectionLayout } from "../../packages/react-viewer/src/section-layout";

const COVER_DOCX_PATH =
  "/Users/andrewluo/Documents/DOCX testing/2026-04-03_14-45-42/aece03acc5f1e0923355ca854a289060d9b5f9652f2f27b0042666b7025189f6.docx";

describe("cover section break spacer pagination", () => {
  it("keeps the empty cover sectPr paragraph from splitting the cover across extra pages", async () => {
    const zip = readFileSync(COVER_DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const layout = parseSectionLayout(model.metadata.sectionPropertiesXml);
    const pages = buildDocumentPageNodeSegments(
      model,
      layout.pageHeightPx - layout.marginsPx.top - layout.marginsPx.bottom,
      layout.pageWidthPx - layout.marginsPx.left - layout.marginsPx.right,
      model.metadata.numberingDefinitions,
      []
    );

    expect(pages[0]?.map((segment) => segment.nodeIndex)).toEqual([0, 1]);
    expect(pages[1]?.[0]?.nodeIndex).toBe(3);
  });
});
