use std::collections::HashMap;
use extend_docx::{build_doc_model, serialize_doc_model, DocNode, OoxmlPackage, OoxmlPart};

fn package(properties: &str) -> OoxmlPackage {
    let xml = format!(r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr><w:tr><w:tc><w:tcPr>{properties}</w:tcPr><w:p><w:r><w:t>Alpha Beta</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"#);
    OoxmlPackage {
        parts: HashMap::from([("word/document.xml".into(), OoxmlPart {
            name: "word/document.xml".into(), content: xml,
        })]),
        binary_assets: HashMap::new(), warnings: Vec::new(),
    }
}

#[test]
fn reads_direct_on_off_without_using_revision_properties() {
    for (property, expected) in [
        ("<w:noWrap/>", Some(true)),
        ("<w:noWrap w:val=\"0\"/>", Some(false)),
        ("<w:noWrap w:val=\"false\"/>", Some(false)),
        ("<w:noWrap w:val=\"on\"/>", Some(true)),
        ("", None),
        ("<w:tcPrChange><w:tcPr><w:noWrap/></w:tcPr></w:tcPrChange>", None),
    ] {
        let model = build_doc_model(&package(property));
        let DocNode::Table(table) = &model.nodes[0] else { panic!() };
        assert_eq!(table.rows[0].cells[0].style.as_ref().and_then(|s| s.no_wrap), expected);
        assert_eq!(table.rows[0].cells[0].style.as_ref().and_then(|s| s.source_no_wrap), expected);
    }
}

#[test]
fn edits_and_clears_survive_source_preserving_and_rebuilt_serialization() {
    for rebuild in [false, true] {
        for value in [Some(false), None, Some(true)] {
            let source = package(r#"<w:tcW w:w="4000" w:type="dxa"/><w:noWrap/><w:hideMark/>"#);
            let mut model = build_doc_model(&source);
            let DocNode::Table(table) = &mut model.nodes[0] else { panic!() };
            table.rows[0].cells[0].style.as_mut().unwrap().no_wrap = value;
            if rebuild { table.source_xml = None; }
            let output = serialize_doc_model(&model, Some(&source));
            let parsed = build_doc_model(&output);
            let DocNode::Table(table) = &parsed.nodes[0] else { panic!() };
            assert_eq!(table.rows[0].cells[0].style.as_ref().and_then(|s| s.no_wrap), value);
            if !rebuild { assert!(output.parts["word/document.xml"].content.contains("<w:hideMark/>")); }
        }
    }
}

#[test]
fn adds_property_to_an_imported_cell() {
    let source = package(r#"<w:tcW w:w="4000" w:type="dxa"/>"#);
    let mut model = build_doc_model(&source);
    let DocNode::Table(table) = &mut model.nodes[0] else { panic!() };
    table.rows[0].cells[0].style.as_mut().unwrap().no_wrap = Some(true);
    let parsed = build_doc_model(&serialize_doc_model(&model, Some(&source)));
    let DocNode::Table(table) = &parsed.nodes[0] else { panic!() };
    assert_eq!(table.rows[0].cells[0].style.as_ref().and_then(|s| s.no_wrap), Some(true));
}
