import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DocModel, ParagraphNode } from "../../packages/doc-model/src";
import { DocxEditorViewer, useDocxEditor } from "../../packages/react-viewer/src/editor";

function paragraph(
  id: string,
  contextualSpacing?: boolean,
  styleId = "Shared",
  text = "Text"
): ParagraphNode {
  return {
    type: "paragraph",
    blockId: id,
    style: {
      styleId,
      contextualSpacing,
      spacing: { beforeTwips: 120, afterTwips: 160, lineTwips: 240, lineRule: "exact" },
    },
    children: [{ type: "text", text, style: { fontFamily: "Arial", fontSizePt: 11 } }],
  };
}

function Viewer({ nodes }: { nodes: ParagraphNode[] }): React.JSX.Element {
  const model: DocModel = {
    nodes,
    metadata: { sourceParts: 1, warnings: [], headerSections: [], footerSections: [], paragraphStyles: [] },
  };
  const editor = useDocxEditor({ starterModel: model });
  return React.createElement(DocxEditorViewer, {
    editor,
    mode: "read-only",
    deferInitialPaginationPaint: false,
  });
}

function margins(nodes: ParagraphNode[]): Map<string, [number, number]> {
  const html = renderToStaticMarkup(React.createElement(Viewer, { nodes }));
  const result = new Map<string, [number, number]>();
  for (const match of html.matchAll(/<[^>]+data-docx-source-id="([^"]+)"[^>]*style="([^"]*)"/g)) {
    const style = Object.fromEntries(match[2].split(";").filter(Boolean).map((entry) => {
      const colon = entry.indexOf(":");
      return [entry.slice(0, colon), entry.slice(colon + 1)];
    }));
    if (style["margin-top"] !== undefined && style["margin-bottom"] !== undefined) {
      result.set(match[1], [Number.parseFloat(style["margin-top"]), Number.parseFloat(style["margin-bottom"])]);
    }
  }
  return result;
}

describe("whole-paragraph contextual spacing", () => {
  it("removes matching-style interior margins while retaining outer edges and empty paragraphs", () => {
    const result = margins([
      paragraph("first", true),
      paragraph("empty", true, "Shared", ""),
      paragraph("last", true),
    ]);
    expect(result.get("first")).toEqual([8, 0]);
    expect(result.get("empty")).toEqual([0, 0]);
    expect(result.get("last")).toEqual([0, 160 / 15]);
  });

  it.each([false, undefined])("retains numeric margins when contextual spacing is %s", (enabled) => {
    const result = margins([paragraph("first", enabled), paragraph("last", enabled)]);
    expect(result.get("first")).toEqual([8, 160 / 15]);
    expect(result.get("last")).toEqual([8, 160 / 15]);
  });

  it("retains numeric margins across different paragraph styles", () => {
    const result = margins([paragraph("first", true), paragraph("last", true, "Other")]);
    expect(result.get("first")).toEqual([8, 160 / 15]);
    expect(result.get("last")).toEqual([8, 160 / 15]);
  });
});
