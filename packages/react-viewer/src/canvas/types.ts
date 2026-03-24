import type { LayoutPage } from "@react-docx/layout-engine";

export type DocxRenderEngine = "dom" | "canvas" | "auto";

export interface DocxCanvasOptions {
  maxFPS?: number;
  overscanPages?: number;
  debugLayout?: boolean;
  worker?: boolean;
}

export interface DocxLayoutLineGeometry {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DocxLayoutObjectGeometry {
  id: string;
  kind: "paragraph" | "table" | "image";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  nodeIndex?: number;
  lines?: DocxLayoutLineGeometry[];
}

export interface DocxLayoutPageGeometry {
  page: number;
  width: number;
  height: number;
  objects: DocxLayoutObjectGeometry[];
}

export interface DocxLayoutDiagnostics {
  generatedAt: number;
  pages: DocxLayoutPageGeometry[];
  sourceLayoutPages: LayoutPage[];
}
