use crate::model::{
    DocNode, ParagraphChildNode, ParagraphNode, ParagraphNodeType, TextRunNode, TextRunNodeType,
};

use super::body::body_xml;
use super::context::ParseContext;
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

pub fn extract_body_token_ranges(body_xml: &str) -> Vec<BodyTokenRange> {
    let mut ranges = Vec::new();
    for (name, kind) in [
        ("w:tbl", BodyTokenKind::Table),
        ("w:p", BodyTokenKind::Paragraph),
    ] {
        ranges.extend(
            crate::xml::extract_balanced_tag_ranges(body_xml, name)
                .into_iter()
                .map(|range| BodyTokenRange {
                    start: range.start,
                    end: range.end,
                    kind,
                }),
        );
    }
    ranges.sort_by_key(|range| range.start);
    let mut covered_end = 0;
    ranges.retain(|range| {
        if range.end <= covered_end {
            return false;
        }
        covered_end = range.end;
        true
    });
    ranges
}

pub fn is_go_back_bookmark_paragraph(paragraph_xml: &str) -> bool {
    if !contains_case_insensitive(paragraph_xml, "w:name=\"_GoBack\"") {
        return false;
    }

    !contains_case_insensitive_tag(paragraph_xml, "w:r")
        && !contains_case_insensitive_tag(paragraph_xml, "w:drawing")
}

pub fn parse_document_xml(
    document_xml: &str,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
) -> Vec<DocNode> {
    let body = body_xml(document_xml);
    parse_ranges(body, extract_body_token_ranges(body), context)
}

fn parse_token(
    body: &str,
    token: &BodyTokenRange,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
) -> Option<DocNode> {
    let xml = &body[token.start..token.end];
    if token.kind == BodyTokenKind::Table {
        Some(DocNode::Table(parse_table(xml, context)))
    } else if !is_go_back_bookmark_paragraph(xml) {
        Some(DocNode::Paragraph(parse_paragraph(xml, context)))
    } else {
        None
    }
}

fn parse_ranges(
    body: &str,
    ranges: Vec<BodyTokenRange>,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
) -> Vec<DocNode> {
    let mut nodes = Vec::with_capacity(ranges.len());
    for token in ranges {
        if let Some(node) = parse_token(body, &token, context) {
            nodes.push(node);
        }
    }
    nonempty_nodes(nodes)
}

fn nonempty_nodes(mut nodes: Vec<DocNode>) -> Vec<DocNode> {
    if nodes.is_empty() {
        nodes.push(DocNode::Paragraph(ParagraphNode {
            r#type: ParagraphNodeType::Paragraph,
            block_id: None,
            children: vec![ParagraphChildNode::Text(TextRunNode {
                r#type: TextRunNodeType::Text,
                text: String::new(),
                style: None,
                link: None,
                note_reference: None,
            })],
            style: None,
            paragraph_mark_style: None,
            source_paragraph_mark_style: None,
            source_paragraph_mark_formatting: None,
            source_paragraph_mark_properties_xml: None,
            paragraph_mark_deleted: None,
            source_xml: None,
            source_text_patch: None,
            source_run_provenance: None,
        }));
    }

    nodes
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn parse_document_xml_parallel(
    document: &str,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
    indexes: &crate::xml_index::Scope<'_>,
) -> Vec<DocNode> {
    let body = body_xml(document);
    let ranges = extract_body_token_ranges(body);
    let bytes = ranges
        .iter()
        .map(|range| range.end - range.start)
        .sum::<usize>();
    let largest = ranges
        .iter()
        .map(|range| range.end - range.start)
        .max()
        .unwrap_or(0);
    let pool = (bytes.saturating_sub(largest) >= 16 * 1024 && ranges.len() >= 16)
        .then(super::namespaces::worker_pool)
        .flatten();
    let Some(pool) = pool else {
        return parse_ranges(body, ranges, context);
    };
    let workers = pool.current_num_threads() + 1;
    let mut order: Vec<_> = (0..ranges.len()).collect();
    order.sort_unstable_by_key(|id| std::cmp::Reverse(ranges[*id].end - ranges[*id].start));
    let mut weights = vec![0usize; workers];
    let mut assignments = vec![0usize; ranges.len()];
    for id in order {
        let worker = (0..workers).min_by_key(|worker| weights[*worker]).unwrap();
        assignments[id] = worker;
        weights[worker] += ranges[id].end - ranges[id].start;
    }
    let mut results: Vec<Option<(Option<DocNode>, Vec<String>)>> =
        (0..ranges.len()).map(|_| None).collect();
    let mut groups: Vec<Vec<_>> = (0..workers).map(|_| Vec::new()).collect();
    for ((range, result), worker) in ranges.iter().zip(results.iter_mut()).zip(assignments) {
        groups[worker].push((range, result));
    }
    let mut groups = groups.into_iter();
    let caller = groups.next().unwrap();
    let relationships = &context.relationships;
    let content_types = &context.content_types;
    let styles = context.styles();
    let parts = context.parts;
    let binary_assets = context.binary_assets;
    let mut earlier_warnings = std::mem::take(&mut *context.warnings.borrow_mut());
    pool.in_place_scope(|scope| {
        for group in groups {
            if group.is_empty() {
                continue;
            }
            let snapshot = indexes.snapshot();
            scope.spawn(move |_| {
                let _indexes = snapshot.enter();
                let _styles = super::style::run_style_cache_scope();
                super::style::bind_style_cache(styles);
                let context = ParseContext {
                    relationships: relationships.clone(),
                    content_types: content_types.clone(),
                    parts,
                    binary_assets,
                    style_sheet: styles,
                    warnings: std::cell::RefCell::new(Vec::new()),
                };
                for (range, result) in group {
                    let node = parse_token(body, range, &context);
                    *result = Some((node, std::mem::take(&mut *context.warnings.borrow_mut())));
                }
            });
        }
        for (range, result) in caller {
            let node = parse_token(body, range, context);
            *result = Some((node, std::mem::take(&mut *context.warnings.borrow_mut())));
        }
    });
    let mut nodes = Vec::with_capacity(results.len());
    for result in results {
        let (node, warnings) = result.expect("joined body task");
        if let Some(node) = node {
            nodes.push(node);
        }
        earlier_warnings.extend(warnings);
    }
    *context.warnings.borrow_mut() = earlier_warnings;
    nonempty_nodes(nodes)
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
    crate::xml::find_ignore_ascii_case(haystack, start, needle)
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
        assert_eq!(super::super::body::extract_body_xml(xml), "<w:p/>");
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

    #[test]
    fn drawing_text_stays_out_of_the_anchor_paragraph() {
        let xml = r#"<w:body><w:p><w:r><w:t>Before</w:t></w:r><w:r><w:drawing><wpg:wgp><wps:wsp><wps:txbx><w:txbxContent><w:p><w:r><w:t>Shape story</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp></wpg:wgp></w:drawing></w:r><w:r><w:t>After</w:t></w:r></w:p></w:body>"#;
        let context = ParseContext {
            relationships: HashMap::new(),
            content_types: ContentTypeLookup::default(),
            parts: &HashMap::new(),
            binary_assets: &HashMap::new(),
            style_sheet: ParsedStyleSheet::empty(),
            warnings: RefCell::new(Vec::new()),
        };
        let nodes = parse_document_xml(xml, &context);
        let DocNode::Paragraph(paragraph) = &nodes[0] else {
            panic!("paragraph")
        };
        let text: String = paragraph
            .children
            .iter()
            .filter_map(|child| match child {
                ParagraphChildNode::Text(run) => Some(run.text.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(text, "BeforeAfter");
        assert_eq!(
            paragraph.source_xml.as_deref(),
            Some(&xml[8..xml.len() - 9])
        );

        let with_control = xml.replace("<w:r><w:t>Shape story</w:t></w:r>",
            "<w:sdt><w:sdtPr><w:text/></w:sdtPr><w:sdtContent><w:r><w:t>Shape story</w:t></w:r></w:sdtContent></w:sdt>");
        let nodes = parse_document_xml(&with_control, &context);
        let DocNode::Paragraph(paragraph) = &nodes[0] else {
            panic!("paragraph")
        };
        assert!(!paragraph
            .children
            .iter()
            .any(|child| matches!(child, ParagraphChildNode::FormField(_))));
        let nodes = parse_document_xml("<w:body><w:p><w:sdt><w:sdtPr><w:text/></w:sdtPr><w:sdtContent><w:r><w:t>Body control</w:t></w:r></w:sdtContent></w:sdt></w:p></w:body>", &context);
        let DocNode::Paragraph(paragraph) = &nodes[0] else {
            panic!("paragraph")
        };
        assert!(paragraph
            .children
            .iter()
            .any(|child| matches!(child, ParagraphChildNode::FormField(_))));
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod parallel_tests {
    #[test]
    fn balanced_body_preserves_nodes_and_warning_order() {
        let content = "content &amp; detail ".repeat(40);
        let mut xml = "<w:document><w:body>".to_owned();
        for index in 0..80 {
            xml.push_str(&format!(
                "<w:p><w:r><w:t>{index} {content}</w:t></w:r></w:p>"
            ));
            if index % 9 == 0 {
                xml.push_str("<w:p><m:oMath><m:unknown/></m:oMath></w:p>");
            }
        }
        xml.push_str("</w:body></w:document>");
        let mut parts = std::collections::HashMap::new();
        parts.insert(
            "body".into(),
            crate::package::OoxmlPart {
                name: "body".into(),
                content: xml.clone(),
            },
        );
        let assets = std::collections::HashMap::new();
        let context = crate::parse::context::ParseContext {
            relationships: Default::default(),
            content_types: Default::default(),
            parts: &parts,
            binary_assets: &assets,
            style_sheet: crate::parse::context::ParsedStyleSheet::empty(),
            warnings: std::cell::RefCell::new(vec!["prior warning".into()]),
        };
        let indexes =
            crate::xml_index::scope([("body", xml.as_str())].into_iter(), Default::default());
        let serial = super::parse_document_xml(&xml, &context);
        let warnings = context.warnings.replace(vec!["prior warning".into()]);
        let parallel = super::parse_document_xml_parallel(&xml, &context, &indexes);
        assert_eq!(
            serde_json::to_value(serial).unwrap(),
            serde_json::to_value(parallel).unwrap()
        );
        assert_eq!(warnings, *context.warnings.borrow());
    }
}
