import { describe, expect, it } from "vitest";
import {
  reconcilePageCountCandidateToTargetCountByScalingHeight,
  reconcilePagesToTargetCountByScalingHeight,
  resolveMeasuredBodyFooterOverlapLatchState,
  shouldLatchMeasuredBodyFooterOverlap,
  shouldAllowStoredPageCountReduction,
} from "../../packages/react-viewer/src/page-count-reconciliation";

describe("page-count-reconciliation", () => {
  it("adds pages by reducing effective page height when Word stored more pages", () => {
    const initialPages = [["page-1"]];
    const reconciled = reconcilePagesToTargetCountByScalingHeight({
      initialPages,
      targetPageCount: 3,
      buildPagesAtScale: (scale) => {
        if (scale <= 0.94) {
          return [["page-1"], ["page-2"], ["page-3"]];
        }
        if (scale <= 0.98) {
          return [["page-1"], ["page-2"]];
        }
        return initialPages;
      },
    });

    expect(reconciled).toHaveLength(3);
  });

  it("removes pages by increasing effective page height when Word stored fewer pages", () => {
    const initialPages = [["page-1"], ["page-2"], ["page-3"]];
    const reconciled = reconcilePagesToTargetCountByScalingHeight({
      initialPages,
      targetPageCount: 1,
      buildPagesAtScale: (scale) => {
        if (scale >= 1.08) {
          return [["page-1"]];
        }
        if (scale >= 1.04) {
          return [["page-1"], ["page-2"]];
        }
        return initialPages;
      },
    });

    expect(reconciled).toHaveLength(1);
  });

  it("keeps the original pagination when the stored page count is too far away", () => {
    const initialPages = [["page-1"], ["page-2"], ["page-3"], ["page-4"]];
    const reconciled = reconcilePagesToTargetCountByScalingHeight({
      initialPages,
      targetPageCount: 10,
      buildPagesAtScale: () => [["other-page"]],
    });

    expect(reconciled).toBe(initialPages);
  });

  it("keeps the original pagination when no scale reaches a smaller stored count", () => {
    // A stale generator page count (e.g. a never-repaginated <Pages>1</Pages>)
    // that scaling cannot actually reach must not leave a partially compressed
    // pagination behind: those pages were budgeted against a taller virtual
    // page than the physical one and render clipped.
    const initialPages = [["page-1"], ["page-2"], ["page-3"], ["page-4"]];
    const reconciledCandidate =
      reconcilePageCountCandidateToTargetCountByScalingHeight({
        initialPages,
        targetPageCount: 1,
        buildPagesAtScale: (scale) =>
          scale >= 1.2 ? [["page-1"], ["page-2"]] : initialPages,
      });

    expect(reconciledCandidate.pages).toBe(initialPages);
    expect(reconciledCandidate.scale).toBe(1);
  });

  it("respects custom candidate scales when narrowing an over-pagination case", () => {
    const initialPages = [["page-1"], ["page-2"], ["page-3"]];
    const reconciled = reconcilePagesToTargetCountByScalingHeight({
      initialPages,
      targetPageCount: 2,
      scales: [1.01, 1.02, 1.03],
      buildPagesAtScale: (scale) => {
        if (scale >= 1.02) {
          return [["page-1"], ["page-2"]];
        }
        return initialPages;
      },
    });

    expect(reconciled).toEqual([["page-1"], ["page-2"]]);
  });

  it("returns the selected scale so render math can stay aligned with reconciliation", () => {
    const initialPages = [["page-1"], ["page-2"], ["page-3"]];
    const reconciledCandidate =
      reconcilePageCountCandidateToTargetCountByScalingHeight({
        initialPages,
        targetPageCount: 2,
        scales: [1.02, 1.04, 1.06],
        buildPagesAtScale: (scale) => {
          if (scale >= 1.04) {
            return [["page-1"], ["page-2"]];
          }
          return initialPages;
        },
      });

    expect(reconciledCandidate.pages).toEqual([["page-1"], ["page-2"]]);
    expect(reconciledCandidate.scale).toBe(1.04);
  });

  it("refines the first exact page-count match to the smallest working scale", () => {
    const initialPages = [
      ["page-1"],
      ["page-2"],
      ["page-3"],
      ["page-4"],
      ["page-5"],
      ["page-6"],
      ["page-7"],
    ];
    const reconciledCandidate =
      reconcilePageCountCandidateToTargetCountByScalingHeight({
        initialPages,
        targetPageCount: 5,
        scales: [1.18, 1.2],
        buildPagesAtScale: (scale) => {
          if (scale >= 1.182) {
            return [["page-1"], ["page-2"], ["page-3"], ["page-4"], ["page-5"]];
          }
          if (scale >= 1.12) {
            return [
              ["page-1"],
              ["page-2"],
              ["page-3"],
              ["page-4"],
              ["page-5"],
              ["page-6"],
            ];
          }
          return initialPages;
        },
      });

    expect(reconciledCandidate.pages).toHaveLength(5);
    expect(reconciledCandidate.scale).toBeCloseTo(1.182, 6);
  });

  it("does not reduce to a stale stored page count when last-rendered break hints are present", () => {
    expect(
      shouldAllowStoredPageCountReduction({
        estimatedPageCount: 4,
        targetPageCount: 3,
        hasLastRenderedPageBreakHints: true,
        renderedBreakHintPageCount: 4,
      })
    ).toBe(false);
  });

  it("still allows reduction when the stored page count matches the rendered break hints", () => {
    expect(
      shouldAllowStoredPageCountReduction({
        estimatedPageCount: 3,
        targetPageCount: 2,
        hasLastRenderedPageBreakHints: true,
        renderedBreakHintPageCount: 2,
      })
    ).toBe(true);
  });

  it("still allows reduction when no last-rendered break hints are present", () => {
    expect(
      shouldAllowStoredPageCountReduction({
        estimatedPageCount: 4,
        targetPageCount: 3,
        hasLastRenderedPageBreakHints: false,
      })
    ).toBe(true);
  });

  it("does not reduce to a stored page count after live footer overlap is measured", () => {
    expect(
      shouldAllowStoredPageCountReduction({
        estimatedPageCount: 3,
        targetPageCount: 2,
        hasMeasuredBodyFooterOverlap: true,
      })
    ).toBe(false);
  });

  it("keeps reducing despite measured footer overlap when rendered break hints support the stored page count", () => {
    // Regression: 8256f805 (Fannie Mae form 3141) — Word renders 3 pages with
    // 2 mid-paragraph lastRenderedPageBreak markers. The dense pages measure
    // as overlapping the estimated footer reserve, but the hint-aligned
    // 3-page plan is Word's own truth and must not be abandoned for the
    // over-estimated 5-page layout.
    expect(
      shouldAllowStoredPageCountReduction({
        estimatedPageCount: 5,
        targetPageCount: 3,
        hasLastRenderedPageBreakHints: true,
        renderedBreakHintPageCount: 3,
        hasMeasuredBodyFooterOverlap: true,
      })
    ).toBe(true);
  });

  it("still blocks reduction on measured footer overlap when hints contradict the stored page count", () => {
    expect(
      shouldAllowStoredPageCountReduction({
        estimatedPageCount: 5,
        targetPageCount: 3,
        hasLastRenderedPageBreakHints: true,
        renderedBreakHintPageCount: 4,
        hasMeasuredBodyFooterOverlap: true,
      })
    ).toBe(false);
  });

  it("only latches measured footer overlap once pagination is at or below the stored target", () => {
    expect(
      shouldLatchMeasuredBodyFooterOverlap({
        pageCount: 7,
        targetPageCount: 5,
        measuredBodyFooterOverlap: true,
      })
    ).toBe(false);

    expect(
      shouldLatchMeasuredBodyFooterOverlap({
        pageCount: 5,
        targetPageCount: 5,
        measuredBodyFooterOverlap: true,
      })
    ).toBe(true);
  });

  it("requires a stable repeated overlap signature before latching", () => {
    const firstPass = resolveMeasuredBodyFooterOverlapLatchState({
      pageCount: 5,
      targetPageCount: 5,
      overlappingPageIndexes: [1],
      stabilityThreshold: 3,
    });
    expect(firstPass).toEqual({
      signature: "1",
      consecutivePasses: 1,
      shouldLatch: false,
    });

    const secondPass = resolveMeasuredBodyFooterOverlapLatchState({
      pageCount: 5,
      targetPageCount: 5,
      overlappingPageIndexes: [1],
      previousSignature: firstPass.signature,
      previousConsecutivePasses: firstPass.consecutivePasses,
      stabilityThreshold: 3,
    });
    expect(secondPass).toEqual({
      signature: "1",
      consecutivePasses: 2,
      shouldLatch: false,
    });

    const thirdPass = resolveMeasuredBodyFooterOverlapLatchState({
      pageCount: 5,
      targetPageCount: 5,
      overlappingPageIndexes: [1],
      previousSignature: secondPass.signature,
      previousConsecutivePasses: secondPass.consecutivePasses,
      stabilityThreshold: 3,
    });
    expect(thirdPass).toEqual({
      signature: "1",
      consecutivePasses: 3,
      shouldLatch: true,
    });
  });

  it("resets the overlap latch candidate when the overlap signature changes or is no longer eligible", () => {
    expect(
      resolveMeasuredBodyFooterOverlapLatchState({
        pageCount: 5,
        targetPageCount: 5,
        overlappingPageIndexes: [2],
        previousSignature: "1",
        previousConsecutivePasses: 2,
        stabilityThreshold: 3,
      })
    ).toEqual({
      signature: "2",
      consecutivePasses: 1,
      shouldLatch: false,
    });

    expect(
      resolveMeasuredBodyFooterOverlapLatchState({
        pageCount: 7,
        targetPageCount: 5,
        overlappingPageIndexes: [2],
        previousSignature: "2",
        previousConsecutivePasses: 2,
        stabilityThreshold: 3,
      })
    ).toEqual({
      signature: undefined,
      consecutivePasses: 0,
      shouldLatch: false,
    });
  });
});
