import type {
  DocModel,
  DocNode,
  NumberingLevelDefinition,
  ParagraphNode,
  TextStyle,
} from "@extend-ai/react-docx-doc-model";
import { segmentTextByDocxScriptFont } from "./script-fonts";

interface DocumentFontRequest {
  font: string;
  characters: Set<string>;
}

function fontFamilyCss(family: string): string {
  const trimmed = family.trim();
  if (trimmed.includes(",")) return trimmed;
  const normalized = trimmed.replace(/^['"]+|['"]+$/g, "");
  if (/^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(normalized)) {
    return normalized;
  }
  return `"${normalized.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\n\r\f]/g, " ")}"`;
}

function collectDocumentFontRequests(model: DocModel): DocumentFontRequest[] {
  const requests = new Map<string, DocumentFontRequest>();
  const seenNodes = new Set<DocNode>();
  const usedNumberingIds = new Set<number>();
  const stylesById = new Map(
    model.metadata.paragraphStyles.map((style) => [style.id, style])
  );
  const defaultStyle = (
    stylesById.get(model.metadata.defaultParagraphStyleId ?? "") ??
    model.metadata.paragraphStyles.find((style) => style.isDefault)
  )?.runStyle;

  const collectText = (text: string, style?: TextStyle): void => {
    for (const segment of segmentTextByDocxScriptFont(text || "M", style)) {
      const family = fontFamilyCss(segment.fontFamily ?? "Times New Roman");
      const font = `${style?.italic ? "italic" : "normal"} ${style?.bold ? "700" : "400"} 16px ${family}`;
      const key = font.toLowerCase();
      let request = requests.get(key);
      if (!request) {
        // Include the strut probe and generated numeric text before layout.
        request = { font, characters: new Set(" M0123456789") };
        requests.set(key, request);
      }
      for (const character of segment.text) {
        request.characters.add(character);
        if (style?.allCaps || style?.smallCaps) {
          for (const upper of character.toUpperCase()) {
            request.characters.add(upper);
          }
        }
      }
    }
  };

  const collectParagraph = (paragraph: ParagraphNode): void => {
    const paragraphStyle = stylesById.get(paragraph.style?.styleId ?? "")?.runStyle;
    const inheritedStyle = paragraphStyle ?? defaultStyle;
    const firstRunStyle = paragraph.children.find((child) => child.type === "text")?.style;
    collectText("M", paragraph.paragraphMarkStyle ?? firstRunStyle ?? inheritedStyle);
    if (paragraph.style?.numbering) {
      usedNumberingIds.add(paragraph.style.numbering.numId);
    }
    for (const child of paragraph.children) {
      if (child.type === "image") {
        visitNodes(child.contentNodes ?? []);
        if (child.textBoxText && !child.contentNodes?.length) {
          collectText(child.textBoxText, inheritedStyle);
        }
        continue;
      }
      const style = inheritedStyle
        ? { ...inheritedStyle, ...child.style }
        : child.style;
      if (child.type === "text") {
        collectText(child.text, style);
        continue;
      }
      if (child.fieldType === "checkbox") {
        collectText(child.checkedSymbol ?? "☒", style);
        collectText(child.uncheckedSymbol ?? "☐", style);
      } else {
        collectText(child.value ?? child.widget?.text?.defaultText ?? child.placeholder ?? "", style);
        for (const option of child.options ?? []) {
          collectText(option.displayText, style);
        }
      }
    }
  };

  const visitNodes = (nodes: readonly DocNode[]): void => {
    for (const node of nodes) {
      if (seenNodes.has(node)) continue;
      seenNodes.add(node);
      if (node.type === "paragraph") {
        collectParagraph(node);
      } else {
        for (const row of node.rows) {
          for (const cell of row.cells) visitNodes(cell.nodes);
        }
      }
    }
  };

  visitNodes(model.nodes);
  for (const section of [model.metadata, ...(model.metadata.sections ?? [])]) {
    for (const part of [...section.headerSections, ...section.footerSections]) {
      visitNodes(part.nodes);
    }
  }
  for (const note of [
    ...(model.metadata.footnotes ?? []),
    ...(model.metadata.endnotes ?? []),
    ...(model.metadata.comments ?? []),
  ]) {
    if (note.nodes?.length) visitNodes(note.nodes);
    else if (note.text) collectText(note.text, defaultStyle);
  }

  const collectNumbering = (level: NumberingLevelDefinition): void => {
    collectText(
      `${level.text ?? ""}0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ`,
      level.bulletFontFamily
        ? { ...defaultStyle, ...level.runStyle, fontFamily: level.bulletFontFamily }
        : { ...defaultStyle, ...level.runStyle }
    );
  };
  const numbering = model.metadata.numberingDefinitions;
  if (numbering && usedNumberingIds.size > 0) {
    const usedAbstractIds = new Set<number>();
    for (const instance of numbering.instances) {
      if (!usedNumberingIds.has(instance.numId)) continue;
      usedAbstractIds.add(instance.abstractNumId);
      instance.levelOverrides?.forEach(collectNumbering);
    }
    for (const abstract of numbering.abstracts) {
      if (usedAbstractIds.has(abstract.abstractNumId)) {
        abstract.levels.forEach(collectNumbering);
      }
    }
  }
  return [...requests.values()];
}

export async function awaitDocumentFonts(model: DocModel): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const fonts = document.fonts;
  if (fonts.size !== 0 && typeof fonts.load === "function") {
    await Promise.allSettled(
      collectDocumentFontRequests(model).map(async ({ font, characters }) => {
        // Distinct code points cover unicode-range faces without retaining runs.
        await fonts.load(font, [...characters].join(""));
      })
    );
  }
  try {
    await fonts.ready;
  } catch {
    // Continue with the available fallback when a face cannot be loaded.
  }
}
