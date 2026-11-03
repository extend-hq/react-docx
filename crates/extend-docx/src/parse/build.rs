use crate::model::{DocModel, DocModelMetadata, DocumentNoteDefinition};
use std::cell::RefCell;

use crate::package::OoxmlPackage;

use super::content_types::parse_content_types;
use super::context::ParseContext;
#[cfg(target_arch = "wasm32")]
use super::document::parse_document_xml;
use super::metadata::{
    extract_document_open_tag, extract_section_properties_xml, parse_document_background_color,
    parse_document_compatibility_settings, parse_document_default_tab_stop_twips,
    parse_document_page_count_from_app_properties,
};
use super::numbering::parse_numbering_with_assets;
use super::relationships::parse_part_relationships;
use super::sections::{
    parse_document_comments, parse_document_notes_from_part, parse_document_sections,
    parse_footer_sections, parse_header_sections,
};
use super::styles::{acquire_document_style_sheet, release_document_style_metadata};

pub fn build_doc_model(pkg: &OoxmlPackage) -> DocModel {
    #[cfg(not(target_arch = "wasm32"))]
    {
        let bytes = pkg.parts.values().map(|part| part.content.len())
            .chain(pkg.binary_assets.values().map(Vec::len))
            .fold(0usize, usize::saturating_add);
        if let Some(pool) = (bytes >= 64 * 1024)
            .then(super::namespaces::worker_pool).flatten()
        {
            let mut identity = None;
            let mut model = pool.in_place_scope(|scope| {
                scope.spawn(|_| {
                    identity = Some(crate::structured::package_identity(pkg));
                });
                build_doc_model_contents(pkg)
            });
            crate::structured::assign_source_ids(&mut model, &identity.expect("joined identity task"));
            return model;
        }
    }
    let identity = crate::structured::package_identity(pkg);
    let mut model = build_doc_model_contents(pkg);
    crate::structured::assign_source_ids(&mut model, &identity);
    model
}

fn build_doc_model_contents(pkg: &OoxmlPackage) -> DocModel {
    let _style_cache = super::style::run_style_cache_scope();
    let binary_assets = &pkg.binary_assets;
    let (normalized, indexes) = super::namespaces::normalized_package(pkg);
    let pkg = &normalized;
    let _relationship_cache = crate::package::relationship_cache_scope(pkg);
    let _xml_index = crate::xml_index::scope(
        pkg.parts
            .values()
            .map(|part| (part.name.as_str(), part.content.as_str())),
        indexes,
    );
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
    let style_handle = acquire_document_style_sheet(pkg);
    let style_sheet: &super::context::ParsedStyleSheet = std::borrow::Borrow::borrow(&style_handle);
    super::style::bind_style_cache(style_sheet);
    let numbering_definitions = parse_numbering_with_assets(pkg, &content_types, binary_assets);
    let document_relationships = parse_part_relationships(pkg, &main_part);

    let mut part_cache =
        super::sections::PartNodeCache::new(pkg, &content_types, style_sheet, binary_assets);
    let header_sections = parse_header_sections(
        pkg,
        resolved_document_xml,
        &document_relationships,
        &mut warnings,
        &mut part_cache,
    );
    let footer_sections = parse_footer_sections(
        pkg,
        resolved_document_xml,
        &document_relationships,
        &mut warnings,
        &mut part_cache,
    );
    let sections = parse_document_sections(
        resolved_document_xml,
        &document_relationships,
        &mut warnings,
        &mut part_cache,
    );
    drop(part_cache);
    let footnotes = parse_document_notes_from_part(
        pkg,
        &crate::package::related_document_part_name(pkg, "footnotes"),
        "w:footnote",
        &content_types,
        style_sheet,
        &mut warnings,
        binary_assets,
    );
    let endnotes = parse_document_notes_from_part(
        pkg,
        &crate::package::related_document_part_name(pkg, "endnotes"),
        "w:endnote",
        &content_types,
        style_sheet,
        &mut warnings,
        binary_assets,
    );
    let comments = parse_document_comments(pkg, &content_types, style_sheet, binary_assets);

    let context = ParseContext {
        relationships: document_relationships.clone(),
        content_types: content_types.clone(),
        parts: &pkg.parts,
        binary_assets,
        style_sheet: style_sheet,
        warnings: RefCell::new(Vec::new()),
    };

    #[cfg(not(target_arch = "wasm32"))]
    let nodes =
        super::document::parse_document_xml_parallel(resolved_document_xml, &context, &_xml_index);
    #[cfg(target_arch = "wasm32")]
    let nodes = parse_document_xml(resolved_document_xml, &context);
    warnings.extend(context.warnings.borrow().iter().cloned());

    let (paragraph_styles, default_paragraph_style_id) =
        release_document_style_metadata(style_handle);
    let model = DocModel {
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
            paragraph_styles,
            default_paragraph_style_id,
            default_tab_stop_twips,
            document_settings_imported: crate::package::related_document_part(pkg, "settings")
                .is_some()
                .then_some(true),
            line_spacing_compatibility_imported: crate::package::related_document_part(
                pkg, "settings",
            )
            .is_some()
            .then_some(true),
            numbering_definitions,
            compatibility,
            footnotes: clone_notes_if_non_empty(footnotes),
            endnotes: clone_notes_if_non_empty(endnotes),
            comments: if comments.is_empty() {
                None
            } else {
                Some(comments)
            },
        },
    };
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

#[cfg(test)]
mod package_preparation_tests {
    #[test]
    fn parallel_build_preserves_identity_and_normalized_source_count() {
        let mut parts = std::collections::HashMap::new();
        for index in 0..6 {
            let name = format!("part-{index}.xml");
            parts.insert(name.clone(), crate::package::OoxmlPart { name, content: format!("<w:root xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:t>{}</w:t></w:root>", "text &amp; detail ".repeat(1000)) });
        }
        let package = crate::package::OoxmlPackage {
            parts,
            binary_assets: std::collections::HashMap::from([("asset".into(), vec![5; 32 * 1024])]),
            warnings: vec!["prior warning".into()],
        };
        let expected_identity = crate::structured::package_identity(&package);
        let (expected, _) = crate::parse::namespaces::normalized_package(&package);
        let mut serial = super::build_doc_model_contents(&package);
        crate::structured::assign_source_ids(&mut serial, &expected_identity);
        let actual = super::build_doc_model(&package);
        assert_eq!(actual.metadata.document_id.as_deref(), Some(expected_identity.as_str()));
        assert_eq!(actual.metadata.source_parts, expected.parts.len() as i64);
        assert_eq!(serde_json::to_string(&actual).unwrap(), serde_json::to_string(&serial).unwrap());
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod identity_overlap_tests {
    use super::*;
    use std::collections::HashMap;
    use crate::package::OoxmlPart;

    #[test]
    fn overlapped_identity_matches_serial_construction() {
        for asset_size in [0, 65536, 262145] {
            let document = r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>content</w:t></w:r></w:p></w:body></w:document>"#;
            let part = OoxmlPart { name: "word/document.xml".into(), content: document.into() };
            let mut package = OoxmlPackage { parts: HashMap::from([(part.name.clone(), part)]), binary_assets: HashMap::new(), warnings: Vec::new() };
            package.binary_assets.insert("word/media/payload.bin".into(), (0..asset_size).map(|n| n as u8).collect());
            let mut serial = build_doc_model_contents(&package);
            crate::structured::assign_source_ids(&mut serial, &crate::structured::package_identity(&package));
            let parallel = build_doc_model(&package);
            assert_eq!(serde_json::to_string(&serial).unwrap(), serde_json::to_string(&parallel).unwrap());
            package.binary_assets.get_mut("word/media/payload.bin").unwrap().push(7);
            let changed = build_doc_model(&package);
            assert_ne!(parallel.metadata.document_id, changed.metadata.document_id);
        }
    }
}
