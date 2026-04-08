import { deflateRawSync } from "node:zlib";

interface ZipSourceEntry {
  name: string;
  content: string | Uint8Array;
  deflate?: boolean;
}

const TEXT_ENCODER = new TextEncoder();
const UTF8_FLAG = 0x0800;

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

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function asBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === "string" ? TEXT_ENCODER.encode(content) : content;
}

export function createZip(entries: ZipSourceEntry[]): ArrayBuffer {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = TEXT_ENCODER.encode(entry.name);
    const uncompressed = asBytes(entry.content);
    const compressionMethod = entry.deflate ? 8 : 0;
    const compressed = entry.deflate ? new Uint8Array(deflateRawSync(uncompressed)) : uncompressed;
    const crc = crc32(uncompressed);

    const local = new Uint8Array(30 + nameBytes.byteLength + compressed.byteLength);
    const localView = view(local);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, UTF8_FLAG, true);
    localView.setUint16(8, compressionMethod, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, compressed.byteLength, true);
    localView.setUint32(22, uncompressed.byteLength, true);
    localView.setUint16(26, nameBytes.byteLength, true);
    localView.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(compressed, 30 + nameBytes.byteLength);
    localChunks.push(local);

    const central = new Uint8Array(46 + nameBytes.byteLength);
    const centralView = view(central);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, UTF8_FLAG, true);
    centralView.setUint16(10, compressionMethod, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, compressed.byteLength, true);
    centralView.setUint32(24, uncompressed.byteLength, true);
    centralView.setUint16(28, nameBytes.byteLength, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralChunks.push(central);

    offset += local.byteLength;
  }

  const localData = concat(localChunks);
  const centralData = concat(centralChunks);

  const eocd = new Uint8Array(22);
  const eocdView = view(eocd);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralData.byteLength, true);
  eocdView.setUint32(16, localData.byteLength, true);
  eocdView.setUint16(20, 0, true);

  const zip = concat([localData, centralData, eocd]);
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
}
