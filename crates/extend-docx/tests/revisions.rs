use extend_docx::{
    build_doc_model, extract_document_blocks, extract_document_blocks_with_revisions,
    DocumentBlock, OoxmlPackage, OoxmlPart, ReviewedDocument, RevisionKind, RevisionScope,
};
use std::collections::HashSet;

fn package(body: &str) -> OoxmlPackage {
    let name = "word/document.xml".to_string();
    let content = format!(
        r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}</w:body></w:document>"#
    );
    OoxmlPackage {
        parts: [(name.clone(), OoxmlPart { name, content })].into(),
        binary_assets: Default::default(),
        warnings: vec![],
    }
}

fn check_anchors(review: &ReviewedDocument) {
    fn visit<'a>(blocks: &'a [DocumentBlock], ids: &mut HashSet<&'a str>) {
        for b in blocks {
            ids.insert(&b.id);
            visit(&b.children, ids);
        }
    }
    let mut ids = HashSet::new();
    visit(&review.document.blocks, &mut ids);
    let mut revisions = HashSet::new();
    for r in &review.revisions {
        assert!(revisions.insert(&r.id));
        assert!(r
            .source_refs
            .iter()
            .all(|s| ids.contains(s.node_id.as_str()) && s.offset_encoding == "utf-16"));
    }
}

#[test]
fn replacements_and_deleted_paragraphs_use_current_text_coordinates() {
    let model = build_doc_model(&package(
        r#"<w:p><w:r><w:t>😀 </w:t></w:r>
    <w:del w:id="9" w:author="A &amp; B" w:date="2020-01-01T09:00:00Z"><w:r><w:delText>x&amp;x</w:delText><w:tab/><w:delText>y</w:delText></w:r></w:del>
    <w:ins w:id="10"><w:hyperlink><w:r><w:t>ne</w:t></w:r><w:r><w:t>w🚀</w:t></w:r></w:hyperlink></w:ins>
    <w:r><w:rPr><w:strike/></w:rPr><w:t>!</w:t></w:r></w:p>
    <w:p><w:del w:id="11"><w:r><w:delText>entire paragraph</w:delText></w:r></w:del></w:p>"#,
    ));
    let plain = extract_document_blocks(&model);
    assert_eq!(plain.blocks.len(), 1);
    assert_eq!(plain.blocks[0].content, "😀 new🚀!");
    assert!(!serde_json::to_string(&plain)
        .unwrap()
        .contains("entire paragraph"));
    let review = extract_document_blocks_with_revisions(&model, Default::default());
    assert_eq!(review.document.blocks.len(), 2);
    assert_eq!(review.revisions.len(), 3);
    let del = &review.revisions[0];
    let ins = &review.revisions[1];
    let gone = &review.revisions[2];
    assert_eq!(
        (
            del.kind,
            del.author.as_deref(),
            del.text.as_deref(),
            del.source_id.as_deref()
        ),
        (
            RevisionKind::Deletion,
            Some("A & B"),
            Some("x&x\ty"),
            Some("9")
        )
    );
    assert_eq!(del.date.as_deref(), Some("2020-01-01T09:00:00Z"));
    let range = |r: &extend_docx::DocumentRevision| (r.source_refs[0].start, r.source_refs[0].end);
    assert_eq!(range(del), (Some(3), Some(3)));
    assert_eq!(
        (ins.text.as_deref(), range(ins)),
        (Some("new🚀"), (Some(3), Some(8)))
    );
    assert_eq!(
        (gone.text.as_deref(), range(gone)),
        (Some("entire paragraph"), (Some(0), Some(0)))
    );
    check_anchors(&review);
    assert_eq!(
        serde_json::from_value::<ReviewedDocument>(serde_json::to_value(&review).unwrap()).unwrap(),
        review
    );
}

#[test]
fn distinguishes_moves_mark_changes_and_direct_formatting() {
    let model = build_doc_model(&package(
        r#"<w:p><w:moveFromRangeStart w:id="1" w:name="m"/><w:moveFrom w:id="2"><w:r><w:delText>move</w:delText></w:r></w:moveFrom><w:moveFromRangeEnd w:id="1"/></w:p>
    <w:p><w:pPr><w:rPr><w:del w:id="2"/></w:rPr><w:jc w:val="right"/><w:pPrChange w:id="3"><w:pPr><w:jc w:val="left"/></w:pPr></w:pPrChange></w:pPr>
    <w:moveToRangeStart w:id="4" w:name="m"/><w:moveTo w:id="5"><w:r><w:rPr><w:b/><w:rPrChange w:id="6"><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr><w:t>move</w:t></w:r></w:moveTo><w:moveToRangeEnd w:id="4"/></w:p>"#,
    ));
    let review = extract_document_blocks_with_revisions(&model, Default::default());
    check_anchors(&review);
    assert_eq!(
        review.revisions.len(),
        5,
        "{:?}",
        review
            .revisions
            .iter()
            .map(|r| (&r.source_id, r.kind, r.scope))
            .collect::<Vec<_>>()
    );
    let moves: Vec<_> = review
        .revisions
        .iter()
        .filter(|r| matches!(r.kind, RevisionKind::MoveFrom | RevisionKind::MoveTo))
        .collect();
    assert_eq!(moves.len(), 2);
    assert!(moves
        .iter()
        .all(|r| r.move_name.as_deref() == Some("m") && r.text.as_deref() == Some("move")));
    let mark = review
        .revisions
        .iter()
        .find(|r| r.scope == RevisionScope::ParagraphMark)
        .unwrap();
    assert_eq!(mark.source_refs[0].start, Some(4));
    let formatting = review
        .revisions
        .iter()
        .find(|r| r.scope == RevisionScope::Text && r.kind == RevisionKind::Formatting)
        .unwrap();
    assert_eq!(
        (
            formatting.source_refs[0].start,
            formatting.source_refs[0].end
        ),
        (Some(0), Some(4))
    );
    let props = formatting.properties.as_ref().unwrap();
    assert_eq!(props.before[0].name, "w:i");
    assert_eq!(props.after[0].name, "w:b");
}

#[test]
fn row_and_cell_revisions_link_to_cells_and_nested_text_is_reported_once() {
    let model = build_doc_model(&package(
        r#"<w:tbl><w:tblPr><w:tblPrChange w:id="33"><w:tblPr/></w:tblPrChange></w:tblPr>
    <w:tr><w:trPr><w:ins w:id="34"/></w:trPr><w:tc><w:tcPr><w:cellIns w:id="35"/></w:tcPr><w:p><w:ins w:id="36"><w:r><w:t>cell</w:t></w:r></w:ins></w:p></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>"#,
    ));
    let review = extract_document_blocks_with_revisions(&model, Default::default());
    check_anchors(&review);
    assert_eq!(review.revisions.len(), 4);
    let row = review
        .revisions
        .iter()
        .find(|r| r.scope == RevisionScope::TableRow)
        .unwrap();
    assert_eq!(row.source_refs.len(), 2);
    assert!(row
        .source_refs
        .iter()
        .all(|s| s.start.is_none() && s.node_id.contains("/row/0/cell/")));
}

#[test]
fn section_changes_attach_to_the_closing_block_once() {
    let section = r#"<w:sectPr><w:pgSz w:w="8000"/><w:sectPrChange w:id="12"><w:sectPr><w:pgSz w:w="7000"/></w:sectPr></w:sectPrChange></w:sectPr>"#;
    for body in [
        format!("<w:p><w:r><w:t>p</w:t></w:r></w:p>{section}"),
        format!("<w:p><w:pPr>{section}</w:pPr><w:r><w:t>p</w:t></w:r></w:p>"),
    ] {
        let model = build_doc_model(&package(&body));
        let review = extract_document_blocks_with_revisions(&model, Default::default());
        check_anchors(&review);
        assert_eq!(review.revisions.len(), 1);
        assert_eq!(review.revisions[0].scope, RevisionScope::Section);
        let old = &review.revisions[0].properties.as_ref().unwrap().before[0];
        assert_eq!(old.attributes["w:w"], "7000");
    }
}
