import { describe, expect, it } from "vitest";
import type { DocModel } from "@extend-ai/react-docx-doc-model";
import { buildDocumentPageNodeSegments } from "../../packages/react-viewer/src/editor";

describe("rendered page break pagination", () => {
  it("prefers paragraph-start rendered page breaks during untouched viewer import pagination", () => {
    const model: DocModel = {
      nodes: [
        {
          type: "paragraph",
          children: [{ type: "text", text: "First page" }]
        },
        {
          type: "paragraph",
          sourceXml:
            `<w:p><w:r><w:lastRenderedPageBreak/></w:r>` +
            `<w:r><w:t>Second page</w:t></w:r></w:p>`,
          children: [{ type: "text", text: "Second page" }]
        }
      ],
      metadata: {
        sourceParts: 1,
        warnings: [],
        headerSections: [],
        footerSections: [],
        paragraphStyles: []
      }
    };

    const pages = buildDocumentPageNodeSegments(
      model,
      500,
      400,
      undefined,
      undefined,
      {
        preferLastRenderedParagraphStartBreaks: true
      }
    );

    expect(pages).toEqual([
      [{ nodeIndex: 0 }],
      [{ nodeIndex: 1 }]
    ]);
  });

  it("ignores a paragraph-start rendered break when the previous paragraph already ends with an explicit page break", () => {
    const model: DocModel = {
      nodes: [
        {
          type: "paragraph",
          sourceXml:
            `<w:p><w:r><w:t>First page</w:t></w:r>` +
            `<w:r><w:br w:type="page"/></w:r></w:p>`,
          children: [{ type: "text", text: "First page" }]
        },
        {
          type: "paragraph",
          sourceXml:
            `<w:p><w:r><w:lastRenderedPageBreak/></w:r>` +
            `<w:r><w:t>Second page</w:t></w:r></w:p>`,
          children: [{ type: "text", text: "Second page" }]
        }
      ],
      metadata: {
        sourceParts: 1,
        warnings: [],
        headerSections: [],
        footerSections: [],
        paragraphStyles: []
      }
    };

    const pages = buildDocumentPageNodeSegments(
      model,
      500,
      400,
      undefined,
      undefined,
      {
        preferLastRenderedParagraphStartBreaks: true
      }
    );

    expect(pages).toEqual([[{ nodeIndex: 0 }], [{ nodeIndex: 1 }]]);
  });

  it("ignores a paragraph-start rendered break when the previous paragraph already ends a next-page section", () => {
    const model: DocModel = {
      nodes: [
        {
          type: "paragraph",
          sourceXml:
            `<w:p><w:r><w:t>Section boundary</w:t></w:r>` +
            `<w:sectPr><w:type w:val="nextPage"/></w:sectPr></w:p>`,
          children: [{ type: "text", text: "Section boundary" }]
        },
        {
          type: "paragraph",
          sourceXml:
            `<w:p><w:r><w:lastRenderedPageBreak/></w:r>` +
            `<w:r><w:t>Second section</w:t></w:r></w:p>`,
          children: [{ type: "text", text: "Second section" }]
        }
      ],
      metadata: {
        sourceParts: 1,
        warnings: [],
        sections: [
          {
            startNodeIndex: 0,
            sectionPropertiesXml: `<w:sectPr><w:type w:val="continuous"/></w:sectPr>`,
            headerSections: [],
            footerSections: []
          },
          {
            startNodeIndex: 1,
            sectionPropertiesXml: `<w:sectPr><w:type w:val="nextPage"/></w:sectPr>`,
            headerSections: [],
            footerSections: []
          }
        ],
        headerSections: [],
        footerSections: [],
        paragraphStyles: []
      }
    };

    const pages = buildDocumentPageNodeSegments(
      model,
      500,
      400,
      undefined,
      undefined,
      {
        preferLastRenderedParagraphStartBreaks: true
      }
    );

    expect(pages).toEqual([[{ nodeIndex: 0 }], [{ nodeIndex: 1 }]]);
  });

  it("does not strand formatting-only empty paragraphs on a blank page before a rendered page break", () => {
    const model: DocModel = {
      nodes: [
        {
          type: "paragraph",
          sourceXml: `<w:p><w:r><w:t>Intro</w:t></w:r></w:p>`,
          children: [{ type: "text", text: "Intro" }]
        },
        {
          type: "paragraph",
          sourceXml:
            `<w:p><w:pPr><w:rPr><w:b/><w:u w:val="single"/></w:rPr></w:pPr></w:p>`,
          children: []
        },
        {
          type: "paragraph",
          sourceXml:
            `<w:p><w:pPr><w:rPr><w:b/><w:u w:val="single"/></w:rPr></w:pPr></w:p>`,
          children: []
        },
        {
          type: "paragraph",
          sourceXml:
            `<w:p><w:r><w:lastRenderedPageBreak/></w:r>` +
            `<w:r><w:t>Next page heading</w:t></w:r></w:p>`,
          children: [{ type: "text", text: "Next page heading" }]
        }
      ],
      metadata: {
        sourceParts: 1,
        warnings: [],
        headerSections: [],
        footerSections: [],
        paragraphStyles: []
      }
    };

    const pages = buildDocumentPageNodeSegments(
      model,
      28,
      400,
      undefined,
      undefined,
      {
        preferLastRenderedParagraphStartBreaks: true
      }
    );

    expect(pages).toEqual([[{ nodeIndex: 0 }], [{ nodeIndex: 3 }]]);
  });
});
