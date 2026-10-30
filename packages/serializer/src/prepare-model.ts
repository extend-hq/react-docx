import {
  projectCollapsedTableGrid,
  type DocModel,
  type DocNode,
  type ParagraphNode,
  type TableNode,
} from "@extend-ai/react-docx-doc-model";

function mapUnchanged<T>(values: T[], transform: (value: T) => T): T[] {
  let result: T[] | undefined;
  for (let index = 0; index < values.length; index += 1) {
    const value = transform(values[index]);
    if (value !== values[index]) {
      result ??= values.slice();
      result[index] = value;
    }
  }
  return result ?? values;
}

function prepareParagraph(paragraph: ParagraphNode): ParagraphNode {
  const children = mapUnchanged(paragraph.children, (child) => {
    if (child.type !== "image" || !child.contentNodes) return child;
    const contentNodes = prepareNodes(child.contentNodes);
    return contentNodes === child.contentNodes ? child : { ...child, contentNodes };
  });
  return children === paragraph.children ? paragraph : { ...paragraph, children };
}

function prepareTable(source: TableNode): TableNode {
  const marker = source.style?.collapsedGridColumns;
  if (Array.isArray(marker) && marker.length !== 0) {
    if (source.style?.styleId !== source.style?.sourceStyleId) {
      throw new Error("Collapsed table grid must be materialized before changing table style");
    }
    const hasVisibleTableBorder = Object.values(source.style?.borders ?? {}).some(
      (border) => border && border.type !== "none" && border.type !== "nil",
    );
    if (hasVisibleTableBorder) {
      throw new Error("Collapsed table grid requires confirmed zero border spacing before export");
    }
  }
  const projected = projectCollapsedTableGrid(source, { resolvedBorderSpacingPx: 0 });
  if (projected.kind === "rejected") {
    throw new Error(`Invalid collapsed table grid: ${projected.reason}`);
  }
  const table = projected.table;
  const rows = mapUnchanged(table.rows, (row) => {
    const cells = mapUnchanged(row.cells, (cell) => {
      const nodes = prepareNodes(cell.nodes);
      return nodes === cell.nodes ? cell : { ...cell, nodes };
    });
    return cells === row.cells ? row : { ...row, cells };
  });
  const sourceTextPatches = table.sourceTextPatches && mapUnchanged(table.sourceTextPatches, (patch) => {
    const paragraph = prepareParagraph(patch.paragraph);
    return paragraph === patch.paragraph ? patch : { ...patch, paragraph };
  });
  return rows === table.rows && sourceTextPatches === table.sourceTextPatches
    ? table : { ...table, rows, sourceTextPatches };
}

function prepareNodes(nodes: DocNode[]): DocNode[] {
  return mapUnchanged(nodes, (node) => node.type === "table" ? prepareTable(node) : prepareParagraph(node));
}

function prepareStories<T extends { nodes: DocNode[] }>(stories: T[]): T[] {
  return mapUnchanged(stories, (story) => {
    const nodes = prepareNodes(story.nodes);
    return nodes === story.nodes ? story : { ...story, nodes };
  });
}

function prepareOptionalStories<T extends { nodes?: DocNode[] }>(stories: T[] | undefined): T[] | undefined {
  if (!stories) return stories;
  return mapUnchanged(stories, (story) => {
    if (!story.nodes) return story;
    const nodes = prepareNodes(story.nodes);
    return nodes === story.nodes ? story : { ...story, nodes };
  });
}

/** Keep source caches available while ensuring every rebuilt table has a physical grid. */
export function prepareModelForSerialization(model: DocModel): DocModel {
  const nodes = prepareNodes(model.nodes);
  const original = model.metadata;
  const headerSections = prepareStories(original.headerSections);
  const footerSections = prepareStories(original.footerSections);
  const sections = original.sections && mapUnchanged(original.sections, (section) => {
    const headers = prepareStories(section.headerSections);
    const footers = prepareStories(section.footerSections);
    return headers === section.headerSections && footers === section.footerSections
      ? section : { ...section, headerSections: headers, footerSections: footers };
  });
  const footnotes = prepareOptionalStories(original.footnotes);
  const endnotes = prepareOptionalStories(original.endnotes);
  const comments = prepareOptionalStories(original.comments);
  const metadata = headerSections === original.headerSections && footerSections === original.footerSections
    && sections === original.sections && footnotes === original.footnotes
    && endnotes === original.endnotes && comments === original.comments
    ? original : { ...original, headerSections, footerSections, sections, footnotes, endnotes, comments };
  return nodes === model.nodes && metadata === original ? model : { ...model, nodes, metadata };
}
