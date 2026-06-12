use crate::model::{DocModel, DocModelMetadata, DocumentNoteDefinition};
use std::cell::RefCell;

use crate::package::OoxmlPackage;

use super::content_types::parse_content_types;
use super::context::ParseContext;
use super::document::parse_document_xml;
use super::metadata::{
    extract_document_open_tag, extract_section_properties_xml, parse_document_background_color,
    parse_document_compatibility_settings, parse_document_page_count_from_app_properties,
};
use super::numbering::parse_numbering_definitions;
use super::relationships::parse_part_relationships;
use super::sections::{
    parse_document_comments, parse_document_notes_from_part, parse_document_sections,
    parse_footer_sections, parse_header_sections,
};
use super::styles::{
    clone_numbering_definitions, clone_paragraph_style_definition, parse_style_sheet,
};

pub fn build_doc_model(pkg: &OoxmlPackage) -> DocModel {
    let mut warnings = Vec::new();
    let document_xml = pkg
        .parts
        .get("word/document.xml")
        .map(|part| part.content.as_str());
    if document_xml.is_none() {
        warnings.push("Missing word/document.xml".to_string());
    }

    let resolved_document_xml = document_xml.unwrap_or("");
    let document_open_tag = extract_document_open_tag(resolved_document_xml);
    let document_background_color = parse_document_background_color(resolved_document_xml);
    let document_page_count = parse_document_page_count_from_app_properties(pkg);
    let compatibility = parse_document_compatibility_settings(pkg);
    let section_properties_xml = extract_section_properties_xml(resolved_document_xml);
    let content_types = parse_content_types(pkg);
    let style_sheet = parse_style_sheet(pkg);
    let numbering_definitions = parse_numbering_definitions(pkg, &content_types);
    let document_relationships = parse_part_relationships(pkg, "word/document.xml");

    let context = ParseContext {
        relationships: document_relationships.clone(),
        content_types: content_types.clone(),
        parts: &pkg.parts,
        binary_assets: &pkg.binary_assets,
        style_sheet: style_sheet.clone(),
        warnings: RefCell::new(Vec::new()),
    };

    let header_sections = parse_header_sections(
        pkg,
        resolved_document_xml,
        &document_relationships,
        &content_types,
        &style_sheet,
        &mut warnings,
    );
    let footer_sections = parse_footer_sections(
        pkg,
        resolved_document_xml,
        &document_relationships,
        &content_types,
        &style_sheet,
        &mut warnings,
    );
    let sections = parse_document_sections(
        pkg,
        resolved_document_xml,
        &document_relationships,
        &content_types,
        &style_sheet,
        &mut warnings,
    );
    let footnotes = parse_document_notes_from_part(
        pkg,
        "word/footnotes.xml",
        "w:footnote",
        &content_types,
        &style_sheet,
        &mut warnings,
    );
    let endnotes = parse_document_notes_from_part(
        pkg,
        "word/endnotes.xml",
        "w:endnote",
        &content_types,
        &style_sheet,
        &mut warnings,
    );
    let comments = parse_document_comments(pkg, &content_types, &style_sheet);

    warnings.extend(context.warnings.borrow().iter().cloned());

    DocModel {
        nodes: parse_document_xml(resolved_document_xml, &context),
        metadata: DocModelMetadata {
            source_parts: pkg.parts.len() as i64,
            warnings,
            document_page_count,
            document_open_tag,
            document_background_color,
            section_properties_xml,
            sections: Some(sections),
            header_sections,
            footer_sections,
            paragraph_styles: style_sheet
                .paragraph_styles
                .iter()
                .map(clone_paragraph_style_definition)
                .collect(),
            default_paragraph_style_id: style_sheet.default_paragraph_style_id.clone(),
            numbering_definitions: numbering_definitions
                .as_ref()
                .map(clone_numbering_definitions),
            compatibility: compatibility.clone(),
            footnotes: clone_notes_if_non_empty(footnotes),
            endnotes: clone_notes_if_non_empty(endnotes),
            comments: if comments.is_empty() {
                None
            } else {
                Some(comments)
            },
        },
    }
}

fn clone_notes_if_non_empty(
    notes: Vec<DocumentNoteDefinition>,
) -> Option<Vec<DocumentNoteDefinition>> {
    if notes.is_empty() {
        return None;
    }

    Some(
        notes
            .into_iter()
            .map(|note| DocumentNoteDefinition {
                id: note.id,
                text: note.text,
                nodes: note
                    .nodes
                    .map(|nodes| nodes.iter().map(|node| node.clone()).collect()),
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::package::OoxmlPart;

    #[test]
    fn build_doc_model_warns_when_document_missing() {
        let pkg = OoxmlPackage {
            parts: HashMap::new(),
            binary_assets: HashMap::new(),
        };
        let model = build_doc_model(&pkg);
        assert_eq!(model.nodes.len(), 1);
        assert!(model
            .metadata
            .warnings
            .iter()
            .any(|warning| warning.contains("Missing word/document.xml")));
    }

    #[test]
    fn build_doc_model_parses_empty_document() {
        let mut parts = HashMap::new();
        parts.insert(
            "word/document.xml".to_string(),
            OoxmlPart {
                name: "word/document.xml".to_string(),
                content: "<w:document><w:body/></w:document>".to_string(),
            },
        );
        let pkg = OoxmlPackage {
            parts,
            binary_assets: HashMap::new(),
        };
        let model = build_doc_model(&pkg);
        assert_eq!(model.nodes.len(), 1);
        assert!(model.metadata.sections.is_some());
    }
}
