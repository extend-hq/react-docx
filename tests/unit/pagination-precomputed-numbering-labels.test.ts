import { describe, expect, it } from "vitest";
import type { DocModel } from "@extend-ai/react-docx-doc-model";
import {
  buildDocumentPageNodeSegments,
  buildParagraphNumberingLabels,
} from "../../packages/react-viewer/src/editor";

function numberedListModel(): DocModel {
  const paragraphs: DocModel["nodes"] = Array.from(
    { length: 6 },
    (): DocModel["nodes"][number] => ({
      type: "paragraph",
      style: {
        numbering: {
          numId: 1,
          ilvl: 0,
        },
      },
      children: [
        {
          type: "text",
          text: "aaaa bbbb cccc dddd eeee ffff gggg hhhh",
        },
      ],
    })
  );
  return {
    nodes: paragraphs,
    metadata: {
      sourceParts: 1,
      warnings: [],
      headerSections: [],
      footerSections: [],
      paragraphStyles: [],
      numberingDefinitions: {
        abstracts: [
          {
            abstractNumId: 0,
            levels: [
              {
                ilvl: 0,
                format: "decimal",
                text: "%1.",
                suffix: "space",
                indent: {
                  leftTwips: 720,
                  hangingTwips: 360,
                },
              },
            ],
          },
        ],
        instances: [
          {
            numId: 1,
            abstractNumId: 0,
          },
        ],
      },
    },
  };
}

const PAGE_CONTENT_HEIGHT_PX = 96;
const PAGE_CONTENT_WIDTH_PX = 160;

function buildPages(
  model: DocModel,
  precomputedNumberingLabels?: ReturnType<typeof buildParagraphNumberingLabels>
) {
  return buildDocumentPageNodeSegments(
    model,
    PAGE_CONTENT_HEIGHT_PX,
    PAGE_CONTENT_WIDTH_PX,
    model.metadata.numberingDefinitions,
    [
      {
        startNodeIndex: 0,
        pageContentWidthPx: PAGE_CONTENT_WIDTH_PX,
        pageContentHeightPx: PAGE_CONTENT_HEIGHT_PX,
      },
    ],
    {
      allowParagraphLineSplitting: true,
      precomputedNumberingLabels,
    }
  );
}

describe("pagination precomputed numbering labels", () => {
  it("paginates identically when passed the labels it would otherwise derive", () => {
    const model = numberedListModel();
    const labels = buildParagraphNumberingLabels(model);

    expect(buildPages(model, labels)).toEqual(buildPages(model));
  });

  it("uses the provided labels instead of re-deriving them from the model", () => {
    const model = numberedListModel();
    const widenedLabels = buildParagraphNumberingLabels(model);
    widenedLabels.forEach((label) => {
      label.text = "9999999999.9999999999.9999999999.";
    });

    const defaultPages = buildPages(model);
    const widenedPages = buildPages(model, widenedLabels);

    // The widened markers steal enough line width that wrapping — and with it
    // the page segmentation — must shift; if pagination re-derived labels
    // internally the two plans would match.
    expect(widenedPages).not.toEqual(defaultPages);
  });
});
