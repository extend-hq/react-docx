use std::collections::{HashMap, HashSet};

use docx_core::{
    build_doc_model, extract_document_blocks, extract_document_blocks_with_options,
    parse_document_blocks, parse_document_blocks_with_options, DocumentBlock,
    ExtractDocumentBlocksOptions, OoxmlPackage, OoxmlPart,
};

fn package(body: &str, extra: &[(&str, &str)]) -> OoxmlPackage {
    let document = format!(
        r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml"><w:body>{body}</w:body></w:document>"#
    );
    let mut parts = HashMap::new();
    parts.insert(
        "word/document.xml".into(),
        OoxmlPart {
            name: "word/document.xml".into(),
            content: document,
        },
    );
    for (name, content) in extra {
        parts.insert(
            (*name).into(),
            OoxmlPart {
                name: (*name).into(),
                content: (*content).into(),
            },
        );
    }
    OoxmlPackage {
        parts,
        binary_assets: HashMap::new(),
        warnings: Vec::new(),
    }
}

fn blocks(blocks: &[DocumentBlock]) -> Vec<&DocumentBlock> {
    blocks
        .iter()
        .flat_map(|block| std::iter::once(block).chain(self::blocks(&block.children)))
        .collect()
}

#[test]
fn word_spans_are_opt_in_without_changing_default_blocks() {
    let source = package("<w:p><w:r><w:t>Two words.</w:t></w:r></w:p>", &[]);
    let model = build_doc_model(&source);
    let default = extract_document_blocks(&model);
    assert!(blocks(&default.blocks)
        .iter()
        .all(|block| block.words.is_none()));
    assert!(!serde_json::to_value(&default).unwrap()["blocks"][0]
        .as_object()
        .unwrap()
        .contains_key("words"));
    assert_eq!(
        extract_document_blocks_with_options(&model, ExtractDocumentBlocksOptions::default()),
        default
    );
    let mut with_words = extract_document_blocks_with_options(
        &model,
        ExtractDocumentBlocksOptions {
            include_words: true,
        },
    );
    assert_eq!(with_words.geometry_status, "requires_layout");
    assert_eq!(with_words.blocks[0].words.take().unwrap().len(), 3);
    assert_eq!(with_words, default);
}

#[test]
fn unicode_words_keep_source_ranges_across_style_runs() {
    let source = package("<w:p><w:r><w:rPr><w:caps/></w:rPr><w:t xml:space=\"preserve\">  aß😀\tCa</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space=\"preserve\">fé can't 3.14—中文 👩🏽‍💻!  </w:t></w:r></w:p>", &[]);
    let model = build_doc_model(&source);
    let output = extract_document_blocks_with_options(
        &model,
        ExtractDocumentBlocksOptions {
            include_words: true,
        },
    );
    let block = &output.blocks[0];
    let words = block.words.as_ref().unwrap();
    let expected = [
        ("aß", 2, 4),
        ("😀", 4, 6),
        ("Café", 7, 12),
        ("can't", 13, 18),
        ("3.14", 19, 23),
        ("—", 23, 24),
        ("中", 24, 25),
        ("文", 25, 26),
        ("👩🏽‍💻", 27, 34),
        ("!", 34, 35),
    ];
    assert_eq!(words.len(), expected.len());
    let units: Vec<_> = block.content.encode_utf16().collect();
    for (word, (content, start, end)) in words.iter().zip(expected) {
        assert_eq!(word.object, "word");
        assert_eq!(word.content, content);
        assert_eq!(word.id, format!("{}/word/{start}-{end}", block.id));
        assert_eq!(word.block_id, block.id);
        assert_eq!(word.source_refs.len(), 1);
        let reference = &word.source_refs[0];
        assert_eq!((reference.start, reference.end), (Some(start), Some(end)));
        assert_eq!(reference.offset_encoding, "utf-16");
        assert_eq!(reference.node_id, block.id);
        assert_eq!(
            String::from_utf16(&units[start..end]).unwrap(),
            word.content
        );
        assert_eq!(reference.document_id, output.document_id);
    }
    assert_eq!(
        words
            .iter()
            .map(|word| word.content.as_str())
            .collect::<String>(),
        block
            .content
            .chars()
            .filter(|character| !character.is_whitespace())
            .collect::<String>()
    );
}

#[test]
fn nested_and_auxiliary_story_words_use_their_own_source_nodes() {
    let source = package(
        r#"<w:p><w:r><w:t>Body word</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell word</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:pict><v:shape style="width:120pt;height:40pt"><v:textbox><w:txbxContent><w:p><w:r><w:t>Box word</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="h"/></w:sectPr>"#,
        &[
            (
                "word/_rels/document.xml.rels",
                r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="h" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>"#,
            ),
            (
                "word/header1.xml",
                r#"<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Header word</w:t></w:r></w:p></w:hdr>"#,
            ),
            (
                "word/footnotes.xml",
                r#"<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1"><w:p><w:r><w:t>Footnote word</w:t></w:r></w:p></w:footnote></w:footnotes>"#,
            ),
            (
                "word/endnotes.xml",
                r#"<w:endnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:endnote w:id="1"><w:p><w:r><w:t>Endnote word</w:t></w:r></w:p></w:endnote></w:endnotes>"#,
            ),
            (
                "word/comments.xml",
                r#"<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="1"><w:p><w:r><w:t>Comment word</w:t></w:r></w:p></w:comment></w:comments>"#,
            ),
        ],
    );
    let model = build_doc_model(&source);
    let output = extract_document_blocks_with_options(
        &model,
        ExtractDocumentBlocksOptions {
            include_words: true,
        },
    );
    let flat = blocks(&output.blocks);
    let paragraphs: Vec<_> = flat.iter().filter(|block| block.words.is_some()).collect();
    assert_eq!(paragraphs.len(), 7);
    let mut ids = HashSet::new();
    for block in paragraphs {
        for word in block.words.as_ref().unwrap() {
            assert!(ids.insert(word.id.clone()));
            assert_eq!(word.block_id, block.id);
            let source = &word.source_refs[0];
            assert_eq!(source.part_name, block.source_refs[0].part_name);
            assert_eq!(source.story, block.source_refs[0].story);
            assert_eq!(source.node_id, block.id);
        }
    }
    assert_eq!(ids.len(), 14);
    assert!(flat
        .iter()
        .filter(|block| block.details.to_json_value()["kind"] != "paragraph")
        .all(|block| block.words.is_none()));
}

#[test]
fn byte_parsing_keeps_word_ids_stable_and_old_api_unchanged() {
    let source = package("<w:p><w:r><w:t>Stable words</w:t></w:r></w:p>", &[]);
    let bytes = docx_core::package_to_bytes(&source).unwrap();
    let options = ExtractDocumentBlocksOptions {
        include_words: true,
    };
    let first = parse_document_blocks_with_options(&bytes, options).unwrap();
    let second = parse_document_blocks_with_options(&bytes, options).unwrap();
    assert_eq!(first, second);
    let plain = parse_document_blocks(&bytes).unwrap();
    assert_eq!(plain.document_id, first.document_id);
    assert_eq!(plain.blocks[0].id, first.blocks[0].id);
    assert!(plain.blocks[0].words.is_none());
    assert!(first.blocks[0]
        .words
        .as_ref()
        .unwrap()
        .iter()
        .all(|word| !word.content.is_empty()));
}
