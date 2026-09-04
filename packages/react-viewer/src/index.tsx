import * as React from "react";
import { flushSync } from "react-dom";
import type { Root } from "react-dom/client";
import type { DocModel } from "@extend-ai/react-docx-doc-model";
import {
  layoutDocument,
  type LayoutBlock,
  type LayoutOptions,
  type LayoutPage,
  type LayoutParagraphBlock,
  type LayoutRun,
  type LayoutTableBlock,
} from "@extend-ai/react-docx-layout-engine";
import { importDocxBuffer } from "./docx-import";
import type { ParsedDocxDocument } from "./parsed-docx";
import {
  buildDocumentPageNodeSegments,
  resolveDocxPageThumbnailResolution,
  type DocxPageThumbnailBounds,
  type DocxThumbnailScheduling,
} from "./editor";
import {
  blitDocxThumbnailSurface,
  rasterizeDocxThumbnailSurface,
  SerialIdleTaskQueue,
} from "./thumbnail-raster";
import {
  DEFAULT_DOCUMENT_LAYOUT,
  parseSectionLayout,
  resolveDocumentLayout,
} from "./section-layout";
import {
  imageUsesPlaceholderFallback,
  resolveRenderableImageSource,
  unsupportedImageFallbackLabel,
} from "./image-render";
import {
  resolveDocxTextFontFamily,
  segmentTextByDocxScriptFont,
} from "./script-fonts";

export interface ReactDocxViewerProps {
  /**
   * Raw `.docx` file contents to parse and render.
   *
   * Pass either `file` or `model`. When both are provided, `model` wins and
   * the file buffer is ignored.
   *
   * @example
   * ```tsx
   * const buffer = await file.arrayBuffer();
   * <ReactDocxViewer file={buffer} />
   * ```
   */
  file?: ArrayBuffer;
  /**
   * Prebuilt document model to render without parsing a `.docx` buffer.
   *
   * Useful when you already parsed the document with `parseDocx` and
   * `buildDocModel`, or when you are rendering a model produced by your own
   * pipeline.
   */
  model?: DocModel;
  /** Parsed input returned by `parseDocxForViewer`. */
  document?: ParsedDocxDocument;
  /** Loads deferred embedded fonts when a parsed document is mounted. */
  loadEmbeddedFonts?: boolean;
  /** Hard set of zero-based pages to mount. */
  pageIndexes?: readonly number[];
  /**
   * CSS class applied to the outer viewer container.
   *
   * @example
   * ```tsx
   * <ReactDocxViewer file={buffer} className="docx-preview" />
   * ```
   */
  className?: string;
  /**
   * Layout overrides for the simple read-only renderer.
   *
   * If omitted, page width and height are derived from the document section
   * properties when available.
   *
   * @example
   * ```tsx
   * <ReactDocxViewer
   *   file={buffer}
   *   layoutOptions={{ pageWidth: 816, pageHeight: 1056, margin: 72 }}
   * />
   * ```
   */
  layoutOptions?: LayoutOptions;
  /**
   * Content shown when neither `file` nor `model` is provided.
   *
   * @defaultValue `"No DOCX loaded."`
   */
  emptyState?: React.ReactNode;
}

export interface UseDocxModelState {
  /** Parsed document model, available once loading succeeds. */
  model?: DocModel;
  /** True while the hook is parsing the current file buffer. */
  isLoading: boolean;
  /** Parse or model-build failure for the current file buffer. */
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
  lightgray: "#e5e7eb",
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
    isLoading: Boolean(file),
  });

  React.useEffect(() => {
    if (!file) {
      setState({ isLoading: false });
      return;
    }

    const docxFile = file;
    let isCurrent = true;
    const abortController = new AbortController();

    async function load(): Promise<void> {
      setState({ isLoading: true });
      try {
        const { model } = await importDocxBuffer(docxFile, {
          signal: abortController.signal,
          transferBuffer: false,
          useWorker: "required",
        });
        if (!isCurrent) {
          return;
        }
        setState({
          isLoading: false,
          model,
        });
      } catch (error) {
        if (!isCurrent) {
          return;
        }
        setState({
          isLoading: false,
          error:
            error instanceof Error
              ? error
              : new Error("Unknown DOCX parse error"),
        });
      }
    }

    void load();

    return () => {
      isCurrent = false;
      abortController.abort();
    };
  }, [file]);

  return state;
}

function runTextStyle(run: LayoutRun, text?: string): React.CSSProperties {
  if (run.kind === "image") {
    return {};
  }

  const hasScriptVerticalAlign =
    run.style?.verticalAlign === "superscript" ||
    run.style?.verticalAlign === "subscript";
  const verticalAlign =
    run.style?.verticalAlign === "superscript"
      ? "super"
      : run.style?.verticalAlign === "subscript"
      ? "sub"
      : undefined;
  const textDecorationTokens = [
    run.style?.underline ? "underline" : "",
    run.style?.strike ? "line-through" : "",
  ].filter(Boolean);
  const textDecoration =
    textDecorationTokens.length > 0 ? textDecorationTokens.join(" ") : "none";

  const style: React.CSSProperties = {
    fontWeight: run.style?.bold ? 700 : undefined,
    fontStyle: run.style?.italic ? "italic" : undefined,
    textDecoration,
    color: run.style?.color,
    backgroundColor: resolveHighlightColor(run.style?.highlight),
    fontSize: run.style?.fontSizePt
      ? `${Number(
          (
            run.style.fontSizePt *
            (hasScriptVerticalAlign ? SCRIPT_FONT_SCALE : 1)
          ).toFixed(3)
        )}pt`
      : hasScriptVerticalAlign
      ? `${SCRIPT_FONT_SCALE}em`
      : undefined,
    fontFamily: resolveDocxTextFontFamily(text ?? run.text, run.style),
    verticalAlign,
    whiteSpace: "pre-wrap",
  };

  return style;
}

function renderRunText(
  run: Extract<LayoutRun, { kind: "text" }>
): React.ReactNode {
  const segments = segmentTextByDocxScriptFont(run.text, run.style);
  if (segments.length <= 1) {
    return run.text;
  }

  return segments.map((segment, index) => (
    <span
      key={`${run.id}-script-${index}`}
      style={{ fontFamily: segment.fontFamily }}
    >
      {segment.text}
    </span>
  ));
}

function linkRunTextStyle(run: LayoutRun): React.CSSProperties {
  const base = runTextStyle(run);
  const resolvedTextDecoration =
    typeof base.textDecoration === "string" &&
    base.textDecoration.trim().length > 0
      ? base.textDecoration
      : "none";
  return {
    ...base,
    color: base.color ?? "inherit",
    textDecoration: resolvedTextDecoration,
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
              marginInline: 4,
            }}
          >
            Missing image
          </span>
        );
      }

      if (
        imageUsesPlaceholderFallback(run) ||
        (run.src && !renderableImageSrc)
      ) {
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
              fontSize:
                (run.widthPx ?? 0) <= 56 && (run.heightPx ?? 0) <= 56 ? 12 : 10,
              fontWeight: 700,
              textTransform: "lowercase",
              fontFamily: "Arial, sans-serif",
              lineHeight: 1,
              verticalAlign: "middle",
              marginInline: 4,
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
            marginInline: 4,
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
          {renderRunText(run)}
        </a>
      );
    }

    return (
      <span key={run.id} style={textStyle}>
        {renderRunText(run)}
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
        marginBottom: 8,
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
                  wordBreak: "break-word",
                }}
              >
                {cell.paragraphs.map((paragraph) => (
                  <p
                    key={paragraph.id}
                    style={{
                      margin: 0,
                      textAlign: paragraph.align,
                      fontWeight: paragraph.headingLevel ? 700 : undefined,
                      fontSize: headingFontSize(paragraph.headingLevel),
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
  gap: 16,
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
        fontSize: headingFontSize(block.headingLevel),
      }}
    >
      {renderParagraphRuns(block)}
    </p>
  );
}

export function ReactDocxViewer({
  file,
  model,
  document,
  loadEmbeddedFonts = true,
  pageIndexes,
  className,
  layoutOptions,
  emptyState,
}: ReactDocxViewerProps): React.JSX.Element {
  const {
    model: parsedModel,
    isLoading,
    error,
  } = useDocxModel(model || document ? undefined : file);
  const resolvedModel = model ?? document?.model ?? parsedModel;
  React.useEffect(() => {
    if (document && loadEmbeddedFonts && !document.embeddedFontsLoaded) {
      void document.loadEmbeddedFonts();
    }
  }, [document, loadEmbeddedFonts]);
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
      nodes: [...headerNodes, ...resolvedModel.nodes, ...footerNodes],
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
      pageHeight: layoutOptions?.pageHeight ?? documentLayout.pageHeightPx,
    } satisfies LayoutOptions;
  }, [layoutOptions, resolvedModel]);

  const pages = React.useMemo(() => {
    if (!modelWithSections) {
      return [];
    }
    return layoutDocument(modelWithSections, resolvedLayoutOptions);
  }, [modelWithSections, resolvedLayoutOptions]);
  const requestedPageIndexSet = React.useMemo(
    () =>
      pageIndexes === undefined
        ? undefined
        : new Set(
            pageIndexes
              .filter((pageIndex) => Number.isFinite(pageIndex))
              .map((pageIndex) => Math.trunc(pageIndex))
          ),
    [pageIndexes]
  );

  if (isLoading) {
    return <div className={className}>Loading DOCX...</div>;
  }

  if (error) {
    return (
      <div className={className}>Failed to parse DOCX: {error.message}</div>
    );
  }

  if (!resolvedModel) {
    return <div className={className}>{emptyState ?? "No DOCX loaded."}</div>;
  }

  const pageWidth =
    resolvedLayoutOptions?.pageWidth ?? DEFAULT_DOCUMENT_LAYOUT.pageWidthPx;
  const pageHeight =
    resolvedLayoutOptions?.pageHeight ?? DEFAULT_DOCUMENT_LAYOUT.pageHeightPx;
  const pagePadding = resolvedLayoutOptions?.margin ?? 72;

  return (
    <div
      className={className}
      data-testid="react-docx-viewer"
      style={containerStyle}
    >
      {pages.map((page, pageIndex) =>
        requestedPageIndexSet &&
        !requestedPageIndexSet.has(pageIndex) ? null : (
          <section
            key={page.number}
            data-page={page.number}
            data-page-index={pageIndex}
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
              alignContent: "start",
            }}
          >
            {page.blocks.map(renderBlock)}
          </section>
        )
      )}
    </div>
  );
}

export type DocxThumbnailOutput = "canvas" | "blob" | "imageBitmap";

export interface CreateDocxThumbnailRendererOptions {
  scheduling?: DocxThumbnailScheduling;
  pixelRatio?: number;
  resolution?: DocxPageThumbnailBounds;
  pageIndexes?: readonly number[];
}

export interface RenderDocxThumbnailPageOptions {
  scheduling?: DocxThumbnailScheduling;
  pixelRatio?: number;
  resolution?: DocxPageThumbnailBounds;
  maxWidth?: number;
  maxHeight?: number;
  output?: DocxThumbnailOutput;
  canvas?: HTMLCanvasElement;
  mimeType?: string;
  quality?: number;
}

export interface DocxThumbnailRenderTimings {
  paginationMs: number;
  pageMountMs: number;
  rasterizationMs: number;
  encodingMs: number;
  totalMs: number;
}

export interface DocxThumbnailRenderResult {
  pageIndex: number;
  pageCount: number;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  output: DocxThumbnailOutput;
  canvas?: HTMLCanvasElement;
  blob?: Blob;
  imageBitmap?: ImageBitmap;
  timings: DocxThumbnailRenderTimings;
}

export type DocxThumbnailDocument = ParsedDocxDocument | DocModel;

export interface DocxThumbnailRenderer {
  readonly document: DocxThumbnailDocument;
  readonly pageCount: number;
  renderPage(
    pageIndex: number,
    options?: RenderDocxThumbnailPageOptions
  ): Promise<DocxThumbnailRenderResult>;
  dispose(): void;
}

function thumbnailNow(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to encode DOCX thumbnail."));
        }
      },
      mimeType,
      quality
    );
  });
}

export function createDocxThumbnailRenderer(
  documentModel: DocxThumbnailDocument,
  options: CreateDocxThumbnailRendererOptions = {}
): DocxThumbnailRenderer {
  const model = "model" in documentModel ? documentModel.model : documentModel;
  const layout = resolveDocumentLayout(model);
  const layoutOptions: LayoutOptions = {
    pageWidth: layout.pageWidthPx,
    pageHeight: layout.pageHeightPx,
  };
  const headerNodes = model.metadata.headerSections[0]?.nodes ?? [];
  const footerNodes = model.metadata.footerSections[0]?.nodes ?? [];
  const paginationStartedAt = thumbnailNow();
  const builtPageSegments = buildDocumentPageNodeSegments(
    model,
    Math.max(
      120,
      layout.pageHeightPx - layout.marginsPx.top - layout.marginsPx.bottom
    ),
    Math.max(
      120,
      layout.pageWidthPx - layout.marginsPx.left - layout.marginsPx.right
    ),
    model.metadata.numberingDefinitions
  );
  const pageSegments =
    builtPageSegments.length > 0 ? builtPageSegments : ([[]] as const);
  const paginationMs = thumbnailNow() - paginationStartedAt;
  const pageLayoutCache = new Map<number, LayoutPage>();
  const layoutPage = (
    pageIndex: number
  ): { page: LayoutPage; paginationMs: number } => {
    const cached = pageLayoutCache.get(pageIndex);
    if (cached) {
      return { page: cached, paginationMs: 0 };
    }
    const startedAt = thumbnailNow();
    const nodeIndexes = new Set(
      (pageSegments[pageIndex] ?? []).map((segment) => segment.nodeIndex)
    );
    const pageModel: DocModel = {
      ...model,
      nodes: [
        ...headerNodes,
        ...model.nodes.filter((_, nodeIndex) =>
          nodeIndexes.has(nodeIndex)
        ),
        ...footerNodes,
      ],
    };
    const page = layoutDocument(pageModel, layoutOptions)[0];
    if (!page) {
      throw new RangeError(`DOCX page index ${pageIndex} is unavailable.`);
    }
    pageLayoutCache.set(pageIndex, page);
    return { page, paginationMs: thumbnailNow() - startedAt };
  };
  const allowedPageIndexes =
    options.pageIndexes === undefined
      ? undefined
      : new Set(
          options.pageIndexes
            .filter((pageIndex) => Number.isFinite(pageIndex))
            .map((pageIndex) => Math.trunc(pageIndex))
        );
  const queue = new SerialIdleTaskQueue<string>({ minTaskIntervalMs: 0 });
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;
  let rootPromise: Promise<Root> | undefined;
  let requestId = 0;
  let disposed = false;

  const ensureRoot = async (): Promise<Root> => {
    if (disposed) {
      throw new Error("DOCX thumbnail renderer has been disposed.");
    }
    if (root) {
      return root;
    }
    if (!rootPromise) {
      rootPromise = (async () => {
        if (typeof document === "undefined") {
          throw new Error("DOCX thumbnail rendering requires a browser DOM.");
        }
        const nextHost = document.createElement("div");
        nextHost.setAttribute("data-docx-thumbnail-renderer", "true");
        Object.assign(nextHost.style, {
          position: "fixed",
          left: "-100000px",
          top: "0",
          overflow: "visible",
          pointerEvents: "none",
        });
        document.body.appendChild(nextHost);
        host = nextHost;
        const { createRoot } = await import("react-dom/client");
        const nextRoot = createRoot(nextHost);
        if (disposed) {
          nextRoot.unmount();
          nextHost.remove();
          throw new Error("DOCX thumbnail renderer has been disposed.");
        }
        root = nextRoot;
        return root;
      })();
    }
    return rootPromise;
  };

  const renderImmediately = async (
    pageIndex: number,
    renderOptions: RenderDocxThumbnailPageOptions
  ): Promise<DocxThumbnailRenderResult> => {
    const startedAt = thumbnailNow();
    if (
      !Number.isInteger(pageIndex) ||
      pageIndex < 0 ||
      pageIndex >= pageSegments.length
    ) {
      throw new RangeError(`DOCX page index ${pageIndex} is out of range.`);
    }
    if (allowedPageIndexes && !allowedPageIndexes.has(pageIndex)) {
      throw new RangeError(`DOCX page index ${pageIndex} was not requested.`);
    }

    const resolvedPage = layoutPage(pageIndex);
    const renderPaginationMs = paginationMs + resolvedPage.paginationMs;
    const pageMountStartedAt = thumbnailNow();
    const activeRoot = await ensureRoot();
    flushSync(() => {
      activeRoot.render(
        <section
          data-docx-thumbnail-page-index={pageIndex}
          style={{
            width: layout.pageWidthPx,
            minHeight: layout.pageHeightPx,
            boxSizing: "border-box",
            padding: `${layout.marginsPx.top}px ${layout.marginsPx.right}px ${layout.marginsPx.bottom}px ${layout.marginsPx.left}px`,
            background: "#fff",
            display: "grid",
            gap: 8,
            alignContent: "start",
          }}
        >
          {resolvedPage.page.blocks.map(renderBlock)}
        </section>
      );
    });
    const pageElement = host?.querySelector<HTMLElement>(
      `[data-docx-thumbnail-page-index="${pageIndex}"]`
    );
    if (!pageElement) {
      throw new Error("Failed to mount the requested DOCX page.");
    }
    const pageMountMs = thumbnailNow() - pageMountStartedAt;
    const resolution = resolveDocxPageThumbnailResolution({
      sourceWidthPx: layout.pageWidthPx,
      sourceHeightPx: layout.pageHeightPx,
      resolution: renderOptions.resolution ?? options.resolution,
      maxWidthPx: renderOptions.maxWidth,
      maxHeightPx: renderOptions.maxHeight,
      pixelRatio: renderOptions.pixelRatio ?? options.pixelRatio,
    });

    const rasterStartedAt = thumbnailNow();
    const surface = await rasterizeDocxThumbnailSurface({
      pageElement,
      sourceWidthPx: layout.pageWidthPx,
      sourceHeightPx: layout.pageHeightPx,
      widthPx: resolution.widthPx,
      heightPx: resolution.heightPx,
      pixelWidthPx: resolution.pixelWidthPx,
      pixelHeightPx: resolution.pixelHeightPx,
    });
    const rasterizationMs = thumbnailNow() - rasterStartedAt;
    const output = renderOptions.output ?? "canvas";
    const outputCanvas = renderOptions.canvas ?? surface;
    if (outputCanvas !== surface) {
      blitDocxThumbnailSurface(surface, outputCanvas, resolution);
    }

    const encodingStartedAt = thumbnailNow();
    let blob: Blob | undefined;
    let imageBitmap: ImageBitmap | undefined;
    if (output === "blob") {
      blob = await canvasToBlob(
        outputCanvas,
        renderOptions.mimeType ?? "image/png",
        renderOptions.quality
      );
    } else if (output === "imageBitmap") {
      if (typeof createImageBitmap !== "function") {
        throw new Error("ImageBitmap output is not supported in this browser.");
      }
      imageBitmap = await createImageBitmap(outputCanvas);
    }
    const encodingMs = thumbnailNow() - encodingStartedAt;

    return {
      pageIndex,
      pageCount: pageSegments.length,
      width: resolution.widthPx,
      height: resolution.heightPx,
      pixelWidth: resolution.pixelWidthPx,
      pixelHeight: resolution.pixelHeightPx,
      output,
      canvas: output === "canvas" ? outputCanvas : undefined,
      blob,
      imageBitmap,
      timings: {
        paginationMs: renderPaginationMs,
        pageMountMs,
        rasterizationMs,
        encodingMs,
        totalMs: paginationMs + thumbnailNow() - startedAt,
      },
    };
  };

  return {
    document: documentModel,
    pageCount: pageSegments.length,
    renderPage(pageIndex, renderOptions = {}) {
      const scheduling =
        renderOptions.scheduling ?? options.scheduling ?? "idle";
      if (scheduling === "immediate") {
        return renderImmediately(pageIndex, renderOptions);
      }
      requestId += 1;
      let result: DocxThumbnailRenderResult | undefined;
      let failure: unknown;
      return queue
        .enqueue(
          `page:${pageIndex}:${requestId}`,
          async () => {
            try {
              result = await renderImmediately(pageIndex, renderOptions);
            } catch (error) {
              failure = error;
            }
          },
          { priority: 0 }
        )
        .then(() => {
          if (failure) {
            throw failure;
          }
          if (!result) {
            throw new Error("DOCX thumbnail request was cancelled.");
          }
          return result;
        });
    },
    dispose() {
      disposed = true;
      queue.clear();
      root?.unmount();
      root = undefined;
      rootPromise = undefined;
      host?.remove();
      host = undefined;
    },
  };
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
  type DocxPageVirtualizationOptions,
  type DocxVisiblePageRange,
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
  type DocxComment,
  type DocxCommentCardRenderProps,
  type DocxCreateCommentOptions,
  type DocxAnnotationCommandFailureReason,
  type DocxAnnotationCommandResult,
  type DocxCommentCreationCommandResult,
  type UseDocxCommentsResult,
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
  type UseDocxViewerThumbnailsOptions,
  type DocxViewerThumbnails,
  type UseDocxPageThumbnailsOptions,
  type UseDocxPageThumbnailsResult,
  type UseDocxPageLayoutResult,
  type DocxPageThumbnailItem,
  type DocxPageThumbnailBounds,
  type DocxPageThumbnailRenderWindow,
  type DocxPageThumbnailResolution,
  type DocxPageThumbnailResolutionOptions,
  type DocxPageThumbnailStatus,
  type DocxRenderToCanvasOptions,
  type DocxThumbnailScheduling,
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
  useDocxPageThumbnails,
  useDocxViewerThumbnails,
  useDocxPageLayout,
  useDocxPagination,
  useDocxParagraphStyles,
  useDocxTrackChanges,
  useDocxComments,
  useDocxEditor,
  resolveDocxPageThumbnailResolution,
  type UseDocxEditorOptions,
} from "./editor";

export {
  parseDocxForViewer,
  type DocxViewerSource,
  type ParseDocxForViewerOptions,
  type ParsedDocxDocument,
  type ParsedDocxPerformanceTimings,
} from "./parsed-docx";

export { parseSectionLayout, resolveDocumentLayout } from "./section-layout";

export * from "@extend-ai/react-docx-ooxml-core";
export * from "@extend-ai/react-docx-doc-model";
export * from "@extend-ai/react-docx-editor-ops";
export * from "@extend-ai/react-docx-layout-engine";
export * from "@extend-ai/react-docx-layout-core";
export * from "@extend-ai/react-docx-serializer";

export { initWasm, setWasmSource, type WasmSource } from "./wasm-source";
