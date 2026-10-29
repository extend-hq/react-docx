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

pub(crate) fn find_tag_token_ref<'a>(xml: &'a str, tag_name: &str) -> Option<&'a str> {
    if let Some(tag) = crate::xml_index::tag(xml, tag_name) {
        return tag;
    }
    let name = tag_name.as_bytes();
    let mut cursor = 0;
    while let Some(offset) = xml[cursor..].find('<') {
        let start = cursor + offset;
        let after = start + 1 + name.len();
        if xml
            .as_bytes()
            .get(start + 1..after)
            .is_some_and(|value| value.eq_ignore_ascii_case(name))
            && has_word_boundary_after(xml, after)
        {
            let end = crate::xml::tag_token_end(xml, after)?;
            return Some(&xml[start..end]);
        }
        cursor = start + 1;
    }
    None
}

pub fn find_tag_token(xml: &str, tag_name: &str) -> Option<String> {
    find_tag_token_ref(xml, tag_name).map(str::to_owned)
}

pub fn find_all_tag_tokens(xml: &str, tag_name: &str) -> Vec<String> {
    let mut remaining = xml;
    let mut tags = Vec::new();
    while let Some(tag) = find_tag_token_ref(remaining, tag_name) {
        let end = tag.as_ptr() as usize - remaining.as_ptr() as usize + tag.len();
        tags.push(tag.to_owned());
        remaining = &remaining[end..];
    }
    tags
}

pub fn find_attribute_value_in_tag(xml: &str, tag_name: &str, attribute: &str) -> Option<String> {
    find_tag_token_ref(xml, tag_name).and_then(|tag| get_attribute(tag, attribute))
}

pub fn contains_tag(xml: &str, tag_name: &str) -> bool {
    find_tag_token_ref(xml, tag_name).is_some()
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
