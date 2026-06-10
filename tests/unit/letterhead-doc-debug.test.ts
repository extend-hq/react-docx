import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "@extend-ai/react-docx-doc-model";
import { parseDocx } from "@extend-ai/react-docx-ooxml-core";
import { resolveDocumentLayout } from "../../packages/react-viewer/src/section-layout";
import {
  buildDocumentPageNodeSegments,
  paragraphLetterheadColumnGroupAtSegmentOffset,
  paragraphLetterheadFloatSideAtNodeIndex,
} from "../../packages/react-viewer/src/editor";

const DOC_PATH =
  "/Users/andrewluo/Downloads/62ad6b6dddfeac380ced43027982ca11e5950e2061a04b2398fbc5eef8248383.docx";

function summarizeParagraphText(
  paragraph: import("@extend-ai/react-docx-doc-model").ParagraphNode
): string {
  return paragraph.children
    .filter((child) => child.type === "text")
    .map((child) => child.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

describe("letterhead doc debug", () => {
  it.skipIf(!existsSync(DOC_PATH))(
    "keeps Massachusetts letterhead rows on the first page",
    async () => {
      const buffer = await readFile(DOC_PATH);
      const pkg = await parseDocx(
        buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        )
      );
      const model = await buildDocModel(pkg);
      const layout = resolveDocumentLayout(model);
      const pageContentWidthPx =
        layout.pageWidthPx - layout.marginsPx.left - layout.marginsPx.right;
      const pageContentHeightPx = Math.max(
        120,
        layout.pageHeightPx -
          layout.marginsPx.top -
          layout.marginsPx.bottom
      );
      const pages = buildDocumentPageNodeSegments(
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
        { allowParagraphLineSplitting: true }
      );

      const firstPage = pages[0] ?? [];
      const firstPageTable0 = firstPage.find((segment) => segment.nodeIndex === 0);
      const letterheadGroup = paragraphLetterheadColumnGroupAtSegmentOffset(
        model.nodes,
        firstPage,
        firstPage.findIndex((segment) => segment.nodeIndex === 4)
      );
      const node0 = model.nodes[0];

      expect(node0?.type).toBe("paragraph");
      if (node0?.type === "paragraph") {
        const imageChild = node0.children.find((child) => child.type === "image");
        expect(imageChild?.type).toBe("image");
        if (imageChild?.type === "image") {
          expect((imageChild.widthPx ?? 0) > 0 || (imageChild.heightPx ?? 0) > 0).toBe(
            true
          );
        }
      }
      expect(firstPage.some((segment) => segment.nodeIndex === 4)).toBe(true);
      expect(firstPage.some((segment) => segment.nodeIndex === 22)).toBe(true);
      expect(letterheadGroup).toBeDefined();
      expect(letterheadGroup?.leftSegments.map((segment) => segment.nodeIndex)).toEqual(
        [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 22]
      );
      expect(letterheadGroup?.rightSegments.map((segment) => segment.nodeIndex)).toEqual(
        [14, 15, 16, 17, 18, 19, 20, 21]
      );
      const leftNameNode = model.nodes[letterheadGroup!.leftSegments[2]!.nodeIndex];
      const rightNameNode =
        model.nodes[letterheadGroup!.rightSegments[0]!.nodeIndex];
      expect(leftNameNode?.type).toBe("paragraph");
      expect(rightNameNode?.type).toBe("paragraph");
      if (leftNameNode?.type === "paragraph") {
        expect(summarizeParagraphText(leftNameNode)).toBe("MAURA T. HEALEY");
      }
      if (rightNameNode?.type === "paragraph") {
        expect(summarizeParagraphText(rightNameNode)).toBe("KATHLEEN E. WALSH");
      }
      expect(firstPageTable0).toBeDefined();
    }
  );
});
