use std::collections::HashMap;

use extend_docx::model::{DocModel, DocNode, ParagraphNode, TableCellContentNode};
use extend_docx::{build_doc_model, serialize_doc_model, OoxmlPackage, OoxmlPart};

fn package(body: &str, styles: &str) -> OoxmlPackage {
    let document = format!(
        r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}</w:body></w:document>"#
    );
    OoxmlPackage {
        parts: [
            ("word/document.xml", document),
            ("word/styles.xml", styles.to_string()),
        ]
        .into_iter()
        .map(|(name, content)| {
            (
                name.to_string(),
                OoxmlPart {
                    name: name.to_string(),
                    content,
                },
            )
        })
        .collect(),
        binary_assets: HashMap::new(),
        warnings: Vec::new(),
    }
}

fn body_paragraph(model: &DocModel, index: usize) -> &ParagraphNode {
    let DocNode::Paragraph(paragraph) = &model.nodes[index] else {
        panic!("paragraph")
    };
    paragraph
}

const STYLES: &str = r#"<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"/>
<w:style w:type="paragraph" w:styleId="Automatic"><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="100" w:after="100" w:beforeAutospacing="1" w:afterAutospacing="1"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="ManualBefore"><w:basedOn w:val="Automatic"/><w:pPr><w:spacing w:beforeAutospacing="0"/></w:pPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="DefaultTable"><w:pPr><w:spacing w:before="80" w:after="120" w:beforeAutospacing="false" w:afterAutospacing="true"/></w:pPr></w:style>
</w:styles>"#;

#[test]
fn automatic_spacing_inherits_independently_and_explicit_false_overrides() {
    let body = r#"<w:p><w:pPr><w:pStyle w:val="Automatic"/></w:pPr></w:p>
<w:p><w:pPr><w:pStyle w:val="ManualBefore"/></w:pPr></w:p>
<w:p><w:pPr><w:pStyle w:val="Automatic"/><w:spacing w:beforeAutospacing="0" w:afterAutospacing="false"/></w:pPr></w:p>
<w:p><w:pPr><w:pStyle w:val="Automatic"/><w:spacing w:before="160"/></w:pPr></w:p>
<w:p><w:pPr><w:spacing w:before="100" w:after="100"/></w:pPr></w:p>"#;
    let model = build_doc_model(&package(body, STYLES));
    for (index, before, after, amount) in [
        (0, Some(true), Some(true), 100),
        (1, Some(false), Some(true), 100),
        (2, Some(false), Some(false), 100),
        (3, Some(true), Some(true), 160),
        (4, None, None, 100),
    ] {
        let spacing = body_paragraph(&model, index)
            .style
            .as_ref()
            .unwrap()
            .spacing
            .as_ref()
            .unwrap();
        assert_eq!(spacing.before_auto_spacing, before);
        assert_eq!(spacing.after_auto_spacing, after);
        assert_eq!(spacing.before_twips, Some(amount));
        assert_eq!(spacing.after_twips, Some(100));
    }
}

#[test]
fn automatic_spacing_flag_only_properties_and_lexical_booleans_survive() {
    for (value, expected) in [
        ("1", true),
        ("true", true),
        ("on", true),
        ("0", false),
        ("false", false),
        ("off", false),
    ] {
        let body = format!(
            r#"<w:p><w:pPr><w:spacing w:beforeAutospacing="{value}" w:afterAutospacing="{value}"/></w:pPr></w:p>"#
        );
        let model = build_doc_model(&package(&body, ""));
        let spacing = body_paragraph(&model, 0)
            .style
            .as_ref()
            .unwrap()
            .spacing
            .as_ref()
            .unwrap();
        assert_eq!(spacing.before_auto_spacing, Some(expected));
        assert_eq!(spacing.after_auto_spacing, Some(expected));
        let json = serde_json::to_value(spacing).unwrap();
        assert_eq!(json["beforeAutoSpacing"], expected);
        assert_eq!(json["afterAutoSpacing"], expected);
        assert_eq!(spacing.before_twips, None);
    }
}

#[test]
fn default_table_spacing_flags_reach_cell_paragraphs() {
    let body = r#"<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"#;
    let model = build_doc_model(&package(body, STYLES));
    let DocNode::Table(table) = &model.nodes[0] else {
        panic!("table")
    };
    let TableCellContentNode::Paragraph(paragraph) = &table.rows[0].cells[0].nodes[0] else {
        panic!("paragraph")
    };
    let spacing = paragraph.style.as_ref().unwrap().spacing.as_ref().unwrap();
    assert_eq!(spacing.before_auto_spacing, Some(false));
    assert_eq!(spacing.after_auto_spacing, Some(true));
    assert_eq!(spacing.before_twips, Some(80));
    assert_eq!(spacing.after_twips, Some(120));
}

#[test]
fn automatic_spacing_edits_patch_retained_source_and_rebuild() {
    let body = r#"<w:p><w:pPr><w:pStyle w:val="Automatic"/><w:spacing w:beforeLines="20" w:line="240"></w:spacing></w:pPr><w:r><w:t>Text</w:t></w:r></w:p>"#;
    let pkg = package(body, STYLES);
    let model = build_doc_model(&pkg);
    let unedited = serialize_doc_model(&model, Some(&pkg));
    let unedited_model = build_doc_model(&unedited);
    assert_eq!(
        body_paragraph(&unedited_model, 0).source_xml,
        body_paragraph(&model, 0).source_xml
    );
    for retain_source in [true, false] {
        for desired in [true, false] {
            let mut edited = model.clone();
            let DocNode::Paragraph(paragraph) = &mut edited.nodes[0] else {
                panic!("paragraph")
            };
            paragraph.source_xml = retain_source.then(|| body.to_string());
            let spacing = paragraph.style.as_mut().unwrap().spacing.as_mut().unwrap();
            spacing.before_auto_spacing = Some(desired);
            spacing.after_auto_spacing = Some(false);
            let exported = serialize_doc_model(&edited, Some(&pkg));
            let reparsed = build_doc_model(&exported);
            let spacing = body_paragraph(&reparsed, 0)
                .style
                .as_ref()
                .unwrap()
                .spacing
                .as_ref()
                .unwrap();
            assert_eq!(spacing.before_auto_spacing, Some(desired));
            assert_eq!(spacing.after_auto_spacing, Some(false));
            if retain_source {
                assert!(exported.parts["word/document.xml"]
                    .content
                    .contains(r#"w:beforeLines="20""#));
            }
        }
    }
}

#[test]
fn automatic_spacing_edits_inside_retained_table_source_are_serialized() {
    let body = r#"<w:tbl><w:tr><w:tc><w:p><w:pPr><w:pStyle w:val="Automatic"/></w:pPr><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"#;
    let pkg = package(body, STYLES);
    let mut model = build_doc_model(&pkg);
    let DocNode::Table(table) = &mut model.nodes[0] else {
        panic!("table")
    };
    let TableCellContentNode::Paragraph(paragraph) = &mut table.rows[0].cells[0].nodes[0] else {
        panic!("paragraph")
    };
    let spacing = paragraph.style.as_mut().unwrap().spacing.as_mut().unwrap();
    spacing.before_auto_spacing = Some(false);
    spacing.after_auto_spacing = Some(false);
    let exported = serialize_doc_model(&model, Some(&pkg));
    let reparsed = build_doc_model(&exported);
    let DocNode::Table(table) = &reparsed.nodes[0] else {
        panic!("table")
    };
    let TableCellContentNode::Paragraph(paragraph) = &table.rows[0].cells[0].nodes[0] else {
        panic!("paragraph")
    };
    let spacing = paragraph.style.as_ref().unwrap().spacing.as_ref().unwrap();
    assert_eq!(spacing.before_auto_spacing, Some(false));
    assert_eq!(spacing.after_auto_spacing, Some(false));
}

#[test]
fn clearing_a_direct_automatic_spacing_override_restores_style_inheritance() {
    let body = r#"<w:p><w:pPr><w:pStyle w:val="Automatic"/><w:spacing w:beforeAutospacing="0" w:afterAutospacing="0"/></w:pPr></w:p>"#;
    let pkg = package(body, STYLES);
    let mut model = build_doc_model(&pkg);
    let DocNode::Paragraph(paragraph) = &mut model.nodes[0] else {
        panic!("paragraph")
    };
    let spacing = paragraph.style.as_mut().unwrap().spacing.as_mut().unwrap();
    spacing.before_auto_spacing = None;
    spacing.after_auto_spacing = None;
    let exported = serialize_doc_model(&model, Some(&pkg));
    assert!(!exported.parts["word/document.xml"]
        .content
        .contains("Autospacing"));
    let reparsed = build_doc_model(&exported);
    let spacing = body_paragraph(&reparsed, 0)
        .style
        .as_ref()
        .unwrap()
        .spacing
        .as_ref()
        .unwrap();
    assert_eq!(spacing.before_auto_spacing, Some(true));
    assert_eq!(spacing.after_auto_spacing, Some(true));
}
