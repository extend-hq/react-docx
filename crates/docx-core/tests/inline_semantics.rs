use std::collections::HashMap;

use docx_core::{
    build_doc_model, extract_document_blocks, serialize_doc_model, DocNode, OoxmlPackage,
    OoxmlPart, ParagraphChildNode,
};

fn package(body: &str, styles: &str) -> OoxmlPackage {
    let document = format!(
        r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>{body}</w:body></w:document>"#
    );
    let mut parts = HashMap::new();
    for (name, content) in [
        ("word/document.xml", document.as_str()),
        ("word/styles.xml", styles),
        (
            "word/_rels/document.xml.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="link" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.org/doc#old" TargetMode="External"/></Relationships>"#,
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
    OoxmlPackage {
        parts,
        binary_assets: HashMap::new(),
        warnings: Vec::new(),
    }
}

#[test]
fn capitalization_preserves_text_and_survives_rebuild() {
    let source = package(
        r#"<w:p><w:r><w:rPr><w:caps/></w:rPr><w:t>aß😀</w:t></w:r><w:r><w:rPr><w:smallCaps/></w:rPr><w:t>Mixed</w:t></w:r></w:p>"#,
        "",
    );
    let mut model = build_doc_model(&source);
    let blocks = extract_document_blocks(&model);
    let details = blocks.blocks[0].details.to_json_value();
    assert_eq!(blocks.blocks[0].content, "aß😀Mixed");
    assert_eq!(details["inlines"][0]["end"], 4);
    assert_eq!(details["inlines"][0]["style"]["allCaps"], true);
    assert_eq!(details["inlines"][1]["style"]["smallCaps"], true);
    let DocNode::Paragraph(p) = &mut model.nodes[0] else {
        panic!()
    };
    p.source_xml = None;
    let reparsed = build_doc_model(&serialize_doc_model(&model, Some(&source)));
    assert_eq!(
        extract_document_blocks(&reparsed).blocks[0]
            .details
            .to_json_value()["inlines"],
        details["inlines"]
    );
}

#[test]
fn capitalization_direct_false_overrides_inherited_true() {
    let source = package(
        r#"<w:p><w:pPr><w:pStyle w:val="Upper"/></w:pPr><w:r><w:t>Inherited</w:t></w:r><w:r><w:rPr><w:caps w:val="0"/><w:smallCaps w:val="0"/></w:rPr><w:t>Direct</w:t></w:r></w:p>"#,
        r#"<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Upper"><w:name w:val="Upper"/><w:rPr><w:caps/><w:smallCaps/></w:rPr></w:style></w:styles>"#,
    );
    let mut model = build_doc_model(&source);
    let blocks = extract_document_blocks(&model);
    let details = blocks.blocks[0].details.to_json_value();
    assert_eq!(details["inlines"][0]["style"]["allCaps"], true);
    assert_eq!(details["inlines"][1]["style"]["allCaps"], false);
    assert_eq!(details["inlines"][1]["style"]["smallCaps"], false);
    let DocNode::Paragraph(p) = &mut model.nodes[0] else {
        panic!()
    };
    p.source_xml = None;
    let reparsed = build_doc_model(&serialize_doc_model(&model, Some(&source)));
    assert_eq!(
        extract_document_blocks(&reparsed).blocks[0]
            .details
            .to_json_value()["inlines"][1]["style"]["allCaps"],
        false
    );
}

#[test]
fn paragraph_mark_capitalization_edits_replace_source_properties() {
    let source = package(
        r#"<w:p><w:pPr><w:rPr><w:caps/><w:smallCaps/></w:rPr></w:pPr></w:p>"#,
        "",
    );
    let mut model = build_doc_model(&source);
    let DocNode::Paragraph(p) = &mut model.nodes[0] else {
        panic!()
    };
    let style = p.paragraph_mark_style.as_mut().unwrap();
    style.all_caps = Some(false);
    style.small_caps = Some(false);
    let serialized = serialize_doc_model(&model, Some(&source));
    let xml = &serialized.parts["word/document.xml"].content;
    assert_eq!(xml.matches("<w:caps").count(), 1);
    assert!(!xml.contains("<w:caps/>"));
    assert!(!xml.contains("<w:smallCaps/>"));
    let model = build_doc_model(&serialized);
    let DocNode::Paragraph(p) = &model.nodes[0] else {
        panic!()
    };
    assert_eq!(
        p.paragraph_mark_style.as_ref().unwrap().all_caps,
        Some(false)
    );
    assert_eq!(
        p.paragraph_mark_style.as_ref().unwrap().small_caps,
        Some(false)
    );
}

#[test]
fn hyperlink_fields_keep_nested_scopes_and_concatenate_instructions() {
    let source = package(
        r#"<w:p><w:hyperlink r:id="link" w:anchor="new"><w:r><w:t>A</w:t></w:r></w:hyperlink><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>HYPER</w:instrText></w:r><w:r><w:instrText>LINK \l bookmark</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>B</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>HYPERLINK "https://example.org/inner"</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>C</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t>D</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t>E</w:t></w:r></w:p>"#,
        "",
    );
    let model = build_doc_model(&source);
    let DocNode::Paragraph(p) = &model.nodes[0] else {
        panic!()
    };
    let runs: Vec<_> = p
        .children
        .iter()
        .filter_map(|child| {
            if let ParagraphChildNode::Text(run) = child {
                Some((run.text.as_str(), run.link.as_deref()))
            } else {
                None
            }
        })
        .collect();
    assert_eq!(
        runs,
        vec![
            ("A", Some("https://example.org/doc#new")),
            ("B", Some("#bookmark")),
            ("C", Some("https://example.org/inner")),
            ("D", Some("#bookmark")),
            ("E", None)
        ]
    );
}

#[test]
fn field_link_scopes_can_change_inside_one_run() {
    let source = package(
        r#"<w:p><w:r><w:t/><w:footnoteReference w:id="-1"/><w:t>A</w:t><w:fldChar w:fldCharType="begin"/><w:instrText>HYPERLINK "https://example.org/one"</w:instrText><w:fldChar w:fldCharType="separate"/><w:t/><w:cr/><w:noBreakHyphen/><w:softHyphen/><w:t>B</w:t><w:fldChar w:fldCharType="end"/><w:t>C</w:t><w:fldChar w:fldCharType="begin"/><w:instrText>HYPERLINK \l second</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>D</w:t><w:fldChar w:fldCharType="end"/><w:t>E</w:t></w:r></w:p>"#,
        "",
    );
    let model = build_doc_model(&source);
    let DocNode::Paragraph(p) = &model.nodes[0] else {
        panic!()
    };
    let links: Vec<_> = p
        .children
        .iter()
        .filter_map(|child| {
            if let ParagraphChildNode::Text(run) = child {
                Some(run.link.as_deref())
            } else {
                None
            }
        })
        .collect();
    assert_eq!(
        links,
        vec![
            None,
            Some("https://example.org/one"),
            Some("https://example.org/one"),
            Some("https://example.org/one"),
            Some("https://example.org/one"),
            None,
            Some("#second"),
            None
        ]
    );
}

#[test]
fn deleted_rows_do_not_enter_visible_table_or_merge_spans() {
    let source = package(
        r#"<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>Visible</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:trPr><w:del w:id="1"/></w:trPr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p><w:r><w:t>Removed</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"#,
        "",
    );
    let model = build_doc_model(&source);
    let DocNode::Table(table) = &model.nodes[0] else {
        panic!()
    };
    assert_eq!(table.rows.len(), 2);
    assert_eq!(
        table.rows[0].cells[0].style.as_ref().unwrap().row_span,
        Some(2)
    );
    let block = &extract_document_blocks(&model).blocks[0];
    assert!(!block.content.contains("Removed"));
    assert!(source.parts["word/document.xml"]
        .content
        .contains("Removed"));
}

#[test]
fn images_retain_interleaved_order_and_repeated_occurrences() {
    let drawing = r#"<w:pict><v:shape style="width:20pt;height:20pt"><v:imagedata r:id="image"/></v:shape></w:pict>"#;
    let mut source = package(&format!("<w:p><w:r><w:t>Before</w:t>{drawing}<w:t>Between</w:t>{drawing}<w:t>After</w:t></w:r></w:p>"), "");
    let relationships = &mut source
        .parts
        .get_mut("word/_rels/document.xml.rels")
        .unwrap()
        .content;
    *relationships = relationships.replace("</Relationships>", r#"<Relationship Id="image" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/a.png"/></Relationships>"#);
    source.binary_assets.insert(
        "word/media/a.png".into(),
        vec![137, 80, 78, 71, 13, 10, 26, 10],
    );
    let model = build_doc_model(&source);
    let DocNode::Paragraph(p) = &model.nodes[0] else {
        panic!()
    };
    let order: Vec<_> = p
        .children
        .iter()
        .map(|child| match child {
            ParagraphChildNode::Text(run) => run.text.as_str(),
            ParagraphChildNode::Image(_) => "image",
            _ => "control",
        })
        .collect();
    assert_eq!(order, vec!["Before", "image", "Between", "image", "After"]);
    let output = extract_document_blocks(&model);
    let block = &output.blocks[0];
    let details = block.details.to_json_value();
    assert_eq!(block.children.len(), 2);
    assert_ne!(block.children[0].id, block.children[1].id);
    assert_eq!(details["inlines"][1]["offset"], 6);
    assert_eq!(details["inlines"][3]["offset"], 13);
}

#[test]
fn field_ranges_survive_unicode_textboxes_and_alternate_content() {
    let picture = r#"<w:pict><v:shape style="width:20pt;height:20pt"><v:imagedata r:id="image"/></v:shape></w:pict>"#;
    let textbox = r#"<w:pict><v:shape style="width:100pt;height:30pt"><v:textbox><w:txbxContent><w:p><w:r><w:t>é😀</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict>"#;
    let alternate = format!(
        r#"<mc:AlternateContent><mc:Choice Requires="v">{picture}</mc:Choice><mc:Fallback>{picture}</mc:Fallback></mc:AlternateContent>"#
    );
    let mut source = package(
        &format!(
            r#"<w:p><w:r><w:t>Start</w:t>{textbox}<w:fldChar w:fldCharType="begin"/><w:instrText>HYPERLINK \l target</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>Après😀</w:t>{alternate}<w:t>Linked</w:t><w:fldChar w:fldCharType="end"/><w:t>End</w:t></w:r></w:p>"#
        ),
        "",
    );
    let relationships = &mut source
        .parts
        .get_mut("word/_rels/document.xml.rels")
        .unwrap()
        .content;
    *relationships = relationships.replace("</Relationships>", r#"<Relationship Id="image" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/a.png"/></Relationships>"#);
    source.binary_assets.insert(
        "word/media/a.png".into(),
        vec![137, 80, 78, 71, 13, 10, 26, 10],
    );
    let model = build_doc_model(&source);
    let DocNode::Paragraph(p) = &model.nodes[0] else {
        panic!()
    };
    let text: Vec<_> = p
        .children
        .iter()
        .filter_map(|child| {
            if let ParagraphChildNode::Text(run) = child {
                Some((run.text.as_str(), run.link.as_deref()))
            } else {
                None
            }
        })
        .collect();
    assert_eq!(
        text,
        vec![
            ("Start", None),
            ("Après😀", Some("#target")),
            ("Linked", Some("#target")),
            ("End", None)
        ]
    );
    assert_eq!(
        p.children
            .iter()
            .filter(|child| matches!(child, ParagraphChildNode::Image(_)))
            .count(),
        2
    );
    let output = extract_document_blocks(&model);
    let details = output.blocks[0].details.to_json_value();
    assert_eq!(details["inlines"][2]["start"], 5);
    assert_eq!(details["inlines"][2]["end"], 12);
}
