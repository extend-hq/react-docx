import { describe, expect, it } from "vitest";
import { reconcilePagesToTargetCountByScalingHeight } from "../../packages/react-viewer/src/page-count-reconciliation";

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
      }
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
      }
    });

    expect(reconciled).toHaveLength(1);
  });

  it("keeps the original pagination when the stored page count is too far away", () => {
    const initialPages = [["page-1"], ["page-2"], ["page-3"], ["page-4"]];
    const reconciled = reconcilePagesToTargetCountByScalingHeight({
      initialPages,
      targetPageCount: 10,
      buildPagesAtScale: () => [["other-page"]]
    });

    expect(reconciled).toBe(initialPages);
  });
});
