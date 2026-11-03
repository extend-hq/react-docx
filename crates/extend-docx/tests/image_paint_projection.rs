use extend_docx::{
    build_doc_model, create_minimal_docx_package, extract_document_blocks, DocModel, DocNode,
    ImageRunNode, ParagraphChildNode, StructuredDocument,
};
use serde_json::{json, Value};

fn model(paint_bounds: Option<Value>) -> DocModel {
    let mut image = json!({
        "type": "image", "src": "data:image/svg+xml,%3Csvg%2F%3E",
        "widthPx": 360.0, "heightPx": 140.0, "alt": "image"
    });
    if let Some(bounds) = paint_bounds {
        image["paintBounds"] = bounds;
    }
    let image: ImageRunNode = serde_json::from_value(image).unwrap();
    let package = create_minimal_docx_package(Some(
        r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>text</w:t></w:r></w:p></w:body></w:document>"#,
    ));
    let mut model = build_doc_model(&package);
    let DocNode::Paragraph(paragraph) = &mut model.nodes[0] else { panic!() };
    paragraph.children.push(ParagraphChildNode::Image(Box::new(image)));
    model
}

fn bounds() -> Value {
    json!({
        "xPx": -0.5, "yPx": -2.0, "widthPx": 361.0, "heightPx": 144.0,
        "layoutWidthPx": 360.0, "layoutHeightPx": 140.0
    })
}

#[test]
fn paint_bounds_survive_model_and_structured_round_trips() {
    let model = model(Some(bounds()));
    let value = serde_json::to_value(&model).unwrap();
    let restored: DocModel = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(&restored).unwrap(), value);
    let blocks = extract_document_blocks(&restored);
    let value = serde_json::to_value(&blocks).unwrap();
    let details = &value["blocks"][0]["children"][0]["details"];
    assert_eq!(details["width"], 360.0);
    assert_eq!(details["height"], 140.0);
    assert_eq!(details["paintBounds"], bounds());
    let restored: StructuredDocument = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(&restored).unwrap(), value);
}

#[test]
fn absent_paint_bounds_keep_model_and_structured_json_unchanged() {
    let plain = model(None);
    let painted = model(Some(bounds()));
    let plain_value = serde_json::to_value(&plain).unwrap();
    let mut painted_value = serde_json::to_value(&painted).unwrap();
    assert!(plain_value["nodes"][0]["children"][1].get("paintBounds").is_none());
    painted_value["nodes"][0]["children"][1].as_object_mut().unwrap().remove("paintBounds");
    assert_eq!(painted_value, plain_value);
    let plain_blocks = serde_json::to_value(extract_document_blocks(&plain)).unwrap();
    let mut painted_blocks = serde_json::to_value(extract_document_blocks(&painted)).unwrap();
    assert!(plain_blocks["blocks"][0]["children"][0]["details"].get("paintBounds").is_none());
    painted_blocks["blocks"][0]["children"][0]["details"].as_object_mut().unwrap().remove("paintBounds");
    assert_eq!(painted_blocks, plain_blocks);
}
