export interface OoxmlPart {
  name: string;
  content: string;
}

export interface OoxmlPackage {
  parts: Map<string, OoxmlPart>;
  binaryAssets: Map<string, Uint8Array>;
}

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
}

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
const STORE_COMPRESSION = 0;
const DEFLATE_COMPRESSION = 8;

const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();
let cachedZlibInflate:
  | ((input: Uint8Array) => Uint8Array)
  | undefined;

const WORD_MAIN_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const DEFAULT_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${WORD_MAIN_NS}">
  <w:body>
    <w:p><w:r><w:t/></w:r></w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const DEFAULT_CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const DEFAULT_ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DEFAULT_DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function decodeZipString(input: Uint8Array): string {
  return TEXT_DECODER.decode(input);
}

function findEocdOffset(bytes: Uint8Array): number {
  const minimumLength = 22;
  if (bytes.byteLength < minimumLength) {
    throw new Error("Invalid DOCX ZIP: too small to contain EOCD");
  }

  const view = dataView(bytes);
  const maxCommentLength = 0xffff;
  const searchStart = Math.max(0, bytes.byteLength - minimumLength - maxCommentLength);

  for (let index = bytes.byteLength - minimumLength; index >= searchStart; index -= 1) {
    if (view.getUint32(index, true) === ZIP_EOCD_SIGNATURE) {
      return index;
    }
  }

  throw new Error("Invalid DOCX ZIP: end of central directory not found");
}

function parseCentralDirectory(bytes: Uint8Array): ZipEntry[] {
  const view = dataView(bytes);
  const eocdOffset = findEocdOffset(bytes);

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);

  const entries: ZipEntry[] = [];
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (view.getUint32(cursor, true) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("Invalid DOCX ZIP: malformed central directory");
    }

    const compressionMethod = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraFieldLength = view.getUint16(cursor + 30, true);
    const fileCommentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);

    const fileNameStart = cursor + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    const nameBytes = bytes.subarray(fileNameStart, fileNameEnd);

    entries.push({
      name: decodeZipString(nameBytes),
      compressionMethod,
      compressedSize,
      localHeaderOffset
    });

    cursor = fileNameEnd + extraFieldLength + fileCommentLength;
  }

  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "undefined") {
    const payload = Uint8Array.from(data);
    const stream = new Blob([payload])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    const output = await new Response(stream).arrayBuffer();
    return new Uint8Array(output);
  }

  if (!cachedZlibInflate) {
    const dynamicImport = Function(
      "specifier",
      "return import(specifier);"
    ) as (specifier: string) => Promise<{ inflateRawSync: (input: Uint8Array) => Uint8Array }>;
    const zlib = await dynamicImport("node:zlib");
    cachedZlibInflate = zlib.inflateRawSync;
  }

  const inflated = cachedZlibInflate(data);
  return new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.byteLength);
}

async function extractEntryData(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = dataView(bytes);
  const localHeaderOffset = entry.localHeaderOffset;

  if (view.getUint32(localHeaderOffset, true) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error(`Invalid DOCX ZIP: bad local header for ${entry.name}`);
  }

  const fileNameLength = view.getUint16(localHeaderOffset + 26, true);
  const extraFieldLength = view.getUint16(localHeaderOffset + 28, true);
  const payloadOffset = localHeaderOffset + 30 + fileNameLength + extraFieldLength;

  const compressedData = bytes.subarray(payloadOffset, payloadOffset + entry.compressedSize);

  if (entry.compressionMethod === STORE_COMPRESSION) {
    return new Uint8Array(compressedData);
  }

  if (entry.compressionMethod === DEFLATE_COMPRESSION) {
    return inflateRaw(compressedData);
  }

  throw new Error(
    `Unsupported DOCX ZIP compression method ${entry.compressionMethod} for ${entry.name}`
  );
}

function isTextPart(partName: string): boolean {
  return (
    partName === "[Content_Types].xml" ||
    /\.xml$/i.test(partName) ||
    /\.rels$/i.test(partName) ||
    /\.txt$/i.test(partName)
  );
}

export async function parseDocx(input: ArrayBuffer): Promise<OoxmlPackage> {
  if (input.byteLength === 0) {
    throw new Error("DOCX input cannot be empty");
  }

  const bytes = new Uint8Array(input);
  const entries = parseCentralDirectory(bytes);

  const parts = new Map<string, OoxmlPart>();
  const binaryAssets = new Map<string, Uint8Array>();

  const fileEntries = entries.filter((entry) => !entry.name.endsWith("/"));
  const extractedEntries = await Promise.all(
    fileEntries.map(async (entry) => ({
      entry,
      fileBytes: await extractEntryData(bytes, entry)
    }))
  );

  for (const extracted of extractedEntries) {
    const { entry, fileBytes } = extracted;
    if (isTextPart(entry.name)) {
      parts.set(entry.name, {
        name: entry.name,
        content: TEXT_DECODER.decode(fileBytes)
      });
      continue;
    }

    binaryAssets.set(entry.name, fileBytes);
  }

  if (!parts.has("word/document.xml")) {
    throw new Error("Invalid DOCX: missing word/document.xml");
  }

  return {
    parts,
    binaryAssets
  };
}

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC32_TABLE = createCrc32Table();

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = (value >>> 8) ^ CRC32_TABLE[(value ^ byte) & 0xff];
  }
  return (value ^ 0xffffffff) >>> 0;
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xffff, true);
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
}

export function packageToArrayBuffer(pkg: OoxmlPackage): ArrayBuffer {
  const entries = [
    ...Array.from(pkg.parts.values(), (part) => ({
      name: part.name,
      data: TEXT_ENCODER.encode(part.content)
    })),
    ...Array.from(pkg.binaryAssets.entries(), ([name, data]) => ({
      name,
      data
    }))
  ].sort((left, right) => left.name.localeCompare(right.name));

  if (entries.length === 0) {
    throw new Error("Cannot create DOCX ZIP from an empty package");
  }

  if (entries.length > 0xffff) {
    throw new Error("Too many ZIP entries for non-ZIP64 writer");
  }

  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = TEXT_ENCODER.encode(entry.name);
    const payload = entry.data;
    const crc = crc32(payload);

    const localHeader = new Uint8Array(30 + nameBytes.byteLength + payload.byteLength);
    const localView = dataView(localHeader);

    writeUint32(localView, 0, ZIP_LOCAL_FILE_HEADER_SIGNATURE);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, UTF8_FLAG);
    writeUint16(localView, 8, STORE_COMPRESSION);
    writeUint16(localView, 10, 0);
    writeUint16(localView, 12, 0);
    writeUint32(localView, 14, crc);
    writeUint32(localView, 18, payload.byteLength);
    writeUint32(localView, 22, payload.byteLength);
    writeUint16(localView, 26, nameBytes.byteLength);
    writeUint16(localView, 28, 0);

    localHeader.set(nameBytes, 30);
    localHeader.set(payload, 30 + nameBytes.byteLength);

    localChunks.push(localHeader);

    const centralHeader = new Uint8Array(46 + nameBytes.byteLength);
    const centralView = dataView(centralHeader);

    writeUint32(centralView, 0, ZIP_CENTRAL_DIRECTORY_SIGNATURE);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, UTF8_FLAG);
    writeUint16(centralView, 10, STORE_COMPRESSION);
    writeUint16(centralView, 12, 0);
    writeUint16(centralView, 14, 0);
    writeUint32(centralView, 16, crc);
    writeUint32(centralView, 20, payload.byteLength);
    writeUint32(centralView, 24, payload.byteLength);
    writeUint16(centralView, 28, nameBytes.byteLength);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, offset);
    centralHeader.set(nameBytes, 46);

    centralChunks.push(centralHeader);
    offset += localHeader.byteLength;
  }

  const centralDirectoryOffset = offset;
  const centralDirectory = concatUint8Arrays(centralChunks);
  const localFileData = concatUint8Arrays(localChunks);

  const eocd = new Uint8Array(22);
  const eocdView = dataView(eocd);
  writeUint32(eocdView, 0, ZIP_EOCD_SIGNATURE);
  writeUint16(eocdView, 4, 0);
  writeUint16(eocdView, 6, 0);
  writeUint16(eocdView, 8, entries.length);
  writeUint16(eocdView, 10, entries.length);
  writeUint32(eocdView, 12, centralDirectory.byteLength);
  writeUint32(eocdView, 16, centralDirectoryOffset);
  writeUint16(eocdView, 20, 0);

  const output = concatUint8Arrays([localFileData, centralDirectory, eocd]);
  return new Uint8Array(output).buffer;
}

export function createMinimalDocxPackage(documentXml = DEFAULT_DOCUMENT_XML): OoxmlPackage {
  return {
    parts: new Map([
      ["[Content_Types].xml", { name: "[Content_Types].xml", content: DEFAULT_CONTENT_TYPES_XML }],
      ["_rels/.rels", { name: "_rels/.rels", content: DEFAULT_ROOT_RELS_XML }],
      ["word/document.xml", { name: "word/document.xml", content: documentXml }],
      [
        "word/_rels/document.xml.rels",
        { name: "word/_rels/document.xml.rels", content: DEFAULT_DOCUMENT_RELS_XML }
      ]
    ]),
    binaryAssets: new Map()
  };
}

export function getPart(pkg: OoxmlPackage, partName: string): OoxmlPart | undefined {
  return pkg.parts.get(partName);
}

export function withPart(pkg: OoxmlPackage, part: OoxmlPart): OoxmlPackage {
  const parts = new Map(pkg.parts);
  parts.set(part.name, part);
  return {
    parts,
    binaryAssets: new Map(pkg.binaryAssets)
  };
}
