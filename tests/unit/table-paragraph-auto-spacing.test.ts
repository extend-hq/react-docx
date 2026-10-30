import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DocModel, ParagraphNode, TableCellContentNode, TableNode } from "../../packages/doc-model/src";
import { DocxEditorViewer, estimateTableRowHeightsPx, useDocxEditor } from "../../packages/react-viewer/src/editor";

function paragraph(id: string, automatic?: boolean, direct = false): ParagraphNode {
  return {
    type: "paragraph", blockId: id,
    sourceXml: `<w:p><w:pPr>${direct ? '<w:spacing w:before="100" w:after="100" w:line="240" w:lineRule="exact"/>' : '<w:pStyle w:val="Spacing"/>'}</w:pPr><w:r><w:t>Text</w:t></w:r></w:p>`,
    style: { spacing: { beforeTwips: 100, afterTwips: 100, lineTwips: 240, lineRule: "exact", beforeAutoSpacing: automatic, afterAutoSpacing: automatic } },
    children: [{ type: "text", text: "Text", style: { fontFamily: "Arial", fontSizePt: 11 } }],
  };
}

function table(nodes: TableCellContentNode[], id = "table"): TableNode {
  return {
    type: "table", blockId: id, sourceXml: "<w:tbl><w:tblPr/></w:tbl>",
    style: {
      layout: "fixed", widthTwips: 7200, columnWidthsTwips: [7200],
      cellMarginTwips: { topTwips: 0, rightTwips: 0, bottomTwips: 0, leftTwips: 0 },
      borders: Object.fromEntries(["top", "right", "bottom", "left"].map((side) => [side, { type: "single", sizeEighthPt: 4, color: "000000" }])),
    },
    rows: [{ type: "table-row", cells: [{ type: "table-cell", nodes }] }],
  };
}

function model(node: TableNode): DocModel {
  return { nodes: [node], metadata: { sourceParts: 1, warnings: [], headerSections: [], footerSections: [], paragraphStyles: [] } };
}

function Viewer({ document }: { document: DocModel }): React.JSX.Element {
  const editor = useDocxEditor({ starterModel: document });
  return React.createElement(DocxEditorViewer, { editor, mode: "read-only", deferInitialPaginationPaint: false });
}

function render(node: TableNode): Map<string, Record<string, string>> {
  const html = renderToStaticMarkup(React.createElement(Viewer, { document: model(node) }));
  const result = new Map<string, Record<string, string>>();
  for (const match of html.matchAll(/<div\b[^>]*data-docx-source-id="([^"]+)"[^>]*style="([^"]*)"/g)) {
    result.set(match[1], Object.fromEntries(match[2].split(";").filter(Boolean).map((item) => {
      const colon = item.indexOf(":");
      return [item.slice(0, colon), item.slice(colon + 1)];
    })));
  }
  return result;
}

const margins = (value: Record<string, string> | undefined) => [value?.["margin-top"], value?.["margin-bottom"]];

describe("table paragraph automatic spacing", () => {
  it.each([false, undefined])("retains effective numeric edges and exact line spacing with automatic=%s", (automatic) => {
    const inherited = table([paragraph("one", automatic)]);
    const direct = table([paragraph("one", automatic, true)]);
    expect(estimateTableRowHeightsPx(inherited, 480)).toEqual(estimateTableRowHeightsPx(direct, 480));
    const style = render(inherited).get("one");
    expect(margins(style)).toEqual([`${100 / 15}px`, `${100 / 15}px`]);
    expect(style?.["line-height"]).toBe("16px");
  });

  it("suppresses both automatic margins for a sole paragraph in measurement and rendering", () => {
    const automatic = table([paragraph("one", true)]);
    const zero = paragraph("one", false, true);
    zero.style!.spacing!.beforeTwips = 0;
    zero.style!.spacing!.afterTwips = 0;
    expect(estimateTableRowHeightsPx(automatic, 480)).toEqual(estimateTableRowHeightsPx(table([zero]), 480));
    expect(margins(render(automatic).get("one"))).toEqual(["0", "0"]);
  });

  it("only clears true automatic margins at the first and last cell content edges", () => {
    const value = table([paragraph("first", true), paragraph("middle", true), paragraph("last", true)]);
    const rendered = render(value);
    expect(margins(rendered.get("first"))).toEqual(["0", `${100 / 15}px`]);
    expect(margins(rendered.get("middle"))).toEqual([`${100 / 15}px`, `${100 / 15}px`]);
    expect(margins(rendered.get("last"))).toEqual([`${100 / 15}px`, "0"]);
  });

  it("uses actual content edges around nested tables and applies the same rules inside them", () => {
    const nested = table([paragraph("nested", true)], "nested-table");
    const rendered = render(table([nested, paragraph("after-table", true)]));
    expect(margins(rendered.get("nested"))).toEqual(["0", "0"]);
    expect(margins(rendered.get("after-table"))).toEqual([`${100 / 15}px`, "0"]);
    const trailing = render(table([paragraph("before-table", true), nested]));
    expect(margins(trailing.get("before-table"))).toEqual(["0", `${100 / 15}px`]);
  });
});
