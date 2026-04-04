import type { DocModel, ParagraphNode, TableCellContentNode, TableNode } from "@react-docx/doc-model";

const PAGE_BREAK_XML_PATTERN = /<w:br\b[^>]*w:type="page"[^>]*\/?>/i;
const PAGE_BREAK_BEFORE_XML_PATTERN = /<w:pageBreakBefore\b[^>]*\/?>/i;

export interface TableExplicitPageBreakInfo {
  startRowIndexes: number[];
  breakAfterTable: boolean;
}

const tableExplicitPageBreakInfoBySourceXml = new Map<string, TableExplicitPageBreakInfo>();

function isOnOffTagEnabled(tagXml: string | undefined): boolean {
  if (!tagXml) {
    return false;
  }

  const valueMatch = tagXml.match(/\bw:val="([^"]+)"/i)?.[1]?.trim().toLowerCase();
  if (!valueMatch) {
    return true;
  }

  return !["0", "false", "off", "no"].includes(valueMatch);
}

function paragraphHasExplicitPageBreak(paragraph: Pick<ParagraphNode, "sourceXml">): boolean {
  const sourceXml = paragraph.sourceXml ?? "";
  return sourceXml.length > 0 && PAGE_BREAK_XML_PATTERN.test(sourceXml);
}

function paragraphHasPageBreakBefore(paragraph: Pick<ParagraphNode, "sourceXml">): boolean {
  const sourceXml = paragraph.sourceXml ?? "";
  if (!sourceXml) {
    return false;
  }

  return isOnOffTagEnabled(sourceXml.match(PAGE_BREAK_BEFORE_XML_PATTERN)?.[0]);
}

function paragraphHasVisibleText(paragraph: ParagraphNode): boolean {
  return paragraph.children.some(
    (child) =>
      (child.type === "text" && child.text.trim().length > 0) ||
      (child.type === "form-field" && (child.value ?? "").trim().length > 0)
  );
}

function paragraphHasImage(paragraph: ParagraphNode): boolean {
  return paragraph.children.some((child) => child.type === "image");
}

function paragraphHasFormField(paragraph: ParagraphNode): boolean {
  return paragraph.children.some((child) => child.type === "form-field");
}

function paragraphIsOnlyExplicitPageBreak(paragraph: ParagraphNode): boolean {
  return (
    paragraphHasExplicitPageBreak(paragraph) &&
    !paragraphHasVisibleText(paragraph) &&
    !paragraphHasImage(paragraph) &&
    !paragraphHasFormField(paragraph)
  );
}

function tableCellDirectParagraphs(nodeContent: TableCellContentNode[]): ParagraphNode[] {
  return nodeContent.filter((entry): entry is ParagraphNode => entry.type === "paragraph");
}

function tableRowHasSubstantiveContentOutsideBreakOnlyParagraphs(row: TableNode["rows"][number]): boolean {
  return row.cells.some((cell) =>
    tableCellDirectParagraphs(cell.nodes).some((paragraph) => {
      if (paragraphIsOnlyExplicitPageBreak(paragraph)) {
        return false;
      }

      return (
        paragraphHasVisibleText(paragraph) ||
        paragraphHasImage(paragraph) ||
        paragraphHasFormField(paragraph) ||
        paragraphHasExplicitPageBreak(paragraph)
      );
    })
  );
}

function tableRowSubstantiveCellIndexes(row: TableNode["rows"][number]): number[] {
  const indexes: number[] = [];
  row.cells.forEach((cell, cellIndex) => {
    const substantive = tableCellDirectParagraphs(cell.nodes).some((paragraph) => {
      if (paragraphIsOnlyExplicitPageBreak(paragraph)) {
        return false;
      }

      return (
        paragraphHasVisibleText(paragraph) ||
        paragraphHasImage(paragraph) ||
        paragraphHasFormField(paragraph) ||
        paragraphHasExplicitPageBreak(paragraph)
      );
    });
    if (substantive) {
      indexes.push(cellIndex);
    }
  });
  return indexes;
}

function tableRowUsesTrailingSignatureCellBreakPattern(
  table: TableNode,
  row: TableNode["rows"][number]
): boolean {
  if (table.rows.length !== 1 || row.cells.length < 4) {
    return false;
  }

  const substantiveIndexes = tableRowSubstantiveCellIndexes(row);
  return substantiveIndexes.length === 1 && substantiveIndexes[0] >= row.cells.length - 1;
}

export function collectTableExplicitPageBreakInfo(table: TableNode): TableExplicitPageBreakInfo {
  const sourceXml = table.sourceXml ?? "";
  if (sourceXml) {
    const cached = tableExplicitPageBreakInfoBySourceXml.get(sourceXml);
    if (cached) {
      return cached;
    }
  }

  const startRowIndexes = new Set<number>();
  let breakAfterTable = false;

  table.rows.forEach((row, rowIndex) => {
    let rowBreakTarget: number | undefined;

    row.cells.forEach((cell) => {
      tableCellDirectParagraphs(cell.nodes).forEach((paragraph) => {
        if (!paragraphHasExplicitPageBreak(paragraph)) {
          return;
        }

        if (
          paragraphIsOnlyExplicitPageBreak(paragraph) &&
          rowIndex === 0 &&
          tableRowHasSubstantiveContentOutsideBreakOnlyParagraphs(row) &&
          !tableRowUsesTrailingSignatureCellBreakPattern(table, row)
        ) {
          return;
        }

        const breakTarget =
          paragraphIsOnlyExplicitPageBreak(paragraph) ? rowIndex : rowIndex + 1;
        if (rowBreakTarget === undefined || breakTarget < rowBreakTarget) {
          rowBreakTarget = breakTarget;
        }
      });
    });

    if (rowBreakTarget === undefined) {
      return;
    }

    if (rowBreakTarget >= table.rows.length) {
      breakAfterTable = true;
      return;
    }

    startRowIndexes.add(Math.max(0, rowBreakTarget));
  });

  const info: TableExplicitPageBreakInfo = {
    startRowIndexes: [...startRowIndexes].sort((left, right) => left - right),
    breakAfterTable
  };

  if (sourceXml) {
    tableExplicitPageBreakInfoBySourceXml.set(sourceXml, info);
  }

  return info;
}

export function collectTopLevelExplicitPageBreakStartNodeIndexes(
  nodes: DocModel["nodes"]
): Set<number> {
  const breaks = new Set<number>();

  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const node = nodes[nodeIndex];
    const hasNextNode = nodeIndex + 1 < nodes.length;

    if (node.type === "paragraph") {
      if (paragraphHasPageBreakBefore(node)) {
        breaks.add(nodeIndex);
      }

      if (hasNextNode && paragraphHasExplicitPageBreak(node)) {
        breaks.add(nodeIndex + 1);
      }
      continue;
    }

    const tableBreakInfo = collectTableExplicitPageBreakInfo(node);
    if (tableBreakInfo.startRowIndexes.includes(0) && nodeIndex > 0) {
      breaks.add(nodeIndex);
    }

    if (hasNextNode && tableBreakInfo.breakAfterTable) {
      breaks.add(nodeIndex + 1);
    }
  }

  for (const breakIndex of [...breaks]) {
    if (breakIndex <= 0 || breakIndex >= nodes.length) {
      breaks.delete(breakIndex);
    }
  }

  return breaks;
}
