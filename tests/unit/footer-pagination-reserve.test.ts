import { describe, expect, it } from "vitest";
import type { FooterSection } from "@extend-ai/react-docx-doc-model";
import {
  resolveFooterPaginationReservePx,
  resolveMeasuredBodyRenderedBottomPx,
  resolveMeasuredPageContentHeightPx,
  resolvePageContentHeightPxForPageSegments,
  resolveRenderPageContentHeightPxForPageSegments,
  stabilizeMeasuredPageContentHeights
} from "../../packages/react-viewer/src/editor";

function footerParagraph(text: string) {
  return {
    type: "paragraph" as const,
    style: undefined,
    children: [
      {
        type: "text" as const,
        text,
      },
    ],
  };
}

function borderedFooterParagraph(text: string) {
  return {
    ...footerParagraph(text),
    style: {
      borders: {
        top: {
          type: "single",
          sizeEighthPt: 4,
          spacePt: 1,
          color: "#000000",
        },
      },
    },
  };
}

function floatingFooterImageParagraph(
  yPx: number,
  heightPx = 24,
  behindDocument = true
) {
  return {
    type: "paragraph" as const,
    style: undefined,
    children: [
      {
        type: "image" as const,
        src: "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22120%22%20height%3D%2224%22%3E%3Crect%20width%3D%22120%22%20height%3D%2224%22%20fill%3D%22%23007acc%22%2F%3E%3C%2Fsvg%3E",
        widthPx: 120,
        heightPx,
        floating: {
          xPx: 96,
          yPx,
          horizontalRelativeTo: "page" as const,
          verticalRelativeTo: "page" as const,
          wrapType: "none" as const,
          behindDocument,
        },
      },
    ],
  };
}

describe("footer pagination reserve", () => {
  it("reserves body height when footer content would rise into the bottom margin", () => {
    const footerSections: FooterSection[] = [
      {
        type: "default",
        partName: "footer1.xml",
        nodes: [
          footerParagraph("Compare 10 Aug 2019 [03-c0-00] / 07 Nov 2020 [03-d0-00]page 1"),
          footerParagraph("Published on www.legislation.wa.gov.au"),
        ],
      },
    ];

    expect(
      resolveFooterPaginationReservePx(footerSections, {
        pageWidthPx: 794,
        marginsPx: {
          left: 160,
          right: 160,
          bottom: 236,
        },
        footerDistancePx: 225,
      })
    ).toBeGreaterThan(0);
  });

  it("does not reserve extra height for empty footers", () => {
    const footerSections: FooterSection[] = [
      {
        type: "default",
        partName: "footer1.xml",
        nodes: [footerParagraph("")],
      },
    ];

    expect(
      resolveFooterPaginationReservePx(footerSections, {
        pageWidthPx: 794,
        marginsPx: {
          left: 160,
          right: 160,
          bottom: 236,
        },
        footerDistancePx: 225,
      })
    ).toBe(0);
  });

  it("accounts for paragraph border footprint in footer height", () => {
    const layout = {
      pageWidthPx: 794,
      marginsPx: {
        left: 45,
        right: 45,
        bottom: 96,
      },
      footerDistancePx: 47,
    };
    const plainFooterSections: FooterSection[] = [
      {
        type: "default",
        partName: "footer1.xml",
        nodes: [
          footerParagraph("OFFICIAL"),
          footerParagraph("Award letter"),
          footerParagraph("9th February 2023"),
          footerParagraph("Crown copyright 2021"),
          footerParagraph("Page 1 of 3"),
        ],
      },
    ];
    const borderedFooterSections: FooterSection[] = [
      {
        type: "default",
        partName: "footer1.xml",
        nodes: [
          borderedFooterParagraph("OFFICIAL"),
          borderedFooterParagraph("Award letter"),
          borderedFooterParagraph("9th February 2023"),
          borderedFooterParagraph("Crown copyright 2021"),
          borderedFooterParagraph("Page 1 of 3"),
        ],
      },
    ];

    expect(resolveFooterPaginationReservePx(borderedFooterSections, layout)).toBeGreaterThan(
      resolveFooterPaginationReservePx(plainFooterSections, layout)
    );
  });

  it("accounts for the rendered gap between footer paragraphs", () => {
    const layout = {
      pageWidthPx: 794,
      marginsPx: {
        left: 45,
        right: 45,
        bottom: 42,
      },
      footerDistancePx: 20,
    };
    const singleParagraphFooterSections: FooterSection[] = [
      {
        type: "default",
        partName: "footer1.xml",
        nodes: [footerParagraph("Line 1\nLine 2")],
      },
    ];
    const stackedParagraphFooterSections: FooterSection[] = [
      {
        type: "default",
        partName: "footer1.xml",
        nodes: [footerParagraph("Line 1"), footerParagraph("Line 2")],
      },
    ];

    expect(
      resolveFooterPaginationReservePx(stackedParagraphFooterSections, layout)
    ).toBeGreaterThan(resolveFooterPaginationReservePx(singleParagraphFooterSections, layout));
  });

  it("adds extra reserve when the footer distance exceeds the bottom margin", () => {
    const footerSections: FooterSection[] = [
      {
        type: "default",
        partName: "footer1.xml",
        nodes: [footerParagraph("Page - 2 -")],
      },
    ];

    const reserveWithMatchingMargin = resolveFooterPaginationReservePx(footerSections, {
      pageWidthPx: 794,
      marginsPx: {
        left: 45,
        right: 45,
        bottom: 96,
      },
      footerDistancePx: 96,
    });
    const reserveWithRaisedFooter = resolveFooterPaginationReservePx(footerSections, {
      pageWidthPx: 794,
      marginsPx: {
        left: 45,
        right: 45,
        bottom: 72,
      },
      footerDistancePx: 96,
    });

    expect(reserveWithRaisedFooter).toBe(reserveWithMatchingMargin + 24);
  });

  it("keeps a clearance reserve when footer flow content sits flush with the body margin", () => {
    const footerSections: FooterSection[] = [
      {
        type: "default",
        partName: "footer1.xml",
        nodes: [
          footerParagraph("Page 1 of 3"),
          footerParagraph("Prepared by Seller"),
        ],
      },
    ];

    expect(
      resolveFooterPaginationReservePx(footerSections, {
        pageWidthPx: 816,
        pageHeightPx: 1056,
        marginsPx: {
          left: 96,
          right: 96,
          bottom: 96,
        },
        footerDistancePx: 48,
      })
    ).toBeGreaterThan(0);
  });

  it("uses page-relative footer anchor geometry from the footer part as reserve context", () => {
    const footerSections: FooterSection[] = [
      {
        type: "default",
        partName: "footer1.xml",
        nodes: [floatingFooterImageParagraph(900, 24, false)],
      },
    ];

    expect(
      resolveFooterPaginationReservePx(footerSections, {
        pageWidthPx: 794,
        pageHeightPx: 1100,
        marginsPx: {
          left: 45,
          right: 45,
          bottom: 96,
        },
        footerDistancePx: 48,
      })
    ).toBe(112);
  });

  it("does not reserve body height for behind-text decorative footer overlays", () => {
    const footerSections: FooterSection[] = [
      {
        type: "default",
        partName: "footer1.xml",
        nodes: [floatingFooterImageParagraph(900, 24, true)],
      },
    ];

    expect(
      resolveFooterPaginationReservePx(footerSections, {
        pageWidthPx: 794,
        pageHeightPx: 1100,
        marginsPx: {
          left: 45,
          right: 45,
          bottom: 96,
        },
        footerDistancePx: 48,
      })
    ).toBe(0);
  });

  it("caps the measured page content budget at the visible footer boundary", () => {
    expect(
      resolveMeasuredPageContentHeightPx({
        pageLayout: {
          pageHeightPx: 1100,
          marginsPx: {
            bottom: 96,
          },
          footerDistancePx: 48,
        },
        fallbackHeightPx: 900,
        headerHeightPx: 120,
        bodyTopPx: 120,
        bodyRenderedBottomPx: 960,
        footerTopPx: 960,
      })
    ).toBe(808);
  });

  it("uses the visible body span even when rendered body content already overruns the footer", () => {
    expect(
      resolveMeasuredPageContentHeightPx({
        pageLayout: {
          pageHeightPx: 1100,
          marginsPx: {
            bottom: 96,
          },
          footerDistancePx: 48,
        },
        fallbackHeightPx: 900,
        headerHeightPx: 120,
        bodyTopPx: 120,
        bodyRenderedBottomPx: 970,
        footerTopPx: 960,
      })
    ).toBe(808);
  });

  it("does not keep ratcheting down a measured page budget when the visible body span is unchanged", () => {
    expect(
      resolveMeasuredPageContentHeightPx({
        pageLayout: {
          pageHeightPx: 1100,
          marginsPx: {
            bottom: 96,
          },
          footerDistancePx: 48,
        },
        fallbackHeightPx: 900,
        headerHeightPx: 120,
        currentMeasuredHeightPx: 822,
        bodyTopPx: 120,
        bodyRenderedBottomPx: 970,
        footerTopPx: 960,
      })
    ).toBe(808);
  });

  it("does not shrink image-only body pages based on a sparse measured body bottom", () => {
    expect(
      resolveMeasuredPageContentHeightPx({
        pageLayout: {
          pageHeightPx: 1123,
          marginsPx: {
            bottom: 96
          },
          footerDistancePx: 19
        },
        fallbackHeightPx: 931,
        headerHeightPx: 0,
        bodyTopPx: 96,
        bodyRenderedBottomPx: 170,
        footerTopPx: 1093,
        skipBodyBottomAdjustment: true
      })
    ).toBe(931);
  });

  it("ignores editor chrome when measuring the rendered body bottom", () => {
    expect(
      resolveMeasuredBodyRenderedBottomPx([
        {
          bottomPx: 840,
          widthPx: 200,
          heightPx: 24
        },
        {
          bottomPx: 878,
          widthPx: 200,
          heightPx: 38,
          ignore: true
        }
      ])
    ).toBe(840);
  });

  it("returns no rendered body bottom when only ignored editor chrome is present", () => {
    expect(
      resolveMeasuredBodyRenderedBottomPx([
        {
          bottomPx: 878,
          widthPx: 200,
          heightPx: 38,
          ignore: true
        }
      ])
    ).toBeUndefined();
  });

  it("preserves conservative measured page heights across page-count changes", () => {
    expect(
      stabilizeMeasuredPageContentHeights(
        [840, 844, 842],
        [900, 910, 905, 908]
      )
    ).toEqual([840, 844, 842, 908]);
  });

  it("allows measured heights to recover when the page segment identity changes", () => {
    expect(
      stabilizeMeasuredPageContentHeights(
        [840, 844, 842],
        [900, 910, 905],
        {
          currentPageIdentityKeys: ["page-a", "page-b", "page-c"],
          nextPageIdentityKeys: ["page-a", "page-b-reshaped", "page-c"]
        }
      )
    ).toEqual([840, 910, 842]);
  });

  it("ignores stale measured page heights when a different segment set now occupies the page", () => {
    expect(
      resolvePageContentHeightPxForPageSegments(
        [
          {
            nodeIndex: 12
          }
        ],
        0,
        880,
        [
          {
            startNodeIndex: 0,
            pageContentWidthPx: 640,
            pageContentHeightPx: 880,
            pageContentHeightMultiplier: 1
          }
        ],
        [620],
        ["old-page-shape"],
        "new-page-shape"
      )
    ).toBe(880);
  });

  it("ignores measured page heights during render when the chosen pagination plan is reserve-only", () => {
    expect(
      resolveRenderPageContentHeightPxForPageSegments({
        pageSegments: [
          {
            nodeIndex: 12
          }
        ],
        pageIndex: 0,
        defaultPageContentHeightPx: 880,
        metricsBySection: [
          {
            startNodeIndex: 0,
            pageContentWidthPx: 640,
            pageContentHeightPx: 880,
            pageContentHeightMultiplier: 1
          }
        ],
        measuredPageContentHeightsPxByPageIndex: [120],
        measuredPageContentIdentityKeysByPageIndex: ["page-a"],
        pageIdentityKey: "page-a",
        useMeasuredPageContentHeights: false
      })
    ).toBe(880);
  });

  it("keeps the physical page body budget during stored-page reconciliation", () => {
    expect(
      resolveRenderPageContentHeightPxForPageSegments({
        pageSegments: [
          {
            nodeIndex: 12,
          },
        ],
        pageIndex: 0,
        defaultPageContentHeightPx: 880,
        metricsBySection: [
          {
            startNodeIndex: 0,
            pageContentWidthPx: 640,
            pageContentHeightPx: 880,
            pageContentHeightMultiplier: 1,
          },
        ],
        useMeasuredPageContentHeights: false,
        pageContentHeightScale: 1.2,
      })
    ).toBe(880);
  });

});
