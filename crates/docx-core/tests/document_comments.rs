use std::collections::HashMap;

use docx_core::{build_doc_model, OoxmlPackage, OoxmlPart};

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
    <w:p w14:paraId="11111111"><w:r><w:t>Please tighten this sentence.</w:t></w:r></w:p>
  </w:comment>
  <w:comment w:id="2" w:author="Grace Hopper" w:initials="GH" w:date="2026-06-02T09:30:00Z">
    <w:p w14:paraId="22222222"><w:r><w:t>Agreed, will fix.</w:t></w:r></w:p>
  </w:comment>
</w:comments>"#;

const COMMENTS_EXTENDED_XML: &str = r#"<?xml version="1.0"?>
<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">
  <w15:commentEx w15:paraId="11111111" w15:done="1"/>
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

    let reply = &comments[1];
    assert_eq!(reply.id, 2);
    assert_eq!(reply.author.as_deref(), Some("Grace Hopper"));
    assert_eq!(reply.text, "Agreed, will fix.");
    assert_eq!(reply.parent_id, Some(1));
    assert_eq!(reply.resolved, None);

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
