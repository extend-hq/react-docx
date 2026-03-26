import { describe, expect, it } from "vitest";
import type { FooterSection } from "@react-docx/doc-model";
import { resolveFooterPaginationReservePx } from "../../packages/react-viewer/src/editor";

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
});
