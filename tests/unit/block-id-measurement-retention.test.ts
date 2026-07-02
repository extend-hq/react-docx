import { describe, expect, it } from "vitest";
import type {
  DocModel,
  ParagraphNode,
  TableNode
} from "../../packages/doc-model/src";
import {
  cloneDocModel,
  collectDuplicateDocModelBlockIds,
  ensureDocModelBlockIds,
  normalizeDocModel
} from "../../packages/doc-model/src";
import {
  duplicateParagraph,
  insertParagraph,
  pasteParagraphs,
  updateParagraphText
} from "../../packages/editor-ops/src";
import { docNodeContentSignature } from "../../packages/react-viewer/src/content-signature";
import {
  buildMeasuredPageContentValidationForPageSegments,
  measuredPageContentValidationsEqual,
  resolveMeasuredPageContentHeightsPxForEditedModel,
  resolveTableMeasuredRowHeightsForPagination
} from "../../packages/react-viewer/src/editor";

function createParagraph(text: string, blockId?: string): ParagraphNode {
  return {
    type: "paragraph",
    blockId,
    children: [{ type: "text", text }]
  };
}

function createTable(cellText: string, blockId?: string): TableNode {
  return {
    type: "table",
    blockId,
    rows: [
      {
        type: "table-row",
        cells: [
          {
            type: "table-cell",
            nodes: [createParagraph(cellText)]
          }
        ]
      }
    ]
  };
}

function createModel(nodes: DocModel["nodes"]): DocModel {
  return {
    nodes,
    metadata: {
      sourceParts: 1,
      warnings: [],
      headerSections: [],
      footerSections: [],
      paragraphStyles: []
    }
  };
}

describe("block id assignment", () => {
  it("assigns unique ids to body, header/footer, footnote, and nested cell nodes", () => {
    const model = createModel([
      createParagraph("body"),
      createTable("cell")
    ]);
    model.metadata.headerSections = [
      { partName: "header1.xml", nodes: [createParagraph("header")] }
    ];
    model.metadata.footerSections = [
      { partName: "footer1.xml", nodes: [createParagraph("footer")] }
    ];
    model.metadata.footnotes = [
      { id: 1, text: "note", nodes: [createParagraph("note")] }
    ];

    ensureDocModelBlockIds(model);

    const table = model.nodes[1] as TableNode;
    const collected = [
      model.nodes[0]?.blockId,
      table.blockId,
      table.rows[0]?.cells[0]?.nodes[0]?.blockId,
      model.metadata.headerSections[0]?.nodes[0]?.blockId,
      model.metadata.footerSections[0]?.nodes[0]?.blockId,
      model.metadata.footnotes?.[0]?.nodes?.[0]?.blockId
    ];
    for (const blockId of collected) {
      expect(blockId).toBeTruthy();
    }
    expect(new Set(collected).size).toBe(collected.length);
    expect(collectDuplicateDocModelBlockIds(model)).toEqual([]);
  });

  it("keeps existing ids instead of reassigning them", () => {
    const model = createModel([createParagraph("stable", "keep-me")]);
    ensureDocModelBlockIds(model);
    expect(model.nodes[0]?.blockId).toBe("keep-me");
  });

  it("reports ids duplicated within the same container", () => {
    const model = createModel([
      createParagraph("one", "dup"),
      createParagraph("two", "dup"),
      createParagraph("three")
    ]);
    expect(collectDuplicateDocModelBlockIds(model)).toEqual(["dup"]);
  });
});

describe("block id maintenance through cloning and ops", () => {
  it("survives cloneDocModel and normalizeDocModel", () => {
    const model = ensureDocModelBlockIds(
      createModel([createParagraph("body"), createTable("cell")])
    );
    const cloned = cloneDocModel(model);
    expect(cloned.nodes[0]?.blockId).toBe(model.nodes[0]?.blockId);
    expect(cloned.nodes[1]?.blockId).toBe(model.nodes[1]?.blockId);

    const normalized = normalizeDocModel(model);
    expect(normalized.nodes[0]?.blockId).toBe(model.nodes[0]?.blockId);
    expect(normalized.nodes[1]?.blockId).toBe(model.nodes[1]?.blockId);
  });

  it("keeps the id across text edits", () => {
    const model = ensureDocModelBlockIds(createModel([createParagraph("a")]));
    const next = updateParagraphText(model, 0, "b");
    expect(next.nodes[0]?.blockId).toBe(model.nodes[0]?.blockId);
  });

  it("assigns fresh ids to inserted, duplicated, and pasted paragraphs", () => {
    const model = ensureDocModelBlockIds(createModel([createParagraph("a")]));
    const originalId = model.nodes[0]?.blockId;

    const inserted = insertParagraph(model, "inserted", 1);
    expect(inserted.nodes[1]?.blockId).toBeTruthy();
    expect(inserted.nodes[1]?.blockId).not.toBe(originalId);

    const duplicated = duplicateParagraph(model, 0);
    expect(duplicated.nodes[1]?.blockId).toBeTruthy();
    expect(duplicated.nodes[1]?.blockId).not.toBe(originalId);
    expect(collectDuplicateDocModelBlockIds(duplicated)).toEqual([]);

    const pasted = pasteParagraphs(model, 1, [
      model.nodes[0] as ParagraphNode
    ]);
    expect(pasted.nodes[1]?.blockId).toBeTruthy();
    expect(pasted.nodes[1]?.blockId).not.toBe(originalId);
  });
});

describe("table measured row heights staleness", () => {
  it("keeps signature-matching tables after an edit and drops changed ones", () => {
    const unchanged = createTable("same", "table-a");
    const edited = createTable("before-edit", "table-b");
    const nodes: DocModel["nodes"] = [unchanged, edited];

    const heights = resolveTableMeasuredRowHeightsForPagination(
      nodes,
      {
        "table-a": {
          rowHeightsPx: [40],
          contentSignature: docNodeContentSignature(unchanged)
        },
        "table-b": {
          rowHeightsPx: [64],
          contentSignature: "stale-signature"
        }
      },
      {
        allowMeasuredImportPagination: false,
        allowContentSignatureValidatedTables: true
      }
    );

    expect(heights).toBeDefined();
    expect(heights?.[0]).toBeDefined();
    expect(heights?.[1]).toBeUndefined();
  });

  it("returns undefined when nothing validates and no draft is active", () => {
    const table = createTable("text", "table-a");
    expect(
      resolveTableMeasuredRowHeightsForPagination(
        [table],
        {
          "table-a": { rowHeightsPx: [40], contentSignature: "stale" }
        },
        {
          allowMeasuredImportPagination: false,
          allowContentSignatureValidatedTables: true
        }
      )
    ).toBeUndefined();
  });

  it("ignores entries whose row count no longer matches", () => {
    const table = createTable("text", "table-a");
    expect(
      resolveTableMeasuredRowHeightsForPagination(
        [table],
        {
          "table-a": {
            rowHeightsPx: [40, 40],
            contentSignature: docNodeContentSignature(table)
          }
        },
        {
          allowMeasuredImportPagination: false,
          allowContentSignatureValidatedTables: true
        }
      )
    ).toBeUndefined();
  });

  it("treats tables without ids as never cached", () => {
    const table = createTable("text");
    expect(
      resolveTableMeasuredRowHeightsForPagination(
        [table],
        {
          "table-a": {
            rowHeightsPx: [40],
            contentSignature: docNodeContentSignature(table)
          }
        },
        {
          allowMeasuredImportPagination: false,
          allowContentSignatureValidatedTables: true
        }
      )
    ).toBeUndefined();
  });
});

describe("measured page content height retention", () => {
  const contextSignature = "geometry-1";

  function buildValidations(
    nodes: DocModel["nodes"],
    pages: number[][]
  ): Array<ReturnType<typeof buildMeasuredPageContentValidationForPageSegments>> {
    return pages.map((nodeIndexes) =>
      buildMeasuredPageContentValidationForPageSegments(
        nodeIndexes.map((nodeIndex) => ({ nodeIndex })),
        nodes,
        contextSignature
      )
    );
  }

  it("keeps every page when nothing changed", () => {
    const nodes = [
      createParagraph("one", "b1"),
      createParagraph("two", "b2"),
      createParagraph("three", "b3")
    ];
    const validations = buildValidations(nodes, [[0, 1], [2]]);

    expect(
      resolveMeasuredPageContentHeightsPxForEditedModel(
        nodes,
        [700, 500],
        validations,
        contextSignature
      )
    ).toEqual([700, 500]);
  });

  it("keeps the clean prefix before the first edited block", () => {
    const nodes = [
      createParagraph("one", "b1"),
      createParagraph("two", "b2"),
      createParagraph("three", "b3")
    ];
    const validations = buildValidations(nodes, [[0], [1], [2]]);
    const editedNodes = [
      nodes[0],
      createParagraph("two (edited)", "b2"),
      nodes[2]
    ];

    expect(
      resolveMeasuredPageContentHeightsPxForEditedModel(
        editedNodes,
        [700, 640, 500],
        validations,
        contextSignature
      )
    ).toEqual([700]);
  });

  it("drops everything when a block is inserted before the first page", () => {
    const nodes = [
      createParagraph("one", "b1"),
      createParagraph("two", "b2")
    ];
    const validations = buildValidations(nodes, [[0], [1]]);
    const editedNodes = [createParagraph("new", "b0"), ...nodes];

    expect(
      resolveMeasuredPageContentHeightsPxForEditedModel(
        editedNodes,
        [700, 640],
        validations,
        contextSignature
      )
    ).toBeUndefined();
  });

  it("invalidates when a block is deleted between pages", () => {
    const nodes = [
      createParagraph("one", "b1"),
      createParagraph("two", "b2"),
      createParagraph("three", "b3")
    ];
    const validations = buildValidations(nodes, [[0], [1], [2]]);
    const editedNodes = [nodes[0], nodes[2]];

    expect(
      resolveMeasuredPageContentHeightsPxForEditedModel(
        editedNodes,
        [700, 640, 500],
        validations,
        contextSignature
      )
    ).toEqual([700]);
  });

  it("treats a block spanning two pages as a single match", () => {
    const nodes = [
      createParagraph("one", "b1"),
      createParagraph("long", "b2"),
      createParagraph("three", "b3")
    ];
    const validations = buildValidations(nodes, [[0, 1], [1, 2]]);

    expect(
      resolveMeasuredPageContentHeightsPxForEditedModel(
        nodes,
        [700, 500],
        validations,
        contextSignature
      )
    ).toEqual([700, 500]);
  });

  it("rejects pages measured under a different context", () => {
    const nodes = [createParagraph("one", "b1")];
    const validations = buildValidations(nodes, [[0]]);

    expect(
      resolveMeasuredPageContentHeightsPxForEditedModel(
        nodes,
        [700],
        validations,
        "geometry-2"
      )
    ).toBeUndefined();
  });

  it("stops at pages that were never validated", () => {
    const nodes = [
      createParagraph("one", "b1"),
      createParagraph("two", "b2")
    ];
    const validations = buildValidations(nodes, [[0]]);

    expect(
      resolveMeasuredPageContentHeightsPxForEditedModel(
        nodes,
        [700, 640],
        [validations[0], undefined],
        contextSignature
      )
    ).toEqual([700]);
  });

  it("stops at blocks that have no id", () => {
    const nodes = [
      createParagraph("one", "b1"),
      createParagraph("two")
    ];
    const validations = buildValidations(nodes, [[0], [1]]);

    expect(
      resolveMeasuredPageContentHeightsPxForEditedModel(
        nodes,
        [700, 640],
        validations,
        contextSignature
      )
    ).toEqual([700]);
  });

  it("dedupes consecutive segments of the same node in validations", () => {
    const nodes = [createParagraph("one", "b1")];
    const validation = buildMeasuredPageContentValidationForPageSegments(
      [
        { nodeIndex: 0, paragraphLineRange: { startLineIndex: 0, endLineIndex: 3, totalLineCount: 6 } },
        { nodeIndex: 0, paragraphLineRange: { startLineIndex: 3, endLineIndex: 6, totalLineCount: 6 } }
      ],
      nodes,
      contextSignature
    );
    expect(validation.blocks).toHaveLength(1);
    expect(validation.blocks[0]?.blockId).toBe("b1");
  });

  it("compares validations structurally", () => {
    const nodes = [createParagraph("one", "b1")];
    const [left] = buildValidations(nodes, [[0]]);
    const [right] = buildValidations(nodes, [[0]]);
    expect(measuredPageContentValidationsEqual(left, right)).toBe(true);
    expect(
      measuredPageContentValidationsEqual(left, {
        ...right,
        contextSignature: "other"
      })
    ).toBe(false);
    expect(measuredPageContentValidationsEqual(left, undefined)).toBe(false);
  });
});
