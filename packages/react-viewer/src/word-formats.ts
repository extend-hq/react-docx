const wordExtension = /\.(?:doc|dot)[xm]?$/i;
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
