use std::cell::RefCell;
use std::collections::HashMap;

use extend_docx::model::{FormFieldRunNode, ParagraphChildNode};
use extend_docx::parse::{empty_style_sheet, parse_paragraph, ParseContext};

fn parse_field(properties: &str, content: &str) -> FormFieldRunNode {
    let parts = HashMap::new();
    let binary_assets = HashMap::new();
    let context = ParseContext {
        relationships: HashMap::new(),
        content_types: Default::default(),
        parts: &parts,
        binary_assets: &binary_assets,
        style_sheet: empty_style_sheet(),
        warnings: RefCell::new(Vec::new()),
    };
    let xml = format!(
        "<w:p><w:sdt><w:sdtPr>{properties}</w:sdtPr><w:sdtContent>{content}</w:sdtContent></w:sdt></w:p>"
    );
    parse_paragraph(&xml, &context)
        .children
        .into_iter()
        .find_map(|child| match child {
            ParagraphChildNode::FormField(field) => Some(*field),
            _ => None,
        })
        .expect("form field")
}

#[test]
fn dropdown_uses_shared_style_of_trimmed_content() {
    for control in ["dropDownList", "comboBox"] {
        let field = parse_field(
            &format!(
                "<w:{control}><w:listItem w:displayText=\"Selected\" w:value=\"s\"/></w:{control}>"
            ),
            r#"<w:r><w:rPr><w:b w:val="0"/><w:shd w:fill="FFFFFF"/></w:rPr><w:t> &#x2003;</w:t></w:r><w:r><w:rPr><w:b/><w:shd w:fill="4477AA"/></w:rPr><w:t>Selected</w:t></w:r><w:r><w:rPr><w:b/><w:shd w:fill="4477AA"/></w:rPr><w:t>.</w:t></w:r><w:r><w:rPr><w:b w:val="0"/><w:shd w:fill="FFFFFF"/></w:rPr><w:t> </w:t></w:r>"#,
        );
        assert_eq!(field.value.as_deref(), Some("Selected."));
        let style = field.style.as_ref().expect("style");
        assert_eq!(style.bold, Some(true));
        assert_eq!(style.background_color.as_deref(), Some("#4477AA"));
        let options = field.options.as_ref().expect("options");
        assert_eq!(options[0].display_text, "Selected");
        assert_eq!(options[0].value.as_deref(), Some("s"));
    }
}

#[test]
fn shared_properties_do_not_replace_conflicting_visible_properties() {
    let field = parse_field(
        "<w:comboBox/>",
        r#"<w:r><w:rPr><w:color w:val="000000"/><w:sz w:val="20"/><w:shd w:fill="FFFFFF"/></w:rPr><w:t> </w:t></w:r><w:r><w:rPr><w:b/><w:color w:val="112233"/><w:sz w:val="24"/><w:shd w:fill="4477AA"/></w:rPr><w:t>A</w:t></w:r><w:r><w:rPr><w:b/><w:color w:val="808080"/><w:sz w:val="28"/><w:shd w:fill="4477AA"/></w:rPr><w:t>.</w:t></w:r>"#,
    );
    let style = field.style.as_ref().expect("style");
    assert_eq!(style.bold, Some(true));
    assert_eq!(style.background_color.as_deref(), Some("#4477AA"));
    assert_eq!(style.color.as_deref(), Some("#000000"));
    assert_eq!(style.font_size_pt, Some(10.0));
}

#[test]
fn mixed_bold_is_not_promoted_to_uniform_bold() {
    let field = parse_field(
        "<w:comboBox/>",
        r#"<w:r><w:rPr><w:color w:val="000000"/></w:rPr><w:t> </w:t></w:r><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>A</w:t></w:r><w:r><w:rPr><w:b w:val="0"/><w:i/></w:rPr><w:t>B</w:t></w:r>"#,
    );
    let style = field.style.as_ref().expect("style");
    assert_eq!(style.bold, None);
    assert_eq!(style.italic, Some(true));
}

#[test]
fn interior_whitespace_participates_in_style_consensus() {
    let field = parse_field(
        "<w:dropDownList/>",
        r#"<w:r><w:rPr><w:shd w:fill="FFFFFF"/></w:rPr><w:t> </w:t></w:r><w:r><w:rPr><w:b/><w:shd w:fill="4477AA"/></w:rPr><w:t>A</w:t></w:r><w:r><w:rPr><w:b w:val="0"/><w:shd w:fill="FFFFFF"/></w:rPr><w:t> </w:t></w:r><w:r><w:rPr><w:b/><w:shd w:fill="4477AA"/></w:rPr><w:t>B</w:t></w:r>"#,
    );
    assert_eq!(field.value.as_deref(), Some("A B"));
    let style = field.style.as_ref().expect("style");
    assert_eq!(style.bold, None);
    assert_eq!(style.background_color.as_deref(), Some("#FFFFFF"));
}

#[test]
fn empty_interior_runs_do_not_contribute_formatting() {
    let field = parse_field(
        "<w:comboBox/>",
        r#"<w:r><w:t> </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>A</w:t></w:r><w:r><w:rPr><w:b w:val="0"/></w:rPr></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>B</w:t></w:r>"#,
    );
    assert_eq!(field.value.as_deref(), Some("AB"));
    assert_eq!(
        field.style.as_ref().and_then(|style| style.bold),
        Some(true)
    );
}

#[test]
fn empty_or_whitespace_content_keeps_the_original_fallback() {
    let field = parse_field(
        r#"<w:dropDownList/><w:lastValue w:val="fallback"/>"#,
        r#"<w:r><w:rPr><w:b/><w:color w:val="112233"/></w:rPr><w:t> &#x2003;</w:t></w:r>"#,
    );
    assert_eq!(field.value.as_deref(), Some("fallback"));
    assert_eq!(
        field.style.as_ref().and_then(|style| style.bold),
        Some(true)
    );
    assert_eq!(
        field
            .style
            .as_ref()
            .and_then(|style| style.color.as_deref()),
        Some("#112233")
    );
    let empty = parse_field("<w:comboBox/>", "");
    assert_eq!(empty.value, None);
    assert_eq!(empty.style, None);
}

#[test]
fn empty_leading_run_does_not_hide_visible_plain_style() {
    let field = parse_field(
        "<w:dropDownList/>",
        r#"<w:r><w:rPr><w:b/></w:rPr></w:r><w:r><w:t>Plain</w:t></w:r>"#,
    );
    assert_eq!(field.value.as_deref(), Some("Plain"));
    assert_eq!(field.style, None);
}

#[test]
fn a_visible_first_run_and_other_control_kinds_keep_their_style() {
    let content = r#"<w:r><w:rPr><w:color w:val="112233"/></w:rPr><w:t> </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Value</w:t></w:r>"#;
    for properties in ["<w:date/>", "<w:text/>", "<w:richText/>", "<w14:checkbox/>"] {
        let field = parse_field(properties, content);
        let style = field.style.as_ref().expect("style");
        assert_eq!(style.bold, None);
        assert_eq!(style.color.as_deref(), Some("#112233"));
    }
    let field = parse_field(
        "<w:comboBox/>",
        r#"<w:r><w:rPr><w:color w:val="112233"/></w:rPr><w:t> A</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>B</w:t></w:r>"#,
    );
    assert_eq!(field.value.as_deref(), Some("AB"));
    assert_eq!(field.style.as_ref().and_then(|style| style.bold), None);
}
