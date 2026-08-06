use std::collections::HashMap;

use docx_core::{
    build_doc_model, create_minimal_docx_package, serialize_doc_model, DocumentCommentDefinition,
    OoxmlPackage, OoxmlPart,
};

fn package_with_parts(parts: &[(&str, &str)]) -> OoxmlPackage {
    let mut map = HashMap::new();
    for (name, content) in parts {
        map.insert(
            (*name).to_string(),
            OoxmlPart {
                name: (*name).to_string(),
                content: (*content).to_string(),
            },
        );
    }
    OoxmlPackage {
        parts: map,
        binary_assets: HashMap::new(),
        warnings: Vec::new(),
    }
}

const DOCUMENT_XML: &str = r#"<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t>Before </w:t></w:r>
      <w:commentRangeStart w:id="1"/>
      <w:r><w:t>annotated text</w:t></w:r>
      <w:commentRangeEnd w:id="1"/>
      <w:r><w:commentReference w:id="1"/></w:r>
      <w:r><w:t> after.</w:t></w:r>
    </w:p>
    <w:sectPr/>
  </w:body>
</w:document>"#;

const COMMENTS_XML: &str = r#"<?xml version="1.0"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:comment w:id="1" w:author="Ada Lovelace" w:initials="AL" w:date="2026-06-01T10:00:00Z">
    <w:p w14:paraId='11111111'><w:r><w:t>Please tighten this sentence.</w:t></w:r></w:p>
  </w:comment>
  <w:comment w:id="2" w:author="Grace Hopper" w:initials="GH" w:date="2026-06-02T09:30:00Z">
    <w:p w14:paraId="22222222"><w:r><w:t>Agreed, will fix.</w:t></w:r></w:p>
  </w:comment>
</w:comments>"#;

const COMMENTS_EXTENDED_XML: &str = r#"<?xml version="1.0"?>
<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">
  <w15:commentEx w15:paraId="11111111" w15:done="on"/>
  <w15:commentEx w15:paraId="22222222" w15:paraIdParent="11111111" w15:done="0"/>
</w15:commentsEx>"#;

#[test]
fn parses_comment_definitions_with_thread_and_resolution() {
    let model = build_doc_model(&package_with_parts(&[
        ("word/document.xml", DOCUMENT_XML),
        ("word/comments.xml", COMMENTS_XML),
        ("word/commentsExtended.xml", COMMENTS_EXTENDED_XML),
    ]));

    let comments = model.metadata.comments.as_ref().expect("comments parsed");
    assert_eq!(comments.len(), 2);

    let first = &comments[0];
    assert_eq!(first.id, 1);
    assert_eq!(first.author.as_deref(), Some("Ada Lovelace"));
    assert_eq!(first.initials.as_deref(), Some("AL"));
    assert_eq!(first.date.as_deref(), Some("2026-06-01T10:00:00Z"));
    assert_eq!(first.text, "Please tighten this sentence.");
    assert_eq!(first.parent_id, None);
    assert_eq!(first.resolved, Some(true));
    assert_eq!(first.source_resolved, Some(true));
    assert_eq!(first.resolution_dirty, Some(false));
    assert_eq!(first.is_new, Some(false));
    assert_eq!(first.extended_paragraph_id.as_deref(), Some("11111111"));
    assert!(first
        .source_xml
        .as_deref()
        .is_some_and(|xml| xml.contains("Please tighten this sentence.")));

    let reply = &comments[1];
    assert_eq!(reply.id, 2);
    assert_eq!(reply.author.as_deref(), Some("Grace Hopper"));
    assert_eq!(reply.text, "Agreed, will fix.");
    assert_eq!(reply.parent_id, Some(1));
    assert_eq!(reply.resolved, Some(false));
    assert_eq!(reply.source_resolved, Some(false));

    // The body paragraph keeps the comment anchors in its sourceXml for the
    // viewer-side range mapping.
    let paragraph_xml = model
        .nodes
        .iter()
        .find_map(|node| match node {
            docx_core::model::DocNode::Paragraph(paragraph) => paragraph.source_xml.clone(),
            _ => None,
        })
        .expect("paragraph source xml");
    assert!(paragraph_xml.contains("commentRangeStart"));
    assert!(paragraph_xml.contains("commentReference"));
}

#[test]
fn documents_without_comments_have_no_metadata_entry() {
    let model = build_doc_model(&package_with_parts(&[(
        "word/document.xml",
        DOCUMENT_XML,
    )]));
    assert!(model.metadata.comments.is_none());
}

fn package_with_serialization_scaffolding() -> OoxmlPackage {
    let mut package = create_minimal_docx_package(Some(DOCUMENT_XML));
    package.parts.insert(
        "word/comments.xml".to_string(),
        OoxmlPart {
            name: "word/comments.xml".to_string(),
            content: COMMENTS_XML.replace("</w:comments>", "<!--keep-comments-root--></w:comments>"),
        },
    );
    package.parts.insert(
        "word/commentsExtended.xml".to_string(),
        OoxmlPart {
            name: "word/commentsExtended.xml".to_string(),
            content: COMMENTS_EXTENDED_XML.replace(
                "</w15:commentsEx>",
                r#"<w15:commentEx w15:paraId="DEADBEEF" w15:done="1" data-keep="yes"/><!--keep-extended-root--></w15:commentsEx>"#,
            ),
        },
    );
    let relationships = package
        .parts
        .get_mut("word/_rels/document.xml.rels")
        .expect("document relationships");
    relationships.content = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId77" Type="urn:example:keep" Target="keep.xml"/></Relationships>"#.to_string();
    let content_types = package
        .parts
        .get_mut("[Content_Types].xml")
        .expect("content types");
    content_types.content = content_types.content.replace(
        "</Types>",
        r#"<Override PartName="/word/keep.xml" ContentType="application/x-keep"/><Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.ms-word.commentsExt+xml"/></Types>"#,
    );
    package
}

#[test]
fn serializes_comment_resolution_without_dropping_package_entries() {
    let package = package_with_serialization_scaffolding();
    let mut model = build_doc_model(&package);
    let comments = model.metadata.comments.as_mut().expect("comments");
    comments[0].resolved = Some(false);
    comments[0].resolution_dirty = Some(true);

    let serialized = serialize_doc_model(&model, Some(&package));
    let comments_xml = &serialized
        .parts
        .get("word/comments.xml")
        .expect("comments part")
        .content;
    assert!(comments_xml.contains("Please tighten this sentence."));
    assert!(comments_xml.contains("Agreed, will fix."));
    assert!(comments_xml.contains("<!--keep-comments-root-->"));

    let extended_xml = &serialized
        .parts
        .get("word/commentsExtended.xml")
        .expect("comments extended part")
        .content;
    assert!(extended_xml.contains(r#"w15:paraId="11111111" w15:done="0""#));
    assert!(extended_xml.contains(r#"w15:paraId="22222222" w15:paraIdParent="11111111" w15:done="0""#));
    assert!(extended_xml.contains(r#"w15:paraId="DEADBEEF" w15:done="1" data-keep="yes""#));
    assert!(extended_xml.contains("<!--keep-extended-root-->"));

    let relationships = &serialized
        .parts
        .get("word/_rels/document.xml.rels")
        .expect("relationships")
        .content;
    assert!(relationships.contains("urn:example:keep"));
    assert!(relationships.contains("relationships/comments\""));
    assert!(relationships.contains("relationships/commentsExtended\""));

    let content_types = &serialized
        .parts
        .get("[Content_Types].xml")
        .expect("content types")
        .content;
    assert!(content_types.contains("/word/keep.xml"));
    assert!(content_types.contains("/word/comments.xml"));
    assert!(content_types.contains("/word/commentsExtended.xml"));
    assert!(content_types.contains(
        r#"PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml""#
    ));
    assert!(!content_types.contains("application/vnd.ms-word.commentsExt+xml"));
}

#[test]
fn preserves_untouched_imported_comment_extension_lexical_values() {
    let package = package_with_serialization_scaffolding();
    let model = build_doc_model(&package);
    let serialized = serialize_doc_model(&model, Some(&package));
    let extended_xml = &serialized
        .parts
        .get("word/commentsExtended.xml")
        .expect("comments extended")
        .content;
    assert!(extended_xml.contains(r#"w15:paraId="11111111" w15:done="on""#));
}

#[test]
fn preserves_comment_text_that_looks_like_a_note_index() {
    let comments_xml = r#"<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:comment w:id="5"><w:p w14:paraId='ABCDEF12'><w:r><w:t xml:space="preserve">[1]  Keep both edges.  </w:t></w:r></w:p></w:comment></w:comments>"#;
    let comments_extended_xml = r#"<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:commentEx w15:paraId="ABCDEF12" w15:done="off"/></w15:commentsEx>"#;
    let model = build_doc_model(&package_with_parts(&[
        ("word/document.xml", DOCUMENT_XML),
        ("word/comments.xml", comments_xml),
        ("word/commentsExtended.xml", comments_extended_xml),
    ]));
    let comment = &model.metadata.comments.expect("comment")[0];
    assert_eq!(comment.text, "[1]  Keep both edges.  ");
    assert_eq!(comment.extended_paragraph_id.as_deref(), Some("ABCDEF12"));
    assert_eq!(comment.resolved, Some(false));
}

#[test]
fn serializes_a_new_comment_and_roundtrips_explicit_unresolved_state() {
    let package = create_minimal_docx_package(Some(DOCUMENT_XML));
    let mut model = build_doc_model(&package);
    model.metadata.comments = Some(vec![DocumentCommentDefinition {
        id: 3,
        author: Some("Ada".to_string()),
        initials: Some("AL".to_string()),
        date: Some("2026-07-09T12:00:00Z".to_string()),
        text: "  Preserve this spacing.  ".to_string(),
        parent_id: None,
        resolved: Some(false),
        source_xml: None,
        extended_paragraph_id: Some("C0000003".to_string()),
        source_resolved: Some(false),
        resolution_dirty: Some(false),
        is_new: Some(true),
    }]);

    let serialized = serialize_doc_model(&model, Some(&package));
    let comments_xml = &serialized
        .parts
        .get("word/comments.xml")
        .expect("comments")
        .content;
    assert!(comments_xml.contains(r#"w:id="3""#));
    assert!(comments_xml.contains(r#"w14:paraId="C0000003""#));
    assert!(comments_xml.contains(r#"xml:space="preserve">  Preserve this spacing.  </w:t>"#));
    let extended_xml = &serialized
        .parts
        .get("word/commentsExtended.xml")
        .expect("comments extended")
        .content;
    assert!(extended_xml.contains(r#"w15:paraId="C0000003" w15:done="0""#));
    let relationships = &serialized
        .parts
        .get("word/_rels/document.xml.rels")
        .expect("relationships")
        .content;
    assert!(relationships.contains("relationships/comments\""));
    assert!(relationships.contains("relationships/commentsExtended\""));
    let content_types = &serialized
        .parts
        .get("[Content_Types].xml")
        .expect("content types")
        .content;
    assert!(content_types.contains(
        r#"PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml""#
    ));

    let reparsed = build_doc_model(&serialized);
    let comment = &reparsed.metadata.comments.expect("roundtrip comments")[0];
    assert_eq!(comment.id, 3);
    assert_eq!(comment.text, "  Preserve this spacing.  ");
    assert_eq!(comment.resolved, Some(false));
    assert_eq!(comment.source_resolved, Some(false));
    assert!(comment
        .source_xml
        .as_deref()
        .is_some_and(|xml| xml.contains("  Preserve this spacing.  ")));
}
