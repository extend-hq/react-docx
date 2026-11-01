import type { LayoutFormField, LayoutImageRun, LayoutPage } from "@extend-ai/react-docx-layout-engine";
import type { DocxFormFieldLocation } from "../editor";

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
  fontSizePx?: number;
}

export interface DocxLayoutObjectGeometry {
  id: string;
  kind: "paragraph" | "table" | "image" | "form-field";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  nodeIndex?: number;
  lines?: DocxLayoutLineGeometry[];
  image?: LayoutImageRun;
  formField?: LayoutFormField;
  formFieldLocation?: DocxFormFieldLocation;
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
