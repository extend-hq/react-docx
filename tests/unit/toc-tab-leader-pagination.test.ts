import { describe, expect, it } from "vitest";
import type { DocModel } from "@react-docx/doc-model";
import { paragraphLineCountWithinWidth } from "../../packages/react-viewer/src/editor";

describe("toc tab leader pagination", () => {
  it("reserves the trailing page-number zone before wrapping long TOC entries", () => {
    const paragraph: DocModel["nodes"][number] = {
      type: "paragraph",
      style: {
        styleId: "TOC3"
      },
      children: [
        {
          type: "text",
          text: "i.\tAllegation relating to evidence relied on to identify the Applicant\t15",
          style: {
            fontFamily: "Arial",
            fontSizePt: 11
          }
        }
      ]
    };

    expect(paragraphLineCountWithinWidth(paragraph, 320)).toBe(3);
  });

  it("accounts for a leading TOC marker tab before wrapping the title text", () => {
    const paragraph: DocModel["nodes"][number] = {
      type: "paragraph",
      style: {
        styleId: "TOC3"
      },
      children: [
        {
          type: "text",
          text: "i.\tObjection relating to non-exhaustion of local remedies\t11",
          style: {
            fontFamily: "Arial",
            fontSizePt: 11,
            characterSpacingTwips: 20
          }
        }
      ]
    };

    expect(paragraphLineCountWithinWidth(paragraph, 260)).toBe(4);
  });
});
