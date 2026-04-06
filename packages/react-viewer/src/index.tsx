import * as React from "react";
import type { DocModel } from "@react-docx/doc-model";
import {
  layoutDocument,
  type LayoutBlock,
  type LayoutOptions,
  type LayoutParagraphBlock,
  type LayoutRun,
  type LayoutTableBlock
} from "@react-docx/layout-engine";
import { buildDocModel } from "@react-docx/doc-model";
import { parseDocx } from "@react-docx/ooxml-core";
import { DEFAULT_DOCUMENT_LAYOUT, parseSectionLayout, resolveDocumentLayout } from "./section-layout";
import {
  imageUsesPlaceholderFallback,
  resolveRenderableImageSource,
  unsupportedImageFallbackLabel
} from "./image-render";

export interface ReactDocxViewerProps {
  file?: ArrayBuffer;
  model?: DocModel;
  className?: string;
  layoutOptions?: LayoutOptions;
  emptyState?: React.ReactNode;
}

export interface UseDocxModelState {
  model?: DocModel;
  isLoading: boolean;
  error?: Error;
}

const HIGHLIGHT_TO_CSS: Record<string, string> = {
  yellow: "#fff59d",
  green: "#bbf7d0",
  cyan: "#a5f3fc",
  magenta: "#f5d0fe",
  blue: "#bfdbfe",
  red: "#fecaca",
  black: "#111827",
  white: "#ffffff",
  darkgray: "#9ca3af",
  lightgray: "#e5e7eb"
};
const SCRIPT_FONT_SCALE = 0.65;

function resolveHighlightColor(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized.startsWith("#")) {
    return normalized;
  }

  return HIGHLIGHT_TO_CSS[normalized] ?? normalized;
}

function headingFontSize(level?: 1 | 2 | 3 | 4 | 5 | 6): string | undefined {
  if (!level) {
    return undefined;
  }

  switch (level) {
    case 1:
      return "2rem";
    case 2:
      return "1.6rem";
    case 3:
      return "1.35rem";
    case 4:
      return "1.2rem";
    case 5:
      return "1.05rem";
    case 6:
      return "0.95rem";
    default:
      return undefined;
  }
}

export function useDocxModel(file?: ArrayBuffer): UseDocxModelState {
  const [state, setState] = React.useState<UseDocxModelState>({
    isLoading: Boolean(file)
  });

  React.useEffect(() => {
    if (!file) {
      setState({ isLoading: false });
      return;
    }

    const docxFile = file;
    let isCurrent = true;

    async function load(): Promise<void> {
      setState({ isLoading: true });
      try {
        const pkg = await parseDocx(docxFile);
        if (!isCurrent) {
          return;
        }
        setState({
          isLoading: false,
          model: buildDocModel(pkg)
        });
      } catch (error) {
        if (!isCurrent) {
          return;
        }
        setState({
          isLoading: false,
          error: error instanceof Error ? error : new Error("Unknown DOCX parse error")
        });
      }
    }

    void load();

    return () => {
      isCurrent = false;
    };
  }, [file]);

  return state;
}

function runTextStyle(run: LayoutRun): React.CSSProperties {
  if (run.kind === "image") {
    return {};
  }

  const hasScriptVerticalAlign =
    run.style?.verticalAlign === "superscript" || run.style?.verticalAlign === "subscript";
  const verticalAlign =
    run.style?.verticalAlign === "superscript"
      ? "super"
      : run.style?.verticalAlign === "subscript"
        ? "sub"
        : undefined;
  const textDecorationTokens = [run.style?.underline ? "underline" : "", run.style?.strike ? "line-through" : ""]
    .filter(Boolean);
  const textDecoration = textDecorationTokens.length > 0 ? textDecorationTokens.join(" ") : "none";

  const style: React.CSSProperties = {
    fontWeight: run.style?.bold ? 700 : undefined,
    fontStyle: run.style?.italic ? "italic" : undefined,
    textDecoration,
    color: run.style?.color,
    backgroundColor: resolveHighlightColor(run.style?.highlight),
    fontSize: run.style?.fontSizePt
      ? `${Number(
          (run.style.fontSizePt * (hasScriptVerticalAlign ? SCRIPT_FONT_SCALE : 1)).toFixed(3)
        )}pt`
      : hasScriptVerticalAlign
        ? `${SCRIPT_FONT_SCALE}em`
        : undefined,
    fontFamily: run.style?.fontFamily,
    verticalAlign,
    whiteSpace: "pre-wrap"
  };

  return style;
}

function linkRunTextStyle(run: LayoutRun): React.CSSProperties {
  const base = runTextStyle(run);
  const resolvedTextDecoration =
    typeof base.textDecoration === "string" && base.textDecoration.trim().length > 0
      ? base.textDecoration
      : "none";
  return {
    ...base,
    color: base.color ?? "inherit",
    textDecoration: resolvedTextDecoration
  };
}

function renderParagraphRuns(block: LayoutParagraphBlock): React.JSX.Element[] {
  return block.runs.map((run) => {
    if (run.kind === "image") {
      const renderableImageSrc = resolveRenderableImageSource(run);
      if (!run.src) {
        return (
          <span
            key={run.id}
            style={{
              display: "inline-flex",
              minWidth: 120,
              minHeight: 80,
              alignItems: "center",
              justifyContent: "center",
              border: "1px dashed #c4c4c4",
              color: "#6b7280",
              fontSize: 12,
              padding: 8,
              marginInline: 4
            }}
          >
            Missing image
          </span>
        );
      }

      if (imageUsesPlaceholderFallback(run) || (run.src && !renderableImageSrc)) {
        return (
          <span
            key={run.id}
            role="img"
            aria-label={run.alt ?? "DOCX image"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: run.widthPx ? `${run.widthPx}px` : "1.8em",
              height: run.heightPx ? `${run.heightPx}px` : "1.8em",
              minWidth: 16,
              minHeight: 16,
              border: "1px solid #d1d5db",
              borderRadius: 3,
              backgroundColor: "#ffffff",
              color: "#0f172a",
              fontSize: (run.widthPx ?? 0) <= 56 && (run.heightPx ?? 0) <= 56 ? 12 : 10,
              fontWeight: 700,
              textTransform: "lowercase",
              fontFamily: "Arial, sans-serif",
              lineHeight: 1,
              verticalAlign: "middle",
              marginInline: 4
            }}
          >
            {unsupportedImageFallbackLabel(run, run.widthPx, run.heightPx)}
          </span>
        );
      }

      return (
        <img
          key={run.id}
          src={renderableImageSrc}
          alt={run.alt ?? "DOCX image"}
          style={{
            maxWidth: run.widthPx ? `${run.widthPx}px` : "100%",
            maxHeight: run.heightPx ? `${run.heightPx}px` : undefined,
            verticalAlign: "middle",
            marginInline: 4
          }}
        />
      );
    }

    const textStyle = runTextStyle(run);
    if (run.link) {
      return (
        <a
          key={run.id}
          href={run.link}
          target={run.link.startsWith("#") ? undefined : "_blank"}
          rel={run.link.startsWith("#") ? undefined : "noreferrer noopener"}
          style={linkRunTextStyle(run)}
        >
          {run.text}
        </a>
      );
    }

    return (
      <span key={run.id} style={textStyle}>
        {run.text}
      </span>
    );
  });
}

function renderTable(block: LayoutTableBlock): React.JSX.Element {
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        tableLayout: "fixed",
        marginBottom: 8
      }}
    >
      <tbody>
        {block.rows.map((row) => (
          <tr key={row.id}>
            {row.cells.map((cell) => (
              <td
                key={cell.id}
                colSpan={cell.colSpan}
                style={{
                  border: "1px solid #d1d5db",
                  padding: 8,
                  backgroundColor: cell.backgroundColor,
                  verticalAlign: "top",
                  minWidth: 0,
                  wordWrap: "break-word",
                  overflowWrap: "break-word",
                  wordBreak: "break-word"
                }}
              >
                {cell.paragraphs.map((paragraph) => (
                  <p
                    key={paragraph.id}
                    style={{
                      margin: 0,
                      textAlign: paragraph.align,
                      fontWeight: paragraph.headingLevel ? 700 : undefined,
                      fontSize: headingFontSize(paragraph.headingLevel)
                    }}
                  >
                    {renderParagraphRuns(paragraph)}
                  </p>
                ))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const containerStyle: React.CSSProperties = {
  display: "grid",
  justifyItems: "center",
  gap: 16
};

function renderBlock(block: LayoutBlock): React.JSX.Element {
  if (block.kind === "table") {
    return <React.Fragment key={block.id}>{renderTable(block)}</React.Fragment>;
  }

  return (
    <p
      key={block.id}
      style={{
        margin: 0,
        minHeight: block.height,
        textAlign: block.align,
        fontWeight: block.headingLevel ? 700 : undefined,
        fontSize: headingFontSize(block.headingLevel)
      }}
    >
      {renderParagraphRuns(block)}
    </p>
  );
}

export function ReactDocxViewer({
  file,
  model,
  className,
  layoutOptions,
  emptyState
}: ReactDocxViewerProps): React.JSX.Element {
  const { model: parsedModel, isLoading, error } = useDocxModel(model ? undefined : file);
  const resolvedModel = model ?? parsedModel;
  const modelWithSections = React.useMemo(() => {
    if (!resolvedModel) {
      return undefined;
    }

    const headerNodes = resolvedModel.metadata.headerSections[0]?.nodes ?? [];
    const footerNodes = resolvedModel.metadata.footerSections[0]?.nodes ?? [];
    if (headerNodes.length === 0 && footerNodes.length === 0) {
      return resolvedModel;
    }

    return {
      ...resolvedModel,
      nodes: [...headerNodes, ...resolvedModel.nodes, ...footerNodes]
    };
  }, [resolvedModel]);

  const resolvedLayoutOptions = React.useMemo(() => {
    if (!resolvedModel) {
      return layoutOptions;
    }

    const documentLayout = resolveDocumentLayout(resolvedModel);
    return {
      ...layoutOptions,
      pageWidth: layoutOptions?.pageWidth ?? documentLayout.pageWidthPx,
      pageHeight: layoutOptions?.pageHeight ?? documentLayout.pageHeightPx
    } satisfies LayoutOptions;
  }, [layoutOptions, resolvedModel]);

  const pages = React.useMemo(() => {
    if (!modelWithSections) {
      return [];
    }
    return layoutDocument(modelWithSections, resolvedLayoutOptions);
  }, [modelWithSections, resolvedLayoutOptions]);

  if (isLoading) {
    return <div className={className}>Loading DOCX...</div>;
  }

  if (error) {
    return <div className={className}>Failed to parse DOCX: {error.message}</div>;
  }

  if (!resolvedModel) {
    return <div className={className}>{emptyState ?? "No DOCX loaded."}</div>;
  }

  const pageWidth = resolvedLayoutOptions?.pageWidth ?? DEFAULT_DOCUMENT_LAYOUT.pageWidthPx;
  const pageHeight = resolvedLayoutOptions?.pageHeight ?? DEFAULT_DOCUMENT_LAYOUT.pageHeightPx;
  const pagePadding = resolvedLayoutOptions?.margin ?? 72;

  return (
    <div className={className} data-testid="react-docx-viewer" style={containerStyle}>
      {pages.map((page) => (
        <section
          key={page.number}
          data-page={page.number}
          style={{
            width: pageWidth,
            minHeight: pageHeight,
            boxSizing: "border-box",
            padding: pagePadding,
            background: "#fff",
            border: "1px solid #d4d4d4",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.08)",
            display: "grid",
            gap: 8,
            alignContent: "start"
          }}
        >
          {page.blocks.map(renderBlock)}
        </section>
      ))}
    </div>
  );
}

export {
  DocxEditorViewer,
  type DocxEditorController,
  type DocxDocumentTheme,
  type DocxFormFieldLocation,
  type DocxSelectedFormField,
  type DocxImageDropTarget,
  type DocxImageLocation,
  type DocxHeadingStyleMap,
  type DocxTextRange,
  type DocxTextRangeLocation,
  type DocxEditorSelection,
  type DocxEditorViewerProps,
  type DocxEditorViewerMode,
  type DocxContextMenuAction,
  type DocxContextMenuActionId,
  type DocxContextMenuContext,
  type DocxContextMenuRenderProps,
  type DocxImageWrapMenuOption,
  type DocxImageWrapMode,
  type DocxImageWrapState,
  type DocxTableContextMenuAction,
  type DocxTableContextMenuActionId,
  type DocxTableContextMenuContext,
  type DocxTableContextMenuRenderProps,
  type DocxTrackedChangeCardRenderProps,
  type DocxPageLayoutInfo,
  type DocxPaginationInfo,
  type DocxLineSpacingInfo,
  type DocxBorderContext,
  type DocxBorderPreset,
  type DocxBorderPresetState,
  type DocxSectionColumnLayout,
  type DocxListType,
  type DocxTrackedChange,
  type DocxTrackedChangeKind,
  type UseDocxDocumentThemeResult,
  type UseDocxImageWrapMenuResult,
  type UseDocxBordersResult,
  type UseDocxLineSpacingResult,
  type UseDocxFormFieldsResult,
  type UseDocxPageLayoutResult,
  type UseDocxPaginationResult,
  type UseDocxParagraphStylesResult,
  type UseDocxTrackChangesResult,
  defaultStarterModel,
  paragraphLetterheadFloatSideAtNodeIndex,
  useDocxDocumentTheme,
  useDocxBorders,
  useDocxImageWrapMenu,
  useDocxLineSpacing,
  useDocxFormFields,
  useDocxPageLayout,
  useDocxPagination,
  useDocxParagraphStyles,
  useDocxTrackChanges,
  useDocxEditor,
  type UseDocxEditorOptions
} from "./editor";

export {
  parseSectionLayout,
  resolveDocumentLayout
} from "./section-layout";
