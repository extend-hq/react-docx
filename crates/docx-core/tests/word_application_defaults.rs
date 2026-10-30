//! Word substitutes application defaults for omitted document defaults.
//! Expectations come from native Word 16.106 controls (glyph heights and line
//! pitch in exported PDFs), recorded under output/playwright/word-breaks-20261012.
use std::collections::HashMap;

use docx_core::model::{
    DocModel, DocNode, ParagraphChildNode, ParagraphLineRule, ParagraphNode, TextStyle,
};
use docx_core::{build_doc_model, OoxmlPackage, OoxmlPart};

const W: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

fn package(styles: &str) -> OoxmlPackage {
    let document = format!(
        r#"<w:document xmlns:w="{W}"><w:body><w:p><w:r><w:t>Text</w:t></w:r></w:p></w:body></w:document>"#
    );
    OoxmlPackage {
        parts: [
            ("word/document.xml", document),
            (
                "word/styles.xml",
                format!(r#"<w:styles xmlns:w="{W}">{styles}</w:styles>"#),
            ),
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

fn paragraph(model: &DocModel) -> &ParagraphNode {
    let DocNode::Paragraph(paragraph) = &model.nodes[0] else {
        panic!("paragraph")
    };
    paragraph
}

fn run_style(model: &DocModel) -> TextStyle {
    let ParagraphChildNode::Text(run) = &paragraph(model).children[0] else {
        panic!("text run")
    };
    run.style.as_deref().cloned().expect("resolved run style")
}

fn spacing(model: &DocModel) -> (Option<i64>, Option<i64>, Option<ParagraphLineRule>) {
    paragraph(model)
        .style
        .as_ref()
        .and_then(|style| style.spacing.as_ref())
        .map(|spacing| (spacing.after_twips, spacing.line_twips, spacing.line_rule))
        .unwrap_or((None, None, None))
}

const NORMAL: &str = r#"<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>"#;

#[test]
fn declared_defaults_without_a_size_use_ten_points_and_single_spacing() {
    let model = build_doc_model(&package(&format!(
        r#"<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>{NORMAL}"#
    )));
    let style = run_style(&model);
    assert_eq!(style.font_size_pt, Some(10.0));
    assert_eq!(style.font_size_cs_pt, Some(10.0));
    assert_eq!(spacing(&model), (None, None, None));
}

#[test]
fn empty_declared_run_defaults_still_use_ten_points() {
    let model = build_doc_model(&package(&format!(
        r#"<w:docDefaults><w:rPrDefault/><w:pPrDefault/></w:docDefaults>{NORMAL}"#
    )));
    assert_eq!(run_style(&model).font_size_pt, Some(10.0));
}

#[test]
fn omitted_defaults_use_word_application_defaults() {
    let model = build_doc_model(&package(
        r#"<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>"#,
    ));
    let style = run_style(&model);
    assert_eq!(style.font_size_pt, Some(12.0));
    assert_eq!(style.font_family.as_deref(), Some("Aptos"));
    assert_eq!(
        spacing(&model),
        (Some(160), Some(276), Some(ParagraphLineRule::Auto))
    );
}

#[test]
fn omitted_paragraph_defaults_add_application_spacing_to_declared_run_defaults() {
    let model = build_doc_model(&package(&format!(
        r#"<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr></w:rPrDefault></w:docDefaults>{NORMAL}"#
    )));
    assert_eq!(run_style(&model).font_size_pt, Some(10.0));
    assert_eq!(
        spacing(&model),
        (Some(160), Some(276), Some(ParagraphLineRule::Auto))
    );
}

#[test]
fn normal_style_overrides_application_defaults() {
    let model = build_doc_model(&package(
        r#"<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:style>"#,
    ));
    let style = run_style(&model);
    assert_eq!(style.font_size_pt, Some(10.0));
    assert_eq!(style.font_family.as_deref(), Some("Arial"));
    assert_eq!(
        spacing(&model),
        (Some(0), Some(240), Some(ParagraphLineRule::Auto))
    );
}
