import type {
  DocModel,
  NumberingDefinitionSet,
  ParagraphNode,
  TableNode
} from "@extend-ai/react-docx-doc-model";
import {
  collectDocxHardPageBreakStartNodeIndexes,
  collectTableExplicitPageBreakInfo,
  paragraphAfterSpacingPx,
  paragraphBeforeSpacingPx,
  paragraphStartsWithLastRenderedPageBreak,
  paragraphHasPageBreakBefore,
  resolvePaginationSectionMetricsIndexForNodeIndex,
  resolveParagraphBeforeSpacingPx,
  type PaginationSectionMetrics
} from "./pagination";

export const DEFAULT_PAGE_OVERFLOW_TOLERANCE_PX = 2;
export const DEFAULT_MIN_PARAGRAPH_LINE_HEIGHT_PX = 14;
const PARAGRAPH_SEGMENT_TOP_BLEED_PX = 22;
const PARAGRAPH_SEGMENT_DESCENDER_BLEED_PX = 6;
const PARAGRAPH_SEGMENT_VISUAL_SAFETY_PX = 24;

export interface TableRowRange {
  startRowIndex: number;
  endRowIndex: number;
}

export interface ParagraphLineRange {
  startLineIndex: number;
  endLineIndex: number;
  totalLineCount: number;
  lineHeightPx: number;
}

export interface DocumentPageNodeSegment {
  nodeIndex: number;
  tableRowRange?: TableRowRange;
  paragraphLineRange?: ParagraphLineRange;
}

export interface LetterheadColumnSegmentGroup {
  startOffset: number;
  endOffset: number;
  leftSegments: DocumentPageNodeSegment[];
  rightSegments: DocumentPageNodeSegment[];
}

export interface ParagraphSplitControlOptions {
  allowKeepLinesOverflow?: boolean;
  allowKeepNextOverflow?: boolean;
}

export interface PageSegmentationCallbacks {
  estimateDocNodeHeightPx: (
    node: DocModel["nodes"][number],
    availableWidthPx?: number,
    numberingDefinitions?: NumberingDefinitionSet,
    docGridLinePitchPx?: number
  ) => number;
  paragraphHasVisibleText: (paragraph: ParagraphNode) => boolean;
  paragraphIsStructuralSectionBreakSpacer: (paragraph: ParagraphNode) => boolean;
  estimateParagraphHeightPx: (
    paragraph: ParagraphNode,
    availableWidthPx?: number,
    numberingDefinitions?: NumberingDefinitionSet,
    docGridLinePitchPx?: number
  ) => number;
  estimateParagraphLineHeightPx: (
    paragraph: ParagraphNode,
    docGridLinePitchPx?: number
  ) => number;
  paragraphLineCountWithinWidth: (
    paragraph: ParagraphNode,
    availableWidthPx?: number,
    numberingDefinitions?: NumberingDefinitionSet
  ) => number;
  paragraphWidowControlEnabled: (paragraph: ParagraphNode) => boolean;
  paragraphCanSplitAcrossPages: (
    paragraph: ParagraphNode,
    lineCount: number,
    options?: ParagraphSplitControlOptions
  ) => boolean;
  estimateTableRowHeightsPx: (
    table: TableNode,
    maxAvailableWidthPx?: number,
    numberingDefinitions?: NumberingDefinitionSet,
    docGridLinePitchPx?: number
  ) => number[];
}

export interface OverflowBreakCollectionOptions {
  suppressSpacingBeforeAfterPageBreak?: boolean;
  pageOverflowTolerancePx?: number;
}

export interface DocumentPageSegmentationOptions extends OverflowBreakCollectionOptions {
  allowParagraphLineSplitting?: boolean;
  measuredTableRowHeightsByNodeIndex?: Record<number, number[]>;
  measuredPageContentHeightsPxByPageIndex?: number[];
  minParagraphLineHeightPx?: number;
  preferLastRenderedParagraphStartBreaks?: boolean;
}

function paragraphSegmentHasPartialLineRange(paragraphLineRange?: ParagraphLineRange): boolean {
  if (!paragraphLineRange) {
    return false;
  }

  return (
    paragraphLineRange.startLineIndex > 0 ||
    paragraphLineRange.endLineIndex < paragraphLineRange.totalLineCount
  );
}

function resolveParagraphSegmentNonFlowReservePx(
  paragraphLineRange?: ParagraphLineRange
): number {
  if (!paragraphSegmentHasPartialLineRange(paragraphLineRange)) {
    return 0;
  }

  const topPx =
    paragraphLineRange && paragraphLineRange.startLineIndex > 0
      ? Math.max(0, PARAGRAPH_SEGMENT_TOP_BLEED_PX)
      : 0;
  const bottomPx = Math.max(0, PARAGRAPH_SEGMENT_DESCENDER_BLEED_PX);
  const lineHeightSafetyPx = Math.max(
    0,
    Math.ceil((paragraphLineRange?.lineHeightPx ?? 0) * 0.9)
  );
  return (
    topPx +
    bottomPx +
    Math.max(0, PARAGRAPH_SEGMENT_VISUAL_SAFETY_PX, lineHeightSafetyPx)
  );
}

function sumEstimatedTableRowHeightsPx(
  rowHeightsPx: number[],
  startRowIndex: number,
  endRowIndex: number,
  minParagraphLineHeightPx: number
): number {
  let total = 0;
  const clampedStart = Math.max(0, startRowIndex);
  const clampedEnd = Math.max(clampedStart, Math.min(endRowIndex, rowHeightsPx.length));
  for (let rowIndex = clampedStart; rowIndex < clampedEnd; rowIndex += 1) {
    total += Math.max(1, rowHeightsPx[rowIndex] ?? minParagraphLineHeightPx);
  }
  return total;
}

function fitTableRowsWithinHeightPx(
  rowHeightsPx: number[],
  startRowIndex: number,
  availableHeightPx: number,
  forceAtLeastOneRow: boolean,
  minParagraphLineHeightPx: number,
  pageOverflowTolerancePx: number
): number {
  if (startRowIndex >= rowHeightsPx.length) {
    return startRowIndex;
  }

  const safeAvailableHeightPx =
    Number.isFinite(availableHeightPx) && availableHeightPx > 0 ? availableHeightPx : 0;
  let consumedHeightPx = 0;
  let rowCursor = startRowIndex;

  while (rowCursor < rowHeightsPx.length) {
    const rowHeightPx = Math.max(1, rowHeightsPx[rowCursor] ?? minParagraphLineHeightPx);
    if (consumedHeightPx + rowHeightPx > safeAvailableHeightPx + pageOverflowTolerancePx) {
      break;
    }

    consumedHeightPx += rowHeightPx;
    rowCursor += 1;
  }

  if (rowCursor === startRowIndex && forceAtLeastOneRow) {
    return Math.min(rowHeightsPx.length, startRowIndex + 1);
  }

  return rowCursor;
}

function normalizeFallbackMetrics(
  pageContentHeightPx: number,
  pageContentWidthPx: number
): PaginationSectionMetrics {
  return {
    startNodeIndex: 0,
    pageContentWidthPx: Math.max(120, Math.round(pageContentWidthPx)),
    pageContentHeightPx: Math.max(120, Math.round(pageContentHeightPx)),
    docGridLinePitchPx: undefined
  };
}

function normalizedMetricsBySection(
  pageContentHeightPx: number,
  pageContentWidthPx: number,
  paginationMetricsBySection?: PaginationSectionMetrics[]
): {
  fallbackMetrics: PaginationSectionMetrics;
  metricsBySection: PaginationSectionMetrics[];
} {
  const fallbackMetrics = normalizeFallbackMetrics(pageContentHeightPx, pageContentWidthPx);
  return {
    fallbackMetrics,
    metricsBySection: paginationMetricsBySection?.length
      ? paginationMetricsBySection
      : [fallbackMetrics]
  };
}

function normalizedPositivePixelValue(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || (value as number) <= 0) {
    return fallback;
  }

  return Math.max(1, Math.round(value as number));
}

function normalizedMeasuredTableRowHeights(
  measuredRowHeightsPx: number[] | undefined,
  expectedRowCount: number,
  minParagraphLineHeightPx: number
): number[] | undefined {
  if (!measuredRowHeightsPx || measuredRowHeightsPx.length !== expectedRowCount) {
    return undefined;
  }

  return measuredRowHeightsPx.map((heightPx) =>
    Math.max(
      minParagraphLineHeightPx,
      Number.isFinite(heightPx)
        ? Math.round(heightPx as number)
        : minParagraphLineHeightPx
    )
  );
}

function estimateKeepNextTableRequiredHeightPx(
  table: TableNode,
  callbacks: PageSegmentationCallbacks,
  metrics: PaginationSectionMetrics,
  numberingDefinitions: NumberingDefinitionSet | undefined,
  minParagraphLineHeightPx: number,
  pageOverflowTolerancePx: number
): number {
  const rowHeightsPx = callbacks.estimateTableRowHeightsPx(
    table,
    metrics.pageContentWidthPx,
    numberingDefinitions,
    metrics.docGridLinePitchPx
  );
  if (rowHeightsPx.length === 0) {
    return Math.max(
      1,
      normalizedPositivePixelValue(
        callbacks.estimateDocNodeHeightPx(
          table,
          metrics.pageContentWidthPx,
          numberingDefinitions,
          metrics.docGridLinePitchPx
        ),
        minParagraphLineHeightPx
      )
    );
  }

  const normalizedRowHeightsPx = rowHeightsPx.map((rowHeightPx) =>
    Math.max(
      minParagraphLineHeightPx,
      normalizedPositivePixelValue(rowHeightPx, minParagraphLineHeightPx)
    )
  );
  const totalTableHeightPx = normalizedRowHeightsPx.reduce(
    (sum, rowHeightPx) => sum + rowHeightPx,
    0
  );
  if (totalTableHeightPx <= metrics.pageContentHeightPx + pageOverflowTolerancePx) {
    return totalTableHeightPx;
  }

  return Math.max(
    minParagraphLineHeightPx,
    normalizedPositivePixelValue(normalizedRowHeightsPx[0], minParagraphLineHeightPx)
  );
}

export function paragraphLetterheadColumnGroupAtSegmentOffset(
  nodeSegments: DocumentPageNodeSegment[],
  startOffset: number,
  resolveFloatSideAtNodeIndex: (nodeIndex: number) => "left" | "right" | undefined
): LetterheadColumnSegmentGroup | undefined {
  if (startOffset < 0 || startOffset >= nodeSegments.length) {
    return undefined;
  }

  const resolveSideForSegment = (
    segment: DocumentPageNodeSegment | undefined
  ): "left" | "right" | undefined => {
    if (
      !segment ||
      segment.tableRowRange ||
      paragraphSegmentHasPartialLineRange(segment.paragraphLineRange)
    ) {
      return undefined;
    }

    return resolveFloatSideAtNodeIndex(segment.nodeIndex);
  };

  const startSide = resolveSideForSegment(nodeSegments[startOffset]);
  const previousSide =
    startOffset > 0 ? resolveSideForSegment(nodeSegments[startOffset - 1]) : undefined;
  if (!startSide || previousSide) {
    return undefined;
  }

  const leftSegments: DocumentPageNodeSegment[] = [];
  const rightSegments: DocumentPageNodeSegment[] = [];
  let endOffset = startOffset;

  while (endOffset < nodeSegments.length) {
    const segment = nodeSegments[endOffset];
    const side = resolveSideForSegment(segment);
    if (!side) {
      break;
    }

    if (side === "left") {
      leftSegments.push(segment);
    } else {
      rightSegments.push(segment);
    }
    endOffset += 1;
  }

  if (leftSegments.length === 0 || rightSegments.length === 0) {
    return undefined;
  }

  return {
    startOffset,
    endOffset,
    leftSegments,
    rightSegments
  };
}

export function collectDocxEstimatedOverflowBreakStartNodeIndexes(
  model: DocModel,
  hardBreakStartNodeIndexes: Set<number>,
  pageContentHeightPx: number,
  pageContentWidthPx: number,
  callbacks: PageSegmentationCallbacks,
  numberingDefinitions?: NumberingDefinitionSet,
  paginationMetricsBySection?: PaginationSectionMetrics[],
  options?: OverflowBreakCollectionOptions
): Set<number> {
  const breaks = new Set<number>();
  if (!Number.isFinite(pageContentHeightPx) || pageContentHeightPx <= 0) {
    return breaks;
  }

  const pageOverflowTolerancePx =
    options?.pageOverflowTolerancePx ?? DEFAULT_PAGE_OVERFLOW_TOLERANCE_PX;
  const { fallbackMetrics, metricsBySection } = normalizedMetricsBySection(
    pageContentHeightPx,
    pageContentWidthPx,
    paginationMetricsBySection
  );

  let pageConsumedHeightPx = 0;
  let previousParagraphAfterPx = 0;
  let currentMetricsIndex = 0;
  const suppressSpacingBeforeAfterPageBreak =
    options?.suppressSpacingBeforeAfterPageBreak ?? false;
  let currentPageContentHeightPx =
    metricsBySection[0]?.pageContentHeightPx ?? fallbackMetrics.pageContentHeightPx;

  for (let nodeIndex = 0; nodeIndex < model.nodes.length; nodeIndex += 1) {
    currentMetricsIndex = resolvePaginationSectionMetricsIndexForNodeIndex(
      metricsBySection,
      nodeIndex,
      currentMetricsIndex
    );
    const nodeMetrics = metricsBySection[currentMetricsIndex] ?? fallbackMetrics;

    if (hardBreakStartNodeIndexes.has(nodeIndex)) {
      pageConsumedHeightPx = 0;
      previousParagraphAfterPx = 0;
      currentPageContentHeightPx = nodeMetrics.pageContentHeightPx;
    }

    const node = model.nodes[nodeIndex];
    const rawNodeHeightPx = Math.max(
      1,
      normalizedPositivePixelValue(
        callbacks.estimateDocNodeHeightPx(
          node,
          nodeMetrics.pageContentWidthPx,
          numberingDefinitions,
          nodeMetrics.docGridLinePitchPx
        ),
        1
      )
    );
    const nodeBeforeSpacingPx =
      node.type === "paragraph"
        ? resolveParagraphBeforeSpacingPx(
            model,
            nodeIndex,
            node,
            pageConsumedHeightPx,
            suppressSpacingBeforeAfterPageBreak
          )
        : 0;
    const collapsedMarginPx =
      node.type === "paragraph" && pageConsumedHeightPx > 0
        ? Math.min(previousParagraphAfterPx, nodeBeforeSpacingPx)
        : 0;
    const collapsedNodeHeightPx = Math.max(1, rawNodeHeightPx - collapsedMarginPx);

    let requiredHeightPx = collapsedNodeHeightPx;

    if (
      node.type === "paragraph" &&
      node.style?.keepNext === true &&
      callbacks.paragraphHasVisibleText(node)
    ) {
      let chainCursor = nodeIndex;
      let chainPreviousParagraphAfterPx = paragraphAfterSpacingPx(node);
      while (chainCursor < model.nodes.length - 1) {
        const currentChainNode = model.nodes[chainCursor];
        if (
          currentChainNode.type !== "paragraph" ||
          currentChainNode.style?.keepNext !== true ||
          !callbacks.paragraphHasVisibleText(currentChainNode)
        ) {
          break;
        }
        if (hardBreakStartNodeIndexes.has(chainCursor + 1)) {
          break;
        }
        const nextChainNode = model.nodes[chainCursor + 1];
        const chainMetricsIndex = resolvePaginationSectionMetricsIndexForNodeIndex(
          metricsBySection,
          chainCursor + 1,
          currentMetricsIndex
        );
        const chainMetrics = metricsBySection[chainMetricsIndex] ?? fallbackMetrics;
        if (nextChainNode.type === "table") {
          requiredHeightPx += estimateKeepNextTableRequiredHeightPx(
            nextChainNode,
            callbacks,
            chainMetrics,
            numberingDefinitions,
            DEFAULT_MIN_PARAGRAPH_LINE_HEIGHT_PX,
            pageOverflowTolerancePx
          );
          break;
        }
        if (nextChainNode.type !== "paragraph") {
          break;
        }

        chainCursor += 1;
        const nextRawHeightPx = Math.max(
          1,
          normalizedPositivePixelValue(
            callbacks.estimateParagraphHeightPx(
              nextChainNode,
              chainMetrics.pageContentWidthPx,
              numberingDefinitions,
              chainMetrics.docGridLinePitchPx
            ),
            1
          )
        );
        const collapsedChainMarginPx = Math.min(
          chainPreviousParagraphAfterPx,
          paragraphBeforeSpacingPx(nextChainNode)
        );
        requiredHeightPx += Math.max(1, nextRawHeightPx - collapsedChainMarginPx);
        chainPreviousParagraphAfterPx = paragraphAfterSpacingPx(nextChainNode);
      }
    }

    const remainingHeightPx = currentPageContentHeightPx - pageConsumedHeightPx;
    if (
      pageConsumedHeightPx > 0 &&
      requiredHeightPx > remainingHeightPx + pageOverflowTolerancePx
    ) {
      breaks.add(nodeIndex);
      pageConsumedHeightPx = 0;
      previousParagraphAfterPx = 0;
      currentPageContentHeightPx = nodeMetrics.pageContentHeightPx;
    }

    const effectiveNodeHeightPx =
      pageConsumedHeightPx > 0 ? collapsedNodeHeightPx : rawNodeHeightPx;
    pageConsumedHeightPx += effectiveNodeHeightPx;
    previousParagraphAfterPx = node.type === "paragraph" ? paragraphAfterSpacingPx(node) : 0;
  }

  for (const breakIndex of [...breaks]) {
    if (
      breakIndex <= 0 ||
      breakIndex >= model.nodes.length ||
      hardBreakStartNodeIndexes.has(breakIndex)
    ) {
      breaks.delete(breakIndex);
    }
  }

  return breaks;
}

export function buildDocumentPageNodeSegments(
  model: DocModel,
  pageContentHeightPx: number,
  pageContentWidthPx: number,
  callbacks: PageSegmentationCallbacks,
  numberingDefinitions?: NumberingDefinitionSet,
  paginationMetricsBySection?: PaginationSectionMetrics[],
  options?: DocumentPageSegmentationOptions
): DocumentPageNodeSegment[][] {
  if (model.nodes.length === 0) {
    return [];
  }

  const pageOverflowTolerancePx =
    options?.pageOverflowTolerancePx ?? DEFAULT_PAGE_OVERFLOW_TOLERANCE_PX;
  const minParagraphLineHeightPx =
    options?.minParagraphLineHeightPx ?? DEFAULT_MIN_PARAGRAPH_LINE_HEIGHT_PX;
  const { fallbackMetrics, metricsBySection } = normalizedMetricsBySection(
    pageContentHeightPx,
    pageContentWidthPx,
    paginationMetricsBySection
  );

  const pages: DocumentPageNodeSegment[][] = [];
  let currentPageSegments: DocumentPageNodeSegment[] = [];
  const hardBreakStartNodeIndexes = collectDocxHardPageBreakStartNodeIndexes(model);
  const estimatedRowHeightsByTableNodeIndex = new Map<number, number[]>();
  const allowParagraphLineSplitting = options?.allowParagraphLineSplitting ?? true;
  const suppressSpacingBeforeAfterPageBreak =
    options?.suppressSpacingBeforeAfterPageBreak ?? false;
  const preferLastRenderedParagraphStartBreaks =
    options?.preferLastRenderedParagraphStartBreaks ?? false;
  const measuredPageContentHeightsPxByPageIndex =
    options?.measuredPageContentHeightsPxByPageIndex;
  const resolvePageContentHeightPx = (
    pageIndex: number,
    fallbackHeightPx: number
  ): number => {
    const overrideHeightPx = measuredPageContentHeightsPxByPageIndex?.[pageIndex];
    if (Number.isFinite(overrideHeightPx) && (overrideHeightPx as number) > 0) {
      return Math.max(120, Math.round(overrideHeightPx as number));
    }
    return Math.max(120, Math.round(fallbackHeightPx));
  };

  let currentPageIndex = 0;
  const startNextPage = (): void => {
    if (currentPageSegments.length > 0) {
      pages.push(currentPageSegments);
    }
    currentPageSegments = [];
    currentPageIndex += 1;
  };

  if (!Number.isFinite(pageContentHeightPx) || pageContentHeightPx <= 0) {
    return [model.nodes.map((_, nodeIndex) => ({ nodeIndex }))];
  }

  let pageConsumedHeightPx = 0;
  let previousParagraphAfterPx = 0;
  let currentMetricsIndex = 0;
  let currentPageContentHeightPx = resolvePageContentHeightPx(
    0,
    metricsBySection[0]?.pageContentHeightPx ?? fallbackMetrics.pageContentHeightPx
  );

  for (let nodeIndex = 0; nodeIndex < model.nodes.length; nodeIndex += 1) {
    currentMetricsIndex = resolvePaginationSectionMetricsIndexForNodeIndex(
      metricsBySection,
      nodeIndex,
      currentMetricsIndex
    );
    const nodeMetrics = metricsBySection[currentMetricsIndex] ?? fallbackMetrics;

    if (hardBreakStartNodeIndexes.has(nodeIndex) && currentPageSegments.length > 0) {
      startNextPage();
      pageConsumedHeightPx = 0;
      previousParagraphAfterPx = 0;
      currentPageContentHeightPx = resolvePageContentHeightPx(
        currentPageIndex,
        nodeMetrics.pageContentHeightPx
      );
    }

    const node = model.nodes[nodeIndex];
    if (node.type === "paragraph") {
      if (callbacks.paragraphIsStructuralSectionBreakSpacer(node)) {
        previousParagraphAfterPx = 0;
        continue;
      }

      if (paragraphHasPageBreakBefore(node) && currentPageSegments.length > 0) {
        startNextPage();
        pageConsumedHeightPx = 0;
        previousParagraphAfterPx = 0;
        currentPageContentHeightPx = resolvePageContentHeightPx(
          currentPageIndex,
          nodeMetrics.pageContentHeightPx
        );
      }

      if (
        preferLastRenderedParagraphStartBreaks &&
        paragraphStartsWithLastRenderedPageBreak(node) &&
        currentPageSegments.length > 0
      ) {
        startNextPage();
        pageConsumedHeightPx = 0;
        previousParagraphAfterPx = 0;
        currentPageContentHeightPx = resolvePageContentHeightPx(
          currentPageIndex,
          nodeMetrics.pageContentHeightPx
        );
      }

      const rawNodeHeightPx = Math.max(
        1,
        normalizedPositivePixelValue(
          callbacks.estimateParagraphHeightPx(
            node,
            nodeMetrics.pageContentWidthPx,
            numberingDefinitions,
            nodeMetrics.docGridLinePitchPx
          ),
          1
        )
      );
      const paragraphTooTallForSinglePage =
        rawNodeHeightPx > nodeMetrics.pageContentHeightPx + pageOverflowTolerancePx;
      const keepLinesOverflowSplit =
        node.style?.keepLines === true && paragraphTooTallForSinglePage;
      const keepNextOverflowSplit =
        node.style?.keepNext === true && paragraphTooTallForSinglePage;
      const forceOverflowSplit = keepLinesOverflowSplit || keepNextOverflowSplit;
      if (forceOverflowSplit && pageConsumedHeightPx > 0 && currentPageSegments.length > 0) {
        startNextPage();
        pageConsumedHeightPx = 0;
        previousParagraphAfterPx = 0;
        currentPageContentHeightPx = resolvePageContentHeightPx(
          currentPageIndex,
          nodeMetrics.pageContentHeightPx
        );
      }

      const beforeSpacingPx = resolveParagraphBeforeSpacingPx(
        model,
        nodeIndex,
        node,
        pageConsumedHeightPx,
        suppressSpacingBeforeAfterPageBreak
      );
      const afterSpacingPx = paragraphAfterSpacingPx(node);
      const collapsedMarginPx =
        pageConsumedHeightPx > 0 ? Math.min(previousParagraphAfterPx, beforeSpacingPx) : 0;
      const collapsedNodeHeightPx = Math.max(1, rawNodeHeightPx - collapsedMarginPx);
      const paragraphLineHeightPx = Math.max(
        1,
        normalizedPositivePixelValue(
          callbacks.estimateParagraphLineHeightPx(node, nodeMetrics.docGridLinePitchPx),
          1
        )
      );
      const paragraphLineCount = Math.max(
        1,
        normalizedPositivePixelValue(
          callbacks.paragraphLineCountWithinWidth(
            node,
            nodeMetrics.pageContentWidthPx,
            numberingDefinitions
          ),
          1
        )
      );
      const widowControlEnabled = callbacks.paragraphWidowControlEnabled(node);
      const minLinesPerSegment = widowControlEnabled ? 2 : 1;
      const canSplitParagraphAcrossPages =
        callbacks.paragraphCanSplitAcrossPages(node, paragraphLineCount, {
          allowKeepLinesOverflow: keepLinesOverflowSplit,
          allowKeepNextOverflow: keepNextOverflowSplit
        }) &&
        (!widowControlEnabled || paragraphLineCount > 3);

      if (canSplitParagraphAcrossPages && allowParagraphLineSplitting) {
        let lineCursor = 0;
        let isFirstSegment = true;
        while (lineCursor < paragraphLineCount) {
          const linesRemaining = paragraphLineCount - lineCursor;
          const topSpacingPx = isFirstSegment
            ? pageConsumedHeightPx > 0
              ? Math.max(0, beforeSpacingPx - collapsedMarginPx)
              : beforeSpacingPx
            : 0;
          const mustKeepBottomSpacing = linesRemaining <= minLinesPerSegment;
          const bottomSpacingPx = mustKeepBottomSpacing ? afterSpacingPx : 0;
          const remainingHeightPx = Math.max(0, currentPageContentHeightPx - pageConsumedHeightPx);
          const allRemainingSegmentReservePx = resolveParagraphSegmentNonFlowReservePx({
            startLineIndex: lineCursor,
            endLineIndex: paragraphLineCount,
            totalLineCount: paragraphLineCount,
            lineHeightPx: paragraphLineHeightPx
          });
          const allRemainingHeightPx =
            topSpacingPx + linesRemaining * paragraphLineHeightPx + bottomSpacingPx;

          if (allRemainingHeightPx + allRemainingSegmentReservePx <= remainingHeightPx) {
            currentPageSegments.push({
              nodeIndex,
              paragraphLineRange: {
                startLineIndex: lineCursor,
                endLineIndex: paragraphLineCount,
                totalLineCount: paragraphLineCount,
                lineHeightPx: paragraphLineHeightPx
              }
            });
            pageConsumedHeightPx += allRemainingHeightPx;
            previousParagraphAfterPx = afterSpacingPx;
            lineCursor = paragraphLineCount;
            break;
          }

          const maxLinesThisPage = Math.max(0, linesRemaining - minLinesPerSegment);
          const continuingSegmentReservePx = resolveParagraphSegmentNonFlowReservePx({
            startLineIndex: lineCursor,
            endLineIndex: Math.min(paragraphLineCount, lineCursor + maxLinesThisPage),
            totalLineCount: paragraphLineCount,
            lineHeightPx: paragraphLineHeightPx
          });
          const availableForLinesPx = Math.max(
            0,
            remainingHeightPx - topSpacingPx - continuingSegmentReservePx
          );
          let linesThatFit = Math.floor(availableForLinesPx / paragraphLineHeightPx);
          linesThatFit = Math.min(linesThatFit, maxLinesThisPage);

          if (linesThatFit < minLinesPerSegment) {
            if (currentPageSegments.length > 0) {
              startNextPage();
              pageConsumedHeightPx = 0;
              previousParagraphAfterPx = 0;
              currentPageContentHeightPx = resolvePageContentHeightPx(
                currentPageIndex,
                nodeMetrics.pageContentHeightPx
              );
              continue;
            }

            const fallbackLines = Math.max(
              1,
              Math.floor(Math.max(1, availableForLinesPx) / paragraphLineHeightPx)
            );
            linesThatFit = Math.max(
              1,
              Math.min(
                maxLinesThisPage > 0 ? maxLinesThisPage : linesRemaining,
                fallbackLines
              )
            );
          }

          let segmentEndLineIndex = Math.min(paragraphLineCount, lineCursor + linesThatFit);
          while (linesThatFit > minLinesPerSegment) {
            const segmentReservePx = resolveParagraphSegmentNonFlowReservePx({
              startLineIndex: lineCursor,
              endLineIndex: segmentEndLineIndex,
              totalLineCount: paragraphLineCount,
              lineHeightPx: paragraphLineHeightPx
            });
            if (
              topSpacingPx +
                (segmentEndLineIndex - lineCursor) * paragraphLineHeightPx +
                segmentReservePx <=
              remainingHeightPx
            ) {
              break;
            }
            linesThatFit -= 1;
            segmentEndLineIndex = Math.min(paragraphLineCount, lineCursor + linesThatFit);
          }
          currentPageSegments.push({
            nodeIndex,
            paragraphLineRange: {
              startLineIndex: lineCursor,
              endLineIndex: segmentEndLineIndex,
              totalLineCount: paragraphLineCount,
              lineHeightPx: paragraphLineHeightPx
            }
          });

          pageConsumedHeightPx +=
            topSpacingPx + (segmentEndLineIndex - lineCursor) * paragraphLineHeightPx;
          previousParagraphAfterPx = 0;
          lineCursor = segmentEndLineIndex;
          isFirstSegment = false;

          if (lineCursor < paragraphLineCount) {
            startNextPage();
            pageConsumedHeightPx = 0;
            previousParagraphAfterPx = 0;
            currentPageContentHeightPx = resolvePageContentHeightPx(
              currentPageIndex,
              nodeMetrics.pageContentHeightPx
            );
          }
        }
        continue;
      }

      let requiredHeightPx = collapsedNodeHeightPx;
      if (node.style?.keepNext === true && callbacks.paragraphHasVisibleText(node)) {
        let chainCursor = nodeIndex;
        let chainPreviousParagraphAfterPx = afterSpacingPx;
        while (chainCursor < model.nodes.length - 1) {
          const currentChainNode = model.nodes[chainCursor];
          if (
            currentChainNode.type !== "paragraph" ||
            currentChainNode.style?.keepNext !== true ||
            !callbacks.paragraphHasVisibleText(currentChainNode)
          ) {
            break;
          }
          if (hardBreakStartNodeIndexes.has(chainCursor + 1)) {
            break;
          }
          const nextChainNode = model.nodes[chainCursor + 1];
          const chainMetricsIndex = resolvePaginationSectionMetricsIndexForNodeIndex(
            metricsBySection,
            chainCursor + 1,
            currentMetricsIndex
          );
          const chainMetrics = metricsBySection[chainMetricsIndex] ?? fallbackMetrics;
          if (nextChainNode.type === "table") {
            requiredHeightPx += estimateKeepNextTableRequiredHeightPx(
              nextChainNode,
              callbacks,
              chainMetrics,
              numberingDefinitions,
              minParagraphLineHeightPx,
              pageOverflowTolerancePx
            );
            break;
          }
          if (nextChainNode.type !== "paragraph") {
            break;
          }

          chainCursor += 1;
          const nextRawHeightPx = Math.max(
            1,
            normalizedPositivePixelValue(
              callbacks.estimateParagraphHeightPx(
                nextChainNode,
                chainMetrics.pageContentWidthPx,
                numberingDefinitions,
                chainMetrics.docGridLinePitchPx
              ),
              1
            )
          );
          const collapsedChainMarginPx = Math.min(
            chainPreviousParagraphAfterPx,
            paragraphBeforeSpacingPx(nextChainNode)
          );
          requiredHeightPx += Math.max(1, nextRawHeightPx - collapsedChainMarginPx);
          chainPreviousParagraphAfterPx = paragraphAfterSpacingPx(nextChainNode);
        }
      }

      const remainingHeightPx = currentPageContentHeightPx - pageConsumedHeightPx;
      if (
        pageConsumedHeightPx > 0 &&
        requiredHeightPx > remainingHeightPx + pageOverflowTolerancePx
      ) {
        startNextPage();
        pageConsumedHeightPx = 0;
        previousParagraphAfterPx = 0;
        currentPageContentHeightPx = resolvePageContentHeightPx(
          currentPageIndex,
          nodeMetrics.pageContentHeightPx
        );
      }

      currentPageSegments.push({ nodeIndex });
      const effectiveNodeHeightPx =
        pageConsumedHeightPx > 0 ? collapsedNodeHeightPx : rawNodeHeightPx;
      pageConsumedHeightPx += effectiveNodeHeightPx;
      previousParagraphAfterPx = afterSpacingPx;
      continue;
    }

    const measuredRowHeightsPx = normalizedMeasuredTableRowHeights(
      options?.measuredTableRowHeightsByNodeIndex?.[nodeIndex],
      node.rows.length,
      minParagraphLineHeightPx
    );
    const estimatedRowHeightsPx =
      measuredRowHeightsPx ??
      estimatedRowHeightsByTableNodeIndex.get(nodeIndex) ??
      callbacks.estimateTableRowHeightsPx(
        node,
        nodeMetrics.pageContentWidthPx,
        numberingDefinitions,
        nodeMetrics.docGridLinePitchPx
      );
    if (!measuredRowHeightsPx && !estimatedRowHeightsByTableNodeIndex.has(nodeIndex)) {
      estimatedRowHeightsByTableNodeIndex.set(nodeIndex, estimatedRowHeightsPx);
    }

    if (estimatedRowHeightsPx.length === 0) {
      currentPageSegments.push({ nodeIndex });
      previousParagraphAfterPx = 0;
      continue;
    }

    const tableExplicitPageBreakInfo = collectTableExplicitPageBreakInfo(node);
    const tableBreakStartRows = tableExplicitPageBreakInfo.startRowIndexes;
    if (tableBreakStartRows.includes(0) && currentPageSegments.length > 0) {
      startNextPage();
      pageConsumedHeightPx = 0;
      previousParagraphAfterPx = 0;
      currentPageContentHeightPx = resolvePageContentHeightPx(
        currentPageIndex,
        nodeMetrics.pageContentHeightPx
      );
    }

    let rowStartIndex = 0;
    while (rowStartIndex < estimatedRowHeightsPx.length) {
      const remainingHeightPx = Math.max(0, currentPageContentHeightPx - pageConsumedHeightPx);
      const fittedRowEndIndex = fitTableRowsWithinHeightPx(
        estimatedRowHeightsPx,
        rowStartIndex,
        remainingHeightPx,
        pageConsumedHeightPx <= 0,
        minParagraphLineHeightPx,
        pageOverflowTolerancePx
      );
      let rowEndIndex = fittedRowEndIndex;
      const forcedBreakRowIndex = tableBreakStartRows.find(
        (breakRowIndex) => breakRowIndex > rowStartIndex
      );
      if (forcedBreakRowIndex !== undefined) {
        rowEndIndex = Math.min(rowEndIndex, forcedBreakRowIndex);
      }

      const remainingRowsAfterSegment = estimatedRowHeightsPx.length - rowEndIndex;
      const segmentRowCount = rowEndIndex - rowStartIndex;
      if (
        forcedBreakRowIndex === undefined &&
        remainingRowsAfterSegment === 1 &&
        segmentRowCount > 1
      ) {
        rowEndIndex = fittedRowEndIndex - 1;
      }

      if (rowEndIndex <= rowStartIndex) {
        if (currentPageSegments.length > 0) {
          startNextPage();
          pageConsumedHeightPx = 0;
          previousParagraphAfterPx = 0;
          currentPageContentHeightPx = resolvePageContentHeightPx(
            currentPageIndex,
            nodeMetrics.pageContentHeightPx
          );
          continue;
        }

        const forcedEndIndex = Math.min(estimatedRowHeightsPx.length, rowStartIndex + 1);
        const forcedHeightPx = sumEstimatedTableRowHeightsPx(
          estimatedRowHeightsPx,
          rowStartIndex,
          forcedEndIndex,
          minParagraphLineHeightPx
        );
        currentPageSegments.push({
          nodeIndex,
          tableRowRange: {
            startRowIndex: rowStartIndex,
            endRowIndex: forcedEndIndex
          }
        });
        pageConsumedHeightPx += forcedHeightPx;
        previousParagraphAfterPx = 0;
        rowStartIndex = forcedEndIndex;

        if (rowStartIndex < estimatedRowHeightsPx.length) {
          startNextPage();
          pageConsumedHeightPx = 0;
          previousParagraphAfterPx = 0;
          currentPageContentHeightPx = resolvePageContentHeightPx(
            currentPageIndex,
            nodeMetrics.pageContentHeightPx
          );
        }
        continue;
      }

      const segmentHeightPx = sumEstimatedTableRowHeightsPx(
        estimatedRowHeightsPx,
        rowStartIndex,
        rowEndIndex,
        minParagraphLineHeightPx
      );
      const coversWholeTable =
        rowStartIndex === 0 && rowEndIndex >= estimatedRowHeightsPx.length;
      currentPageSegments.push({
        nodeIndex,
        tableRowRange: coversWholeTable
          ? undefined
          : {
              startRowIndex: rowStartIndex,
              endRowIndex: rowEndIndex
            }
      });
      pageConsumedHeightPx += segmentHeightPx;
      previousParagraphAfterPx = 0;
      rowStartIndex = rowEndIndex;

      if (rowStartIndex < estimatedRowHeightsPx.length) {
        startNextPage();
        pageConsumedHeightPx = 0;
        previousParagraphAfterPx = 0;
        currentPageContentHeightPx = resolvePageContentHeightPx(
          currentPageIndex,
          nodeMetrics.pageContentHeightPx
        );
      }
    }
  }

  if (currentPageSegments.length > 0 || pages.length === 0) {
    pages.push(currentPageSegments);
  }

  return pages;
}

export function resolveDocumentPageSegmentStartNodeIndex(
  pageSegments: DocumentPageNodeSegment[]
): number | undefined {
  const firstSegment = pageSegments.find((segment) => Number.isFinite(segment.nodeIndex));
  return Number.isFinite(firstSegment?.nodeIndex) ? firstSegment?.nodeIndex : undefined;
}

export function scorePaginationAgainstStoredPageBreaks(
  pages: DocumentPageNodeSegment[][],
  storedBreakStartNodeIndexes: number[]
): number {
  const comparableBreakCount = Math.min(
    storedBreakStartNodeIndexes.length,
    Math.max(0, pages.length - 1)
  );
  if (comparableBreakCount <= 0) {
    return 0;
  }

  let score = 0;
  for (let breakIndex = 0; breakIndex < comparableBreakCount; breakIndex += 1) {
    const expectedStartNodeIndex = storedBreakStartNodeIndexes[breakIndex];
    const actualStartNodeIndex = resolveDocumentPageSegmentStartNodeIndex(
      pages[breakIndex + 1] ?? []
    );
    if (!Number.isFinite(actualStartNodeIndex)) {
      score -= 1000;
      continue;
    }

    const delta = Math.abs((actualStartNodeIndex as number) - expectedStartNodeIndex);
    score -= delta * 100;
    if (delta === 0) {
      score += 25;
    }
  }

  return score;
}
