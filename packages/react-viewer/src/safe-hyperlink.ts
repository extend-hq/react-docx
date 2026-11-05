export function safeHyperlink(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value || /[\u0000-\u001f\u007f\\]/.test(value) || value.startsWith("//")) {
    return undefined;
  }

  try {
    const url = new URL(value, "https://relative.invalid/");
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}
