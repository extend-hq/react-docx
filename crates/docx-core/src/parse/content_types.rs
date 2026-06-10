use std::collections::HashMap;

use crate::package::OoxmlPackage;
use crate::xml::get_attribute;

use super::context::ContentTypeLookup;

pub fn parse_content_types(pkg: &OoxmlPackage) -> ContentTypeLookup {
    let mut default_by_extension = HashMap::new();
    let mut override_by_part_name = HashMap::new();

    let Some(xml) = pkg.parts.get("[Content_Types].xml").map(|part| part.content.as_str()) else {
        return ContentTypeLookup {
            default_by_extension,
            override_by_part_name,
        };
    };

    for tag in find_opening_tags(xml, "Default") {
        let extension = get_attribute(&tag, "Extension")
            .map(|value| value.to_ascii_lowercase());
        let content_type = get_attribute(&tag, "ContentType");
        if let (Some(extension), Some(content_type)) = (extension, content_type) {
            default_by_extension.insert(extension, content_type);
        }
    }

    for tag in find_opening_tags(xml, "Override") {
        let part_name = get_attribute(&tag, "PartName");
        let content_type = get_attribute(&tag, "ContentType");
        if let (Some(part_name), Some(content_type)) = (part_name, content_type) {
            override_by_part_name.insert(part_name.clone(), content_type.clone());
            if !part_name.starts_with('/') {
                override_by_part_name.insert(format!("/{part_name}"), content_type);
            }
        }
    }

    ContentTypeLookup {
        default_by_extension,
        override_by_part_name,
    }
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
