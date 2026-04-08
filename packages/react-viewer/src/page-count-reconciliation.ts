interface PageCountCandidate<TPage> {
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

export function shouldAllowStoredPageCountReduction(options: {
  estimatedPageCount: number;
  targetPageCount: number;
  hasLastRenderedPageBreakHints?: boolean;
  renderedBreakHintPageCount?: number;
}): boolean {
  const estimatedPageCount = Math.max(1, Math.round(options.estimatedPageCount));
  const targetPageCount = Math.max(1, Math.round(options.targetPageCount));
  if (targetPageCount >= estimatedPageCount) {
    return true;
  }

  if (options.hasLastRenderedPageBreakHints !== true) {
    return true;
  }

  const renderedBreakHintPageCount = Number.isFinite(options.renderedBreakHintPageCount)
    ? Math.max(1, Math.round(options.renderedBreakHintPageCount as number))
    : undefined;
  return (
    renderedBreakHintPageCount !== undefined &&
    targetPageCount >= renderedBreakHintPageCount
  );
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

  return candidate.pageCount === targetPageCount && incumbent.pageCount !== targetPageCount;
}

export function reconcilePagesToTargetCountByScalingHeight<TPage>(
  options: PageCountReconciliationOptions<TPage>
): TPage[] {
  const {
    initialPages,
    targetPageCount,
    buildPagesAtScale,
    maxDifference = 3,
    scales: customScales
  } = options;
  const safeTargetPageCount = Math.max(1, Math.round(targetPageCount));
  const initialPageCount = initialPages.length;
  const initialDifference = Math.abs(initialPageCount - safeTargetPageCount);
  if (initialDifference === 0 || initialDifference > maxDifference) {
    return initialPages;
  }

  const bestCandidate: PageCountCandidate<TPage> = {
    pageCount: initialPageCount,
    pages: initialPages,
    scale: 1
  };
  let selectedCandidate = bestCandidate;
  const needMorePages = initialPageCount < safeTargetPageCount;
  const scales =
    customScales && customScales.length > 0
      ? customScales
      : needMorePages
    ? [
        0.98, 0.96, 0.94, 0.92, 0.9, 0.88, 0.86, 0.84, 0.82, 0.8,
        0.78, 0.76, 0.74, 0.72, 0.7, 0.68, 0.66, 0.64, 0.62, 0.6,
        0.58, 0.56, 0.54, 0.52, 0.5, 0.48, 0.46, 0.44, 0.42, 0.4,
        0.38, 0.36, 0.34, 0.32, 0.3, 0.28, 0.26, 0.24, 0.22, 0.2
      ]
    : [1.02, 1.04, 1.06, 1.08, 1.1, 1.12, 1.14, 1.16, 1.18, 1.2, 1.22, 1.24, 1.26, 1.28, 1.3];

  for (const scale of scales) {
    const pages = buildPagesAtScale(scale);
    const candidate: PageCountCandidate<TPage> = {
      pageCount: pages.length,
      pages,
      scale
    };
    if (isBetterCandidate(candidate, selectedCandidate, safeTargetPageCount)) {
      selectedCandidate = candidate;
    }
    if (candidate.pageCount === safeTargetPageCount) {
      return candidate.pages;
    }
  }

  return selectedCandidate.pages;
}
