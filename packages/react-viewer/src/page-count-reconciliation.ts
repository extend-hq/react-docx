export interface PageCountCandidate<TPage> {
  pageCount: number;
  pages: TPage[];
  scale: number;
}

export interface PageCountReconciliationOptions<TPage> {
  initialPages: TPage[];
  targetPageCount: number;
  buildPagesAtScale: (heightScale: number) => TPage[];
  maxDifference?: number;
  scales?: number[];
}

const PAGE_COUNT_RECONCILIATION_REFINEMENT_STEPS = 10;

export function shouldAllowStoredPageCountReduction(options: {
  estimatedPageCount: number;
  targetPageCount: number;
  hasLastRenderedPageBreakHints?: boolean;
  renderedBreakHintPageCount?: number;
  hasMeasuredBodyFooterOverlap?: boolean;
}): boolean {
  const estimatedPageCount = Math.max(
    1,
    Math.round(options.estimatedPageCount)
  );
  const targetPageCount = Math.max(1, Math.round(options.targetPageCount));
  if (targetPageCount >= estimatedPageCount) {
    return true;
  }

  const renderedBreakHintPageCount = Number.isFinite(
    options.renderedBreakHintPageCount
  )
    ? Math.max(1, Math.round(options.renderedBreakHintPageCount as number))
    : undefined;
  const renderedBreakHintsSupportTarget =
    options.hasLastRenderedPageBreakHints === true &&
    renderedBreakHintPageCount !== undefined &&
    targetPageCount >= renderedBreakHintPageCount;

  if (options.hasMeasuredBodyFooterOverlap === true) {
    // Word's own rendered break markers outrank a measured body/footer
    // overlap. Dense documents can legitimately overflow our estimated footer
    // reserve on every page; abandoning the hint-aligned page count for the
    // (over-)estimated one trades a correct page count for a wrong one.
    return renderedBreakHintsSupportTarget;
  }

  if (options.hasLastRenderedPageBreakHints !== true) {
    return true;
  }

  return renderedBreakHintsSupportTarget;
}

export function shouldLatchMeasuredBodyFooterOverlap(options: {
  pageCount: number;
  targetPageCount?: number;
  measuredBodyFooterOverlap: boolean;
}): boolean {
  if (options.measuredBodyFooterOverlap !== true) {
    return false;
  }

  const targetPageCount = Number.isFinite(options.targetPageCount)
    ? Math.max(1, Math.round(options.targetPageCount as number))
    : undefined;
  if (targetPageCount === undefined) {
    return false;
  }

  const pageCount = Math.max(1, Math.round(options.pageCount));
  return pageCount <= targetPageCount;
}

export function resolveMeasuredBodyFooterOverlapLatchState(options: {
  pageCount: number;
  targetPageCount?: number;
  overlappingPageIndexes: number[];
  previousSignature?: string;
  previousConsecutivePasses?: number;
  stabilityThreshold?: number;
}): {
  signature?: string;
  consecutivePasses: number;
  shouldLatch: boolean;
} {
  const shouldConsiderMeasuredBodyFooterOverlap =
    shouldLatchMeasuredBodyFooterOverlap({
      pageCount: options.pageCount,
      targetPageCount: options.targetPageCount,
      measuredBodyFooterOverlap: options.overlappingPageIndexes.length > 0,
    });
  if (!shouldConsiderMeasuredBodyFooterOverlap) {
    return {
      signature: undefined,
      consecutivePasses: 0,
      shouldLatch: false,
    };
  }

  const signature = options.overlappingPageIndexes
    .map((pageIndex) => `${pageIndex}`)
    .join("|");
  const consecutivePasses =
    signature === options.previousSignature
      ? Math.max(0, Math.round(options.previousConsecutivePasses ?? 0)) + 1
      : 1;
  const stabilityThreshold = Math.max(
    1,
    Math.round(options.stabilityThreshold ?? 1)
  );
  return {
    signature,
    consecutivePasses,
    shouldLatch: consecutivePasses >= stabilityThreshold,
  };
}

export function createEstimatedPagesBuildMemo<TPages>(
  build: (
    measuredTableRowHeightsByNodeIndex: Record<number, number[]> | undefined,
    measuredPageContentHeightsPxByPageIndex: number[] | undefined,
    strictLastRenderedParagraphStartBreaks: boolean
  ) => TPages
): (
  measuredTableRowHeightsByNodeIndex: Record<number, number[]> | undefined,
  measuredPageContentHeightsPxByPageIndex: number[] | undefined,
  strictLastRenderedParagraphStartBreaks: boolean
) => TPages {
  const entries: Array<{
    measuredTableRowHeightsByNodeIndex: Record<number, number[]> | undefined;
    measuredPageContentHeightsPxByPageIndex: number[] | undefined;
    strictLastRenderedParagraphStartBreaks: boolean;
    pages: TPages;
  }> = [];
  return (
    measuredTableRowHeightsByNodeIndex,
    measuredPageContentHeightsPxByPageIndex,
    strictLastRenderedParagraphStartBreaks
  ) => {
    const cached = entries.find(
      (entry) =>
        entry.measuredTableRowHeightsByNodeIndex ===
          measuredTableRowHeightsByNodeIndex &&
        entry.measuredPageContentHeightsPxByPageIndex ===
          measuredPageContentHeightsPxByPageIndex &&
        entry.strictLastRenderedParagraphStartBreaks ===
          strictLastRenderedParagraphStartBreaks
    );
    if (cached) {
      return cached.pages;
    }

    const pages = build(
      measuredTableRowHeightsByNodeIndex,
      measuredPageContentHeightsPxByPageIndex,
      strictLastRenderedParagraphStartBreaks
    );
    entries.push({
      measuredTableRowHeightsByNodeIndex,
      measuredPageContentHeightsPxByPageIndex,
      strictLastRenderedParagraphStartBreaks,
      pages,
    });
    return pages;
  };
}

export function resolveMeasuredSplitParagraphPageComparison<TPage>(options: {
  canUndo: boolean;
  canRedo: boolean;
  hasMeasuredPageContentHeights: boolean;
  measuredEstimatedPages: TPage[];
  buildPureEstimatedPages: () => TPage[];
  pageContainsOnlySplitParagraphSegments: (page: TPage) => boolean;
}): { pages: TPage[]; usedPureEstimatedPages: boolean } {
  // The measured-vs-pure degenerate check unwinds import-calibrated page
  // heights that compress every page into split-paragraph slivers. That is a
  // pristine-import concern, so edited documents keep the single measured
  // pass instead of paying a second full pagination per keystroke.
  if (
    options.canUndo ||
    options.canRedo ||
    !options.hasMeasuredPageContentHeights
  ) {
    return {
      pages: options.measuredEstimatedPages,
      usedPureEstimatedPages: false,
    };
  }

  const measuredPagesAreOnlySplitParagraphs =
    options.measuredEstimatedPages.length > 0 &&
    options.measuredEstimatedPages.every(
      options.pageContainsOnlySplitParagraphSegments
    );
  if (!measuredPagesAreOnlySplitParagraphs) {
    return {
      pages: options.measuredEstimatedPages,
      usedPureEstimatedPages: false,
    };
  }

  const pureEstimatedPages = options.buildPureEstimatedPages();
  const purePagesAreOnlySplitParagraphs =
    pureEstimatedPages.length > 0 &&
    pureEstimatedPages.every(options.pageContainsOnlySplitParagraphSegments);
  if (
    purePagesAreOnlySplitParagraphs &&
    pureEstimatedPages.length < options.measuredEstimatedPages.length
  ) {
    return { pages: pureEstimatedPages, usedPureEstimatedPages: true };
  }

  return {
    pages: options.measuredEstimatedPages,
    usedPureEstimatedPages: false,
  };
}

function isBetterCandidate<TPage>(
  candidate: PageCountCandidate<TPage>,
  incumbent: PageCountCandidate<TPage>,
  targetPageCount: number
): boolean {
  const candidateDifference = Math.abs(candidate.pageCount - targetPageCount);
  const incumbentDifference = Math.abs(incumbent.pageCount - targetPageCount);
  if (candidateDifference !== incumbentDifference) {
    return candidateDifference < incumbentDifference;
  }

  const candidateScaleDelta = Math.abs(candidate.scale - 1);
  const incumbentScaleDelta = Math.abs(incumbent.scale - 1);
  if (candidateScaleDelta !== incumbentScaleDelta) {
    return candidateScaleDelta < incumbentScaleDelta;
  }

  return (
    candidate.pageCount === targetPageCount &&
    incumbent.pageCount !== targetPageCount
  );
}

export function reconcilePagesToTargetCountByScalingHeight<TPage>(
  options: PageCountReconciliationOptions<TPage>
): TPage[] {
  return reconcilePageCountCandidateToTargetCountByScalingHeight(options).pages;
}

export function reconcilePageCountCandidateToTargetCountByScalingHeight<TPage>(
  options: PageCountReconciliationOptions<TPage>
): PageCountCandidate<TPage> {
  const {
    initialPages,
    targetPageCount,
    buildPagesAtScale,
    maxDifference = 3,
    scales: customScales,
  } = options;
  const safeTargetPageCount = Math.max(1, Math.round(targetPageCount));
  const initialPageCount = initialPages.length;
  const initialDifference = Math.abs(initialPageCount - safeTargetPageCount);
  if (initialDifference === 0 || initialDifference > maxDifference) {
    return {
      pageCount: initialPageCount,
      pages: initialPages,
      scale: 1,
    };
  }

  const bestCandidate: PageCountCandidate<TPage> = {
    pageCount: initialPageCount,
    pages: initialPages,
    scale: 1,
  };
  let selectedCandidate = bestCandidate;
  const needMorePages = initialPageCount < safeTargetPageCount;
  const scales =
    customScales && customScales.length > 0
      ? customScales
      : needMorePages
      ? [
          0.98, 0.96, 0.94, 0.92, 0.9, 0.88, 0.86, 0.84, 0.82, 0.8, 0.78, 0.76,
          0.74, 0.72, 0.7, 0.68, 0.66, 0.64, 0.62, 0.6, 0.58, 0.56, 0.54, 0.52,
          0.5, 0.48, 0.46, 0.44, 0.42, 0.4, 0.38, 0.36, 0.34, 0.32, 0.3, 0.28,
          0.26, 0.24, 0.22, 0.2,
        ]
        : [
          1.02, 1.04, 1.06, 1.08, 1.1, 1.12, 1.14, 1.16, 1.18, 1.2, 1.22, 1.24,
          1.26, 1.28, 1.3,
        ];
  const buildCandidateAtScale = (scale: number): PageCountCandidate<TPage> => {
    const pages = buildPagesAtScale(scale);
    return {
      pageCount: pages.length,
      pages,
      scale,
    };
  };

  const refineExactTargetCandidate = (
    lowerScale: number,
    upperScale: number
  ): PageCountCandidate<TPage> => {
    let bestExactCandidate: PageCountCandidate<TPage> | undefined;
    const interval = upperScale - lowerScale;
    if (!Number.isFinite(interval) || Math.abs(interval) < 0.0001) {
      return selectedCandidate;
    }

    for (
      let step = 1;
      step <= PAGE_COUNT_RECONCILIATION_REFINEMENT_STEPS;
      step += 1
    ) {
      const scale =
        lowerScale +
        (interval * step) / PAGE_COUNT_RECONCILIATION_REFINEMENT_STEPS;
      const candidate = buildCandidateAtScale(scale);
      if (isBetterCandidate(candidate, selectedCandidate, safeTargetPageCount)) {
        selectedCandidate = candidate;
      }
      if (
        candidate.pageCount === safeTargetPageCount &&
        (bestExactCandidate === undefined ||
          isBetterCandidate(
            candidate,
            bestExactCandidate,
            safeTargetPageCount
          ))
      ) {
        bestExactCandidate = candidate;
      }
    }

    return bestExactCandidate ?? selectedCandidate;
  };

  let previousScale = 1;
  let previousPageCount = initialPageCount;

  for (const scale of scales) {
    const candidate = buildCandidateAtScale(scale);
    if (isBetterCandidate(candidate, selectedCandidate, safeTargetPageCount)) {
      selectedCandidate = candidate;
    }
    if (candidate.pageCount === safeTargetPageCount) {
      const crossedIntoExactTarget =
        needMorePages
          ? previousPageCount < safeTargetPageCount
          : previousPageCount > safeTargetPageCount;
      if (crossedIntoExactTarget) {
        return refineExactTargetCandidate(previousScale, scale);
      }
      return candidate;
    }
    previousScale = scale;
    previousPageCount = candidate.pageCount;
  }

  if (!needMorePages && selectedCandidate.pageCount !== safeTargetPageCount) {
    // A compressed pagination that still misses the stored count keeps the
    // wrong page count AND over-fills every page: its segments were budgeted
    // against a taller virtual page than the physical one they render in, so
    // the tail of each page gets clipped (stale generator page counts, e.g. a
    // never-repaginated <Pages>1</Pages>, would otherwise squeeze multi-page
    // documents). Best-effort only helps in the page-growing direction, where
    // pages under-fill harmlessly.
    return {
      pageCount: initialPageCount,
      pages: initialPages,
      scale: 1,
    };
  }

  return selectedCandidate;
}
