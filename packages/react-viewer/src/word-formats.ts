const wordExtension = /\.(?:doc|dot)[xm]?$/i;
// OpenDocument text, its template, master and web variants, and flat XML.
const openDocumentTextExtension = /\.(?:odt|ott|odm|otm|oth|fodt)$/i;
const documentFormat = {
  extension: "docx",
  mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
const variants = [
  { main: "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml", extension: "dotx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.template" },
  { main: "application/vnd.ms-word.document.macroEnabled.main+xml", extension: "docm", mime: "application/vnd.ms-word.document.macroEnabled.12" },
  { main: "application/vnd.ms-word.template.macroEnabledTemplate.main+xml", extension: "dotm", mime: "application/vnd.ms-word.template.macroEnabled.12" },
];

export function isWordFileName(name: string): boolean {
  return wordExtension.test(name);
}

export function isOpenDocumentTextFileName(name: string): boolean {
  return openDocumentTextExtension.test(name);
}

/** File names the viewer opens. The parser decides the format from the bytes. */
export function isSupportedDocumentFileName(name: string): boolean {
  return isWordFileName(name) || isOpenDocumentTextFileName(name);
}

export const SUPPORTED_DOCUMENT_FORMATS_MESSAGE =
  "Supported formats are Word (.doc, .dot, .docx, .dotx, .docm, .dotm) and OpenDocument text (.odt, .ott, .odm, .otm, .oth, .fodt).";

/** Shown wherever editing or export is refused for an OpenDocument file. */
export const OPEN_DOCUMENT_VIEW_ONLY_REASON =
  "OpenDocument files are view-only: they cannot be edited or saved as DOCX.";

export function wordDownloadFormat(contentTypes: string | undefined): typeof documentFormat {
  if (!contentTypes) return documentFormat;
  const overrides = new DOMParser().parseFromString(contentTypes, "application/xml")
    .getElementsByTagNameNS("*", "Override");
  const mainTypes = new Set(Array.from(overrides, (element) => element.getAttribute("ContentType")));
  return variants.find((variant) => mainTypes.has(variant.main)) ?? documentFormat;
}

export function wordDownloadName(name: string, extension: string): string {
  return isWordFileName(name) ? `${name.replace(wordExtension, "")}-edited.${extension}` : `edited.${extension}`;
}
