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
    uncompressed_size: u32,
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
        if cursor.checked_add(46).is_none_or(|end| end > bytes.len())
            || read_u32_le(bytes, cursor) != ZIP_CENTRAL_DIRECTORY_SIGNATURE
        {
            return Err("Invalid DOCX ZIP: malformed central directory".to_string());
        }

        let compression_method = read_u16_le(bytes, cursor + 10);
        let compressed_size = read_u32_le(bytes, cursor + 20);
        let uncompressed_size = read_u32_le(bytes, cursor + 24);
        let file_name_length = read_u16_le(bytes, cursor + 28) as usize;
        let extra_field_length = read_u16_le(bytes, cursor + 30) as usize;
        let file_comment_length = read_u16_le(bytes, cursor + 32) as usize;
        let local_header_offset = read_u32_le(bytes, cursor + 42);

        let file_name_start = cursor + 46;
        let file_name_end = file_name_start + file_name_length;
        if file_name_end
            .checked_add(extra_field_length + file_comment_length)
            .is_none_or(|end| end > bytes.len())
        {
            return Err("Invalid DOCX ZIP: truncated directory entry".into());
        }
        let name = String::from_utf8_lossy(&bytes[file_name_start..file_name_end]).into_owned();

        entries.push(ZipEntry {
            name,
            compression_method,
            compressed_size,
            uncompressed_size,
            local_header_offset,
        });

        cursor = file_name_end + extra_field_length + file_comment_length;
    }

    Ok(entries)
}

fn inflate_raw(data: &[u8]) -> Result<Vec<u8>, String> {
    decompress_to_vec_with_limit(data, usize::MAX)
        .map_err(|error| format!("Failed to inflate DOCX ZIP entry: {error:?}"))
}

#[derive(Default)]
struct ZipInflater {
    #[cfg(all(feature = "native-deflate", not(target_arch = "wasm32")))]
    native: libdeflater::Decompressor,
}

impl ZipInflater {
    fn decode(&mut self, compressed: &[u8], output: &mut [u8]) -> Option<usize> {
        #[cfg(all(feature = "native-deflate", not(target_arch = "wasm32")))]
        if let Ok(length) = self.native.deflate_decompress(compressed, output) {
            return Some(length);
        }
        let (decoded, status) = zlib_rs::decompress_slice(
            output,
            compressed,
            zlib_rs::InflateConfig { window_bits: -15 },
        );
        (status == zlib_rs::ReturnCode::Ok).then_some(decoded.len())
    }
}

fn extract_entry_data(
    bytes: &[u8],
    entry: &ZipEntry,
    inflater: &mut ZipInflater,
) -> Result<Vec<u8>, String> {
    let local_header_offset = entry.local_header_offset as usize;

    if local_header_offset
        .checked_add(30)
        .is_none_or(|end| end > bytes.len())
        || read_u32_le(bytes, local_header_offset) != ZIP_LOCAL_FILE_HEADER_SIGNATURE
    {
        return Err(format!(
            "Invalid DOCX ZIP: bad local header for {}",
            entry.name
        ));
    }

    let file_name_length = read_u16_le(bytes, local_header_offset + 26) as usize;
    let extra_field_length = read_u16_le(bytes, local_header_offset + 28) as usize;
    let payload_offset = local_header_offset + 30 + file_name_length + extra_field_length;
    let payload_end = payload_offset
        .checked_add(entry.compressed_size as usize)
        .ok_or("Invalid DOCX ZIP: entry size overflow")?;
    let compressed_data = bytes
        .get(payload_offset..payload_end)
        .ok_or("Invalid DOCX ZIP: truncated entry")?;

    if entry.compression_method == STORE_COMPRESSION {
        return Ok(compressed_data.to_vec());
    }

    if entry.compression_method == DEFLATE_COMPRESSION {
        let expected = entry.uncompressed_size as usize;
        if expected <= 64 * 1024 * 1024
            && expected <= compressed_data.len().saturating_mul(512).max(1024 * 1024)
        {
            let mut output = vec![0; expected];
            if let Some(length) = inflater.decode(compressed_data, &mut output) {
                output.truncate(length);
                return Ok(output);
            }
        }
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

fn decode_xml_part(bytes: Vec<u8>) -> Result<String, String> {
    let big_endian = bytes.starts_with(&[0xfe, 0xff]) || bytes.starts_with(&[0, b'<', 0, b'?']);
    let little_endian = bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[b'<', 0, b'?', 0]);
    if big_endian || little_endian {
        let skip = if bytes.starts_with(&[0xfe, 0xff]) || bytes.starts_with(&[0xff, 0xfe]) {
            2
        } else {
            0
        };
        let body = &bytes[skip..];
        if body.len() % 2 != 0 {
            return Err("Invalid UTF-16 XML byte length".into());
        }
        let units = body
            .chunks_exact(2)
            .map(|pair| {
                if big_endian {
                    u16::from_be_bytes([pair[0], pair[1]])
                } else {
                    u16::from_le_bytes([pair[0], pair[1]])
                }
            })
            .collect::<Vec<_>>();
        let xml =
            String::from_utf16(&units).map_err(|error| format!("Invalid UTF-16 XML: {error}"))?;
        static ENCODING: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
            regex::Regex::new(
                r#"(?i)encoding[\x09-\x0D\x20]*=[\x09-\x0D\x20]*["']UTF-16(?:LE|BE)?["']"#,
            )
            .unwrap()
        });
        let encoding = &*ENCODING;
        return Ok(encoding.replace(&xml, "encoding=\"UTF-8\"").into_owned());
    }
    String::from_utf8(bytes)
        .map_err(|error| format!("Invalid or unsupported XML encoding: {error}"))
}

#[cfg(not(target_arch = "wasm32"))]
fn extract_entry_group(
    bytes: &[u8],
    entries: &[ZipEntry],
    group: &[usize],
) -> Vec<(usize, Result<Vec<u8>, String>)> {
    let mut inflater = ZipInflater::default();
    group.iter().map(|&index| {
        (index, extract_entry_data(bytes, &entries[index], &mut inflater))
    }).collect()
}

#[cfg(not(target_arch = "wasm32"))]
#[cold]
fn parallel_entry_data(
    bytes: &[u8],
    entries: &[ZipEntry],
) -> Option<Vec<Option<Result<Vec<u8>, String>>>> {
    if bytes.len() < 16 * 1024
        || entries.iter().map(|entry| u64::from(entry.uncompressed_size)).sum::<u64>() < 64 * 1024
        || entries.iter().filter(|entry| {
            !entry.name.ends_with('/')
                && entry.compression_method == DEFLATE_COMPRESSION
                && entry.uncompressed_size >= 16 * 1024
        }).take(2).count() < 2
    {
        return None;
    }
    let pool = crate::parse::worker_pool()?;
    let mut jobs: Vec<_> = entries.iter().enumerate()
        .filter_map(|(index, entry)| (!entry.name.ends_with('/')).then_some(index))
        .collect();
    jobs.sort_unstable_by_key(|&index| std::cmp::Reverse(entries[index].uncompressed_size));
    let mut groups: [Vec<usize>; 4] = std::array::from_fn(|_| Vec::new());
    let mut weights = [0u64; 4];
    for index in jobs {
        let group = (0..4).min_by_key(|&group| weights[group]).unwrap();
        weights[group] += u64::from(entries[index].uncompressed_size);
        groups[group].push(index);
    }
    let mut outputs: [Option<Vec<(usize, Result<Vec<u8>, String>)>>; 4] = std::array::from_fn(|_| None);
    let (caller, workers) = outputs.split_first_mut().unwrap();
    pool.in_place_scope(|scope| {
        for (slot, group) in workers.iter_mut().zip(&groups[1..]) {
            scope.spawn(move |_| *slot = Some(extract_entry_group(bytes, entries, group)));
        }
        *caller = Some(extract_entry_group(bytes, entries, &groups[0]));
    });
    let mut result: Vec<_> = (0..entries.len()).map(|_| None).collect();
    for group in outputs.into_iter().flatten() {
        for (index, value) in group {
            result[index] = Some(value);
        }
    }
    Some(result)
}

#[cfg(not(target_arch = "wasm32"))]
#[cold]
fn package_from_parallel_entries(
    entries: Vec<ZipEntry>,
    results: Vec<Option<Result<Vec<u8>, String>>>,
) -> Result<OoxmlPackage, String> {
    let mut parts = HashMap::new();
    let mut binary_assets = HashMap::new();
    for (entry, data) in entries.into_iter().zip(results) {
        if entry.name.ends_with('/') {
            continue;
        }
        let data = data.expect("scheduled ZIP entry")?;
        if is_text_part(&entry.name) {
            parts.insert(entry.name.clone(), OoxmlPart {
                name: entry.name,
                content: decode_xml_part(data)?,
            });
        } else {
            binary_assets.insert(entry.name, data);
        }
    }
    let package = OoxmlPackage { parts, binary_assets, warnings: Vec::new() };
    let main_part = crate::package::main_document_part_name(&package);
    if !package.parts.contains_key(&main_part) {
        return Err(format!("Invalid DOCX: missing {main_part}"));
    }
    Ok(package)
}

pub fn parse_docx(bytes: &[u8]) -> Result<OoxmlPackage, String> {
    if bytes.is_empty() {
        return Err("DOCX input cannot be empty".to_string());
    }

    let entries = parse_central_directory(bytes)?;
    #[cfg(not(target_arch = "wasm32"))]
    if bytes.len() >= 16 * 1024 {
        if let Some(parallel) = parallel_entry_data(bytes, &entries) {
            return package_from_parallel_entries(entries, parallel);
        }
    }
    let mut parts = HashMap::new();
    let mut binary_assets = HashMap::new();
    let mut inflater = ZipInflater::default();

    for entry in entries {
        if entry.name.ends_with('/') {
            continue;
        }

        let file_bytes = extract_entry_data(bytes, &entry, &mut inflater)?;

        if is_text_part(&entry.name) {
            parts.insert(
                entry.name.clone(),
                OoxmlPart {
                    name: entry.name,
                    content: decode_xml_part(file_bytes)?,
                },
            );
            continue;
        }

        binary_assets.insert(entry.name, file_bytes);
    }

    let package = OoxmlPackage {
        parts,
        binary_assets,
        warnings: Vec::new(),
    };
    let main_part = crate::package::main_document_part_name(&package);
    if !package.parts.contains_key(&main_part) {
        return Err(format!("Invalid DOCX: missing {main_part}"));
    }
    Ok(package)
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

    Ok(concat_bytes(&[&local_file_data, &central_directory, &eocd]))
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
        warnings: Vec::new(),
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

        assert!(get_part(&pkg, "word/document.xml")
            .expect("document part")
            .content
            .contains("Hello DOCX"));
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

        assert!(get_part(&pkg, "word/document.xml")
            .expect("document part")
            .content
            .contains("Hello DOCX"));
    }

    #[test]
    fn writes_and_reparses_docx_zip_archives() {
        let source = create_minimal_docx_package(Some(DOCUMENT_XML));
        let zip = package_to_bytes(&source).expect("package to bytes");
        let reparsed = parse_docx(&zip).expect("reparse docx");

        assert!(reparsed
            .parts
            .get("word/document.xml")
            .expect("document part")
            .content
            .contains("Hello DOCX"));
    }
    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn parallel_entries_preserve_payloads_duplicates_and_error_order() {
        let mut state = 123456789u32;
        let payload: String = (0..512 * 1024).map(|_| {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            char::from(32 + (state % 95) as u8)
        }).collect();
        let mut zip = create_zip(&[
            ZipSourceEntry { name: "word/document.xml", content: DOCUMENT_XML, deflate: false },
            ZipSourceEntry { name: "payload/a.bin", content: &payload, deflate: true },
            ZipSourceEntry { name: "payload/b.bin", content: &payload, deflate: true },
            ZipSourceEntry { name: "payload/a.bin", content: "replacement", deflate: true },
            ZipSourceEntry { name: "payload/", content: "", deflate: false },
        ]);
        let entries = parse_central_directory(&zip).unwrap();
        let mut inflater = ZipInflater::default();
        let expected: Vec<_> = entries.iter().map(|entry| {
            (!entry.name.ends_with('/')).then(|| extract_entry_data(&zip, entry, &mut inflater))
        }).collect();
        assert_eq!(parallel_entry_data(&zip, &entries).unwrap(), expected);
        let parsed = parse_docx(&zip).unwrap();
        assert_eq!(parsed.binary_assets["payload/a.bin"], b"replacement");
        assert_eq!(parsed.binary_assets["payload/b.bin"], payload.as_bytes());
        assert!(!parsed.binary_assets.contains_key("payload/"));
        let main = entries[0].local_header_offset as usize;
        let content = main + 30 + read_u16_le(&zip, main + 26) as usize;
        zip[content] = 0xff;
        let later = entries[2].local_header_offset as usize;
        zip[later..later + 4].fill(0);
        assert!(parse_docx(&zip).unwrap_err().starts_with("Invalid or unsupported XML encoding:"));
    }

}
