import type { DocModel, ParagraphNode } from "@extend-ai/react-docx-doc-model";
import type { DocxTextRangeLocation } from "./editor";

export function copyModelForParagraphEdits(
  model: DocModel,
  locations: DocxTextRangeLocation[]
): DocModel {
  const copies = new Map<object, object>();
  const copy = <T extends object>(value: T): T => {
    const existing = copies.get(value);
    if (existing) return existing as T;
    const next = (Array.isArray(value) ? [...value] : { ...value }) as T;
    copies.set(value, next);
    copies.set(next, next);
    return next;
  };
  const next = { ...model, nodes: [...model.nodes] };
  for (const location of locations) {
    if (location.kind === "paragraph") {
      const node = next.nodes[location.nodeIndex];
      if (node?.type !== "paragraph") continue;
      const paragraph = copy(node);
      paragraph.children = copy(paragraph.children);
      next.nodes[location.nodeIndex] = paragraph;
    } else {
      const node = next.nodes[location.tableIndex];
      if (node?.type !== "table") continue;
      const row = node.rows[location.rowIndex];
      const cell = row?.cells[location.cellIndex];
      if (!cell) continue;
      let paragraphIndex = -1;
      const contentIndex = cell.nodes.findIndex((content) => {
        if (content.type === "paragraph") paragraphIndex++;
        return (
          content.type === "paragraph" &&
          paragraphIndex === location.paragraphIndex
        );
      });
      const paragraph = cell.nodes[contentIndex];
      if (paragraph?.type !== "paragraph") continue;
      const nextTable = copy(node);
      next.nodes[location.tableIndex] = nextTable;
      nextTable.rows = copy(node.rows);
      const nextRow = copy(row);
      nextTable.rows[location.rowIndex] = nextRow;
      nextRow.cells = copy(row.cells);
      const nextCell = copy(cell);
      nextRow.cells[location.cellIndex] = nextCell;
      nextCell.nodes = copy(cell.nodes);
      const nextParagraph = copy(paragraph);
      nextCell.nodes[contentIndex] = nextParagraph;
      nextParagraph.children = copy(paragraph.children);
    }
  }
  return next;
}

export function imageDropPositionAtTextOffset(
  paragraph: ParagraphNode,
  textOffset: number,
  options?: {
    countInlineImages?: boolean;
    fieldText?: (
      field: Extract<ParagraphNode["children"][number], { type: "form-field" }>
    ) => string;
  }
): { childIndex: number; textOffset?: number } {
  let remaining = Math.max(0, Math.round(textOffset));
  for (
    let childIndex = 0;
    childIndex < paragraph.children.length;
    childIndex++
  ) {
    const child = paragraph.children[childIndex];
    const length =
      child.type === "image"
        ? !child.floating && options?.countInlineImages
          ? 1
          : 0
        : child.type === "text"
        ? child.text.length
        : (options?.fieldText?.(child) ?? child.value ?? "").length;
    if (remaining <= length && length > 0) {
      if (remaining === 0) return { childIndex };
      if (remaining === length) return { childIndex: childIndex + 1 };
      return child.type === "text"
        ? { childIndex, textOffset: remaining }
        : { childIndex: childIndex + 1 };
    }
    remaining -= length;
  }
  return { childIndex: paragraph.children.length };
}

export function insertImageAtDropPosition(
  paragraph: ParagraphNode,
  image: Extract<ParagraphNode["children"][number], { type: "image" }>,
  childIndex: number,
  textOffset?: number
): number {
  const index = Math.max(0, Math.min(childIndex, paragraph.children.length));
  const child = paragraph.children[index];
  if (child?.type === "text" && textOffset !== undefined) {
    const offset = Math.max(0, Math.min(textOffset, child.text.length));
    const before = child.text.slice(0, offset);
    const after = child.text.slice(offset);
    const children: ParagraphNode["children"] = [];
    if (before) children.push({ ...child, text: before });
    children.push(image);
    if (after) children.push({ ...child, text: after });
    paragraph.children.splice(index, 1, ...children);
    return index + (before ? 1 : 0);
  }
  paragraph.children.splice(index, 0, image);
  return index;
}
