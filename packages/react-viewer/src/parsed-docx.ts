import type { DocModel } from "@extend-ai/react-docx-doc-model";
import type { OoxmlPackage } from "@extend-ai/react-docx-ooxml-core";
import { invalidateFontMetrics } from "./font-metrics";
import {
  importDocxBuffer,
  type DocxImportOptions,
  type DocxImportResult,
} from "./docx-import";

export type DocxViewerSource = ArrayBuffer | ArrayBufferView | Blob;

export interface ParseDocxForViewerOptions extends DocxImportOptions {
  loadEmbeddedFonts?: boolean | "defer";
  fileName?: string;
}

export interface ParsedDocxPerformanceTimings {
  fileReadMs: number;
  parseMs: number;
  modelConstructionMs: number;
  fontLoadingMs: number;
  totalMs: number;
}

export interface ParsedDocxDocument {
  readonly model: DocModel;
  readonly package: OoxmlPackage;
  readonly source: DocxImportResult["source"];
  readonly fileName?: string;
  readonly timings: ParsedDocxPerformanceTimings;
  readonly embeddedFontsLoaded: boolean;
  loadEmbeddedFonts(): Promise<void>;
  dispose(): void;
}

interface EmbeddedFontDescriptor {
  family: string;
  style: "normal" | "italic";
  weight: string;
  source: ArrayBuffer;
}

function now(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function xmlAttribute(xml: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return xml.match(new RegExp(`${escapedName}="([^"]*)"`, "i"))?.[1];
}

function relationshipPartName(partName: string): string {
  const segments = partName.split("/");
  const name = segments.pop() ?? partName;
  const directory = segments.join("/");
  return directory ? `${directory}/_rels/${name}.rels` : `_rels/${name}.rels`;
}

function resolveRelativePartName(basePartName: string, target: string): string {
  if (/^[a-z]+:/i.test(target)) {
    return target;
  }
  if (target.startsWith("/")) {
    return target.replace(/^\/+/, "");
  }

  const segments = basePartName.replace(/^\/+/, "").split("/");
  segments.pop();
  target.split("/").forEach((segment) => {
    if (!segment || segment === ".") {
      return;
    }
    if (segment === "..") {
      segments.pop();
      return;
    }
    segments.push(segment);
  });
  return segments.join("/");
}

function parseRelationships(
  pkg: OoxmlPackage,
  partName: string
): Map<string, string> {
  const relationships = new Map<string, string>();
  const xml = pkg.parts.get(relationshipPartName(partName))?.content;
  if (!xml) {
    return relationships;
  }

  const pattern =
    /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) {
    const id = match[1]?.trim();
    const target = match[2]?.trim();
    if (id && target) {
      relationships.set(id, resolveRelativePartName(partName, target));
    }
  }
  return relationships;
}

function deobfuscateFontData(data: Uint8Array, key?: string): ArrayBuffer {
  const output = Uint8Array.from(data);
  const normalizedKey = (key ?? "").replace(/[{}-]/g, "");
  if (/^[0-9a-f]{32}$/i.test(normalizedKey)) {
    const keyBytes = Uint8Array.from(
      normalizedKey.match(/../g)?.map((pair) => Number.parseInt(pair, 16)) ?? []
    ).reverse();
    const length = Math.min(32, output.length);
    for (let index = 0; index < length; index += 1) {
      output[index] ^= keyBytes[index % keyBytes.length] ?? 0;
    }
  }
  return output.buffer.slice(
    output.byteOffset,
    output.byteOffset + output.byteLength
  );
}

function embeddedFontDescriptors(pkg: OoxmlPackage): EmbeddedFontDescriptor[] {
  const partName = "word/fontTable.xml";
  const xml = pkg.parts.get(partName)?.content;
  if (!xml) {
    return [];
  }

  const relationships = parseRelationships(pkg, partName);
  const descriptors: EmbeddedFontDescriptor[] = [];
  const fontPattern =
    /<w:font\b[^>]*w:name="([^"]+)"[^>]*>([\s\S]*?)<\/w:font>/gi;
  const variants = [
    { tag: "embedRegular", style: "normal" as const, weight: "400" },
    { tag: "embedBold", style: "normal" as const, weight: "700" },
    { tag: "embedItalic", style: "italic" as const, weight: "400" },
    { tag: "embedBoldItalic", style: "italic" as const, weight: "700" },
  ];

  let fontMatch: RegExpExecArray | null;
  while ((fontMatch = fontPattern.exec(xml))) {
    const family = fontMatch[1]?.trim();
    const fontXml = fontMatch[2] ?? "";
    if (!family) {
      continue;
    }

    variants.forEach((variant) => {
      const tagXml =
        fontXml.match(new RegExp(`<w:${variant.tag}\\b[^>]*\\/?>`, "i"))?.[0] ??
        "";
      const relationshipId = xmlAttribute(tagXml, "r:id");
      const resolvedPartName = relationshipId
        ? relationships.get(relationshipId)
        : undefined;
      const data = resolvedPartName
        ? pkg.binaryAssets.get(resolvedPartName)
        : undefined;
      if (!data) {
        return;
      }
      descriptors.push({
        family,
        style: variant.style,
        weight: variant.weight,
        source: deobfuscateFontData(data, xmlAttribute(tagXml, "w:fontKey")),
      });
    });
  }
  return descriptors;
}

async function sourceToArrayBuffer(
  source: DocxViewerSource
): Promise<ArrayBuffer> {
  if (source instanceof ArrayBuffer) {
    return source;
  }
  if (ArrayBuffer.isView(source)) {
    return source.buffer.slice(
      source.byteOffset,
      source.byteOffset + source.byteLength
    ) as ArrayBuffer;
  }
  return source.arrayBuffer();
}

export async function parseDocxForViewer(
  source: DocxViewerSource,
  options: ParseDocxForViewerOptions = {}
): Promise<ParsedDocxDocument> {
  const startedAt = now();
  const readStartedAt = now();
  const buffer = await sourceToArrayBuffer(source);
  const readFinishedAt = now();
  const importResult = await importDocxBuffer(buffer, {
    signal: options.signal,
    transferBuffer: options.transferBuffer ?? !(source instanceof ArrayBuffer),
    useWorker: options.useWorker,
  });
  const importFinishedAt = now();
  let faces: FontFace[] = [];
  let fontLoadingMs = 0;
  let fontLoadingComplete = false;
  let fontLoadPromise: Promise<void> | undefined;

  const dispose = (): void => {
    if (typeof document !== "undefined" && "fonts" in document) {
      faces.forEach((face) => {
        try {
          document.fonts.delete(face);
        } catch {
          // Best-effort cleanup.
        }
      });
    }
    if (faces.length > 0) {
      invalidateFontMetrics();
    }
    faces = [];
  };

  const loadEmbeddedFonts = (): Promise<void> => {
    if (fontLoadPromise) {
      return fontLoadPromise;
    }
    fontLoadPromise = (async () => {
      if (
        typeof document === "undefined" ||
        !("fonts" in document) ||
        typeof FontFace === "undefined"
      ) {
        fontLoadingComplete = true;
        return;
      }
      const fontStartedAt = now();
      const loaded = (
        await Promise.all(
          embeddedFontDescriptors(importResult.package).map(
            async (descriptor): Promise<FontFace | undefined> => {
              try {
                const face = new FontFace(
                  descriptor.family,
                  descriptor.source,
                  {
                    style: descriptor.style,
                    weight: descriptor.weight,
                  }
                );
                await face.load();
                return face;
              } catch {
                return undefined;
              }
            }
          )
        )
      ).filter((face): face is FontFace => Boolean(face));
      loaded.forEach((face) => document.fonts.add(face));
      if (loaded.length > 0) {
        invalidateFontMetrics();
      }
      faces = loaded;
      try {
        await document.fonts.ready;
      } catch {
        // Font readiness is best-effort.
      }
      fontLoadingMs += now() - fontStartedAt;
      fontLoadingComplete = true;
    })();
    return fontLoadPromise;
  };

  if (
    options.loadEmbeddedFonts !== false &&
    options.loadEmbeddedFonts !== "defer"
  ) {
    await loadEmbeddedFonts();
  }

  const nonFontTotalMs = importFinishedAt - startedAt;
  const timings: ParsedDocxPerformanceTimings = {
    fileReadMs: readFinishedAt - readStartedAt,
    parseMs: importResult.timings?.parseMs ?? importFinishedAt - readFinishedAt,
    modelConstructionMs: importResult.timings?.buildModelMs ?? 0,
    get fontLoadingMs() {
      return fontLoadingMs;
    },
    get totalMs() {
      return nonFontTotalMs + fontLoadingMs;
    },
  };

  return {
    model: importResult.model,
    package: importResult.package,
    source: importResult.source,
    fileName:
      options.fileName ??
      (typeof File !== "undefined" && source instanceof File
        ? source.name
        : undefined),
    timings,
    get embeddedFontsLoaded() {
      return fontLoadingComplete;
    },
    loadEmbeddedFonts,
    dispose,
  };
}
