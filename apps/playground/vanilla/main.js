import { createDocxViewer } from "@extend-ai/react-docx/vanilla";
import { createWelcomeDocumentModel as createSampleModel, WELCOME_FILE_NAME } from "../src/lib/welcome-document";
import {
  createToast,
  hydrateIcons,
  icon,
  keepSelection,
  setupFileDrop,
  setupTabs,
  setupTheme,
  setupTooltips,
  updateSlider,
} from "./ui.js";

const FONT_FAMILIES = ["Calibri", "Arial", "Times New Roman", "Georgia", "Helvetica", "Courier New"];
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48];
const ZOOM_PERCENTS = [50, 75, 90, 100, 110, 125, 150, 175, 200];

const byId = (id) => document.getElementById(id);
const fileInput = byId("file-input");
const readOnlyInput = byId("read-only");
const darkPageInput = byId("dark-page");
const fontFamilySelect = byId("font-family");
const fontSizeSelect = byId("font-size");
const paragraphStyleSelect = byId("paragraph-style");
const zoomSlider = byId("zoom-slider");
const zoomSelect = byId("zoom-select");
const showToast = createToast();

hydrateIcons();
setupTabs();
setupTooltips();
setupTheme(byId("theme-toggle"));
for (const element of document.querySelectorAll("[data-keep]")) keepSelection(element);

let resolvedZoom = 100;
let opening = false;
let viewer = null;

viewer = createDocxViewer(byId("viewer"), {
  starterModel: createSampleModel(),
  initialFileName: WELCOME_FILE_NAME,
  mode: "edit",
  defaultZoom: 100,
  pageGapBackgroundColor: "var(--canvas)",
  onZoomChange: ({ resolvedZoom: next }) => {
    resolvedZoom = next;
    renderZoom();
  },
});

/* ------------------------------- Selects -------------------------------- */

function setOptions(select, items, value) {
  const values = items.map((item) => item.value);
  const all = value && !values.includes(value) ? [{ value, label: value }, ...items] : items;
  const signature = all.map((item) => `${item.value}:${item.label}`).join("|");
  if (select.dataset.signature !== signature) {
    select.replaceChildren(...all.map((item) => new Option(item.label, item.value)));
    select.dataset.signature = signature;
  }
  if (value !== undefined) select.value = value;
}

fontFamilySelect.addEventListener("change", () => viewer.getController()?.setFontFamily(fontFamilySelect.value));
fontSizeSelect.addEventListener("change", () => {
  const size = Number(fontSizeSelect.value);
  if (Number.isFinite(size)) viewer.getController()?.setFontSize(size);
});
paragraphStyleSelect.addEventListener("change", () => {
  viewer.getController()?.setParagraphStyle(paragraphStyleSelect.value || undefined);
});

/* ------------------------------ Word count ------------------------------ */

function textFromInline(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textFromInline).join("");
  if (!value || typeof value !== "object") return "";
  if (typeof value.text === "string") return value.text;
  return textFromInline(value.children);
}

function countWords(nodes) {
  let total = 0;
  for (const node of nodes ?? []) {
    if (node?.type === "paragraph") {
      total += textFromInline(node.children).split(/\s+/).filter(Boolean).length;
    } else if (node?.type === "table") {
      for (const row of node.rows ?? []) for (const cell of row.cells ?? []) total += countWords(cell.nodes);
    }
  }
  return total;
}

let countedNodes = null;
let wordCountTimer = 0;
function scheduleWordCount(nodes) {
  if (nodes === countedNodes) return;
  countedNodes = nodes;
  clearTimeout(wordCountTimer);
  wordCountTimer = window.setTimeout(() => {
    const words = countWords(nodes);
    byId("word-count").textContent = `${words.toLocaleString()} ${words === 1 ? "word" : "words"}`;
  }, 150);
}

/* --------------------------------- Zoom --------------------------------- */

function renderZoom() {
  const percent = Math.round(resolvedZoom);
  const level = viewer?.getController()?.getZoom();
  for (const button of document.querySelectorAll("[data-zoom-level]")) {
    button.setAttribute("aria-pressed", String(level === button.dataset.zoomLevel));
  }
  updateSlider(zoomSlider, percent);
  const items = [
    { value: "current", label: `${percent}%` },
    { value: "fit-page", label: "Fit page" },
    { value: "fit-width", label: "Fit width" },
    ...ZOOM_PERCENTS.map((value) => ({ value: String(value), label: `${value}%` })),
  ];
  zoomSelect.replaceChildren(...items.map((item) => new Option(item.label, item.value)));
  zoomSelect.options[0].hidden = true;
  zoomSelect.value = "current";
}

function setZoom(level) {
  viewer.getController()?.setZoom(level);
}

function shiftZoom(direction) {
  const current = Math.round(resolvedZoom);
  const next = direction > 0
    ? ZOOM_PERCENTS.find((value) => value > current) ?? ZOOM_PERCENTS.at(-1)
    : [...ZOOM_PERCENTS].reverse().find((value) => value < current) ?? ZOOM_PERCENTS[0];
  setZoom(next);
}

zoomSlider.addEventListener("input", () => {
  updateSlider(zoomSlider, Number(zoomSlider.value));
  setZoom(Number(zoomSlider.value));
});
zoomSelect.addEventListener("change", () => {
  const value = zoomSelect.value;
  if (value !== "current") setZoom(Number.isFinite(Number(value)) ? Number(value) : value);
  zoomSelect.value = "current";
});
byId("zoom-in").addEventListener("click", () => shiftZoom(1));
byId("zoom-out").addEventListener("click", () => shiftZoom(-1));
byId("status-zoom-in").addEventListener("click", () => shiftZoom(1));
byId("status-zoom-out").addEventListener("click", () => shiftZoom(-1));
byId("zoom-100").addEventListener("click", () => setZoom(100));
for (const button of document.querySelectorAll("[data-zoom-level]")) {
  button.addEventListener("click", () => setZoom(button.dataset.zoomLevel));
}
renderZoom();

/* -------------------------------- Render -------------------------------- */

function render(controller) {
  const ready = controller.hasDocument && !controller.isLoading && !controller.error;
  // OpenDocument files open view-only whatever the toggle says.
  const viewOnlyReason = controller.viewOnlyReason;
  const readOnly = readOnlyInput.checked || Boolean(viewOnlyReason);
  const editable = ready && !readOnly && !controller.isImporting;
  const runStyle = controller.selectedRunStyle;
  const align = controller.selectedParagraph?.style?.align;

  byId("file-name").textContent = controller.fileName || "Document1";
  document.title = `${controller.fileName || "Document1"} · Vanilla DOCX Playground`;
  byId("read-only-badge").hidden = !readOnly;
  byId("read-only-badge").textContent = viewOnlyReason ? "View-only" : "Read-only";
  byId("read-only-badge").title = viewOnlyReason ?? "";
  byId("read-only-status").hidden = !readOnly;
  byId("page-count").textContent = `Page ${Math.max(1, controller.currentPage || 1)} of ${Math.max(1, controller.totalPages || 1)}`;
  scheduleWordCount(controller.model?.nodes);

  const loading = controller.isLoading || controller.isImporting;
  byId("status-spinner").hidden = !loading;
  byId("status-text").textContent = controller.error ? "Could not open document" : loading ? "Opening…" : controller.status || "Ready";
  byId("open-icon").innerHTML = loading ? '<span class="spinner" style="width:16px;height:16px"></span>' : icon("folder-open");
  byId("open-label").textContent = loading ? "Opening…" : "Open";
  byId("open-file").disabled = loading;
  byId("export").disabled = !ready || Boolean(viewOnlyReason);
  byId("export").title = viewOnlyReason ?? "";

  byId("undo").disabled = !editable || !controller.canUndo;
  byId("redo").disabled = !editable || !controller.canRedo;
  for (const element of document.querySelectorAll("[data-edit]")) element.disabled = !editable;
  for (const element of document.querySelectorAll("[data-zoom]")) element.disabled = !ready;

  const pressed = {
    bold: Boolean(runStyle?.bold),
    italic: Boolean(runStyle?.italic),
    underline: Boolean(runStyle?.underline),
    strike: Boolean(runStyle?.strike),
    subscript: runStyle?.verticalAlign === "subscript",
    superscript: runStyle?.verticalAlign === "superscript",
    bullets: controller.hasUnorderedList,
    numbering: controller.hasOrderedList,
    "align-left": align === "left" || !align,
    "align-center": align === "center",
    "align-right": align === "right",
    "align-justify": align === "justify",
  };
  for (const button of document.querySelectorAll("[data-command]")) {
    button.setAttribute("aria-pressed", String(Boolean(pressed[button.dataset.command])));
  }

  setOptions(
    fontFamilySelect,
    FONT_FAMILIES.map((value) => ({ value, label: value })),
    runStyle?.fontFamily ?? "Calibri",
  );
  setOptions(
    fontSizeSelect,
    FONT_SIZES.map((size) => ({ value: String(size), label: String(size) })),
    String(Math.round(runStyle?.fontSizePt ?? 12)),
  );
  const styles = controller.availableParagraphStyles ?? [];
  setOptions(
    paragraphStyleSelect,
    styles.map((style) => ({ value: style.id, label: style.name || style.id })),
    controller.selectedParagraphStyleId ?? styles[0]?.id ?? "",
  );
  darkPageInput.checked = controller.documentTheme === "dark";

  if (controller.error) {
    if (opening) showToast(controller.error.message, true);
    opening = false;
  } else if (ready && opening) {
    showToast("Document ready.");
    opening = false;
  }
}

viewer.subscribe(render);

/* ------------------------------- Commands ------------------------------- */

const COMMANDS = {
  bold: (c) => c.toggleBold(),
  italic: (c) => c.toggleItalic(),
  underline: (c) => c.toggleUnderline(),
  strike: (c) => c.toggleStrike(),
  subscript: (c) => c.toggleSubscript(),
  superscript: (c) => c.toggleSuperscript(),
  bullets: (c) => c.toggleList("unordered"),
  numbering: (c) => c.toggleList("ordered"),
  "align-left": (c) => c.setAlignment("left"),
  "align-center": (c) => c.setAlignment("center"),
  "align-right": (c) => c.setAlignment("right"),
  "align-justify": (c) => c.setAlignment("justify"),
};
for (const button of document.querySelectorAll("[data-command]")) {
  button.addEventListener("click", () => {
    const controller = viewer.getController();
    if (controller) COMMANDS[button.dataset.command]?.(controller);
  });
}
byId("undo").addEventListener("click", () => viewer.getController()?.undo());
byId("redo").addEventListener("click", () => viewer.getController()?.redo());

/* ------------------------------ Documents ------------------------------- */

function openFile(file) {
  opening = true;
  viewer.setOptions({ file, src: undefined, fileName: undefined });
}

byId("open-file").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (file) openFile(file);
});
setupFileDrop(byId("app"), byId("drop-overlay"), openFile);

byId("load-sample").addEventListener("click", () => {
  opening = false;
  viewer.setOptions({ file: undefined, src: undefined, fileName: undefined, starterModel: createSampleModel() });
  showToast("Sample loaded. Click the text to make a change.");
});

byId("url-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const src = byId("document-url").value.trim();
  if (!src) return;
  opening = true;
  viewer.setOptions({ file: undefined, src, fileName: undefined });
});

byId("export").addEventListener("click", () => {
  const controller = viewer.getController();
  if (!controller) return;
  Promise.resolve(controller.exportDocx()).catch((error) => {
    showToast(error instanceof Error ? error.message : "Could not export the document.", true);
  });
});

readOnlyInput.addEventListener("change", () => {
  viewer.setOptions({ mode: readOnlyInput.checked ? "read-only" : "edit" });
  const controller = viewer.getController();
  if (controller) render(controller);
});

darkPageInput.addEventListener("change", () => {
  const theme = darkPageInput.checked ? "dark" : "light";
  viewer.setOptions({ initialDocumentTheme: theme });
  viewer.getController()?.setDocumentTheme(theme);
});

window.addEventListener("pagehide", (event) => {
  if (!event.persisted) viewer.destroy();
});
