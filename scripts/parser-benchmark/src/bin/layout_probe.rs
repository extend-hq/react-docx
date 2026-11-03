use std::mem::{align_of, size_of};

fn formatting_diagnostics() -> serde_json::Value {
    let xml = r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/><w:rFonts w:ascii="serif"/></w:rPr><w:t>First</w:t></w:r><w:r><w:rPr><w:b/><w:rFonts w:ascii="serif"/></w:rPr><w:t>Second</w:t></w:r></w:p></w:body></w:document>"#;
    let package = extend_docx::create_minimal_docx_package(Some(xml));
    let mut model = extend_docx::build_doc_model(&package);
    let blocks = extend_docx::extract_document_blocks(&model);
    let block_json = serde_json::to_value(&blocks).unwrap();
    let round_trip: extend_docx::StructuredDocument =
        serde_json::from_value(block_json.clone()).unwrap();
    let typed_raw_round_trip =
        round_trip == blocks && serde_json::to_value(&round_trip).unwrap() == block_json;
    let mut extended = block_json.clone();
    extended["blocks"][0]["details"]["extension"] =
        serde_json::json!({"nested": [null, true, {"value": 7}]});
    let imported: extend_docx::StructuredDocument = serde_json::from_value(extended.clone()).unwrap();
    let imported_extensions_retained = serde_json::to_value(imported).unwrap() == extended;
    let extend_docx::DocNode::Paragraph(paragraph) = &mut model.nodes[0] else {
        panic!("expected paragraph");
    };
    let extend_docx::ParagraphChildNode::Text(first) = &paragraph.children[0] else {
        panic!("expected text");
    };
    let extend_docx::ParagraphChildNode::Text(second) = &paragraph.children[1] else {
        panic!("expected text");
    };
    let first_style = first.style.as_deref().unwrap();
    let second_style = second.style.as_deref().unwrap();
    let source_style = paragraph.source_run_provenance.as_ref().unwrap().runs[0]
        .style
        .as_deref()
        .unwrap();
    let shared_between_runs = std::ptr::eq(first_style, second_style);
    let shared_with_provenance = std::ptr::eq(first_style, source_style);
    let transparent_json = serde_json::to_value(first.style.as_ref().unwrap()).unwrap()
        == serde_json::to_value(first_style).unwrap();
    let original_style = serde_json::to_value(first_style).unwrap();
    let original_provenance = serde_json::to_value(&paragraph.source_run_provenance).unwrap();
    let extend_docx::ParagraphChildNode::Text(first) = &mut paragraph.children[0] else {
        unreachable!();
    };
    let style = first.style.as_mut().unwrap();
    style.bold = Some(false);
    style.font_family = Some("monospace".into());
    let changed_style = serde_json::to_value(style).unwrap();
    let extend_docx::ParagraphChildNode::Text(second) = &paragraph.children[1] else {
        unreachable!();
    };
    let sibling_unchanged =
        serde_json::to_value(second.style.as_ref().unwrap()).unwrap() == original_style;
    let provenance_unchanged =
        serde_json::to_value(&paragraph.source_run_provenance).unwrap() == original_provenance;
    let structured_style_unchanged = serde_json::to_value(&blocks).unwrap() == block_json;
    let mutation_applied =
        changed_style["bold"] == false && changed_style["fontFamily"] == "monospace";
    assert!(shared_between_runs && shared_with_provenance && transparent_json);
    assert!(sibling_unchanged && provenance_unchanged && mutation_applied);
    assert!(typed_raw_round_trip && imported_extensions_retained && structured_style_unchanged);
    serde_json::json!({
        "shared_between_runs": shared_between_runs,
        "shared_with_provenance": shared_with_provenance,
        "transparent_json": transparent_json,
        "sibling_unchanged_after_mutation": sibling_unchanged,
        "provenance_unchanged_after_mutation": provenance_unchanged,
        "mutation_applied": mutation_applied,
        "typed_raw_round_trip": typed_raw_round_trip,
        "imported_extensions_retained": imported_extensions_retained,
        "structured_style_unchanged_after_mutation": structured_style_unchanged,
    })
}

fn main() {
    let mut sizes = serde_json::Map::new();
    macro_rules! record {
        ($name:literal, $ty:ty) => {
            sizes.insert($name.into(), serde_json::json!({
                "bytes": size_of::<$ty>(),
                "alignment": align_of::<$ty>(),
            }));
        };
    }
    record!("core.TextStyle", extend_docx::TextStyle);
    record!("core.TextRunNode", extend_docx::TextRunNode);
    record!("core.ImageRunNode", extend_docx::ImageRunNode);
    record!("core.FormFieldRunNode", extend_docx::FormFieldRunNode);
    record!("core.ParagraphChildNode", extend_docx::ParagraphChildNode);
    record!("core.ParagraphNode", extend_docx::ParagraphNode);
    record!("core.TableNode", extend_docx::TableNode);
    record!("core.DocNode", extend_docx::DocNode);
    record!(
        "core.ParagraphSourceTextPatchRun",
        extend_docx::ParagraphSourceTextPatchRun
    );
    record!("oxide.RunProperties", office_oxide::docx::RunProperties);
    record!("oxide.Run", office_oxide::docx::Run);
    record!("oxide.RunContent", office_oxide::docx::RunContent);
    record!("oxide.Paragraph", office_oxide::docx::Paragraph);
    record!("oxide.BlockElement", office_oxide::docx::BlockElement);
    record!("undoc.TextStyle", undoc::model::TextStyle);
    record!("undoc.TextRun", undoc::model::TextRun);
    record!("undoc.Paragraph", undoc::model::Paragraph);
    sizes.insert("formatting_diagnostics".into(), formatting_diagnostics());
    println!("{}", serde_json::Value::Object(sizes));
}
