import { describe, expect, it } from "vitest";
import type { DocModel, NumberingDefinitionSet } from "@react-docx/doc-model";
import {
  buildParagraphNumberingLabels,
  buildDocumentPageNodeSegments,
  paragraphLineCountWithinWidth
} from "../../packages/react-viewer/src/editor";

describe("paragraph indent wrapping", () => {
  it("treats hanging indents as a first-line-only width change during pagination", () => {
    const model: DocModel = {
      nodes: [
        {
          type: "paragraph",
          style: {
            indent: {
              leftTwips: 720,
              hangingTwips: 720
            }
          },
          children: [
            {
              type: "text",
              text: "AAA BBB CCC"
            }
          ]
        }
      ],
      metadata: {
        sourceParts: 1,
        warnings: [],
        headerSections: [],
        footerSections: [],
        paragraphStyles: []
      }
    };

    const pages = buildDocumentPageNodeSegments(
      model,
      24,
      120,
      undefined,
      [
        {
          startNodeIndex: 0,
          pageContentWidthPx: 120,
          pageContentHeightPx: 24
        }
      ]
    );

    expect(pages).toEqual([[{ nodeIndex: 0 }]]);
  });

  it("reserves numbering marker width when wrapping list paragraphs during pagination", () => {
    const numberingDefinitions: NumberingDefinitionSet = {
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
                hangingTwips: 360
              }
            }
          ]
        }
      ],
      instances: [
        {
          numId: 1,
          abstractNumId: 0
        }
      ]
    };
    const plainParagraph: DocModel["nodes"][number] = {
      type: "paragraph",
      style: {
        indent: {
          leftTwips: 720,
          hangingTwips: 360
        }
      },
      children: [
        {
          type: "text",
          text: "AAAA BBBB CCCC DDDD"
        }
      ]
    };
    const numberedParagraph: DocModel["nodes"][number] = {
      type: "paragraph",
      style: {
        numbering: {
          numId: 1,
          ilvl: 0
        }
      },
      children: [
        {
          type: "text",
          text: "AAAA BBBB CCCC DDDD"
        }
      ]
    };

    expect(paragraphLineCountWithinWidth(plainParagraph, 120, numberingDefinitions)).toBe(3);
    expect(paragraphLineCountWithinWidth(numberedParagraph, 120, numberingDefinitions)).toBe(4);
  });

  it("uses actual numbering label width for multi-digit list markers during pagination", () => {
    const createModel = (start: number): DocModel => ({
      nodes: [
        {
          type: "paragraph",
          style: {
            numbering: {
              numId: 1,
              ilvl: 0
            }
          },
          children: [
            {
              type: "text",
              text: "aaa bbb ccc ddd"
            }
          ]
        }
      ],
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
                    hangingTwips: 120
                  }
                }
              ]
            }
          ],
          instances: [
            {
              numId: 1,
              abstractNumId: 0,
              levelStartOverrides: {
                "0": start
              }
            }
          ]
        }
      }
    });

    const singleDigitModel = createModel(1);
    const multiDigitModel = createModel(100);
    const singleDigitParagraph = singleDigitModel.nodes[0];
    const multiDigitParagraph = multiDigitModel.nodes[0];

    expect(singleDigitParagraph?.type).toBe("paragraph");
    expect(multiDigitParagraph?.type).toBe("paragraph");
    if (singleDigitParagraph?.type !== "paragraph" || multiDigitParagraph?.type !== "paragraph") {
      return;
    }

    const singleDigitLabel = buildParagraphNumberingLabels(singleDigitModel).get("p:0");
    const multiDigitLabel = buildParagraphNumberingLabels(multiDigitModel).get("p:0");

    expect(
      paragraphLineCountWithinWidth(
        singleDigitParagraph,
        120,
        singleDigitModel.metadata.numberingDefinitions,
        singleDigitLabel
      )
    ).toBe(2);
    expect(
      paragraphLineCountWithinWidth(
        multiDigitParagraph,
        120,
        multiDigitModel.metadata.numberingDefinitions,
        multiDigitLabel
      )
    ).toBe(3);
  });

  it("uses numbering label width when segmenting pages for numbered paragraphs", () => {
    const createModel = (start: number): DocModel => ({
      nodes: [
        {
          type: "paragraph",
          children: [
            {
              type: "text",
              text: "Intro"
            }
          ]
        },
        {
          type: "paragraph",
          style: {
            numbering: {
              numId: 1,
              ilvl: 0
            }
          },
          children: [
            {
              type: "text",
              text: "aaa bbb ccc ddd"
            }
          ]
        }
      ],
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
                    hangingTwips: 120
                  }
                }
              ]
            }
          ],
          instances: [
            {
              numId: 1,
              abstractNumId: 0,
              levelStartOverrides: {
                "0": start
              }
            }
          ]
        }
      }
    });

    const singleDigitPages = buildDocumentPageNodeSegments(
      createModel(1),
      44,
      120,
      createModel(1).metadata.numberingDefinitions,
      [
        {
          startNodeIndex: 0,
          pageContentWidthPx: 120,
          pageContentHeightPx: 44
        }
      ],
      {
        allowParagraphLineSplitting: false
      }
    );
    const multiDigitPages = buildDocumentPageNodeSegments(
      createModel(100),
      44,
      120,
      createModel(100).metadata.numberingDefinitions,
      [
        {
          startNodeIndex: 0,
          pageContentWidthPx: 120,
          pageContentHeightPx: 44
        }
      ],
      {
        allowParagraphLineSplitting: false
      }
    );

    expect(singleDigitPages).toEqual([[{ nodeIndex: 0 }, { nodeIndex: 1 }]]);
    expect(multiDigitPages).toEqual([
      [{ nodeIndex: 0 }],
      [{ nodeIndex: 1 }]
    ]);
  });
});
