import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "@extend-ai/react-docx-doc-model";
import { parseDocx } from "@extend-ai/react-docx-ooxml-core";
import { resolveDocumentLayout } from "../../packages/react-viewer/src/section-layout";
import {
  buildDocumentPageNodeSegments,
  buildParagraphNumberingLabels,
  estimateParagraphLineHeightPx,
  estimateTableRowHeightsPx,
  paragraphLineCountWithinWidth,
  resolveFooterPaginationReservePx,
  resolveHeaderPaginationReservePx,
} from "../../packages/react-viewer/src/editor";
import {
  paragraphAfterSpacingPx,
  paragraphBeforeSpacingPx,
} from "../../packages/layout-core/src/pagination";

const DOC_PATH =
  "/Users/andrewluo/Documents/DOCX testing/2026-03-24_16-06-44/95c3ea3a962ca8f18cd9d43ae6515a609d9f39a19d70e21eae4ebce8c0bc7604.docx";

type ModelNode = Awaited<ReturnType<typeof buildDocModel>>["nodes"][number];

function nodeSummary(node: ModelNode): string {
  if (node.type === "paragraph") {
    const text = (node.children ?? [])
      .filter((child) => child.type === "text")
      .map((child) => ("text" in child ? child.text ?? "" : ""))
      .join("")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    const images = (node.children ?? []).filter(
      (child) => child.type === "image"
    );
    const imageInfo = images
      .map((image) => {
        if (image.type !== "image") {
          return "";
        }
        const floating = image.floating
          ? `float(v=${image.floating.verticalRelativeTo ?? "?"},behind=${image.floating.behindDocument === true ? 1 : 0},wrap=${image.floating.wrapType ?? "?"})`
          : "inline";
        return `[img ${Math.round(image.widthPx ?? 0)}x${Math.round(image.heightPx ?? 0)} ${floating}]`;
      })
      .join("");
    return `p: ${text || "(empty)"} ${imageInfo}`;
  }
  if (node.type === "table") {
    return `table (${node.rows.length} rows)`;
  }
  return node.type;
}

describe("95c3ea pagination fidelity debug (cover page overflow)", () => {
  it.skipIf(!existsSync(DOC_PATH))("prints pagination diagnostics", async () => {
    const buffer = await readFile(DOC_PATH);
    const pkg = await parseDocx(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    );
    const model = await buildDocModel(pkg);
    const layout = resolveDocumentLayout(model);
    const pageContentWidthPx =
      layout.pageWidthPx - layout.marginsPx.left - layout.marginsPx.right;
    const headerReservePx = resolveHeaderPaginationReservePx(
      model.metadata.headerSections ?? [],
      layout
    );
    const footerReservePx = resolveFooterPaginationReservePx(
      model.metadata.footerSections ?? [],
      layout
    );
    const pageContentHeightPx = Math.max(
      120,
      layout.pageHeightPx -
        layout.marginsPx.top -
        layout.marginsPx.bottom -
        headerReservePx -
        footerReservePx
    );

    console.log("=== layout ===");
    console.log({
      pageWidthPx: layout.pageWidthPx,
      pageHeightPx: layout.pageHeightPx,
      marginsPx: layout.marginsPx,
      docGridLinePitchPx: layout.docGridLinePitchPx,
      headerReservePx,
      footerReservePx,
      pageContentWidthPx,
      pageContentHeightPx,
      nodeCount: model.nodes.length,
      storedDocumentPageCount: model.metadata.documentPageCount,
      sectionCount: (model.metadata.sections ?? []).length,
    });

    const numberingLabels = buildParagraphNumberingLabels(model);
    const estimatedNodeHeightPx = (node: ModelNode, nodeIndex: number): number => {
      if (node.type === "paragraph") {
        const label = numberingLabels.get(`p:${nodeIndex}`);
        const lines = paragraphLineCountWithinWidth(
          node,
          pageContentWidthPx,
          model.metadata.numberingDefinitions,
          label
        );
        const lineHeightPx = estimateParagraphLineHeightPx(
          node,
          layout.docGridLinePitchPx
        );
        return (
          paragraphBeforeSpacingPx(node) +
          lines * lineHeightPx +
          paragraphAfterSpacingPx(node)
        );
      }
      if (node.type === "table") {
        return estimateTableRowHeightsPx(
          node,
          pageContentWidthPx,
          model.metadata.numberingDefinitions,
          layout.docGridLinePitchPx,
          pageContentHeightPx
        ).reduce((sum, heightPx) => sum + heightPx, 0);
      }
      return 0;
    };

    const pagesViewer = buildDocumentPageNodeSegments(
      model,
      pageContentHeightPx,
      pageContentWidthPx,
      model.metadata.numberingDefinitions,
      [
        {
          startNodeIndex: 0,
          pageContentWidthPx,
          pageContentHeightPx,
          pageContentHeightMultiplier: 1,
          docGridLinePitchPx: layout.docGridLinePitchPx,
        },
      ],
      {
        allowParagraphLineSplitting: true,
        suppressSpacingBeforeAfterPageBreak:
          model.metadata.compatibility?.suppressSpacingBeforeAfterPageBreak ===
          true,
        preferLastRenderedParagraphStartBreaks: true,
        strictLastRenderedParagraphStartBreaks: false,
      }
    );

    console.log(`=== engine pages: ${pagesViewer.length} pages ===`);
    pagesViewer.slice(0, 4).forEach((pageSegments, pageIndex) => {
      let pageEstimatedHeightPx = 0;
      console.log(`-- page ${pageIndex + 1} (${pageSegments.length} segments)`);
      pageSegments.forEach((segment) => {
        const node = model.nodes[segment.nodeIndex];
        const heightPx = node
          ? estimatedNodeHeightPx(node, segment.nodeIndex)
          : 0;
        const lineRange = segment.paragraphLineRange
          ? ` lines[${segment.paragraphLineRange.startLineIndex}..${segment.paragraphLineRange.endLineIndex}]`
          : "";
        pageEstimatedHeightPx += heightPx;
        console.log(
          `   node ${segment.nodeIndex}${lineRange} h~${Math.round(heightPx)}px ${node ? nodeSummary(node) : "(missing)"}`
        );
      });
      console.log(
        `   page ${pageIndex + 1} total estimated full-node height ~${Math.round(pageEstimatedHeightPx)}px (budget ${Math.round(pageContentHeightPx)}px)`
      );
    });

    console.log("=== first 40 nodes ===");
    model.nodes.slice(0, 40).forEach((node, nodeIndex) => {
      console.log(
        `node ${nodeIndex}: h~${Math.round(estimatedNodeHeightPx(node, nodeIndex))}px ${nodeSummary(node)}`
      );
    });

    expect(pagesViewer.length).toBeGreaterThan(0);

    // Word/LibreOffice render the cover (behindDoc full-page art + mark-sized
    // spacer paragraphs + centered title) as page 1, with page 2 spanning
    // "INDIVIDUAL EMPLOYMENT AGREEMENT - PERMANENT" through "Kaimahi Initials".
    // The cover content must consume its real flow height — previously the
    // estimator zero-costed the spacers, cramming ~70 nodes onto page 1 where
    // the renderer clipped them.
    expect(nodeSummary(model.nodes[34])).toContain(
      "INDIVIDUAL EMPLOYMENT AGREEMENT - PERMANENT"
    );
    expect(nodeSummary(model.nodes[72])).toContain("Kaimahi Initials");
    const page2 = pagesViewer[1] ?? [];
    // The agreement heading (node 34) must lead page 2 visually: the cover
    // stays on page 1 and only invisible spacer paragraphs may precede the
    // heading on page 2 (cover-block estimates drift by a spacer or two).
    const headingSegmentIndex = page2.findIndex(
      (segment) => segment.nodeIndex === 34
    );
    expect(headingSegmentIndex).toBeGreaterThanOrEqual(0);
    page2.slice(0, headingSegmentIndex).forEach((segment) => {
      const node = model.nodes[segment.nodeIndex];
      expect(
        node?.type === "paragraph" ? nodeSummary(node) : "non-paragraph"
      ).toContain("(empty)");
    });
    // ...and "Kaimahi Initials" (node 72) closes page 2 alongside it.
    expect(page2.some((segment) => segment.nodeIndex === 72)).toBe(true);

    // No page's content may exceed the page budget by more than estimate
    // noise — a crammed page means the renderer clips content off the bottom.
    pagesViewer.forEach((pageSegments, pageIndex) => {
      const pageEstimatePx = pageSegments.reduce((sum, segment) => {
        const node = model.nodes[segment.nodeIndex];
        if (!node) {
          return sum;
        }
        if (segment.paragraphLineRange) {
          const lineCount = Math.max(
            1,
            segment.paragraphLineRange.endLineIndex -
              segment.paragraphLineRange.startLineIndex
          );
          return sum + lineCount * segment.paragraphLineRange.lineHeightPx;
        }
        return sum + estimatedNodeHeightPx(node, segment.nodeIndex);
      }, 0);
      expect(
        pageEstimatePx,
        `page ${pageIndex + 1} over-crammed (${Math.round(pageEstimatePx)}px)`
      ).toBeLessThanOrEqual(pageContentHeightPx + 60);
    });
  });
});
