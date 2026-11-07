export function collectCorpusPageMetrics() {
  const controller = window.viewer?.getController();
  const sourceTexts = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (value.type === "text" && typeof value.text === "string") {
      sourceTexts.push(value.text);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (!["style", "metadata", "source", "rawXml", "paragraphPropertiesXml", "runPropertiesXml"].includes(key)) visit(child);
    }
  };
  visit(controller?.model?.nodes);
  const pages = [];
  const skipped = { hiddenCharacters: 0, clippedCharacters: 0, zeroAreaCharacters: 0 };
  const styles = new WeakMap();
  const styleOf = (element) => {
    let style = styles.get(element);
    if (!style) { style = getComputedStyle(element); styles.set(element, style); }
    return style;
  };
  const finite = (value) => Math.round(value * 1e6) / 1e6;
  const intersection = (a, b) => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
  const segmenter = new Intl.Segmenter("en", { granularity: "word" });
  for (const wrapper of document.querySelectorAll('[data-docx-page-wrapper="true"]')) {
    const surface = wrapper.querySelector('[data-docx-page-surface="true"]');
    if (!surface) continue;
    const bounds = surface.getBoundingClientRect();
    const words = [];
    const allText = [];
    const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const original = node.textContent ?? "";
      if (!original.trim()) continue;
      const parent = node.parentElement;
      if (!parent || parent.closest("script,style,button,input,textarea,select")) continue;
      let clipping = { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
      let hidden = false;
      for (let ancestor = parent; ancestor && ancestor !== surface.parentElement; ancestor = ancestor.parentElement) {
        const style = styleOf(ancestor);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) { hidden = true; break; }
        const clipX = /hidden|clip|scroll|auto/.test(style.overflowX);
        const clipY = /hidden|clip|scroll|auto/.test(style.overflowY);
        if (clipX || clipY) {
          const rect = ancestor.getBoundingClientRect();
          clipping = intersection(clipping, { left: clipX ? rect.left : -Infinity, right: clipX ? rect.right : Infinity, top: clipY ? rect.top : -Infinity, bottom: clipY ? rect.bottom : Infinity });
        }
      }
      if (hidden) { skipped.hiddenCharacters += original.length; continue; }
      allText.push(original);
      const style = styleOf(parent);
      const region = parent.closest("[data-docx-header-footer-region]")?.getAttribute("data-docx-header-footer-region") ?? "body";
      const paragraph = parent.closest('[data-docx-paragraph-host="true"]');
      const paragraphId = paragraph?.getAttribute("data-docx-source-id") ?? paragraph?.getAttribute("data-docx-paragraph-node-index") ?? null;
      const sourceSpan = parent.closest("[data-docx-text-start]");
      let sourceBase = null;
      if (sourceSpan) {
        const sourcePrefix = document.createRange();
        sourcePrefix.selectNodeContents(sourceSpan);
        sourcePrefix.setEnd(node, 0);
        sourceBase = Number(sourceSpan.getAttribute("data-docx-text-start")) + sourcePrefix.toString().length;
      }
      for (const segment of segmenter.segment(original)) {
        if (!segment.segment.trim()) continue;
        const start = segment.index;
        const end = start + segment.segment.length;
        const range = document.createRange();
        range.setStart(node, start); range.setEnd(node, end);
        const rects = [...range.getClientRects()].filter((rect) => rect.height > 0 && rect.width > 0);
        if (rects.length === 0) { skipped.zeroAreaCharacters += segment.segment.length; continue; }
        const slices = [];
        if (rects.length === 1) slices.push({ text: segment.segment, rect: rects[0], start, end });
        else {
          for (let offset = start; offset < end;) {
            const character = String.fromCodePoint(original.codePointAt(offset));
            range.setStart(node, offset); range.setEnd(node, offset + character.length);
            const rect = range.getBoundingClientRect();
            const prior = slices.at(-1);
            if (prior && Math.abs(prior.rect.top - rect.top) < 1 && Math.abs(prior.rect.bottom - rect.bottom) < 1) {
              prior.text += character; prior.end += character.length;
              prior.rect = { left: Math.min(prior.rect.left, rect.left), right: Math.max(prior.rect.right, rect.right), top: Math.min(prior.rect.top, rect.top), bottom: Math.max(prior.rect.bottom, rect.bottom), width: Math.max(prior.rect.right, rect.right) - Math.min(prior.rect.left, rect.left), height: Math.max(prior.rect.bottom, rect.bottom) - Math.min(prior.rect.top, rect.top) };
            } else slices.push({ text: character, rect, start: offset, end: offset + character.length });
            offset += character.length;
          }
        }
        for (const slice of slices) {
          const clipped = intersection(slice.rect, clipping);
          if (clipped.right <= clipped.left || clipped.bottom <= clipped.top) { skipped.clippedCharacters += slice.text.length; continue; }
          const ratio = (clipped.right - clipped.left) * (clipped.bottom - clipped.top) / (slice.rect.width * slice.rect.height);
          const text = style.textTransform === "uppercase" ? slice.text.toUpperCase() : style.textTransform === "lowercase" ? slice.text.toLowerCase() : slice.text;
          words.push({
            text,
            bbox: [finite((clipped.left - bounds.left) / bounds.width), finite((clipped.top - bounds.top) / bounds.height), finite((clipped.right - bounds.left) / bounds.width), finite((clipped.bottom - bounds.top) / bounds.height)],
            unclippedBbox: [finite((slice.rect.left - bounds.left) / bounds.width), finite((slice.rect.top - bounds.top) / bounds.height), finite((slice.rect.right - bounds.left) / bounds.width), finite((slice.rect.bottom - bounds.top) / bounds.height)],
            clippedFraction: finite(1 - Math.min(1, ratio)),
            region, paragraphId, font: style.fontFamily,
            sourceStart: sourceBase === null ? null : sourceBase + slice.start,
            sourceEnd: sourceBase === null ? null : sourceBase + slice.end,
            leadingWhitespace: slice.start > 0 && /\s/u.test(original[slice.start - 1]),
            trailingWhitespace: slice.end < original.length && /\s/u.test(original[slice.end]),
          });
        }
      }
    }
    const images = [...surface.querySelectorAll("img")].map((image) => {
      const rect = image.getBoundingClientRect();
      return { loaded: image.complete && image.naturalWidth > 0, bbox: [finite((rect.left - bounds.left) / bounds.width), finite((rect.top - bounds.top) / bounds.height), finite((rect.right - bounds.left) / bounds.width), finite((rect.bottom - bounds.top) / bounds.height)] };
    });
    pages.push({ pageIndex: Number(wrapper.getAttribute("data-docx-page-index")), widthCssPx: bounds.width, heightCssPx: bounds.height, words, images, rawDomText: allText.join(""), headerText: words.filter((word) => word.region === "header").map((word) => word.text).join(" "), footerText: words.filter((word) => word.region === "footer").map((word) => word.text).join(" ") });
  }
  return { domResolvedZoom: Number(document.querySelector("[data-docx-resolved-zoom]")?.getAttribute("data-docx-resolved-zoom")), fontFaceStatuses: [...document.fonts].map((font) => ({ family: font.family, style: font.style, weight: font.weight, status: font.status })), requestedFontFamilies: [...new Set(pages.flatMap((page) => page.words.map((word) => word.font)))], resolvedZoom: controller?.getResolvedZoom?.() ?? null, pageCount: pages.length, reportedPageCount: window.reportedPageCount ?? null, layoutMode: document.querySelector("[data-docx-layout-mode]")?.getAttribute("data-docx-layout-mode"), pages, skipped, sourceMainStoryText: sourceTexts.join(""), browser: navigator.userAgent, loadedFontFamilies: [...document.fonts].filter((font) => font.status === "loaded").map((font) => ({ family: font.family, style: font.style, weight: font.weight })) };
}
