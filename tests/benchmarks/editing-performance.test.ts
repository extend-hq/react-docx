import { describe, expect, it } from "vitest";
import type { DocModel, ParagraphNode } from "@extend-ai/react-docx-doc-model";
import {
  applyRunStyle,
  copyParagraphs,
  pasteParagraphs,
  replaceText,
  splitParagraphChildrenAtTextOffsets,
  toggleRunStyleFlag,
  updateParagraphText,
} from "@extend-ai/react-docx-editor-ops";
import { layoutDocument } from "@extend-ai/react-docx-layout-engine";

// Mirrors createLargeModel in tests/unit/performance.test.ts so the editing
// benchmark exercises the same shaped documents (mixed heading/align/run styles).
function createLargeModel(paragraphCount: number): DocModel {
  return {
    nodes: Array.from({ length: paragraphCount }, (_, index) => ({
      type: "paragraph" as const,
      style: {
        headingLevel: index % 25 === 0 ? 2 : undefined,
        align: index % 8 === 0 ? "justify" : "left",
      },
      children: [
        {
          type: "text" as const,
          text: `Paragraph ${
            index + 1
          }: The quick brown fox jumps over the lazy dog ${index}.`,
          style: {
            bold: index % 10 === 0,
            italic: index % 6 === 0,
            underline: index % 14 === 0,
            highlight: index % 7 === 0 ? "yellow" : undefined,
            fontSizePt: index % 25 === 0 ? 14 : 11,
          },
        },
      ],
    })),
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

// A document shaped much more like a real imported .docx: multi-run paragraphs
// plus a populated metadata block (paragraph styles, numbering definitions, and
// header/footer sections). cloneDocModel re-clones ALL of this on every edit, so
// the simple createLargeModel above (empty metadata, single run) badly understates
// the per-keystroke clone cost a real document pays. This helper makes that cost
// visible to the benchmark.
function createRealisticModel(paragraphCount: number): DocModel {
  const headingNames = [
    "Heading1",
    "Heading2",
    "Heading3",
    "Title",
    "Subtitle",
  ];
  const paragraphStyles = Array.from({ length: 30 }, (_, index) => ({
    id: `Style${index}`,
    name:
      index < headingNames.length
        ? headingNames[index]
        : `Custom Style ${index}`,
    basedOnId: "Normal",
    align: (index % 4 === 0 ? "justify" : "left") as const,
    headingLevel: index < 3 ? ((index + 1) as 1 | 2 | 3) : undefined,
    runStyle: {
      bold: index % 3 === 0,
      italic: index % 5 === 0,
      fontFamily: index % 2 === 0 ? "Calibri" : "Times New Roman",
      fontSizePt: 11 + (index % 6),
      color: index % 4 === 0 ? "1F4E79" : undefined,
    },
  }));

  const numberingDefinitions = {
    abstracts: Array.from({ length: 12 }, (_, abstractIndex) => ({
      abstractNumId: abstractIndex,
      levels: Array.from({ length: 9 }, (_, levelIndex) => ({
        ilvl: levelIndex,
        start: 1,
        format: levelIndex % 2 === 0 ? "decimal" : "lowerLetter",
        text: `%${levelIndex + 1}.`,
        suffix: "tab" as const,
        runStyle: { fontFamily: "Calibri", fontSizePt: 11 },
      })),
    })),
    instances: Array.from({ length: 12 }, (_, instanceIndex) => ({
      numId: instanceIndex + 1,
      abstractNumId: instanceIndex,
    })),
  };

  const sectionNodes = (label: string): ParagraphNode[] =>
    Array.from({ length: 6 }, (_, index) => ({
      type: "paragraph" as const,
      children: [
        {
          type: "text" as const,
          text: `${label} line ${index + 1} — `,
          style: { bold: true },
        },
        {
          type: "text" as const,
          text: `page header/footer content ${index}.`,
          style: { italic: index % 2 === 0 },
        },
      ],
    }));

  const headerSections = ["default", "first", "even"].map((referenceType) => ({
    partName: `/word/header-${referenceType}.xml`,
    referenceType,
    nodes: sectionNodes(`Header ${referenceType}`),
  }));
  const footerSections = ["default", "first", "even"].map((referenceType) => ({
    partName: `/word/footer-${referenceType}.xml`,
    referenceType,
    nodes: sectionNodes(`Footer ${referenceType}`),
  }));

  return {
    nodes: Array.from({ length: paragraphCount }, (_, index) => ({
      type: "paragraph" as const,
      style: {
        headingLevel: index % 25 === 0 ? 2 : undefined,
        align: index % 8 === 0 ? "justify" : "left",
      },
      // Real paragraphs are split into several runs (mixed formatting), so the
      // clone walks multiple run/style objects per paragraph, not one.
      children: [
        {
          type: "text" as const,
          text: `Paragraph ${index + 1}: The quick brown fox `,
          style: {
            bold: index % 10 === 0,
            fontSizePt: 11,
            fontFamily: "Calibri",
          },
        },
        {
          type: "text" as const,
          text: `jumps over `,
          style: { italic: true, color: "C00000", fontSizePt: 11 },
        },
        {
          type: "text" as const,
          text: `the lazy dog ${index}.`,
          style: {
            underline: index % 4 === 0,
            highlight: index % 7 === 0 ? "yellow" : undefined,
            fontSizePt: 11,
          },
        },
      ],
    })),
    metadata: {
      sourceParts: 1,
      warnings: [],
      headerSections,
      footerSections,
      paragraphStyles,
      numberingDefinitions,
      defaultParagraphStyleId: "Normal",
    },
  } as DocModel;
}

// A couple of small paragraphs to paste, simulating a clipboard insert.
function clipboardParagraphs(): ParagraphNode[] {
  return [
    {
      type: "paragraph",
      children: [{ type: "text", text: "Pasted line one with some content." }],
    },
    {
      type: "paragraph",
      children: [{ type: "text", text: "Pasted line two with more content." }],
    },
    {
      type: "paragraph",
      children: [{ type: "text", text: "Pasted line three closing it out." }],
    },
  ];
}

function getParagraphText(model: DocModel, index: number): string {
  const node = model.nodes[index];
  if (!node || node.type !== "paragraph") {
    return "";
  }
  return node.children
    .map((child) => (child.type === "text" ? child.text : ""))
    .join("");
}

const WARMUP = 5;
const ITERATIONS = 25;
const DOC_SIZES = [500, 2000, 5000] as const;

// Median is more stable than mean against GC/JIT spikes on CI.
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Runs `run` WARMUP times to settle JIT/caches, then ITERATIONS timed runs.
// Returns median/mean ms so the harness logs a stable number.
function bench(run: () => unknown): { medianMs: number; meanMs: number } {
  for (let i = 0; i < WARMUP; i += 1) {
    run();
  }
  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i += 1) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  return { medianMs: median(samples), meanMs: mean(samples) };
}

function logBaseline(
  scenario: string,
  size: number,
  result: { medianMs: number; meanMs: number }
): void {
  // Mirrors the "performance-baseline ..." line in performance.test.ts so the
  // numbers are grep-able across both benchmarks.
  console.info(
    `editing-baseline scenario=${scenario} paragraphs=${size} median=${result.medianMs.toFixed(
      3
    )}ms mean=${result.meanMs.toFixed(3)}ms iterations=${ITERATIONS}`
  );
}

describe("editing-performance", () => {
  // Generous global ceiling: this harness is for measurement, not gating.
  const MAX_OP_MS = 2000;
  const MAX_OP_PLUS_LAYOUT_MS = 6000;

  it("(a) single-character insert via updateParagraphText (typing)", () => {
    for (const size of DOC_SIZES) {
      const model = createLargeModel(size);
      const targetIndex = Math.floor(size / 2);
      const baseText = getParagraphText(model, targetIndex);
      let counter = 0;

      const result = bench(() => {
        // Simulate a single character appended at the caret each keystroke.
        const nextText = `${baseText}${String.fromCharCode(
          97 + (counter % 26)
        )}`;
        counter += 1;
        return updateParagraphText(model, targetIndex, nextText);
      });

      logBaseline("insert-char", size, result);
      expect(result.medianMs).toBeLessThan(MAX_OP_MS);
    }
  });

  it("(b) splitParagraphChildrenAtTextOffsets (Enter key)", () => {
    for (const size of DOC_SIZES) {
      const model = createLargeModel(size);
      const targetIndex = Math.floor(size / 2);
      const node = model.nodes[targetIndex];
      const paragraph: ParagraphNode =
        node && node.type === "paragraph"
          ? node
          : { type: "paragraph", children: [{ type: "text", text: "" }] };
      const text = getParagraphText(model, targetIndex);
      const offset = Math.floor(text.length / 2);

      const result = bench(() => {
        // Split (the run-level work the Enter handler performs) followed by the
        // model splice that materializes the two resulting paragraphs.
        const split = splitParagraphChildrenAtTextOffsets(
          paragraph,
          text,
          offset,
          offset
        );
        const before: ParagraphNode = {
          ...paragraph,
          children: split.beforeChildren,
        };
        const after: ParagraphNode = {
          ...paragraph,
          children: split.afterChildren,
        };
        const nextNodes = model.nodes.slice();
        nextNodes.splice(targetIndex, 1, before, after);
        return { ...model, nodes: nextNodes };
      });

      logBaseline("split-paragraph", size, result);
      expect(result.medianMs).toBeLessThan(MAX_OP_MS);
    }
  });

  it("(c) toggle/apply run style across a paragraph (bold a selection)", () => {
    for (const size of DOC_SIZES) {
      const model = createLargeModel(size);
      const targetIndex = Math.floor(size / 2);
      let toggled = false;

      const result = bench(() => {
        // toggleRunStyleFlag + applyRunStyle: the two ops a bold-the-selection
        // command issues on the run(s) under selection.
        toggled = !toggled;
        const bolded = toggleRunStyleFlag(model, targetIndex, 0, "bold");
        return applyRunStyle(bolded, targetIndex, 0, { italic: toggled });
      });

      logBaseline("toggle-run-style", size, result);
      expect(result.medianMs).toBeLessThan(MAX_OP_MS);
    }
  });

  it("(d) replaceText across the document (find/replace)", () => {
    for (const size of DOC_SIZES) {
      const model = createLargeModel(size);

      const result = bench(() => {
        // Document-wide find/replace touches every text run.
        return replaceText(model, /quick brown fox/g, "swift red fox");
      });

      logBaseline("replace-text", size, result);
      expect(result.medianMs).toBeLessThan(MAX_OP_MS);
    }
  });

  it("(e) pasteParagraphs of a few paragraphs", () => {
    const payload = clipboardParagraphs();
    for (const size of DOC_SIZES) {
      const model = createLargeModel(size);
      const insertIndex = Math.floor(size / 2);

      const result = bench(() => {
        return pasteParagraphs(model, insertIndex, payload);
      });

      logBaseline("paste-paragraphs", size, result);
      expect(result.medianMs).toBeLessThan(MAX_OP_MS);
    }
  });

  it("(e2) copy + paste round trip", () => {
    for (const size of DOC_SIZES) {
      const model = createLargeModel(size);
      const insertIndex = Math.floor(size / 2);

      const result = bench(() => {
        const copied = copyParagraphs(model, 0, 2);
        return pasteParagraphs(model, insertIndex, copied);
      });

      logBaseline("copy-paste", size, result);
      expect(result.medianMs).toBeLessThan(MAX_OP_MS);
    }
  });

  it("(f) full edit cycle: updateParagraphText then layoutDocument (op-only vs op+layout)", () => {
    for (const size of DOC_SIZES) {
      const model = createLargeModel(size);
      const targetIndex = Math.floor(size / 2);
      const baseText = getParagraphText(model, targetIndex);
      let opCounter = 0;
      let cycleCounter = 0;

      // Op-only: the cost editor-ops pays for the transform itself.
      const opOnly = bench(() => {
        const nextText = `${baseText}${String.fromCharCode(
          97 + (opCounter % 26)
        )}`;
        opCounter += 1;
        return updateParagraphText(model, targetIndex, nextText);
      });

      // Op + layout: the cost a keystroke pays if it triggers a full relayout.
      const opPlusLayout = bench(() => {
        const nextText = `${baseText}${String.fromCharCode(
          97 + (cycleCounter % 26)
        )}`;
        cycleCounter += 1;
        const edited = updateParagraphText(model, targetIndex, nextText);
        return layoutDocument(edited);
      });

      logBaseline("full-cycle-op-only", size, opOnly);
      logBaseline("full-cycle-op+layout", size, opPlusLayout);

      const layoutOnlyApprox = Math.max(
        0,
        opPlusLayout.medianMs - opOnly.medianMs
      );
      console.info(
        `editing-baseline scenario=full-cycle-layout-delta paragraphs=${size} median=${layoutOnlyApprox.toFixed(
          3
        )}ms (op+layout - op-only)`
      );

      expect(opOnly.medianMs).toBeLessThan(MAX_OP_MS);
      expect(opPlusLayout.medianMs).toBeLessThan(MAX_OP_PLUS_LAYOUT_MS);
    }
  });

  // The realistic-model scenarios are the ones that reveal the cloneDocModel cost:
  // a single keystroke today re-clones the whole node tree AND all metadata
  // (30 paragraph styles, 12x9 numbering levels, 6 header/footer sections).
  it("(g) single-character insert on a realistic document (multi-run + metadata)", () => {
    for (const size of DOC_SIZES) {
      const model = createRealisticModel(size);
      const targetIndex = Math.floor(size / 2);
      const baseText = getParagraphText(model, targetIndex);
      let counter = 0;

      const result = bench(() => {
        const nextText = `${baseText}${String.fromCharCode(
          97 + (counter % 26)
        )}`;
        counter += 1;
        return updateParagraphText(model, targetIndex, nextText);
      });

      logBaseline("insert-char-realistic", size, result);
      expect(result.medianMs).toBeLessThan(MAX_OP_MS);
    }
  });

  it("(h) realistic toggle/apply run style + paste", () => {
    const payload = clipboardParagraphs();
    for (const size of DOC_SIZES) {
      const model = createRealisticModel(size);
      const targetIndex = Math.floor(size / 2);
      const insertIndex = Math.floor(size / 3);
      let toggled = false;

      const styleResult = bench(() => {
        toggled = !toggled;
        const bolded = toggleRunStyleFlag(model, targetIndex, 0, "bold");
        return applyRunStyle(bolded, targetIndex, 1, { italic: toggled });
      });
      logBaseline("toggle-run-style-realistic", size, styleResult);

      const pasteResult = bench(() =>
        pasteParagraphs(model, insertIndex, payload)
      );
      logBaseline("paste-paragraphs-realistic", size, pasteResult);

      expect(styleResult.medianMs).toBeLessThan(MAX_OP_MS);
      expect(pasteResult.medianMs).toBeLessThan(MAX_OP_MS);
    }
  });
});
