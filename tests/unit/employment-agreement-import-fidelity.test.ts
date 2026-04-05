import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseDocx } from "../../packages/ooxml-core/src";
import { buildDocModel } from "../../packages/doc-model/src";
import {
  buildDocumentPageNodeSegments,
  estimateParagraphLineHeightPx
} from "../../packages/react-viewer/src/editor";
import { parseSectionLayout } from "../../packages/react-viewer/src/section-layout";

const EMPLOYMENT_DOCX_PATH =
  "/Users/andrewluo/Documents/DOCX testing/2026-03-24_16-06-44/95c3ea3a962ca8f18cd9d43ae6515a609d9f39a19d70e21eae4ebce8c0bc7604.docx";

describe("employment agreement import fidelity", () => {
  it("keeps the cover title lines on the first page during static pagination", async () => {
    const zip = readFileSync(EMPLOYMENT_DOCX_PATH);
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

    const firstPageNodeIndexes = new Set((pages[0] ?? []).map((segment) => segment.nodeIndex));
    expect(firstPageNodeIndexes.has(24)).toBe(true);
    expect(firstPageNodeIndexes.has(25)).toBe(true);
    expect(firstPageNodeIndexes.has(26)).toBe(true);
  });

  it("does not let auto line height collapse below the paragraph font size", async () => {
    const zip = readFileSync(EMPLOYMENT_DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const paragraph = model.nodes[570];

    expect(paragraph?.type).toBe("paragraph");
    if (!paragraph || paragraph.type !== "paragraph") {
      throw new Error("Expected paragraph node at index 570");
    }

    expect(estimateParagraphLineHeightPx(paragraph)).toBeGreaterThanOrEqual(13);
  });
});
