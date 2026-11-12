import type { DocModel, ImageRunNode } from "./types";

/** Part the parser names as the body source of an OpenDocument text file. */
const OPEN_DOCUMENT_BODY_PART = "content.xml";

/**
 * True for a model read from OpenDocument text (`.odt`, `.ott`, `.odm`,
 * `.otm`, `.oth` or flat `.fodt`).
 *
 * Such a model has no Word package or Word source markup behind it, so it can
 * be displayed but not serialized to DOCX. The check reads the source part the
 * parser recorded, not a file name.
 */
export function isOpenDocumentModel(model: Pick<DocModel, "metadata">): boolean {
  return model.metadata?.sourcePartNames?.document === OPEN_DOCUMENT_BODY_PART;
}

/**
 * True for a block id the parser gave to OpenDocument content. Such ids name
 * an OpenDocument part after the document hash: `docx:<sha256>/content.xml/…`
 * for the body, notes and comments, `docx:<sha256>/styles.xml/…` for headers
 * and footers. Lets code that sees one block, not the model, tell that its
 * formatting came resolved from the file.
 */
export function isOpenDocumentBlockId(blockId: string | undefined): boolean {
  return blockId !== undefined && /^docx:[0-9a-f]+\/(?:content|styles)\.xml\//.test(blockId);
}

function bytesToBase64(bytes: Uint8Array): string | undefined {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  }
  if (typeof btoa !== "function") {
    return undefined;
  }
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.byteLength; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

/**
 * Picture source for an image that carries only its bytes and content type,
 * as OpenDocument images do. Word images already arrive with `src`.
 */
export function imageDataSource(image: Pick<ImageRunNode, "data" | "contentType">): string | undefined {
  const contentType = image.contentType?.trim().toLowerCase();
  if (!image.data?.byteLength || !contentType || !/^image\/[a-z0-9.+-]+$/.test(contentType)) {
    return undefined;
  }
  const base64 = bytesToBase64(image.data);
  return base64 ? `data:${contentType};base64,${base64}` : undefined;
}
