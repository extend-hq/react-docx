import type { ChartData, ChartPoint } from "@extend-ai/react-docx-doc-model";

export function seriesName(chart: ChartData, index: number): string {
  return chart.series[index].name || `Series ${index + 1}`;
}

function cell(value: string): string {
  return /["\t\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function chartTsv(chart: ChartData, selected?: number): string {
  const series = chart.series.flatMap((s, i) =>
    selected === undefined || i === selected ? [{ ...s, label: seriesName(chart, i) }] : []
  );
  const levels = new Set<number>();
  const channels = new Set<"value" | "x" | "y" | "bubbleSize">();
  for (const s of series) {
    for (const p of s.points) {
      for (const c of p.categories ?? []) levels.add(c.level);
      for (const key of ["value", "x", "y", "bubbleSize"] as const) {
        if (p[key] != null) channels.add(key);
      }
    }
  }
  const categoryLevels = [...levels].sort((a, b) => b - a);
  const fields = (["x", "y", "bubbleSize", "value"] as const).filter(k => channels.has(k));
  const labels = { x: "X", y: "Y", bubbleSize: "Bubble size", value: "Value" };
  const rows = [["Series", "Point", ...categoryLevels.map(level =>
    levels.size === 1 ? "Category" : `Category (level ${level + 1})`
  ), ...fields.map(k => labels[k])]];
  for (const s of series) {
    const row = (p?: ChartPoint) => [s.label, p ? String(p.index + 1) : "",
      ...categoryLevels.map(level => p?.categories?.find(c => c.level === level)?.label ?? ""),
      ...fields.map(k => p?.[k] ?? "")];
    if (s.points.length === 0) rows.push(row());
    for (const p of s.points) rows.push(row(p));
  }
  return rows.map(r => r.map(cell).join("\t")).join("\n");
}
