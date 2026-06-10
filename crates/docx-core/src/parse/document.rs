use crate::model::{
    DocNode, ParagraphChildNode, ParagraphNode, ParagraphNodeType, TextRunNode, TextRunNodeType,
};

use super::body::extract_body_xml;
use super::context::ParseContext;
use super::metadata::extract_section_properties_xml;
use super::paragraph::parse_paragraph;
use super::table::parse_table;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BodyTokenRange {
    pub start: usize,
    pub end: usize,
    pub kind: BodyTokenKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BodyTokenKind {
    Table,
    Paragraph,
}

pub fn extract_section_properties_xml_from_document(document_xml: &str) -> Option<String> {
    extract_section_properties_xml(document_xml)
}

pub fn extract_body_token_ranges(body_xml: &str) -> Vec<BodyTokenRange> {
    crate::xml::extract_balanced_tag_blocks_in_order(body_xml, &["w:tbl", "w:p"])
        .into_iter()
        .map(|range| BodyTokenRange {
            start: range.start,
            end: range.end,
            kind: if range.tag_name.eq_ignore_ascii_case("w:tbl") {
                BodyTokenKind::Table
            } else {
                BodyTokenKind::Paragraph
            },
        })
        .collect()
}

pub fn is_go_back_bookmark_paragraph(paragraph_xml: &str) -> bool {
    if !contains_case_insensitive(paragraph_xml, "w:name=\"_GoBack\"") {
        return false;
    }

    !contains_case_insensitive_tag(paragraph_xml, "w:r")
        && !contains_case_insensitive_tag(paragraph_xml, "w:drawing")
}

pub fn parse_document_xml(document_xml: &str, context: &ParseContext<'_>) -> Vec<DocNode> {
    let body_xml = extract_body_xml(document_xml);
    let token_ranges = extract_body_token_ranges(&body_xml);
    let mut nodes = Vec::new();

    for token in token_ranges {
        let token_xml = &body_xml[token.start..token.end];
        if token.kind == BodyTokenKind::Table {
            nodes.push(DocNode::Table(parse_table(token_xml, context)));
        } else if !is_go_back_bookmark_paragraph(token_xml) {
            nodes.push(DocNode::Paragraph(parse_paragraph(token_xml, context)));
        }
    }

    if nodes.is_empty() {
        nodes.push(DocNode::Paragraph(ParagraphNode {
            r#type: ParagraphNodeType::Paragraph,
            children: vec![ParagraphChildNode::Text(TextRunNode {
                r#type: TextRunNodeType::Text,
                text: String::new(),
                style: None,
                link: None,
                note_reference: None,
            })],
            style: None,
            paragraph_mark_deleted: None,
            source_xml: None,
        }));
    }

    nodes
}

fn contains_case_insensitive(haystack: &str, needle: &str) -> bool {
    find_case_insensitive_at(haystack, 0, needle).is_some()
}

fn contains_case_insensitive_tag(haystack: &str, tag_name: &str) -> bool {
    find_case_insensitive_at(haystack, 0, &format!("<{tag_name}")).is_some()
        || find_case_insensitive_at(haystack, 0, &format!("<{tag_name}/")).is_some()
        || find_case_insensitive_at(haystack, 0, &format!("<{tag_name} ")).is_some()
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

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use super::*;
    use crate::parse::context::{ContentTypeLookup, ParseContext, ParsedStyleSheet};

    #[test]
    fn extract_body_xml_returns_inner_content() {
        let xml = "<w:document><w:body><w:p/></w:body></w:document>";
        assert_eq!(extract_body_xml(xml), "<w:p/>");
    }

    #[test]
    fn is_go_back_bookmark_paragraph_detects_hidden_bookmark() {
        let xml = r#"<w:p><w:bookmarkStart w:name="_GoBack"/></w:p>"#;
        assert!(is_go_back_bookmark_paragraph(xml));
        let with_run = r#"<w:p><w:bookmarkStart w:name="_GoBack"/><w:r><w:t>x</w:t></w:r></w:p>"#;
        assert!(!is_go_back_bookmark_paragraph(with_run));
    }

    #[test]
    fn parse_document_xml_skips_go_back_paragraph() {
        let xml = r#"<w:body><w:p><w:bookmarkStart w:name="_GoBack"/></w:p><w:p><w:r><w:t>Hi</w:t></w:r></w:p></w:body>"#;
        let context = ParseContext {
            relationships: HashMap::new(),
            content_types: ContentTypeLookup::default(),
            parts: &HashMap::new(),
            binary_assets: &HashMap::new(),
            style_sheet: ParsedStyleSheet::empty(),
            warnings: RefCell::new(Vec::new()),
        };
        let nodes = parse_document_xml(xml, &context);
        assert_eq!(nodes.len(), 1);
    }
}
