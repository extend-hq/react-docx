import * as React from "react";
import { resolveImagePaintBounds, type DocModel } from "@extend-ai/react-docx-doc-model";
import type {
  DocxEditorController,
  DocxEditorViewerMode
} from "../editor";
import {
  buildDocxLayoutDiagnostics
} from "./layout-diagnostics";
import type {
  DocxCanvasOptions,
  DocxLayoutDiagnostics,
  DocxLayoutObjectGeometry
} from "./types";
import { resolveFormFieldPreviewImageSource } from "../image-render";

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

interface LoadedPreview {
  image: HTMLImageElement;
  loaded: boolean;
}

function drawFormField(
  context: CanvasRenderingContext2D,
  object: DocxLayoutObjectGeometry,
  previews: Map<string, LoadedPreview>,
  readOnly: boolean
): void {
  const field = object.formField;
  if (!field) return;
  const preview = readOnly ? previews.get(object.id) : undefined;
  if (preview?.loaded && object.image) {
    const crop = object.image.crop;
    const left = crop?.leftFraction ?? 0;
    const top = crop?.topFraction ?? 0;
    const visibleWidth = 1 - left - (crop?.rightFraction ?? 0);
    const visibleHeight = 1 - top - (crop?.bottomFraction ?? 0);
    if (visibleWidth > 0 && visibleHeight > 0) {
      const imageWidth = object.width / visibleWidth;
      const imageHeight = object.height / visibleHeight;
      const paint = resolveImagePaintBounds(object.image, imageWidth, imageHeight);
      const hasCrop = left !== 0 || top !== 0 ||
        (crop?.rightFraction ?? 0) !== 0 || (crop?.bottomFraction ?? 0) !== 0;
      context.save();
      try {
        if (!paint || hasCrop) {
          context.beginPath();
          context.rect(object.x, object.y, object.width, object.height);
          context.clip();
        }
        context.globalAlpha = Math.max(0, Math.min(1, object.image.cssOpacity ?? 1));
        context.filter = object.image.cssFilter ?? "none";
        context.drawImage(
          preview.image,
          object.x - left * imageWidth + (paint?.xPx ?? 0),
          object.y - top * imageHeight + (paint?.yPx ?? 0),
          paint?.widthPx ?? imageWidth,
          paint?.heightPx ?? imageHeight
        );
        return;
      } catch {
        preview.loaded = false;
      } finally {
        context.restore();
      }
    }
  }
  context.font = `${(field.style?.fontSizePt ?? 12) * 96 / 72}px Calibri, Arial, sans-serif`;
  context.fillStyle = field.style?.color ? `#${field.style.color.replace(/^#/, "")}` : "#111827";
  context.textBaseline = "top";
  context.fillText(field.fallbackText, object.x, object.y, Math.max(1, object.width));
}

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
          return child.checked ?? child.widget?.checkbox?.defaultChecked
            ? child.checkedSymbol ?? "☒"
            : child.uncheckedSymbol ?? "☐";
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
  debugLayout: boolean,
  previews: Map<string, LoadedPreview>,
  readOnly: boolean
): void {
  const page = diagnostics.pages[pageIndex];
  if (!page) {
    return;
  }

  context.clearRect(0, 0, page.width, page.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, page.width, page.height);

  const fields = page.objects.filter((object) => object.formField).sort(
    (left, right) => (left.image?.floatingPosition?.zIndex ?? 0) - (right.image?.floatingPosition?.zIndex ?? 0)
  );
  for (const object of fields.filter((item) => item.image?.floatingPosition?.behindDocument)) {
    drawFormField(context, object, previews, readOnly);
  }

  for (const object of page.objects) {
    if (object.formField) {
      continue;
    }
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
      context.font = `${line.fontSizePx ?? baseFontPx}px Calibri, Arial, sans-serif`;
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
  for (const object of fields.filter((item) => !item.image?.floatingPosition?.behindDocument)) {
    drawFormField(context, object, previews, readOnly);
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
  const previewsRef = React.useRef<Map<string, LoadedPreview>>(new Map());
  const [previewVersion, setPreviewVersion] = React.useState(0);
  const [selectedNodeIndex, setSelectedNodeIndex] = React.useState<number | undefined>(
    editor.selection.kind === "paragraph" ? editor.selection.nodeIndex : undefined
  );

  React.useEffect(() => {
    const entries = new Map<string, LoadedPreview>();
    previewsRef.current = entries;
    let active = true;
    if (isReadOnly) {
      for (const page of diagnostics.pages) {
        for (const object of page.objects) {
          if (!object.image || !object.formField) continue;
          const src = resolveFormFieldPreviewImageSource(object.image);
          if (!src) continue;
          const image = new Image();
          const entry = { image, loaded: false };
          entries.set(object.id, entry);
          image.onload = () => {
            if (!active) return;
            entry.loaded = image.naturalWidth > 0 && image.naturalHeight > 0;
            setPreviewVersion((version) => version + 1);
          };
          image.onerror = () => {
            if (!active) return;
            entry.loaded = false;
            setPreviewVersion((version) => version + 1);
          };
          image.src = src;
        }
      }
    }
    return () => {
      active = false;
      for (const entry of entries.values()) {
        entry.image.onload = null;
        entry.image.onerror = null;
      }
    };
  }, [diagnostics, isReadOnly]);

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
        options.debugLayout,
        previewsRef.current,
        isReadOnly
      );
    }
  }, [diagnostics, options.debugLayout, selectedNodeIndex, previewVersion, isReadOnly]);

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

      if (paragraph?.nodeIndex === undefined || paragraph.nodeIndex < 0) {
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
        aria-hidden={isReadOnly || undefined}
        tabIndex={isReadOnly ? -1 : undefined}
        readOnly={isReadOnly}
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
          {page.objects.filter((object) => object.formField).map((object) => {
            const field = object.formField!;
            const editable = !isReadOnly && !field.disabled && object.formFieldLocation !== undefined;
            const toggle = (): void => {
              if (!editable || !object.formFieldLocation) return;
              editor.selectFormField(object.formFieldLocation);
              editor.toggleFormCheckbox(object.formFieldLocation);
            };
            return (
              <span
                key={object.id}
                role="checkbox"
                aria-label={field.label}
                aria-checked={field.checked}
                aria-readonly={!editable}
                aria-disabled={field.disabled || undefined}
                tabIndex={editable ? 0 : undefined}
                data-docx-form-field="true"
                data-docx-form-field-type="checkbox"
                data-docx-form-field-child-index={field.childIndex}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  toggle();
                }}
                onKeyDown={(event) => {
                  if (editable && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.shiftKey) editor.redo();
                    else editor.undo();
                    return;
                  }
                  if (event.key !== " " && event.key !== "Enter") return;
                  event.preventDefault();
                  event.stopPropagation();
                  toggle();
                }}
                style={{
                  position: "absolute",
                  left: object.x,
                  top: object.y,
                  width: object.width,
                  height: object.height,
                  cursor: editable ? "pointer" : undefined,
                  zIndex: object.image?.floatingPosition?.zIndex
                }}
              />
            );
          })}
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
