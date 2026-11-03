use std::collections::HashMap;

use extend_docx::model::{DocModel, ParagraphNode, TableCellContentNode};
use extend_docx::{build_doc_model, OoxmlPackage, OoxmlPart};

fn build_package(document_xml: &str, styles_xml: &str) -> OoxmlPackage {
    let mut parts = HashMap::new();
    parts.insert(
        "word/document.xml".to_string(),
        OoxmlPart {
            name: "word/document.xml".to_string(),
            content: document_xml.to_string(),
        },
    );
    parts.insert(
        "word/styles.xml".to_string(),
        OoxmlPart {
            name: "word/styles.xml".to_string(),
            content: styles_xml.to_string(),
        },
    );
    OoxmlPackage {
        parts,
        binary_assets: HashMap::new(),
        warnings: Vec::new(),
    }
}

const STYLES_XML: &str = r#"<?xml version="1.0"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/></w:style>
  <w:style w:type="table" w:styleId="TableGrid0">
    <w:name w:val="Table Grid"/>
    <w:basedOn w:val="TableNormal"/>
    <w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>
  </w:style>
</w:styles>"#;

const DOCUMENT_XML: &str = r#"<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Body paragraph</w:t></w:r></w:p>
    <w:tbl>
      <w:tblPr><w:tblStyle w:val="TableGrid0"/></w:tblPr>
      <w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>
      <w:tr><w:tc><w:p><w:r><w:t>Cell paragraph</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
    <w:tbl>
      <w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>
      <w:tr><w:tc><w:p><w:r><w:t>Unstyled table cell</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
    <w:sectPr/>
  </w:body>
</w:document>"#;

fn first_cell_paragraph(model: &DocModel, table_index: usize) -> &ParagraphNode {
    let mut seen = 0usize;
    for node in &model.nodes {
        if let extend_docx::model::DocNode::Table(table) = node {
            if seen == table_index {
                let cell = &table.rows[0].cells[0];
                let TableCellContentNode::Paragraph(paragraph) = &cell.nodes[0] else {
                    panic!("expected paragraph cell content");
                };
                return paragraph;
            }
            seen += 1;
        }
    }
    panic!("table {table_index} not found");
}

/// ECMA-376 layers table-style paragraph properties (the table style's own
/// w:pPr) between document defaults and paragraph styles: a `Table Grid`
/// style with spacing after=0/line=240 must override docDefaults'
/// after=160/line=259 for every paragraph inside the table, while body
/// paragraphs keep the document defaults.
#[test]
fn table_style_paragraph_spacing_overrides_doc_defaults_in_cells() {
    let model = build_doc_model(&build_package(DOCUMENT_XML, STYLES_XML));

    let body_paragraph = model
        .nodes
        .iter()
        .find_map(|node| match node {
            extend_docx::model::DocNode::Paragraph(paragraph) => Some(paragraph),
            _ => None,
        })
        .expect("body paragraph");
    let body_spacing = body_paragraph
        .style
        .as_ref()
        .and_then(|style| style.spacing.as_ref())
        .expect("body spacing");
    assert_eq!(body_spacing.after_twips, Some(160));
    assert_eq!(body_spacing.line_twips, Some(259));

    let styled_cell_paragraph = first_cell_paragraph(&model, 0);
    let styled_spacing = styled_cell_paragraph
        .style
        .as_ref()
        .and_then(|style| style.spacing.as_ref())
        .expect("styled cell spacing");
    assert_eq!(styled_spacing.after_twips, Some(0));
    assert_eq!(styled_spacing.line_twips, Some(240));

    // A default table style without paragraph spacing keeps document defaults.
    let unstyled_cell_paragraph = first_cell_paragraph(&model, 1);
    let unstyled_spacing = unstyled_cell_paragraph
        .style
        .as_ref()
        .and_then(|style| style.spacing.as_ref())
        .expect("unstyled cell spacing");
    assert_eq!(unstyled_spacing.after_twips, Some(160));
    assert_eq!(unstyled_spacing.line_twips, Some(259));
}

#[test]
fn declared_default_table_style_resolves_properties_without_adding_style_reference() {
    for default_value in ["1", "true", "on"] {
        let styles_xml = STYLES_XML.replace(
            r#"<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/></w:style>"#,
            &format!(r#"<w:style w:type="table" w:default="{default_value}" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>"#),
        );
        let package = build_package(DOCUMENT_XML, &styles_xml);
        let model = build_doc_model(&package);
        let extend_docx::model::DocNode::Table(table) = &model.nodes[2] else {
            panic!("expected table");
        };
        let style = table.style.as_ref().expect("table properties");
        assert_eq!(style.style_id, None);
        assert_eq!(style.source_style_id, None);
        let margins = style.cell_margin_twips.as_ref().expect("default margins");
        assert_eq!(margins.top_twips, Some(0));
        assert_eq!(margins.bottom_twips, Some(0));
        assert_eq!(margins.left_twips, Some(108));
        assert_eq!(margins.right_twips, Some(108));
        let spacing = first_cell_paragraph(&model, 1)
            .style.as_ref().and_then(|style| style.spacing.as_ref()).expect("spacing");
        assert_eq!(spacing.after_twips, Some(0));
        assert_eq!(spacing.line_twips, Some(240));
        let exported = extend_docx::serialize_doc_model(&model, Some(&package));
        let reparsed = build_doc_model(&exported);
        let extend_docx::model::DocNode::Table(reparsed_table) = &reparsed.nodes[2] else {
            panic!("expected table");
        };
        assert_eq!(reparsed_table.source_xml, table.source_xml);
        assert_eq!(reparsed_table.style.as_ref().unwrap().style_id, None);
    }
}

#[test]
fn explicit_table_reference_and_direct_properties_take_precedence_over_default() {
    let styles = STYLES_XML.replace(
        r#"<w:name w:val="Normal Table"/></w:style>"#,
        r#"<w:name w:val="Normal Table"/><w:tblPr><w:tblCellMar><w:top w:w="240" w:type="dxa"/><w:bottom w:w="240" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>"#,
    );
    for (properties, expected_top, expected_bottom) in [
        (r#"<w:tblStyle w:val="Missing"/>"#, None, None),
        (r#"<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar>"#, Some(0), Some(0)),
    ] {
        let document = format!(r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tblPr>{properties}</w:tblPr><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl></w:body></w:document>"#);
        let model = build_doc_model(&build_package(&document, &styles));
        let extend_docx::model::DocNode::Table(table) = &model.nodes[0] else {
            panic!("expected table");
        };
        let margins = table.style.as_ref().and_then(|style| style.cell_margin_twips.as_ref());
        assert_eq!(margins.and_then(|margins| margins.top_twips), expected_top);
        assert_eq!(margins.and_then(|margins| margins.bottom_twips), expected_bottom);
    }
}
