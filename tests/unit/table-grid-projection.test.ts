import { describe, expect, it, vi } from "vitest";
import {
  cloneTableNode,
  materializeCollapsedTableGrid,
  projectCollapsedTableGrid,
  type DocModel,
  type TableNode,
} from "@extend-ai/react-docx-doc-model";
import { modelToDocumentXml } from "@extend-ai/react-docx-serializer";
import { commitNestedStructuralTableEdit, commitStructuralTableEdit } from "../../packages/react-viewer/src/table-grid-edit";
import { prepareModelForSerialization } from "../../packages/serializer/src/prepare-model";

function table(): TableNode {
  return {
    type: "table",
    style: { layout: "fixed", columnWidthsTwips: [900, 0, 1800], collapsedGridColumns: [1] },
    sourceXml: '<w:tbl><w:tblGrid><w:gridCol w:w="900"/><w:gridCol w:w="0"/><w:gridCol w:w="1800"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>',
    rows: [{ type: "table-row", cells: [
      { type: "table-cell", style: { gridSpan: 2 }, nodes: [] },
      { type: "table-cell", nodes: [] },
    ] }],
  };
}

function model(source: TableNode): DocModel {
  return { nodes: [source], metadata: {
    sourceParts: 1, warnings: [], headerSections: [], footerSections: [], paragraphStyles: [],
  } };
}

const options = { resolvedBorderSpacingPx: 0, cloneTable: cloneTableNode };

describe("collapsed table geometry", () => {
  it("projects boundaries and spans without mutating imported geometry", () => {
    const source = table();
    const before = structuredClone(source);
    const result = projectCollapsedTableGrid(source, options);
    expect(result.kind).toBe("projected");
    if (result.kind !== "projected") return;
    expect(result.table.style?.columnWidthsTwips).toEqual([900, 1800]);
    expect(result.table.rows[0].cells[0].style?.gridSpan).toBeUndefined();
    expect(result.logicalToPhysicalBoundary).toEqual([0, 1, 1, 2]);
    expect(result.physicalToLogicalBoundaryRanges).toEqual([
      { start: 0, end: 0 }, { start: 1, end: 2 }, { start: 3, end: 3 },
    ]);
    expect(result.table.sourceXml).toBe(source.sourceXml);
    expect(source).toEqual(before);
  });

  it.each([
    ["duplicate indices", (source: TableNode) => { source.style!.collapsedGridColumns = [1, 1]; }],
    ["unmarked zero columns", (source: TableNode) => { source.style!.columnWidthsTwips = [0, 0, 1800]; }],
    ["empty physical cells", (source: TableNode) => {
      source.rows[0].cells[0].style!.gridSpan = 1;
      source.rows[0].cells.splice(1, 0, { type: "table-cell", nodes: [] });
    }],
    ["omitted row columns", (source: TableNode) => { source.rows[0].style = { gridBefore: 1 }; }],
  ] as const)("rejects %s", (_label, change) => {
    const source = table();
    change(source);
    expect(projectCollapsedTableGrid(source, options).kind).toBe("rejected");
  });

  it("requires confirmed zero spacing", () => {
    expect(projectCollapsedTableGrid(table()).kind).toBe("rejected");
    expect(projectCollapsedTableGrid(table(), { resolvedBorderSpacingPx: 1 }).kind).toBe("rejected");
  });

  it.each(["preview", "cancel"] as const)("preserves source identity during %s", (intent) => {
    const source = table();
    const mutate = vi.fn(() => ({ changed: true }));
    const result = commitStructuralTableEdit(source, intent, mutate, options);
    expect(result.table).toBe(source);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("does not invalidate provenance for a no-op mutation", () => {
    const source = table();
    const result = commitStructuralTableEdit(source, "commit", () => ({ changed: false }), options);
    expect(result.kind).toBe("unchanged");
    expect(result.table).toBe(source);
    expect(source.sourceXml).toBeDefined();
  });

  it("materializes committed edits and invalidates only the edited ancestor chain", () => {
    const nested = table();
    const parent = table();
    parent.rows[0].cells[0].nodes.push(nested);
    const before = structuredClone(parent);
    const result = commitNestedStructuralTableEdit(parent,
      [{ rowIndex: 0, cellIndex: 0, nodeIndex: 0 }], "commit", (draft) => {
        draft.style!.columnWidthsTwips = [1000, 1700];
        return { changed: true };
      }, options);
    expect(result.kind).toBe("committed");
    if (result.kind !== "committed") return;
    expect(result.invalidatedAncestorCount).toBe(1);
    expect(result.targetMaterialized).toBe(true);
    expect(result.table.sourceXml).toBeUndefined();
    expect(result.targetTable.sourceXml).toBeUndefined();
    expect(result.targetTable.style?.collapsedGridColumns).toBeUndefined();
    expect(result.targetTable.style?.columnWidthsTwips).toEqual([1000, 1700]);
    expect(result.table.rows[0].cells[1]).toBe(parent.rows[0].cells[1]);
    expect(parent).toEqual(before);
  });

  it("retains source XML until materialization and exports a physical grid afterward", async () => {
    const source = table();
    const document = model(source);
    const prepared = prepareModelForSerialization(document);
    expect(prepared.nodes[0]).toMatchObject({ sourceXml: source.sourceXml, style: { columnWidthsTwips: [900, 1800] } });
    expect(await modelToDocumentXml(document)).toContain(source.sourceXml);
    const materialized = materializeCollapsedTableGrid(source, options);
    expect(materialized.kind).toBe("projected");
    if (materialized.kind !== "projected") return;
    const xml = await modelToDocumentXml(model(materialized.table));
    expect(xml).not.toContain('<w:gridCol w:w="0"/>');
    expect(xml).not.toContain('<w:gridSpan w:val="2"/>');
    expect(xml).toContain('<w:gridCol w:w="900"/>');
    expect(xml).toContain('<w:gridCol w:w="1800"/>');
    expect(source.style?.collapsedGridColumns).toEqual([1]);
  });
});
