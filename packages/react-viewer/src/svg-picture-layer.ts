import type { ImageRunNode } from "@extend-ai/react-docx-doc-model";

interface SvgPictureLayerInfo {
  containsPicture: boolean;
  textContents?: string[];
}

const pictureLayerCache = new WeakMap<
  Pick<ImageRunNode, "src">,
  SvgPictureLayerInfo & { src: string }
>();

function svgPictureLayerInfo(svg: string): SvgPictureLayerInfo {
  const tags = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?([A-Za-z_][\w:.-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/g;
  const stack: Array<{ name: string; visible: boolean; textStart?: number }> = [];
  const textContents: string[] = [];
  let hasDirectText = true;
  let hasRoot = false;
  let containsPicture = false;

  for (const match of svg.matchAll(tags)) {
    const name = match[1];
    if (!name) continue;
    const tag = match[0];
    if (tag.startsWith("</")) {
      const opening = stack.pop();
      if (opening?.name !== name) return { containsPicture: false };
      if (opening.textStart !== undefined) {
        const content = svg.slice(opening.textStart, match.index);
        if (content.includes("<")) hasDirectText = false;
        else textContents.push(content);
      }
      continue;
    }

    if (stack.length === 0) {
      if (hasRoot || name !== "svg") return { containsPicture: false };
      hasRoot = true;
    }
    const attribute = (key: string): string | undefined =>
      tag.match(new RegExp(`\\s${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`))
        ?.slice(1).find((value) => value !== undefined);
    if (stack.length === 0 && attribute("xmlns") !== "http://www.w3.org/2000/svg") {
      return { containsPicture: false };
    }
    const parentVisible = stack.length === 0 || stack[stack.length - 1].visible;
    const visible = parentVisible &&
      attribute("display") !== "none" &&
      attribute("visibility") !== "hidden" &&
      Number.parseFloat(attribute("opacity") ?? "1") !== 0 &&
      !/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0*)?)\s*(?:;|$)/i.test(attribute("style") ?? "");

    if (name === "image" && visible) {
      const href = attribute("(?:xlink:)?href");
      containsPicture ||= Boolean(
        href && /^data:image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml)(?:;|,)/i.test(href) &&
        Number.parseFloat(attribute("width") ?? "0") > 0 &&
        Number.parseFloat(attribute("height") ?? "0") > 0
      );
    }
    if (!tag.endsWith("/>")) {
      stack.push({
        name,
        textStart: name === "text" && visible ? match.index + tag.length : undefined,
        visible: visible && (name === "svg" || name === "g" || name === "a"),
      });
    }
  }
  return {
    containsPicture: hasRoot && stack.length === 0 && containsPicture,
    textContents: hasDirectText ? textContents : undefined,
  };
}

function pictureLayerInfo(image: Pick<ImageRunNode, "src">): SvgPictureLayerInfo | undefined {
  const src = image.src;
  if (!src?.startsWith("data:image/svg+xml")) return undefined;
  const cached = pictureLayerCache.get(image);
  if (cached?.src === src) return cached;

  let info: SvgPictureLayerInfo = { containsPicture: false };
  try {
    const separator = src.indexOf(",");
    if (separator !== -1) {
      const metadata = src.slice(0, separator);
      const payload = src.slice(separator + 1);
      const svg = /;base64$/i.test(metadata)
        ? new TextDecoder("utf-8", { fatal: true }).decode(
            Uint8Array.from(atob(payload), (character) => character.charCodeAt(0))
          )
        : decodeURIComponent(payload);
      info = svgPictureLayerInfo(svg);
    }
  } catch {
    info = { containsPicture: false };
  }
  pictureLayerCache.set(image, { src, ...info });
  return info;
}

export function hasSvgPictureLayer(image: Pick<ImageRunNode, "src">): boolean {
  return pictureLayerInfo(image)?.containsPicture ?? false;
}

export function svgPictureTextContents(image: Pick<ImageRunNode, "src">): readonly string[] | undefined {
  return pictureLayerInfo(image)?.textContents;
}
