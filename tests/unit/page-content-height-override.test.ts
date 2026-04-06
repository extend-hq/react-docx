import { describe, expect, it } from "vitest";
import {
  documentPageContainsOnlySplitParagraphSegments,
  resolvePageContentHeightPxForPageSegments,
  estimateParagraphLineHeightPx,
} from "../../packages/react-viewer/src/editor";

describe("page content height overrides", () => {
  it("ignores measured height shrinkage for pages containing only split paragraph segments", () => {
    expect(
      resolvePageContentHeightPxForPageSegments(
        [
          {
            nodeIndex: 0,
            paragraphLineRange: {
              startLineIndex: 0,
              endLineIndex: 6,
              totalLineCount: 208,
              lineHeightPx: 14,
            },
          },
        ],
        0,
        864,
        [
          {
            startNodeIndex: 0,
            pageContentWidthPx: 624,
            pageContentHeightPx: 864,
            pageContentHeightMultiplier: 1,
          },
        ],
        [120]
      )
    ).toBe(864);
  });

  it("still honors measured height overrides for normal unsplit pages", () => {
    expect(
      resolvePageContentHeightPxForPageSegments(
        [{ nodeIndex: 0 }],
        0,
        864,
        [
          {
            startNodeIndex: 0,
            pageContentWidthPx: 624,
            pageContentHeightPx: 864,
            pageContentHeightMultiplier: 1,
          },
        ],
        [720]
      )
    ).toBe(720);
  });

  it("detects pages composed entirely of split paragraph segments", () => {
    expect(
      documentPageContainsOnlySplitParagraphSegments([
        {
          nodeIndex: 0,
          paragraphLineRange: {
            startLineIndex: 0,
            endLineIndex: 6,
            totalLineCount: 208,
            lineHeightPx: 14,
          },
        },
      ])
    ).toBe(true);

    expect(
      documentPageContainsOnlySplitParagraphSegments([{ nodeIndex: 0 }])
    ).toBe(false);
  });

  it("treats Times Roman like a serif font for auto line spacing", () => {
    const timesRomanHeightPx = estimateParagraphLineHeightPx({
      type: "paragraph",
      style: {
        spacing: {
          lineTwips: 240,
          lineRule: "auto",
        },
      },
      children: [
        {
          type: "text",
          text: "Sample",
          style: {
            fontSizePt: 12,
            fontFamily: "Times Roman",
          },
        },
      ],
    } as never);
    const arialHeightPx = estimateParagraphLineHeightPx({
      type: "paragraph",
      style: {
        spacing: {
          lineTwips: 240,
          lineRule: "auto",
        },
      },
      children: [
        {
          type: "text",
          text: "Sample",
          style: {
            fontSizePt: 12,
            fontFamily: "Arial",
          },
        },
      ],
    } as never);

    expect(timesRomanHeightPx).toBeGreaterThan(arialHeightPx);
  });
});
