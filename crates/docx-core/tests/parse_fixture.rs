use std::fs;

use docx_core::{build_doc_model, parse_docx};

#[test]
fn parse_patient_original() {
    let path = "/Users/andrewluo/Documents/DOCX testing/patient_original (3).docx";
    let bytes = fs::read(path).expect("read file");
    let pkg = parse_docx(&bytes).expect("parse");
    let model = build_doc_model(&pkg);
    assert!(model.nodes.len() > 0);
}

#[test]
fn cherwell_header_table_vertical_merge_row_span() {
    let path = "/Users/andrewluo/Documents/DOCX testing/2026-03-24_16-06-44/f0283c5c3010513b4346ae6a37e1524366db5b0df948bf98467a7510639c97e6.docx";
    let bytes = fs::read(path).expect("read file");
    let model = build_doc_model(&parse_docx(&bytes).expect("parse"));
    let table = model
        .nodes
        .iter()
        .find_map(|node| match node {
            docx_core::model::DocNode::Table(table) => Some(table),
            _ => None,
        })
        .expect("header table");
    assert_eq!(
        table.rows[0].cells[0]
            .style
            .as_ref()
            .and_then(|style| style.row_span),
        Some(2)
    );
    assert_eq!(
        table.rows[0].cells[2]
            .style
            .as_ref()
            .and_then(|style| style.row_span),
        Some(2)
    );
}
