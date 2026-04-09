import * as React from "react";
import type { DocModel } from "@extend-ai/react-docx-doc-model";
import type {
  DocxEditorController,
  DocxEditorViewerMode
} from "../editor";
import {
  buildDocxLayoutDiagnostics
} from "./layout-diagnostics";
import type {
  DocxCanvasOptions,
  DocxLayoutDiagnostics
} from "./types";

interface CanvasDocxEditorViewerProps {
  editor: DocxEditorController;
  className?: string;
  style?: React.CSSProperties;
  mode?: DocxEditorViewerMode;
  pageGapBackgroundColor?: string;
  canvasOptions?: DocxCanvasOptions;
}

const DEFAULT_CANVAS_OPTIONS: Required<DocxCanvasOptions> = {
  maxFPS: 60,
  overscanPages: 2,
  debugLayout: false,
  worker: true
};

const PAGE_GAP = 24;

function paragraphPlainTextFromModel(model: DocModel, nodeIndex: number): string {
  const node = model.nodes[nodeIndex];
  if (!node || node.type !== "paragraph") {
    return "";
  }

  return node.children
    .map((child) => {
      if (child.type === "text") {
        return child.text;
      }

      if (child.type === "form-field") {
        if (child.fieldType === "checkbox") {
          return child.checked ? child.checkedSymbol ?? "☒" : child.uncheckedSymbol ?? "☐";
        }
        return child.value ?? child.placeholder ?? "";
      }

      return " ";
    })
    .join("");
}

function resolveRenderableEngine(renderMode: DocxEditorViewerMode): "edit" | "read-only" {
  return renderMode === "read-only" ? "read-only" : "edit";
}

function drawPage(
  context: CanvasRenderingContext2D,
  diagnostics: DocxLayoutDiagnostics,
  pageIndex: number,
  selectedNodeIndex: number | undefined,
  debugLayout: boolean
): void {
  const page = diagnostics.pages[pageIndex];
  if (!page) {
    return;
  }

  context.clearRect(0, 0, page.width, page.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, page.width, page.height);

  for (const object of page.objects) {
    if (object.kind === "table") {
      context.strokeStyle = "#d1d5db";
      context.lineWidth = 1;
      context.strokeRect(object.x, object.y, object.width, object.height);

      if (debugLayout) {
        context.strokeStyle = "#60a5fa";
        context.setLineDash([4, 4]);
        context.strokeRect(object.x, object.y, object.width, object.height);
        context.setLineDash([]);
      }
      continue;
    }

    const isSelected =
      selectedNodeIndex !== undefined &&
      object.nodeIndex !== undefined &&
      selectedNodeIndex === object.nodeIndex;

    if (isSelected) {
      context.fillStyle = "rgba(59,130,246,0.12)";
      context.fillRect(object.x - 2, object.y - 1, object.width + 4, object.height + 2);
    }

    const lines = object.lines ?? [];
    const baseFontPx = 14;
    context.font = `${baseFontPx}px Calibri, Arial, sans-serif`;
    context.fillStyle = "#111827";
    context.textBaseline = "top";

    for (const line of lines) {
      context.fillText(line.text, line.x, line.y, Math.max(1, line.width));
      if (debugLayout) {
        context.strokeStyle = "rgba(14,165,233,0.4)";
        context.strokeRect(line.x, line.y, line.width, line.height);
      }
    }

    if (debugLayout) {
      context.strokeStyle = "rgba(14,165,233,0.9)";
      context.setLineDash([4, 2]);
      context.strokeRect(object.x, object.y, object.width, object.height);
      context.setLineDash([]);
    }
  }
}

export function CanvasDocxEditorViewer({
  editor,
  className,
  style,
  mode = "edit",
  pageGapBackgroundColor,
  canvasOptions
}: CanvasDocxEditorViewerProps): React.JSX.Element {
  const resolvedMode = resolveRenderableEngine(mode);
  const isReadOnly = resolvedMode === "read-only";
  const options = React.useMemo(
    () => ({ ...DEFAULT_CANVAS_OPTIONS, ...(canvasOptions ?? {}) }),
    [canvasOptions]
  );

  const diagnostics = React.useMemo(
    () => buildDocxLayoutDiagnostics(editor.model),
    [editor.model]
  );

  const pageCanvasesRef = React.useRef<Map<number, HTMLCanvasElement>>(new Map());
  const containerRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const pendingInputBufferRef = React.useRef<string>("");
  const [selectedNodeIndex, setSelectedNodeIndex] = React.useState<number | undefined>(
    editor.selection.kind === "paragraph" ? editor.selection.nodeIndex : undefined
  );

  React.useEffect(() => {
    if (editor.selection.kind === "paragraph") {
      setSelectedNodeIndex(editor.selection.nodeIndex);
      return;
    }
    setSelectedNodeIndex(undefined);
  }, [editor.selection]);

  React.useEffect(() => {
    for (const [pageIndex, canvas] of pageCanvasesRef.current.entries()) {
      const context = canvas.getContext("2d");
      if (!context) {
        continue;
      }
      drawPage(
        context,
        diagnostics,
        pageIndex,
        selectedNodeIndex,
        options.debugLayout
      );
    }
  }, [diagnostics, options.debugLayout, selectedNodeIndex]);

  const focusInput = React.useCallback((): void => {
    if (isReadOnly) {
      return;
    }

    const input = textareaRef.current;
    if (!input) {
      return;
    }

    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [isReadOnly]);

  const selectParagraphAtPoint = React.useCallback(
    (pageIndex: number, x: number, y: number): number | undefined => {
      const page = diagnostics.pages[pageIndex];
      if (!page) {
        return undefined;
      }

      const paragraph = page.objects.find((object) => {
        if (object.kind !== "paragraph") {
          return false;
        }
        return x >= object.x && x <= object.x + object.width && y >= object.y && y <= object.y + object.height;
      });

      if (!paragraph?.nodeIndex || paragraph.nodeIndex < 0) {
        return undefined;
      }

      return paragraph.nodeIndex;
    },
    [diagnostics.pages]
  );

  const onCanvasPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>, pageIndex: number): void => {
      const canvas = event.currentTarget;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const nodeIndex = selectParagraphAtPoint(pageIndex, x, y);
      if (nodeIndex === undefined) {
        focusInput();
        return;
      }

      editor.selectParagraph(nodeIndex);
      editor.setActiveTextRange(undefined);
      setSelectedNodeIndex(nodeIndex);
      pendingInputBufferRef.current = paragraphPlainTextFromModel(editor.model, nodeIndex);
      focusInput();
    },
    [editor, focusInput, selectParagraphAtPoint]
  );

  const onHiddenInputBeforeInput = React.useCallback(
    (event: React.FormEvent<HTMLTextAreaElement>): void => {
      if (isReadOnly || selectedNodeIndex === undefined) {
        return;
      }

      const target = event.currentTarget;
      const nextValue = target.value;
      const previousValue = pendingInputBufferRef.current;
      pendingInputBufferRef.current = nextValue;

      if (nextValue === previousValue) {
        return;
      }

      editor.commitParagraphText(selectedNodeIndex, nextValue);
    },
    [editor, isReadOnly, selectedNodeIndex]
  );

  const onHiddenInputKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (isReadOnly) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          editor.redo();
        } else {
          editor.undo();
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        textareaRef.current?.select();
        return;
      }
    },
    [editor, isReadOnly]
  );

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: "relative",
        display: "grid",
        justifyItems: "center",
        gap: PAGE_GAP,
        background: pageGapBackgroundColor ?? "transparent",
        ...style
      }}
      data-testid="docx-editor-viewer"
      onPointerDown={focusInput}
    >
      <textarea
        ref={textareaRef}
        aria-label="Canvas editor hidden input"
        value={selectedNodeIndex !== undefined ? paragraphPlainTextFromModel(editor.model, selectedNodeIndex) : ""}
        onChange={() => undefined}
        onInput={onHiddenInputBeforeInput}
        onKeyDown={onHiddenInputKeyDown}
        style={{
          position: "absolute",
          pointerEvents: "none",
          opacity: 0,
          width: 1,
          height: 1,
          left: -10000,
          top: -10000
        }}
      />

      {diagnostics.pages.map((page, pageIndex) => (
        <div
          key={`canvas-page-${page.page}`}
          data-docx-page-surface="true"
          style={{
            position: "relative",
            width: page.width,
            height: page.height,
            backgroundColor: "#fff",
            boxShadow: "0 1px 2px rgba(15, 23, 42, 0.08), 0 8px 24px rgba(15, 23, 42, 0.08)",
            border: "1px solid rgba(15, 23, 42, 0.08)"
          }}
        >
          <canvas
            ref={(element) => {
              if (!element) {
                pageCanvasesRef.current.delete(pageIndex);
                return;
              }
              pageCanvasesRef.current.set(pageIndex, element);
            }}
            width={Math.max(1, Math.round(page.width))}
            height={Math.max(1, Math.round(page.height))}
            style={{
              width: page.width,
              height: page.height,
              display: "block"
            }}
            onPointerDown={(event) => onCanvasPointerDown(event, pageIndex)}
          />
        </div>
      ))}

      {options.debugLayout ? (
        <pre
          style={{
            width: "min(100%, 980px)",
            maxHeight: 220,
            overflow: "auto",
            margin: 0,
            padding: 12,
            borderRadius: 8,
            border: "1px solid rgba(15, 23, 42, 0.12)",
            backgroundColor: "rgba(248,250,252,0.95)",
            fontSize: 11,
            lineHeight: 1.5
          }}
        >
          {JSON.stringify(
            {
              pages: diagnostics.pages.length,
              objects: diagnostics.pages.reduce(
                (sum, page) => sum + page.objects.length,
                0
              ),
              maxFPS: options.maxFPS,
              overscanPages: options.overscanPages,
              worker: options.worker
            },
            null,
            2
          )}
        </pre>
      ) : null}
    </div>
  );
}
