use std::cell::RefCell;
use std::collections::HashMap;

use docx_core::model::ParagraphChildNode;
use docx_core::parse::{empty_style_sheet, parse_paragraph, ParseContext};
use docx_core::OoxmlPart;

fn test_context<'a>(
    parts: &'a HashMap<String, OoxmlPart>,
    binary_assets: &'a HashMap<String, Vec<u8>>,
) -> ParseContext<'a> {
    ParseContext {
        relationships: HashMap::new(),
        content_types: Default::default(),
        parts,
        binary_assets,
        style_sheet: empty_style_sheet(),
        warnings: RefCell::new(Vec::new()),
    }
}

/// An empty paragraph renders one line at its paragraph mark's (pPr>rPr)
/// formatting in Word — spacer paragraphs built from oversized empty marks
/// must keep that size or page estimates collapse them to the default font.
#[test]
fn empty_paragraph_carries_paragraph_mark_run_style() {
    let paragraph_xml = r#"<w:p><w:pPr><w:spacing w:before="20"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:pPr></w:p>"#;
    let parts = HashMap::new();
    let binary_assets = HashMap::new();
    let context = test_context(&parts, &binary_assets);

    let paragraph = parse_paragraph(paragraph_xml, &context);
    assert_eq!(paragraph.children.len(), 1);
    let ParagraphChildNode::Text(run) = &paragraph.children[0] else {
        panic!("expected synthetic text run");
    };
    assert_eq!(run.text, "");
    let style = run.style.as_ref().expect("mark run style");
    assert_eq!(style.font_size_pt, Some(20.0));
    assert_eq!(style.bold, Some(true));
}

/// A run's own rPr must not leak into the synthetic mark style — only the
/// pPr>rPr block counts (regression guard for the pPr/run rPr distinction).
#[test]
fn paragraph_mark_style_ignores_run_level_rpr() {
    let paragraph_xml = r#"<w:p><w:pPr><w:rPr><w:sz w:val="40"/></w:rPr></w:pPr><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>text</w:t></w:r></w:p>"#;
    let parts = HashMap::new();
    let binary_assets = HashMap::new();
    let context = test_context(&parts, &binary_assets);

    let paragraph = parse_paragraph(paragraph_xml, &context);
    // Paragraph has a real run, so no synthetic mark run is added and the
    // run keeps its own 8pt size.
    assert_eq!(paragraph.children.len(), 1);
    let ParagraphChildNode::Text(run) = &paragraph.children[0] else {
        panic!("expected text run");
    };
    assert_eq!(run.text, "text");
    assert_eq!(
        run.style.as_ref().and_then(|style| style.font_size_pt),
        Some(8.0)
    );
}

/// Empty paragraph without a mark rPr still parses (style comes from the
/// style sheet defaults, or None with an empty sheet).
#[test]
fn empty_paragraph_without_mark_rpr_still_parses() {
    let paragraph_xml = r#"<w:p><w:pPr><w:spacing w:before="20"/></w:pPr></w:p>"#;
    let parts = HashMap::new();
    let binary_assets = HashMap::new();
    let context = test_context(&parts, &binary_assets);

    let paragraph = parse_paragraph(paragraph_xml, &context);
    assert_eq!(paragraph.children.len(), 1);
    let ParagraphChildNode::Text(run) = &paragraph.children[0] else {
        panic!("expected synthetic text run");
    };
    assert_eq!(run.text, "");
    assert_eq!(
        run.style.as_ref().and_then(|style| style.font_size_pt),
        None
    );
}
