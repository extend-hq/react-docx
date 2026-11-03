use std::collections::HashMap;

use base64::Engine;
use extend_docx::{
    build_doc_model, extract_document_blocks, serialize_doc_model, DocModel, DocNode,
    FormFieldRunNode, OoxmlPackage, OoxmlPart, ParagraphChildNode, ParagraphNode,
    TableCellContentNode,
};

fn package(body: &str, checked: bool) -> OoxmlPackage {
    let mut parts = HashMap::new();
    let document = format!(
        r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml"><w:body>{body}</w:body></w:document>"#
    );
    for (name, content) in [
        ("word/document.xml", document.as_str()),
        (
            "[Content_Types].xml",
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="application/vnd.ms-office.activeX"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#,
        ),
        (
            "word/_rels/document.xml.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="control" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/control" Target="activeX/control.xml"/><Relationship Id="preview" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/preview.png"/><Relationship Id="decoy" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/decoy.png"/></Relationships>"#,
        ),
        (
            "word/activeX/control.xml",
            r#"<ax:ocx xmlns:ax="http://schemas.microsoft.com/office/2006/activeX" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="binary"/>"#,
        ),
        (
            "word/activeX/_rels/control.xml.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="binary" Type="http://schemas.microsoft.com/office/2006/relationships/activeXControlBinary" Target="control.bin"/></Relationships>"#,
        ),
    ] {
        parts.insert(
            name.into(),
            OoxmlPart {
                name: name.into(),
                content: content.into(),
            },
        );
    }
    let image = base64::engine::general_purpose::STANDARD
        .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2M4x8AAAAASUVORK5CYII=")
        .unwrap();
    let markup = format!(
        r#"<input type="checkbox" name="choice" {}>"#,
        if checked { "checked" } else { "" }
    );
    OoxmlPackage {
        parts,
        binary_assets: HashMap::from([
            ("word/activeX/control.bin".into(), markup.into_bytes()),
            ("word/media/preview.png".into(), image),
            ("word/media/decoy.png".into(), vec![1, 2, 3, 4]),
        ]),
        warnings: Vec::new(),
    }
}

fn shape(id: &str, relationship: &str) -> String {
    format!(
        r#"<v:shape id="{id}" style="width:18pt;height:12pt"><v:imagedata r:id="{relationship}"/></v:shape>"#
    )
}

fn run(shapes: &str, shape_id: &str) -> String {
    format!(
        r#"<w:r><w:object>{shapes}<w:control r:id="control" w:shapeid="{shape_id}"/></w:object></w:r>"#
    )
}

fn first_paragraph(model: &DocModel) -> &ParagraphNode {
    let DocNode::Paragraph(paragraph) = &model.nodes[0] else {
        panic!()
    };
    paragraph
}

fn paragraph_field(paragraph: &ParagraphNode) -> &FormFieldRunNode {
    let ParagraphChildNode::FormField(field) = &paragraph.children[0] else {
        panic!()
    };
    field
}

#[test]
fn matched_control_preview_keeps_one_semantic_field_and_original_payload() {
    for checked in [false, true] {
        let xml = run(
            &(shape("other", "decoy") + &shape("selected", "preview")),
            "selected",
        );
        let source = package(&format!("<w:p>{xml}</w:p>"), checked);
        let model = build_doc_model(&source);
        assert_eq!(first_paragraph(&model).children.len(), 1);
        let field = paragraph_field(first_paragraph(&model));
        let preview = field.source_preview.as_ref().unwrap();
        assert_eq!(field.checked, Some(checked));
        assert_eq!(preview.checked, checked);
        assert_eq!(preview.relationship_id, "control");
        assert_eq!(preview.shape_id, "selected");
        assert_eq!(
            preview.image.part_name.as_deref(),
            Some("word/media/preview.png")
        );
        assert_eq!(
            preview.image.data.as_ref(),
            source.binary_assets.get("word/media/preview.png")
        );
        assert_eq!(preview.image.width_px, Some(24.0));
        assert_eq!(preview.image.height_px, Some(16.0));
        assert_eq!(field.source_xml.as_deref(), Some(xml.as_str()));
        assert_eq!(
            extract_document_blocks(&model).blocks[0].content,
            if checked { "☒" } else { "☐" }
        );
    }
}

#[test]
fn preview_identity_is_scoped_to_its_object_and_ambiguity_falls_back() {
    let selected = shape("selected", "preview");
    let bodies = [
        run(&shape("other", "decoy"), "selected"),
        run(&(selected.clone() + &selected), "selected"),
        run(&format!("<v:group>{selected}</v:group>"), "selected"),
        format!("<w:r><w:object>{selected}</w:object><w:object><w:control r:id=\"control\" w:shapeid=\"selected\"/></w:object></w:r>"),
        run(&selected, ""),
    ];
    for body in bodies {
        let model = build_doc_model(&package(&format!("<w:p>{body}</w:p>"), true));
        let field = paragraph_field(first_paragraph(&model));
        assert_eq!(field.checked, Some(true));
        assert!(field.source_preview.is_none());
        assert!(field.source_xml.is_some());
    }
}

#[test]
fn unavailable_preview_payload_does_not_replace_control_semantics() {
    let xml = run(&shape("selected", "preview"), "selected");
    let mut source = package(&format!("<w:p>{xml}</w:p>"), false);
    source.binary_assets.remove("word/media/preview.png");
    let model = build_doc_model(&source);
    assert_eq!(
        paragraph_field(first_paragraph(&model)).checked,
        Some(false)
    );
    assert!(paragraph_field(first_paragraph(&model))
        .source_preview
        .is_none());
}

#[test]
fn preview_keeps_the_matched_shape_anchor() {
    let shape = r#"<v:shape id="selected" style="position:absolute;left:9pt;top:3pt;width:18pt;height:12pt;mso-position-horizontal-relative:page;z-index:2"><v:imagedata r:id="preview"/></v:shape>"#;
    let source = package(&format!("<w:p>{}</w:p>", run(shape, "selected")), false);
    let model = build_doc_model(&source);
    let preview = paragraph_field(first_paragraph(&model))
        .source_preview
        .as_ref()
        .unwrap();
    let floating = preview.image.floating.as_ref().unwrap();
    assert_eq!(floating.x_px, Some(12.0));
    assert_eq!(floating.y_px, Some(4.0));
    assert_eq!(floating.horizontal_relative_to.as_deref(), Some("page"));
    assert_eq!(floating.z_index, Some(2));
}

#[test]
fn bitmap_metafile_preview_renders_and_roundtrips_original_bytes() {
    let hex = "d7cdc69a0000000000000200020060000000000071570100090000034100000000002700000000000400000003010800050000000b0200000000050000000c02020002002700000040092000cc0000000000020002000000000028000000020000000200000001001800000000001000000000000000000000000000000000000000ff0000ffffff00000000ff00ff000000030000000000";
    let original: Vec<u8> = hex
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect();
    let xml = run(&shape("selected", "preview"), "selected");
    let mut source = package(&format!("<w:p>{xml}</w:p>"), false);
    source.parts.get_mut("[Content_Types].xml").unwrap().content =
        source.parts["[Content_Types].xml"].content.replace(
            "</Types>",
            "<Default Extension=\"wmf\" ContentType=\"image/x-wmf\"/></Types>",
        );
    let relationships = &mut source
        .parts
        .get_mut("word/_rels/document.xml.rels")
        .unwrap()
        .content;
    *relationships = relationships.replace("media/preview.png", "media/preview.wmf");
    source.binary_assets.remove("word/media/preview.png");
    source
        .binary_assets
        .insert("word/media/preview.wmf".into(), original.clone());
    let model = build_doc_model(&source);
    let preview = paragraph_field(first_paragraph(&model))
        .source_preview
        .as_ref()
        .unwrap();
    assert_eq!(
        preview.image.part_name.as_deref(),
        Some("word/media/preview.wmf")
    );
    assert_eq!(preview.image.data.as_deref(), Some(original.as_slice()));
    assert_eq!(preview.image.content_type.as_deref(), Some("image/svg+xml"));
    assert!(preview
        .image
        .src
        .as_deref()
        .unwrap()
        .starts_with("data:image/svg+xml;"));
    let exported = serialize_doc_model(&model, Some(&source));
    assert_eq!(exported.binary_assets, source.binary_assets);
    assert_eq!(
        extend_docx::parse::parse_part_relationships(&exported, "word/document.xml"),
        extend_docx::parse::parse_part_relationships(&source, "word/document.xml")
    );
    assert!(exported.parts["word/document.xml"].content.contains(&xml));
    assert_eq!(
        exported.parts["word/activeX/control.xml"],
        source.parts["word/activeX/control.xml"]
    );
    assert_eq!(
        exported.parts["word/activeX/_rels/control.xml.rels"],
        source.parts["word/activeX/_rels/control.xml.rels"]
    );
    assert_eq!(
        paragraph_field(first_paragraph(&build_doc_model(&exported))).source_preview,
        paragraph_field(first_paragraph(&model)).source_preview
    );
    let unsupported_bytes = source
        .binary_assets
        .get_mut("word/media/preview.wmf")
        .unwrap();
    unsupported_bytes[44] = 0xff;
    unsupported_bytes[45] = 0x7f;
    let unsupported = build_doc_model(&source);
    let field = paragraph_field(first_paragraph(&unsupported));
    assert_eq!(field.checked, Some(false));
    assert!(field.source_preview.is_none());
    assert!(field.source_xml.is_some());
}

#[test]
fn preview_json_is_optional_and_clone_owns_its_payload() {
    let xml = run(&shape("selected", "preview"), "selected");
    let model = build_doc_model(&package(&format!("<w:p>{xml}</w:p>"), true));
    let original = paragraph_field(first_paragraph(&model));
    let json = serde_json::to_value(original).unwrap();
    assert_eq!(json["sourcePreview"]["shapeId"], "selected");
    assert_eq!(json["sourcePreview"]["image"]["type"], "image");
    let mut without_preview = json;
    without_preview
        .as_object_mut()
        .unwrap()
        .remove("sourcePreview");
    let older: FormFieldRunNode = serde_json::from_value(without_preview).unwrap();
    assert!(older.source_preview.is_none());
    assert!(serde_json::to_value(older)
        .unwrap()
        .get("sourcePreview")
        .is_none());
    let mut cloned = original.clone();
    cloned
        .source_preview
        .as_mut()
        .unwrap()
        .image
        .data
        .as_mut()
        .unwrap()[0] = 0;
    assert_eq!(
        original
            .source_preview
            .as_ref()
            .unwrap()
            .image
            .data
            .as_ref()
            .unwrap()[0],
        137
    );
}

#[test]
fn unchanged_export_preserves_control_markup_relationships_and_bytes() {
    let xml = run(&shape("selected", "preview"), "selected");
    let source = package(&format!("<w:p>{xml}</w:p>"), true);
    let model = build_doc_model(&source);
    let exported = serialize_doc_model(&model, Some(&source));
    assert!(exported.parts["word/document.xml"].content.contains(&xml));
    assert_eq!(exported.binary_assets, source.binary_assets);
    assert_eq!(
        extend_docx::parse::parse_part_relationships(&exported, "word/document.xml"),
        extend_docx::parse::parse_part_relationships(&source, "word/document.xml")
    );
    for name in [
        "word/activeX/control.xml",
        "word/activeX/_rels/control.xml.rels",
    ] {
        assert_eq!(exported.parts[name].content, source.parts[name].content);
    }
    assert_eq!(
        paragraph_field(first_paragraph(&build_doc_model(&exported))).source_preview,
        paragraph_field(first_paragraph(&model)).source_preview
    );
}

#[test]
fn source_preview_does_not_change_structured_semantic_blocks() {
    let xml = run(&shape("selected", "preview"), "selected");
    let model = build_doc_model(&package(&format!("<w:p>{xml}</w:p>"), true));
    let mut semantic_model = model.clone();
    let DocNode::Paragraph(paragraph) = &mut semantic_model.nodes[0] else {
        panic!()
    };
    let ParagraphChildNode::FormField(field) = &mut paragraph.children[0] else {
        panic!()
    };
    assert!(field.source_preview.take().is_some());
    assert_eq!(
        serde_json::to_value(extract_document_blocks(&model)).unwrap(),
        serde_json::to_value(extract_document_blocks(&semantic_model)).unwrap()
    );
}

#[test]
fn changed_state_bypasses_retained_paragraph_and_field_markup() {
    let xml = run(&shape("selected", "preview"), "selected");
    let source = package(&format!("<w:p>{xml}</w:p>"), true);
    let mut model = build_doc_model(&source);
    let DocNode::Paragraph(paragraph) = &mut model.nodes[0] else {
        panic!()
    };
    assert!(paragraph.source_xml.is_some());
    let ParagraphChildNode::FormField(field) = &mut paragraph.children[0] else {
        panic!()
    };
    field.checked = Some(false);
    assert!(field.source_xml.is_some() && field.source_preview.is_some());
    let exported = serialize_doc_model(&model, Some(&source));
    assert!(!exported.parts["word/document.xml"]
        .content
        .contains("<w:control"));
    let rebuilt = build_doc_model(&exported);
    assert_eq!(
        paragraph_field(first_paragraph(&rebuilt)).checked,
        Some(false)
    );
    assert!(paragraph_field(first_paragraph(&rebuilt))
        .source_preview
        .is_none());
}

#[test]
fn cleared_field_markup_bypasses_retained_paragraph_markup() {
    let xml = run(&shape("selected", "preview"), "selected");
    let source = package(&format!("<w:p>{xml}</w:p>"), true);
    let mut model = build_doc_model(&source);
    let DocNode::Paragraph(paragraph) = &mut model.nodes[0] else {
        panic!()
    };
    let ParagraphChildNode::FormField(field) = &mut paragraph.children[0] else {
        panic!()
    };
    field.source_xml = None;
    let exported = serialize_doc_model(&model, Some(&source));
    assert!(!exported.parts["word/document.xml"]
        .content
        .contains("<w:control"));
    assert_eq!(
        paragraph_field(first_paragraph(&build_doc_model(&exported))).checked,
        Some(true)
    );
}

#[test]
fn changed_nested_control_bypasses_all_retained_table_markup() {
    let xml = run(&shape("selected", "preview"), "selected");
    let table = |inside: &str| {
        format!("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc>{inside}</w:tc></w:tr></w:tbl>")
    };
    let source = package(&table(&table(&format!("<w:p>{xml}</w:p>"))), true);
    let mut model = build_doc_model(&source);
    let DocNode::Table(outer) = &mut model.nodes[0] else {
        panic!()
    };
    assert!(outer.source_xml.is_some());
    let TableCellContentNode::Table(inner) = &mut outer.rows[0].cells[0].nodes[0] else {
        panic!()
    };
    assert!(inner.source_xml.is_some());
    let TableCellContentNode::Paragraph(paragraph) = &mut inner.rows[0].cells[0].nodes[0] else {
        panic!()
    };
    let ParagraphChildNode::FormField(field) = &mut paragraph.children[0] else {
        panic!()
    };
    field.checked = Some(false);
    let exported = serialize_doc_model(&model, Some(&source));
    assert!(!exported.parts["word/document.xml"]
        .content
        .contains("<w:control"));
    let rebuilt = build_doc_model(&exported);
    let DocNode::Table(outer) = &rebuilt.nodes[0] else {
        panic!()
    };
    let TableCellContentNode::Table(inner) = &outer.rows[0].cells[0].nodes[0] else {
        panic!()
    };
    let TableCellContentNode::Paragraph(paragraph) = &inner.rows[0].cells[0].nodes[0] else {
        panic!()
    };
    assert_eq!(paragraph_field(paragraph).checked, Some(false));
}
