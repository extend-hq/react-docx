import { describe, expect, it } from "vitest";
import type { DocModel } from "@react-docx/doc-model";
import {
  applyEditOperation,
  buildLayoutSnapshot,
  mapOffsetToCaretRect,
  mapPointToDocOffset,
  resolveSelectionRectsForNode,
  withLineFragments,
} from "../../packages/react-viewer/src/layout-snapshot";
import { DEFAULT_DOCUMENT_LAYOUT } from "../../packages/react-viewer/src/section-layout";

const TEST_LAYOUT = {
  ...DEFAULT_DOCUMENT_LAYOUT,
  pageWidthPx: 900,
  pageHeightPx: 1200,
};

function createTestModel(): DocModel {
  return {
    nodes: [
      {
        type: "paragraph",
        children: [],
      },
      {
        type: "paragraph",
        children: [],
      },
    ],
    metadata: {},
  } as unknown as DocModel;
}

describe("layout snapshot kernel", () => {
  it("builds pages and node-to-page index mapping", () => {
    const snapshot = buildLayoutSnapshot({
      model: createTestModel(),
      pageSegmentsByPage: [[{ nodeIndex: 0 }], [{ nodeIndex: 1 }]],
      resolvePageLayout: () => TEST_LAYOUT,
    });

    expect(snapshot.pages).toHaveLength(2);
    expect(snapshot.pages[0]?.regions[0]?.blocks[0]?.nodeIndex).toBe(0);
    expect(snapshot.pages[1]?.regions[0]?.blocks[0]?.nodeIndex).toBe(1);
    expect(snapshot.pageIndexByNodeIndex.get(0)).toBe(0);
    expect(snapshot.pageIndexByNodeIndex.get(1)).toBe(1);
  });

  it("applies selection and floating draft edit operations", () => {
    const baseSnapshot = buildLayoutSnapshot({
      model: createTestModel(),
      pageSegmentsByPage: [[{ nodeIndex: 0 }]],
      resolvePageLayout: () => TEST_LAYOUT,
    });
    const withSelection = applyEditOperation(baseSnapshot, {
      kind: "set-selection",
      selectionState: {
        locationKey: "p:0",
        anchorOffset: 2,
        headOffset: 7,
        affinity: "forward",
      },
    });
    const withDraft = applyEditOperation(withSelection, {
      kind: "set-floating-draft",
      draft: {
        kind: "floating-image",
        targetKey: "img:1",
        deltaX: 14,
        deltaY: -8,
      },
    });
    const clearedDraft = applyEditOperation(withDraft, {
      kind: "clear-floating-draft",
      targetKey: "img:1",
    });

    expect(withSelection.selectionState?.locationKey).toBe("p:0");
    expect(withDraft.interactionDrafts).toHaveLength(1);
    expect(withDraft.interactionDrafts[0]?.targetKey).toBe("img:1");
    expect(clearedDraft.interactionDrafts).toHaveLength(0);
  });

  it("maps point-to-offset and offset-to-caret from line fragments", () => {
    const baseSnapshot = buildLayoutSnapshot({
      model: createTestModel(),
      pageSegmentsByPage: [[{ nodeIndex: 0 }]],
      resolvePageLayout: () => TEST_LAYOUT,
    });
    const withFragments = withLineFragments(baseSnapshot, 0, "p0-b0-n0", [
      {
        lineageId: "line-0",
        startOffset: 0,
        endOffset: 10,
        left: 10,
        top: 10,
        width: 40,
        height: 18,
      },
    ]);

    expect(
      mapPointToDocOffset(withFragments, {
        pageIndex: 0,
        x: 14,
        y: 14,
      })
    ).toEqual({
      nodeIndex: 0,
      offset: 0,
    });
    expect(
      mapPointToDocOffset(withFragments, {
        pageIndex: 0,
        x: 44,
        y: 14,
      })
    ).toEqual({
      nodeIndex: 0,
      offset: 10,
    });
    expect(
      mapPointToDocOffset(withFragments, {
        pageIndex: 0,
        x: 300,
        y: 300,
      })
    ).toBeUndefined();
    expect(
      mapOffsetToCaretRect(withFragments, {
        nodeIndex: 0,
        offset: 10,
      })
    ).toEqual({
      pageIndex: 0,
      left: 50,
      top: 10,
      width: 1,
      height: 18,
    });
  });

  it("resolves selection rects across line fragments", () => {
    const baseSnapshot = buildLayoutSnapshot({
      model: createTestModel(),
      pageSegmentsByPage: [[{ nodeIndex: 0 }]],
      resolvePageLayout: () => TEST_LAYOUT,
    });
    const withFragments = withLineFragments(baseSnapshot, 0, "p0-b0-n0", [
      {
        lineageId: "line-0-frag-0",
        startOffset: 0,
        endOffset: 10,
        left: 10,
        top: 10,
        width: 40,
        height: 18,
      },
      {
        lineageId: "line-1-frag-0",
        startOffset: 10,
        endOffset: 20,
        left: 12,
        top: 28,
        width: 50,
        height: 18,
      },
    ]);

    const selectionRects = resolveSelectionRectsForNode(withFragments, {
      nodeIndex: 0,
      startOffset: 5,
      endOffset: 15,
    });

    expect(selectionRects).toEqual([
      {
        pageIndex: 0,
        nodeIndex: 0,
        left: 30,
        top: 10,
        width: 20,
        height: 18,
      },
      {
        pageIndex: 0,
        nodeIndex: 0,
        left: 12,
        top: 28,
        width: 25,
        height: 18,
      },
    ]);
  });
});
