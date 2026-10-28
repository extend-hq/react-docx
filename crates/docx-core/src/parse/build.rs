use crate::model::{DocModel, DocModelMetadata, DocumentNoteDefinition};
use std::cell::RefCell;

use crate::package::OoxmlPackage;

use super::content_types::parse_content_types;
use super::context::ParseContext;
use super::document::parse_document_xml;
use super::metadata::{
    extract_document_open_tag, extract_section_properties_xml, parse_document_background_color,
    parse_document_compatibility_settings, parse_document_default_tab_stop_twips,
    parse_document_page_count_from_app_properties,
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
    let _style_cache = super::style::run_style_cache_scope();
    let document_id = crate::structured::package_identity(pkg);
    let normalized = super::namespaces::normalized_package(pkg);
    let pkg = &normalized;
    let mut warnings = pkg.warnings.clone();
    warnings.extend(
        crate::source_graph::preserved_features(pkg)
            .into_iter()
            .map(|feature| {
                format!(
                    "{}: {} occurrence(s) of {} have support level {}",
                    feature.part_name, feature.occurrences, feature.feature, feature.support
                )
            }),
    );
    let main_part = crate::package::main_document_part_name(pkg);
    let source_part_names = ["footnotes", "endnotes", "comments"]
        .into_iter()
        .map(|kind| {
            (
                kind.to_string(),
                crate::package::related_document_part_name(pkg, kind),
            )
        })
        .chain(std::iter::once(("document".into(), main_part.clone())))
        .collect();
    let document_xml = pkg.parts.get(&main_part).map(|part| part.content.as_str());
    if document_xml.is_none() {
        warnings.push("Missing word/document.xml".to_string());
    }

    let resolved_document_xml = document_xml.unwrap_or("");
    let document_open_tag = extract_document_open_tag(resolved_document_xml);
    let document_background_color = parse_document_background_color(resolved_document_xml);
    let document_page_count = parse_document_page_count_from_app_properties(pkg);
    let compatibility = parse_document_compatibility_settings(pkg);
    let default_tab_stop_twips = parse_document_default_tab_stop_twips(pkg);
    let section_properties_xml = extract_section_properties_xml(resolved_document_xml);
    let content_types = parse_content_types(pkg);
    let style_sheet = parse_style_sheet(pkg);
    let numbering_definitions = parse_numbering_definitions(pkg, &content_types);
    let document_relationships = parse_part_relationships(pkg, &main_part);

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
        &crate::package::related_document_part_name(pkg, "footnotes"),
        "w:footnote",
        &content_types,
        &style_sheet,
        &mut warnings,
    );
    let endnotes = parse_document_notes_from_part(
        pkg,
        &crate::package::related_document_part_name(pkg, "endnotes"),
        "w:endnote",
        &content_types,
        &style_sheet,
        &mut warnings,
    );
    let comments = parse_document_comments(pkg, &content_types, &style_sheet);

    let nodes = parse_document_xml(resolved_document_xml, &context);
    warnings.extend(context.warnings.borrow().iter().cloned());

    let mut model = DocModel {
        nodes,
        metadata: DocModelMetadata {
            document_id: None,
            source_part_names: Some(source_part_names),
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
            default_tab_stop_twips,
            document_settings_imported: crate::package::related_document_part(pkg, "settings")
                .is_some()
                .then_some(true),
            line_spacing_compatibility_imported: crate::package::related_document_part(
                pkg, "settings",
            )
            .is_some()
            .then_some(true),
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
    };
    crate::structured::assign_source_ids(&mut model, &document_id);
    model
}

fn clone_notes_if_non_empty(
    notes: Vec<DocumentNoteDefinition>,
) -> Option<Vec<DocumentNoteDefinition>> {
    if notes.is_empty() {
        return None;
    }

    Some(notes)
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
            warnings: Vec::new(),
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
            warnings: Vec::new(),
        };
        let model = build_doc_model(&pkg);
        assert_eq!(model.nodes.len(), 1);
        assert!(model.metadata.sections.is_some());
    }

    #[test]
    fn build_doc_model_preserves_adapter_warnings() {
        let pkg = OoxmlPackage {
            parts: HashMap::new(),
            binary_assets: HashMap::new(),
            warnings: vec!["Legacy DOC adapter warning".to_string()],
        };
        let model = build_doc_model(&pkg);
        assert!(model
            .metadata
            .warnings
            .iter()
            .any(|warning| warning == "Legacy DOC adapter warning"));
    }
}
