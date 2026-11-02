use super::*;

mod data_uri_tests {
    use super::*;

    #[test]
    fn data_uri_preserves_utf8_and_literal_octets() {
        let uri = "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Ctext%3E%C3%A9%20%F0%9F%98%80%20+%2B%2C%3B%2520%3C%2Ftext%3E%3C%2Fsvg%3E";
        let (mime, bytes) = decode_data_uri(uri).unwrap();
        assert_eq!(mime, "image/svg+xml");
        assert_eq!(
            bytes,
            "<svg xmlns=\"http://www.w3.org/2000/svg\"><text>é 😀 ++,;%20</text></svg>".as_bytes()
        );
        assert_eq!(
            decode_data_uri("data:,%00%ff,%3b+").unwrap(),
            ("text/plain".into(), vec![0, 255, b',', b';', b'+'])
        );
        assert_eq!(
            decode_data_uri("data:;charset=utf-8,%C3%A9").unwrap().1,
            "é".as_bytes()
        );
        assert_eq!(
            decode_data_uri("data:text/plain,").unwrap().1,
            Vec::<u8>::new()
        );
    }

    #[test]
    fn data_uri_preserves_base64_with_parameters() {
        for uri in [
            "data:image/png;base64,AAEC/w==",
            "DATA:image/png;charset=utf-8;BASE64,AAEC/w==",
            "data:image/png;name=a%3Bb;base64,AAEC%2Fw%3D%3D",
        ] {
            assert_eq!(
                decode_data_uri(uri).unwrap(),
                ("image/png".into(), vec![0, 1, 2, 255])
            );
        }
        assert_eq!(
            decode_data_uri("data:text/plain;base64=ordinary,SGVsbG8=")
                .unwrap()
                .1,
            b"SGVsbG8="
        );
    }

    #[test]
    fn data_uri_rejects_malformed_escapes_and_metadata() {
        for uri in [
            "data:text/plain,%",
            "data:text/plain,%0",
            "data:text/plain,%GG",
            "data:text/plain,%Cé",
            "data:text/plain;base64,AA%Q0",
            "data:text/plain;charset=%0,ok",
            "data:image%Q0png,ok",
            "data:image/png;base64;charset=utf-8,AAEC",
            "data:image/png;base64;base64,AAEC",
            "data:image/png;unknown,ok",
            "data:image/,ok",
            "data:image/png/extra,ok",
            "data:image/png",
            "https://invalid.test/image.png",
            "δata:image/png,ok",
        ] {
            assert!(decode_data_uri(uri).is_none(), "{uri}");
        }
    }

    #[test]
    fn data_uri_src_only_svg_survives_document_export() {
        let document = r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Initial text</w:t></w:r></w:p></w:body></w:document>"#;
        let package = crate::create_minimal_docx_package(Some(document));
        let mut model = crate::build_doc_model(&package);
        let DocNode::Paragraph(paragraph) = &mut model.nodes[0] else {
            panic!("paragraph")
        };
        paragraph.source_xml = None;
        let source = "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22160%22%20height%3D%2280%22%3E%3Ctext%3EUpdated%20%C3%A9%20%2B%20text%3C%2Ftext%3E%3C%2Fsvg%3E";
        let expected = b"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"160\" height=\"80\"><text>Updated \xc3\xa9 + text</text></svg>";
        let image: ImageRunNode = serde_json::from_value(serde_json::json!({
            "type": "image", "src": source, "widthPx": 160.0, "heightPx": 80.0
        }))
        .unwrap();
        paragraph.children = vec![ParagraphChildNode::Image(Box::new(image))];
        let exported = serialize_doc_model(&model, Some(&package));
        let xml = &exported.parts["word/document.xml"].content;
        assert!(xml.contains("<w:drawing>"));
        assert!(xml.contains("<wp:inline "));
        assert!(xml.contains(r#"<wp:extent cx="1524000" cy="762000"/>"#));
        let (part, bytes) = exported
            .binary_assets
            .iter()
            .find(|(part, _)| part.ends_with(".svg"))
            .unwrap();
        assert_eq!(bytes, expected);
        assert!(exported.parts["[Content_Types].xml"]
            .content
            .contains("image/svg+xml"));
        assert!(exported.parts["word/_rels/document.xml.rels"]
            .content
            .contains(part.strip_prefix("word/").unwrap()));
        let reparsed = crate::build_doc_model(&exported);
        let DocNode::Paragraph(paragraph) = &reparsed.nodes[0] else {
            panic!("paragraph")
        };
        let ParagraphChildNode::Image(image) = &paragraph.children[0] else {
            panic!("image")
        };
        assert_eq!(image.data.as_deref(), Some(expected.as_slice()));
        assert_eq!((image.width_px, image.height_px), (Some(160.0), Some(80.0)));
    }
}

mod edited_vml_textbox_tests {
    use super::*;

    fn fixture() -> (OoxmlPackage, DocModel, ImageRunNode) {
        let xml = r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Initial</w:t></w:r></w:p></w:body></w:document>"#;
        let mut package = crate::create_minimal_docx_package(Some(xml));
        package
            .binary_assets
            .insert("word/media/original.png".into(), vec![1, 2, 3, 4]);
        package.parts.insert("word/_rels/document.xml.rels".into(), OoxmlPart {
            name: "word/_rels/document.xml.rels".into(),
            content: format!(r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdBitmap" Type="{OFFICE_REL_NS}/image" Target="media/original.png"/></Relationships>"#),
        });
        let model = crate::build_doc_model(&package);
        let source = r##"<w:pict><v:group style="width:160px;height:80px" coordsize="160,80"><v:shape style="width:20;height:20"><v:imagedata r:id="rIdBitmap"/></v:shape><v:rect fillcolor="#123456"><v:textbox><w:txbxContent><w:p><w:r><w:t>Old first</w:t></w:r></w:p></w:txbxContent></v:textbox></v:rect><v:shape><v:textbox><w:txbxContent><w:p><w:r><w:t>Old second</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></v:group></w:pict>"##;
        let image: ImageRunNode = serde_json::from_value(serde_json::json!({
            "type": "image", "syntheticTextBox": true, "textBoxText": "First current\nSecond current",
            "widthPx": 160.0, "heightPx": 80.0, "sourceXml": source,
            "src": "data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22160%22%20height=%2280%22%3E%3Ctext%3EFirst%20current%20Second%20current%3C/text%3E%3C/svg%3E",
            "contentNodes": [
                {"type":"paragraph", "sourceXml":"<w:p><w:r><w:t>Stale cache</w:t></w:r></w:p>", "children":[{"type":"text", "text":"First current", "style":{"bold":true}}]},
                {"type":"paragraph", "children":[{"type":"text", "text":"Second current"}]}
            ]
        })).unwrap();
        (package, model, image)
    }

    fn export(package: &OoxmlPackage, mut model: DocModel, image: ImageRunNode) -> OoxmlPackage {
        let DocNode::Paragraph(paragraph) = &mut model.nodes[0] else {
            panic!("paragraph")
        };
        paragraph.source_xml = None;
        paragraph.children = vec![ParagraphChildNode::Image(Box::new(image))];
        serialize_doc_model(&model, Some(package))
    }

    #[test]
    fn edited_vml_textbox_preserves_stories_artwork_and_current_styles() {
        let (package, model, image) = fixture();
        let exported = export(&package, model, image);
        let xml = &exported.parts["word/document.xml"].content;
        let document = roxmltree::Document::parse(xml).unwrap();
        assert_eq!(
            document
                .descendants()
                .filter(|node| node.has_tag_name((WORD_MAIN_NS, "txbxContent")))
                .count(),
            2
        );
        assert!(xml.contains("First current"));
        assert!(xml.contains("Second current"));
        assert!(xml.contains("<w:b/>"));
        assert!(
            !xml.contains("Old first")
                && !xml.contains("Old second")
                && !xml.contains("Stale cache")
        );
        assert!(xml.contains(r##"fillcolor="#123456""##));
        assert!(xml.contains(r#"r:id="rIdBitmap""#));
        assert!(!xml.contains("<w:drawing>"));
        assert_eq!(exported.binary_assets, package.binary_assets);
        assert!(exported.parts["word/_rels/document.xml.rels"]
            .content
            .contains("media/original.png"));
    }

    #[test]
    fn edited_vml_textbox_accepts_empty_proofing_markers() {
        for kind in ["spellStart", "spellEnd", "gramStart", "gramEnd"] {
            let (package, model, mut image) = fixture();
            image.source_xml = image.source_xml.map(|source| source.replace("<w:p>", &format!("<w:p><w:proofErr w:type=\"{kind}\"/>")));
            let exported = export(&package, model, image);
            let xml = &exported.parts["word/document.xml"].content;
            let document = roxmltree::Document::parse(xml).unwrap();
            assert_eq!(document.descendants().filter(|node| node.has_tag_name((WORD_MAIN_NS, "txbxContent"))).count(), 2);
            assert_eq!(document.descendants().filter(|node| node.has_tag_name((VML_NS, "imagedata"))).count(), 1);
            assert!(xml.contains("First current") && xml.contains("Second current"));
            assert!(!xml.contains("<w:drawing>"));
            assert_eq!(exported.binary_assets, package.binary_assets);
        }
    }

    #[test]
    fn edited_vml_textbox_rejects_invalid_proofing_markers() {
        for marker in [
            r#"<w:proofErr/>"#,
            r#"<w:proofErr w:type="unknown"/>"#,
            r#"<w:proofErr w:type="spellStart"><w:t>Hidden</w:t></w:proofErr>"#,
            r#"<w:proofErr w:type="spellStart">Hidden</w:proofErr>"#,
            r#"<w:proofErr w:type="spellStart" w:id="1"/>"#,
            r#"<w:proofErr xmlns:w="urn:unrelated" w:type="spellStart"/>"#,
            r#"<w:r><w:proofErr w:type="spellStart"/></w:r>"#,
            r#"<w:pPr><w:proofErr w:type="spellStart"/></w:pPr>"#,
        ] {
            let (package, model, mut image) = fixture();
            image.source_xml = image.source_xml.map(|source| source.replace("<w:p>", &format!("<w:p>{marker}")));
            let exported = export(&package, model, image);
            let xml = &exported.parts["word/document.xml"].content;
            assert!(xml.contains("<w:drawing>"));
            assert!(!xml.contains("<w:txbxContent"));
            assert!(exported.binary_assets.contains_key("word/media/original.png"));
        }
    }

    #[test]
    fn edited_vml_textbox_keeps_story_blank_paragraphs_and_empty_placeholders() {
        let (package, model, mut image) = fixture();
        image.source_xml = image.source_xml.map(|source| {
            source.replace(
                "<w:p><w:r><w:t>Old first</w:t></w:r></w:p>",
                "<w:p/><w:p/><w:p/>",
            )
        });
        image.content_nodes = Some(
            serde_json::from_value(serde_json::json!([
                {"type":"paragraph", "children":[]},
                {"type":"paragraph", "children":[{"type":"text", "text":"Centered"}]},
                {"type":"paragraph", "children":[]},
                {"type":"paragraph", "children":[]}
            ]))
            .unwrap(),
        );
        image.text_box_text = Some("\nCentered\n".into());
        let exported = export(&package, model, image);
        let xml = &exported.parts["word/document.xml"].content;
        let document = roxmltree::Document::parse(xml).unwrap();
        let stories: Vec<_> = document
            .descendants()
            .filter(|node| node.has_tag_name((WORD_MAIN_NS, "txbxContent")))
            .collect();
        assert_eq!(stories.len(), 2);
        assert_eq!(
            stories[0]
                .children()
                .filter(|node| node.is_element())
                .count(),
            3
        );
        assert_eq!(
            stories[1]
                .children()
                .filter(|node| node.is_element())
                .count(),
            1
        );
        assert!(xml.contains("Centered"));
        assert!(!xml.contains("<w:drawing>"));
    }

    #[test]
    fn edited_vml_textbox_retains_run_namespace_bindings() {
        let (package, model, mut image) = fixture();
        image.source_xml = image.source_xml.map(|source| format!(r#"<!-- leading --><w:r xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" w14:textId="ABC"><w:rPr><w:b/></w:rPr>{source}</w:r>"#));
        let exported = export(&package, model, image);
        let xml = &exported.parts["word/document.xml"].content;
        roxmltree::Document::parse(xml).unwrap();
        assert!(xml.contains(r#"w14:textId="ABC""#));
        assert!(xml.contains("First current"));
        assert!(xml.contains("<w:pict>"));
    }

    #[test]
    fn edited_vml_textbox_rejects_stale_geometry_and_unproven_story_mapping() {
        for change in 0..11 {
            let (mut package, model, mut image) = fixture();
            match change {
                0 => image.width_px = Some(320.0),
                1 => image.text_box_text = Some("Mismatch".into()),
                2 => {
                    image.content_nodes.as_mut().unwrap().pop();
                }
                3 => {
                    package.binary_assets.clear();
                }
                4 => {
                    image.source_xml = image
                        .source_xml
                        .map(|source| source.replace("width:160px", "width:161px"))
                }
                5 => {
                    image.source_xml = image.source_xml.map(|source| {
                        source.replace("<w:pict>", "<w:pict xmlns:v=\"urn:unsupported\">")
                    })
                }
                6 => {
                    image.floating =
                        Some(serde_json::from_value(serde_json::json!({"xPx":20.0})).unwrap())
                }
                7 => {
                    image.source_xml = image
                        .source_xml
                        .map(|source| source.replace("width:160px", "width:160px;width:300px"))
                }
                8 => {
                    image.source_xml = image.source_xml.map(|source| {
                        source.replace(
                        "<w:t>Old first</w:t>",
                        "<w:pict><v:group><w:txbxContent><w:p/></w:txbxContent></v:group></w:pict>",
                    )
                    })
                }
                9 => {
                    image.source_xml = image
                        .source_xml
                        .map(|source| source.replace("width:160px", "min-width:160px"))
                }
                10 => {
                    image.source_xml = image
                        .source_xml
                        .map(|source| source.replace("width:160px", "width:160pxgarbage"))
                }
                _ => unreachable!(),
            }
            let expected = decode_data_uri(image.src.as_deref().unwrap()).unwrap().1;
            let exported = export(&package, model, image);
            let xml = &exported.parts["word/document.xml"].content;
            assert!(xml.contains("<w:drawing>"), "case {change}");
            assert!(!xml.contains("<w:pict>"), "case {change}");
            assert!(exported
                .binary_assets
                .values()
                .any(|bytes| bytes == &expected));
        }
    }

    #[test]
    fn edited_vml_textbox_rebinds_generated_text_and_hyperlinks() {
        let (package, model, mut image) = fixture();
        image.source_xml = image.source_xml.map(|source| source.replace("w:", "ww:").replace("r:id", "rr:id").replace("<ww:pict>", &format!("<ww:pict xmlns:ww=\"{WORD_MAIN_NS}\" xmlns:rr=\"{OFFICE_REL_NS}\" xmlns:w=\"urn:other-word\" xmlns:r=\"urn:other-rel\" xmlns:w14=\"urn:other-word14\">")));
        let DocNode::Paragraph(paragraph) = &mut image.content_nodes.as_mut().unwrap()[0] else {
            panic!("paragraph")
        };
        let ParagraphChildNode::Text(run) = &mut paragraph.children[0] else {
            panic!("text")
        };
        run.link = Some("https://example.invalid/current".into());
        run.style =
            Some(serde_json::from_value(serde_json::json!({"contextualAlternates":true})).unwrap());
        let exported = export(&package, model, image);
        let xml = &exported.parts["word/document.xml"].content;
        let document = roxmltree::Document::parse(xml).unwrap();
        let link = document
            .descendants()
            .find(|node| node.has_tag_name((WORD_MAIN_NS, "hyperlink")))
            .unwrap();
        assert!(link.attribute((OFFICE_REL_NS, "id")).is_some());
        assert!(document.descendants().any(|node| node.has_tag_name((
            "http://schemas.microsoft.com/office/word/2010/wordml",
            "cntxtAlts"
        ))));
        assert!(document
            .descendants()
            .any(|node| node.has_tag_name((WORD_MAIN_NS, "t"))
                && node.text() == Some("First current")));
        assert!(!xml.contains("<w:drawing>"));
    }

    #[test]
    fn edited_vml_textbox_uses_unrounded_group_dimensions() {
        let text =
            format!("<v:group xmlns:v=\"{VML_NS}\" style=\"width:610pt;height:145.950pt\"/>");
        let document = roxmltree::Document::parse(&text).unwrap();
        let (width, height, anchor) = vml_source_frame(document.root_element()).unwrap();
        assert_eq!(width, 813.3333333333333);
        assert_eq!(height, 194.59999999999997);
        assert_eq!(anchor, None);
    }

    #[test]
    fn edited_vml_textbox_preserves_fractional_margin_anchors() {
        let (package, model, mut image) = fixture();
        image.source_xml = image.source_xml.map(|source| source.replace(
            "width:160px;height:80px",
            "position:absolute;left:5px;top:6px;margin-left:-22.1pt;margin-top:-14.4pt;z-index:-1;width:160px;height:80px",
        ));
        image.floating = Some(serde_json::from_value(serde_json::json!({
            "xPx": -22.1 * (96.0 / 72.0),
            "yPx": -14.4 * (96.0 / 72.0),
            "behindDocument": true,
            "zIndex": -1,
        })).unwrap());
        let exported = export(&package, model.clone(), image.clone());
        let xml = &exported.parts["word/document.xml"].content;
        assert!(xml.contains("<v:group"));
        assert!(xml.contains("margin-left:-22.1pt;margin-top:-14.4pt"));
        assert!(!xml.contains("<w:drawing>"));
        image.floating.as_mut().unwrap().x_px = Some(-29.0);
        let changed = export(&package, model, image);
        assert!(changed.parts["word/document.xml"].content.contains("<w:drawing>"));
    }

    #[test]
    fn edited_vml_textbox_preserves_direct_wrap_with_alternate_prefix() {
        let (package, model, mut image) = fixture();
        image.source_xml = image.source_xml.map(|source| {
            source.replace(
                "</v:group>",
                &format!("<wrap:wrap xmlns:wrap=\"{VML_WORD_NS}\" type=\"none\"/></v:group>"),
            )
        });
        image.floating =
            Some(serde_json::from_value(serde_json::json!({"wrapType":"none"})).unwrap());
        let exported = export(&package, model, image);
        let xml = &exported.parts["word/document.xml"].content;
        roxmltree::Document::parse(xml).unwrap();
        assert!(xml.contains("<wrap:wrap"));
        assert!(!xml.contains("<w:drawing>"));
    }

    fn assert_bookmarked_paragraph_count(count: usize) {
        let (package, model, mut image) = fixture();
        let markers: Vec<_> = (0..4)
            .map(|index| {
                (
                    format!("<w:bookmarkStart w:id=\"{index}\" w:name=\"range{index}\"/>"),
                    format!("<w:bookmarkEnd w:id=\"{index}\"/>"),
                )
            })
            .collect();
        let mut edges = vec![(String::new(), String::new()); count];
        for (index, (start, end)) in markers.iter().enumerate() {
            let target = index.min(count - 1);
            if index >= count {
                edges[target].1.push_str(start);
            } else {
                edges[target].0.push_str(start);
            }
            edges[target].1.push_str(end);
        }
        let source_paragraphs = edges.iter().map(|(before, after)| format!("<w:p><w:pPr><w:jc w:val=\"center\"/></w:pPr>{before}<w:r><w:t>Previous</w:t></w:r>{after}</w:p>")).collect::<String>();
        image.source_xml = image.source_xml.map(|source| {
            source.replace(
                "<w:p><w:r><w:t>Old first</w:t></w:r></w:p>",
                &source_paragraphs,
            )
        });
        let lines: Vec<_> = (0..count).map(|index| format!("Current {index}")).collect();
        let mut content: Vec<DocNode> = lines.iter().map(|line| serde_json::from_value(serde_json::json!({
            "type":"paragraph", "style":{"align":"center"}, "children":[{"type":"text", "text":line}]
        })).unwrap()).collect();
        content.push(image.content_nodes.as_ref().unwrap()[1].clone());
        image.content_nodes = Some(content);
        image.text_box_text = Some(format!("{}\nSecond current", lines.join("\n")));
        let exported = export(&package, model, image);
        let xml = &exported.parts["word/document.xml"].content;
        let document = roxmltree::Document::parse(xml).unwrap();
        let stories: Vec<_> = document
            .descendants()
            .filter(|node| node.has_tag_name((WORD_MAIN_NS, "txbxContent")))
            .collect();
        assert_eq!(stories.len(), 2);
        let paragraphs: Vec<_> = stories[0]
            .children()
            .filter(|node| node.has_tag_name((WORD_MAIN_NS, "p")))
            .collect();
        assert_eq!(paragraphs.len(), count);
        let actual: Vec<_> = stories[0]
            .descendants()
            .filter(|node| {
                node.has_tag_name((WORD_MAIN_NS, "bookmarkStart"))
                    || node.has_tag_name((WORD_MAIN_NS, "bookmarkEnd"))
            })
            .map(|node| xml[node.range()].to_owned())
            .collect();
        let expected: Vec<_> = markers
            .iter()
            .flat_map(|(start, end)| [start.clone(), end.clone()])
            .collect();
        assert_eq!(actual, expected);
        for (index, paragraph) in paragraphs.iter().enumerate() {
            let text = paragraph
                .descendants()
                .find(|node| node.has_tag_name((WORD_MAIN_NS, "t")))
                .unwrap();
            assert_eq!(text.text(), Some(lines[index].as_str()));
            let raw = &xml[paragraph.range()];
            let before_position = raw.find(&edges[index].0).unwrap();
            if !edges[index].0.is_empty() {
                assert!(before_position < raw.find("<w:r>").unwrap());
                assert!(before_position > raw.find("</w:pPr>").unwrap());
            }
            if !edges[index].1.is_empty() {
                assert!(raw.find(&edges[index].1).unwrap() > raw.find("</w:r>").unwrap());
            }
        }
        assert_eq!(exported.binary_assets, package.binary_assets);
        assert!(xml.contains("r:id=\"rIdBitmap\""));
        assert!(!xml.contains("<w:drawing>") && !xml.contains("Previous"));
    }

    #[test]
    fn edited_vml_textbox_preserves_bookmarks_at_normal_paragraph_count() {
        assert_bookmarked_paragraph_count(4);
    }

    #[test]
    fn edited_vml_textbox_preserves_relocated_bookmarks_after_paragraph_reduction() {
        assert_bookmarked_paragraph_count(2);
    }

    #[test]
    fn edited_vml_textbox_does_not_duplicate_bookmarks_after_paragraph_increase() {
        assert_bookmarked_paragraph_count(6);
    }

    #[test]
    fn edited_vml_textbox_preserves_empty_paragraph_bookmark_edges() {
        let (package, model, mut image) = fixture();
        let start = "<w:bookmarkStart w:id=\"0\" w:name=\"empty\"/>";
        let end = "<w:bookmarkEnd w:id=\"0\"/>";
        image.source_xml = image.source_xml.map(|source| {
            source.replace(
                "<w:p><w:r><w:t>Old first</w:t></w:r></w:p>",
                &format!("<w:p>{start}<w:r><w:t/></w:r>{end}</w:p>"),
            )
        });
        image.content_nodes.as_mut().unwrap()[0] =
            serde_json::from_value(serde_json::json!({"type":"paragraph", "children":[]})).unwrap();
        image.text_box_text = Some("Second current".into());
        let exported = export(&package, model, image);
        let xml = &exported.parts["word/document.xml"].content;
        roxmltree::Document::parse(xml).unwrap();
        assert!(xml.contains(&format!("{start}{end}<w:r><w:t/></w:r>")));
        assert!(!xml.contains("<w:drawing>"));
        assert_eq!(exported.binary_assets, package.binary_assets);
    }

    #[test]
    fn edited_vml_textbox_rejects_ambiguous_bookmark_ranges() {
        let start = "<w:bookmarkStart w:id=\"0\" w:name=\"range\"/>";
        let end = "<w:bookmarkEnd w:id=\"0\"/>";
        for case in 0..11 {
            let (package, model, mut image) = fixture();
            let replacement = match case {
                0 => format!("<w:p><w:r><w:t>A</w:t></w:r>{start}<w:r><w:t>B</w:t></w:r>{end}</w:p>"),
                1 => format!("<w:p>{start}<w:r><w:t>A</w:t></w:r></w:p><w:p><w:r><w:t>B</w:t></w:r>{end}</w:p>"),
                2 => format!("<w:p>{start}<w:r><w:t>A</w:t></w:r></w:p>"),
                3 => format!("<w:p>{end}<w:r><w:t>A</w:t></w:r>{start}</w:p>"),
                4 => format!("<w:p>{start}{end}{start}<w:r><w:t>A</w:t></w:r>{end}</w:p>"),
                5 => format!("<w:p><w:r><w:rPr>{start}{end}</w:rPr><w:t>A</w:t></w:r></w:p>"),
                6 => format!("<w:p><w:bookmarkStart w:name=\"range\"/><w:r><w:t>A</w:t></w:r>{end}</w:p>"),
                7 => format!("<w:p>{start}<w:r><w:t>A</w:t></w:r>{end}</w:p>"),
                8 => format!("<w:p><w:bookmarkStart w:id=\"0\" W:name=\"range\"/><w:r><w:t>A</w:t></w:r>{end}</w:p>"),
                9 => format!("<w:p><w:bookmarkStart w:id=\"0\" w:name=\"range\">payload</w:bookmarkStart><w:r><w:t>A</w:t></w:r>{end}</w:p>"),
                10 => format!("<w:p><w:bookmarkStart w:id=\"0\" W:name=\"range w:name='shadow'\"/><w:r><w:t>A</w:t></w:r>{end}</w:p>"),
                _ => unreachable!(),
            };
            image.source_xml = image.source_xml.map(|source| {
                let source =
                    source.replace("<w:p><w:r><w:t>Old first</w:t></w:r></w:p>", &replacement);
                if case == 2 {
                    source.replace(
                        "<w:t>Old second</w:t></w:r>",
                        &format!("<w:t>Old second</w:t></w:r>{end}"),
                    )
                } else if case == 8 || case == 10 {
                    source.replacen(
                        "<w:txbxContent>",
                        &format!("<w:txbxContent xmlns:W=\"{WORD_MAIN_NS}\">"),
                        1,
                    )
                } else if case == 7 {
                    source.replace(
                        "<w:p><w:r><w:t>Old second</w:t></w:r></w:p>",
                        &format!("<w:p>{start}<w:r><w:t>Old second</w:t></w:r>{end}</w:p>"),
                    )
                } else {
                    source
                }
            });
            if case == 1 {
                let duplicate = image.content_nodes.as_ref().unwrap()[0].clone();
                image.content_nodes.as_mut().unwrap().insert(1, duplicate);
                image.text_box_text = Some("First current\nFirst current\nSecond current".into());
            }
            let expected = decode_data_uri(image.src.as_deref().unwrap()).unwrap().1;
            let exported = export(&package, model, image);
            let xml = &exported.parts["word/document.xml"].content;
            assert!(xml.contains("<w:drawing>"), "case {case}");
            assert!(!xml.contains("bookmarkStart"), "case {case}");
            assert!(exported
                .binary_assets
                .values()
                .any(|bytes| bytes == &expected));
        }
    }

    #[test]
    fn edited_vml_textbox_resolves_relationships_from_owning_part() {
        let (mut package, _, image) = fixture();
        let mut relationships = package
            .parts
            .remove("word/_rels/document.xml.rels")
            .unwrap();
        relationships.name = "word/headers/_rels/header.xml.rels".into();
        relationships.content = relationships
            .content
            .replace("media/original.png", "../media/original.png");
        package
            .parts
            .insert(relationships.name.clone(), relationships);
        let mut state = create_image_serialization_state(&mut package, "word/headers/header.xml");
        let xml = edited_vml_textbox_run_xml(&image, &mut state, 1).unwrap();
        assert!(xml.contains("<w:pict>"));
        assert!(xml.contains("First current"));
    }

    fn add_font_theme(package: &mut OoxmlPackage) {
        for (name, content) in [
            ("word/theme/theme1.xml", r#"<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme name="Theme"><a:majorFont><a:latin typeface="Major Latin"/><a:ea typeface="Major East Asia"/><a:cs typeface="Major Complex"/></a:majorFont><a:minorFont><a:latin typeface="Minor Latin"/><a:ea typeface="Minor East Asia"/><a:cs typeface="Minor Complex"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>"#),
            ("word/styles.xml", r#"<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Fallback" w:hAnsi="Fallback" w:eastAsia="Fallback" w:cs="Fallback" w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia" w:csTheme="minorBidi"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>"#),
        ] {
            package.parts.insert(name.into(), OoxmlPart { name: name.into(), content: content.into() });
        }
    }

    fn styled_roundtrip(properties: &str) -> (OoxmlPackage, TextStyle) {
        let xml = format!(r#"<w:document xmlns:w="{WORD_MAIN_NS}"><w:body><w:p><w:r><w:rPr>{properties}</w:rPr><w:t>Before</w:t></w:r></w:p></w:body></w:document>"#);
        let mut package = crate::create_minimal_docx_package(Some(&xml));
        add_font_theme(&mut package);
        let mut model = crate::build_doc_model(&package);
        let DocNode::Paragraph(paragraph) = &mut model.nodes[0] else { panic!("paragraph") };
        paragraph.source_xml = None;
        paragraph.source_text_patch = None;
        let ParagraphChildNode::Text(run) = &mut paragraph.children[0] else { panic!("run") };
        run.text = "After".into();
        let expected = run.style.as_deref().unwrap().clone();
        let exported = try_serialize_doc_model(&model, Some(&package)).unwrap();
        let reparsed = crate::build_doc_model(&exported);
        let DocNode::Paragraph(paragraph) = &reparsed.nodes[0] else { panic!("paragraph") };
        let ParagraphChildNode::Text(run) = &paragraph.children[0] else { panic!("run") };
        assert_eq!(run.text, "After");
        assert_eq!(run.style.as_deref(), Some(&expected));
        (exported, expected)
    }

    #[test]
    fn regenerated_runs_preserve_explicit_font_overrides_and_signed_spacing() {
        for spacing in [-36, 0, 11] {
            let (exported, style) = styled_roundtrip(&format!(r#"<w:rFonts w:ascii="Direct Latin" w:hAnsi="Direct High" w:eastAsia="Direct East" w:cs="Direct Complex"/><w:spacing w:val="{spacing}"/><w:w w:val="120"/>"#));
            assert_eq!(style.character_spacing_twips, Some(spacing));
            assert_eq!(style.character_scale_percent, Some(120));
            let xml = &exported.parts["word/document.xml"].content;
            let document = roxmltree::Document::parse(xml).unwrap();
            let fonts = document.descendants().find(|node| node.has_tag_name((WORD_MAIN_NS, "rFonts"))).unwrap();
            assert_eq!(fonts.attribute((WORD_MAIN_NS, "ascii")), Some("Direct Latin"));
            assert_eq!(fonts.attribute((WORD_MAIN_NS, "hAnsi")), Some("Direct High"));
            assert_eq!(fonts.attribute((WORD_MAIN_NS, "eastAsia")), Some("Direct East"));
            assert_eq!(fonts.attribute((WORD_MAIN_NS, "cs")), Some("Direct Complex"));
            for name in ["asciiTheme", "hAnsiTheme", "eastAsiaTheme", "csTheme"] {
                assert!(fonts.attribute((WORD_MAIN_NS, name)).is_none());
            }
            let properties = document.descendants().find(|node| {
                node.has_tag_name((WORD_MAIN_NS, "rPr"))
                    && node.parent().is_some_and(|parent| parent.has_tag_name((WORD_MAIN_NS, "r")))
            }).unwrap();
            let spacing_nodes: Vec<_> = properties.children().filter(|node| node.has_tag_name((WORD_MAIN_NS, "spacing"))).collect();
            assert_eq!(spacing_nodes.len(), 1);
            assert_eq!(spacing_nodes[0].attribute((WORD_MAIN_NS, "val")), Some(spacing.to_string().as_str()));
        }
    }

    #[test]
    fn regenerated_runs_preserve_actual_theme_bindings() {
        for fallback in ["Fallback", "Major Latin"] {
            let (exported, style) = styled_roundtrip(&format!(r#"<w:rFonts w:ascii="{fallback}" w:hAnsi="Major Latin" w:eastAsia="Major East Asia" w:cs="Major Complex" w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi" w:eastAsiaTheme="majorEastAsia" w:csTheme="majorBidi"/>"#));
            assert_eq!(style.resolved_font_family_ascii.as_deref(), Some("Major Latin"));
            let document = roxmltree::Document::parse(&exported.parts["word/document.xml"].content).unwrap();
            let fonts = document.descendants().find(|node| node.has_tag_name((WORD_MAIN_NS, "rFonts"))).unwrap();
            for (name, value) in [("asciiTheme", "majorHAnsi"), ("hAnsiTheme", "majorHAnsi"), ("eastAsiaTheme", "majorEastAsia"), ("csTheme", "majorBidi")] {
                assert_eq!(fonts.attribute((WORD_MAIN_NS, name)), Some(value));
            }
        }
    }

    #[test]
    fn regenerated_runs_resolve_each_font_slot_independently() {
        let (exported, style) = styled_roundtrip(r#"<w:rFonts w:ascii="Direct Latin" w:cs="Direct Complex" w:hAnsiTheme="majorHAnsi" w:eastAsiaTheme="majorEastAsia"/>"#);
        assert_eq!(style.resolved_font_family_ascii.as_deref(), Some("Direct Latin"));
        assert_eq!(style.resolved_font_family_cs.as_deref(), Some("Direct Complex"));
        assert_eq!(style.resolved_font_family_h_ansi.as_deref(), Some("Major Latin"));
        assert_eq!(style.resolved_font_family_east_asia.as_deref(), Some("Major East Asia"));
        let document = roxmltree::Document::parse(&exported.parts["word/document.xml"].content).unwrap();
        let fonts = document.descendants().find(|node| node.has_tag_name((WORD_MAIN_NS, "rFonts"))).unwrap();
        assert!(fonts.attribute((WORD_MAIN_NS, "asciiTheme")).is_none());
        assert!(fonts.attribute((WORD_MAIN_NS, "csTheme")).is_none());
        assert_eq!(fonts.attribute((WORD_MAIN_NS, "hAnsiTheme")), Some("majorHAnsi"));
        assert_eq!(fonts.attribute((WORD_MAIN_NS, "eastAsiaTheme")), Some("majorEastAsia"));
    }

    #[test]
    fn regenerated_paragraph_marks_write_spacing_once() {
        let xml = format!(r#"<w:document xmlns:w="{WORD_MAIN_NS}"><w:body><w:p><w:pPr><w:rPr><w:rFonts w:ascii="Direct Latin"/><w:spacing w:val="-24"/></w:rPr></w:pPr><w:r><w:t>Body</w:t></w:r></w:p></w:body></w:document>"#);
        let mut package = crate::create_minimal_docx_package(Some(&xml));
        add_font_theme(&mut package);
        let mut model = crate::build_doc_model(&package);
        let DocNode::Paragraph(paragraph) = &mut model.nodes[0] else { panic!("paragraph") };
        paragraph.paragraph_mark_style.as_mut().unwrap().character_spacing_twips = Some(17);
        let expected = paragraph.paragraph_mark_style.clone();
        let exported = try_serialize_doc_model(&model, Some(&package)).unwrap();
        let document = roxmltree::Document::parse(&exported.parts["word/document.xml"].content).unwrap();
        let spacing: Vec<_> = document.descendants().filter(|node| node.has_tag_name((WORD_MAIN_NS, "spacing"))).collect();
        assert_eq!(spacing.len(), 1);
        assert_eq!(spacing[0].attribute((WORD_MAIN_NS, "val")), Some("17"));
        let reparsed = crate::build_doc_model(&exported);
        let DocNode::Paragraph(paragraph) = &reparsed.nodes[0] else { panic!("paragraph") };
        assert_eq!(paragraph.paragraph_mark_style, expected);
    }

    #[test]
    fn edited_vml_stories_preserve_inherited_theme_overrides_and_spacing() {
        let (mut package, _) = inline_paint_fixture();
        add_font_theme(&mut package);
        let part = package.parts.get_mut("word/document.xml").unwrap();
        part.content = part.content.replace("<w:b/>", r#"<w:b/><w:spacing w:val="-36"/><w:w w:val="120"/>"#);
        let mut model = crate::build_doc_model(&package);
        let DocNode::Paragraph(paragraph) = &mut model.nodes[0] else { panic!("paragraph") };
        paragraph.source_xml = None;
        paragraph.source_text_patch = None;
        let image = inline_image_mut(&mut model);
        let content = image.content_nodes.as_mut().unwrap();
        let DocNode::Paragraph(story) = &mut content[0] else { panic!("story") };
        let ParagraphChildNode::Text(run) = &mut story.children[0] else { panic!("run") };
        run.text.push('!');
        let expected: Vec<_> = content.iter().map(|node| {
            let DocNode::Paragraph(story) = node else { panic!("story") };
            story.children.clone()
        }).collect();
        image.text_box_text = Some(content.iter().map(|node| {
            let DocNode::Paragraph(story) = node else { panic!("story") };
            story.children.iter().map(|child| {
                let ParagraphChildNode::Text(run) = child else { panic!("run") };
                run.text.as_str()
            }).collect::<String>()
        }).collect::<Vec<_>>().join("\n"));
        let exported = try_serialize_doc_model(&model, Some(&package)).unwrap();
        assert_eq!(exported.binary_assets, package.binary_assets);
        let document = roxmltree::Document::parse(&exported.parts["word/document.xml"].content).unwrap();
        assert_eq!(document.descendants().filter(|node| node.has_tag_name((WORD_MAIN_NS, "txbxContent"))).count(), 2);
        assert_eq!(document.descendants().filter(|node| node.has_tag_name((VML_NS, "imagedata"))).count(), 1);
        let reparsed = crate::build_doc_model(&exported);
        let image = inline_image(&reparsed);
        let actual: Vec<_> = image.content_nodes.as_ref().unwrap().iter().map(|node| {
            let DocNode::Paragraph(story) = node else { panic!("story") };
            story.children.clone()
        }).collect();
        assert_eq!(actual, expected);
    }

    fn inline_paint_fixture() -> (OoxmlPackage, DocModel) {
        let xml = r##"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:pict><v:group style="width:270pt;height:105pt" coordorigin="0,0" coordsize="360,140"><v:shape id="bitmap" type="#_x0000_t75" style="position:absolute;left:10;top:18;width:45;height:45" stroked="f"><v:imagedata r:id="rIdBitmap"/></v:shape><v:line from="0,120" to="360,120" strokecolor="#3355aa" strokeweight="0.75pt"/><v:shape id="story-0" type="#_x0000_t202" style="position:absolute;left:65;top:12;width:190;height:40" filled="f" stroked="f"><v:textbox inset="0,0,0,0"><w:txbxContent><w:p><w:bookmarkStart w:id="0" w:name="story-0"/><w:r><w:rPr><w:rFonts w:ascii="Arial"/><w:b/><w:sz w:val="24"/></w:rPr><w:t>Original upper story</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p></w:txbxContent></v:textbox></v:shape><v:shape id="story-1" type="#_x0000_t202" style="position:absolute;left:145;top:67;width:190;height:40" filled="f" stroked="f"><v:textbox inset="0,0,0,0"><w:txbxContent><w:p><w:bookmarkStart w:id="1" w:name="story-1"/><w:r><w:rPr><w:rFonts w:ascii="Arial"/><w:b/><w:sz w:val="24"/></w:rPr><w:t>Original lower story</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p></w:txbxContent></v:textbox></v:shape></v:group></w:pict></w:r></w:p><w:p><w:r><w:t>Following body text</w:t></w:r></w:p></w:body></w:document>"##;
        let mut package = crate::create_minimal_docx_package(Some(xml));
        let bytes = decode_data_uri("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==").unwrap().1;
        package
            .binary_assets
            .insert("word/media/bitmap.png".into(), bytes);
        package.parts.insert("word/_rels/document.xml.rels".into(), OoxmlPart {
            name: "word/_rels/document.xml.rels".into(),
            content: format!(r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdBitmap" Type="{OFFICE_REL_NS}/image" Target="media/bitmap.png"/></Relationships>"#),
        });
        let mut model = crate::build_doc_model(&package);
        let DocNode::Paragraph(paragraph) = &mut model.nodes[0] else {
            panic!("paragraph")
        };
        paragraph.source_xml = None;
        paragraph.source_text_patch = None;
        (package, model)
    }

    fn floating_overflow_fixture() -> (OoxmlPackage, DocModel) {
        let (mut package, _) = inline_paint_fixture();
        let part = package.parts.get_mut("word/document.xml").unwrap();
        part.content = part.content.replace("width:270pt;height:105pt", "position:absolute;margin-left:24pt;margin-top:13pt;width:270pt;height:105pt;mso-position-horizontal-relative:page");
        part.content = part.content.replace("<v:textbox inset=", "<v:textbox style=\"v-text-anchor:top\" inset=");
        let mut model = crate::build_doc_model(&package);
        let DocNode::Paragraph(paragraph) = &mut model.nodes[0] else { panic!("paragraph") };
        paragraph.source_xml = None;
        paragraph.source_text_patch = None;
        assert_eq!(inline_image(&model).width_px, Some(361.0));
        assert_eq!(inline_image(&model).floating.as_ref().unwrap().x_px, Some(31.5));
        assert!(inline_image(&model).paint_bounds.is_none());
        (package, model)
    }

    #[test]
    fn floating_overflow_composites_preserve_stories_during_paragraph_regeneration() {
        for edited in [false, true] {
            let (package, mut model) = floating_overflow_fixture();
            let image = inline_image_mut(&mut model);
            if edited {
                let content = image.content_nodes.as_mut().unwrap();
                let DocNode::Paragraph(story) = &mut content[0] else { panic!("story") };
                let ParagraphChildNode::Text(run) = &mut story.children[0] else { panic!("run") };
                run.text.push('!');
                image.text_box_text = Some("Original upper story!\nOriginal lower story".into());
                image.source_xml = image.source_xml.as_ref().map(|xml| xml.replace("Original upper story</w:t>", "Original upper story!</w:t>"));
            }
            let expected = inline_image(&model).clone();
            let exported = try_serialize_doc_model(&model, Some(&package)).unwrap();
            assert_eq!(exported.binary_assets, package.binary_assets);
            let xml = &exported.parts["word/document.xml"].content;
            let document = roxmltree::Document::parse(xml).unwrap();
            assert_eq!(document.descendants().filter(|node| node.has_tag_name((WORD_MAIN_NS, "txbxContent"))).count(), 2);
            assert_eq!(document.descendants().filter(|node| node.has_tag_name((VML_NS, "imagedata"))).count(), 1);
            assert!(!xml.contains("<w:drawing>"));
            let reparsed = crate::build_doc_model(&exported);
            let actual = inline_image(&reparsed);
            assert_eq!(actual.width_px, expected.width_px);
            assert_eq!(actual.height_px, expected.height_px);
            assert_eq!(actual.floating, expected.floating);
            assert_eq!(actual.paint_bounds, expected.paint_bounds);
            let children = |image: &ImageRunNode| image.content_nodes.as_ref().unwrap().iter().map(|node| {
                let DocNode::Paragraph(story) = node else { panic!("story") };
                story.children.clone()
            }).collect::<Vec<_>>();
            assert_eq!(children(actual), children(&expected));
        }
    }

    #[test]
    fn floating_overflow_source_validation_rejects_changed_frame_anchor_and_viewport() {
        use base64::Engine;
        for case in 0..8 {
            let (mut package, mut model) = floating_overflow_fixture();
            let image = inline_image_mut(&mut model);
            match case {
                0 => image.width_px = Some(360.0),
                1 => image.height_px = Some(141.0),
                2 => image.floating.as_mut().unwrap().x_px = Some(32.0),
                3 => image.floating.as_mut().unwrap().y_px = Some(20.0),
                4 => image.floating.as_mut().unwrap().horizontal_relative_to = Some("margin".into()),
                5 | 6 | 7 => {
                    let (_, bytes) = decode_data_uri(image.src.as_deref().unwrap()).unwrap();
                    let svg = String::from_utf8(bytes).unwrap();
                    let svg = match case {
                        5 => svg.replace("viewBox=\"-0.5 0 361 140\"", "viewBox=\"0 0 361 140\""),
                        6 => svg.replace("width=\"361\"", "width=\"360\""),
                        _ => svg.replace("preserveAspectRatio=\"none\"", "preserveAspectRatio=\"xMidYMid meet\""),
                    };
                    image.src = Some(format!("data:image/svg+xml;base64,{}", base64::engine::general_purpose::STANDARD.encode(svg)));
                }
                _ => unreachable!(),
            }
            let state = create_image_serialization_state(&mut package, "word/document.xml");
            assert!(edited_vml_textbox_source_plan(image, &state.owner_part_name, &state.relationships, state.pkg).is_none(), "case {case}");
        }
    }

    #[test]
    fn regenerated_paragraphs_preserve_signed_edge_indents() {
        for (left, right) in [(-12, -240), (0, 0), (720, 360)] {
            let xml = format!(r#"<w:document xmlns:w="{WORD_MAIN_NS}"><w:body><w:p><w:pPr><w:ind w:left="{left}" w:right="{right}" w:firstLine="120"/></w:pPr><w:r><w:t>Paragraph text</w:t></w:r></w:p></w:body></w:document>"#);
            let package = crate::create_minimal_docx_package(Some(&xml));
            let mut model = crate::build_doc_model(&package);
            let DocNode::Paragraph(paragraph) = &mut model.nodes[0] else { panic!("paragraph") };
            let expected = paragraph.style.as_ref().unwrap().indent.clone();
            paragraph.source_xml = None;
            paragraph.source_text_patch = None;
            let exported = try_serialize_doc_model(&model, Some(&package)).unwrap();
            let document = roxmltree::Document::parse(&exported.parts["word/document.xml"].content).unwrap();
            let indent = document.descendants().find(|node| node.has_tag_name((WORD_MAIN_NS, "ind"))).unwrap();
            assert_eq!(indent.attribute((WORD_MAIN_NS, "left")), Some(left.to_string().as_str()));
            assert_eq!(indent.attribute((WORD_MAIN_NS, "right")), Some(right.to_string().as_str()));
            let reopened = crate::build_doc_model(&exported);
            let DocNode::Paragraph(paragraph) = &reopened.nodes[0] else { panic!("paragraph") };
            assert_eq!(paragraph.style.as_ref().unwrap().indent, expected);
        }
    }

    #[test]
    fn edited_floating_stories_preserve_signed_edge_indents() {
        let (mut package, _) = floating_overflow_fixture();
        let part = package.parts.get_mut("word/document.xml").unwrap();
        part.content = part.content.replace("<w:p><w:bookmarkStart", r#"<w:p><w:pPr><w:ind w:left="-12" w:right="-24"/></w:pPr><w:bookmarkStart"#);
        let mut model = crate::build_doc_model(&package);
        let DocNode::Paragraph(paragraph) = &mut model.nodes[0] else { panic!("paragraph") };
        paragraph.source_xml = None;
        paragraph.source_text_patch = None;
        let image = inline_image_mut(&mut model);
        image.source_xml = image.source_xml.as_ref().map(|xml| xml.replace("Original upper story</w:t>", "Original upper story!</w:t>"));
        image.text_box_text = Some("Original upper story!\nOriginal lower story".into());
        let content = image.content_nodes.as_mut().unwrap();
        let DocNode::Paragraph(story) = &mut content[0] else { panic!("story") };
        let ParagraphChildNode::Text(run) = &mut story.children[0] else { panic!("run") };
        run.text.push('!');
        let styles = |image: &ImageRunNode| image.content_nodes.as_ref().unwrap().iter().map(|node| {
            let DocNode::Paragraph(story) = node else { panic!("story") };
            story.style.clone()
        }).collect::<Vec<_>>();
        let expected = styles(inline_image(&model));
        let exported = try_serialize_doc_model(&model, Some(&package)).unwrap();
        let reopened = crate::build_doc_model(&exported);
        assert_eq!(styles(inline_image(&reopened)), expected);
    }

    #[test]
    fn floating_overflow_replay_requires_valid_owning_part_definitions() {
        let (mut package, model) = floating_overflow_fixture();
        let mut image = inline_image(&model).clone();
        image.source_xml = image.source_xml.map(|xml| xml.replace("Original upper story</w:t>", "Original upper story!</w:t>"));
        {
            let state = create_image_serialization_state(&mut package, "word/document.xml");
            assert!(edited_vml_textbox_source_plan(&image, &state.owner_part_name, &state.relationships, state.pkg).is_some());
            assert!(edited_vml_textbox_source_plan(&image, "word/missing.xml", &state.relationships, state.pkg).is_none());
        }
        let part = package.parts.get_mut("word/document.xml").unwrap();
        part.content = part.content.replace("<w:body>", r#"<w:body><v:shapetype id="_x0000_t75" coordsize="21600,21600" path="m0,0 l1,1 e"/>"#);
        let state = create_image_serialization_state(&mut package, "word/document.xml");
        assert!(edited_vml_textbox_source_plan(&image, &state.owner_part_name, &state.relationships, state.pkg).is_none());
    }

    fn inline_image(model: &DocModel) -> &ImageRunNode {
        let DocNode::Paragraph(paragraph) = &model.nodes[0] else {
            panic!("paragraph")
        };
        let ParagraphChildNode::Image(image) = &paragraph.children[0] else {
            panic!("image")
        };
        image
    }

    fn inline_image_mut(model: &mut DocModel) -> &mut ImageRunNode {
        let DocNode::Paragraph(paragraph) = &mut model.nodes[0] else {
            panic!("paragraph")
        };
        let ParagraphChildNode::Image(image) = &mut paragraph.children[0] else {
            panic!("image")
        };
        image
    }

    fn source_plan_preserves_bitmap_and_stories(package: &OoxmlPackage, model: &DocModel) {
        let before = inline_image(model);
        assert_eq!(
            (before.width_px, before.height_px, &before.floating),
            (Some(360.0), Some(140.0), &None)
        );
        let bounds = before.paint_bounds.as_deref().unwrap();
        assert_eq!(
            (
                bounds.x_px,
                bounds.y_px,
                bounds.width_px,
                bounds.height_px,
                bounds.layout_width_px,
                bounds.layout_height_px
            ),
            (-0.5, 0.0, 361.0, 140.0, 360.0, 140.0)
        );
        assert!(can_preserve_image_paint_source(
            before,
            Some(package),
            "word/document.xml"
        ));
        let exported = try_serialize_doc_model(model, Some(package)).unwrap();
        assert_eq!(exported.binary_assets, package.binary_assets);
        let document =
            roxmltree::Document::parse(&exported.parts["word/document.xml"].content).unwrap();
        assert_eq!(
            document
                .descendants()
                .filter(|node| node.has_tag_name((VML_NS, "imagedata")))
                .count(),
            1
        );
        assert_eq!(
            document
                .descendants()
                .filter(|node| node.has_tag_name((WORD_MAIN_NS, "txbxContent")))
                .count(),
            2
        );
        assert_eq!(
            document
                .descendants()
                .filter(|node| node.has_tag_name((WORD_MAIN_NS, "bookmarkStart")))
                .count(),
            2
        );
        let after_model = crate::build_doc_model(&exported);
        let after = inline_image(&after_model);
        assert_eq!(
            (after.width_px, after.height_px, &after.floating),
            (before.width_px, before.height_px, &before.floating)
        );
        assert_eq!(after.paint_bounds, before.paint_bounds);
        let story_children = |image: &ImageRunNode| {
            image.content_nodes.as_ref().unwrap().iter().map(|node| {
                let DocNode::Paragraph(paragraph) = node else { panic!("paragraph") };
                paragraph.children.clone()
            }).collect::<Vec<_>>()
        };
        assert_eq!(story_children(after), story_children(before));
        assert!(after.text_box_text.is_none());
        let (_, svg) = decode_data_uri(after.src.as_deref().unwrap()).unwrap();
        let svg = std::str::from_utf8(&svg).unwrap();
        let svg = roxmltree::Document::parse(svg).unwrap();
        assert_eq!(
            svg.descendants()
                .filter(|node| node.has_tag_name(("http://www.w3.org/2000/svg", "image")))
                .count(),
            1
        );
        assert_eq!(
            svg.root_element().attribute("viewBox"),
            Some("-0.5 0 361 140")
        );
    }

    #[test]
    fn inline_paint_source_regeneration_preserves_logical_frame_and_full_artwork() {
        let (package, model) = inline_paint_fixture();
        source_plan_preserves_bitmap_and_stories(&package, &model);
    }

    #[test]
    fn inline_paint_edited_export_preserves_current_stories_bookmarks_and_bitmap() {
        let (package, mut model) = inline_paint_fixture();
        let image = inline_image_mut(&mut model);
        let DocNode::Paragraph(paragraph) = &mut image.content_nodes.as_mut().unwrap()[0] else {
            panic!("paragraph")
        };
        let ParagraphChildNode::Text(run) = &mut paragraph.children[0] else {
            panic!("text")
        };
        run.text = "Edited upper story".into();
        image.text_box_text = Some("Edited upper story\nOriginal lower story".into());
        source_plan_preserves_bitmap_and_stories(&package, &model);
        let exported = try_serialize_doc_model(&model, Some(&package)).unwrap();
        assert!(exported.parts["word/document.xml"]
            .content
            .contains("Edited upper story"));
        assert!(!exported.parts["word/document.xml"]
            .content
            .contains("Original upper story"));
    }

    #[test]
    fn inline_paint_rejects_source_coordinate_and_viewport_mismatches_without_flattening() {
        use base64::Engine as _;
        for case in 0..6 {
            let (package, mut model) = inline_paint_fixture();
            let image = inline_image_mut(&mut model);
            match case {
                0 => image.paint_bounds.as_mut().unwrap().x_px = -0.25,
                1 => image.paint_bounds.as_mut().unwrap().layout_width_px = 361.0,
                2 => {
                    image.source_xml = image
                        .source_xml
                        .as_ref()
                        .map(|source| source.replace("coordorigin=\"0,0\"", "coordorigin=\"1,0\""))
                }
                3 => {
                    image.source_xml = image.source_xml.as_ref().map(|source| {
                        source.replace("coordsize=\"360,140\"", "coordsize=\"361,140\"")
                    })
                }
                4 | 5 => {
                    let (_, bytes) = decode_data_uri(image.src.as_deref().unwrap()).unwrap();
                    let svg = String::from_utf8(bytes).unwrap();
                    let svg = if case == 4 {
                        svg.replace("viewBox=\"-0.5 0 361 140\"", "viewBox=\"0 0 361 140\"")
                    } else {
                        svg.replace("width=\"361\"", "width=\"360\"")
                    };
                    image.src = Some(format!(
                        "data:image/svg+xml;base64,{}",
                        base64::engine::general_purpose::STANDARD.encode(svg)
                    ));
                }
                _ => unreachable!(),
            }
            assert!(
                !can_preserve_image_paint_source(image, Some(&package), "word/document.xml"),
                "case {case}"
            );
            assert!(
                serialize_docx(&model, Some(&package))
                    .unwrap_err()
                    .contains("full-viewport PNG"),
                "case {case}"
            );
        }
    }

    #[test]
    fn inline_paint_resize_requires_a_current_raster_instead_of_reusing_stale_source() {
        let (package, mut model) = inline_paint_fixture();
        let image = inline_image_mut(&mut model);
        image.width_px = Some(720.0);
        image.height_px = Some(280.0);
        assert!(valid_image_paint_bounds(image));
        assert!(!can_preserve_image_paint_source(
            image,
            Some(&package),
            "word/document.xml"
        ));
        assert!(try_serialize_doc_model(&model, Some(&package))
            .unwrap_err()
            .contains("full-viewport PNG"));
    }

    #[test]
    fn inline_paint_raster_fallback_preserves_continuous_overflow_after_resize() {
        let (package, mut model) = inline_paint_fixture();
        let image = inline_image_mut(&mut model);
        image.width_px = Some(720.0);
        image.height_px = Some(280.0);
        image.src = Some("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==".into());
        image.content_type = Some("image/png".into());
        image.source_xml = None;
        image.content_nodes = None;
        image.synthetic_text_box = None;
        image.text_box_text = None;
        let expected_png = decode_data_uri(image.src.as_deref().unwrap()).unwrap().1;
        let exported = try_serialize_doc_model(&model, Some(&package)).unwrap();
        let xml = &exported.parts["word/document.xml"].content;
        let document = roxmltree::Document::parse(xml).unwrap();
        let group = document
            .descendants()
            .find(|node| node.has_tag_name((VML_NS, "group")))
            .unwrap();
        assert_eq!(
            group.attribute("style"),
            Some("position:static;width:720px;height:280px")
        );
        assert_eq!(group.attribute("coordsize"), Some("720,280"));
        let shape = group
            .children()
            .find(|node| node.has_tag_name((VML_NS, "shape")))
            .unwrap();
        assert_eq!(
            shape.attribute("style"),
            Some("position:absolute;left:-1;top:0;width:722;height:280")
        );
        assert!(!document
            .descendants()
            .any(|node| node.has_tag_name((WORD_MAIN_NS, "txbxContent"))));
        assert!(exported
            .binary_assets
            .values()
            .any(|value| value == &expected_png));
        let reparsed = crate::build_doc_model(&exported);
        let image = inline_image(&reparsed);
        assert_eq!(
            (image.width_px, image.height_px, &image.floating),
            (Some(720.0), Some(280.0), &None)
        );
        let bounds = image.paint_bounds.as_deref().unwrap();
        assert_eq!(
            (bounds.x_px, bounds.y_px, bounds.width_px, bounds.height_px),
            (-1.0, 0.0, 722.0, 280.0)
        );
    }

    #[test]
    fn inline_paint_rejects_nonfinite_or_unrepresentable_geometry() {
        for case in 0..7 {
            let (package, mut model) = inline_paint_fixture();
            let image = inline_image_mut(&mut model);
            let bounds = image.paint_bounds.as_mut().unwrap();
            match case {
                0 => bounds.x_px = f64::NAN,
                1 => bounds.height_px = 0.0,
                2 => bounds.layout_width_px = f64::INFINITY,
                3 => bounds.layout_width_px = f64::MIN_POSITIVE,
                4 => image.width_px = Some(f64::MAX),
                5 => image.height_px = Some(-1.0),
                6 => {
                    image.floating =
                        Some(serde_json::from_value(serde_json::json!({"xPx":0.0})).unwrap())
                }
                _ => unreachable!(),
            }
            assert!(
                serialize_docx(&model, Some(&package))
                    .unwrap_err()
                    .contains("finite positive geometry"),
                "case {case}"
            );
        }
    }

    #[test]
    fn inline_paint_source_uses_the_default_coordinate_extent() {
        let (mut package, _) = inline_paint_fixture();
        let part = package.parts.get_mut("word/document.xml").unwrap();
        part.content = part.content.replace(" coordsize=\"360,140\"", "");
        let mut model = crate::build_doc_model(&package);
        let DocNode::Paragraph(paragraph) = &mut model.nodes[0] else {
            panic!("paragraph")
        };
        paragraph.source_xml = None;
        assert!(can_preserve_image_paint_source(
            inline_image(&model),
            Some(&package),
            "word/document.xml"
        ));
        let before = inline_image(&model).paint_bounds.clone();
        let exported = try_serialize_doc_model(&model, Some(&package)).unwrap();
        let reparsed = crate::build_doc_model(&exported);
        assert_eq!(inline_image(&reparsed).paint_bounds, before);
        assert_eq!(exported.binary_assets, package.binary_assets);
    }

    #[test]
    fn inline_paint_validator_uses_first_wins_normalized_header_owner() {
        let (mut package, mut model) = inline_paint_fixture();
        let header_nodes = vec![model.nodes.remove(0)];
        let mut relationship = package
            .parts
            .remove("word/_rels/document.xml.rels")
            .unwrap();
        relationship.name = "word/headers/_rels/header.xml.rels".into();
        relationship.content = relationship
            .content
            .replace("media/bitmap.png", "../media/bitmap.png");
        package
            .parts
            .insert(relationship.name.clone(), relationship);
        model.metadata.header_sections.push(HeaderSection {
            part_name: "/word/headers/header.xml".into(),
            reference_type: None,
            nodes: header_nodes.clone(),
        });
        let mut rejected_nodes = header_nodes.clone();
        let DocNode::Paragraph(paragraph) = &mut rejected_nodes[0] else {
            panic!("paragraph")
        };
        let ParagraphChildNode::Image(image) = &mut paragraph.children[0] else {
            panic!("image")
        };
        image.paint_bounds.as_mut().unwrap().width_px = 0.0;
        model.metadata.footer_sections.push(FooterSection {
            part_name: "word/headers/header.xml".into(),
            reference_type: None,
            nodes: rejected_nodes,
        });
        assert!(validate_image_paint_bounds(&model, Some(&package)).is_ok());
        let exported = try_serialize_doc_model(&model, Some(&package)).unwrap();
        assert!(exported.parts["word/headers/header.xml"]
            .content
            .contains("Original upper story"));
        assert!(exported.parts["word/headers/_rels/header.xml.rels"]
            .content
            .contains("../media/bitmap.png"));
    }

    #[test]
    fn inline_paint_validator_ignores_note_and_comment_node_projections() {
        let (package, mut model) = inline_paint_fixture();
        inline_image_mut(&mut model)
            .paint_bounds
            .as_mut()
            .unwrap()
            .width_px = 0.0;
        let ignored_nodes = vec![model.nodes.remove(0)];
        model.metadata.footnotes = Some(vec![DocumentNoteDefinition {
            id: 1,
            text: "Retained note".into(),
            nodes: Some(ignored_nodes.clone()),
        }]);
        let mut comment: DocumentCommentDefinition =
            serde_json::from_value(serde_json::json!({"id":1,"text":"Retained comment"})).unwrap();
        comment.nodes = Some(ignored_nodes);
        model.metadata.comments = Some(vec![comment]);
        assert!(validate_image_paint_bounds(&model, Some(&package)).is_ok());
    }

    #[test]
    fn inline_paint_raster_requires_a_real_overflow_viewport() {
        for (x, width) in [(0.0, 360.0), (10.0, 100.0), (-100.0, 361.0)] {
            let (package, mut model) = inline_paint_fixture();
            let image = inline_image_mut(&mut model);
            image.src = Some("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==".into());
            image.content_type = Some("image/png".into());
            image.source_xml = None;
            let bounds = image.paint_bounds.as_mut().unwrap();
            bounds.x_px = x;
            bounds.width_px = width;
            assert!(try_serialize_doc_model(&model, Some(&package))
                .unwrap_err()
                .contains("full-viewport PNG"));
        }
    }

    #[test]
    fn inline_paint_fractional_raster_mapping_keeps_unit_coordinates_exact() {
        let (package, mut model) = inline_paint_fixture();
        let image = inline_image_mut(&mut model);
        image.width_px = Some(3.0);
        image.height_px = Some(140.0);
        image.paint_bounds = Some(Box::new(ImagePaintBounds {
            x_px: -0.1,
            y_px: 0.0,
            width_px: 3.2,
            height_px: 140.0,
            layout_width_px: 3.0,
            layout_height_px: 140.0,
        }));
        image.src = Some("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==".into());
        image.content_type = Some("image/png".into());
        image.source_xml = None;
        image.content_nodes = None;
        image.synthetic_text_box = None;
        image.text_box_text = None;
        let exported = try_serialize_doc_model(&model, Some(&package)).unwrap();
        let xml = &exported.parts["word/document.xml"].content;
        assert!(xml.contains("coordsize=\"3,140\""));
        assert!(xml.contains("left:-0.1;top:0;width:3.2;height:140"));
        let reparsed = crate::build_doc_model(&exported);
        let image = inline_image(&reparsed);
        assert_eq!((image.width_px, image.height_px), (Some(3.0), Some(140.0)));
        let bounds = image.paint_bounds.as_deref().unwrap();
        assert_eq!(bounds.x_px, -0.1);
        assert_eq!(
            bounds.width_px,
            ((-0.1_f64 + 3.2_f64).max(3.0)) - (-0.1_f64)
        );
        assert_eq!(bounds.layout_width_px, 3.0);
    }

    #[test]
    fn inline_paint_all_public_output_boundaries_reject_unsupported_geometry() {
        let (package, mut model) = inline_paint_fixture();
        inline_image_mut(&mut model)
            .paint_bounds
            .as_mut()
            .unwrap()
            .width_px = 0.0;
        assert!(validate_image_paint_bounds(&model, Some(&package)).is_err());
        assert!(try_serialize_doc_model(&model, Some(&package)).is_err());
        assert!(serialize_docx(&model, Some(&package)).is_err());
        assert!(std::panic::catch_unwind(|| serialize_doc_model(&model, Some(&package))).is_err());
        assert!(
            std::panic::catch_unwind(|| model_to_document_xml(&model, Some(&package))).is_err()
        );
    }

    #[test]
    fn inline_paint_raster_rejects_overflow_lost_during_scaling() {
        let (package, mut model) = inline_paint_fixture();
        let image = inline_image_mut(&mut model);
        image.width_px = Some(f64::MIN_POSITIVE);
        image.paint_bounds = Some(Box::new(ImagePaintBounds {
            x_px: -f64::MIN_POSITIVE,
            y_px: 0.0,
            width_px: 2.0,
            height_px: 140.0,
            layout_width_px: 2.0,
            layout_height_px: 140.0,
        }));
        image.src = Some("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==".into());
        image.content_type = Some("image/png".into());
        image.source_xml = None;
        assert!(valid_image_paint_bounds(image));
        assert!(try_serialize_doc_model(&model, Some(&package))
            .unwrap_err()
            .contains("full-viewport PNG"));
    }
}
