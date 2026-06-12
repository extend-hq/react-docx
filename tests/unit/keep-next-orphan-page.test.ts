import { describe, expect, it } from "vitest";
import type { DocModel } from "@extend-ai/react-docx-doc-model";
import { buildDocumentPageNodeSegments } from "../../packages/react-viewer/src/editor";
import {
  buildDocumentPageNodeSegments as buildLayoutCorePageNodeSegments,
  collectDocxEstimatedOverflowBreakStartNodeIndexes
} from "@extend-ai/react-docx-layout-core";

type ModelNode = DocModel["nodes"][number];
type ParagraphNode = Extract<ModelNode, { type: "paragraph" }>;

const EMPTY_METADATA: DocModel["metadata"] = {
  sourceParts: 1,
  warnings: [],
  headerSections: [],
  footerSections: [],
  paragraphStyles: []
};

function paragraph(text: string, style?: ParagraphNode["style"]): ModelNode {
  return {
    type: "paragraph",
    ...(style ? { style } : {}),
    children: [{ type: "text", text }]
  };
}

// A keepNext heading whose keep chain (heading + keepNext companions +
// terminal paragraph) exceeds a full page. Pushing the heading to a fresh
// page can never satisfy the chain, so the companions must fill the pushed
// page greedily instead of breaking again right after the heading — that
// would strand the heading alone on a near-empty page (Word never does this).
describe("keepNext chain orphan page regression", () => {
  it("keeps at least the first companion with a keepNext heading pushed near the page bottom", () => {
    const fillerCount = 8;
    const headingIndex = fillerCount;
    const model: DocModel = {
      nodes: [
        ...Array.from({ length: fillerCount }, (_, index) =>
          paragraph(`Filler ${index + 1}`)
        ),
        paragraph("HEADING KEPT WITH NEXT", { keepNext: true, keepLines: true }),
        ...Array.from({ length: 30 }, (_, index) =>
          paragraph(`Keep companion ${index + 1}`, { keepNext: true })
        ),
        paragraph("Terminal paragraph")
      ],
      metadata: EMPTY_METADATA
    };

    const pages = buildDocumentPageNodeSegments(model, 200, 400);

    const headingPage = pages.find((pageSegments) =>
      pageSegments.some((segment) => segment.nodeIndex === headingIndex)
    );
    expect(headingPage).toBeDefined();
    // The chain cannot fit the remaining space, so the heading starts a page.
    expect(headingPage?.[0]?.nodeIndex).toBe(headingIndex);
    // Word semantics: the heading shares that page with its keep companions.
    expect(
      headingPage?.some((segment) => segment.nodeIndex === headingIndex + 1)
    ).toBe(true);
    expect(headingPage?.length).toBeGreaterThan(2);
  });

  it("fills the page after a keepNext heading that starts a page naturally", () => {
    const model: DocModel = {
      nodes: [
        paragraph("HEADING KEPT WITH NEXT", { keepNext: true, keepLines: true }),
        ...Array.from({ length: 30 }, (_, index) =>
          paragraph(`Keep companion ${index + 1}`, { keepNext: true })
        ),
        paragraph("Terminal paragraph")
      ],
      metadata: EMPTY_METADATA
    };

    const pages = buildDocumentPageNodeSegments(model, 200, 400);

    expect(pages[0]?.[0]?.nodeIndex).toBe(0);
    expect(pages[0]?.some((segment) => segment.nodeIndex === 1)).toBe(true);
    expect(pages[0]?.length).toBeGreaterThan(2);
  });

  // Deterministic-height variant against the layout-core solver: two 150px
  // fillers, a 20px keepNext heading, three 120px keepNext companions, and a
  // 120px terminal paragraph on 400px pages. The chain (620px) exceeds both
  // the remaining 100px and a fresh page, so the heading is pushed once and
  // the companions then fill that page until the terminal genuinely overflows.
  const buildDeterministicModel = (): DocModel => ({
    nodes: [
      paragraph("Filler 1"),
      paragraph("Filler 2"),
      paragraph("Heading", { keepNext: true }),
      paragraph("Keep companion 1", { keepNext: true }),
      paragraph("Keep companion 2", { keepNext: true }),
      paragraph("Keep companion 3", { keepNext: true }),
      paragraph("Terminal paragraph")
    ],
    metadata: EMPTY_METADATA
  });

  const deterministicHeightPx = (node: ModelNode): number => {
    if (node.type !== "paragraph") {
      return 0;
    }
    const text = node.children
      .map((child) => (child.type === "text" ? child.text : ""))
      .join("");
    if (text.startsWith("Filler")) {
      return 150;
    }
    if (text.startsWith("Heading")) {
      return 20;
    }
    return 120;
  };

  const deterministicCallbacks = {
    estimateDocNodeHeightPx: deterministicHeightPx,
    paragraphHasVisibleText: (node: ParagraphNode) =>
      node.children.some(
        (child) => child.type === "text" && child.text.trim().length > 0
      ),
    paragraphIsStructuralSectionBreakSpacer: () => false,
    estimateParagraphHeightPx: deterministicHeightPx,
    estimateParagraphLineHeightPx: () => 20,
    paragraphLineCountWithinWidth: () => 1,
    paragraphWidowControlEnabled: () => false,
    paragraphCanSplitAcrossPages: () => false,
    estimateTableRowHeightsPx: () => []
  };

  it("layout-core solver keeps the pushed heading with its companions", () => {
    const pages = buildLayoutCorePageNodeSegments(
      buildDeterministicModel(),
      400,
      600,
      deterministicCallbacks
    );

    expect(pages).toEqual([
      [{ nodeIndex: 0 }, { nodeIndex: 1 }],
      [{ nodeIndex: 2 }, { nodeIndex: 3 }, { nodeIndex: 4 }, { nodeIndex: 5 }],
      [{ nodeIndex: 6 }]
    ]);
  });

  it("layout-core overflow-break collection does not break again right after a keepNext push", () => {
    const breaks = collectDocxEstimatedOverflowBreakStartNodeIndexes(
      buildDeterministicModel(),
      new Set<number>(),
      400,
      600,
      deterministicCallbacks
    );

    expect([...breaks].sort((a, b) => a - b)).toEqual([2, 6]);
  });
});
