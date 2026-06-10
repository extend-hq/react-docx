use crate::model::ParagraphAlignment;
use crate::parse::re;
use crate::parse::context::ParseContext;
use crate::parse::style::parse_text_style_from_xml;
use crate::parse::util::{
    bytes_to_base64, clamp, clamp_i64, content_type_for_part, emu_to_pixels, escape_xml_text,
    prefer_alternate_content_choice, resolve_drawing_color_from_xml,
};
use crate::xml::{extract_balanced_tag_blocks, get_attribute, parse_integer_attribute};

#[derive(Clone, Debug)]
pub struct ParsedTextBoxParagraph {
    pub text: String,
    pub style: Option<crate::model::TextStyle>,
    pub align: Option<ParagraphAlignment>,
}

#[derive(Clone, Debug)]
pub struct ParsedTextBoxLayout {
    pub padding_left_px: Option<f64>,
    pub padding_top_px: Option<f64>,
    pub padding_right_px: Option<f64>,
    pub padding_bottom_px: Option<f64>,
    pub vertical_anchor: Option<String>,
}

struct ShapeFillMarkup {
    fill_attribute: String,
    defs: Vec<String>,
}

pub fn parse_text_box_paragraphs(run_xml: &str, context: &ParseContext<'_>) -> Vec<ParsedTextBoxParagraph> {
    let normalized_run_xml = prefer_alternate_content_choice(run_xml);
    let text_box_xml = extract_balanced_tag_blocks(&normalized_run_xml, "w:txbxContent")
        .into_iter()
        .next();
    let Some(text_box_xml) = text_box_xml else {
        return Vec::new();
    };
    let paragraphs = extract_balanced_tag_blocks(&text_box_xml, "w:p");
    let mut resolved = Vec::new();
    for paragraph_xml in paragraphs {
        let paragraph_text = super::paragraph::parse_run_text(&paragraph_xml)
            .trim_end_matches('\n')
            .to_string();
        if paragraph_text.is_empty() {
            continue;
        }
        let paragraph_properties_xml = extract_balanced_tag_blocks(&paragraph_xml, "w:pPr")
            .into_iter()
            .next()
            .or_else(|| regex_tag(&paragraph_xml, r"(?i)<w:pPr\b[^>]*/?>"))
            .unwrap_or_default();
        let paragraph_style_id = regex_capture(
            &paragraph_properties_xml,
            r#"(?i)<w:pStyle\b[^>]*w:val="([^"]+)""#,
        );
        let paragraph_style = paragraph_style_id
            .as_deref()
            .and_then(|id| context.style_sheet.paragraph_style_by_id.get(id));
        let first_run_xml = extract_balanced_tag_blocks(&paragraph_xml, "w:r").into_iter().next();
        let run_properties_xml = first_run_xml
            .as_ref()
            .and_then(|run| {
                extract_balanced_tag_blocks(run, "w:rPr")
                    .into_iter()
                    .next()
                    .or_else(|| regex_tag(run, r"(?i)<w:rPr\b[^>]*/?>"))
            })
            .unwrap_or_default();
        let paragraph_run_properties_xml = extract_balanced_tag_blocks(&paragraph_properties_xml, "w:rPr")
            .into_iter()
            .next()
            .or_else(|| regex_tag(&paragraph_properties_xml, r"(?i)<w:rPr\b[^>]*/?>"))
            .unwrap_or_default();
        let style = super::util::merge_text_styles(&[
            context.style_sheet.default_run_style.clone(),
            paragraph_style.and_then(|s| s.run_style.clone()),
            parse_text_style_from_xml(&paragraph_run_properties_xml, &context.style_sheet.theme_fonts),
            parse_text_style_from_xml(&run_properties_xml, &context.style_sheet.theme_fonts),
        ]);
        let align = super::style::parse_paragraph_align_from_xml(&paragraph_properties_xml)
            .or_else(|| paragraph_style.and_then(|s| s.align));
        resolved.push(ParsedTextBoxParagraph {
            text: paragraph_text,
            style,
            align,
        });
    }
    resolved
}

pub fn parse_text_box_layout(run_xml: &str) -> Option<ParsedTextBoxLayout> {
    let normalized_run_xml = prefer_alternate_content_choice(run_xml);
    let body_pr_xml = extract_balanced_tag_blocks(&normalized_run_xml, "wps:bodyPr")
        .into_iter()
        .next()
        .or_else(|| regex_tag(&normalized_run_xml, r"(?i)<wps:bodyPr\b[^>]*/?>"))?;
    let anchor_raw = get_attribute(&body_pr_xml, "anchor")
        .map(|v| v.trim().to_ascii_lowercase());
    let vertical_anchor = match anchor_raw.as_deref() {
        Some("ctr") => Some("center".to_string()),
        Some("b") => Some("bottom".to_string()),
        _ => Some("top".to_string()),
    };
    Some(ParsedTextBoxLayout {
        padding_left_px: emu_to_pixels(get_attribute(&body_pr_xml, "lIns").as_deref()),
        padding_top_px: emu_to_pixels(get_attribute(&body_pr_xml, "tIns").as_deref()),
        padding_right_px: emu_to_pixels(get_attribute(&body_pr_xml, "rIns").as_deref()),
        padding_bottom_px: emu_to_pixels(get_attribute(&body_pr_xml, "bIns").as_deref()),
        vertical_anchor,
    })
}

pub fn render_text_box_svg(
    paragraphs: &[ParsedTextBoxParagraph],
    width_px: Option<f64>,
    height_px: Option<f64>,
    layout: Option<&ParsedTextBoxLayout>,
) -> String {
    let safe_width = clamp_i64(width_px.unwrap_or(320.0).round() as i64, 80, 2400) as f64;
    let line_heights: Vec<i64> = paragraphs
        .iter()
        .map(|paragraph| {
            let font_size_pt = paragraph.style.as_ref().and_then(|s| s.font_size_pt).unwrap_or(12.0);
            let font_size_px = ((font_size_pt * 96.0) / 72.0).round().max(10.0) as i64;
            (font_size_px as f64 * 1.24).round().max(14.0) as i64
        })
        .collect();
    let estimated_height: i64 = line_heights.iter().sum::<i64>() + 24;
    let safe_height = clamp_i64(height_px.unwrap_or(estimated_height as f64).round() as i64, 48, 2400) as f64;
    let horizontal_inset = ((layout.and_then(|l| l.padding_left_px).unwrap_or(safe_width * 0.03)).round() as i64).max(8) as f64;
    let top_inset = ((layout.and_then(|l| l.padding_top_px).unwrap_or(safe_height * 0.04)).round() as i64).max(8) as f64;
    let right_inset = ((layout
        .and_then(|l| l.padding_right_px)
        .unwrap_or(horizontal_inset))
    .round() as i64)
        .max(8) as f64;
    let bottom_inset = ((layout
        .and_then(|l| l.padding_bottom_px)
        .unwrap_or(top_inset))
    .round() as i64)
        .max(8) as f64;
    let max_text_width = (safe_width - horizontal_inset * 2.0).max(20.0);
    let total_text_height: f64 = line_heights.iter().map(|h| *h as f64).sum();
    let available_height = (safe_height - top_inset - bottom_inset).max(0.0);
    let start_offset_y = match layout.and_then(|l| l.vertical_anchor.as_deref()) {
        Some("center") => top_inset + ((available_height - total_text_height) / 2.0).max(0.0).round(),
        Some("bottom") => (safe_height - bottom_inset - total_text_height).max(top_inset).round(),
        _ => top_inset.round(),
    };
    let mut cursor_y = start_offset_y;
    let mut lines = Vec::new();
    for (paragraph_index, paragraph) in paragraphs.iter().enumerate() {
        let font_size_pt = paragraph.style.as_ref().and_then(|s| s.font_size_pt).unwrap_or(12.0);
        let font_size_px = ((font_size_pt * 96.0) / 72.0).round().max(10.0);
        let estimated_text_width = estimate_text_width_px(&paragraph.text, font_size_px);
        let overflow_ratio = if estimated_text_width > 0.0 {
            max_text_width / estimated_text_width
        } else {
            1.0
        };
        let fitted_font_size_px = if overflow_ratio < 1.0 {
            font_size_px * overflow_ratio
        } else {
            font_size_px
        }
        .round()
        .max(10.0);
        let text_length_attr = if estimated_text_width > max_text_width + 1.0 {
            format!(
                r#" textLength="{}" lengthAdjust="spacingAndGlyphs""#,
                max_text_width.round()
            )
        } else {
            String::new()
        };
        let line_height = line_heights
            .get(paragraph_index)
            .copied()
            .unwrap_or(((fitted_font_size_px * 1.24).round().max(14.0)) as i64) as f64;
        cursor_y += line_height;
        if cursor_y > safe_height - 4.0 {
            break;
        }
        let text_align = paragraph.align.unwrap_or(ParagraphAlignment::Left);
        let (anchor, x) = match text_align {
            ParagraphAlignment::Center => ("middle", safe_width / 2.0),
            ParagraphAlignment::Right => ("end", safe_width - right_inset),
            _ => ("start", horizontal_inset),
        };
        let text_decoration = [
            paragraph.style.as_ref().and_then(|s| s.underline).filter(|&u| u).map(|_| "underline"),
            paragraph.style.as_ref().and_then(|s| s.strike).filter(|&s| s).map(|_| "line-through"),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ");
        lines.push(format!(
            r#"<text xml:space="preserve" x="{x:.0}" y="{cursor_y:.0}" text-anchor="{anchor}" font-size="{fitted_font_size_px:.0}" fill="{}" font-family="{}" font-weight="{}" font-style="{}"{}{}>{}</text>"#,
            paragraph.style.as_ref().and_then(|s| s.color.clone()).unwrap_or_else(|| "#111111".to_string()),
            escape_xml_text(&resolve_svg_font_family(paragraph.style.as_ref().and_then(|s| s.font_family.as_deref()))),
            if paragraph.style.as_ref().and_then(|s| s.bold).unwrap_or(false) { "700" } else { "400" },
            if paragraph.style.as_ref().and_then(|s| s.italic).unwrap_or(false) { "italic" } else { "normal" },
            if text_decoration.is_empty() { String::new() } else { format!(r#" text-decoration="{}""#, text_decoration) },
            text_length_attr,
            escape_xml_text(&paragraph.text),
        ));
    }
    format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{safe_width:.0}" height="{safe_height:.0}" viewBox="0 0 {safe_width:.0} {safe_height:.0}">
    <rect x="0" y="0" width="{safe_width:.0}" height="{safe_height:.0}" fill="none"/>
    {}
  </svg>"#,
        lines.join("")
    )
}

pub fn render_standalone_word_shape_svg(
    run_xml: &str,
    width_px: Option<f64>,
    height_px: Option<f64>,
    context: &ParseContext<'_>,
) -> Option<String> {
    if let Some(group_xml) = extract_balanced_tag_blocks(run_xml, "wpg:wgp").into_iter().next() {
        let group_transform_xml = extract_balanced_tag_blocks(&group_xml, "a:xfrm")
            .into_iter()
            .next()
            .unwrap_or_default();
        let child_offset_tag =
            regex_tag(&group_transform_xml, r"(?i)<a:chOff\b[^>]*/?>").unwrap_or_default();
        let child_extent_tag =
            regex_tag(&group_transform_xml, r"(?i)<a:chExt\b[^>]*/?>").unwrap_or_default();
        let child_offset_x = parse_integer_attribute(&child_offset_tag, "x").unwrap_or(0);
        let child_offset_y = parse_integer_attribute(&child_offset_tag, "y").unwrap_or(0);
        let child_extent_x = parse_integer_attribute(&child_extent_tag, "cx").unwrap_or(1).max(1);
        let child_extent_y = parse_integer_attribute(&child_extent_tag, "cy").unwrap_or(1).max(1);
        let safe_width = clamp_i64(js_round(width_px.unwrap_or(320.0)), 8, 2400);
        let safe_height = clamp_i64(js_round(height_px.unwrap_or(120.0)), 8, 2400);
        let scale_x = safe_width as f64 / child_extent_x as f64;
        let scale_y = safe_height as f64 / child_extent_y as f64;
        let mut elements = Vec::new();
        for picture_xml in extract_balanced_tag_blocks(&group_xml, "pic:pic") {
            if let Some(element) = render_grouped_picture_svg_element(
                &picture_xml,
                child_offset_x,
                child_offset_y,
                scale_x,
                scale_y,
                context,
            ) {
                elements.push(element);
            }
        }
        for (shape_index, shape_xml) in extract_balanced_tag_blocks(&group_xml, "wps:wsp")
            .into_iter()
            .enumerate()
        {
            let shape_properties_xml = extract_balanced_tag_blocks(&shape_xml, "wps:spPr")
                .into_iter()
                .next()
                .unwrap_or_default();
            let transform_xml = extract_balanced_tag_blocks(&shape_properties_xml, "a:xfrm")
                .into_iter()
                .next()
                .unwrap_or_default();
            let off_tag = regex_tag(&transform_xml, r"(?i)<a:off\b[^>]*/?>").unwrap_or_default();
            let ext_tag = regex_tag(&transform_xml, r"(?i)<a:ext\b[^>]*/?>").unwrap_or_default();
            let off_x_px = parse_integer_attribute(&off_tag, "x").unwrap_or(0) - child_offset_x;
            let off_y_px = parse_integer_attribute(&off_tag, "y").unwrap_or(0) - child_offset_y;
            let ext_x_px = parse_integer_attribute(&ext_tag, "cx").unwrap_or(0);
            let ext_y_px = parse_integer_attribute(&ext_tag, "cy").unwrap_or(0);
            let shape_width = js_round(ext_x_px as f64 * scale_x).max(1);
            let shape_height = js_round(ext_y_px as f64 * scale_y).max(1);
            let x = js_round(off_x_px as f64 * scale_x);
            let y = js_round(off_y_px as f64 * scale_y);
            let shape_transform =
                svg_grouped_shape_transform(x, y, shape_width, shape_height, &transform_xml);
            let preset = get_attribute(
                &regex_tag(&shape_properties_xml, r"(?i)<a:prstGeom\b[^>]*>").unwrap_or_default(),
                "prst",
            )
            .map(|value| value.trim().to_string());
            let style_xml = extract_balanced_tag_blocks(&shape_xml, "wps:style")
                .into_iter()
                .next()
                .unwrap_or_default();
            let fill = drawing_shape_fill_markup(
                &format!("{shape_properties_xml}{style_xml}"),
                &context.style_sheet.theme_colors,
                &format!("group-fill-{shape_index}"),
            );
            let stroke = drawing_shape_stroke_markup(
                &format!("{shape_properties_xml}{style_xml}"),
                &context.style_sheet.theme_colors,
            );
            let text_box_paragraphs = parse_text_box_paragraphs(&shape_xml, context);
            let text_box_svg = if !text_box_paragraphs.is_empty() {
                Some(render_text_box_svg(
                    &text_box_paragraphs,
                    Some(shape_width as f64),
                    Some(shape_height as f64),
                    parse_text_box_layout(&shape_xml).as_ref(),
                ))
            } else {
                None
            };
            let local_text_box_svg = text_box_svg
                .map(|svg| re::get_unchecked(r"(?i)^<svg\b").replace(&svg, "<svg x=\"0\" y=\"0\"").to_string())
                .unwrap_or_default();
            let preset_path_data =
                drawing_preset_path_data(preset.as_deref(), shape_width, shape_height);

            if preset.as_deref() == Some("line") {
                elements.push(format!(
                    r#"<g{shape_transform}><line x1="0" y1="{}" x2="{shape_width}" y2="{}" {stroke} fill="none"/>{local_text_box_svg}</g>"#,
                    js_round(shape_height as f64 / 2.0),
                    js_round(shape_height as f64 / 2.0)
                ));
                continue;
            }

            let path_data =
                drawing_shape_resolved_path_data(&shape_properties_xml, shape_width, shape_height);
            if let Some(path_data) = path_data {
                elements.push(format!(
                    r#"{}<g{shape_transform}><path d="{path_data}" {} {stroke}/>{local_text_box_svg}</g>"#,
                    fill.defs.join(""),
                    fill.fill_attribute
                ));
            } else if let Some(preset_path_data) = preset_path_data {
                elements.push(format!(
                    r#"{}<g{shape_transform}><path d="{preset_path_data}" {} {stroke}/>{local_text_box_svg}</g>"#,
                    fill.defs.join(""),
                    fill.fill_attribute
                ));
            } else {
                elements.push(format!(
                    r#"{}<g{shape_transform}><rect x="0" y="0" width="{shape_width}" height="{shape_height}" {} {stroke}/>{local_text_box_svg}</g>"#,
                    fill.defs.join(""),
                    fill.fill_attribute
                ));
            }
        }
        if !elements.is_empty() {
            return Some(format!(
                r#"<svg xmlns="http://www.w3.org/2000/svg" width="{safe_width}" height="{safe_height}" viewBox="0 0 {safe_width} {safe_height}">{}</svg>"#,
                elements.join("")
            ));
        }
    }

    let shape_xml = extract_balanced_tag_blocks(run_xml, "wps:wsp").into_iter().next()?;
    if re::get(r"(?i)<w:txbxContent\b").is_some_and(|re| re.is_match(&shape_xml)) {
        return None;
    }
    let shape_properties_xml = extract_balanced_tag_blocks(&shape_xml, "wps:spPr").into_iter().next()?;
    let safe_width = clamp_i64(js_round(width_px.unwrap_or(320.0)), 8, 2400);
    let safe_height = clamp_i64(js_round(height_px.unwrap_or(240.0)), 8, 2400);
    let rotation_degrees = get_attribute(
        &extract_balanced_tag_blocks(&shape_properties_xml, "a:xfrm")
            .into_iter()
            .next()
            .unwrap_or_default(),
        "rot",
    )
    .and_then(|raw| raw.trim().parse::<f64>().ok())
    .filter(|value| value.is_finite())
    .map(|value| value / 60000.0);
    let rotation_layout = svg_rotation_layout(rotation_degrees, safe_width as f64, safe_height as f64);
    let preset = get_attribute(
        &regex_tag(&shape_properties_xml, r"(?i)<a:prstGeom\b[^>]*>").unwrap_or_default(),
        "prst",
    )
    .map(|value| value.trim().to_string());
    let style_xml = extract_balanced_tag_blocks(&shape_xml, "wps:style")
        .into_iter()
        .next()
        .unwrap_or_default();
    let fill = drawing_shape_fill_markup(
        &format!("{shape_properties_xml}{style_xml}"),
        &context.style_sheet.theme_colors,
        "shape-fill",
    );
    let stroke = drawing_shape_stroke_markup(
        &format!("{shape_properties_xml}{style_xml}"),
        &context.style_sheet.theme_colors,
    );
    let path_data = drawing_shape_resolved_path_data(&shape_properties_xml, safe_width, safe_height);
    let preset_path_data = drawing_preset_path_data(preset.as_deref(), safe_width, safe_height);
    let body = if preset.as_deref() == Some("line") {
        format!(
            r#"<line x1="0" y1="{}" x2="{safe_width}" y2="{}" {stroke} fill="none"{}/>"#,
            js_round(safe_height as f64 / 2.0),
            js_round(safe_height as f64 / 2.0),
            rotation_layout.transform_attribute
        )
    } else if let Some(path_data) = path_data {
        format!(
            r#"<path d="{path_data}" {} {stroke}{}/>"#,
            fill.fill_attribute, rotation_layout.transform_attribute
        )
    } else if let Some(preset_path_data) = preset_path_data {
        format!(
            r#"<path d="{preset_path_data}" {} {stroke}{}/>"#,
            fill.fill_attribute, rotation_layout.transform_attribute
        )
    } else {
        format!(
            r#"<rect x="0" y="0" width="{safe_width}" height="{safe_height}" {} {stroke}{}/>"#,
            fill.fill_attribute, rotation_layout.transform_attribute
        )
    };
    Some(format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{safe_width}" height="{safe_height}" viewBox="0 0 {} {}"{}><defs>{}</defs>{body}</svg>"#,
        rotation_layout.view_box_width_px,
        rotation_layout.view_box_height_px,
        if rotation_layout.preserve_aspect_ratio_none {
            r#" preserveAspectRatio="none""#
        } else {
            ""
        },
        fill.defs.join(""),
    ))
}

fn render_grouped_picture_svg_element(
    picture_xml: &str,
    child_offset_x: i64,
    child_offset_y: i64,
    scale_x: f64,
    scale_y: f64,
    context: &ParseContext<'_>,
) -> Option<String> {
    let picture_properties_xml = extract_balanced_tag_blocks(picture_xml, "pic:spPr")
        .into_iter()
        .next()
        .unwrap_or_default();
    let transform_xml = extract_balanced_tag_blocks(&picture_properties_xml, "a:xfrm")
        .into_iter()
        .next()
        .unwrap_or_default();
    let off_tag = regex_tag(&transform_xml, r"(?i)<a:off\b[^>]*/>").unwrap_or_default();
    let ext_tag = regex_tag(&transform_xml, r"(?i)<a:ext\b[^>]*/>").unwrap_or_default();
    let off_x_px = parse_integer_attribute(&off_tag, "x").unwrap_or(0) - child_offset_x;
    let off_y_px = parse_integer_attribute(&off_tag, "y").unwrap_or(0) - child_offset_y;
    let ext_x_px = parse_integer_attribute(&ext_tag, "cx").unwrap_or(0);
    let ext_y_px = parse_integer_attribute(&ext_tag, "cy").unwrap_or(0);
    let x = js_round(off_x_px as f64 * scale_x);
    let y = js_round(off_y_px as f64 * scale_y);
    let width_px = js_round(ext_x_px as f64 * scale_x).max(1);
    let height_px = js_round(ext_y_px as f64 * scale_y).max(1);
    let relationship_id = regex_capture(picture_xml, r#"(?i)<a:blip\b[^>]*r:embed="([^"]+)""#)
        .or_else(|| regex_capture(picture_xml, r#"(?i)<a:blip\b[^>]*r:link="([^"]+)""#))?;

    let Some(part_name) = context.relationships.get(&relationship_id) else {
        context.push_warning(format!("Missing relationship target for {relationship_id}"));
        return None;
    };

    let Some(binary) = context.binary_assets.get(part_name) else {
        context.push_warning(format!("Missing image asset {part_name}"));
        return None;
    };

    let mime_type = content_type_for_part(part_name, &context.content_types)
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let src = format!("data:{mime_type};base64,{}", bytes_to_base64(binary));
    Some(format!(
        r#"<image href="{src}" x="{x}" y="{y}" width="{width_px}" height="{height_px}" preserveAspectRatio="none"/>"#
    ))
}

fn drawing_shape_fill_markup(
    shape_properties_xml: &str,
    theme_colors: &crate::parse::context::ThemeColorMap,
    gradient_id: &str,
) -> ShapeFillMarkup {
    let fill_scope_xml = re::get_unchecked(r"(?is)<a:ln\b[\s\S]*?</a:ln>")
        .replace_all(shape_properties_xml, "")
        .to_string();
    let fill_scope_xml = re::get_unchecked(r"(?i)<a:ln\b[^>]*/>")
        .replace_all(&fill_scope_xml, "")
        .to_string();
    let fill_scope_xml = re::get_unchecked(r"(?is)<a:extLst\b[\s\S]*?</a:extLst>")
        .replace_all(&fill_scope_xml, "")
        .to_string();
    let fill_scope_xml = re::get_unchecked(r"(?i)<a:extLst\b[^>]*/>")
        .replace_all(&fill_scope_xml, "")
        .to_string();
    if let Some(solid_fill_xml) = extract_balanced_tag_blocks(&fill_scope_xml, "a:solidFill").into_iter().next() {
        if let Some((color, opacity)) = resolve_drawing_color_from_xml(Some(&solid_fill_xml), theme_colors) {
            return ShapeFillMarkup {
                fill_attribute: format!(
                    r#"fill="{color}""#,
                ) + &opacity
                    .map(|o| format!(r#" fill-opacity="{o}""#))
                    .unwrap_or_default(),
                defs: Vec::new(),
            };
        }
    }

    if let Some(gradient_fill_xml) = extract_balanced_tag_blocks(&fill_scope_xml, "a:gradFill").into_iter().next() {
        let gradient_stops: Vec<String> = extract_balanced_tag_blocks(&gradient_fill_xml, "a:gs")
            .into_iter()
            .filter_map(|stop_xml| {
                let raw_position = get_attribute(
                    &regex_tag(&stop_xml, r"(?i)<a:gs\b[^>]*>").unwrap_or_default(),
                    "pos",
                )
                .and_then(|raw| raw.trim().parse::<f64>().ok());
                let (color, opacity) =
                    resolve_drawing_color_from_xml(Some(&stop_xml), theme_colors)?;
                let clamped_position = raw_position
                    .filter(|value| value.is_finite())
                    .map(|value| clamp(value / 1000.0, 0.0, 100.0))
                    .unwrap_or(0.0);
                Some(format!(
                    r#"<stop offset="{}%" stop-color="{color}"{}/>"#,
                    format_js_number(clamped_position),
                    opacity
                        .map(|o| format!(r#" stop-opacity="{o}""#))
                        .unwrap_or_default()
                ))
            })
            .collect();

        if !gradient_stops.is_empty() {
            let angle_raw = get_attribute(
                &regex_tag(&gradient_fill_xml, r"(?i)<a:lin\b[^>]*>").unwrap_or_default(),
                "ang",
            )
            .and_then(|raw| raw.trim().parse::<f64>().ok())
            .filter(|value| value.is_finite());
            let angle_degrees = angle_raw.map(|value| value / 60000.0).unwrap_or(90.0);
            let (x1, y1, x2, y2) = gradient_vector_for_angle(angle_degrees);
            return ShapeFillMarkup {
                fill_attribute: format!(r#"fill="url(#{gradient_id})""#),
                defs: vec![format!(
                    r#"<linearGradient id="{gradient_id}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">{}</linearGradient>"#,
                    gradient_stops.join("")
                )],
            };
        }
    }

    if re::get(r"(?i)<a:noFill\b").is_some_and(|re| re.is_match(&fill_scope_xml)) {
        return ShapeFillMarkup {
            fill_attribute: r#"fill="none""#.to_string(),
            defs: Vec::new(),
        };
    }

    if let Some(style_fill_ref_xml) = extract_balanced_tag_blocks(shape_properties_xml, "a:fillRef").into_iter().next() {
        if let Some((color, opacity)) = resolve_drawing_color_from_xml(Some(&style_fill_ref_xml), theme_colors) {
            return ShapeFillMarkup {
                fill_attribute: format!(
                    r#"fill="{color}""#,
                ) + &opacity
                    .map(|o| format!(r#" fill-opacity="{o}""#))
                    .unwrap_or_default(),
                defs: Vec::new(),
            };
        }
    }

    ShapeFillMarkup {
        fill_attribute: r#"fill="none""#.to_string(),
        defs: Vec::new(),
    }
}

fn gradient_vector_for_angle(angle_degrees: f64) -> (String, String, String, String) {
    let radians = (angle_degrees * std::f64::consts::PI) / 180.0;
    let dx = radians.cos();
    let dy = radians.sin();
    (
        format!("{}%", format_js_number(50.0 - dx * 50.0)),
        format!("{}%", format_js_number(50.0 - dy * 50.0)),
        format!("{}%", format_js_number(50.0 + dx * 50.0)),
        format!("{}%", format_js_number(50.0 + dy * 50.0)),
    )
}

fn drawing_shape_stroke_markup(
    shape_properties_xml: &str,
    theme_colors: &crate::parse::context::ThemeColorMap,
) -> String {
    let line_xml = extract_balanced_tag_blocks(shape_properties_xml, "a:ln")
        .into_iter()
        .next()
        .or_else(|| regex_tag(shape_properties_xml, r"(?i)<a:ln\b[^>]*/>"))
        .unwrap_or_default();
    if line_xml.is_empty() || re::get(r"(?i)<a:noFill\b").is_some_and(|re| re.is_match(&line_xml)) {
        return r#"stroke="none""#.to_string();
    }
    let line_width_emu = parse_integer_attribute(
        &regex_tag(&line_xml, r"(?i)<a:ln\b[^>]*>").unwrap_or_default(),
        "w",
    );
    if line_width_emu.is_some_and(|v| v <= 0) {
        return r#"stroke="none""#.to_string();
    }
    let resolved = resolve_drawing_color_from_xml(Some(&line_xml), theme_colors).or_else(|| {
        resolve_drawing_color_from_xml(
            extract_balanced_tag_blocks(shape_properties_xml, "a:lnRef")
                .into_iter()
                .next()
                .as_deref(),
            theme_colors,
        )
    });
    let width_px = emu_to_pixels(line_width_emu.map(|v| v.to_string()).as_deref());
    format!(
        r#"stroke="{}"{} stroke-width="{}""#,
        resolved.as_ref().map(|(c, _)| c.as_str()).unwrap_or("#000000"),
        resolved
            .as_ref()
            .and_then(|(_, o)| o.map(|opacity| format!(r#" stroke-opacity="{opacity}""#)))
            .unwrap_or_default(),
        format_js_number(width_px.unwrap_or(1.0).max(1.0))
    )
}

fn drawing_shape_path_data(path_xml: &str, width_px: i64, height_px: i64) -> Option<String> {
    let path_tag = regex_tag(path_xml, r"(?i)<a:path\b[^>]*>").unwrap_or_default();
    let base_width = parse_integer_attribute(&path_tag, "w").unwrap_or(21600).max(1) as f64;
    let base_height = parse_integer_attribute(&path_tag, "h").unwrap_or(21600).max(1) as f64;
    let command_re = re::get_unchecked(
        r"(?is)<a:moveTo\b[\s\S]*?(?:</a:moveTo>|/>)|<a:lnTo\b[\s\S]*?(?:</a:lnTo>|/>)|<a:cubicBezTo\b[\s\S]*?(?:</a:cubicBezTo>|/>)|<a:close\b[\s\S]*?(?:</a:close>|/>)",
    );
    let point_re = re::get_unchecked(r#"(?i)<a:pt\b[^>]*x="([^"]+)"[^>]*y="([^"]+)"[^>]*/>"#);

    let scale_point = |x_raw: &str, y_raw: &str| -> Option<String> {
        let x: f64 = x_raw.trim().parse().ok().filter(|v: &f64| v.is_finite())?;
        let y: f64 = y_raw.trim().parse().ok().filter(|v: &f64| v.is_finite())?;
        let scaled_x = ((x / base_width) * width_px as f64 * 100.0).round() / 100.0;
        let scaled_y = ((y / base_height) * height_px as f64 * 100.0).round() / 100.0;
        Some(format!(
            "{} {}",
            format_js_number(scaled_x),
            format_js_number(scaled_y)
        ))
    };

    let mut commands = Vec::new();
    let mut matched_any = false;
    for command_match in command_re.find_iter(path_xml) {
        matched_any = true;
        let command_xml = command_match.as_str();
        let command_type = command_xml
            .get(..14)
            .unwrap_or(command_xml)
            .to_ascii_lowercase();
        if command_type.contains("close") {
            commands.push("Z".to_string());
            continue;
        }

        let points: Vec<(String, String)> = point_re
            .captures_iter(command_xml)
            .map(|caps| {
                (
                    caps.get(1).map(|m| m.as_str().to_string()).unwrap_or_default(),
                    caps.get(2).map(|m| m.as_str().to_string()).unwrap_or_default(),
                )
            })
            .collect();
        if command_type.contains("moveto") || command_type.contains("lnto") {
            let Some((x_raw, y_raw)) = points.first() else {
                continue;
            };
            let Some(scaled_point) = scale_point(x_raw, y_raw) else {
                continue;
            };
            commands.push(format!(
                "{}{scaled_point}",
                if command_type.contains("moveto") { "M" } else { "L" }
            ));
            continue;
        }

        if command_type.contains("cubicbezto") {
            if points.len() < 3 {
                continue;
            }
            let scaled_points: Vec<Option<String>> = points
                .iter()
                .take(3)
                .map(|(x_raw, y_raw)| scale_point(x_raw, y_raw))
                .collect();
            if scaled_points.iter().any(|point| point.is_none()) {
                continue;
            }
            commands.push(format!(
                "C{}",
                scaled_points
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join(" ")
            ));
        }
    }
    if !matched_any || commands.is_empty() {
        return None;
    }

    Some(commands.join(" "))
}

fn ellipse_path_data(width_px: i64, height_px: i64) -> String {
    let safe_width = width_px.max(1) as f64;
    let safe_height = height_px.max(1) as f64;
    let rx = safe_width / 2.0;
    let ry = safe_height / 2.0;
    format!(
        "M{} 0 C{} 0 {} {} {} {} C{} {} {} {} {} {} C{} {} 0 {} 0 {} C0 {} {} 0 {} 0 Z",
        format_js_number(rx),
        format_js_number(safe_width - rx * 0.45),
        format_js_number(safe_width),
        format_js_number(ry * 0.45),
        format_js_number(safe_width),
        format_js_number(ry),
        format_js_number(safe_width),
        format_js_number(safe_height - ry * 0.45),
        format_js_number(safe_width - rx * 0.45),
        format_js_number(safe_height),
        format_js_number(rx),
        format_js_number(safe_height),
        format_js_number(rx * 0.45),
        format_js_number(safe_height),
        format_js_number(safe_height - ry * 0.45),
        format_js_number(ry),
        format_js_number(ry * 0.45),
        format_js_number(rx * 0.45),
        format_js_number(rx),
    )
}

fn capsule_path_data(width_px: i64, height_px: i64) -> String {
    let safe_width = width_px.max(1) as f64;
    let safe_height = height_px.max(1) as f64;
    if safe_height >= safe_width {
        let rx = safe_width / 2.0;
        return format!(
            "M{} 0 C{} 0 {} {} {} {} L{} {} C{} {} {} {} {} {} C{} {} 0 {} 0 {} L0 {} C0 {} {} 0 {} 0 Z",
            format_js_number(rx),
            format_js_number(safe_width - rx * 0.45),
            format_js_number(safe_width),
            format_js_number(rx * 0.45),
            format_js_number(safe_width),
            format_js_number(rx),
            format_js_number(safe_width),
            format_js_number(safe_height - rx),
            format_js_number(safe_width),
            format_js_number(safe_height - rx * 0.45),
            format_js_number(safe_width - rx * 0.45),
            format_js_number(safe_height),
            format_js_number(rx),
            format_js_number(safe_height),
            format_js_number(rx * 0.45),
            format_js_number(safe_height),
            format_js_number(safe_height - rx * 0.45),
            format_js_number(safe_height - rx),
            format_js_number(rx),
            format_js_number(rx * 0.45),
            format_js_number(rx * 0.45),
            format_js_number(rx),
        );
    }

    let ry = safe_height / 2.0;
    format!(
        "M0 {} C0 {} {} 0 {} 0 L{} 0 C{} 0 {} {} {} {} C{} {} {} {} {} {} L{} {} C{} {} 0 {} 0 {} Z",
        format_js_number(ry),
        format_js_number(ry * 0.45),
        format_js_number(ry * 0.45),
        format_js_number(ry),
        format_js_number(safe_width - ry),
        format_js_number(safe_width - ry * 0.45),
        format_js_number(safe_width),
        format_js_number(ry * 0.45),
        format_js_number(safe_width),
        format_js_number(ry),
        format_js_number(safe_width),
        format_js_number(safe_height - ry * 0.45),
        format_js_number(safe_width - ry * 0.45),
        format_js_number(safe_height),
        format_js_number(safe_width - ry),
        format_js_number(safe_height),
        format_js_number(ry),
        format_js_number(safe_height),
        format_js_number(ry * 0.45),
        format_js_number(safe_height),
        format_js_number(safe_height - ry * 0.45),
        format_js_number(ry),
    )
}

fn drawing_shape_heuristic_path_data(
    path_xml: &str,
    width_px: i64,
    height_px: i64,
) -> Option<String> {
    let cubic_count = re::get_unchecked(r"(?i)<a:cubicBezTo\b").find_iter(path_xml).count();
    let line_count = re::get_unchecked(r"(?i)<a:lnTo\b").find_iter(path_xml).count();
    if cubic_count == 0 {
        return None;
    }

    if cubic_count >= 4 && line_count == 0 {
        return Some(ellipse_path_data(width_px, height_px));
    }

    if cubic_count >= 2 && line_count == 2 {
        return Some(capsule_path_data(width_px, height_px));
    }

    None
}

fn drawing_shape_resolved_path_data(
    shape_properties_xml: &str,
    width_px: i64,
    height_px: i64,
) -> Option<String> {
    let path_xml = extract_balanced_tag_blocks(shape_properties_xml, "a:path")
        .into_iter()
        .next()?;
    let direct_path_data = drawing_shape_path_data(&path_xml, width_px, height_px);
    let has_cubic = re::get_unchecked(r"(?i)<a:cubicBezTo\b").is_match(&path_xml);
    if has_cubic
        && direct_path_data
            .as_deref()
            .is_none_or(|data| !data.contains('C'))
    {
        drawing_shape_heuristic_path_data(&path_xml, width_px, height_px).or(direct_path_data)
    } else {
        direct_path_data
    }
}

fn drawing_preset_path_data(preset: Option<&str>, width_px: i64, height_px: i64) -> Option<String> {
    match preset?.trim() {
        "flowChartDelay" => {
            let safe_width = width_px.max(1);
            let safe_height = height_px.max(1);
            let radius = js_round(safe_height as f64 / 2.0).min(safe_width - 1).max(1);
            let arc_x = safe_width - radius;
            Some(format!("M0 0 H{arc_x} A{radius} {radius} 0 0 1 {arc_x} {safe_height} H0 Z"))
        }
        "rtTriangle" => {
            let safe_width = width_px.max(1);
            let safe_height = height_px.max(1);
            Some(format!("M0 {safe_height} L{safe_width} {safe_height} L0 0 Z"))
        }
        _ => None,
    }
}

fn svg_grouped_shape_transform(
    x: i64,
    y: i64,
    width_px: i64,
    height_px: i64,
    transform_xml: &str,
) -> String {
    let mut transforms = vec![format!("translate({x} {y})")];
    let flip_re = re::get_unchecked(r"(?i)^(?:1|true)$");
    let flip_h = get_attribute(transform_xml, "flipH")
        .is_some_and(|value| flip_re.is_match(&value));
    let flip_v = get_attribute(transform_xml, "flipV")
        .is_some_and(|value| flip_re.is_match(&value));
    let rotation_degrees = get_attribute(transform_xml, "rot")
        .and_then(|raw| raw.trim().parse::<f64>().ok())
        .filter(|value| value.is_finite() && value.abs() > 0.0)
        .map(|value| value / 60000.0);

    if flip_h || flip_v || rotation_degrees.is_some() {
        let center_x = js_round(width_px as f64 / 2.0);
        let center_y = js_round(height_px as f64 / 2.0);
        transforms.push(format!("translate({center_x} {center_y})"));
        if let Some(rotation_degrees) = rotation_degrees {
            transforms.push(format!("rotate({rotation_degrees:.3})"));
        }
        if flip_h || flip_v {
            transforms.push(format!(
                "scale({} {})",
                if flip_h { -1 } else { 1 },
                if flip_v { -1 } else { 1 }
            ));
        }
        transforms.push(format!("translate({} {})", -center_x, -center_y));
    }

    format!(r#" transform="{}""#, transforms.join(" "))
}

struct SvgRotationLayout {
    transform_attribute: String,
    view_box_width_px: i64,
    view_box_height_px: i64,
    preserve_aspect_ratio_none: bool,
}

fn svg_rotation_layout(
    rotation_degrees: Option<f64>,
    width_px: f64,
    height_px: f64,
) -> SvgRotationLayout {
    let safe_width = js_round(width_px).max(1);
    let safe_height = js_round(height_px).max(1);
    let Some(rotation_degrees) = rotation_degrees.filter(|value| value.abs() >= 0.01) else {
        return SvgRotationLayout {
            transform_attribute: String::new(),
            view_box_width_px: safe_width,
            view_box_height_px: safe_height,
            preserve_aspect_ratio_none: false,
        };
    };

    let radians = (rotation_degrees * std::f64::consts::PI) / 180.0;
    let cos = radians.cos();
    let sin = radians.sin();
    let center_x = safe_width as f64 / 2.0;
    let center_y = safe_height as f64 / 2.0;
    let corners: Vec<(f64, f64)> = [
        (0.0, 0.0),
        (safe_width as f64, 0.0),
        (safe_width as f64, safe_height as f64),
        (0.0, safe_height as f64),
    ]
    .into_iter()
    .map(|(x, y)| {
        let delta_x = x - center_x;
        let delta_y = y - center_y;
        (
            center_x + delta_x * cos - delta_y * sin,
            center_y + delta_x * sin + delta_y * cos,
        )
    })
    .collect();
    let min_x = corners.iter().map(|(x, _)| *x).fold(f64::INFINITY, f64::min);
    let max_x = corners.iter().map(|(x, _)| *x).fold(f64::NEG_INFINITY, f64::max);
    let min_y = corners.iter().map(|(_, y)| *y).fold(f64::INFINITY, f64::min);
    let max_y = corners.iter().map(|(_, y)| *y).fold(f64::NEG_INFINITY, f64::max);
    let view_box_width_px = ((max_x - min_x).ceil() as i64).max(1);
    let view_box_height_px = ((max_y - min_y).ceil() as i64).max(1);

    SvgRotationLayout {
        transform_attribute: format!(
            r#" transform="translate({} {}) rotate({rotation_degrees:.3} {} {})""#,
            format_fixed2(-min_x),
            format_fixed2(-min_y),
            format_fixed2(center_x),
            format_fixed2(center_y)
        ),
        view_box_width_px,
        view_box_height_px,
        preserve_aspect_ratio_none: true,
    }
}

/// Mirrors JavaScript `Math.round` (half-up, including for negative values).
fn js_round(value: f64) -> i64 {
    (value + 0.5).floor() as i64
}

/// Mirrors JavaScript number-to-string template interpolation for finite values.
fn format_js_number(value: f64) -> String {
    if value == 0.0 {
        return "0".to_string();
    }
    format!("{value}")
}

/// Mirrors JavaScript `Number#toFixed(2)` (without negative-zero output).
fn format_fixed2(value: f64) -> String {
    let value = if value == 0.0 { 0.0 } else { value };
    format!("{value:.2}")
}

fn estimate_text_width_px(text: &str, font_size_px: f64) -> f64 {
    if text.is_empty() {
        return 0.0;
    }
    let mut width_units = 0.0;
    for ch in text.chars() {
        width_units += if ch.is_whitespace() {
            0.34
        } else if ch.is_ascii_uppercase() {
            0.66
        } else if ch.is_ascii_lowercase() {
            0.55
        } else if ch.is_ascii_digit() {
            0.57
        } else if re::get(r"[\u{2e80}-\u{9fff}\u{3040}-\u{30ff}\u{ac00}-\u{d7af}]").is_some_and(|re| re.is_match(&ch.to_string()))
        {
            1.0
        } else {
            0.45
        };
    }
    width_units * font_size_px
}

fn resolve_svg_font_family(font_family: Option<&str>) -> String {
    let trimmed = font_family.unwrap_or("").trim();
    if trimmed.is_empty() {
        return "Calibri, Arial, sans-serif".to_string();
    }
    if trimmed.contains(',') {
        return trimmed.to_string();
    }
    if re::get_unchecked(r"(?i)times|georgia|garamond|serif").is_match(trimmed)
    {
        format!("{trimmed}, serif")
    } else {
        format!("{trimmed}, Arial, sans-serif")
    }
}

fn regex_capture(xml: &str, pattern: &str) -> Option<String> {
    re::get(pattern)?
        .captures(xml)
        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
}

fn regex_tag(xml: &str, pattern: &str) -> Option<String> {
    re::get(pattern)?
        .find(xml)
        .map(|m| m.as_str().to_string())
}
