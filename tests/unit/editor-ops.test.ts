import { describe, expect, it } from "vitest";
import {
  cloneDocModel,
  type DocModel,
  type ParagraphNode,
} from "@extend-ai/react-docx-doc-model";
import {
  copyParagraphs,
  parseParagraphsFromClipboard,
  pasteParagraphs,
  serializeParagraphsForClipboard,
  setParagraphHeading,
  setRunHighlight,
  splitParagraphChildrenAtTextOffsets,
  toggleRunStyleFlag,
  updateParagraphText,
  updateTableCellParagraphTextRecursive,
  updateTableCellParagraphText,
  updateTableCellText,
} from "@extend-ai/react-docx-editor-ops";

function sampleModel(): DocModel {
  return {
    nodes: [
      {
        type: "paragraph",
        children: [{ type: "text", text: "First paragraph" }],
      },
      {
        type: "paragraph",
        children: [{ type: "text", text: "Second paragraph" }],
      },
    ],
    metadata: {
      sourceParts: 1,
      warnings: [],
      headerSections: [],
      footerSections: [],
      paragraphStyles: [],
      defaultParagraphStyleId: "Normal",
    },
  };
}

describe("editor-ops", () => {
  it("applies heading/highlight/toggle styles", () => {
    const model = sampleModel();
    const headed = setParagraphHeading(model, 0, 1);
    const highlighted = setRunHighlight(headed, 0, 0, "yellow");
    const bolded = toggleRunStyleFlag(highlighted, 0, 0, "bold");

    expect(bolded.nodes[0].style?.headingLevel).toBe(1);
    expect(bolded.nodes[0].children[0].style?.highlight).toBe("yellow");
    expect(bolded.nodes[0].children[0].style?.bold).toBe(true);
  });

  it("copies and pastes paragraph payload via clipboard serialization", () => {
    const model = sampleModel();
    const copied = copyParagraphs(model, 0, 1);
    const payload = serializeParagraphsForClipboard(copied);
    const parsed = parseParagraphsFromClipboard(payload);

    expect(parsed).toBeDefined();

    const edited = updateParagraphText(model, 1, "Edited source paragraph");
    const pasted = pasteParagraphs(edited, 2, parsed ?? []);

    expect(pasted.nodes).toHaveLength(4);
    expect(pasted.nodes[2].children[0].text).toContain("First paragraph");
    expect(pasted.nodes[3].children[0].text).toContain("Second paragraph");
  });

  it("preserves mixed run styles when updating table cell text", () => {
    const model: DocModel = {
      nodes: [
        {
          type: "table",
          rows: [
            {
              type: "table-row",
              cells: [
                {
                  type: "table-cell",
                  nodes: [
                    {
                      type: "paragraph",
                      children: [
                        { type: "text", text: "Name:", style: { bold: true } },
                        {
                          type: "text",
                          text: " Click here.",
                          style: { italic: true },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      metadata: {
        sourceParts: 1,
        warnings: [],
        headerSections: [],
        footerSections: [],
        paragraphStyles: [],
        defaultParagraphStyleId: "Normal",
      },
    };

    const edited = updateTableCellText(model, 0, 0, 0, "Name: Andrew");
    const table = edited.nodes[0];
    expect(table.type).toBe("table");

    const runs = table.rows[0].cells[0].nodes[0].children;
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({
      type: "text",
      text: "Name:",
      style: { bold: true },
    });
    expect(runs[1]).toMatchObject({
      type: "text",
      text: " Andrew",
      style: { italic: true },
    });
  });

  it("updates the targeted paragraph inside a table cell", () => {
    const model: DocModel = {
      nodes: [
        {
          type: "table",
          rows: [
            {
              type: "table-row",
              cells: [
                {
                  type: "table-cell",
                  nodes: [
                    {
                      type: "paragraph",
                      children: [
                        {
                          type: "text",
                          text: "Top line",
                          style: { bold: true },
                        },
                      ],
                    },
                    {
                      type: "paragraph",
                      children: [
                        {
                          type: "text",
                          text: "Second:",
                          style: { italic: true },
                        },
                        {
                          type: "text",
                          text: " value",
                          style: { underline: true },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      metadata: {
        sourceParts: 1,
        warnings: [],
        headerSections: [],
        footerSections: [],
        paragraphStyles: [],
        defaultParagraphStyleId: "Normal",
      },
    };

    const edited = updateTableCellParagraphText(
      model,
      0,
      0,
      0,
      1,
      "Second: updated"
    );
    const table = edited.nodes[0];
    expect(table.type).toBe("table");
    if (table.type !== "table") {
      return;
    }

    const paragraphs = table.rows[0].cells[0].nodes;
    expect(paragraphs[0].children[0]).toMatchObject({
      type: "text",
      text: "Top line",
      style: { bold: true },
    });
    expect(paragraphs[1].children[0]).toMatchObject({
      type: "text",
      text: "Second:",
      style: { italic: true },
    });
    expect(paragraphs[1].children[1]).toMatchObject({
      type: "text",
      text: " updated",
      style: { underline: true },
    });
  });

  it("preserves inline images when updating paragraph text around them", () => {
    const model: DocModel = {
      nodes: [
        {
          type: "paragraph",
          children: [
            { type: "text", text: "Before " },
            {
              type: "image",
              src: "data:image/png;base64,abc",
              widthPx: 64,
              heightPx: 64,
              sourceXml: "<w:r><w:drawing/></w:r>",
              crop: { leftFraction: 0.1, rightFraction: 0.2 },
              cssFilter: "grayscale(1)",
              cssOpacity: 0.75,
            },
            { type: "text", text: " after" },
          ],
        },
      ],
      metadata: {
        sourceParts: 1,
        warnings: [],
        headerSections: [],
        footerSections: [],
        paragraphStyles: [],
        defaultParagraphStyleId: "Normal",
      },
    };

    const edited = updateParagraphText(model, 0, "Before inserted after");
    const paragraph = edited.nodes[0];
    expect(paragraph.type).toBe("paragraph");
    if (paragraph.type !== "paragraph") {
      return;
    }

    expect(paragraph.children).toHaveLength(3);
    expect(paragraph.children[0]).toMatchObject({
      type: "text",
      text: "Before inserted",
    });
    expect(paragraph.children[1]).toMatchObject({
      type: "image",
      widthPx: 64,
      heightPx: 64,
      sourceXml: "<w:r><w:drawing/></w:r>",
      crop: { leftFraction: 0.1, rightFraction: 0.2 },
      cssFilter: "grayscale(1)",
      cssOpacity: 0.75,
    });
    expect(paragraph.children[2]).toMatchObject({
      type: "text",
      text: " after",
    });
  });

  it("shares unchanged image data and field settings across text edits", () => {
    const model = sampleModel();
    const imageParagraph: ParagraphNode = {
      type: "paragraph",
      style: { spacing: { afterTwips: 120 } },
      children: [
        { type: "text", text: "Before " },
        {
          type: "image",
          data: new Uint8Array([1, 2, 3]),
          floating: { wrapType: "square", xPx: 20 },
        },
        { type: "text", text: "after" },
      ],
    };
    const fieldParagraph: ParagraphNode = {
      type: "paragraph",
      children: [
        {
          type: "form-field",
          fieldType: "dropdown",
          value: "One",
          options: [{ displayText: "One", value: "One" }],
          widget: { name: "Choice" },
        },
        { type: "text", text: " text" },
      ],
    };
    model.nodes = [imageParagraph, fieldParagraph];
    const snapshot = cloneDocModel(model);
    const editedImage = updateParagraphText(model, 0, "Before more after");
    const edited = updateParagraphText(editedImage, 1, "One text updated");
    expect((edited.nodes[0] as ParagraphNode).children[1]).toBe(
      imageParagraph.children[1]
    );
    expect((edited.nodes[1] as ParagraphNode).children[0]).toBe(
      fieldParagraph.children[0]
    );
    expect(model).toEqual(snapshot);

    const formatted = setParagraphHeading(edited, 0, 2);
    expect(
      (edited.nodes[0] as ParagraphNode).style?.headingLevel
    ).toBeUndefined();
    expect((formatted.nodes[0] as ParagraphNode).style?.headingLevel).toBe(2);
    expect(model).toEqual(snapshot);
  });

  it("updates all table-cell paragraphs without duplicating text into the first paragraph", () => {
    const model: DocModel = {
      nodes: [
        {
          type: "table",
          rows: [
            {
              type: "table-row",
              cells: [
                {
                  type: "table-cell",
                  nodes: [
                    {
                      type: "paragraph",
                      children: [
                        {
                          type: "text",
                          text: "Phone: 123",
                          style: { bold: true },
                        },
                      ],
                    },
                    {
                      type: "paragraph",
                      children: [
                        {
                          type: "text",
                          text: "Email: old@example.com",
                          style: { italic: true },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      metadata: {
        sourceParts: 1,
        warnings: [],
        headerSections: [],
        footerSections: [],
        paragraphStyles: [],
        defaultParagraphStyleId: "Normal",
      },
    };

    const edited = updateTableCellText(
      model,
      0,
      0,
      0,
      "Phone: 123\nEmail: new@example.com"
    );
    const table = edited.nodes[0];
    expect(table.type).toBe("table");
    if (table.type !== "table") {
      return;
    }

    const paragraphs = table.rows[0].cells[0].nodes;
    expect(paragraphs[0].type).toBe("paragraph");
    expect(paragraphs[1].type).toBe("paragraph");
    if (
      paragraphs[0].type !== "paragraph" ||
      paragraphs[1].type !== "paragraph"
    ) {
      return;
    }

    expect(paragraphs[0].children[0]).toMatchObject({
      type: "text",
      text: "Phone: 123",
      style: { bold: true },
    });
    expect(paragraphs[1].children[0]).toMatchObject({
      type: "text",
      text: "Email: new@example.com",
      style: { italic: true },
    });
  });

  it("preserves trailing empty table-cell paragraphs created by enter", () => {
    const model: DocModel = {
      nodes: [
        {
          type: "table",
          rows: [
            {
              type: "table-row",
              cells: [
                {
                  type: "table-cell",
                  nodes: [
                    {
                      type: "paragraph",
                      children: [{ type: "text", text: "Line 1" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      metadata: {
        sourceParts: 1,
        warnings: [],
        headerSections: [],
        footerSections: [],
        paragraphStyles: [],
        defaultParagraphStyleId: "Normal",
      },
    };

    const edited = updateTableCellText(model, 0, 0, 0, "Line 1\n\n");
    const table = edited.nodes[0];
    expect(table.type).toBe("table");
    if (table.type !== "table") {
      return;
    }

    const paragraphs = table.rows[0].cells[0].nodes;
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0].type).toBe("paragraph");
    expect(paragraphs[1].type).toBe("paragraph");
    expect(paragraphs[2].type).toBe("paragraph");
    if (
      paragraphs[0].type !== "paragraph" ||
      paragraphs[1].type !== "paragraph" ||
      paragraphs[2].type !== "paragraph"
    ) {
      return;
    }

    expect(paragraphs[0].children[0]).toMatchObject({
      type: "text",
      text: "Line 1",
    });
    expect(paragraphs[1].children[0]).toMatchObject({ type: "text", text: "" });
    expect(paragraphs[2].children[0]).toMatchObject({ type: "text", text: "" });
  });

  it("updates a nested table paragraph inside a table cell", () => {
    const model: DocModel = {
      nodes: [
        {
          type: "table",
          rows: [
            {
              type: "table-row",
              cells: [
                {
                  type: "table-cell",
                  nodes: [
                    {
                      type: "table",
                      rows: [
                        {
                          type: "table-row",
                          cells: [
                            {
                              type: "table-cell",
                              nodes: [
                                {
                                  type: "paragraph",
                                  children: [
                                    {
                                      type: "text",
                                      text: "Label",
                                      style: { bold: true },
                                    },
                                  ],
                                },
                              ],
                            },
                            {
                              type: "table-cell",
                              nodes: [
                                {
                                  type: "paragraph",
                                  children: [
                                    {
                                      type: "text",
                                      text: "Value:",
                                      style: { italic: true },
                                    },
                                    {
                                      type: "text",
                                      text: " old",
                                      style: { underline: true },
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      metadata: {
        sourceParts: 1,
        warnings: [],
        headerSections: [],
        footerSections: [],
        paragraphStyles: [],
        defaultParagraphStyleId: "Normal",
      },
    };

    const edited = updateTableCellParagraphTextRecursive(
      model,
      0,
      0,
      0,
      1,
      "Value: updated"
    );
    const table = edited.nodes[0];
    expect(table.type).toBe("table");
    if (table.type !== "table") {
      return;
    }

    const nestedTable = table.rows[0].cells[0].nodes[0];
    expect(nestedTable?.type).toBe("table");
    if (!nestedTable || nestedTable.type !== "table") {
      return;
    }

    const leftParagraph = nestedTable.rows[0].cells[0].nodes[0];
    const rightParagraph = nestedTable.rows[0].cells[1].nodes[0];
    expect(leftParagraph?.type).toBe("paragraph");
    expect(rightParagraph?.type).toBe("paragraph");
    if (
      !leftParagraph ||
      leftParagraph.type !== "paragraph" ||
      !rightParagraph ||
      rightParagraph.type !== "paragraph"
    ) {
      return;
    }

    expect(leftParagraph.children[0]).toMatchObject({
      type: "text",
      text: "Label",
      style: { bold: true },
    });
    expect(rightParagraph.children[0]).toMatchObject({
      type: "text",
      text: "Value:",
      style: { italic: true },
    });
    expect(rightParagraph.children[1]).toMatchObject({
      type: "text",
      text: " updated",
      style: { underline: true },
    });
  });

  it.each(["cell", "paragraph", "recursive"] as const)(
    "copies only the edited table cell for %s text updates",
    (method) => {
      const model = sampleModel();
      const target: ParagraphNode = {
        type: "paragraph",
        children: [{ type: "text", text: "Cell text" }],
      };
      const adjacent: ParagraphNode = {
        type: "paragraph",
        children: [{ type: "image", data: new Uint8Array([1, 2, 3]) }],
      };
      const table = {
        type: "table" as const,
        rows: [
          {
            type: "table-row" as const,
            cells: [
              { type: "table-cell" as const, nodes: [target] },
              { type: "table-cell" as const, nodes: [adjacent] },
            ],
          },
          {
            type: "table-row" as const,
            cells: [{ type: "table-cell" as const, nodes: [adjacent] }],
          },
        ],
      };
      model.nodes.push(table);
      const before = cloneDocModel(model);
      const edited =
        method === "cell"
          ? updateTableCellText(model, 2, 0, 0, "Cell text updated")
          : (method === "paragraph"
              ? updateTableCellParagraphText
              : updateTableCellParagraphTextRecursive)(
              model,
              2,
              0,
              0,
              0,
              "Cell text updated"
            );
      const editedTable = edited.nodes[2];
      expect(editedTable.type).toBe("table");
      if (editedTable.type !== "table") return;
      expect(edited.nodes[0]).toBe(model.nodes[0]);
      expect(edited.metadata).toBe(model.metadata);
      expect(editedTable.rows[1]).toBe(table.rows[1]);
      expect(editedTable.rows[0].cells[1]).toBe(table.rows[0].cells[1]);
      expect(editedTable.rows[0].cells[0].nodes[0]).toMatchObject({
        children: [{ type: "text", text: "Cell text updated" }],
      });
      expect(model).toEqual(before);
    }
  );

  it("copies a nested table path and preserves ancestor source patches", () => {
    const sourceXml = "<w:p><w:r><w:t>Nested text</w:t></w:r></w:p>";
    const target: ParagraphNode = {
      type: "paragraph",
      sourceXml,
      children: [{ type: "text", text: "Nested text" }],
    };
    const nested = {
      type: "table" as const,
      sourceXml: `<w:tbl>${sourceXml}</w:tbl>`,
      rows: [
        {
          type: "table-row" as const,
          cells: [{ type: "table-cell" as const, nodes: [target] }],
        },
      ],
    };
    const table = {
      type: "table" as const,
      sourceXml: `<w:tbl>${nested.sourceXml}</w:tbl>`,
      rows: [
        {
          type: "table-row" as const,
          cells: [{ type: "table-cell" as const, nodes: [nested] }],
        },
      ],
    };
    const model = sampleModel();
    model.nodes.push(table);
    const before = cloneDocModel(model);
    const edited = updateTableCellParagraphTextRecursive(
      model,
      2,
      0,
      0,
      0,
      "Nested text updated"
    );
    const outer = edited.nodes[2];
    if (outer.type !== "table") throw new Error("Expected a table");
    const inner = outer.rows[0].cells[0].nodes[0];
    if (inner.type !== "table") throw new Error("Expected a nested table");
    expect(outer).not.toBe(table);
    expect(inner).not.toBe(nested);
    expect(outer.sourceXml).toBe(table.sourceXml);
    expect(inner.sourceXml).toBe(nested.sourceXml);
    expect(outer.sourceTextPatches).toHaveLength(1);
    expect(inner.sourceTextPatches).toHaveLength(1);
    expect(inner.rows[0].cells[0].nodes[0]).toMatchObject({
      children: [{ type: "text", text: "Nested text updated" }],
    });
    expect(edited.nodes[0]).toBe(model.nodes[0]);
    expect(model).toEqual(before);
  });

  it("preserves checkbox form fields when updating paragraph text", () => {
    const model: DocModel = {
      nodes: [
        {
          type: "paragraph",
          children: [
            {
              type: "form-field",
              fieldType: "checkbox",
              checked: false,
              checkedSymbol: "☒",
              uncheckedSymbol: "☐",
            },
            { type: "text", text: " Female", style: { bold: true } },
          ],
        },
      ],
      metadata: {
        sourceParts: 1,
        warnings: [],
        headerSections: [],
        footerSections: [],
        paragraphStyles: [],
        defaultParagraphStyleId: "Normal",
      },
    };

    const edited = updateParagraphText(model, 0, "☐ Female updated");
    const paragraph = edited.nodes[0];
    expect(paragraph.type).toBe("paragraph");
    if (paragraph.type !== "paragraph") {
      return;
    }

    expect(paragraph.children[0]).toMatchObject({
      type: "form-field",
      fieldType: "checkbox",
      checked: false,
    });
    expect(paragraph.children[1]).toMatchObject({
      type: "text",
      text: " Female updated",
      style: { bold: true },
    });
  });

  it("preserves checkbox form fields when updating table cell text", () => {
    const model: DocModel = {
      nodes: [
        {
          type: "table",
          rows: [
            {
              type: "table-row",
              cells: [
                {
                  type: "table-cell",
                  nodes: [
                    {
                      type: "paragraph",
                      children: [
                        {
                          type: "form-field",
                          fieldType: "checkbox",
                          checked: false,
                          checkedSymbol: "☒",
                          uncheckedSymbol: "☐",
                        },
                        { type: "text", text: " Yes", style: { italic: true } },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      metadata: {
        sourceParts: 1,
        warnings: [],
        headerSections: [],
        footerSections: [],
        paragraphStyles: [],
        defaultParagraphStyleId: "Normal",
      },
    };

    const edited = updateTableCellText(model, 0, 0, 0, "☐ Yes (selected)");
    const table = edited.nodes[0];
    expect(table.type).toBe("table");
    if (table.type !== "table") {
      return;
    }

    const children = table.rows[0].cells[0].nodes[0].children;
    expect(children[0]).toMatchObject({
      type: "form-field",
      fieldType: "checkbox",
      checked: false,
    });
    expect(children[1]).toMatchObject({
      type: "text",
      text: " Yes (selected)",
      style: { italic: true },
    });
  });

  it("preserves floating image anchors when splitting paragraph children", () => {
    const paragraph: DocModel["nodes"][number] = {
      type: "paragraph",
      children: [
        {
          type: "image",
          alt: "forward.png",
          widthPx: 102,
          heightPx: 102,
          floating: {
            wrapType: "square",
            horizontalRelativeTo: "margin",
            verticalRelativeTo: "margin",
            xPx: 139,
            yPx: 381,
          },
        },
        {
          type: "text",
          text: "Generally, it is not possible ",
          style: { italic: true },
        },
        {
          type: "text",
          text: "to edit around this arrow.",
          style: { bold: true },
        },
      ],
    };

    if (paragraph.type !== "paragraph") {
      return;
    }

    const split = splitParagraphChildrenAtTextOffsets(
      paragraph,
      "Generally, it is not possible to edit around this arrow.",
      29,
      29
    );

    expect(split.beforeChildren[0]).toMatchObject({
      type: "image",
      alt: "forward.png",
    });
    expect(
      split.beforeChildren.some(
        (child) => child.type === "text" && child.text.includes("Generally")
      )
    ).toBe(true);
    expect(
      split.afterChildren.some(
        (child) =>
          child.type === "text" &&
          child.text.includes("to edit around this arrow.")
      )
    ).toBe(true);
  });
});
