export interface ObjectDragFrame {
  clientX: number;
  clientY: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export function startObjectDrag(options: {
  event: { pointerId: number; clientX: number; clientY: number };
  element: HTMLElement;
  zoom: number;
  resolveElement: () => HTMLElement | undefined;
  onFrame: (frame: ObjectDragFrame) => void;
  onDrop: (frame: ObjectDragFrame) => void;
  onCancel: () => void;
}): () => void {
  const { event, element } = options;
  const doc = element.ownerDocument;
  const win = doc.defaultView!;
  const rect = element.getBoundingClientRect();
  const grabX = event.clientX - rect.left;
  const grabY = event.clientY - rect.top;
  let clientX = event.clientX;
  let clientY = event.clientY;
  let active = false;
  let ended = false;
  let animationFrame = 0;
  let ghost: HTMLElement | undefined;
  let previousTime = 0;
  const hiddenElements = new Map<HTMLElement, string>();
  const scrollContainers: HTMLElement[] = [];
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    if (/(auto|scroll)/.test(win.getComputedStyle(parent).overflowY)) {
      scrollContainers.push(parent);
    }
  }
  const scrollingElement = doc.scrollingElement as HTMLElement | null;
  if (scrollingElement && !scrollContainers.includes(scrollingElement)) {
    scrollContainers.push(scrollingElement);
  }
  const scrollAnchors = new Map<HTMLElement, string>();
  const frame = (): ObjectDragFrame => ({
    clientX,
    clientY,
    left: clientX - grabX,
    top: clientY - grabY,
    width: rect.width,
    height: rect.height,
  });
  const hideSource = (): void => {
    const source = options.resolveElement();
    if (source && !hiddenElements.has(source)) {
      hiddenElements.set(source, source.style.visibility);
      source.style.visibility = "hidden";
    }
  };
  const observer = new MutationObserver(() => {
    if (active && !ended) hideSource();
  });
  observer.observe(
    element.closest("[data-testid=docx-editor-viewer]") ??
      element.parentElement ??
      element,
    { childList: true, subtree: true }
  );
  const tick = (time: number): void => {
    if (ended) return;
    const elapsed = previousTime ? Math.min(32, time - previousTime) : 16;
    previousTime = time;
    for (const container of scrollContainers) {
      const bounds =
        container === scrollingElement
          ? { top: 0, bottom: win.innerHeight, left: 0, right: win.innerWidth }
          : container.getBoundingClientRect();
      if (clientX < bounds.left || clientX > bounds.right) continue;
      const edge = 40;
      const speed =
        clientY < bounds.top + edge
          ? -Math.min(1, (bounds.top + edge - clientY) / edge)
          : clientY > bounds.bottom - edge
          ? Math.min(1, (clientY - bounds.bottom + edge) / edge)
          : 0;
      const before = container.scrollTop;
      container.scrollTop += speed * elapsed * 0.7;
      if (container.scrollTop !== before) break;
    }
    hideSource();
    const next = frame();
    if (ghost) {
      ghost.style.left = `${next.left}px`;
      ghost.style.top = `${next.top}px`;
    }
    options.onFrame(next);
    animationFrame = win.requestAnimationFrame(tick);
  };
  const cleanup = (): void => {
    ended = true;
    win.cancelAnimationFrame(animationFrame);
    win.removeEventListener("pointermove", move, true);
    win.removeEventListener("pointerup", up, true);
    win.removeEventListener("pointercancel", cancelPointer, true);
    win.removeEventListener("keydown", keydown);
    win.removeEventListener("blur", cancel);
    observer.disconnect();
    win.requestAnimationFrame(() =>
      win.requestAnimationFrame(() => {
        scrollAnchors.forEach((value, container) => {
          container.style.overflowAnchor = value;
        });
      })
    );
    ghost?.remove();
    hiddenElements.forEach((visibility, source) => {
      source.style.visibility = visibility;
    });
  };
  const cancel = (): void => {
    if (ended) return;
    cleanup();
    options.onCancel();
  };
  const cancelPointer = (next: PointerEvent): void => {
    if (next.pointerId === event.pointerId) cancel();
  };
  const keydown = (next: KeyboardEvent): void => {
    if (next.key === "Escape") {
      next.preventDefault();
      cancel();
    }
  };
  const move = (next: PointerEvent): void => {
    if (next.pointerId !== event.pointerId || ended) return;
    clientX = next.clientX;
    clientY = next.clientY;
    if (!active) {
      if (Math.hypot(clientX - event.clientX, clientY - event.clientY) < 4)
        return;
      active = true;
      for (const container of scrollContainers) {
        scrollAnchors.set(container, container.style.overflowAnchor);
        container.style.overflowAnchor = "none";
      }
      ghost = element.cloneNode(true) as HTMLElement;
      ghost
        .querySelectorAll(
          "[data-image-resize-handle], [data-docx-table-move-handle]"
        )
        .forEach((handle) => handle.remove());
      for (const node of [ghost, ...ghost.querySelectorAll("*")]) {
        node.removeAttribute("id");
        for (const attribute of [...node.attributes]) {
          if (attribute.name.startsWith("data-docx-"))
            node.removeAttribute(attribute.name);
        }
        node.setAttribute("contenteditable", "false");
      }
      const style = win.getComputedStyle(element);
      Object.assign(ghost.style, {
        position: "fixed",
        margin: "0",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width / options.zoom}px`,
        height: `${rect.height / options.zoom}px`,
        transform: `scale(${options.zoom})`,
        transformOrigin: "top left",
        visibility: "visible",
        pointerEvents: "none",
        zIndex: "2147483647",
        opacity: "0.9",
        userSelect: "none",
        font: style.font,
        color: style.color,
      });
      ghost.setAttribute("aria-hidden", "true");
      ghost.setAttribute("data-docx-drag-ghost", "true");
      doc.body.appendChild(ghost);
      hideSource();
      animationFrame = win.requestAnimationFrame(tick);
    }
    next.preventDefault();
    next.stopPropagation();
  };
  const up = (next: PointerEvent): void => {
    if (next.pointerId !== event.pointerId || ended) return;
    clientX = next.clientX;
    clientY = next.clientY;
    const finalFrame = frame();
    if (active) {
      next.preventDefault();
      next.stopPropagation();
    }
    try {
      if (active) options.onDrop(finalFrame);
      else options.onCancel();
    } finally {
      cleanup();
    }
  };
  win.addEventListener("pointermove", move, { passive: false, capture: true });
  win.addEventListener("pointerup", up, true);
  win.addEventListener("pointercancel", cancelPointer, true);
  win.addEventListener("keydown", keydown);
  win.addEventListener("blur", cancel);
  return cancel;
}
