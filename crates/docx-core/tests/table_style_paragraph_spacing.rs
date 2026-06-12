use std::collections::HashMap;

use docx_core::model::{DocModel, ParagraphNode, TableCellContentNode};
use docx_core::{build_doc_model, OoxmlPackage, OoxmlPart};

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
        if let docx_core::model::DocNode::Table(table) = node {
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
            docx_core::model::DocNode::Paragraph(paragraph) => Some(paragraph),
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

    // A table without a tblStyle keeps the document defaults.
    let unstyled_cell_paragraph = first_cell_paragraph(&model, 1);
    let unstyled_spacing = unstyled_cell_paragraph
        .style
        .as_ref()
        .and_then(|style| style.spacing.as_ref())
        .expect("unstyled cell spacing");
    assert_eq!(unstyled_spacing.after_twips, Some(160));
    assert_eq!(unstyled_spacing.line_twips, Some(259));
}
