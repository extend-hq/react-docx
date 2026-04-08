import type { DocModel } from "@react-docx/doc-model";
import type { PretextSelectionRect } from "./pretext-layout";
import type { DocumentLayoutMetrics } from "./section-layout";

export type LayoutInvalidationScope =
  | "text-edit"
  | "style-change"
  | "object-move-resize"
  | "table-edit"
  | "section-header-footer-change";

export interface LayoutParagraphLineRange {
  startLineIndex: number;
  endLineIndex: number;
  totalLineCount: number;
  lineHeightPx: number;
}

export interface LayoutTableRowRange {
  startRowIndex: number;
  endRowIndex: number;
}

export interface LayoutTableRowSlice {
  rowIndex: number;
  startOffsetPx: number;
  sliceHeightPx: number;
  totalRowHeightPx: number;
}

export interface LayoutNodeSegment {
  nodeIndex: number;
  tableRowRange?: LayoutTableRowRange;
  tableRowSlice?: LayoutTableRowSlice;
  paragraphLineRange?: LayoutParagraphLineRange;
}

export interface FloatingObjectDraftState {
  kind: "floating-image" | "drop-cap" | "resize";
  targetKey: string;
  deltaX?: number;
  deltaY?: number;
  widthPx?: number;
  heightPx?: number;
}

export interface SelectionState {
  locationKey: string;
  anchorOffset: number;
  headOffset: number;
  affinity?: "forward" | "backward";
}

export interface LayoutLineFragment {
  lineageId: string;
  startOffset: number;
  endOffset: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LayoutBlock {
  id: string;
  kind: "paragraph" | "table";
  nodeIndex: number;
  zIndex: number;
  lineFragments: LayoutLineFragment[];
  segment: LayoutNodeSegment;
}

export interface LayoutRegion {
  id: string;
  kind: "body" | "header" | "footer" | "footnote" | "endnote";
  zIndex: number;
  blocks: LayoutBlock[];
}

export interface LayoutPage {
  index: number;
  layout: DocumentLayoutMetrics;
  bodySegments: LayoutNodeSegment[];
  regions: LayoutRegion[];
}

export interface LayoutSnapshot {
  version: number;
  createdAtMs: number;
  invalidationScopes: LayoutInvalidationScope[];
  interactionDrafts: FloatingObjectDraftState[];
  selectionState?: SelectionState;
  pages: LayoutPage[];
  pageIndexByNodeIndex: Map<number, number>;
}

export interface BuildLayoutSnapshotArgs {
  model: DocModel;
  pageSegmentsByPage: LayoutNodeSegment[][];
  resolvePageLayout: (pageIndex: number) => DocumentLayoutMetrics;
  invalidationScopes?: LayoutInvalidationScope[];
  interactionDrafts?: FloatingObjectDraftState[];
  selectionState?: SelectionState;
  version?: number;
}

export type LayoutEditOperation =
  | {
      kind: "set-selection";
      selectionState?: SelectionState;
    }
  | {
      kind: "set-floating-draft";
      draft: FloatingObjectDraftState;
    }
  | {
      kind: "clear-floating-draft";
      targetKey: string;
    };

export interface LayoutPoint {
  pageIndex: number;
  x: number;
  y: number;
}

export interface LayoutOffsetTarget {
  nodeIndex: number;
  offset: number;
}

export interface SnapshotSelectionRect extends PretextSelectionRect {
  pageIndex: number;
  nodeIndex: number;
}

function cloneLineFragment(fragment: LayoutLineFragment): LayoutLineFragment {
  return {
    lineageId: fragment.lineageId,
    startOffset: fragment.startOffset,
    endOffset: fragment.endOffset,
    left: fragment.left,
    top: fragment.top,
    width: fragment.width,
    height: fragment.height,
  };
}

function createBlockFromSegment(
  model: DocModel,
  segment: LayoutNodeSegment,
  pageIndex: number,
  blockIndex: number
): LayoutBlock {
  const node = model.nodes[segment.nodeIndex];
  const kind = node?.type === "table" ? "table" : "paragraph";
  const id = `p${pageIndex}-b${blockIndex}-n${segment.nodeIndex}`;
  return {
    id,
    kind,
    nodeIndex: segment.nodeIndex,
    zIndex: 1,
    lineFragments: [],
    segment,
  };
}

export function buildLayoutSnapshot(
  args: BuildLayoutSnapshotArgs
): LayoutSnapshot {
  const pages: LayoutPage[] = args.pageSegmentsByPage.map(
    (segments, pageIndex) => {
      const blocks = segments.map((segment, blockIndex) =>
        createBlockFromSegment(args.model, segment, pageIndex, blockIndex)
      );
      return {
        index: pageIndex,
        layout: args.resolvePageLayout(pageIndex),
        bodySegments: segments.map((segment) => ({
          nodeIndex: segment.nodeIndex,
          tableRowRange: segment.tableRowRange
            ? {
                startRowIndex: segment.tableRowRange.startRowIndex,
                endRowIndex: segment.tableRowRange.endRowIndex,
              }
            : undefined,
          tableRowSlice: segment.tableRowSlice
            ? {
                rowIndex: segment.tableRowSlice.rowIndex,
                startOffsetPx: segment.tableRowSlice.startOffsetPx,
                sliceHeightPx: segment.tableRowSlice.sliceHeightPx,
                totalRowHeightPx: segment.tableRowSlice.totalRowHeightPx,
              }
            : undefined,
          paragraphLineRange: segment.paragraphLineRange
            ? {
                startLineIndex: segment.paragraphLineRange.startLineIndex,
                endLineIndex: segment.paragraphLineRange.endLineIndex,
                totalLineCount: segment.paragraphLineRange.totalLineCount,
                lineHeightPx: segment.paragraphLineRange.lineHeightPx,
              }
            : undefined,
        })),
        regions: [
          {
            id: `page-${pageIndex}-body`,
            kind: "body",
            zIndex: 1,
            blocks,
          },
        ],
      };
    }
  );

  const pageIndexByNodeIndex = new Map<number, number>();
  pages.forEach((page) => {
    page.bodySegments.forEach((segment) => {
      if (!pageIndexByNodeIndex.has(segment.nodeIndex)) {
        pageIndexByNodeIndex.set(segment.nodeIndex, page.index);
      }
    });
  });

  return {
    version: args.version ?? 1,
    createdAtMs: Date.now(),
    invalidationScopes: [...(args.invalidationScopes ?? [])],
    interactionDrafts: [...(args.interactionDrafts ?? [])],
    selectionState: args.selectionState
      ? {
          locationKey: args.selectionState.locationKey,
          anchorOffset: args.selectionState.anchorOffset,
          headOffset: args.selectionState.headOffset,
          affinity: args.selectionState.affinity,
        }
      : undefined,
    pages,
    pageIndexByNodeIndex,
  };
}

export function applyEditOperation(
  snapshot: LayoutSnapshot,
  operation: LayoutEditOperation
): LayoutSnapshot {
  if (operation.kind === "set-selection") {
    return {
      ...snapshot,
      selectionState: operation.selectionState
        ? {
            locationKey: operation.selectionState.locationKey,
            anchorOffset: operation.selectionState.anchorOffset,
            headOffset: operation.selectionState.headOffset,
            affinity: operation.selectionState.affinity,
          }
        : undefined,
    };
  }

  if (operation.kind === "set-floating-draft") {
    const nextDrafts = snapshot.interactionDrafts.filter(
      (draft) => draft.targetKey !== operation.draft.targetKey
    );
    nextDrafts.push({ ...operation.draft });
    return {
      ...snapshot,
      interactionDrafts: nextDrafts,
    };
  }

  return {
    ...snapshot,
    interactionDrafts: snapshot.interactionDrafts.filter(
      (draft) => draft.targetKey !== operation.targetKey
    ),
  };
}

export function mapPointToDocOffset(
  snapshot: LayoutSnapshot,
  point: LayoutPoint
): LayoutOffsetTarget | undefined {
  const page = snapshot.pages[point.pageIndex];
  if (!page) {
    return undefined;
  }

  const bodyRegion = page.regions.find((region) => region.kind === "body");
  if (!bodyRegion) {
    return undefined;
  }

  let bestMatch:
    | {
        distance: number;
        nodeIndex: number;
        offset: number;
      }
    | undefined;

  bodyRegion.blocks.forEach((block) => {
    block.lineFragments.forEach((fragment) => {
      const inY = point.y >= fragment.top && point.y <= fragment.top + fragment.height;
      const inX = point.x >= fragment.left && point.x <= fragment.left + fragment.width;
      if (inY && inX) {
        const midpoint = fragment.left + fragment.width / 2;
        const offset = point.x <= midpoint ? fragment.startOffset : fragment.endOffset;
        const distance = Math.abs(point.x - midpoint);
        if (!bestMatch || distance < bestMatch.distance) {
          bestMatch = {
            distance,
            nodeIndex: block.nodeIndex,
            offset,
          };
        }
      }
    });
  });

  if (!bestMatch) {
    return undefined;
  }

  return {
    nodeIndex: bestMatch.nodeIndex,
    offset: bestMatch.offset,
  };
}

export function mapOffsetToCaretRect(
  snapshot: LayoutSnapshot,
  target: LayoutOffsetTarget
): (PretextSelectionRect & { pageIndex: number }) | undefined {
  for (const page of snapshot.pages) {
    const bodyRegion = page.regions.find((region) => region.kind === "body");
    if (!bodyRegion) {
      continue;
    }

    for (const block of bodyRegion.blocks) {
      if (block.nodeIndex !== target.nodeIndex) {
        continue;
      }

      for (const fragment of block.lineFragments) {
        if (
          target.offset < fragment.startOffset ||
          target.offset > fragment.endOffset
        ) {
          continue;
        }

        const atEnd = target.offset >= fragment.endOffset;
        return {
          pageIndex: page.index,
          left: atEnd ? fragment.left + fragment.width : fragment.left,
          top: fragment.top,
          width: 1,
          height: fragment.height,
        };
      }
    }
  }

  return undefined;
}

export function resolveSelectionRectsForNode(
  snapshot: LayoutSnapshot,
  target: {
    nodeIndex: number;
    startOffset: number;
    endOffset: number;
  }
): SnapshotSelectionRect[] {
  const normalizedStart = Math.max(
    0,
    Math.min(target.startOffset, target.endOffset)
  );
  const normalizedEnd = Math.max(
    normalizedStart,
    Math.max(target.startOffset, target.endOffset)
  );
  if (normalizedEnd <= normalizedStart) {
    return [];
  }

  const rects: SnapshotSelectionRect[] = [];
  for (const page of snapshot.pages) {
    const bodyRegion = page.regions.find((region) => region.kind === "body");
    if (!bodyRegion) {
      continue;
    }

    for (const block of bodyRegion.blocks) {
      if (block.nodeIndex !== target.nodeIndex) {
        continue;
      }

      for (const fragment of block.lineFragments) {
        const overlapStart = Math.max(normalizedStart, fragment.startOffset);
        const overlapEnd = Math.min(normalizedEnd, fragment.endOffset);
        if (overlapEnd <= overlapStart) {
          continue;
        }

        const offsetSpan = Math.max(1, fragment.endOffset - fragment.startOffset);
        const startRatio = Math.min(
          1,
          Math.max(0, (overlapStart - fragment.startOffset) / offsetSpan)
        );
        const endRatio = Math.min(
          1,
          Math.max(0, (overlapEnd - fragment.startOffset) / offsetSpan)
        );
        const left = fragment.left + Math.round(fragment.width * startRatio);
        const right = fragment.left + Math.round(fragment.width * endRatio);
        rects.push({
          pageIndex: page.index,
          nodeIndex: block.nodeIndex,
          left,
          top: fragment.top,
          width: Math.max(1, right - left),
          height: fragment.height,
        });
      }
    }
  }

  return rects;
}

export function withLineFragments(
  snapshot: LayoutSnapshot,
  pageIndex: number,
  blockId: string,
  lineFragments: LayoutLineFragment[]
): LayoutSnapshot {
  return {
    ...snapshot,
    pages: snapshot.pages.map((page) => {
      if (page.index !== pageIndex) {
        return page;
      }

      return {
        ...page,
        regions: page.regions.map((region) => {
          if (region.kind !== "body") {
            return region;
          }

          return {
            ...region,
            blocks: region.blocks.map((block) =>
              block.id === blockId
                ? {
                    ...block,
                    lineFragments: lineFragments.map(cloneLineFragment),
                  }
                : block
            ),
          };
        }),
      };
    }),
  };
}
