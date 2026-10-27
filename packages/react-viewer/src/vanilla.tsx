import * as React from "react";
import { createRoot } from "react-dom/client";
import type { Properties as CssProperties } from "csstype";
import {
  DocxEditorViewer,
  useDocxEditor,
  type DocxCommentCardRenderProps,
  type DocxContextMenuRenderProps,
  type DocxEditorController,
  type DocxEditorViewerMode,
  type DocxFormFieldLocation,
  type DocxHeadingStyleMap,
  type DocxPageVirtualizationOptions,
  type DocxTableContextMenuRenderProps,
  type DocxTrackedChangeCardRenderProps,
  type DocxVisiblePageRange,
  type UseDocxEditorOptions,
} from "./editor";
import type { ViewerZoomLevel, ViewerZoomState } from "./viewer-zoom";

export { initWasm, setWasmSource, type WasmSource } from "./wasm-source";
export { parseDocxForViewer } from "./parsed-docx";
export type { ParsedDocxDocument, ParseDocxForViewerOptions, DocxViewerSource } from "./parsed-docx";
export type {
  DocxCommentCardRenderProps,
  DocxContextMenuRenderProps,
  DocxEditorController,
  DocxEditorViewerMode,
  DocxFormFieldLocation,
  DocxHeadingStyleMap,
  DocxPageVirtualizationOptions,
  DocxTableContextMenuRenderProps,
  DocxTrackedChangeCardRenderProps,
  DocxVisiblePageRange,
  UseDocxEditorOptions,
} from "./editor";
export type { ViewerZoomLevel, ViewerZoomState } from "./viewer-zoom";
export type { DocModel } from "@extend-ai/react-docx-doc-model";

export type DocxVanillaContent = Node | string | number | null;

export interface DocxVanillaViewerOptions extends UseDocxEditorOptions {
  file?: ArrayBuffer | Blob;
  src?: string;
  fileName?: string;
  className?: string;
  style?: CssProperties<string | number>;
  height?: CssProperties<string | number>["height"];
  zoom?: ViewerZoomLevel;
  defaultZoom?: ViewerZoomLevel;
  onZoomChange?: (state: ViewerZoomState) => void;
  pageBackgroundColor?: string;
  pageGapBackgroundColor?: string;
  deferInitialPaginationPaint?: boolean;
  pageVirtualization?: DocxPageVirtualizationOptions;
  visiblePageRange?: DocxVisiblePageRange;
  pageIndexes?: readonly number[];
  onPageCountChange?: (pageCount: number) => void;
  onRequestPageReveal?: (pageIndex: number) => void;
  headingStyles?: DocxHeadingStyleMap;
  mode?: DocxEditorViewerMode;
  showTrackedChanges?: boolean;
  showComments?: boolean;
  onFormFieldDoubleClick?: (location: DocxFormFieldLocation) => void;
  emptyState?: DocxVanillaContent;
  loadingState?: DocxVanillaContent;
  errorState?: DocxVanillaContent | ((error: Error) => DocxVanillaContent);
  renderTrackedChangeCard?: (props: DocxTrackedChangeCardRenderProps) => DocxVanillaContent;
  renderCommentCard?: (props: DocxCommentCardRenderProps) => DocxVanillaContent;
  renderTableContextMenu?: (props: DocxTableContextMenuRenderProps) => DocxVanillaContent;
  renderContextMenu?: (props: DocxContextMenuRenderProps) => DocxVanillaContent;
}

export interface DocxVanillaViewerController extends DocxEditorController {
  isLoading: boolean;
  error?: Error;
  hasDocument: boolean;
}

export interface DocxVanillaViewer {
  readonly element: HTMLElement;
  getController(): DocxVanillaViewerController | null;
  reload(): void;
  setOptions(options: Partial<DocxVanillaViewerOptions>): void;
  subscribe(listener: (controller: DocxVanillaViewerController) => void): () => void;
  destroy(): void;
}

function DomContent({ node }: { node: Node }) {
  const hostRef = React.useRef<HTMLSpanElement>(null);

  React.useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren(node);
    return () => {
      if (node.parentNode === host) host.removeChild(node);
    };
  }, [node]);

  return <span ref={hostRef} style={{ display: "contents" }} />;
}

function toReactContent(content: DocxVanillaContent | undefined): React.ReactNode {
  return content !== null && typeof content === "object"
    ? <DomContent node={content} />
    : content;
}

function fileNameForSource(options: DocxVanillaViewerOptions, owner: Document): string {
  if (options.fileName) return options.fileName;
  if (options.file && "name" in options.file && typeof options.file.name === "string") {
    return options.file.name;
  }
  if (options.src) {
    try {
      const name = decodeURIComponent(new URL(options.src, owner.baseURI).pathname.split("/").pop() ?? "");
      if (/\.docx?$/i.test(name)) return name;
    } catch {
      return "document.docx";
    }
  }
  return "document.docx";
}

function VanillaViewerRoot({
  generation,
  options,
  owner,
  publish,
}: {
  generation: number;
  options: DocxVanillaViewerOptions;
  owner: Document;
  publish: (controller: DocxVanillaViewerController, generation: number) => void;
}) {
  const editor = useDocxEditor(options);
  const hasSource = options.file !== undefined || options.src !== undefined;
  const [sourceLoading, setSourceLoading] = React.useState(hasSource);
  const [sourceError, setSourceError] = React.useState<Error>();
  const [hasBlankDocument, setHasBlankDocument] = React.useState(options.mode === "edit");
  const sourceAbortRef = React.useRef<AbortController | undefined>(undefined);
  const sourceCanceledRef = React.useRef(false);

  const cancelSource = React.useCallback(() => {
    sourceCanceledRef.current = true;
    sourceAbortRef.current?.abort();
    sourceAbortRef.current = undefined;
    setSourceLoading(false);
    setSourceError(undefined);
  }, []);
  const importDocxFile = React.useCallback((file: File) => {
    cancelSource();
    return editor.importDocxFile(file);
  }, [cancelSource, editor.importDocxFile]);
  const newDocument = React.useCallback(() => {
    cancelSource();
    editor.newDocument();
  }, [cancelSource, editor.newDocument]);

  React.useLayoutEffect(() => {
    if (options.mode === "edit") setHasBlankDocument(true);
  }, [options.mode]);

  React.useEffect(() => {
    if (!hasSource || sourceCanceledRef.current) return;
    const abort = new AbortController();
    sourceAbortRef.current = abort;
    let active = true;

    async function load() {
      try {
        let source = options.file;
        if (options.src !== undefined) {
          const response = await fetch(options.src, { signal: abort.signal });
          if (!response.ok) throw new Error(`Failed to load document (${response.status} ${response.statusText})`);
          source = await response.blob();
        }
        if (!active || abort.signal.aborted || source === undefined) return;
        const FileConstructor = owner.defaultView?.File ?? File;
        const file = new FileConstructor([source], fileNameForSource(options, owner));
        await editor.importDocxFile(file);
      } catch (error) {
        if (active && !abort.signal.aborted) {
          setSourceError(error instanceof Error ? error : new Error("Failed to load document"));
        }
      } finally {
        if (active && sourceAbortRef.current === abort) {
          sourceAbortRef.current = undefined;
          setSourceLoading(false);
        }
      }
    }

    void load();
    return () => {
      active = false;
      abort.abort();
    };
  }, [editor.importDocxFile, hasSource, options.file, options.src, options.fileName, owner]);

  const isLoading = sourceLoading || editor.isImporting;
  const error = sourceError ?? editor.importError;
  const hasDocument = !isLoading && !error && (
    hasSource || editor.documentLoadNonce > 0 || options.document !== undefined ||
    options.starterModel !== undefined || hasBlankDocument || options.mode === "edit"
  );
  const controller: DocxVanillaViewerController = {
    ...editor,
    importDocxFile,
    newDocument,
    isLoading,
    error,
    hasDocument,
    status: sourceError ? sourceError.message : sourceLoading ? "Loading document..." : editor.status,
  };

  React.useLayoutEffect(() => publish(controller, generation), [controller, generation, publish]);

  const {
    file: _file,
    src: _src,
    fileName: _fileName,
    document: _document,
    starterModel: _starterModel,
    loadEmbeddedFonts: _loadEmbeddedFonts,
    initialFileName: _initialFileName,
    initialStatus: _initialStatus,
    initialDocumentTheme: _initialDocumentTheme,
    initialShowTrackedChanges: _initialShowTrackedChanges,
    initialShowComments: _initialShowComments,
    height,
    style,
    emptyState,
    loadingState,
    errorState,
    renderTrackedChangeCard,
    renderCommentCard,
    renderTableContextMenu,
    renderContextMenu,
    ...viewerOptions
  } = options;

  const containerStyle = { ...style, ...(height !== undefined ? { height } : {}) };
  const stateProps = { className: viewerOptions.className, style: containerStyle };
  if (isLoading) return <div {...stateProps} role="status">{toReactContent(loadingState === undefined ? "Loading document..." : loadingState)}</div>;
  if (error) {
    const content = typeof errorState === "function" ? errorState(error) : errorState;
    return <div {...stateProps} role="alert">{toReactContent(content === undefined ? error.message : content)}</div>;
  }
  if (!hasDocument) return <div {...stateProps}>{toReactContent(emptyState === undefined ? "No DOCX loaded." : emptyState)}</div>;

  return (
    <DocxEditorViewer
      {...viewerOptions}
      editor={editor}
      mode={viewerOptions.mode ?? "read-only"}
      style={containerStyle}
      loadingState={toReactContent(loadingState)}
      renderTrackedChangeCard={renderTrackedChangeCard ? (props) => toReactContent(renderTrackedChangeCard(props)) : undefined}
      renderCommentCard={renderCommentCard ? (props) => toReactContent(renderCommentCard(props)) : undefined}
      renderTableContextMenu={renderTableContextMenu ? (props) => toReactContent(renderTableContextMenu(props)) : undefined}
      renderContextMenu={renderContextMenu ? (props) => toReactContent(renderContextMenu(props)) : undefined}
    />
  );
}

function mergeOptions(
  current: DocxVanillaViewerOptions,
  next: Partial<DocxVanillaViewerOptions>
): DocxVanillaViewerOptions {
  if (next.file !== undefined && next.src !== undefined) {
    throw new TypeError("Provide either file or src, not both.");
  }
  const merged = { ...current, ...next };
  if (next.file !== undefined) merged.src = undefined;
  if (next.src !== undefined) merged.file = undefined;
  return merged;
}

function createViewer(
  container: Element | DocumentFragment,
  initialOptions: DocxVanillaViewerOptions
): DocxVanillaViewer {
  let options = mergeOptions({}, initialOptions);
  const element = container.ownerDocument.createElement("div");
  element.style.display = "contents";
  container.appendChild(element);
  const root = createRoot(element);
  const listeners = new Set<(controller: DocxVanillaViewerController) => void>();
  let controller: DocxVanillaViewerController | null = null;
  let destroyed = false;
  let notificationPending = false;
  let generation = 0;

  const publish = (next: DocxVanillaViewerController, publishedGeneration: number) => {
    if (destroyed || publishedGeneration !== generation) return;
    controller = next;
    if (notificationPending) return;
    notificationPending = true;
    queueMicrotask(() => {
      notificationPending = false;
      if (destroyed || !controller) return;
      const current = controller;
      for (const listener of listeners) listener(current);
    });
  };

  const render = () => root.render(
    <VanillaViewerRoot key={generation} generation={generation} options={options} owner={element.ownerDocument} publish={publish} />
  );
  const assertActive = () => {
    if (destroyed) throw new Error("The viewer has been destroyed.");
  };

  render();

  return {
    element,
    getController: () => controller,
    reload() {
      assertActive();
      generation += 1;
      controller = null;
      render();
    },
    setOptions(next) {
      assertActive();
      const updated = mergeOptions(options, next);
      if (
        updated.file !== options.file || updated.src !== options.src ||
        updated.fileName !== options.fileName || updated.document !== options.document ||
        updated.starterModel !== options.starterModel
      ) {
        generation += 1;
        controller = null;
      }
      options = updated;
      render();
    },
    subscribe(listener) {
      assertActive();
      listeners.add(listener);
      if (controller) listener(controller);
      return () => { listeners.delete(listener); };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
      controller = null;
      root.unmount();
      element.remove();
    },
  };
}

export class DocxViewer implements DocxVanillaViewer {
  readonly element: HTMLElement;
  private readonly viewer: DocxVanillaViewer;

  constructor(container: Element | DocumentFragment, options: DocxVanillaViewerOptions = {}) {
    this.viewer = createViewer(container, options);
    this.element = this.viewer.element;
  }

  getController() { return this.viewer.getController(); }
  setOptions(options: Partial<DocxVanillaViewerOptions>) { this.viewer.setOptions(options); }
  reload() { this.viewer.reload(); }
  subscribe(listener: (controller: DocxVanillaViewerController) => void) { return this.viewer.subscribe(listener); }
  destroy() { this.viewer.destroy(); }
}

export function createDocxViewer(
  container: Element | DocumentFragment,
  options: DocxVanillaViewerOptions = {}
): DocxViewer {
  return new DocxViewer(container, options);
}
