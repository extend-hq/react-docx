/**
 * Cheap structural content signatures for DOCX model values.
 *
 * Editor ops deep-clone the whole model on every change, so object identity
 * cannot tell "page content changed" apart from "model was cloned". These
 * signatures hash the *content* of a node once per object instance (memoized
 * by identity), so after an edit only nodes whose content actually differs
 * produce a different signature.
 *
 * Long strings (image data URIs can be multiple megabytes) are digested from
 * their length plus head/tail samples instead of being fully hashed.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const LONG_STRING_SAMPLE_LENGTH = 64;
const LONG_STRING_THRESHOLD = 256;

function fnv1aAppend(hash: number, text: string): number {
  let next = hash;
  for (let index = 0; index < text.length; index += 1) {
    next ^= text.charCodeAt(index);
    next = Math.imul(next, FNV_PRIME);
  }
  return next >>> 0;
}

function fnv1aAppendString(hash: number, value: string): number {
  if (value.length <= LONG_STRING_THRESHOLD) {
    return fnv1aAppend(fnv1aAppend(hash, `${value.length}:`), value);
  }

  const head = value.slice(0, LONG_STRING_SAMPLE_LENGTH);
  const middleIndex = Math.floor(value.length / 2);
  const middle = value.slice(
    middleIndex,
    middleIndex + LONG_STRING_SAMPLE_LENGTH
  );
  const tail = value.slice(value.length - LONG_STRING_SAMPLE_LENGTH);
  let next = fnv1aAppend(hash, `${value.length}:`);
  next = fnv1aAppend(next, head);
  next = fnv1aAppend(next, middle);
  return fnv1aAppend(next, tail);
}

function fnv1aAppendValue(hash: number, value: unknown): number {
  if (value === null) {
    return fnv1aAppend(hash, "~n");
  }

  switch (typeof value) {
    case "undefined":
      return fnv1aAppend(hash, "~u");
    case "string":
      return fnv1aAppendString(fnv1aAppend(hash, "~s"), value);
    case "number":
      return fnv1aAppend(hash, `~#${value}`);
    case "boolean":
      return fnv1aAppend(hash, value ? "~t" : "~f");
    case "object":
      break;
    default:
      // Functions/symbols carry no document content.
      return fnv1aAppend(hash, "~x");
  }

  if (Array.isArray(value)) {
    let next = fnv1aAppend(hash, `~a${value.length}`);
    for (const entry of value) {
      next = fnv1aAppendValue(next, entry);
    }
    return next;
  }

  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    const byteLength =
      value instanceof ArrayBuffer ? value.byteLength : value.byteLength;
    return fnv1aAppend(hash, `~b${byteLength}`);
  }

  let next = fnv1aAppend(hash, "~o");
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const entry = (value as Record<string, unknown>)[key];
    if (entry === undefined) {
      continue;
    }
    next = fnv1aAppend(next, key);
    next = fnv1aAppendValue(next, entry);
  }
  return next;
}

function contentHash(value: unknown): string {
  return fnv1aAppendValue(FNV_OFFSET_BASIS, value).toString(36);
}

const nodeSignatureCache = new WeakMap<object, string>();

/**
 * Returns a content signature for a document node (or any model object).
 * Memoized by object identity, so repeated calls between edits are free.
 */
export function docNodeContentSignature(node: unknown): string {
  if (typeof node !== "object" || node === null) {
    return contentHash(node);
  }

  const cached = nodeSignatureCache.get(node);
  if (cached !== undefined) {
    return cached;
  }

  const signature = contentHash(node);
  nodeSignatureCache.set(node, signature);
  return signature;
}

interface ThumbnailRelevantMetadata {
  sections?: unknown;
  numberingDefinitions?: unknown;
  footnotes?: unknown;
  endnotes?: unknown;
  documentBackgroundColor?: unknown;
  compatibility?: unknown;
  headerSections?: unknown;
  footerSections?: unknown;
}

const metadataSignatureCache = new WeakMap<object, string>();

/**
 * Signature of the metadata fields that affect a rendered page surface
 * (headers, footers, numbering, footnotes, page background). Deliberately
 * excludes bulky fields with no visual impact (`sourceParts`, `warnings`).
 */
export function docModelThumbnailMetadataSignature(metadata: object): string {
  const cached = metadataSignatureCache.get(metadata);
  if (cached !== undefined) {
    return cached;
  }

  const relevant = metadata as ThumbnailRelevantMetadata;
  let hash = FNV_OFFSET_BASIS;
  hash = fnv1aAppendValue(hash, relevant.sections);
  hash = fnv1aAppendValue(hash, relevant.headerSections);
  hash = fnv1aAppendValue(hash, relevant.footerSections);
  hash = fnv1aAppendValue(hash, relevant.numberingDefinitions);
  hash = fnv1aAppendValue(hash, relevant.footnotes);
  hash = fnv1aAppendValue(hash, relevant.endnotes);
  hash = fnv1aAppendValue(hash, relevant.documentBackgroundColor);
  hash = fnv1aAppendValue(hash, relevant.compatibility);
  const signature = (hash >>> 0).toString(36);
  metadataSignatureCache.set(metadata, signature);
  return signature;
}
