import {
  cloneDocModel,
  resolveImagePaintBounds,
  type DocModel,
  type DocNode,
  type ImagePaintRect,
  type ImageRunNode,
  type ParagraphNode,
  type TableNode,
} from "@extend-ai/react-docx-doc-model";
import type { OoxmlPackage } from "@extend-ai/react-docx-ooxml-core";
import { canPreserveImagePaintSource } from "@extend-ai/react-docx-serializer";

export interface ImagePaintExportOptions {
  canPreserveSource?: (
    image: ImageRunNode,
    basePackage: OoxmlPackage | undefined,
    ownerPartName: string | undefined,
  ) => Promise<boolean>;
  rasterize?: (image: ImageRunNode, bounds: ImagePaintRect) => Promise<string>;
}

type SourceCache = ParagraphNode | TableNode;

function invalidateSourceCaches(caches: SourceCache[]): void {
  for (const node of caches) {
    delete node.sourceXml;
    if (node.type === "paragraph") {
      delete node.sourceTextPatch;
      delete node.sourceRunProvenance;
    } else {
      delete node.sourceTextPatches;
    }
  }
}

function pngDataUri(value: string): boolean {
  return /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value);
}

function canvasSize(width: number, height: number): [number, number] {
  const pixelWidth = Math.ceil(width);
  const pixelHeight = Math.ceil(height);
  if (!Number.isSafeInteger(pixelWidth) || !Number.isSafeInteger(pixelHeight)
    || pixelWidth <= 0 || pixelHeight <= 0
    || pixelWidth > 32767 || pixelHeight > 32767
    || pixelWidth * pixelHeight > 64 * 1024 * 1024) {
    throw new Error("Image paint viewport exceeds the available raster surface.");
  }
  return [pixelWidth, pixelHeight];
}

function decodeSvgDataUri(src: string): string {
  const comma = src.indexOf(",");
  if (comma < 0 || !/^data:image\/svg\+xml(?:;[^,]*)?$/i.test(src.slice(0, comma))) {
    throw new Error("Image paint export requires a self-contained SVG source.");
  }
  try {
    if (/;base64$/i.test(src.slice(0, comma))) {
      const bytes = Uint8Array.from(atob(src.slice(comma + 1)), (value) => value.charCodeAt(0));
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    return decodeURIComponent(src.slice(comma + 1));
  } catch {
    throw new Error("Image paint source could not be decoded.");
  }
}

function svgDimension(value: string | null): number | undefined {
  if (value === null || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function validateSvgSource(src: string, width: number, height: number): void {
  const document = new DOMParser().parseFromString(decodeSvgDataUri(src), "image/svg+xml");
  const root = document.documentElement;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
    || document.querySelector("parsererror") || root.localName !== "svg"
    || root.namespaceURI !== "http://www.w3.org/2000/svg"
    || Boolean(root.getAttribute("style")?.trim())
    || svgDimension(root.getAttribute("width")) !== width
    || svgDimension(root.getAttribute("height")) !== height) {
    throw new Error("Image paint source does not match its reference viewport.");
  }
  for (const node of [root, ...Array.from(root.querySelectorAll("*"))]) {
    if (["script", "foreignObject", "style", "animate", "animateTransform", "animateMotion", "animateColor", "set", "discard"].includes(node.localName)) {
      throw new Error("Image paint source requires unsupported dynamic rendering.");
    }
    for (const attribute of Array.from(node.attributes)) {
      if (attribute.localName === "href" && attribute.value !== ""
        && !attribute.value.startsWith("#")
        && !/^data:image\/(?:png|jpeg|gif|webp|bmp);base64,/i.test(attribute.value)) {
        if (/^data:image\/svg\+xml(?:;[^,]*)?,/i.test(attribute.value)) {
          const nested = new DOMParser().parseFromString(decodeSvgDataUri(attribute.value), "image/svg+xml");
          const nestedRoot = nested.documentElement;
          validateSvgSource(attribute.value, svgDimension(nestedRoot.getAttribute("width")) ?? Number.NaN, svgDimension(nestedRoot.getAttribute("height")) ?? Number.NaN);
        } else {
          throw new Error("Image paint source has an unresolved external resource.");
        }
      }
      for (const match of attribute.value.matchAll(/url\s*\(\s*(["']?)(.*?)\1\s*\)/gi)) {
        if (!match[2].startsWith("#")) {
          throw new Error("Image paint source has an unresolved style resource.");
        }
      }
    }
  }
}

async function loadedImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image paint source could not be loaded."));
    image.src = src;
  });
}

export async function rasterizeImagePaintBounds(
  image: ImageRunNode,
  bounds: ImagePaintRect,
): Promise<string> {
  const reference = image.paintBounds;
  if (!reference || !image.src) {
    throw new Error("Image paint export requires a current image source.");
  }
  if (typeof document === "undefined" || typeof Image === "undefined") {
    throw new Error("Image paint raster export requires a browser canvas.");
  }
  if (pngDataUri(image.src)) return image.src;
  validateSvgSource(image.src, reference.widthPx, reference.heightPx);
  const [referenceWidth, referenceHeight] = canvasSize(reference.widthPx, reference.heightPx);
  const [pixelWidth, pixelHeight] = canvasSize(bounds.widthPx, bounds.heightPx);
  const decoded = await loadedImage(image.src);
  const referenceCanvas = document.createElement("canvas");
  referenceCanvas.width = referenceWidth;
  referenceCanvas.height = referenceHeight;
  const referenceContext = referenceCanvas.getContext("2d");
  if (!referenceContext) throw new Error("Image paint reference surface is unavailable.");
  referenceContext.drawImage(decoded, 0, 0, reference.widthPx, reference.heightPx);
  const canvas = document.createElement("canvas");
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image paint export surface is unavailable.");
  context.drawImage(referenceCanvas, 0, 0, reference.widthPx, reference.heightPx,
    0, 0, pixelWidth, pixelHeight);
  const png = canvas.toDataURL("image/png");
  if (!pngDataUri(png)) throw new Error("Image paint export did not produce a PNG.");
  return png;
}

function containsImagePaintBounds(nodes: DocNode[]): boolean {
  const imageHasBounds = (image: ImageRunNode): boolean => Boolean(image.paintBounds)
    || Boolean(image.contentNodes && containsImagePaintBounds(image.contentNodes));
  return nodes.some((node) => node.type === "table"
    ? node.rows.some((row) => row.cells.some((cell) => containsImagePaintBounds(cell.nodes)))
      || Boolean(node.sourceTextPatches?.some((patch) => containsImagePaintBounds([patch.paragraph])))
    : node.children.some((child) => child.type === "image"
      ? imageHasBounds(child)
      : child.type === "form-field" && Boolean(child.sourcePreview && imageHasBounds(child.sourcePreview.image))));
}

function serializedStories(model: DocModel): Array<{ nodes: DocNode[]; owner?: string }> {
  const stories: Array<{ nodes: DocNode[]; owner?: string }> = [{ nodes: model.nodes }];
  const seenParts = new Set<string>();
  const add = (sections: Array<{ partName: string; nodes: DocNode[] }>): void => {
    for (const section of sections) {
      const owner = section.partName.startsWith("/") ? section.partName.slice(1) : section.partName;
      if (!owner || seenParts.has(owner)) continue;
      seenParts.add(owner);
      stories.push({ nodes: section.nodes, owner });
    }
  };
  add(model.metadata.headerSections);
  add(model.metadata.footerSections);
  for (const section of model.metadata.sections ?? []) {
    add(section.headerSections);
    add(section.footerSections);
  }
  return stories;
}

export async function prepareImagePaintBoundsForExport(
  model: DocModel,
  basePackage?: OoxmlPackage,
  options: ImagePaintExportOptions = {},
): Promise<DocModel> {
  if (!serializedStories(model).some((story) => containsImagePaintBounds(story.nodes))) return model;
  const snapshot = cloneDocModel(model);
  const preserve = options.canPreserveSource ?? canPreserveImagePaintSource;
  const rasterize = options.rasterize ?? rasterizeImagePaintBounds;

  async function visitImage(
    image: ImageRunNode,
    owner: string | undefined,
    caches: SourceCache[],
    unsupported?: string,
  ): Promise<void> {
    if (image.paintBounds) {
      const bounds = resolveImagePaintBounds(image);
      if (!bounds || image.floating || image.crop || image.cssFilter !== undefined
        || image.cssOpacity !== undefined) {
        throw new Error("Image paint bounds are invalid or conflict with image effects.");
      }
      if (await preserve(image, basePackage, owner)) return;
      {
        if (unsupported) throw new Error(`Image paint fallback is unsupported in ${unsupported}.`);
        const png = await rasterize(image, bounds);
        if (!pngDataUri(png)) throw new Error("Image paint export did not produce a PNG.");
        image.src = png;
        image.contentType = "image/png";
        image.paintBounds = { ...bounds, layoutWidthPx: image.widthPx!, layoutHeightPx: image.heightPx! };
        delete image.partName;
        delete image.data;
        delete image.sourceXml;
        delete image.contentNodes;
        delete image.syntheticTextBox;
        delete image.textBoxText;
        invalidateSourceCaches(caches);
        return;
      }
    }
    if (image.contentNodes) await visitNodes(image.contentNodes, owner, caches, "nested image stories");
  }

  async function visitNodes(
    nodes: DocNode[],
    owner: string | undefined,
    ancestors: SourceCache[] = [],
    unsupported?: string,
  ): Promise<void> {
    for (const node of nodes) {
      const caches = [...ancestors, node];
      if (node.type === "table") {
        for (const row of node.rows) for (const cell of row.cells) {
          await visitNodes(cell.nodes, owner, caches, unsupported);
        }
        for (const patch of node.sourceTextPatches ?? []) {
          await visitNodes([patch.paragraph], owner, caches, "source text patches");
        }
      } else {
        for (const child of node.children) {
          if (child.type === "image") await visitImage(child, owner, caches, unsupported);
          else if (child.type === "form-field" && child.sourcePreview) {
            await visitImage(child.sourcePreview.image, owner, caches, "form field previews");
          }
        }
      }
    }
  }

  for (const story of serializedStories(snapshot)) {
    await visitNodes(story.nodes, story.owner);
  }
  return snapshot;
}
