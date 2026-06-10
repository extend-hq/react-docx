use crate::xml::get_attribute;

pub fn starts_with_ignore_ascii_case(haystack: &str, prefix: &str) -> bool {
    let haystack_bytes = haystack.as_bytes();
    let prefix_bytes = prefix.as_bytes();
    haystack_bytes.len() >= prefix_bytes.len()
        && haystack_bytes[..prefix_bytes.len()]
            .iter()
            .zip(prefix_bytes.iter())
            .all(|(left, right)| left.eq_ignore_ascii_case(right))
}

fn has_word_boundary_after(xml: &str, index: usize) -> bool {
    xml.as_bytes()
        .get(index)
        .is_none_or(|byte| !byte.is_ascii_alphanumeric() && *byte != b'_')
}

fn find_case_insensitive_at(haystack: &str, start: usize, needle: &str) -> Option<usize> {
    if needle.is_empty() || start >= haystack.len() {
        return None;
    }

    let haystack_bytes = haystack.as_bytes();
    let needle_bytes = needle.as_bytes();
    if start + needle.len() > haystack_bytes.len() {
        return None;
    }

    let max_start = haystack_bytes.len().saturating_sub(needle_bytes.len());

    for index in start..=max_start {
        let end = index + needle_bytes.len();
        if end > haystack_bytes.len() {
            break;
        }
        if haystack_bytes[index..end]
            .iter()
            .zip(needle_bytes.iter())
            .all(|(left, right)| left.eq_ignore_ascii_case(right))
        {
            return Some(index);
        }
    }

    None
}

/// Hand-rolled scanner matching `<tagName\b[^>]*\/?>` regex patterns.
pub fn find_tag_token(xml: &str, tag_name: &str) -> Option<String> {
    let open_prefix = format!("<{tag_name}");
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

        return Some(xml[tag_start..tag_start + relative_gt + 1].to_string());
    }

    None
}

/// Hand-rolled scanner matching global `<tagName\b[^>]*>` regex patterns.
pub fn find_all_tag_tokens(xml: &str, tag_name: &str) -> Vec<String> {
    let open_prefix = format!("<{tag_name}");
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

pub fn find_attribute_value_in_tag(xml: &str, tag_name: &str, attribute: &str) -> Option<String> {
    find_tag_token(xml, tag_name).and_then(|tag| get_attribute(&tag, attribute))
}

pub fn contains_tag(xml: &str, tag_name: &str) -> bool {
    find_tag_token(xml, tag_name).is_some()
}

pub fn decode_xml_attribute(value: Option<&str>) -> Option<String> {
    value.map(crate::xml::decode_xml_entities)
}

#[cfg(test)]
mod tests {
    use super::find_tag_token;

    #[test]
    fn find_tag_token_does_not_panic_on_short_haystack() {
        assert_eq!(find_tag_token("abc", "w:p"), None);
        assert_eq!(find_tag_token("<w:t>☐</w:t>", "w:p"), None);
    }

    #[test]
    fn find_tag_token_finds_tags_in_unicode_text() {
        let xml = "<w:p><w:r><w:t>☐ choice</w:t></w:r></w:p>";
        assert!(find_tag_token(xml, "w:p").is_some());
    }
}
