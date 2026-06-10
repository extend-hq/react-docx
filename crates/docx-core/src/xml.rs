//! XML parsing utilities ported from `packages/doc-model/src/index.ts`.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagRange {
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaggedRange {
    pub start: usize,
    pub end: usize,
    pub tag_name: String,
}

pub type ParagraphAlignment = &'static str;

fn is_word_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn eq_ignore_ascii_case(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .zip(right.iter())
            .all(|(left_byte, right_byte)| left_byte.eq_ignore_ascii_case(right_byte))
}

fn starts_with_ignore_ascii_case(haystack: &str, prefix: &str) -> bool {
    let haystack_bytes = haystack.as_bytes();
    let prefix_bytes = prefix.as_bytes();
    haystack_bytes.len() >= prefix_bytes.len()
        && eq_ignore_ascii_case(&haystack_bytes[..prefix_bytes.len()], prefix_bytes)
}

fn has_word_boundary_after(xml: &str, index: usize) -> bool {
    xml.as_bytes()
        .get(index)
        .is_none_or(|byte| !is_word_char(*byte))
}

fn try_match_closing_tag(xml: &str, start: usize, tag_name: &str) -> Option<usize> {
    if !xml.as_bytes().get(start).is_some_and(|byte| *byte == b'<') {
        return None;
    }

    let after_lt = start + 1;
    if !starts_with_ignore_ascii_case(&xml[after_lt..], "/") {
        return None;
    }

    let tag_start = after_lt + 1;
    let tag_name_bytes = tag_name.as_bytes();
    let xml_bytes = xml.as_bytes();
    if tag_start + tag_name_bytes.len() > xml_bytes.len() {
        return None;
    }

    if !eq_ignore_ascii_case(
        &xml_bytes[tag_start..tag_start + tag_name_bytes.len()],
        tag_name_bytes,
    ) {
        return None;
    }

    let after_tag = tag_start + tag_name_bytes.len();
    if xml_bytes.get(after_tag) != Some(&b'>') {
        return None;
    }

    Some(after_tag + 1)
}

fn try_match_opening_tag(xml: &str, start: usize, tag_name: &str) -> Option<usize> {
    if !xml.as_bytes().get(start).is_some_and(|byte| *byte == b'<') {
        return None;
    }

    let tag_start = start + 1;
    if xml.as_bytes().get(tag_start) == Some(&b'/') {
        return None;
    }

    let tag_name_bytes = tag_name.as_bytes();
    let xml_bytes = xml.as_bytes();
    if tag_start + tag_name_bytes.len() > xml_bytes.len() {
        return None;
    }

    if !eq_ignore_ascii_case(
        &xml_bytes[tag_start..tag_start + tag_name_bytes.len()],
        tag_name_bytes,
    ) {
        return None;
    }

    let after_tag = tag_start + tag_name_bytes.len();
    if !has_word_boundary_after(xml, after_tag) {
        return None;
    }

    let mut index = after_tag;
    while index < xml_bytes.len() {
        let byte = xml_bytes[index];
        if byte == b'>' {
            return Some(index + 1);
        }
        index += 1;
    }

    None
}

fn is_self_closing_tag(token: &str) -> bool {
    let bytes = token.as_bytes();
    let mut index = bytes.len();
    while index > 0 && bytes[index - 1].is_ascii_whitespace() {
        index -= 1;
    }
    index >= 2 && bytes[index - 2] == b'/' && bytes[index - 1] == b'>'
}

fn find_tag_tokens(xml: &str, tag_name: &str) -> Vec<(usize, usize, bool)> {
    let mut tokens = Vec::new();
    let mut index = 0;

    while index < xml.len() {
        if xml.as_bytes()[index] != b'<' {
            index += 1;
            continue;
        }

        if let Some(end) = try_match_closing_tag(xml, index, tag_name) {
            tokens.push((index, end, true));
            index = end;
            continue;
        }

        if let Some(end) = try_match_opening_tag(xml, index, tag_name) {
            tokens.push((index, end, false));
            index = end;
            continue;
        }

        index += 1;
    }

    tokens
}

pub fn decode_xml_entities(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

pub fn extract_balanced_tag_ranges(xml: &str, tag_name: &str) -> Vec<TagRange> {
    let mut ranges = Vec::new();
    let mut start_stack = Vec::new();

    for (token_start, token_end, is_closing) in find_tag_tokens(xml, tag_name) {
        let token_xml = &xml[token_start..token_end];

        if is_closing {
            let Some(start) = start_stack.pop() else {
                continue;
            };

            if start_stack.is_empty() {
                ranges.push(TagRange {
                    start,
                    end: token_end,
                });
            }
            continue;
        }

        if is_self_closing_tag(token_xml) {
            if start_stack.is_empty() {
                ranges.push(TagRange {
                    start: token_start,
                    end: token_end,
                });
            }
            continue;
        }

        start_stack.push(token_start);
    }

    ranges
}

pub fn extract_balanced_tag_blocks(xml: &str, tag_name: &str) -> Vec<String> {
    extract_balanced_tag_ranges(xml, tag_name)
        .into_iter()
        .map(|range| xml[range.start..range.end].to_string())
        .collect()
}

pub fn extract_balanced_tag_blocks_in_order(xml: &str, tag_names: &[&str]) -> Vec<TaggedRange> {
    let mut ranges = Vec::new();

    for tag_name in tag_names {
        for range in extract_balanced_tag_ranges(xml, tag_name) {
            ranges.push(TaggedRange {
                start: range.start,
                end: range.end,
                tag_name: (*tag_name).to_string(),
            });
        }
    }

    ranges.sort_by(|left, right| {
        left.start
            .cmp(&right.start)
            .then_with(|| left.end.cmp(&right.end))
    });

    let mut top_level_ranges: Vec<TaggedRange> = Vec::new();
    for range in ranges {
        let nested_inside_parent = top_level_ranges.iter().any(|parent_range| {
            range.start >= parent_range.start && range.end <= parent_range.end
        });
        if nested_inside_parent {
            continue;
        }
        top_level_ranges.push(range);
    }

    top_level_ranges
}

fn find_namespaced_tag_attributes(xml: &str, tag_name: &str) -> Option<String> {
    let open_prefix = format!("<w:{tag_name}");
    let mut index = 0;

    while index < xml.len() {
        if xml.as_bytes()[index] != b'<' {
            index += 1;
            continue;
        }

        if !starts_with_ignore_ascii_case(&xml[index..], &open_prefix) {
            index += 1;
            continue;
        }

        let after_prefix = index + open_prefix.len();
        if !has_word_boundary_after(xml, after_prefix) {
            index += 1;
            continue;
        }

        let mut cursor = after_prefix;
        let xml_bytes = xml.as_bytes();
        while cursor < xml_bytes.len() {
            let byte = xml_bytes[cursor];
            if byte == b'>' {
                let attributes = xml[after_prefix..cursor]
                    .trim_end_matches('/')
                    .to_string();
                return Some(attributes);
            }
            cursor += 1;
        }

        return None;
    }

    None
}

fn strip_quoted_attribute(text: &str, attribute: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut index = 0;
    let bytes = text.as_bytes();

    while index < bytes.len() {
        let remaining = &text[index..];
        let is_match = starts_with_ignore_ascii_case(remaining, attribute)
            && has_word_boundary_before(text, index)
            && bytes
                .get(index + attribute.len())
                .is_some_and(|byte| *byte == b'=')
            && bytes
                .get(index + attribute.len() + 1)
                .is_some_and(|byte| *byte == b'"');

        if is_match {
            let quote_start = index + attribute.len() + 2;
            let mut quote_end = quote_start;
            while quote_end < bytes.len() && bytes[quote_end] != b'"' {
                quote_end += 1;
            }
            if quote_end < bytes.len() {
                index = quote_end + 1;
                continue;
            }
        }

        result.push(bytes[index] as char);
        index += 1;
    }

    result
}

fn has_word_boundary_before(text: &str, index: usize) -> bool {
    if index == 0 {
        return true;
    }
    text.as_bytes()
        .get(index - 1)
        .is_none_or(|byte| !is_word_char(*byte))
}

fn parse_on_off_value(attributes: &str) -> bool {
    let Some(value) = get_attribute(attributes, "w:val") else {
        return true;
    };

    let value = value.to_ascii_lowercase();
    value != "0" && value != "false" && value != "none" && value != "off"
}

pub fn parse_on_off_attribute(xml: &str, tag_name: &str) -> Option<bool> {
    let attributes = find_namespaced_tag_attributes(xml, tag_name)?;
    Some(parse_on_off_value(&attributes))
}

pub fn parse_underline_attribute(xml: &str) -> Option<bool> {
    let attributes = find_namespaced_tag_attributes(xml, "u")?;

    if get_attribute(&attributes, "w:val").is_some() {
        return Some(parse_on_off_value(&attributes));
    }

    let compact_attributes: String = attributes
        .chars()
        .filter(|ch| !ch.is_ascii_whitespace())
        .collect();
    let compact_attributes = compact_attributes.trim_end_matches('/');

    if compact_attributes.is_empty() {
        return Some(true);
    }

    let non_decoration_attributes = strip_quoted_attribute(
        &strip_quoted_attribute(
            &strip_quoted_attribute(
                &strip_quoted_attribute(&compact_attributes, "w:themeShade"),
                "w:themeTint",
            ),
            "w:themeColor",
        ),
        "w:color",
    )
    .trim_end_matches('/')
    .to_string();

    if non_decoration_attributes.is_empty() {
        return None;
    }

    Some(true)
}

pub fn normalize_alignment(raw_alignment: Option<&str>) -> Option<ParagraphAlignment> {
    let value = raw_alignment?;
    let value = value.to_ascii_lowercase();

    if value == "both" || value == "distribute" || value == "thaidistribute" {
        return Some("justify");
    }

    if matches!(value.as_str(), "left" | "center" | "right" | "justify") {
        return Some(match value.as_str() {
            "left" => "left",
            "center" => "center",
            "right" => "right",
            "justify" => "justify",
            _ => unreachable!(),
        });
    }

    None
}

pub fn get_attribute(tag_xml: &str, attribute: &str) -> Option<String> {
    let attribute_bytes = attribute.as_bytes();
    let xml_bytes = tag_xml.as_bytes();
    let mut index = 0;

    while index < xml_bytes.len() {
        if !tag_xml.is_char_boundary(index) {
            index += 1;
            continue;
        }
        let remaining = &tag_xml[index..];
        if starts_with_ignore_ascii_case(remaining, attribute)
            && xml_bytes
                .get(index + attribute_bytes.len())
                .is_some_and(|byte| *byte == b'=')
        {
            let quote_start = index + attribute_bytes.len() + 1;
            let quote = xml_bytes.get(quote_start)?;
            if *quote != b'"' && *quote != b'\'' {
                index += 1;
                continue;
            }

            let value_start = quote_start + 1;
            let mut value_end = value_start;
            while value_end < xml_bytes.len() && xml_bytes[value_end] != *quote {
                value_end += 1;
            }

            if value_end >= xml_bytes.len() {
                return None;
            }

            return Some(tag_xml[value_start..value_end].to_string());
        }

        index += 1;
    }

    None
}

pub fn parse_integer_attribute(tag_xml: &str, attribute: &str) -> Option<i64> {
    let raw = get_attribute(tag_xml, attribute)?;
    if raw.is_empty() {
        return None;
    }

    let parsed = raw.trim().parse::<f64>().ok()?;
    if !parsed.is_finite() {
        return None;
    }

    Some(parsed.round() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_xml_entities_replaces_entities_in_order() {
        assert_eq!(decode_xml_entities("a&amp;b"), "a&b");
        assert_eq!(decode_xml_entities("&lt;tag&gt;"), "<tag>");
        assert_eq!(decode_xml_entities("&quot;x&apos;"), "\"x'");
    }

    #[test]
    fn extract_balanced_tag_ranges_matches_simple_pair() {
        let xml = "<w:p><w:r>text</w:r></w:p>";
        let ranges = extract_balanced_tag_ranges(xml, "w:p");
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0].start, 0);
        assert_eq!(ranges[0].end, xml.len());
        assert_eq!(&xml[ranges[0].start..ranges[0].end], xml);
    }

    #[test]
    fn extract_balanced_tag_ranges_matches_self_closing_tag() {
        let xml = "<w:br/>";
        let ranges = extract_balanced_tag_ranges(xml, "w:br");
        assert_eq!(ranges, vec![TagRange { start: 0, end: xml.len() }]);
    }

    #[test]
    fn extract_balanced_tag_ranges_ignores_nested_same_tag() {
        let xml = "<w:p><w:p>inner</w:p></w:p>";
        let ranges = extract_balanced_tag_ranges(xml, "w:p");
        assert_eq!(ranges.len(), 1);
        assert_eq!(&xml[ranges[0].start..ranges[0].end], xml);
    }

    #[test]
    fn extract_balanced_tag_ranges_ignores_nested_self_closing_tag() {
        let xml = "<w:p><w:p/></w:p>";
        let ranges = extract_balanced_tag_ranges(xml, "w:p");
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0].start, 0);
        assert_eq!(ranges[0].end, xml.len());
    }

    #[test]
    fn extract_balanced_tag_ranges_returns_multiple_top_level_ranges() {
        let xml = "<w:p>a</w:p><w:p>b</w:p>";
        let ranges = extract_balanced_tag_ranges(xml, "w:p");
        assert_eq!(ranges.len(), 2);
        assert_eq!(&xml[ranges[0].start..ranges[0].end], "<w:p>a</w:p>");
        assert_eq!(&xml[ranges[1].start..ranges[1].end], "<w:p>b</w:p>");
    }

    #[test]
    fn extract_balanced_tag_ranges_is_case_insensitive() {
        let xml = "<W:P>text</W:P>";
        let ranges = extract_balanced_tag_ranges(xml, "w:p");
        assert_eq!(ranges.len(), 1);
        assert_eq!(&xml[ranges[0].start..ranges[0].end], xml);
    }

    #[test]
    fn extract_balanced_tag_blocks_returns_slices() {
        let xml = "<w:p>one</w:p><w:p>two</w:p>";
        let blocks = extract_balanced_tag_blocks(xml, "w:p");
        assert_eq!(blocks, vec!["<w:p>one</w:p>", "<w:p>two</w:p>"]);
    }

    #[test]
    fn extract_balanced_tag_blocks_in_order_filters_nested_ranges() {
        let xml = "<w:tbl><w:tr><w:tc><w:p>cell</w:p></w:tc></w:tr></w:tbl>";
        let ranges = extract_balanced_tag_blocks_in_order(xml, &["w:tbl", "w:tr", "w:tc", "w:p"]);
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0].tag_name, "w:tbl");
        assert_eq!(ranges[0].start, 0);
        assert_eq!(ranges[0].end, xml.len());
    }

    #[test]
    fn extract_balanced_tag_blocks_in_order_sorts_by_start_and_end() {
        let xml = "<w:p/><w:tbl><w:tr/></w:tbl>";
        let ranges = extract_balanced_tag_blocks_in_order(xml, &["w:tbl", "w:p", "w:tr"]);
        assert_eq!(ranges.len(), 2);
        assert_eq!(ranges[0].tag_name, "w:p");
        assert_eq!(ranges[1].tag_name, "w:tbl");
    }

    #[test]
    fn parse_on_off_attribute_defaults_to_true_without_val() {
        assert_eq!(parse_on_off_attribute("<w:b/>", "b"), Some(true));
    }

    #[test]
    fn parse_on_off_attribute_parses_false_values() {
        assert_eq!(
            parse_on_off_attribute(r#"<w:b w:val="false"/>"#, "b"),
            Some(false)
        );
        assert_eq!(parse_on_off_attribute(r#"<w:i w:val="0"/>"#, "i"), Some(false));
    }

    #[test]
    fn parse_underline_attribute_handles_color_only_tags() {
        assert_eq!(
            parse_underline_attribute(r#"<w:u w:color="FFFFFF"/>"#),
            None
        );
        assert_eq!(parse_underline_attribute("<w:u/>"), Some(true));
        assert_eq!(
            parse_underline_attribute(r#"<w:u w:val="single"/>"#),
            Some(true)
        );
    }

    #[test]
    fn normalize_alignment_maps_distribute_to_justify() {
        assert_eq!(normalize_alignment(Some("distribute")), Some("justify"));
        assert_eq!(normalize_alignment(Some("center")), Some("center"));
        assert_eq!(normalize_alignment(Some("bogus")), None);
    }

    #[test]
    fn get_attribute_reads_double_and_single_quoted_values() {
        assert_eq!(
            get_attribute(r#"foo="bar" baz='qux'"#, "foo"),
            Some("bar".to_string())
        );
        assert_eq!(
            get_attribute(r#"foo='bar'"#, "foo"),
            Some("bar".to_string())
        );
    }

    #[test]
    fn parse_integer_attribute_rounds_numeric_values() {
        assert_eq!(
            parse_integer_attribute(r#"w:spacing w:val="3.6""#, "w:val"),
            Some(4)
        );
        assert_eq!(
            parse_integer_attribute(r#"w:spacing w:val="2""#, "w:val"),
            Some(2)
        );
        assert_eq!(
            parse_integer_attribute(r#"w:spacing w:val="abc""#, "w:val"),
            None
        );
    }
}
