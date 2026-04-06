import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "../../packages/doc-model/src";
import { parseDocx } from "../../packages/ooxml-core/src";
import { buildDocumentPageNodeSegments } from "../../packages/react-viewer/src/editor";
import { parseSectionLayout } from "../../packages/react-viewer/src/section-layout";

const DOCX_PATH =
  "/Users/andrewluo/Documents/DOCX testing/docx test/Copy of rfp.docx";

describe("rfp pagination fidelity", () => {
  it("keeps the first section tail on page 1", async () => {
    const zip = readFileSync(DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);
    const primaryLayout = parseSectionLayout(
      model.metadata.sections?.[0]?.sectionPropertiesXml ??
        model.metadata.sectionPropertiesXml
    );
    const pageContentWidthPx =
      primaryLayout.pageWidthPx -
      primaryLayout.marginsPx.left -
      primaryLayout.marginsPx.right;
    const pageContentHeightPx =
      primaryLayout.pageHeightPx -
      primaryLayout.marginsPx.top -
      primaryLayout.marginsPx.bottom;

    const pages = buildDocumentPageNodeSegments(
      model,
      pageContentHeightPx,
      pageContentWidthPx,
      model.metadata.numberingDefinitions
    );

    const firstPageNodeIndexes = pages[0]?.map((segment) => segment.nodeIndex) ?? [];
    console.log("page-count", pages.length);
    console.log(
      "page-1",
      firstPageNodeIndexes,
      "page-2",
      pages[1]?.map((segment) => segment.nodeIndex) ?? []
    );
    expect(firstPageNodeIndexes).toContain(22);
    expect(firstPageNodeIndexes).toContain(23);
  });
});
