import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildDocModel } from "@extend-ai/react-docx-doc-model";
import { parseDocx } from "@extend-ai/react-docx-ooxml-core";
import { resolveDocumentLayout } from "../../packages/react-viewer/src/section-layout";
import { resolveFooterPaginationReservePx } from "../../packages/react-viewer/src/editor";

const FEA705_PATH =
  "/Users/andrewluo/Documents/DOCX testing/2026-03-24_15-53-14/fea705f1e6ba06444b5a9fea02a938f41644d3cf93ef3a63716ecb39a9fd15a2.docx";

describe("fea705 footer reserve", () => {
  it.skipIf(!existsSync(FEA705_PATH))(
    "parses bordered footer paragraphs and reserves enough body clearance",
    async () => {
      const buffer = await readFile(FEA705_PATH);
      const pkg = await parseDocx(
        buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        )
      );
      const model = await buildDocModel(pkg);
      const layout = resolveDocumentLayout(model);
      const footerSections = model.metadata.footerSections ?? [];
      const footerNodes = footerSections[0]?.nodes ?? [];
      const borderedFooterParagraphCount = footerNodes.filter(
        (node) =>
          node.type === "paragraph" &&
          node.style?.borders?.top !== undefined
      ).length;
      const footerReservePx = resolveFooterPaginationReservePx(
        footerSections,
        layout
      );

      expect(footerNodes.length).toBeGreaterThanOrEqual(5);
      expect(borderedFooterParagraphCount).toBeGreaterThanOrEqual(5);
      expect(layout.footerDistancePx).toBeGreaterThan(0);

      // Tall bordered multi-paragraph footers need a meaningful body reserve.
      // The rendered footer is ~105px tall and sits footerDistancePx (47px)
      // above the page bottom, so it intrudes ~56px past the 96px bottom
      // margin into the body box. The reserve must cover that intrusion.
      expect(footerReservePx).toBeGreaterThan(55);
    }
  );
});
