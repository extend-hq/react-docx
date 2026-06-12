use std::collections::{HashMap, HashSet};

use std::cell::RefCell;

use crate::model::{
    DocNode, DocumentCommentDefinition, DocumentNoteDefinition, DocumentSection, FooterSection,
    FormFieldRunNode, FormFieldType, HeaderSection, ParagraphChildNode, ParagraphNode,
    TableCellContentNode,
};
use crate::package::OoxmlPackage;
use crate::parse::re;
use crate::xml::{
    decode_xml_entities, extract_balanced_tag_blocks, get_attribute, parse_integer_attribute,
};

use super::context::{ContentTypeLookup, ParseContext, ParsedStyleSheet};
use super::body::extract_body_xml;
use super::document::{
    extract_body_token_ranges, is_go_back_bookmark_paragraph, parse_document_xml, BodyTokenKind,
};
use super::metadata::extract_section_properties_xml;
use super::relationships::parse_part_relationships;

struct ReferencedSectionPart {
    part_name: String,
    reference_type: Option<String>,
    nodes: Vec<DocNode>,
}

struct PartNodeCache<'a> {
    pkg: &'a OoxmlPackage,
    content_types: ContentTypeLookup,
    style_sheet: ParsedStyleSheet,
    parsed_part_nodes_by_name: HashMap<String, Vec<DocNode>>,
}

impl<'a> PartNodeCache<'a> {
    fn new(
        pkg: &'a OoxmlPackage,
        content_types: ContentTypeLookup,
        style_sheet: ParsedStyleSheet,
    ) -> Self {
        Self {
            pkg,
            content_types,
            style_sheet,
            parsed_part_nodes_by_name: HashMap::new(),
        }
    }

    fn resolve(
        &mut self,
        part_name: &str,
        relationship_tag_name: &str,
        warnings: &mut Vec<String>,
    ) -> Option<Vec<DocNode>> {
        if let Some(cached_nodes) = self.parsed_part_nodes_by_name.get(part_name) {
            return Some(cached_nodes.clone());
        }

        let Some(part_xml) = self.pkg.parts.get(part_name).map(|part| part.content.as_str()) else {
            warnings.push(format!(
                "{} {}",
                if relationship_tag_name == "headerReference" {
                    "Missing header part"
                } else {
                    "Missing footer part"
                },
                part_name
            ));
            return None;
        };

        let part_context = ParseContext {
            relationships: parse_part_relationships(self.pkg, part_name),
            content_types: self.content_types.clone(),
            parts: &self.pkg.parts,
            binary_assets: &self.pkg.binary_assets,
            style_sheet: self.style_sheet.clone(),
            warnings: RefCell::new(Vec::new()),
        };

        let nodes = parse_document_xml(part_xml, &part_context);
        self.parsed_part_nodes_by_name
            .insert(part_name.to_string(), nodes.clone());
        Some(nodes)
    }
}

pub fn parse_header_sections(
    pkg: &OoxmlPackage,
    document_xml: &str,
    document_relationships: &HashMap<String, String>,
    content_types: &ContentTypeLookup,
    style_sheet: &ParsedStyleSheet,
    warnings: &mut Vec<String>,
) -> Vec<HeaderSection> {
    parse_referenced_sections(
        pkg,
        document_xml,
        document_relationships,
        content_types,
        style_sheet,
        warnings,
        "headerReference",
        "Missing header relationship target for",
        "Missing header part",
    )
    .into_iter()
    .map(|section| HeaderSection {
        part_name: section.part_name,
        reference_type: section.reference_type,
        nodes: section.nodes,
    })
    .collect()
}

pub fn parse_footer_sections(
    pkg: &OoxmlPackage,
    document_xml: &str,
    document_relationships: &HashMap<String, String>,
    content_types: &ContentTypeLookup,
    style_sheet: &ParsedStyleSheet,
    warnings: &mut Vec<String>,
) -> Vec<FooterSection> {
    parse_referenced_sections(
        pkg,
        document_xml,
        document_relationships,
        content_types,
        style_sheet,
        warnings,
        "footerReference",
        "Missing footer relationship target for",
        "Missing footer part",
    )
    .into_iter()
    .map(|section| FooterSection {
        part_name: section.part_name,
        reference_type: section.reference_type,
        nodes: section.nodes,
    })
    .collect()
}

pub fn parse_document_sections(
    pkg: &OoxmlPackage,
    document_xml: &str,
    document_relationships: &HashMap<String, String>,
    content_types: &ContentTypeLookup,
    style_sheet: &ParsedStyleSheet,
    warnings: &mut Vec<String>,
) -> Vec<DocumentSection> {
    let body_xml = extract_body_xml(document_xml);
    let token_ranges = extract_body_token_ranges(&body_xml);
    let mut cache = PartNodeCache::new(pkg, content_types.clone(), style_sheet.clone());
    let mut node_count: i64 = 0;
    let mut section_start_node_index: i64 = 0;
    let mut sections = Vec::new();

    for token in token_ranges {
        let token_xml = &body_xml[token.start..token.end];
        let produced_node =
            token.kind == BodyTokenKind::Table || !is_go_back_bookmark_paragraph(token_xml);

        if token.kind == BodyTokenKind::Paragraph {
            if let Some(section_properties_xml) =
                extract_balanced_tag_blocks(token_xml, "w:sectPr").into_iter().next()
            {
                sections.push(DocumentSection {
                    start_node_index: section_start_node_index,
                    section_properties_xml: Some(section_properties_xml.clone()),
                    header_sections: parse_section_references_from_properties(
                        &section_properties_xml,
                        "headerReference",
                        document_relationships,
                        &mut cache,
                        warnings,
                    )
                    .into_iter()
                    .map(|section| HeaderSection {
                        part_name: section.part_name,
                        reference_type: section.reference_type,
                        nodes: section.nodes,
                    })
                    .collect(),
                    footer_sections: parse_section_references_from_properties(
                        &section_properties_xml,
                        "footerReference",
                        document_relationships,
                        &mut cache,
                        warnings,
                    )
                    .into_iter()
                    .map(|section| FooterSection {
                        part_name: section.part_name,
                        reference_type: section.reference_type,
                        nodes: section.nodes,
                    })
                    .collect(),
                });
                section_start_node_index = node_count + if produced_node { 1 } else { 0 };
            }
        }

        if produced_node {
            node_count += 1;
        }
    }

    let final_section_properties_xml = extract_section_properties_xml(document_xml);
    if let Some(section_properties_xml) = final_section_properties_xml.clone() {
        sections.push(DocumentSection {
            start_node_index: section_start_node_index,
            section_properties_xml: Some(section_properties_xml.clone()),
            header_sections: parse_section_references_from_properties(
                &section_properties_xml,
                "headerReference",
                document_relationships,
                &mut cache,
                warnings,
            )
            .into_iter()
            .map(|section| HeaderSection {
                part_name: section.part_name,
                reference_type: section.reference_type,
                nodes: section.nodes,
            })
            .collect(),
            footer_sections: parse_section_references_from_properties(
                &section_properties_xml,
                "footerReference",
                document_relationships,
                &mut cache,
                warnings,
            )
            .into_iter()
            .map(|section| FooterSection {
                part_name: section.part_name,
                reference_type: section.reference_type,
                nodes: section.nodes,
            })
            .collect(),
        });
    }

    let mut normalized_sections = Vec::new();
    for section in sections {
        if node_count > 0 && section.start_node_index > node_count {
            continue;
        }

        let duplicate = normalized_sections.last().is_some_and(|previous: &DocumentSection| {
            previous.start_node_index == section.start_node_index
                && previous.section_properties_xml == section.section_properties_xml
        });
        if duplicate {
            continue;
        }
        normalized_sections.push(section);
    }

    if normalized_sections.is_empty() {
        normalized_sections.push(DocumentSection {
            start_node_index: 0,
            section_properties_xml: final_section_properties_xml,
            header_sections: Vec::new(),
            footer_sections: Vec::new(),
        });
    }

    normalized_sections.sort_by_key(|section| section.start_node_index);
    normalized_sections
}

pub fn parse_document_notes_from_part(
    pkg: &OoxmlPackage,
    part_name: &str,
    tag_name: &str,
    content_types: &ContentTypeLookup,
    style_sheet: &ParsedStyleSheet,
    warnings: &mut Vec<String>,
) -> Vec<DocumentNoteDefinition> {
    let _ = warnings;
    let Some(notes_xml) = pkg.parts.get(part_name).map(|part| part.content.as_str()) else {
        return Vec::new();
    };

    let context = ParseContext {
        relationships: parse_part_relationships(pkg, part_name),
        content_types: content_types.clone(),
        parts: &pkg.parts,
        binary_assets: &pkg.binary_assets,
        style_sheet: style_sheet.clone(),
        warnings: RefCell::new(Vec::new()),
    };

    let mut notes = Vec::new();
    for note_xml in extract_balanced_tag_blocks(notes_xml, tag_name) {
        let note_tag = find_opening_tag(&note_xml, tag_name).unwrap_or_default();
        if get_attribute(&note_tag, "w:type").is_some() {
            continue;
        }

        let note_id = parse_integer_attribute(&note_tag, "w:id");
        let Some(note_id) = note_id.filter(|id| *id >= 0) else {
            continue;
        };

        let parsed_nodes = parse_document_xml(&note_xml, &context);
        let text = note_text_from_nodes(&parsed_nodes);
        if text.is_empty() {
            continue;
        }

        notes.push(DocumentNoteDefinition {
            id: note_id,
            text,
            nodes: Some(parsed_nodes),
        });
    }

    notes.sort_by_key(|note| note.id);
    notes
}

/// Parses `word/comments.xml` into comment definitions, enriched with
/// resolution state and threading from `word/commentsExtended.xml` (matched
/// through the `w14:paraId` of each comment's final paragraph, per MS-DOCX).
pub fn parse_document_comments(
    pkg: &OoxmlPackage,
    content_types: &ContentTypeLookup,
    style_sheet: &ParsedStyleSheet,
) -> Vec<DocumentCommentDefinition> {
    let Some(comments_xml) = pkg
        .parts
        .get("word/comments.xml")
        .map(|part| part.content.as_str())
    else {
        return Vec::new();
    };

    let context = ParseContext {
        relationships: parse_part_relationships(pkg, "word/comments.xml"),
        content_types: content_types.clone(),
        parts: &pkg.parts,
        binary_assets: &pkg.binary_assets,
        style_sheet: style_sheet.clone(),
        warnings: RefCell::new(Vec::new()),
    };

    // commentsExtended: paraId -> (done, parent paraId).
    let mut extended_by_para_id: HashMap<String, (Option<bool>, Option<String>)> = HashMap::new();
    if let Some(extended_xml) = pkg
        .parts
        .get("word/commentsExtended.xml")
        .map(|part| part.content.as_str())
    {
        for tag in re::get_unchecked(r"(?i)<w15:commentEx\b[^>]*/?>")
            .find_iter(extended_xml)
            .map(|m| m.as_str())
        {
            let Some(para_id) = get_attribute(tag, "w15:paraId") else {
                continue;
            };
            let done = get_attribute(tag, "w15:done")
                .map(|value| value == "1" || value.eq_ignore_ascii_case("true"));
            let parent_para_id = get_attribute(tag, "w15:paraIdParent");
            extended_by_para_id.insert(para_id, (done, parent_para_id));
        }
    }

    let mut comments = Vec::new();
    let mut comment_id_by_para_id: HashMap<String, i64> = HashMap::new();
    let mut parent_para_id_by_comment_id: HashMap<i64, String> = HashMap::new();
    for comment_xml in extract_balanced_tag_blocks(comments_xml, "w:comment") {
        let comment_tag = find_opening_tag(&comment_xml, "w:comment").unwrap_or_default();
        let Some(comment_id) = parse_integer_attribute(&comment_tag, "w:id") else {
            continue;
        };

        let parsed_nodes = parse_document_xml(&comment_xml, &context);
        let text = note_text_from_nodes(&parsed_nodes);
        let author = get_attribute(&comment_tag, "w:author")
            .map(|value| decode_xml_entities(&value))
            .filter(|value| !value.trim().is_empty());
        let initials = get_attribute(&comment_tag, "w:initials")
            .map(|value| decode_xml_entities(&value))
            .filter(|value| !value.trim().is_empty());
        let date = get_attribute(&comment_tag, "w:date").filter(|value| !value.trim().is_empty());

        // The comment's paragraphs carry w14:paraId attributes; the LAST one
        // identifies the comment in commentsExtended.
        let para_ids: Vec<String> = re::get_unchecked(r#"(?i)w14:paraId="([^"]+)""#)
            .captures_iter(&comment_xml)
            .filter_map(|captures| captures.get(1).map(|m| m.as_str().to_string()))
            .collect();
        let mut resolved = None;
        if let Some(last_para_id) = para_ids.last() {
            for para_id in &para_ids {
                comment_id_by_para_id.insert(para_id.clone(), comment_id);
            }
            if let Some((done, parent_para_id)) = extended_by_para_id.get(last_para_id) {
                resolved = done.filter(|value| *value);
                if let Some(parent_para_id) = parent_para_id {
                    parent_para_id_by_comment_id.insert(comment_id, parent_para_id.clone());
                }
            }
        }

        comments.push(DocumentCommentDefinition {
            id: comment_id,
            author,
            initials,
            date,
            text,
            parent_id: None,
            resolved,
        });
    }

    for comment in comments.iter_mut() {
        if let Some(parent_para_id) = parent_para_id_by_comment_id.get(&comment.id) {
            comment.parent_id = comment_id_by_para_id.get(parent_para_id).copied();
        }
    }

    comments.sort_by_key(|comment| comment.id);
    comments
}

fn parse_referenced_sections(
    pkg: &OoxmlPackage,
    document_xml: &str,
    document_relationships: &HashMap<String, String>,
    content_types: &ContentTypeLookup,
    style_sheet: &ParsedStyleSheet,
    warnings: &mut Vec<String>,
    relationship_tag_name: &str,
    missing_target_prefix: &str,
    missing_part_prefix: &str,
) -> Vec<ReferencedSectionPart> {
    let mut sections = Vec::new();
    let mut seen_part_names = HashSet::new();

    for tag in find_opening_tags(document_xml, relationship_tag_name) {
        let relationship_id = get_attribute(&tag, "r:id");
        let Some(relationship_id) = relationship_id else {
            continue;
        };

        let Some(target_part_name) = document_relationships.get(&relationship_id) else {
            warnings.push(format!("{missing_target_prefix} {relationship_id}"));
            continue;
        };

        if !seen_part_names.insert(target_part_name.clone()) {
            continue;
        }

        let Some(header_xml) = pkg.parts.get(target_part_name).map(|part| part.content.as_str())
        else {
            warnings.push(format!("{missing_part_prefix} {target_part_name}"));
            continue;
        };

        let header_context = ParseContext {
            relationships: parse_part_relationships(pkg, target_part_name),
            content_types: content_types.clone(),
            parts: &pkg.parts,
            binary_assets: &pkg.binary_assets,
            style_sheet: style_sheet.clone(),
            warnings: RefCell::new(Vec::new()),
        };

        sections.push(ReferencedSectionPart {
            part_name: target_part_name.clone(),
            reference_type: get_attribute(&tag, "w:type"),
            nodes: parse_document_xml(header_xml, &header_context),
        });
    }

    sections
}

fn parse_section_references_from_properties(
    section_properties_xml: &str,
    relationship_tag_name: &str,
    document_relationships: &HashMap<String, String>,
    cache: &mut PartNodeCache<'_>,
    warnings: &mut Vec<String>,
) -> Vec<ReferencedSectionPart> {
    let mut references = Vec::new();
    let mut seen_references = HashSet::new();

    for tag in find_opening_tags(section_properties_xml, relationship_tag_name) {
        let relationship_id = get_attribute(&tag, "r:id");
        let Some(relationship_id) = relationship_id else {
            continue;
        };

        let Some(target_part_name) = document_relationships.get(&relationship_id) else {
            warnings.push(format!(
                "{} {}",
                if relationship_tag_name == "headerReference" {
                    "Missing header relationship target for"
                } else {
                    "Missing footer relationship target for"
                },
                relationship_id
            ));
            continue;
        };

        let reference_type = get_attribute(&tag, "w:type");
        let dedupe_key = format!("{target_part_name}::{}", reference_type.as_deref().unwrap_or(""));
        if !seen_references.insert(dedupe_key) {
            continue;
        }

        let Some(nodes) = cache.resolve(target_part_name, relationship_tag_name, warnings) else {
            continue;
        };

        references.push(ReferencedSectionPart {
            part_name: target_part_name.clone(),
            reference_type,
            nodes,
        });
    }

    references
}

fn note_text_from_nodes(nodes: &[DocNode]) -> String {
    let mut lines = Vec::new();

    for node in nodes {
        append_paragraph_from_node(node, &mut lines);
    }

    let joined = lines.join("\n").trim().to_string();
    strip_leading_bracketed_index(&joined)
}

fn append_paragraph_from_node(node: &DocNode, lines: &mut Vec<String>) {
    match node {
        DocNode::Paragraph(paragraph) => append_paragraph(paragraph, lines),
        DocNode::Table(table) => {
            for row in &table.rows {
                for cell in &row.cells {
                    for paragraph in cell_paragraphs_from_content(&cell.nodes) {
                        append_paragraph(&paragraph, lines);
                    }
                }
            }
        }
    }
}

fn append_paragraph(paragraph: &ParagraphNode, lines: &mut Vec<String>) {
    let text = paragraph_plain_text(paragraph).trim_end().to_string();
    if !text.is_empty() {
        lines.push(text);
    }
}

fn paragraph_plain_text(paragraph: &ParagraphNode) -> String {
    paragraph
        .children
        .iter()
        .map(paragraph_child_plain_text)
        .collect::<Vec<_>>()
        .join("")
}

fn paragraph_child_plain_text(child: &ParagraphChildNode) -> String {
    match child {
        ParagraphChildNode::Text(text) => text.text.clone(),
        ParagraphChildNode::FormField(field) => form_field_plain_text(field),
        ParagraphChildNode::Image(_) => String::new(),
    }
}

fn form_field_plain_text(field: &FormFieldRunNode) -> String {
    match field.field_type {
        FormFieldType::Checkbox => {
            let is_checked = field.checked.unwrap_or_else(|| {
                field
                    .widget
                    .as_ref()
                    .and_then(|widget| widget.checkbox.as_ref())
                    .and_then(|checkbox| checkbox.default_checked)
                    .unwrap_or(false)
            });
            if is_checked {
                field
                    .checked_symbol
                    .clone()
                    .unwrap_or_else(|| "☒".to_string())
            } else {
                field
                    .unchecked_symbol
                    .clone()
                    .unwrap_or_else(|| "☐".to_string())
            }
        }
        FormFieldType::Text => field
            .value
            .clone()
            .or_else(|| {
                field
                    .widget
                    .as_ref()
                    .and_then(|widget| widget.text.as_ref())
                    .and_then(|text| text.default_text.clone())
            })
            .unwrap_or_default(),
        _ => field.value.clone().unwrap_or_default(),
    }
}

fn cell_paragraphs_from_content(nodes: &[TableCellContentNode]) -> Vec<ParagraphNode> {
    let mut paragraphs = Vec::new();
    walk_cell_content(nodes, &mut paragraphs);
    paragraphs
}

fn walk_cell_content(nodes: &[TableCellContentNode], paragraphs: &mut Vec<ParagraphNode>) {
    for item in nodes {
        match item {
            TableCellContentNode::Paragraph(paragraph) => paragraphs.push(paragraph.clone()),
            TableCellContentNode::Table(table) => {
                for row in &table.rows {
                    for cell in &row.cells {
                        walk_cell_content(&cell.nodes, paragraphs);
                    }
                }
            }
        }
    }
}

fn strip_leading_bracketed_index(text: &str) -> String {
    let bytes = text.as_bytes();
    if bytes.first() != Some(&b'[') {
        return text.to_string();
    }

    let mut index = 1;
    while index < bytes.len() && bytes[index].is_ascii_digit() {
        index += 1;
    }

    if index < bytes.len() && bytes[index] == b']' {
        let remainder = text[index + 1..].trim_start();
        return remainder.to_string();
    }

    text.to_string()
}

fn find_opening_tags(xml: &str, local_name: &str) -> Vec<String> {
    let open_prefix = format!("<w:{local_name}");
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

fn find_opening_tag(xml: &str, tag_name: &str) -> Option<String> {
    let open_prefix = format!("<{tag_name}");
    let tag_start = find_case_insensitive_at(xml, 0, &open_prefix)?;
    let relative_gt = xml[tag_start..].find('>')?;
    Some(xml[tag_start..tag_start + relative_gt + 1].to_string())
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
