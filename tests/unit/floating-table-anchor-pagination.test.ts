import { describe, expect, it } from "vitest";
import type {
  DocModel,
  ParagraphNode,
  TableNode,
} from "@extend-ai/react-docx-doc-model";
import { keepTextAnchoredTablesWithFollowingParagraph } from "../../packages/react-viewer/src/editor";

const paragraph: ParagraphNode = {
  type: "paragraph",
  children: [{ type: "text", text: "Content" }],
};
const table: TableNode = {
  type: "table",
  rows: [],
  style: { floating: { verticalAnchor: "text" } },
};
const model = (): DocModel => ({
  nodes: [paragraph, table, paragraph],
  metadata: {
    sourceParts: 1,
    warnings: [],
    headerSections: [],
    footerSections: [],
    paragraphStyles: [],
  },
});

describe("floating table anchor pagination", () => {
  it("keeps a text-anchored table on the page where its following paragraph begins", () => {
    expect(
      keepTextAnchoredTablesWithFollowingParagraph(
        [[{ nodeIndex: 0 }, { nodeIndex: 1 }], [{ nodeIndex: 2 }]],
        model()
      )
    ).toEqual([[{ nodeIndex: 0 }], [{ nodeIndex: 1 }, { nodeIndex: 2 }]]);
  });

  it("preserves page-anchored tables", () => {
    const document = model();
    document.nodes[1] = {
      ...table,
      style: { floating: { verticalAnchor: "page" } },
    };
    const pages = [[{ nodeIndex: 0 }, { nodeIndex: 1 }], [{ nodeIndex: 2 }]];
    const expected = structuredClone(pages);
    expect(
      keepTextAnchoredTablesWithFollowingParagraph(pages, document)
    ).toEqual(expected);
  });

  it("does not move a table across a section boundary", () => {
    const document = model();
    document.metadata.sections = [
      { startNodeIndex: 2, headerSections: [], footerSections: [] },
    ];
    const pages = [[{ nodeIndex: 0 }, { nodeIndex: 1 }], [{ nodeIndex: 2 }]];
    const expected = structuredClone(pages);
    expect(
      keepTextAnchoredTablesWithFollowingParagraph(pages, document)
    ).toEqual(expected);
  });

  it("does not leave an empty page when only an anchor table occupied it", () => {
    const document = model();
    document.nodes = [table, paragraph];
    expect(
      keepTextAnchoredTablesWithFollowingParagraph(
        [[{ nodeIndex: 0 }], [{ nodeIndex: 1 }]],
        document
      )
    ).toEqual([[{ nodeIndex: 0 }, { nodeIndex: 1 }]]);
  });
});
