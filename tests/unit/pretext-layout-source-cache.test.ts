import { describe, expect, it } from "vitest";
import type { ParagraphNode } from "../../packages/doc-model/src";
import { buildParagraphPretextLayoutSource } from "../../packages/react-viewer/src/editor";

function createParagraph(text: string): ParagraphNode {
  return {
    type: "paragraph",
    children: [
      {
        type: "text",
        text,
      },
    ],
  };
}

describe("pretext layout source cache", () => {
  it("reuses the same source object for repeated pagination reads", () => {
    const paragraph = createParagraph("Cached paragraph text");

    const first = buildParagraphPretextLayoutSource(paragraph);
    const second = buildParagraphPretextLayoutSource(paragraph);

    expect(first).toBeDefined();
    expect(second).toBe(first);
  });

  it("keeps tab-expansion variants isolated while reusing each variant", () => {
    const paragraph = createParagraph("Alpha\tBeta");

    const defaultSource = buildParagraphPretextLayoutSource(paragraph);
    const expandedTabs = buildParagraphPretextLayoutSource(paragraph, {
      expandTabsForLayout: true,
    });
    const expandedTabsAgain = buildParagraphPretextLayoutSource(paragraph, {
      expandTabsForLayout: true,
    });

    expect(defaultSource).toBeUndefined();
    expect(expandedTabs).toBeDefined();
    expect(expandedTabsAgain).toBe(expandedTabs);
  });

  it("caches explicit-line-break variants independently", () => {
    const paragraph = createParagraph("Alpha\nBeta");

    const defaultSource = buildParagraphPretextLayoutSource(paragraph);
    const allowedBreakSource = buildParagraphPretextLayoutSource(paragraph, {
      allowExplicitLineBreakText: true,
    });
    const allowedBreakSourceAgain = buildParagraphPretextLayoutSource(
      paragraph,
      {
        allowExplicitLineBreakText: true,
      }
    );

    expect(defaultSource).toBeUndefined();
    expect(allowedBreakSource).toBeDefined();
    expect(allowedBreakSourceAgain).toBe(allowedBreakSource);
  });
});
