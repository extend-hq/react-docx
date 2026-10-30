import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DocModel, ParagraphNode } from "../../packages/doc-model/src";
import { bodyAutomaticParagraphSpacingPx } from "../../packages/react-viewer/src/paragraph-auto-spacing";
import { DocxEditorViewer, estimateRenderedPageSegmentHeightPx, useDocxEditor } from "../../packages/react-viewer/src/editor";

const paragraph = (id: string, automatic = true): ParagraphNode => ({
  type: "paragraph", blockId: id,
  style: { spacing: { beforeTwips: 100, afterTwips: 100, beforeAutoSpacing: automatic, afterAutoSpacing: automatic, lineRule: "exact", lineTwips: 240 } },
  children: [{ type: "text", text: id, style: { fontFamily: "Arial", fontSizePt: 12 } }],
});
const model = (nodes: ParagraphNode[], mode = 15): DocModel => ({ nodes, metadata: {
  sourceParts: 1, warnings: [], headerSections: [], footerSections: [], paragraphStyles: [],
  compatibility: { compatibilityMode: mode },
  numberingDefinitions: { abstracts: [], instances: [{ numId: 1, abstractNumId: 3 }, { numId: 2, abstractNumId: 3 }, { numId: 4, abstractNumId: 7 }] },
} });
function View({ doc }: { doc: DocModel }): React.JSX.Element {
  const editor = useDocxEditor({ starterModel: doc });
  return React.createElement(DocxEditorViewer, { editor, mode: "read-only", deferInitialPaginationPaint: false });
}
function margins(doc: DocModel): Map<string, number[]> {
  const html = renderToStaticMarkup(React.createElement(View, { doc }));
  const values = new Map<string, number[]>();
  for (const match of html.matchAll(/<[^>]+data-docx-source-id="([^"]+)"[^>]*style="([^"]*)"/g)) {
    const top = match[2].match(/margin-top:([^;]+)/), bottom = match[2].match(/margin-bottom:([^;]+)/);
    if (top && bottom) values.set(match[1], [parseFloat(top[1]), parseFloat(bottom[1])]);
  }
  return values;
}

describe("automatic body paragraph spacing", () => {
  it("retains numeric height for a minimal model without metadata or automatic flags", () => {
    const p = paragraph("text", false);
    delete p.style!.spacing!.beforeAutoSpacing;
    delete p.style!.spacing!.afterAutoSpacing;
    const minimal = { nodes: [p] } as DocModel;
    expect(bodyAutomaticParagraphSpacingPx(minimal, 0, p, "before")).toBeUndefined();
    expect(estimateRenderedPageSegmentHeightPx(p, { nodeIndex: 0 }, minimal, 600)).toBeCloseTo(16 + 200 / 15);
  });

  it.each([12, 15])("retains ordinary numeric fallback in compatibility mode %s without changing source formatting", mode => {
    const lead = paragraph("lead", false), p = paragraph("text");
    lead.style!.spacing!.beforeTwips = 0; lead.style!.spacing!.afterTwips = 0;
    const d = model([lead, p], mode), before = JSON.stringify(d);
    expect(bodyAutomaticParagraphSpacingPx(d, 1, p, "before")).toBeUndefined();
    const result = margins(d).get("text")!;
    expect(result).toEqual([100 / 15, 100 / 15]);
    expect(estimateRenderedPageSegmentHeightPx(p, { nodeIndex: 1 }, d, 600)).toBeCloseTo(16 + 200 / 15);
    expect(JSON.stringify(d)).toBe(before);
  });

  it.each([12, 15])("suppresses only automatic before-spacing at the story start in compatibility mode %s", mode => {
    const p = paragraph("first"), d = model([p], mode);
    expect(margins(d).get("first")).toEqual([0, 100 / 15]);
    expect(estimateRenderedPageSegmentHeightPx(p, { nodeIndex: 0 }, d, 600)).toBeCloseTo(16 + 100 / 15);
    p.style!.spacing!.beforeAutoSpacing = false;
    expect(margins(d).get("first")).toEqual([100 / 15, 100 / 15]);
    expect(estimateRenderedPageSegmentHeightPx(p, { nodeIndex: 0 }, d, 600)).toBeCloseTo(16 + 200 / 15);
  });

  it("suppresses automatic list interiors across levels and instances of the same abstract list", () => {
    const a = paragraph("first"), b = paragraph("last");
    a.style!.numbering = { numId: 1, ilvl: 0 }; b.style!.numbering = { numId: 2, ilvl: 1 };
    const d = model([a, b]), result = margins(d);
    expect(result.get("first")).toEqual([0, 0]);
    expect(result.get("last")).toEqual([0, 100 / 15]);
    expect(estimateRenderedPageSegmentHeightPx(a, { nodeIndex: 0 }, d, 600)).toBe(16);
  });

  it("retains explicit numeric spacing on a list edge whose automatic flag is false", () => {
    const a = paragraph("first"), b = paragraph("last", false);
    a.style!.numbering = { numId: 1, ilvl: 0 }; b.style!.numbering = { numId: 1, ilvl: 0 };
    const result = margins(model([a, b]));
    expect(result.get("first")).toEqual([0, 0]); expect(result.get("last")).toEqual([100 / 15, 100 / 15]);
  });

  it("keeps contextual suppression and explicit page-start overrides", () => {
    const a = paragraph("first"), b = paragraph("last");
    for (const p of [a, b]) { p.style!.styleId = "Shared"; p.style!.contextualSpacing = true; }
    const d = model([a, b]), result = margins(d);
    expect(result.get("first")).toEqual([0, 0]); expect(result.get("last")).toEqual([0, 100 / 15]);
    expect(estimateRenderedPageSegmentHeightPx(b, { nodeIndex: 1, paragraphBeforeSpacingPx: 0 }, d, 600)).toBeCloseTo(16 + 100 / 15);
  });

  it("preserves fallback for fixed HTML spacing, other compatibility modes, foreign stories and unqualified list boundaries", () => {
    const p = paragraph("first"), d = model([p]);
    d.metadata.compatibility!.useFixedHtmlParagraphSpacing = true;
    expect(bodyAutomaticParagraphSpacingPx(d, 0, p, "before")).toBeUndefined();
    expect(margins(d).get("first")).toEqual([100 / 15, 100 / 15]);
    expect(bodyAutomaticParagraphSpacingPx(model([p], 11), 0, p, "before")).toBeUndefined();
    expect(bodyAutomaticParagraphSpacingPx(model([]), 0, p, "before")).toBeUndefined();
    const q = paragraph("last"); p.style!.numbering = { numId: 1, ilvl: 0 }; q.style!.numbering = { numId: 4, ilvl: 0 };
    expect(bodyAutomaticParagraphSpacingPx(model([p, q]), 0, p, "after")).toBeUndefined();
  });
});
