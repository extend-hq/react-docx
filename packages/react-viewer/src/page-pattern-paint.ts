function decodeSvg(source: string): string | undefined {
  if (!source.startsWith("data:image/svg+xml")) return undefined;
  const separator = source.indexOf(",");
  if (separator < 0) return undefined;
  try {
    const payload = source.slice(separator + 1);
    return /;base64$/i.test(source.slice(0, separator))
      ? new TextDecoder("utf-8", { fatal: true }).decode(
          Uint8Array.from(atob(payload), value => value.charCodeAt(0)),
        )
      : decodeURIComponent(payload);
  } catch {
    return undefined;
  }
}

export function observePagePatternPaint(element: HTMLImageElement, source: string): (() => void) | undefined {
  const xml = decodeSvg(source);
  if (!xml?.includes('data-office-art-pattern-origin="page"')) return undefined;
  const document = new DOMParser().parseFromString(xml, "image/svg+xml");
  const root = document.documentElement;
  const page = element.closest<HTMLElement>("[data-docx-page-surface='true']");
  if (!page || document.querySelector("parsererror") || root.localName !== "svg") return undefined;
  const patterns = Array.from(root.querySelectorAll<SVGPatternElement>("pattern[data-office-art-pattern-origin='page']"));
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0) return undefined;
  if (root.querySelector("svg") || Array.from(root.querySelectorAll("[transform]")).some(node => {
    const transform = node.getAttribute("transform")?.trim().match(/^matrix\(([^)]+)\)$/);
    const matrix = transform?.[1].trim().split(/[\s,]+/).map(Number);
    return !matrix || matrix.length !== 6 || matrix.some((value, index) => value !== [1, 0, 0, 1, 0, 0][index]);
  })) return undefined;
  let previous = "";
  let frame = 0;
  let disposed = false;
  const refresh = (): void => {
    frame = 0;
    if (disposed || !element.isConnected) return;
    const pageRect = page.getBoundingClientRect();
    const pageStyle = window.getComputedStyle(page);
    const pageWidth = Number.parseFloat(pageStyle.width);
    const pageHeight = Number.parseFloat(pageStyle.height);
    const borderX = Number.parseFloat(pageStyle.borderLeftWidth) || 0;
    const borderY = Number.parseFloat(pageStyle.borderTopWidth) || 0;
    const horizontalBorders = borderX + (Number.parseFloat(pageStyle.borderRightWidth) || 0);
    const verticalBorders = borderY + (Number.parseFloat(pageStyle.borderBottomWidth) || 0);
    const zoomX = pageRect.width / (pageWidth + (pageStyle.boxSizing === "border-box" ? 0 : horizontalBorders));
    const zoomY = pageRect.height / (pageHeight + (pageStyle.boxSizing === "border-box" ? 0 : verticalBorders));
    const bounds = element.getBoundingClientRect();
    const scaleX = bounds.width / zoomX / viewBox[2];
    const scaleY = bounds.height / zoomY / viewBox[3];
    if (![zoomX, zoomY, scaleX, scaleY].every(value => Number.isFinite(value) && value > 0)) return;
    const originX = (bounds.left - pageRect.left) / zoomX - borderX - viewBox[0] * scaleX;
    const originY = (bounds.top - pageRect.top) / zoomY - borderY - viewBox[1] * scaleY;
    const key = [originX, originY, scaleX, scaleY].map(value => value.toFixed(6)).join(",");
    if (key === previous) return;
    previous = key;
    for (const pattern of patterns) {
      const period = Number(pattern.getAttribute("data-office-art-pattern-period"));
      if (!Number.isFinite(period) || period <= 0) continue;
      pattern.setAttribute("patternTransform", `matrix(${1 / scaleX} 0 0 ${1 / scaleY} ${-(originX % period) / scaleX} ${-(originY % period) / scaleY})`);
    }
    element.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(document))}`;
  };
  const schedule = (): void => {
    if (!disposed && !frame) frame = requestAnimationFrame(refresh);
  };
  const resize = new ResizeObserver(schedule);
  resize.observe(page);
  resize.observe(element);
  const mutation = new MutationObserver(schedule);
  mutation.observe(page, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["style", "class", "width", "height"] });
  window.document.fonts?.ready.then(schedule);
  refresh();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    resize.disconnect();
    mutation.disconnect();
  };
}
