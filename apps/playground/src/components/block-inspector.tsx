import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Braces, Download, Loader2 } from "lucide-react";
import {
  DOCUMENT_BLOCK_TYPES,
  DocxBlockHighlights,
  DocxWordHighlights,
  extractDocumentBlocks,
  revealDocxSource,
  type DocModel,
  type DocumentBlock,
  type DocumentBlockType,
  type DocumentWord,
  type DocxBlockGeometry,
  type StructuredDocument,
} from "@extend-ai/react-docx";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { BlockContent, collectBlockImages } from "./block-content";

const colors: Record<DocumentBlockType, string> = {
  text: "#3b82f6",
  heading: "#be123c",
  section_heading: "#f43f5e",
  figure: "#10b981",
  table: "#f97316",
  table_head: "#ea580c",
  table_cell: "#fb923c",
  key_value: "#8b5cf6",
  page_number: "#71717a",
  barcode: "#06b6d4",
  formula: "#22c55e",
  header: "#64748b",
  footer: "#64748b",
  watermark: "#14b8a6",
  legend: "#D85A30",
};

const colorForBlock = (block: DocumentBlock) => colors[block.type];

function WordInspector({ blocks, rootRef, showAll, showJson }: {
  blocks: DocumentBlock[];
  rootRef: React.RefObject<HTMLDivElement | null>;
  showAll: boolean;
  showJson: boolean;
}): React.JSX.Element {
  const words = React.useMemo(() => blocks.flatMap(block => block.words ?? []), [blocks]);
  const [hovered, setHovered] = React.useState<DocumentWord>();
  const [selected, setSelected] = React.useState<DocumentWord>();
  const [geometry, setGeometry] = React.useState<DocxBlockGeometry>();
  const scroll = React.useRef<HTMLDivElement>(null);
  const active = hovered ?? selected;
  const virtualizer = useVirtualizer({ count: words.length,
    getItemKey: index => words[index].id, getScrollElement: () => scroll.current,
    estimateSize: () => 42, overscan: 10 });
  React.useEffect(() => { setHovered(undefined); setSelected(undefined); setGeometry(undefined); }, [words]);
  React.useEffect(() => virtualizer.measure(), [showJson, words, virtualizer]);
  return <>
    <div ref={scroll} className="min-h-0 flex-1 overflow-auto" onMouseLeave={() => setHovered(undefined)}>
      {showJson ? <pre className="whitespace-pre-wrap break-all p-4 text-[11px] leading-5">
        {JSON.stringify(active ? { ...active, geometry } : words, null, 2)}
      </pre> : <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map(item => {
          const word = words[item.index];
          return <button key={word.id} type="button" data-word-output-id={word.id}
            data-index={item.index} ref={virtualizer.measureElement}
            className="absolute left-0 top-0 flex w-full items-center gap-3 border-b px-4 py-2 text-left text-sm hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-primary"
            style={{ transform: `translateY(${item.start}px)`, backgroundColor: active?.id === word.id ? "#2563eb0d" : undefined }}
            onMouseEnter={() => { setGeometry(undefined); setHovered(word); }}
            onFocus={() => { setGeometry(undefined); setHovered(word); }}
            onBlur={() => setHovered(undefined)}
            onClick={() => { setSelected(word); if (rootRef.current) revealDocxSource(rootRef.current, word.sourceRefs[0]); }}>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{word.content}</span>
            <span className="text-[11px] text-muted-foreground">{active?.id === word.id && geometry?.fragments.length
              ? [...new Set(geometry.fragments.map(fragment => `p. ${fragment.pageIndex + 1}`))].join(", ")
              : word.sourceRefs[0]?.story}</span>
          </button>;
        })}
      </div>}
    </div>
    {active && geometry && geometry.status !== "rendered" ? <p className="border-t px-4 py-2 text-xs text-muted-foreground">
      {geometry.status === "not_mounted" ? "Click to reveal this word." : "Some text has no visible word geometry in the current view."}
    </p> : null}
    <DocxWordHighlights rootRef={rootRef} word={active} words={showAll ? words : undefined} onGeometry={setGeometry} />
  </>;
}

function blockDetail(block: DocumentBlock): string | undefined {
  const details = block.details;
  if (block.type === "table")
    return `${details.rowCount} rows × ${details.columnCount} columns`;
  if (block.type === "table_cell") {
    const position = `Row ${Number(details.rowIndex) + 1}, column ${Number(details.columnIndex) + 1}`;
    return Number(details.rowSpan) > 1 || Number(details.columnSpan) > 1
      ? `${position} · spans ${details.rowSpan} × ${details.columnSpan}`
      : position;
  }
  if (block.type === "table_head")
    return `Row ${Number(details.rowIndex) + 1}`;
  return undefined;
}

function rows(
  blocks: DocumentBlock[],
  depth = 0
): Array<{ block: DocumentBlock; depth: number }> {
  return blocks.flatMap((block) => [
    { block, depth },
    ...rows(block.children, depth + 1),
  ]);
}

export function BlockInspector({
  model,
  rootRef,
}: {
  model: DocModel;
  rootRef: React.RefObject<HTMLDivElement | null>;
}): React.JSX.Element {
  const [output, setOutput] = React.useState<StructuredDocument>();
  const [error, setError] = React.useState<string>();
  const [busy, setBusy] = React.useState(true);
  const [activeId, setActiveId] = React.useState<string>();
  const [selectedId, setSelectedId] = React.useState<string>();
  const [geometry, setGeometry] = React.useState<DocxBlockGeometry>();
  const [type, setType] = React.useState<string>("all");
  const [showJson, setShowJson] = React.useState(false);
  const [contentMode, setContentMode] = React.useState<"formatted" | "markdown" | "words">("formatted");
  const [includeWords, setIncludeWords] = React.useState(false);
  const [showAllHighlights, setShowAllHighlights] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const images = React.useMemo(() => collectBlockImages(model), [model]);
  React.useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setOutput(undefined);
    setError(undefined);
    setActiveId(undefined);
    setSelectedId(undefined);
    setGeometry(undefined);
    void extractDocumentBlocks(model, { includeWords })
      .then((result) => {
        if (!cancelled) {
          setOutput(result);
          setBusy(false);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setError(String(error));
          setBusy(false);
          setOutput(undefined);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [model, includeWords]);
  const allRows = React.useMemo(() => rows(output?.blocks ?? []), [output]);
  const counts = React.useMemo(() => {
    const result = new Map<DocumentBlockType, number>();
    for (const { block } of allRows)
      result.set(block.type, (result.get(block.type) ?? 0) + 1);
    return result;
  }, [allRows]);
  const filtered = React.useMemo(
    () => allRows.filter((row) => type === "all" || row.block.type === type),
    [allRows, type]
  );
  const active = allRows.find(
    (row) => row.block.id === (activeId ?? selectedId)
  )?.block;
  const filteredBlocks = React.useMemo(() => filtered.map(row => row.block), [filtered]);
  const wordCount = React.useMemo(() => filteredBlocks.reduce((count, block) => count + (block.words?.length ?? 0), 0), [filteredBlocks]);
  const highlighted = React.useMemo(
    () => showAllHighlights ? filtered.map((row) => row.block) : undefined,
    [showAllHighlights, filtered]
  );
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getItemKey: (index) => filtered[index].block.id,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 108,
    overscan: 6,
  });
  React.useEffect(() => virtualizer.measure(), [contentMode, showJson, filtered, virtualizer]);
  const download = () => {
    if (!output) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(output, null, 2)], { type: "application/json" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "document-blocks.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <>
      <aside
        aria-label="Parsed blocks"
        className="flex min-h-0 w-[400px] max-w-[45vw] shrink-0 flex-col overflow-hidden border-s bg-background"
      >
        <div className="flex h-10 items-center gap-2 border-b ps-3 pe-1.5">
          <h2 className="text-[13px] font-semibold">Blocks</h2>
          <span className="text-xs text-muted-foreground">
            {busy ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              contentMode === "words" ? `${wordCount} words` : allRows.length
            )}
          </span>
          <div className="ml-auto flex gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={contentMode === "words" ? "Show word JSON" : "Show block JSON"}
              aria-pressed={showJson}
              onClick={() => setShowJson(!showJson)}
            >
              <Braces className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Download block output"
              disabled={!output || busy}
              onClick={download}
            >
              <Download className="size-4" />
            </Button>
          </div>
        </div>
        <div className="border-b px-4 py-2">
          <div role="group" aria-label="Block text format" className="mb-3 flex gap-1 rounded-md bg-muted p-1">
            {(["formatted", "markdown", "words"] as const).map((mode) => (
              <button key={mode} type="button" aria-pressed={!showJson && contentMode === mode}
                className={`flex-1 rounded-sm px-2 py-1 text-xs capitalize ${!showJson && contentMode === mode ? "bg-background shadow-xs" : "text-muted-foreground"}`}
                onClick={() => { setContentMode(mode); setShowJson(false); setActiveId(undefined); setSelectedId(undefined); if (mode === "words") setIncludeWords(true); }}>
                {mode}
              </button>
            ))}
          </div>
          <select
            aria-label="Filter block type"
            className="w-full bg-background text-xs outline-offset-4"
            value={type}
            onChange={(event) => {
              setType(event.target.value);
              setActiveId(undefined);
              setSelectedId(undefined);
              scrollRef.current?.scrollTo({ top: 0 });
            }}
          >
            <option value="all">All block types</option>
            {DOCUMENT_BLOCK_TYPES.map((type) => (
              <option key={type} value={type}>
                {type} ({counts.get(type) ?? 0})
              </option>
            ))}
          </select>
          <label className="mt-3 flex items-center justify-between text-xs">
            Show all highlights
            <Switch
              aria-label="Show all highlights"
              checked={showAllHighlights}
              onCheckedChange={setShowAllHighlights}
            />
          </label>
        </div>
        {error ? (
          <p role="alert" className="p-4 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {contentMode === "words" ? <WordInspector blocks={filteredBlocks} rootRef={rootRef} showAll={showAllHighlights} showJson={showJson} /> : <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-auto"
          onMouseLeave={() => setActiveId(undefined)}
        >
          {showJson ? (
            <pre className="whitespace-pre-wrap break-all p-4 text-[11px] leading-5">
              {JSON.stringify(
                active ? { ...active, geometry } : output,
                null,
                2
              )}
            </pre>
          ) : (
            <div
              style={{
                height: virtualizer.getTotalSize(),
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const { block, depth } = filtered[item.index];
                const selected = block.id === active?.id;
                const color = colors[block.type];
                return (
                  <div
                    key={block.id}
                    role="button"
                    tabIndex={0}
                    data-block-output-id={block.id}
                    data-block-output-type={block.type}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    className="absolute left-0 top-0 w-full border-b px-4 py-3 text-left hover:bg-muted/50 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-primary"
                    style={{
                      transform: `translateY(${item.start}px)`,
                      paddingLeft: 16 + Math.min(depth, 4) * 12,
                      backgroundColor: selected ? `${color}0d` : undefined,
                    }}
                    onMouseEnter={() => {
                      setGeometry(undefined);
                      setActiveId(block.id);
                    }}
                    onFocus={() => {
                      setGeometry(undefined);
                      setActiveId(block.id);
                    }}
                    onBlur={() => setActiveId(undefined)}
                    onKeyDown={(event) => {
                      if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                        event.preventDefault();
                        event.currentTarget.click();
                      }
                    }}
                    onClick={() => {
                      setSelectedId(block.id);
                      if (rootRef.current)
                        revealDocxSource(
                          rootRef.current,
                          block.sourceRefs[0]?.nodeId ?? block.id
                        );
                    }}
                  >
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-medium">
                      <span
                        className="size-2 rounded-sm"
                        style={{ backgroundColor: color }}
                      />
                      <span style={{ color }}>
                        {block.type}
                      </span>
                      <span className="ml-auto font-normal text-muted-foreground">
                        {selected && geometry?.fragments.length
                          ? [
                              ...new Set(
                                geometry.fragments.map(
                                  (f) => `p. ${f.pageIndex + 1}`
                                )
                              ),
                            ].join(", ")
                          : block.sourceRefs[0]?.story}
                      </span>
                    </div>
                    {blockDetail(block) ? (
                      <p className="mb-1 text-[11px] text-muted-foreground">
                        {blockDetail(block)}
                      </p>
                    ) : null}
                    <BlockContent block={block} mode={contentMode} images={images} />
                  </div>
                );
              })}
            </div>
          )}
        </div>}
        {output?.warnings.length ? (
          <details className="border-t px-4 py-2 text-xs text-muted-foreground">
            <summary>{output.warnings.length} import diagnostics</summary>
            <ul className="max-h-40 list-disc overflow-auto pl-4 pt-2">
              {output.warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          </details>
        ) : null}
        {contentMode !== "words" && active && geometry && geometry.status !== "rendered" ? (
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            {geometry.status === "unresolved"
              ? "This source does not have supported page geometry."
              : geometry.status === "not_mounted"
              ? "No visible fragment on mounted pages. Click to reveal."
              : geometry.status === "not_visible"
              ? "This content is not visible in the current view."
              : "Some source fragments are outside the current view."}
          </p>
        ) : null}
      </aside>
      {contentMode !== "words" ? <DocxBlockHighlights
        rootRef={rootRef}
        block={active}
        blocks={highlighted}
        color={active ? colors[active.type] : undefined}
        colorForBlock={colorForBlock}
        onGeometry={setGeometry}
      /> : null}
    </>
  );
}
