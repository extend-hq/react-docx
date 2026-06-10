use std::collections::HashMap;
use std::sync::LazyLock;

use miniz_oxide::inflate::decompress_to_vec_with_limit;

use crate::package::{OoxmlPackage, OoxmlPart};

const ZIP_LOCAL_FILE_HEADER_SIGNATURE: u32 = 0x0403_4b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE: u32 = 0x0201_4b50;
const ZIP_EOCD_SIGNATURE: u32 = 0x0605_4b50;
const UTF8_FLAG: u16 = 0x0800;
const STORE_COMPRESSION: u16 = 0;
const DEFLATE_COMPRESSION: u16 = 8;

const DEFAULT_DOCUMENT_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t/></w:r></w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>"#;

const DEFAULT_CONTENT_TYPES_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"#;

const DEFAULT_ROOT_RELS_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#;

const DEFAULT_DOCUMENT_RELS_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>"#;

struct ZipEntry {
    name: String,
    compression_method: u16,
    compressed_size: u32,
    local_header_offset: u32,
}

fn read_u16_le(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}

fn read_u32_le(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

fn write_u16_le(out: &mut [u8], offset: usize, value: u16) {
    out[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn write_u32_le(out: &mut [u8], offset: usize, value: u32) {
    out[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn find_eocd_offset(bytes: &[u8]) -> Result<usize, String> {
    const MINIMUM_LENGTH: usize = 22;
    if bytes.len() < MINIMUM_LENGTH {
        return Err("Invalid DOCX ZIP: too small to contain EOCD".to_string());
    }

    let max_comment_length = 0xffff;
    let search_start = bytes
        .len()
        .saturating_sub(MINIMUM_LENGTH + max_comment_length);

    let mut index = bytes.len().saturating_sub(MINIMUM_LENGTH);
    while index >= search_start {
        if read_u32_le(bytes, index) == ZIP_EOCD_SIGNATURE {
            return Ok(index);
        }
        if index == 0 {
            break;
        }
        index -= 1;
    }

    Err("Invalid DOCX ZIP: end of central directory not found".to_string())
}

fn parse_central_directory(bytes: &[u8]) -> Result<Vec<ZipEntry>, String> {
    let eocd_offset = find_eocd_offset(bytes)?;
    let total_entries = read_u16_le(bytes, eocd_offset + 10) as usize;
    let central_directory_offset = read_u32_le(bytes, eocd_offset + 16) as usize;

    let mut entries = Vec::with_capacity(total_entries);
    let mut cursor = central_directory_offset;

    for _ in 0..total_entries {
        if read_u32_le(bytes, cursor) != ZIP_CENTRAL_DIRECTORY_SIGNATURE {
            return Err("Invalid DOCX ZIP: malformed central directory".to_string());
        }

        let compression_method = read_u16_le(bytes, cursor + 10);
        let compressed_size = read_u32_le(bytes, cursor + 20);
        let file_name_length = read_u16_le(bytes, cursor + 28) as usize;
        let extra_field_length = read_u16_le(bytes, cursor + 30) as usize;
        let file_comment_length = read_u16_le(bytes, cursor + 32) as usize;
        let local_header_offset = read_u32_le(bytes, cursor + 42);

        let file_name_start = cursor + 46;
        let file_name_end = file_name_start + file_name_length;
        let name = String::from_utf8_lossy(&bytes[file_name_start..file_name_end]).into_owned();

        entries.push(ZipEntry {
            name,
            compression_method,
            compressed_size,
            local_header_offset,
        });

        cursor = file_name_end + extra_field_length + file_comment_length;
    }

    Ok(entries)
}

fn inflate_raw(data: &[u8]) -> Result<Vec<u8>, String> {
    decompress_to_vec_with_limit(data, usize::MAX).map_err(|error| {
        format!("Failed to inflate DOCX ZIP entry: {error:?}")
    })
}

fn extract_entry_data(bytes: &[u8], entry: &ZipEntry) -> Result<Vec<u8>, String> {
    let local_header_offset = entry.local_header_offset as usize;

    if read_u32_le(bytes, local_header_offset) != ZIP_LOCAL_FILE_HEADER_SIGNATURE {
        return Err(format!(
            "Invalid DOCX ZIP: bad local header for {}",
            entry.name
        ));
    }

    let file_name_length = read_u16_le(bytes, local_header_offset + 26) as usize;
    let extra_field_length = read_u16_le(bytes, local_header_offset + 28) as usize;
    let payload_offset = local_header_offset + 30 + file_name_length + extra_field_length;
    let payload_end = payload_offset + entry.compressed_size as usize;
    let compressed_data = &bytes[payload_offset..payload_end];

    if entry.compression_method == STORE_COMPRESSION {
        return Ok(compressed_data.to_vec());
    }

    if entry.compression_method == DEFLATE_COMPRESSION {
        return inflate_raw(compressed_data);
    }

    Err(format!(
        "Unsupported DOCX ZIP compression method {} for {}",
        entry.compression_method, entry.name
    ))
}

pub fn is_text_part(part_name: &str) -> bool {
    if part_name == "[Content_Types].xml" {
        return true;
    }

    match part_name.rsplit_once('.') {
        Some((_, extension)) => {
            extension.eq_ignore_ascii_case("xml")
                || extension.eq_ignore_ascii_case("rels")
                || extension.eq_ignore_ascii_case("txt")
        }
        None => false,
    }
}

pub fn parse_docx(bytes: &[u8]) -> Result<OoxmlPackage, String> {
    if bytes.is_empty() {
        return Err("DOCX input cannot be empty".to_string());
    }

    let entries = parse_central_directory(bytes)?;
    let mut parts = HashMap::new();
    let mut binary_assets = HashMap::new();

    for entry in entries {
        if entry.name.ends_with('/') {
            continue;
        }

        let file_bytes = extract_entry_data(bytes, &entry)?;

        if is_text_part(&entry.name) {
            parts.insert(
                entry.name.clone(),
                OoxmlPart {
                    name: entry.name,
                    content: String::from_utf8_lossy(&file_bytes).into_owned(),
                },
            );
            continue;
        }

        binary_assets.insert(entry.name, file_bytes);
    }

    if !parts.contains_key("word/document.xml") {
        return Err("Invalid DOCX: missing word/document.xml".to_string());
    }

    Ok(OoxmlPackage {
        parts,
        binary_assets,
    })
}

fn create_crc32_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    for index in 0..256 {
        let mut value = index as u32;
        for _ in 0..8 {
            value = if value & 1 == 1 {
                (value >> 1) ^ 0xedb8_8320
            } else {
                value >> 1
            };
        }
        table[index] = value;
    }
    table
}

static CRC32_TABLE: LazyLock<[u32; 256]> = LazyLock::new(create_crc32_table);

fn crc32(bytes: &[u8]) -> u32 {
    let mut value = 0xffff_ffffu32;
    for byte in bytes {
        value = (value >> 8) ^ CRC32_TABLE[((value ^ u32::from(*byte)) & 0xff) as usize];
    }
    value ^ 0xffff_ffff
}

fn concat_bytes(chunks: &[&[u8]]) -> Vec<u8> {
    let total_length: usize = chunks.iter().map(|chunk| chunk.len()).sum();
    let mut output = Vec::with_capacity(total_length);
    for chunk in chunks {
        output.extend_from_slice(chunk);
    }
    output
}

pub fn package_to_bytes(pkg: &OoxmlPackage) -> Result<Vec<u8>, String> {
    let mut entries: Vec<(String, Vec<u8>)> = pkg
        .parts
        .values()
        .map(|part| (part.name.clone(), part.content.as_bytes().to_vec()))
        .chain(
            pkg.binary_assets
                .iter()
                .map(|(name, data)| (name.clone(), data.clone())),
        )
        .collect();

    entries.sort_by(|left, right| left.0.cmp(&right.0));

    if entries.is_empty() {
        return Err("Cannot create DOCX ZIP from an empty package".to_string());
    }

    if entries.len() > 0xffff {
        return Err("Too many ZIP entries for non-ZIP64 writer".to_string());
    }

    let mut local_chunks: Vec<Vec<u8>> = Vec::new();
    let mut central_chunks: Vec<Vec<u8>> = Vec::new();
    let mut offset = 0u32;

    for (name, payload) in &entries {
        let name_bytes = name.as_bytes();
        let crc = crc32(payload);

        let mut local_header = vec![0u8; 30 + name_bytes.len() + payload.len()];
        write_u32_le(&mut local_header, 0, ZIP_LOCAL_FILE_HEADER_SIGNATURE);
        write_u16_le(&mut local_header, 4, 20);
        write_u16_le(&mut local_header, 6, UTF8_FLAG);
        write_u16_le(&mut local_header, 8, STORE_COMPRESSION);
        write_u16_le(&mut local_header, 10, 0);
        write_u16_le(&mut local_header, 12, 0);
        write_u32_le(&mut local_header, 14, crc);
        write_u32_le(&mut local_header, 18, payload.len() as u32);
        write_u32_le(&mut local_header, 22, payload.len() as u32);
        write_u16_le(&mut local_header, 26, name_bytes.len() as u16);
        write_u16_le(&mut local_header, 28, 0);
        local_header[30..30 + name_bytes.len()].copy_from_slice(name_bytes);
        local_header[30 + name_bytes.len()..].copy_from_slice(payload);
        local_chunks.push(local_header.clone());

        let mut central_header = vec![0u8; 46 + name_bytes.len()];
        write_u32_le(&mut central_header, 0, ZIP_CENTRAL_DIRECTORY_SIGNATURE);
        write_u16_le(&mut central_header, 4, 20);
        write_u16_le(&mut central_header, 6, 20);
        write_u16_le(&mut central_header, 8, UTF8_FLAG);
        write_u16_le(&mut central_header, 10, STORE_COMPRESSION);
        write_u16_le(&mut central_header, 12, 0);
        write_u16_le(&mut central_header, 14, 0);
        write_u32_le(&mut central_header, 16, crc);
        write_u32_le(&mut central_header, 20, payload.len() as u32);
        write_u32_le(&mut central_header, 24, payload.len() as u32);
        write_u16_le(&mut central_header, 28, name_bytes.len() as u16);
        write_u16_le(&mut central_header, 30, 0);
        write_u16_le(&mut central_header, 32, 0);
        write_u16_le(&mut central_header, 34, 0);
        write_u16_le(&mut central_header, 36, 0);
        write_u32_le(&mut central_header, 38, 0);
        write_u32_le(&mut central_header, 42, offset);
        central_header[46..].copy_from_slice(name_bytes);
        central_chunks.push(central_header);

        offset += local_header.len() as u32;
    }

    let central_directory_offset = offset;
    let central_directory: Vec<u8> = central_chunks.into_iter().flatten().collect();
    let local_file_data: Vec<u8> = local_chunks.into_iter().flatten().collect();

    let mut eocd = vec![0u8; 22];
    write_u32_le(&mut eocd, 0, ZIP_EOCD_SIGNATURE);
    write_u16_le(&mut eocd, 4, 0);
    write_u16_le(&mut eocd, 6, 0);
    write_u16_le(&mut eocd, 8, entries.len() as u16);
    write_u16_le(&mut eocd, 10, entries.len() as u16);
    write_u32_le(&mut eocd, 12, central_directory.len() as u32);
    write_u32_le(&mut eocd, 16, central_directory_offset);
    write_u16_le(&mut eocd, 20, 0);

    Ok(concat_bytes(&[
        &local_file_data,
        &central_directory,
        &eocd,
    ]))
}

pub fn create_minimal_docx_package(document_xml: Option<&str>) -> OoxmlPackage {
    let document_xml = document_xml.unwrap_or(DEFAULT_DOCUMENT_XML);

    let mut parts = HashMap::new();
    parts.insert(
        "[Content_Types].xml".to_string(),
        OoxmlPart {
            name: "[Content_Types].xml".to_string(),
            content: DEFAULT_CONTENT_TYPES_XML.to_string(),
        },
    );
    parts.insert(
        "_rels/.rels".to_string(),
        OoxmlPart {
            name: "_rels/.rels".to_string(),
            content: DEFAULT_ROOT_RELS_XML.to_string(),
        },
    );
    parts.insert(
        "word/document.xml".to_string(),
        OoxmlPart {
            name: "word/document.xml".to_string(),
            content: document_xml.to_string(),
        },
    );
    parts.insert(
        "word/_rels/document.xml.rels".to_string(),
        OoxmlPart {
            name: "word/_rels/document.xml.rels".to_string(),
            content: DEFAULT_DOCUMENT_RELS_XML.to_string(),
        },
    );

    OoxmlPackage {
        parts,
        binary_assets: HashMap::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::package::get_part;

    const DOCUMENT_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello DOCX</w:t></w:r></w:p></w:body></w:document>"#;

    struct ZipSourceEntry<'a> {
        name: &'a str,
        content: &'a str,
        deflate: bool,
    }

    fn create_zip(entries: &[ZipSourceEntry<'_>]) -> Vec<u8> {
        let mut local_chunks: Vec<Vec<u8>> = Vec::new();
        let mut central_chunks: Vec<Vec<u8>> = Vec::new();
        let mut offset = 0u32;

        for entry in entries {
            let name_bytes = entry.name.as_bytes();
            let uncompressed = entry.content.as_bytes();
            let compression_method = if entry.deflate {
                DEFLATE_COMPRESSION
            } else {
                STORE_COMPRESSION
            };
            let compressed = if entry.deflate {
                miniz_oxide::deflate::compress_to_vec(uncompressed, 6)
            } else {
                uncompressed.to_vec()
            };
            let crc = crc32(uncompressed);

            let mut local = vec![0u8; 30 + name_bytes.len() + compressed.len()];
            write_u32_le(&mut local, 0, ZIP_LOCAL_FILE_HEADER_SIGNATURE);
            write_u16_le(&mut local, 4, 20);
            write_u16_le(&mut local, 6, UTF8_FLAG);
            write_u16_le(&mut local, 8, compression_method);
            write_u16_le(&mut local, 10, 0);
            write_u16_le(&mut local, 12, 0);
            write_u32_le(&mut local, 14, crc);
            write_u32_le(&mut local, 18, compressed.len() as u32);
            write_u32_le(&mut local, 22, uncompressed.len() as u32);
            write_u16_le(&mut local, 26, name_bytes.len() as u16);
            write_u16_le(&mut local, 28, 0);
            local[30..30 + name_bytes.len()].copy_from_slice(name_bytes);
            local[30 + name_bytes.len()..].copy_from_slice(&compressed);
            local_chunks.push(local.clone());

            let mut central = vec![0u8; 46 + name_bytes.len()];
            write_u32_le(&mut central, 0, ZIP_CENTRAL_DIRECTORY_SIGNATURE);
            write_u16_le(&mut central, 4, 20);
            write_u16_le(&mut central, 6, 20);
            write_u16_le(&mut central, 8, UTF8_FLAG);
            write_u16_le(&mut central, 10, compression_method);
            write_u16_le(&mut central, 12, 0);
            write_u16_le(&mut central, 14, 0);
            write_u32_le(&mut central, 16, crc);
            write_u32_le(&mut central, 20, compressed.len() as u32);
            write_u32_le(&mut central, 24, uncompressed.len() as u32);
            write_u16_le(&mut central, 28, name_bytes.len() as u16);
            write_u16_le(&mut central, 30, 0);
            write_u16_le(&mut central, 32, 0);
            write_u16_le(&mut central, 34, 0);
            write_u16_le(&mut central, 36, 0);
            write_u32_le(&mut central, 38, 0);
            write_u32_le(&mut central, 42, offset);
            central[46..].copy_from_slice(name_bytes);
            central_chunks.push(central);

            offset += local.len() as u32;
        }

        let local_data: Vec<u8> = local_chunks.into_iter().flatten().collect();
        let central_data: Vec<u8> = central_chunks.into_iter().flatten().collect();

        let mut eocd = vec![0u8; 22];
        write_u32_le(&mut eocd, 0, ZIP_EOCD_SIGNATURE);
        write_u16_le(&mut eocd, 4, 0);
        write_u16_le(&mut eocd, 6, 0);
        write_u16_le(&mut eocd, 8, entries.len() as u16);
        write_u16_le(&mut eocd, 10, entries.len() as u16);
        write_u32_le(&mut eocd, 12, central_data.len() as u32);
        write_u32_le(&mut eocd, 16, local_data.len() as u32);
        write_u16_le(&mut eocd, 20, 0);

        concat_bytes(&[&local_data, &central_data, &eocd])
    }

    #[test]
    fn throws_on_empty_input() {
        let error = parse_docx(&[]).unwrap_err();
        assert!(error.contains("cannot be empty"));
    }

    #[test]
    fn parses_stored_zip_entries() {
        let zip = create_zip(&[
            ZipSourceEntry {
                name: "[Content_Types].xml",
                content: "<Types/>",
                deflate: false,
            },
            ZipSourceEntry {
                name: "word/document.xml",
                content: DOCUMENT_XML,
                deflate: false,
            },
        ]);
        let pkg = parse_docx(&zip).expect("parse stored zip");

        assert!(
            get_part(&pkg, "word/document.xml")
                .expect("document part")
                .content
                .contains("Hello DOCX")
        );
    }

    #[test]
    fn parses_deflated_zip_entries() {
        let zip = create_zip(&[
            ZipSourceEntry {
                name: "[Content_Types].xml",
                content: "<Types/>",
                deflate: true,
            },
            ZipSourceEntry {
                name: "word/document.xml",
                content: DOCUMENT_XML,
                deflate: true,
            },
        ]);
        let pkg = parse_docx(&zip).expect("parse deflated zip");

        assert!(
            get_part(&pkg, "word/document.xml")
                .expect("document part")
                .content
                .contains("Hello DOCX")
        );
    }

    #[test]
    fn writes_and_reparses_docx_zip_archives() {
        let source = create_minimal_docx_package(Some(DOCUMENT_XML));
        let zip = package_to_bytes(&source).expect("package to bytes");
        let reparsed = parse_docx(&zip).expect("reparse docx");

        assert!(
            reparsed
                .parts
                .get("word/document.xml")
                .expect("document part")
                .content
                .contains("Hello DOCX")
        );
    }
}
