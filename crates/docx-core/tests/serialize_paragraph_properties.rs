use std::collections::HashMap;

use docx_core::model::DocNode;
use docx_core::{build_doc_model, serialize_doc_model, OoxmlPackage, OoxmlPart};

fn package_with_parts(parts: &[(&str, &str)]) -> OoxmlPackage {
    let mut map = HashMap::new();
    for (name, content) in parts {
        map.insert(
            (*name).to_string(),
            OoxmlPart {
                name: (*name).to_string(),
                content: (*content).to_string(),
            },
        );
    }
    OoxmlPackage {
        parts: map,
        binary_assets: HashMap::new(),
    }
}

const STYLED_DOCUMENT_XML: &str = r#"<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr>
        <w:keepNext/>
        <w:keepLines/>
        <w:pageBreakBefore/>
        <w:widowControl w:val="0"/>
        <w:shd w:val="clear" w:color="auto" w:fill="D9D9D9"/>
        <w:tabs><w:tab w:val="left" w:pos="720"/><w:tab w:val="right" w:leader="dot" w:pos="9360"/></w:tabs>
        <w:spacing w:before="120" w:after="240"/>
        <w:ind w:left="720"/>
        <w:contextualSpacing/>
        <w:jc w:val="center"/>
      </w:pPr>
      <w:r><w:t>Styled text</w:t></w:r>
    </w:p>
    <w:sectPr/>
  </w:body>
</w:document>"#;

fn reserialized_document_xml(pkg: &OoxmlPackage) -> String {
    let mut model = build_doc_model(pkg);
    for node in &mut model.nodes {
        if let DocNode::Paragraph(paragraph) = node {
            paragraph.source_xml = None;
        }
    }
    let serialized = serialize_doc_model(&model, Some(pkg));
    serialized
        .parts
        .get("word/document.xml")
        .expect("document part")
        .content
        .clone()
}

#[test]
fn reserialized_paragraph_keeps_modeled_ppr_fields() {
    let pkg = package_with_parts(&[("word/document.xml", STYLED_DOCUMENT_XML)]);
    let document_xml = reserialized_document_xml(&pkg);

    assert!(document_xml.contains("<w:keepNext/>"));
    assert!(document_xml.contains("<w:keepLines/>"));
    assert!(document_xml.contains("<w:pageBreakBefore/>"));
    assert!(document_xml.contains(r#"<w:widowControl w:val="0"/>"#));
    assert!(document_xml.contains(r#"<w:shd w:val="clear" w:color="auto" w:fill="D9D9D9"/>"#));
    assert!(document_xml.contains(
        r#"<w:tabs><w:tab w:val="left" w:pos="720"/><w:tab w:val="right" w:leader="dot" w:pos="9360"/></w:tabs>"#
    ));
    assert!(document_xml.contains("<w:contextualSpacing/>"));
    assert!(document_xml.contains(r#"<w:jc w:val="center"/>"#));
}

#[test]
fn reserialized_ppr_children_follow_schema_order() {
    let pkg = package_with_parts(&[("word/document.xml", STYLED_DOCUMENT_XML)]);
    let document_xml = reserialized_document_xml(&pkg);

    let ppr_start = document_xml.find("<w:pPr>").expect("pPr present");
    let ppr_end = document_xml[ppr_start..]
        .find("</w:pPr>")
        .expect("pPr closed")
        + ppr_start;
    let ppr = &document_xml[ppr_start..ppr_end];

    let markers = [
        "<w:keepNext/>",
        "<w:keepLines/>",
        "<w:pageBreakBefore/>",
        "<w:widowControl",
        "<w:shd",
        "<w:tabs>",
        "<w:spacing",
        "<w:ind",
        "<w:contextualSpacing/>",
        "<w:jc",
    ];
    let positions = markers
        .iter()
        .map(|marker| ppr.find(marker).unwrap_or_else(|| panic!("missing {marker}")))
        .collect::<Vec<_>>();
    assert!(
        positions.windows(2).all(|pair| pair[0] < pair[1]),
        "pPr children out of schema order: {positions:?}"
    );
}

const HYPERLINK_DOCUMENT_XML: &str = r#"<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p>
      <w:hyperlink r:id="rId1"><w:r><w:t>link</w:t></w:r></w:hyperlink>
    </w:p>
    <w:sectPr/>
  </w:body>
</w:document>"#;

const HYPERLINK_RELS_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/a?b=1&amp;c=2" TargetMode="External"/></Relationships>"#;

#[test]
fn hyperlink_relationship_target_is_not_double_escaped() {
    let pkg = package_with_parts(&[
        ("word/document.xml", HYPERLINK_DOCUMENT_XML),
        ("word/_rels/document.xml.rels", HYPERLINK_RELS_XML),
    ]);
    let model = build_doc_model(&pkg);
    let serialized = serialize_doc_model(&model, Some(&pkg));

    let rels_xml = &serialized
        .parts
        .get("word/_rels/document.xml.rels")
        .expect("document rels part")
        .content;
    assert!(rels_xml.contains(r#"Target="https://example.com/a?b=1&amp;c=2""#));
    assert!(!rels_xml.contains("&amp;amp;"));
}
