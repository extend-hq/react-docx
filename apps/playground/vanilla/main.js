import { createDocxViewer } from "@extend-ai/react-docx/vanilla";
import { createWelcomeDocumentModel as createSampleModel, WELCOME_FILE_NAME } from "../src/lib/welcome-document";

const byId = (id) => document.getElementById(id);
const fileInput = byId("file-input");
const urlInput = byId("document-url");
const readOnlyInput = byId("read-only");
const darkModeInput = byId("dark-mode");
const status = byId("status");
const statusText = byId("status-text");
const message = byId("message");
let opening = false;

function showMessage(text, isError = false) {
  message.textContent = text;
  message.dataset.error = String(isError);
}

const viewer = createDocxViewer(byId("viewer"), {
  starterModel: createSampleModel(),
  initialFileName: WELCOME_FILE_NAME,
  mode: "edit",
  defaultZoom: "fit-width",
  onZoomChange: ({ resolvedZoom }) => { byId("zoom").textContent = `${Math.round(resolvedZoom)}%`; },
});

function updateStatus(controller) {
  const ready = controller.hasDocument && !controller.isLoading && !controller.error;
  byId("file-name").textContent = controller.fileName || "Document";
  byId("page-count").textContent = ready
    ? `Page ${controller.currentPage} of ${controller.totalPages}`
    : controller.isLoading ? "Opening document" : "No document open";
  byId("undo").disabled = !ready || readOnlyInput.checked || !controller.canUndo;
  byId("redo").disabled = !ready || readOnlyInput.checked || !controller.canRedo;
  for (const id of ["zoom-out", "zoom-in", "fit-width", "export"]) byId(id).disabled = !ready;

  if (controller.error) {
    status.dataset.state = "error";
    statusText.textContent = "Could not open";
    showMessage(controller.error.message, true);
    opening = false;
  } else if (controller.isLoading) {
    status.dataset.state = "loading";
    statusText.textContent = "Loading";
  } else {
    status.dataset.state = "ready";
    statusText.textContent = ready ? (readOnlyInput.checked ? "Read only" : "Ready to edit") : "No document";
    if (ready && opening) {
      showMessage("Document ready. Use the controls to explore the viewer.");
      opening = false;
    }
  }
}

viewer.subscribe(updateStatus);

byId("open-file").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  opening = true;
  showMessage("Opening document…");
  viewer.setOptions({ file, fileName: undefined });
  fileInput.value = "";
});

byId("load-sample").addEventListener("click", () => {
  opening = false;
  viewer.setOptions({ file: undefined, src: undefined, fileName: undefined, starterModel: createSampleModel() });
  showMessage("Click the sample text to make a change.");
});

byId("url-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const src = urlInput.value.trim();
  if (!src) return;
  opening = true;
  showMessage("Opening document…");
  viewer.setOptions({ src, fileName: undefined });
});

readOnlyInput.addEventListener("change", () => {
  viewer.setOptions({ mode: readOnlyInput.checked ? "read-only" : "edit" });
});

darkModeInput.addEventListener("change", () => {
  const theme = darkModeInput.checked ? "dark" : "light";
  viewer.setOptions({ initialDocumentTheme: theme });
  viewer.getController()?.setDocumentTheme(theme);
});

byId("undo").addEventListener("click", () => viewer.getController()?.undo());
byId("redo").addEventListener("click", () => viewer.getController()?.redo());
byId("zoom-out").addEventListener("click", () => {
  const controller = viewer.getController();
  if (controller) controller.setZoom(controller.getResolvedZoom() - 10);
});
byId("zoom-in").addEventListener("click", () => {
  const controller = viewer.getController();
  if (controller) controller.setZoom(controller.getResolvedZoom() + 10);
});
byId("fit-width").addEventListener("click", () => viewer.getController()?.setZoom("fit-width"));
byId("export").addEventListener("click", () => {
  const controller = viewer.getController();
  if (!controller) return;
  Promise.resolve(controller.exportDocx()).catch((error) => {
    showMessage(error instanceof Error ? error.message : "Could not export the document.", true);
  });
});

window.addEventListener("pagehide", (event) => {
  if (!event.persisted) viewer.destroy();
});
