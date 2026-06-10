import { describe, expect, it } from "vitest";
import type { DocModel } from "@extend-ai/react-docx-doc-model";
import {
  letterheadColumnGroupContainerStyle,
  letterheadColumnStackStyle,
  letterheadParagraphStyleAdjustments,
  paragraphLetterheadColumnGroupAtSegmentOffset,
  paragraphLetterheadFloatSideAtNodeIndex
} from "../../packages/react-viewer/src/editor";

function paragraph(
  text: string,
  options?: {
    leftTwips?: number;
    rightTwips?: number;
    sourceXml?: string;
  }
): DocModel["nodes"][number] {
  return {
    type: "paragraph",
    children: text.length > 0 ? [{ type: "text", text }] : [],
    style:
      options?.leftTwips !== undefined || options?.rightTwips !== undefined
        ? {
            indent: {
              ...(options?.leftTwips !== undefined ? { leftTwips: options.leftTwips } : undefined),
              ...(options?.rightTwips !== undefined ? { rightTwips: options.rightTwips } : undefined)
            }
          }
        : undefined,
    sourceXml: options?.sourceXml
  };
}

describe("letterhead float layout", () => {
  it("classifies short right-indented letterhead paragraphs as the left column when frame paragraphs are nearby", () => {
    const nodes: DocModel["nodes"] = [
      paragraph("MAURA T. HEALEY", { rightTwips: 2340 }),
      paragraph("Governor", {
        rightTwips: 2340,
        sourceXml:
          '<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:pPr><w:framePr w:xAlign="left"/></w:pPr></w:p>'
      })
    ];

    expect(paragraphLetterheadFloatSideAtNodeIndex(nodes, 0)).toBe("left");
    expect(paragraphLetterheadFloatSideAtNodeIndex(nodes, 1)).toBe("left");
  });

  it("keeps blank same-side spacer paragraphs inside the same letterhead column block", () => {
    const nodes: DocModel["nodes"] = [
      paragraph("MAURA T. HEALEY", { rightTwips: 2340 }),
      paragraph("Governor", {
        rightTwips: 2340,
        sourceXml:
          '<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:pPr><w:framePr w:xAlign="left"/></w:pPr></w:p>'
      }),
      paragraph("", { rightTwips: 2340 }),
      paragraph("KIMBERLEY DRISCOLL", { rightTwips: 2250 })
    ];

    expect(paragraphLetterheadFloatSideAtNodeIndex(nodes, 2)).toBe("left");
  });

  it("classifies short left-indented letterhead paragraphs as the right column when frame paragraphs are nearby", () => {
    const nodes: DocModel["nodes"] = [
      paragraph("KATHLEEN E. WALSH", { leftTwips: 1980 }),
      paragraph("Secretary", {
        leftTwips: 1980,
        sourceXml:
          '<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:pPr><w:framePr w:xAlign="left"/></w:pPr></w:p>'
      })
    ];

    expect(paragraphLetterheadFloatSideAtNodeIndex(nodes, 0)).toBe("right");
    expect(paragraphLetterheadFloatSideAtNodeIndex(nodes, 1)).toBe("right");
  });

  it("keeps delayed right-column names in the same grouped block after framed left-column spacer rows", () => {
    const frameXml =
      '<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:pPr><w:framePr w:xAlign="left"/></w:pPr></w:p>';
    const nodes: DocModel["nodes"] = [
      paragraph("", { rightTwips: 2790 }),
      paragraph("MAURA T. HEALEY", { rightTwips: 2340 }),
      paragraph("Governor", { rightTwips: 2340, sourceXml: frameXml }),
      paragraph("", { rightTwips: 2340, sourceXml: frameXml }),
      paragraph("", { rightTwips: 2340, sourceXml: frameXml }),
      paragraph("", { rightTwips: 2340, sourceXml: frameXml }),
      paragraph("KATHLEEN E. WALSH", { leftTwips: 1980 }),
      paragraph("Secretary", { leftTwips: 1980, sourceXml: frameXml }),
      paragraph("September 26, 2023")
    ];
    const segments = nodes.map((_, nodeIndex) => ({ nodeIndex }));
    const group = paragraphLetterheadColumnGroupAtSegmentOffset(nodes, segments, 0);

    expect(paragraphLetterheadFloatSideAtNodeIndex(nodes, 1)).toBe("left");
    expect(paragraphLetterheadFloatSideAtNodeIndex(nodes, 6)).toBe("right");
    expect(group).toBeDefined();
    expect(group?.entries.map((entry) => entry.side)).toEqual([
      "left",
      "left",
      "left",
      "left",
      "left",
      "left",
      "right",
      "right"
    ]);
  });

  it("does not classify long indented body paragraphs as letterhead columns", () => {
    const nodes: DocModel["nodes"] = [
      paragraph(
        "This is an intentionally long paragraph that should stay in the normal block flow even if it is indented for body formatting purposes.",
        {
          leftTwips: 1980,
          sourceXml:
            '<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:pPr><w:framePr w:xAlign="left"/></w:pPr></w:p>'
        }
      )
    ];

    expect(paragraphLetterheadFloatSideAtNodeIndex(nodes, 0)).toBeUndefined();
  });

  it("groups contiguous left and right letterhead paragraphs into a shared column block", () => {
    const nodes: DocModel["nodes"] = [
      paragraph("MAURA T. HEALEY", { rightTwips: 2340 }),
      paragraph("Governor", {
        rightTwips: 2340,
        sourceXml:
          '<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:pPr><w:framePr w:xAlign="left"/></w:pPr></w:p>'
      }),
      paragraph("KATHLEEN E. WALSH", { leftTwips: 1980 }),
      paragraph("Secretary", {
        leftTwips: 1980,
        sourceXml:
          '<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:pPr><w:framePr w:xAlign="left"/></w:pPr></w:p>'
      }),
      paragraph("September 26, 2023")
    ];
    const segments = nodes.map((_, nodeIndex) => ({ nodeIndex }));

    expect(paragraphLetterheadColumnGroupAtSegmentOffset(nodes, segments, 0)).toEqual({
      startOffset: 0,
      endOffset: 4,
      leftSegments: [{ nodeIndex: 0 }, { nodeIndex: 1 }],
      rightSegments: [{ nodeIndex: 2 }, { nodeIndex: 3 }],
      entries: [
        { segment: { nodeIndex: 0 }, side: "left" },
        { segment: { nodeIndex: 1 }, side: "left" },
        { segment: { nodeIndex: 2 }, side: "right" },
        { segment: { nodeIndex: 3 }, side: "right" }
      ]
    });
  });

  it("does not start a grouped column block when only one letterhead side is present", () => {
    const nodes: DocModel["nodes"] = [
      paragraph("MAURA T. HEALEY", { rightTwips: 2340 }),
      paragraph("Governor", {
        rightTwips: 2340,
        sourceXml:
          '<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:pPr><w:framePr w:xAlign="left"/></w:pPr></w:p>'
      }),
      paragraph("September 26, 2023")
    ];
    const segments = nodes.map((_, nodeIndex) => ({ nodeIndex }));

    expect(paragraphLetterheadColumnGroupAtSegmentOffset(nodes, segments, 0)).toBeUndefined();
  });

  it("removes indent-driven margins when rendering inside a grouped letterhead column", () => {
    expect(
      letterheadParagraphStyleAdjustments("left", undefined, {
        suppressLetterheadColumnLayout: true
      })
    ).toEqual({
      width: "100%",
      boxSizing: "border-box",
      marginLeft: 0,
      marginRight: 0
    });
    expect(
      letterheadParagraphStyleAdjustments("right", "left", {
        suppressLetterheadColumnLayout: true
      })
    ).toEqual({
      width: "100%",
      boxSizing: "border-box",
      marginLeft: 0,
      marginRight: 0
    });
  });

  it("renders grouped letterhead content as paired rows in a two-column grid", () => {
    expect(letterheadColumnGroupContainerStyle()).toEqual({
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      columnGap: 28,
      alignItems: "start",
      width: "100%",
      maxWidth: "100%",
      boxSizing: "border-box"
    });
    expect(letterheadColumnStackStyle()).toEqual({
      minWidth: 0,
      maxWidth: "100%"
    });
  });
});
