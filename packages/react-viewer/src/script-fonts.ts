import type { TextStyle } from "@extend-ai/react-docx-doc-model";

export type DocxFontScript =
  | "ascii"
  | "highAnsi"
  | "eastAsia"
  | "complexScript";

export interface DocxScriptFontSegment {
  text: string;
  startOffset: number;
  endOffset: number;
  script: DocxFontScript;
  fontFamily?: string;
}

const EAST_ASIA_SCRIPT_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\p{Script=Yi}]/u;
const COMPLEX_SCRIPT_RE =
  /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Thai}\p{Script=Lao}\p{Script=Tibetan}\p{Script=Myanmar}\p{Script=Khmer}]/u;
const NEUTRAL_OR_CONTINUATION_RE =
  /[\p{Mark}\p{Separator}\p{Punctuation}\u200c\u200d\ufe00-\ufe0f]/u;
const EAST_ASIA_LANGUAGE_RE = /^(?:ja|ko|zh)(?:-|$)/i;
const COMPLEX_SCRIPT_LANGUAGE_RE =
  /^(?:ar|ckb|dv|fa|he|hi|ks|ku|pa-arab|ps|sd|syr|ug|ur|yi)(?:-|$)/i;

function normalizeFamily(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizedFamilyKey(value?: string): string | undefined {
  return normalizeFamily(value)
    ?.replace(/^['"]+|['"]+$/g, "")
    .toLowerCase();
}

function hasLegacyFontFamilyOverride(style?: TextStyle): boolean {
  const current = normalizedFamilyKey(style?.fontFamily);
  const imported = normalizedFamilyKey(style?.sourceFontFamily);
  if (!current) {
    return false;
  }
  if (imported) {
    return current !== imported;
  }

  return !(
    normalizeFamily(style?.fontFamilyAscii) ||
    normalizeFamily(style?.fontFamilyHAnsi) ||
    normalizeFamily(style?.fontFamilyEastAsia) ||
    normalizeFamily(style?.fontFamilyCs) ||
    normalizeFamily(style?.fontThemeAscii) ||
    normalizeFamily(style?.fontThemeHAnsi) ||
    normalizeFamily(style?.fontThemeEastAsia) ||
    normalizeFamily(style?.fontThemeCs)
  );
}

function normalizedFontHint(style?: TextStyle): string {
  return (
    style?.fontHint
      ?.trim()
      .replace(/[-_\s]/g, "")
      .toLowerCase() ?? ""
  );
}

function neutralScript(style?: TextStyle): DocxFontScript {
  const hint = normalizedFontHint(style);
  if (hint === "eastasia") {
    return "eastAsia";
  }
  if (hint === "cs" || hint === "complexscript" || hint === "bidi") {
    return "complexScript";
  }
  if (
    style?.rightToLeft ||
    COMPLEX_SCRIPT_LANGUAGE_RE.test(style?.languageBidi?.trim() ?? "")
  ) {
    return "complexScript";
  }
  if (EAST_ASIA_LANGUAGE_RE.test(style?.languageEastAsia?.trim() ?? "")) {
    return "eastAsia";
  }
  return "highAnsi";
}

/**
 * Selects the OOXML font slot for one Unicode code point. The explicit
 * complex-script property forces complex-script formatting, while an
 * explicitly disabled property lets mixed RTL runs retain per-script fonts.
 */
export function classifyDocxFontScript(
  value: string,
  style?: TextStyle
): DocxFontScript | undefined {
  const character = Array.from(value)[0];
  if (!character) {
    return undefined;
  }

  if (
    style?.complexScript === true ||
    (style?.rightToLeft === true && style?.complexScript !== false)
  ) {
    return "complexScript";
  }

  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint <= 0x7f) {
    return "ascii";
  }
  if (
    EAST_ASIA_SCRIPT_RE.test(character) ||
    (codePoint >= 0x3000 && codePoint <= 0x303f) ||
    (codePoint >= 0xff00 && codePoint <= 0xffef)
  ) {
    return "eastAsia";
  }
  if (COMPLEX_SCRIPT_RE.test(character)) {
    return "complexScript";
  }
  if (NEUTRAL_OR_CONTINUATION_RE.test(character)) {
    return undefined;
  }
  return "highAnsi";
}

/** Resolves one OOXML script slot while retaining the legacy fontFamily API. */
export function resolveDocxScriptFontFamily(
  style: TextStyle | undefined,
  script: DocxFontScript
): string | undefined {
  const legacyFamily = normalizeFamily(style?.fontFamily);
  if (hasLegacyFontFamilyOverride(style)) {
    return legacyFamily;
  }

  switch (script) {
    case "ascii":
      return (
        normalizeFamily(style?.resolvedFontFamilyAscii) ??
        normalizeFamily(style?.fontFamilyAscii) ??
        normalizeFamily(style?.resolvedFontFamilyHAnsi) ??
        normalizeFamily(style?.fontFamilyHAnsi) ??
        legacyFamily
      );
    case "highAnsi":
      return (
        normalizeFamily(style?.resolvedFontFamilyHAnsi) ??
        normalizeFamily(style?.fontFamilyHAnsi) ??
        normalizeFamily(style?.resolvedFontFamilyAscii) ??
        normalizeFamily(style?.fontFamilyAscii) ??
        legacyFamily
      );
    case "eastAsia":
      return (
        normalizeFamily(style?.resolvedFontFamilyEastAsia) ??
        normalizeFamily(style?.fontFamilyEastAsia) ??
        normalizeFamily(style?.resolvedFontFamilyHAnsi) ??
        normalizeFamily(style?.fontFamilyHAnsi) ??
        normalizeFamily(style?.resolvedFontFamilyAscii) ??
        normalizeFamily(style?.fontFamilyAscii) ??
        legacyFamily
      );
    case "complexScript":
      return (
        normalizeFamily(style?.resolvedFontFamilyCs) ??
        normalizeFamily(style?.fontFamilyCs) ??
        normalizeFamily(style?.resolvedFontFamilyHAnsi) ??
        normalizeFamily(style?.fontFamilyHAnsi) ??
        normalizeFamily(style?.resolvedFontFamilyAscii) ??
        normalizeFamily(style?.fontFamilyAscii) ??
        legacyFamily
      );
  }
}

interface ScriptToken {
  text: string;
  startOffset: number;
  endOffset: number;
  script?: DocxFontScript;
}

/**
 * Splits only where the resolved font family changes. UTF-16 offsets remain
 * aligned with DOM selection and pretext layout offsets.
 */
export function segmentTextByDocxScriptFont(
  text: string,
  style?: TextStyle
): DocxScriptFontSegment[] {
  if (!text) {
    return [];
  }

  if (/^[\x00-\x7f]+$/.test(text)) {
    const script = classifyDocxFontScript(text[0], style) ?? "ascii";
    return [
      {
        text,
        startOffset: 0,
        endOffset: text.length,
        script,
        fontFamily: resolveDocxScriptFontFamily(style, script),
      },
    ];
  }

  const tokens: ScriptToken[] = [];
  let offset = 0;
  for (const character of text) {
    const startOffset = offset;
    offset += character.length;
    tokens.push({
      text: character,
      startOffset,
      endOffset: offset,
      script: classifyDocxFontScript(character, style),
    });
  }

  const fallbackScript = neutralScript(style);
  const nextStrongScript: Array<DocxFontScript | undefined> = new Array(
    tokens.length
  );
  let nextScript: DocxFontScript | undefined;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    nextStrongScript[index] = nextScript;
    if (tokens[index]?.script) {
      nextScript = tokens[index]?.script;
    }
  }

  let previousScript: DocxFontScript | undefined;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }
    token.script =
      token.script ??
      previousScript ??
      nextStrongScript[index] ??
      fallbackScript;
    previousScript = token.script;
  }

  const segments: DocxScriptFontSegment[] = [];
  const families = new Map<DocxFontScript, { family?: string; key?: string }>();
  let previousFamilyKey: string | undefined;
  for (const token of tokens) {
    const script = token.script ?? fallbackScript;
    let resolved = families.get(script);
    if (!resolved) {
      const family = resolveDocxScriptFontFamily(style, script);
      resolved = { family, key: normalizedFamilyKey(family) };
      families.set(script, resolved);
    }
    const fontFamily = resolved.family;
    const previous = segments[segments.length - 1];
    if (previous && previousFamilyKey === resolved.key) {
      previous.text += token.text;
      previous.endOffset = token.endOffset;
      continue;
    }
    previousFamilyKey = resolved.key;
    segments.push({
      text: token.text,
      startOffset: token.startOffset,
      endOffset: token.endOffset,
      script,
      fontFamily,
    });
  }

  return segments;
}

export function resolveDocxTextFontFamily(
  text: string,
  style?: TextStyle
): string | undefined {
  let hasStrongScript = false;
  for (const character of text) {
    const script = classifyDocxFontScript(character, style);
    if (!script) continue;
    hasStrongScript = true;
    const family = resolveDocxScriptFontFamily(style, script);
    if (family) return family;
  }
  return (
    (text && !hasStrongScript
      ? resolveDocxScriptFontFamily(style, neutralScript(style))
      : undefined) ?? normalizeFamily(style?.fontFamily)
  );
}
