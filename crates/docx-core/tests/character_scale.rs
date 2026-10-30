use docx_core::{
    build_doc_model, extract_document_blocks_with_options, serialize_doc_model, DocNode,
    ExtractDocumentBlocksOptions, OoxmlPackage, OoxmlPart, ParagraphChildNode,
};
use std::collections::HashMap;

fn package(body: &str, styles: &str) -> OoxmlPackage {
    let xml = format!(
        r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}</w:body></w:document>"#
    );
    let parts = [
        ("word/document.xml", xml.as_str()),
        ("word/styles.xml", styles),
    ]
    .into_iter()
    .map(|(name, content)| {
        (
            name.into(),
            OoxmlPart {
                name: name.into(),
                content: content.into(),
            },
        )
    })
    .collect();
    OoxmlPackage {
        parts,
        binary_assets: HashMap::new(),
        warnings: Vec::new(),
    }
}

#[test]
fn scale_retains_content_word_ranges_and_structured_style() {
    let source = package(
        r#"<w:p><w:r><w:rPr><w:w w:val="150"/></w:rPr><w:t>a😀b</w:t></w:r></w:p>"#,
        "",
    );
    let model = build_doc_model(&source);
    let output = extract_document_blocks_with_options(
        &model,
        ExtractDocumentBlocksOptions {
            include_words: true,
        },
    );
    let block = &output.blocks[0];
    let details = block.details.to_json_value();
    assert_eq!(block.content, "a😀b");
    assert_eq!(details["inlines"][0]["end"], 4);
    assert_eq!(details["inlines"][0]["style"]["characterScalePercent"], 150);
    let units: Vec<_> = block.content.encode_utf16().collect();
    for word in block.words.as_ref().unwrap() {
        let reference = &word.source_refs[0];
        assert_eq!(
            String::from_utf16(&units[reference.start.unwrap()..reference.end.unwrap()]).unwrap(),
            word.content
        );
    }
    let mut normal = model.clone();
    let DocNode::Paragraph(p) = &mut normal.nodes[0] else {
        panic!()
    };
    let ParagraphChildNode::Text(run) = &mut p.children[0] else {
        panic!()
    };
    run.style.as_mut().unwrap().character_scale_percent = Some(100);
    let normal_output = extract_document_blocks_with_options(
        &normal,
        ExtractDocumentBlocksOptions {
            include_words: true,
        },
    );
    assert_eq!(normal_output.blocks[0].words, block.words);
    assert_eq!(output.geometry_status, "requires_layout");
}

#[test]
fn scale_inheritance_and_explicit_reset_survive_rebuild() {
    let source = package(
        r#"<w:p><w:pPr><w:pStyle w:val="Wide"/></w:pPr><w:r><w:t>Inherited</w:t></w:r><w:r><w:rPr><w:w w:val="100"/></w:rPr><w:t>Reset</w:t></w:r></w:p>"#,
        r#"<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Wide"><w:name w:val="Wide"/><w:rPr><w:w w:val="150"/></w:rPr></w:style></w:styles>"#,
    );
    let mut model = build_doc_model(&source);
    let output =
        extract_document_blocks_with_options(&model, ExtractDocumentBlocksOptions::default());
    let details = output.blocks[0].details.to_json_value();
    assert_eq!(details["inlines"][0]["style"]["characterScalePercent"], 150);
    assert_eq!(details["inlines"][1]["style"]["characterScalePercent"], 100);
    let DocNode::Paragraph(p) = &mut model.nodes[0] else {
        panic!()
    };
    p.source_xml = None;
    let rebuilt = build_doc_model(&serialize_doc_model(&model, Some(&source)));
    assert_eq!(
        extract_document_blocks_with_options(&rebuilt, ExtractDocumentBlocksOptions::default())
            .blocks[0]
            .details
            .to_json_value()["inlines"],
        details["inlines"]
    );
}

#[test]
fn paragraph_mark_scale_edit_replaces_the_source_property() {
    let source = package(
        r#"<w:p><w:pPr><w:rPr><w:w w:val="150"/></w:rPr></w:pPr></w:p>"#,
        "",
    );
    let mut model = build_doc_model(&source);
    let DocNode::Paragraph(p) = &mut model.nodes[0] else {
        panic!()
    };
    p.paragraph_mark_style
        .as_mut()
        .unwrap()
        .character_scale_percent = Some(75);
    let rebuilt = build_doc_model(&serialize_doc_model(&model, Some(&source)));
    let DocNode::Paragraph(p) = &rebuilt.nodes[0] else {
        panic!()
    };
    assert_eq!(
        p.paragraph_mark_style
            .as_ref()
            .unwrap()
            .character_scale_percent,
        Some(75)
    );
}

#[test]
fn standard_scale_range_and_lexical_forms_are_preserved() {
    for (value, expected) in [
        ("1", Some(1)),
        ("100", Some(100)),
        ("600", Some(600)),
        ("0", Some(0)),
        ("0%", Some(0)),
        ("150%", Some(150)),
        ("+150", Some(150)),
        ("-0", Some(0)),
        ("000000000000000000000150%", Some(150)),
        ("601", None),
        ("1.5", None),
        ("150.5%", None),
        ("+150%", None),
    ] {
        let source = package(
            &format!(
                r#"<w:p><w:r><w:rPr><w:w w:val="{value}"/></w:rPr><w:t>Text</w:t></w:r></w:p>"#
            ),
            "",
        );
        let model = build_doc_model(&source);
        let DocNode::Paragraph(p) = &model.nodes[0] else {
            panic!()
        };
        let ParagraphChildNode::Text(run) = &p.children[0] else {
            panic!()
        };
        assert_eq!(
            run.style
                .as_ref()
                .and_then(|style| style.character_scale_percent),
            expected
        );
        assert_eq!(
            run.style
                .as_ref()
                .and_then(|style| style.source_character_scale.as_deref()),
            Some(value)
        );
    }
}

#[test]
fn raw_scale_survives_reconstruction_until_explicitly_replaced() {
    for value in ["0", "150%", "000150", "601", "1.5"] {
        let source = package(
            &format!(
                r#"<w:p><w:r><w:rPr><w:w w:val="{value}"/></w:rPr><w:t>Text</w:t></w:r></w:p>"#
            ),
            "",
        );
        let mut model = build_doc_model(&source);
        let DocNode::Paragraph(p) = &mut model.nodes[0] else {
            panic!()
        };
        p.source_xml = None;
        let serialized = serialize_doc_model(&model, Some(&source));
        assert!(serialized.parts["word/document.xml"]
            .content
            .contains(&format!(r#"<w:w w:val="{value}"/>"#)));
        let DocNode::Paragraph(p) = &mut model.nodes[0] else {
            panic!()
        };
        let ParagraphChildNode::Text(run) = &mut p.children[0] else {
            panic!()
        };
        run.style.as_mut().unwrap().character_scale_percent = Some(75);
        let serialized = serialize_doc_model(&model, Some(&source));
        assert!(serialized.parts["word/document.xml"]
            .content
            .contains(r#"<w:w w:val="75"/>"#));
    }
}

#[test]
fn missing_attribute_has_standard_default_without_overriding_omitted_property() {
    let source = package(
        r#"<w:p><w:pPr><w:pStyle w:val="Wide"/></w:pPr><w:r><w:t>Inherited</w:t></w:r><w:r><w:rPr><w:w/></w:rPr><w:t>Reset</w:t></w:r></w:p>"#,
        r#"<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Wide"><w:rPr><w:w w:val="150"/></w:rPr></w:style></w:styles>"#,
    );
    let model = build_doc_model(&source);
    let DocNode::Paragraph(p) = &model.nodes[0] else {
        panic!()
    };
    for (index, expected) in [(0, 150), (1, 100)] {
        let ParagraphChildNode::Text(run) = &p.children[index] else {
            panic!()
        };
        assert_eq!(
            run.style
                .as_ref()
                .and_then(|style| style.character_scale_percent),
            Some(expected)
        );
    }
}
