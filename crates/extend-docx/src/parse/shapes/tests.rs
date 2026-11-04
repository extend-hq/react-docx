use super::*;

#[test]
fn ellipse_preset_uses_both_radii() {
    assert_eq!(
        drawing_preset_path_data(Some("ellipse"), 33, 12).as_deref(),
        Some("M0 6 A16.5 6 0 1 0 33 6 A16.5 6 0 1 0 0 6 Z")
    );
}

mod tiled_bitmap_tests {
    use super::*;
    use crate::parse::empty_style_sheet;
    use std::{cell::RefCell, collections::HashMap};

    fn png() -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.extend_from_slice(&13_u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&8_u32.to_be_bytes());
        bytes.extend_from_slice(&8_u32.to_be_bytes());
        bytes.extend_from_slice(&[8, 2, 0, 0, 0, 0, 0, 0, 0]);
        bytes
    }

    fn render(
        fill_attributes: &str,
        source: &str,
        tile: &str,
        transform: &str,
    ) -> Option<ShapeFillMarkup> {
        let properties = format!(
            r#"<wps:spPr><a:custGeom/><a:blipFill {fill_attributes}><a:blip r:embed="rId1"/><a:srcRect {source}/><a:tile {tile}/></a:blipFill></wps:spPr>"#
        );
        let parts = HashMap::new();
        let assets = HashMap::from([("word/media/image.png".into(), png())]);
        let context = ParseContext {
            parts: &parts,
            binary_assets: &assets,
            relationships: HashMap::from([("rId1".into(), "word/media/image.png".into())]),
            content_types: Default::default(),
            style_sheet: empty_style_sheet(),
            warnings: RefCell::new(Vec::new()),
        };
        drawing_tile_fill_markup(&properties, transform, 200, 100, &context, "tile-fill")
    }

    #[test]
    fn tiled_fills_preserve_native_extent_and_pattern_reference() {
        let fill = render(r#"rotWithShape="0""#, "", "", "<a:xfrm/>").unwrap();
        assert_eq!(fill.fill_attribute, "fill=\"url(#tile-fill)\"");
        assert!(fill.defs[0]
            .contains("patternUnits=\"userSpaceOnUse\" x=\"0\" y=\"0\" width=\"8\" height=\"8\""));
        assert_eq!(fill.defs[0].matches("<image ").count(), 1);
        assert!(fill.defs[0].contains("data:image/png;base64,"));
    }

    #[test]
    fn cropped_tiles_apply_scale_alignment_and_physical_offsets() {
        let fill = render(
            "",
            r#"l="25000" r="25%""#,
            r#"sx="50000" sy="200%" algn="ctr" tx="9525" ty="19050""#,
            "<a:xfrm/>",
        )
        .unwrap();
        assert!(fill.defs[0].contains("x=\"100\" y=\"44\" width=\"2\" height=\"16\""));
        assert!(fill.defs[0].contains("x=\"-1\" y=\"0\" width=\"4\" height=\"16\""));
    }

    #[test]
    fn mirrored_tiles_reuse_one_payload_and_reject_invalid_geometry() {
        let fill = render("", "", r#"flip="xy""#, "<a:xfrm/>").unwrap();
        assert_eq!(fill.defs[0].matches("<image ").count(), 1);
        assert_eq!(fill.defs[0].matches("<use ").count(), 3);
        assert!(fill.defs[0].contains("width=\"16\" height=\"16\""));
        assert!(render("", "", r#"sx="0""#, "<a:xfrm/>").is_none());
        assert!(render("", r#"l="50000" r="50000""#, "", "<a:xfrm/>").is_none());
        assert!(render(r#"rotWithShape="0""#, "", "", r#"<a:xfrm rot="60000"/>"#).is_none());
    }

    #[test]
    fn png_extent_uses_declared_density_and_checks_chunk_bounds() {
        let mut bytes = png();
        assert_eq!(png_tile_extent(&bytes, 192), Some((4.0, 4.0)));
        bytes.extend_from_slice(&9_u32.to_be_bytes());
        bytes.extend_from_slice(b"pHYs");
        bytes.extend_from_slice(&1000_u32.to_be_bytes());
        bytes.extend_from_slice(&2000_u32.to_be_bytes());
        bytes.extend_from_slice(&[1, 0, 0, 0, 0]);
        let (width, height) = png_tile_extent(&bytes, 0).unwrap();
        assert!((width - 8.0 * 96.0 / 25.4).abs() < 1e-9);
        assert!((height - 8.0 * 96.0 / 50.8).abs() < 1e-9);
        bytes.pop();
        assert!(png_tile_extent(&bytes, 0).is_none());
        assert!(png_tile_extent(b"invalid", 0).is_none());
    }
}

mod stretched_bitmap_tests {
    use super::*;
    use crate::parse::empty_style_sheet;
    use std::{cell::RefCell, collections::HashMap};

    fn render_with_style(geometry: &str, fill: &str, style: &str) -> Option<String> {
        let parts = HashMap::new();
        let assets = HashMap::from([("word/media/image.png".into(), vec![1, 2, 3])]);
        let context = ParseContext {
            parts: &parts,
            binary_assets: &assets,
            relationships: HashMap::from([("rId1".into(), "word/media/image.png".into())]),
            content_types: Default::default(),
            style_sheet: empty_style_sheet(),
            warnings: RefCell::new(Vec::new()),
        };
        render_stretched_bitmap_shape_svg(
            &format!("<wps:spPr>{geometry}{fill}<a:ln><a:noFill/></a:ln></wps:spPr>"),
            style,
            80,
            50,
            "",
            &context,
        )
    }

    fn render(geometry: &str, fill: &str) -> Option<String> {
        render_with_style(geometry, fill, "")
    }

    const FILL: &str =
        r#"<a:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>"#;

    #[test]
    fn stretched_fills_clip_to_requested_preset_geometry() {
        let ellipse = render(
            r#"<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>"#,
            FILL,
        )
        .unwrap();
        assert!(ellipse.contains(
            r#"<ellipse cx="40" cy="25" rx="40" ry="25" fill="url(#shape-bitmap-fill)""#
        ));
        assert_eq!(ellipse.matches("<image ").count(), 1);
        assert!(ellipse.contains("data:image/png;base64,AQID"));
        let rounded = render(r#"<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 10000"/></a:avLst></a:prstGeom>"#, FILL).unwrap();
        assert!(rounded.contains(r#"width="80" height="50" rx="5" ry="5""#));
        let square = render(r#"<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>"#, FILL).unwrap();
        assert!(square.contains(
            r#"<rect x="0" y="0" width="80" height="50" fill="url(#shape-bitmap-fill)""#
        ));
    }

    #[test]
    fn rounded_bitmap_adjustments_follow_preset_bounds() {
        for (value, radius) in [("-1", "0"), ("100000", "25")] {
            let geometry = format!(
                r#"<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val {value}"/></a:avLst></a:prstGeom>"#
            );
            assert!(render(&geometry, FILL)
                .unwrap()
                .contains(&format!(r#"rx="{radius}" ry="{radius}""#)));
        }
        assert!(render(r#"<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val NaN"/></a:avLst></a:prstGeom>"#, FILL).is_none());
    }

    #[test]
    fn bitmap_stretch_accepts_density_extensions_and_rejects_image_effects() {
        let geometry = r#"<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>"#;
        let fill = r#"<a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="rId1"><a:extLst><a:ext uri="{28A0092B-C50C-407E-A947-70E740481C1C}"><a14:useLocalDpi val="0"/></a:ext></a:extLst></a:blip><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill>"#;
        assert!(render(geometry, fill).is_some());
        assert!(render(
            geometry,
            &fill.replace("<a:srcRect/>", "<a:srcRect l=\"10000\"/>")
        )
        .unwrap().contains(r#"x="-8.88888888888889""#));
        assert!(render(
            geometry,
            &fill.replace("<a:fillRect/>", "<a:fillRect r=\"10000\"/>")
        )
        .unwrap().contains(r#"width="72" height="50""#));
        assert!(render(
            geometry,
            &fill.replace("</a:blip>", "<a:grayscl/></a:blip>")
        )
        .is_none());
        assert!(render(geometry, &fill.replace("a14:useLocalDpi", "a14:unknown")).is_none());
        assert!(render(geometry, &fill.replace("r:embed", "r:link")).is_none());
        assert!(render(geometry, &format!("{FILL}<a:solidFill/>")).is_none());
    }
    #[test]
    fn bitmap_stretch_respects_effect_overrides() {
        let geometry = r#"<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>"#;
        let style = r#"<wps:style><a:effectRef idx="1"/></wps:style>"#;
        assert!(render_with_style(geometry, FILL, style).is_none());
        assert!(render_with_style(geometry, FILL, &style.replace("1", "0")).is_some());
        assert!(render_with_style(geometry, &format!("{FILL}<a:effectLst/>"), style).is_some());
        assert!(render_with_style(
            geometry,
            &format!("{FILL}<a:effectLst><a:blur rad=\"1\"/></a:effectLst>"),
            style
        )
        .is_none());
    }
}

mod textbox_fit_tests {
    use super::*;

    fn paragraphs() -> Vec<ParsedTextBoxParagraph> {
        ["First line", "Middle line", "Final line"].into_iter().map(|text| ParsedTextBoxParagraph {
            text: text.to_owned(), style: None, align: None, images: Vec::new(),
        }).collect()
    }

    fn text_nodes(svg: &str) -> Vec<String> {
        let document = roxmltree::Document::parse(svg).unwrap();
        document.descendants().filter(|node| node.has_tag_name(("http://www.w3.org/2000/svg", "text")))
            .map(|node| node.text().unwrap_or_default().to_owned()).collect()
    }

    #[test]
    fn fitted_multiline_content_is_not_truncated() {
        let svg = render_bounded_text_box_svg(&paragraphs(), 190.0, 40.0, None);
        assert_eq!(text_nodes(&svg), vec!["First line", "Middle line", "Final line"], "{svg}");
    }

    #[test]
    fn unconstrained_multiline_content_remains_complete() {
        let svg = render_bounded_text_box_svg(&paragraphs(), 190.0, 140.0, None);
        assert_eq!(text_nodes(&svg), vec!["First line", "Middle line", "Final line"]);
    }

    fn layout(bottom: f64, anchor: &str) -> ParsedTextBoxLayout {
        ParsedTextBoxLayout {
            padding_left_px: Some(6.0), padding_top_px: Some(2.0),
            padding_right_px: Some(6.0), padding_bottom_px: Some(bottom),
            vertical_anchor: Some(anchor.to_owned()),
        }
    }

    fn baselines(svg: &str) -> Vec<f64> {
        let document = roxmltree::Document::parse(svg).unwrap();
        document.descendants().filter(|node| node.has_tag_name(("http://www.w3.org/2000/svg", "text")))
            .map(|node| node.attribute("y").unwrap().parse().unwrap()).collect()
    }

    #[test]
    fn fitted_content_respects_all_vertical_anchors() {
        for anchor in ["top", "center", "bottom"] {
            let svg = render_bounded_text_box_svg(&paragraphs(), 190.0, 40.0, Some(&layout(2.0, anchor)));
            assert_eq!(text_nodes(&svg).len(), 3, "{anchor}: {svg}");
            let ys = baselines(&svg);
            assert!(ys.windows(2).all(|pair| pair[0] < pair[1]));
            assert!(ys.iter().all(|y| *y >= 0.0 && *y <= 36.0));
        }
    }

    #[test]
    fn fitted_content_respects_bottom_insets() {
        for bottom in [0.0_f64, 2.0, 4.0, 8.0] {
            let svg = render_bounded_text_box_svg(&paragraphs(), 190.0, 40.0, Some(&layout(bottom, "top")));
            assert_eq!(text_nodes(&svg).len(), 3, "{bottom}: {svg}");
            assert!(baselines(&svg).iter().all(|y| *y <= 40.0 - bottom.max(4.0)));
        }
    }

    #[test]
    fn fitted_content_retains_text_style() {
        let mut content = paragraphs();
        content[2].style = Some(serde_json::from_value(serde_json::json!({
            "bold": true, "italic": true, "color": "#234567"
        })).unwrap());
        let svg = render_bounded_text_box_svg(&content, 190.0, 40.0, None);
        let document = roxmltree::Document::parse(&svg).unwrap();
        let last = document.descendants().find(|node| node.is_element() && node.text() == Some("Final line")).unwrap();
        assert_eq!(last.attribute("font-weight"), Some("700"));
        assert_eq!(last.attribute("font-style"), Some("italic"));
        assert_eq!(last.attribute("fill"), Some("#234567"));
    }

    #[test]
    fn fitted_content_retains_final_image_payload_and_frame() {
        let mut content = paragraphs();
        content[2].text.clear();
        let source = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
        content[2].images.push(ParsedTextBoxImage { src: source.to_owned(), width_px: 10.0, height_px: 10.0, paint_bounds: None });
        let svg = render_bounded_text_box_svg(&content, 190.0, 40.0, None);
        let document = roxmltree::Document::parse(&svg).unwrap();
        let image = document.descendants().find(|node| node.has_tag_name(("http://www.w3.org/2000/svg", "image"))).unwrap();
        assert_eq!(image.attribute("href"), Some(source));
        let y: f64 = image.attribute("y").unwrap().parse().unwrap();
        let height: f64 = image.attribute("height").unwrap().parse().unwrap();
        assert!(y >= 0.0 && y + height <= 40.0);
    }

    #[test]
    fn overflow_of_empty_paragraphs_keeps_svg_unchanged() {
        let mut content = paragraphs();
        content[1].text.clear(); content[2].text.clear();
        let svg = render_bounded_text_box_svg(&content, 190.0, 40.0, None);
        assert_eq!(svg, "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"190\" height=\"40\" viewBox=\"0 0 190 40\">\n    <rect x=\"0\" y=\"0\" width=\"190\" height=\"40\" fill=\"none\"/>\n    <text xml:space=\"preserve\" x=\"6\" y=\"14\" text-anchor=\"start\" font-size=\"10\" fill=\"#111111\" font-family=\"Calibri, Arial, sans-serif\" font-weight=\"400\" font-style=\"normal\">First line</text>\n  </svg>");
    }

    #[test]
    fn dense_tiny_frames_remain_an_explicit_limit() {
        let svg = render_bounded_text_box_svg(&paragraphs(), 190.0, 4.0, None);
        assert!(text_nodes(&svg).is_empty());
    }

}

mod image_paint_bounds_tests {
    use super::*;

    fn paragraph(paint_bounds: Option<Box<ImagePaintBounds>>) -> ParsedTextBoxParagraph {
        ParsedTextBoxParagraph {
            text: String::new(), style: None, align: None,
            images: vec![
                ParsedTextBoxImage {
                    src: "data:image/svg+xml,%3Csvg%2F%3E".into(),
                    width_px: 100.0, height_px: 20.0, paint_bounds,
                },
                ParsedTextBoxImage {
                    src: "data:image/svg+xml,%3Csvg%2F%3E".into(),
                    width_px: 20.0, height_px: 20.0, paint_bounds: None,
                },
            ],
        }
    }

    fn rects(svg: &str) -> Vec<[f64; 4]> {
        let document = roxmltree::Document::parse(svg).unwrap();
        document.descendants()
            .filter(|node| node.has_tag_name(("http://www.w3.org/2000/svg", "image")))
            .map(|node| ["x", "y", "width", "height"].map(|name| node.attribute(name).unwrap().parse().unwrap()))
            .collect()
    }

    #[test]
    fn nested_paint_offsets_and_extents_scale_without_changing_logical_advance() {
        for width in [220.0, 70.0] {
            let layout = ParsedTextBoxLayout {
                padding_left_px: Some(10.0), padding_top_px: Some(10.0),
                padding_right_px: Some(10.0), padding_bottom_px: Some(10.0),
                vertical_anchor: None,
            };
            let plain = render_bounded_text_box_svg(&[paragraph(None)], width, 100.0, Some(&layout));
            let painted = render_bounded_text_box_svg(&[paragraph(Some(Box::new(ImagePaintBounds {
                x_px: -0.5, y_px: -2.0, width_px: 101.0, height_px: 24.0,
                layout_width_px: 100.0, layout_height_px: 20.0,
            })))], width, 100.0, Some(&layout));
            let original = rects(&plain);
            let actual = rects(&painted);
            let sx = original[0][2] / 100.0;
            let sy = original[0][3] / 20.0;
            assert_eq!(actual[0], [original[0][0] - 0.5 * sx, original[0][1] - 2.0 * sy, 101.0 * sx, 24.0 * sy]);
            assert_eq!(actual[1], original[1]);
            assert!(painted.contains("preserveAspectRatio=\"none\""));
        }
    }
}
