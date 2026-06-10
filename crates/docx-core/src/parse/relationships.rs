use std::collections::HashMap;

use crate::package::{OoxmlPackage, OoxmlPart};
use crate::parse::context::ContentTypeLookup;
use crate::xml::get_attribute;

/// Mirrors TypeScript `MIME_BY_EXTENSION`.
pub fn mime_by_extension(extension: &str) -> Option<&'static str> {
    match extension.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "bmp" => Some("image/bmp"),
        "wmf" => Some("image/wmf"),
        "emf" => Some("image/emf"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

/// Mirrors TypeScript `resolvePartPath`.
pub fn resolve_part_path(base_part_name: &str, target: &str) -> String {
    if target.is_empty() {
        return String::new();
    }

    if target
        .chars()
        .next()
        .is_some_and(|ch| ch.is_ascii_alphabetic())
        && target.contains(':')
    {
        return target.to_string();
    }

    if target.starts_with('#') {
        return target.to_string();
    }

    if target.starts_with('/') {
        return target[1..].to_string();
    }

    let mut base_segments: Vec<&str> = base_part_name.split('/').collect();
    if !base_segments.is_empty() {
        base_segments.pop();
    }

    let mut output: Vec<String> = base_segments.into_iter().map(str::to_string).collect();
    for segment in target.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            output.pop();
            continue;
        }
        output.push(segment.to_string());
    }

    output.join("/")
}

/// Mirrors TypeScript `relationshipPartNameForPart`.
pub fn relationship_part_name_for_part(part_name: &str) -> String {
    let mut segments: Vec<&str> = part_name.split('/').collect();
    let file_name = segments.pop().unwrap_or("");
    let folder = segments.join("/");
    if folder.is_empty() {
        format!("_rels/{file_name}.rels")
    } else {
        format!("{folder}/_rels/{file_name}.rels")
    }
}

/// Mirrors TypeScript `parsePartRelationships`.
pub fn parse_part_relationships(pkg: &OoxmlPackage, part_name: &str) -> HashMap<String, String> {
    parse_relationships_from_parts(&pkg.parts, part_name)
}

/// Mirrors TypeScript `parseRelationshipsFromParts`.
pub fn parse_relationships_from_parts(
    parts: &HashMap<String, OoxmlPart>,
    part_name: &str,
) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let relationships_part_name = relationship_part_name_for_part(part_name);
    let Some(relationships_part) = parts.get(&relationships_part_name) else {
        return map;
    };

    for tag in find_opening_tags(&relationships_part.content, "Relationship") {
        let id = get_attribute(&tag, "Id");
        let target = get_attribute(&tag, "Target");
        if let (Some(id), Some(target)) = (id, target) {
            map.insert(id, resolve_part_path(part_name, &target));
        }
    }

    map
}

/// Mirrors TypeScript `extensionFromPartName`.
pub fn extension_from_part_name(part_name: &str) -> Option<String> {
    let last_dot = part_name.rfind('.')?;
    if last_dot == part_name.len() - 1 {
        return None;
    }
    Some(part_name[last_dot + 1..].to_ascii_lowercase())
}

/// Mirrors TypeScript `contentTypeForPart`.
pub fn content_type_for_part(part_name: &str, content_types: &ContentTypeLookup) -> Option<String> {
    if let Some(override_type) = content_types
        .override_by_part_name
        .get(part_name)
        .or_else(|| content_types.override_by_part_name.get(&format!("/{part_name}")))
    {
        return Some(override_type.clone());
    }

    let extension = extension_from_part_name(part_name)?;
    content_types
        .default_by_extension
        .get(&extension)
        .cloned()
        .or_else(|| mime_by_extension(&extension).map(str::to_string))
}

/// Mirrors TypeScript `bytesToBase64`.
pub fn bytes_to_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::new();
    let mut index = 0;

    while index < bytes.len() {
        let b0 = bytes[index] as u32;
        let b1 = bytes.get(index + 1).copied().unwrap_or(0) as u32;
        let b2 = bytes.get(index + 2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;

        output.push(TABLE[((triple >> 18) & 0x3F) as usize] as char);
        output.push(TABLE[((triple >> 12) & 0x3F) as usize] as char);

        if index + 1 < bytes.len() {
            output.push(TABLE[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            output.push('=');
        }

        if index + 2 < bytes.len() {
            output.push(TABLE[(triple & 0x3F) as usize] as char);
        } else {
            output.push('=');
        }

        index += 3;
    }

    output
}

fn find_opening_tags(xml: &str, local_name: &str) -> Vec<String> {
    let open_prefix = format!("<{local_name}");
    let mut tags = Vec::new();
    let mut index = 0;

    while index < xml.len() {
        let Some(tag_start) = find_case_insensitive_at(xml, index, &open_prefix) else {
            break;
        };

        if !has_word_boundary_after(xml, tag_start + open_prefix.len()) {
            index = tag_start + 1;
            continue;
        }

        let Some(relative_gt) = xml[tag_start..].find('>') else {
            break;
        };

        let tag_end = tag_start + relative_gt + 1;
        tags.push(xml[tag_start..tag_end].to_string());
        index = tag_end;
    }

    tags
}

fn has_word_boundary_after(xml: &str, index: usize) -> bool {
    xml.as_bytes()
        .get(index)
        .is_none_or(|byte| !byte.is_ascii_alphanumeric() && *byte != b'_')
}

fn find_case_insensitive_at(haystack: &str, start: usize, needle: &str) -> Option<usize> {
    if needle.is_empty() || start >= haystack.len() || needle.len() > haystack.len() {
        return None;
    }

    let haystack_bytes = haystack.as_bytes();
    let needle_bytes = needle.as_bytes();
    let max_start = haystack.len() - needle.len();

    for index in start..=max_start {
        if haystack_bytes[index..index + needle.len()]
            .iter()
            .zip(needle_bytes.iter())
            .all(|(left, right)| left.eq_ignore_ascii_case(right))
        {
            return Some(index);
        }
    }

    None
}
