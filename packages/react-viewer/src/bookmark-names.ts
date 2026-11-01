const BOOKMARK_START_XML_PATTERN = /<w:bookmarkStart\b[^>]*w:name="([^"]+)"/gi;

function decodeBookmarkName(value: string): string {
  if (!value.includes("&")) return value;

  return value.replace(
    /&(amp|lt|gt|quot|apos|#[xX][0-9a-fA-F]+|#[0-9]+);/g,
    (encoded, entity: string) => {
      switch (entity) {
        case "amp": return "&";
        case "lt": return "<";
        case "gt": return ">";
        case "quot": return '"';
        case "apos": return "'";
      }

      const hexadecimal = entity[1] === "x" || entity[1] === "X";
      const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      if (codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        return encoded;
      }
      return String.fromCodePoint(codePoint);
    }
  );
}

export function bookmarkNamesFromXml(sourceXml: string): string[] {
  if (!sourceXml) return [];

  const names = [
    ...sourceXml.matchAll(new RegExp(BOOKMARK_START_XML_PATTERN.source, "gi")),
  ]
    .map((match) => decodeBookmarkName((match[1] ?? "").trim()))
    .filter((name) => name.length > 0 && name !== "_GoBack");
  return [...new Set(names)];
}

export function bookmarkTargetForName(
  targets: ReadonlyMap<string, number>,
  bookmarkName: string
): number | undefined {
  return targets.get(bookmarkName) ?? targets.get(bookmarkName.trim());
}
