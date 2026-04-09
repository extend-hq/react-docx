import { describe, expect, it } from "vitest";
import type { DocModel } from "@extend-ai/react-docx-doc-model";
import { paragraphLineCountWithinWidth } from "../../packages/react-viewer/src/editor";

describe("character spacing pagination", () => {
  it("accounts for run character spacing when estimating wrapped line count", () => {
    const plainParagraph: DocModel["nodes"][number] = {
      type: "paragraph",
      children: [
        {
          type: "text",
          text: "Objection relating to non-exhaustion of local remedies"
        }
      ]
    };

    const spacedParagraph: DocModel["nodes"][number] = {
      type: "paragraph",
      children: [
        {
          type: "text",
          text: "Objection relating to non-exhaustion of local remedies",
          style: {
            italic: true,
            characterSpacingTwips: 20
          }
        }
      ]
    };

    const widthsWithAdditionalWrap = Array.from({ length: 161 }, (_, index) => 120 + index)
      .filter((widthPx) =>
        paragraphLineCountWithinWidth(plainParagraph, widthPx) <
        paragraphLineCountWithinWidth(spacedParagraph, widthPx)
      );

    expect(widthsWithAdditionalWrap.length).toBeGreaterThan(0);
  });
});
