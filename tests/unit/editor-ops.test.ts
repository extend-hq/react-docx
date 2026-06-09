import { describe, expect, it } from "vitest";
import type { DocModel } from "@extend-ai/react-docx-doc-model";
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
  updateTableCellText
} from "@extend-ai/react-docx-editor-ops";

function sampleModel(): DocModel {
  return {
    nodes: [
      {
        type: "paragraph",
        children: [{ type: "text", text: "First paragraph" }]
      },
      {
        type: "paragraph",
        children: [{ type: "text", text: "Second paragraph" }]
      }
    ],
    metadata: {
      sourceParts: 1,
      warnings: [],
      headerSections: [],
      footerSections: [],
      paragraphStyles: [],
      defaultParagraphStyleId: "Normal"
    }
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
                        { type: "text", text: " Click here.", style: { italic: true } }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ],
      metadata: {
        sourceParts: 1,
        warnings: [],
        headerSections: [],
        footerSections: [],
        paragraphStyles: [],
        defaultParagraphStyleId: "Normal"
      }
    };

    const edited = updateTableCellText(model, 0, 0, 0, "Name: Andrew");
    const table = edited.nodes[0];
    expect(table.type).toBe("table");

    const runs = table.rows[0].cells[0].nodes[0].children;
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ type: "text", text: "Name:", style: { bold: true } });
    expect(runs[1]).toMatchObject({ type: "text", text: " Andrew", style: { italic: true } });
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
                      children: [{ type: "text", text: "Top line", style: { bold: true } }]
                    },
                    {
                      type: "paragraph",
                      children: [
                        { type: "text", text: "Second:", style: { italic: true } },
                        { type: "text", text: " value", style: { underline: true } }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ],
      metadata: {
        sourceParts: 1,
        warnings: [],
        headerSections: [],
        footerSections: [],
        paragraphStyles: [],
        defaultParagraphStyleId: "Normal"
      }
    };

    const edited = updateTableCellParagraphText(model, 0, 0, 0, 1, "Second: updated");
    const table = edited.nodes[0];
    expect(table.type).toBe("table");
    if (table.type !== "table") {
      return;
    }

    const paragraphs = table.rows[0].cells[0].nodes;
    expect(paragraphs[0].children[0]).toMatchObject({ type: "text", text: "Top line", style: { bold: true } });
    expect(paragraphs[1].children[0]).toMatchObject({
      type: "text",
      text: "Second:",
      style: { italic: true }
    });
    expect(paragraphs[1].children[1]).toMatchObject({
      type: "text",
      text: " updated",
      style: { underline: true }
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
              heightPx: 64
            },
            { type: "text", text: " after" }
          ]
        }
      ],
      metadata: {
        sourceParts: 1,
        warnings: [],
        headerSections: [],
        footerSections: [],
        paragraphStyles: [],
        defaultParagraphStyleId: "Normal"
      }
    };

    const edited = updateParagraphText(model, 0, "Before inserted after");
    const paragraph = edited.nodes[0];
    expect(paragraph.type).toBe("paragraph");
    if (paragraph.type !== "paragraph") {
      return;
    }

    expect(paragraph.children).toHaveLength(3);
    expect(paragraph.children[0]).toMatchObject({ type: "text", text: "Before inserted" });
    expect(paragraph.children[1]).toMatchObject({ type: "image", widthPx: 64, heightPx: 64 });
    expect(paragraph.children[2]).toMatchObject({ type: "text", text: " after" });
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
                      children: [{ type: "text", text: "Phone: 123", style: { bold: true } }]
                    },
                    {
                      type: "paragraph",
                      children: [{ type: "text", text: "Email: old@example.com", style: { italic: true } }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ],
      metadata: {
        sourceParts: 1,
        warnings: [],
        headerSections: [],
        footerSections: [],
        paragraphStyles: [],
        defaultParagraphStyleId: "Normal"
      }
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
    if (paragraphs[0].type !== "paragraph" || paragraphs[1].type !== "paragraph") {
      return;
    }

    expect(paragraphs[0].children[0]).toMatchObject({
      type: "text",
      text: "Phone: 123",
      style: { bold: true }
    });
    expect(paragraphs[1].children[0]).toMatchObject({
      type: "text",
      text: "Email: new@example.com",
      style: { italic: true }
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
                      children: [{ type: "text", text: "Line 1" }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ],
      metadata: {
        sourceParts: 1,
        warnings: [],
        headerSections: [],
        footerSections: [],
        paragraphStyles: [],
        defaultParagraphStyleId: "Normal"
      }
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
    if (paragraphs[0].type !== "paragraph" || paragraphs[1].type !== "paragraph" || paragraphs[2].type !== "paragraph") {
      return;
    }

    expect(paragraphs[0].children[0]).toMatchObject({ type: "text", text: "Line 1" });
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
                                  children: [{ type: "text", text: "Label", style: { bold: true } }]
                                }
                              ]
                            },
                            {
                              type: "table-cell",
                              nodes: [
                                {
                                  type: "paragraph",
                                  children: [
                                    { type: "text", text: "Value:", style: { italic: true } },
                                    { type: "text", text: " old", style: { underline: true } }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ],
      metadata: {
        sourceParts: 1,
        warnings: [],
        headerSections: [],
        footerSections: [],
        paragraphStyles: [],
        defaultParagraphStyleId: "Normal"
      }
    };

    const edited = updateTableCellParagraphTextRecursive(model, 0, 0, 0, 1, "Value: updated");
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
    if (!leftParagraph || leftParagraph.type !== "paragraph" || !rightParagraph || rightParagraph.type !== "paragraph") {
      return;
    }

    expect(leftParagraph.children[0]).toMatchObject({
      type: "text",
      text: "Label",
      style: { bold: true }
    });
    expect(rightParagraph.children[0]).toMatchObject({
      type: "text",
      text: "Value:",
      style: { italic: true }
    });
    expect(rightParagraph.children[1]).toMatchObject({
      type: "text",
      text: " updated",
      style: { underline: true }
    });
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
              uncheckedSymbol: "☐"
            },
            { type: "text", text: " Female", style: { bold: true } }
          ]
        }
      ],
      metadata: {
        sourceParts: 1,
        warnings: [],
        headerSections: [],
        footerSections: [],
        paragraphStyles: [],
        defaultParagraphStyleId: "Normal"
      }
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
      checked: false
    });
    expect(paragraph.children[1]).toMatchObject({
      type: "text",
      text: " Female updated",
      style: { bold: true }
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
                          uncheckedSymbol: "☐"
                        },
                        { type: "text", text: " Yes", style: { italic: true } }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ],
      metadata: {
        sourceParts: 1,
        warnings: [],
        headerSections: [],
        footerSections: [],
        paragraphStyles: [],
        defaultParagraphStyleId: "Normal"
      }
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
      checked: false
    });
    expect(children[1]).toMatchObject({
      type: "text",
      text: " Yes (selected)",
      style: { italic: true }
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
            yPx: 381
          }
        },
        { type: "text", text: "Generally, it is not possible ", style: { italic: true } },
        { type: "text", text: "to edit around this arrow.", style: { bold: true } }
      ]
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
      alt: "forward.png"
    });
    expect(split.beforeChildren.some((child) => child.type === "text" && child.text.includes("Generally"))).toBe(true);
    expect(split.afterChildren.some((child) => child.type === "text" && child.text.includes("to edit around this arrow."))).toBe(true);
  });
});

describe("editor-ops structural sharing (copy-on-write)", () => {
  function multiParagraphModel(): DocModel {
    return {
      nodes: [
        { type: "paragraph", children: [{ type: "text", text: "Alpha" }] },
        { type: "paragraph", children: [{ type: "text", text: "Bravo" }] },
        { type: "paragraph", children: [{ type: "text", text: "Charlie" }] }
      ],
      metadata: {
        sourceParts: 1,
        warnings: [],
        headerSections: [],
        footerSections: [],
        paragraphStyles: [{ id: "Normal", name: "Normal" }],
        defaultParagraphStyleId: "Normal"
      }
    };
  }

  it("shares untouched sibling nodes and metadata by reference across a single-paragraph edit", () => {
    const model = multiParagraphModel();
    const next = updateParagraphText(model, 1, "Bravo edited");

    // The edited node is a fresh object with the new content...
    expect(next).not.toBe(model);
    expect(next.nodes[1]).not.toBe(model.nodes[1]);
    expect(next.nodes[1].children[0]).toMatchObject({ text: "Bravo edited" });

    // ...while untouched siblings and metadata keep their identity (structural sharing).
    expect(next.nodes[0]).toBe(model.nodes[0]);
    expect(next.nodes[2]).toBe(model.nodes[2]);
    expect(next.metadata).toBe(model.metadata);
  });

  it("never mutates the input model (prior history snapshots stay intact)", () => {
    const model = multiParagraphModel();
    const before = model.nodes[1];

    toggleRunStyleFlag(model, 1, 0, "bold");
    setParagraphHeading(model, 1, 1);
    updateParagraphText(model, 1, "totally different");

    // The original node object is unchanged by any op.
    expect(model.nodes[1]).toBe(before);
    expect(model.nodes[1].children[0]).toMatchObject({ text: "Bravo" });
    expect(model.nodes[1].children[0].style?.bold).toBeUndefined();
    expect(model.nodes[1].style?.headingLevel).toBeUndefined();
  });

  it("shares siblings across structural splice ops (insert via paste / remove)", () => {
    const model = multiParagraphModel();
    const pasted = pasteParagraphs(model, 1, [
      { type: "paragraph", children: [{ type: "text", text: "Inserted" }] }
    ]);

    // Existing nodes keep identity; only the array shape changes.
    expect(pasted.nodes).toHaveLength(4);
    expect(pasted.nodes[0]).toBe(model.nodes[0]);
    expect(pasted.nodes[2]).toBe(model.nodes[1]);
    expect(pasted.nodes[3]).toBe(model.nodes[2]);
    expect(pasted.metadata).toBe(model.metadata);
    // Input array is untouched.
    expect(model.nodes).toHaveLength(3);
  });

  it("shares unedited body nodes when editing a table cell", () => {
    const model: DocModel = {
      nodes: [
        { type: "paragraph", children: [{ type: "text", text: "Above table" }] },
        {
          type: "table",
          rows: [
            {
              type: "table-row",
              cells: [
                { type: "table-cell", nodes: [{ type: "paragraph", children: [{ type: "text", text: "Cell" }] }] }
              ]
            }
          ]
        }
      ],
      metadata: {
        sourceParts: 1,
        warnings: [],
        headerSections: [],
        footerSections: [],
        paragraphStyles: [],
        defaultParagraphStyleId: "Normal"
      }
    };

    const next = updateTableCellText(model, 1, 0, 0, "Edited cell");

    // The sibling paragraph above the table and metadata are shared; the table is cloned.
    expect(next.nodes[0]).toBe(model.nodes[0]);
    expect(next.metadata).toBe(model.metadata);
    expect(next.nodes[1]).not.toBe(model.nodes[1]);
    const editedTable = next.nodes[1];
    const originalTable = model.nodes[1];
    if (editedTable.type !== "table" || originalTable.type !== "table") {
      throw new Error("expected table nodes");
    }
    expect(editedTable.rows[0].cells[0].nodes[0].children[0]).toMatchObject({ text: "Edited cell" });
    // Original table is unmutated.
    expect(originalTable.rows[0].cells[0].nodes[0].children[0]).toMatchObject({ text: "Cell" });
  });
});
