import { createMinimalDocxPackage, packageToArrayBuffer } from "@extend-ai/react-docx-ooxml-core";

export const LEGACY_PARAGRAPHS = ["Plain café", "Second line"];

export function createLegacyDoc(): ArrayBuffer {
  const bytes = new Uint8Array(19 * 512);
  const view = new DataView(bytes.buffer);
  const u16 = (offset: number, value: number) => view.setUint16(offset, value, true);
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  const utf16 = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) u16(offset + i * 2, text.charCodeAt(i));
  };
  const end = 0xfffffffe;
  const free = 0xffffffff;
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  u16(24, 0x3e);
  u16(26, 3);
  u16(28, 0xfffe);
  u16(30, 9);
  u16(32, 6);
  u32(44, 1);
  u32(48, 1);
  u32(56, 4096);
  u32(60, end);
  u32(68, end);
  for (let i = 0; i < 109; i++) u32(76 + i * 4, free);
  u32(76, 0);
  for (let i = 0; i < 128; i++) u32(512 + i * 4, free);
  u32(512, 0xfffffffd);
  u32(516, end);
  for (const start of [2, 10]) {
    for (let i = start; i < start + 8; i++) u32(512 + i * 4, i === start + 7 ? end : i + 1);
  }
  const entry = (index: number, name: string, kind: number, sector: number, size: number) => {
    const offset = 1024 + index * 128;
    utf16(offset, name);
    u16(offset + 64, (name.length + 1) * 2);
    bytes[offset + 66] = kind;
    bytes[offset + 67] = 1;
    for (const field of [68, 72, 76]) u32(offset + field, free);
    u32(offset + 116, sector);
    u32(offset + 120, size);
  };
  entry(0, "Root Entry", 5, end, 0);
  entry(1, "WordDocument", 2, 2, 4096);
  entry(2, "1Table", 2, 10, 4096);
  u32(1024 + 76, 1);
  u32(1024 + 128 + 68, 2);
  bytes[1024 + 256 + 67] = 0;
  const word = 3 * 512;
  const text = LEGACY_PARAGRAPHS.join("\r") + "\r";
  u16(word, 0xa5ec);
  u16(word + 2, 0xc1);
  u16(word + 10, 0x204);
  u16(word + 32, 14);
  u16(word + 62, 22);
  u32(word + 76, text.length);
  u16(word + 152, 34);
  u32(word + 422, 21);
  utf16(word + 512, text);
  const table = 11 * 512;
  bytes[table] = 2;
  u32(table + 1, 16);
  u32(table + 9, text.length);
  u32(table + 15, 512);
  return bytes.buffer;
}

export async function createDocxTwin(): Promise<ArrayBuffer> {
  const body = LEGACY_PARAGRAPHS.map(text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join("");
  return packageToArrayBuffer(createMinimalDocxPackage(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  ));
}
