// Small DOM helpers that give the vanilla playground the same chrome as the React one.

// Lucide icon paths (ISC), matching the icons the React playground renders.
const ICON_PATHS = {
  "file-text": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  "folder-open": '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/>',
  bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
  italic: '<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>',
  underline: '<path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/>',
  strikethrough: '<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/>',
  subscript: '<path d="m4 5 8 8"/><path d="m12 5-8 8"/><path d="M20 19h-4c0-1.5.44-2 1.5-2.5S20 15.33 20 14c0-.47-.17-.93-.48-1.29a2.11 2.11 0 0 0-2.62-.44c-.42.24-.74.62-.9 1.07"/>',
  superscript: '<path d="m4 19 8-8"/><path d="m12 19-8-8"/><path d="M20 12h-4c0-1.5.442-2 1.5-2.5S20 8.334 20 7.002c0-.472-.17-.93-.484-1.29a2.105 2.105 0 0 0-2.617-.436c-.42.239-.738.614-.899 1.06"/>',
  list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  "list-ordered": '<path d="M10 12h11"/><path d="M10 18h11"/><path d="M10 6h11"/><path d="M4 10h2"/><path d="M4 6h1v4"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  "align-start": '<path d="M21 5H3"/><path d="M15 12H3"/><path d="M17 19H3"/>',
  "align-center": '<path d="M21 5H3"/><path d="M17 12H7"/><path d="M19 19H5"/>',
  "align-end": '<path d="M21 5H3"/><path d="M21 12H9"/><path d="M21 19H7"/>',
  "align-justify": '<path d="M3 5h18"/><path d="M3 12h18"/><path d="M3 19h18"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  "zoom-in": '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/>',
  "zoom-out": '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="8" x2="14" y1="11" y2="11"/>',
  "move-horizontal": '<path d="m18 8 4 4-4 4"/><path d="M2 12h20"/><path d="m6 8-4 4 4 4"/>',
  "rectangle-vertical": '<rect width="12" height="20" x="6" y="2" rx="2"/>',
  scaling: '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M14 15H9v-5"/><path d="M16 3h5v5"/><path d="M21 3 9 15"/>',
  "chevrons-up-down": '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  sparkles: '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
  upload: '<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  "file-spreadsheet": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h2"/><path d="M14 13h2"/><path d="M8 17h2"/><path d="M14 17h2"/>',
  "chevron-left": '<path d="m15 18-6-6 6-6"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  highlighter: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  eraser: '<path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"/><path d="m5.082 11.09 8.828 8.828"/>',
  "table-cells-merge": '<path d="M12 21v-6"/><path d="M12 9V3"/><path d="M3 15h18"/><path d="M3 9h18"/><rect width="18" height="18" x="3" y="3" rx="2"/>',
  "text-wrap": '<path d="m16 16-3 3 3 3"/><path d="M3 12h14.5a1 1 0 0 1 0 7H13"/><path d="M3 19h6"/><path d="M3 5h18"/>',
  "dollar-sign": '<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  percent: '<line x1="19" x2="5" y1="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
};

export function icon(name, className = "") {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name] ?? ""}</svg>`;
}

/** Replaces every `<i data-icon="name">` placeholder with its SVG. */
export function hydrateIcons(root = document) {
  for (const placeholder of root.querySelectorAll("i[data-icon]")) {
    placeholder.outerHTML = icon(placeholder.dataset.icon, placeholder.className);
  }
}

/** Shares the React playground's theme choice (next-themes stores it under "theme"). */
export function setupTheme(button, onChange) {
  const root = document.documentElement;
  const render = () => {
    const isDark = root.classList.contains("dark");
    button.innerHTML = icon(isDark ? "sun" : "moon");
    button.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
    button.dataset.tooltip = isDark ? "Light mode" : "Dark mode";
    onChange?.(isDark);
  };
  button.addEventListener("click", () => {
    const next = root.classList.contains("dark") ? "light" : "dark";
    root.classList.toggle("dark", next === "dark");
    try { localStorage.setItem("theme", next); } catch {}
    render();
  });
  render();
}

/** Tooltips for any element with `data-tooltip` (and optional `data-shortcut`). */
export function setupTooltips() {
  const tip = document.createElement("div");
  tip.className = "tooltip";
  tip.setAttribute("role", "tooltip");
  document.body.append(tip);
  let timer = 0;
  let current = null;
  const hide = () => {
    clearTimeout(timer);
    current = null;
    delete tip.dataset.open;
  };
  document.addEventListener("pointerover", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-tooltip]") : null;
    if (target === current) return;
    hide();
    if (!target) return;
    current = target;
    timer = window.setTimeout(() => {
      if (current !== target || !target.isConnected) return;
      const shortcut = target.dataset.shortcut ? `<kbd>${target.dataset.shortcut}</kbd>` : "";
      tip.innerHTML = `${target.dataset.tooltip}${shortcut}`;
      const rect = target.getBoundingClientRect();
      const above = target.dataset.tooltipSide === "top";
      const width = tip.offsetWidth;
      const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
      tip.style.left = `${left}px`;
      tip.style.top = above ? `${rect.top - tip.offsetHeight - 6}px` : `${rect.bottom + 6}px`;
      tip.dataset.open = "";
    }, 400);
  });
  document.addEventListener("pointerdown", hide, true);
  window.addEventListener("blur", hide);
}

/** Ribbon tabs: `[role=tab][data-tab]` buttons switch `[role=tabpanel][data-panel]` panels. */
export function setupTabs(root = document) {
  const tabs = [...root.querySelectorAll('[role="tab"][data-tab]')];
  const panels = [...root.querySelectorAll('[role="tabpanel"][data-panel]')];
  const select = (name) => {
    for (const tab of tabs) tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
    for (const panel of panels) panel.hidden = panel.dataset.panel !== name;
  };
  for (const tab of tabs) tab.addEventListener("click", () => select(tab.dataset.tab));
  select(tabs[0]?.dataset.tab);
}

/** Keeps the editor's text selection when a ribbon control is pressed. */
export function keepSelection(element) {
  element.addEventListener("mousedown", (event) => event.preventDefault());
  element.addEventListener("pointerdown", (event) => event.preventDefault());
}

export function createToast() {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  document.body.append(toast);
  let timer = 0;
  return (text, isError = false) => {
    clearTimeout(timer);
    toast.textContent = text;
    toast.dataset.error = String(isError);
    toast.dataset.open = "";
    timer = window.setTimeout(() => delete toast.dataset.open, isError ? 6000 : 3000);
  };
}

export function updateSlider(slider, value) {
  slider.value = String(value);
  const min = Number(slider.min);
  const max = Number(slider.max);
  const pct = ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100;
  slider.style.setProperty("--pct", `${pct}%`);
}

/** Calls `onFile` for files dropped anywhere on `target`, showing the drop overlay meanwhile. */
export function setupFileDrop(target, overlay, onFile) {
  let depth = 0;
  const isFileDrag = (event) => event.dataTransfer?.types.includes("Files");
  target.addEventListener("dragenter", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    depth += 1;
    overlay.hidden = false;
  });
  target.addEventListener("dragleave", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    depth = Math.max(0, depth - 1);
    if (depth === 0) overlay.hidden = true;
  });
  target.addEventListener("dragover", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  target.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files[0];
    depth = 0;
    overlay.hidden = true;
    if (!file) return;
    event.preventDefault();
    onFile(file);
  });
}

/**
 * A small dropdown menu. `items` is a list of `{ label, hint?, onSelect, disabled?() }` or "separator".
 * Returns a refresh function that re-evaluates `disabled` while the menu is open.
 */
export function setupMenu(trigger, items, { align = "start" } = {}) {
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  document.body.append(menu);
  const buttons = [];
  for (const item of items) {
    if (item === "separator") {
      const separator = document.createElement("div");
      separator.className = "menu-separator";
      separator.setAttribute("role", "separator");
      menu.append(separator);
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-item";
    button.setAttribute("role", "menuitem");
    button.innerHTML = `<span>${item.label}</span>${item.hint ? `<span class="menu-hint">${item.hint}</span>` : ""}`;
    keepSelection(button);
    button.addEventListener("click", () => {
      close();
      item.onSelect();
    });
    buttons.push([button, item]);
    menu.append(button);
  }
  const refresh = () => {
    for (const [button, item] of buttons) button.disabled = Boolean(item.disabled?.());
  };
  const close = () => {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    refresh();
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    const rect = trigger.getBoundingClientRect();
    const left = align === "end" ? rect.right - menu.offsetWidth : rect.left;
    menu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${rect.bottom + 4}px`;
  };
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  keepSelection(trigger);
  trigger.addEventListener("click", () => (menu.hidden ? open() : close()));
  document.addEventListener("pointerdown", (event) => {
    if (!menu.hidden && !menu.contains(event.target) && !trigger.contains(event.target)) close();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) close();
  });
  window.addEventListener("resize", close);
  return refresh;
}
