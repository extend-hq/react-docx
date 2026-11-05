import type { DocumentRevision, WordProperty } from "@extend-ai/react-docx-doc-model";

const authorColors = new WeakMap<DocumentRevision, string>();
const palette = ["#7030a0", "#8064a2", "#c0509c", "#0070c0", "#c00000", "#9c6500", "#008080"];

export function assignReviewAuthorColors(revisions: DocumentRevision[]): void {
  const authors = new Map<string, string>();
  for (const revision of revisions) {
    const author = revision.author ?? "";
    if (!authors.has(author)) authors.set(author, palette[authors.size % palette.length]);
    authorColors.set(revision, authors.get(author)!);
  }
}

export function copyReviewRevisionColor(source: DocumentRevision, target: DocumentRevision): void {
  const color = authorColors.get(source);
  if (color) authorColors.set(target, color);
}

export function reviewRevisionColor(revision?: DocumentRevision): string {
  if (revision?.kind === "move_from" || revision?.kind === "move_to") return "#008000";
  if (revision?.scope === "table_cell") {
    if (revision.kind === "insertion") return "#80b9dc";
    if (revision.kind === "deletion") return "#d97abc";
    if (revision.kind === "cell_merge") return "#c9a227";
  }
  return (revision && authorColors.get(revision)) || palette[0];
}

export function reviewCellFill(revision: DocumentRevision): string | undefined {
  if (revision.kind === "insertion") return "#e0f2fa";
  if (revision.kind === "deletion" && revision.scope === "table_cell") return "#fce5f5";
  if (revision.kind === "cell_merge") return "#fff4d9";
  return undefined;
}

const title = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const number = (value: string | undefined, divisor: number) => value !== undefined && Number.isFinite(Number(value)) ? String(Math.round(Number(value) / divisor * 100) / 100) : value;
const enabled = (property?: WordProperty) => Boolean(property && !["0", "false", "off", "none"].includes(property.attributes?.["w:val"] ?? "1"));

export function reviewFormattingDescription(revision: DocumentRevision): string {
  const before = new Map(revision.properties?.before.map(p => [p.name, p]));
  const after = new Map(revision.properties?.after.map(p => [p.name, p]));
  const changes: string[] = [];
  const booleans: Record<string, string> = { "w:b": "Bold", "w:i": "Italic", "w:strike": "Strikethrough", "w:dstrike": "Double strikethrough", "w:caps": "All caps", "w:smallCaps": "Small caps", "w:vanish": "Hidden" };
  for (const name of new Set([...after.keys(), ...before.keys()])) {
    const current = after.get(name), previous = before.get(name);
    if (JSON.stringify(current) === JSON.stringify(previous)) continue;
    const attrs = current?.attributes ?? {};
    const val = attrs["w:val"];
    const label = booleans[name];
    if (label) {
      if (enabled(current) !== enabled(previous)) changes.push(`${enabled(current) ? "" : "Not "}${label}`);
    } else if (name === "w:rFonts") changes.push(`Font: ${attrs["w:ascii"] ?? attrs["w:hAnsi"] ?? attrs["w:asciiTheme"] ?? "Default"}`);
    else if (name === "w:sz") changes.push(`${number(val, 2) ?? "Default"} pt`);
    else if (name === "w:u") changes.push(enabled(current) ? `${val && val !== "single" ? `${title(val)} ` : ""}Underline` : "No underline");
    else if (name === "w:color") {
      const colors: Record<string, string> = { "000000": "Black", "FFFFFF": "White", "FF0000": "Red", "0000FF": "Blue", "0070C0": "Blue", "008000": "Green" };
      changes.push(`Font color: ${val === "auto" || !val ? "Automatic" : colors[val.toUpperCase()] ?? `#${val}`}`);
    }
    else if (name === "w:jc") changes.push(title(val ?? "left"));
    else if (name === "w:ind" || name === "w:pgMar") {
      const parts = Object.entries(attrs).filter(([key, value]) => value !== previous?.attributes?.[key]).map(([key, value]) => `${title(key.replace("w:", ""))}: ${number(value, 1440)}"`);
      if (parts.length) changes.push(`${name === "w:ind" ? "Indent: " : ""}${parts.join(", ")}`);
    } else if (name === "w:spacing") {
      for (const side of ["before", "after"] as const) if (attrs[`w:${side}`] !== previous?.attributes?.[`w:${side}`]) changes.push(`Space ${title(side)}: ${number(attrs[`w:${side}`] ?? "0", 20)} pt`);
      if (attrs["w:line"] !== previous?.attributes?.["w:line"]) changes.push(`Line spacing: ${number(attrs["w:line"] ?? "240", attrs["w:lineRule"] === "exact" ? 20 : 240)}${attrs["w:lineRule"] === "exact" ? " pt" : " lines"}`);
    } else if (name === "w:pStyle" || name === "w:rStyle") changes.push(`Style: ${val ?? "Default"}`);
    else if (name === "w:shd") changes.push(`Shading: ${attrs["w:fill"] ? `#${attrs["w:fill"]}` : "None"}`);
    else if (name === "w:trHeight") changes.push(`Row height: ${val ? `${number(val, 20)} pt` : "Automatic"}`);
    else if (name === "w:tblW" || name === "w:tcW") changes.push(`Width: ${attrs["w:w"] && attrs["w:type"] !== "auto" ? `${number(attrs["w:w"], attrs["w:type"] === "pct" ? 50 : 1440)}${attrs["w:type"] === "pct" ? "%" : '"'}` : "Automatic"}`);
    else if (name === "w:pgSz") changes.push(`Page size: ${attrs["w:w"] && attrs["w:h"] ? `${number(attrs["w:w"], 1440)}" × ${number(attrs["w:h"], 1440)}"` : "Default"}`);
    else if (name === "w:gridCol") changes.push("Table grid changed");
    else if (name === "w:numPr") changes.push("Numbering changed");
    else if (name === "w:cols") changes.push(`Columns: ${attrs["w:num"] ?? "1"}`);
    else changes.push(title(name.replace(/^w:/, "").replace(/([a-z])([A-Z])/g, "$1 $2")));
  }
  if (revision.scope === "text" && changes.some(value => /^(Not )?(Bold|Italic)$/.test(value)) && !changes.some(value => value.startsWith("Font:"))) changes[0] = `Font: ${changes[0]}`;
  return changes.join(", ") || (revision.scope.startsWith("table") ? "Table properties" : "Formatting");
}
