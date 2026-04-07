import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "../../packages/doc-model/src";
import { parseDocx } from "../../packages/ooxml-core/src";
import { buildDocumentPageNodeSegments } from "../../packages/react-viewer/src/editor";
import { parseSectionLayout } from "../../packages/react-viewer/src/section-layout";

const DOCX_PATH =
  "/Users/andrewluo/Documents/DOCX testing/docx test/request-for-proposal-template-for-health-information-technology.docx";

describe("rfp template cover pagination", () => {
  it("keeps National Learning Consortium unnumbered and starts it on page 2", async () => {
    const zip = readFileSync(DOCX_PATH);
    const pkg = await parseDocx(zip);
    const model = buildDocModel(pkg);

    const nlcHeadingIndex = model.nodes.findIndex(
      (node) =>
        node.type === "paragraph" &&
        node.children.some(
          (child) =>
            child.type === "text" &&
            child.text.trim() === "National Learning Consortium"
        )
    );

    expect(nlcHeadingIndex).toBeGreaterThanOrEqual(0);
    const nlcHeadingParagraph = model.nodes[nlcHeadingIndex];
    expect(nlcHeadingParagraph?.type).toBe("paragraph");
    if (nlcHeadingParagraph?.type !== "paragraph") {
      return;
    }

    // TOCHeading in this template sets numId=0 to clear inherited Heading1
    // numbering. Keep it unnumbered on import.
    expect(
      !nlcHeadingParagraph.style?.numbering ||
        !Number.isFinite(nlcHeadingParagraph.style.numbering.numId) ||
        nlcHeadingParagraph.style.numbering.numId <= 0
    ).toBe(true);

    const leadingBlankTocHeadingIndex = model.nodes.findIndex(
      (node, index) =>
        index < nlcHeadingIndex &&
        node.type === "paragraph" &&
        node.style?.styleId === "TOCHeading" &&
        node.children.every(
          (child) => child.type !== "text" || child.text.trim().length === 0
        )
    );
    if (leadingBlankTocHeadingIndex >= 0) {
      const blankHeading = model.nodes[leadingBlankTocHeadingIndex];
      if (blankHeading?.type === "paragraph") {
        expect(
          !blankHeading.style?.numbering ||
            !Number.isFinite(blankHeading.style.numbering.numId) ||
            blankHeading.style.numbering.numId <= 0
        ).toBe(true);
      }
    }

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

    const secondPageNodeIndexes =
      pages[1]?.map((segment) => segment.nodeIndex) ?? [];
    expect(secondPageNodeIndexes).toContain(nlcHeadingIndex);

    const firstNonEmptyTextNodeOnSecondPage = secondPageNodeIndexes.find(
      (index) => {
        const node = model.nodes[index];
        if (!node || node.type !== "paragraph") {
          return false;
        }
        return node.children.some(
          (child) =>
            child.type === "text" && child.text.trim().length > 0
        );
      }
    );
    expect(firstNonEmptyTextNodeOnSecondPage).toBe(nlcHeadingIndex);
  });
});
