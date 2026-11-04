use crate::model::{ImagePaintBounds, ParagraphAlignment};
use crate::parse::context::ParseContext;
use crate::parse::re;
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
    pub images: Vec<ParsedTextBoxImage>,
}

#[derive(Clone, Debug)]
pub struct ParsedTextBoxImage {
    pub src: String,
    pub width_px: f64,
    pub height_px: f64,
    pub paint_bounds: Option<Box<ImagePaintBounds>>,
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

pub fn parse_text_box_paragraphs(
    run_xml: &str,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
) -> Vec<ParsedTextBoxParagraph> {
    let normalized_run_xml = prefer_alternate_content_choice(run_xml);
    let text_box_xml = extract_balanced_tag_blocks(&normalized_run_xml, "w:txbxContent")
        .into_iter()
        .next();
    let Some(text_box_xml) = text_box_xml else {
        return Vec::new();
    };
    let paragraphs = extract_balanced_tag_blocks(&text_box_xml, "w:p");
    let mut resolved = Vec::new();
    let mut has_visible_text = false;
    for paragraph_xml in paragraphs {
        let paragraph_text = super::paragraph::parse_run_text(&paragraph_xml)
            .trim_end_matches('\n')
            .to_string();
        let images = super::images::parse_run_images(&paragraph_xml, context)
            .into_iter()
            .filter_map(|image| {
                Some(ParsedTextBoxImage {
                    src: image.src?,
                    width_px: image.width_px.unwrap_or(96.0).max(1.0),
                    height_px: image.height_px.unwrap_or(96.0).max(1.0),
                    paint_bounds: image.paint_bounds,
                })
            })
            .collect::<Vec<_>>();
        has_visible_text |= !paragraph_text.is_empty() || !images.is_empty();
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
            .and_then(|id| context.styles().paragraph_style_by_id.get(id));
        let first_run_xml = extract_balanced_tag_blocks(&paragraph_xml, "w:r")
            .into_iter()
            .next();
        let run_properties_xml = first_run_xml
            .as_ref()
            .and_then(|run| {
                extract_balanced_tag_blocks(run, "w:rPr")
                    .into_iter()
                    .next()
                    .or_else(|| regex_tag(run, r"(?i)<w:rPr\b[^>]*/?>"))
            })
            .unwrap_or_default();
        let paragraph_run_properties_xml =
            extract_balanced_tag_blocks(&paragraph_properties_xml, "w:rPr")
                .into_iter()
                .next()
                .or_else(|| regex_tag(&paragraph_properties_xml, r"(?i)<w:rPr\b[^>]*/?>"))
                .unwrap_or_default();
        let style = super::util::merge_text_styles(&[
            context.styles().default_run_style.clone(),
            paragraph_style.and_then(|s| s.run_style.clone()),
            parse_text_style_from_xml(&paragraph_run_properties_xml, &context.styles().theme_fonts),
            parse_text_style_from_xml(&run_properties_xml, &context.styles().theme_fonts),
        ]);
        let align = super::style::parse_paragraph_align_from_xml(&paragraph_properties_xml)
            .or_else(|| paragraph_style.and_then(|s| s.align));
        resolved.push(ParsedTextBoxParagraph {
            text: paragraph_text,
            style,
            align,
            images,
        });
    }
    if has_visible_text {
        resolved
    } else {
        Vec::new()
    }
}

pub fn parse_text_box_layout(run_xml: &str) -> Option<ParsedTextBoxLayout> {
    let normalized_run_xml = prefer_alternate_content_choice(run_xml);
    let body_pr_xml = extract_balanced_tag_blocks(&normalized_run_xml, "wps:bodyPr")
        .into_iter()
        .next()
        .or_else(|| regex_tag(&normalized_run_xml, r"(?i)<wps:bodyPr\b[^>]*/?>"));
    if let Some(body_pr_xml) = body_pr_xml {
        let anchor_raw =
            get_attribute(&body_pr_xml, "anchor").map(|v| v.trim().to_ascii_lowercase());
        let vertical_anchor = match anchor_raw.as_deref() {
            Some("ctr") => Some("center".to_string()),
            Some("b") => Some("bottom".to_string()),
            _ => Some("top".to_string()),
        };
        return Some(ParsedTextBoxLayout {
            padding_left_px: emu_to_pixels(get_attribute(&body_pr_xml, "lIns").as_deref()),
            padding_top_px: emu_to_pixels(get_attribute(&body_pr_xml, "tIns").as_deref()),
            padding_right_px: emu_to_pixels(get_attribute(&body_pr_xml, "rIns").as_deref()),
            padding_bottom_px: emu_to_pixels(get_attribute(&body_pr_xml, "bIns").as_deref()),
            vertical_anchor,
        });
    }

    let text_box_tag = regex_tag(&normalized_run_xml, r"(?i)<v:textbox\b[^>]*>")
        .or_else(|| regex_tag(&normalized_run_xml, r"(?i)<v:textbox\b[^>]*/>"))?;
    let inset = get_attribute(&text_box_tag, "inset")?;
    let mut values = inset.split(',').map(str::trim);
    Some(ParsedTextBoxLayout {
        padding_left_px: super::images::css_length_to_pixels(values.next()),
        padding_top_px: super::images::css_length_to_pixels(values.next()),
        padding_right_px: super::images::css_length_to_pixels(values.next()),
        padding_bottom_px: super::images::css_length_to_pixels(values.next()),
        vertical_anchor: Some("top".to_string()),
    })
}

pub fn render_text_box_svg(
    paragraphs: &[ParsedTextBoxParagraph],
    width_px: Option<f64>,
    height_px: Option<f64>,
    layout: Option<&ParsedTextBoxLayout>,
) -> String {
    render_text_box_svg_impl(paragraphs, width_px, height_px, layout, false)
}

pub(crate) fn render_bounded_text_box_svg(
    paragraphs: &[ParsedTextBoxParagraph],
    width_px: f64,
    height_px: f64,
    layout: Option<&ParsedTextBoxLayout>,
) -> String {
    render_text_box_svg_impl(paragraphs, Some(width_px), Some(height_px), layout, true)
}

fn render_text_box_svg_impl(
    paragraphs: &[ParsedTextBoxParagraph],
    width_px: Option<f64>,
    height_px: Option<f64>,
    layout: Option<&ParsedTextBoxLayout>,
    bounded: bool,
) -> String {
    let safe_width = clamp_i64(
        width_px.unwrap_or(320.0).round() as i64,
        if bounded { 1 } else { 80 },
        2400,
    ) as f64;
    let line_heights: Vec<i64> = paragraphs
        .iter()
        .map(|paragraph| {
            let font_size_pt = paragraph
                .style
                .as_ref()
                .and_then(|s| s.font_size_pt)
                .unwrap_or(12.0);
            let font_size_px = ((font_size_pt * 96.0) / 72.0).round().max(10.0) as i64;
            let text_height = (font_size_px as f64 * 1.24).round().max(14.0) as i64;
            let image_height = paragraph
                .images
                .iter()
                .map(|image| clamp_i64(image.height_px.round() as i64, 1, 2400))
                .max()
                .unwrap_or(0);
            text_height.max(image_height)
        })
        .collect();
    let estimated_height: i64 = line_heights.iter().sum::<i64>() + 24;
    let safe_height = clamp_i64(
        height_px.unwrap_or(estimated_height as f64).round() as i64,
        if bounded { 1 } else { 48 },
        2400,
    ) as f64;
    let horizontal_inset = ((layout
        .and_then(|l| l.padding_left_px)
        .unwrap_or(safe_width * 0.03))
    .round() as i64)
        .max(if bounded { 0 } else { 8 }) as f64;
    let top_inset = ((layout
        .and_then(|l| l.padding_top_px)
        .unwrap_or(safe_height * 0.04))
    .round() as i64)
        .max(if bounded { 0 } else { 8 }) as f64;
    let right_inset = ((layout
        .and_then(|l| l.padding_right_px)
        .unwrap_or(horizontal_inset))
    .round() as i64)
        .max(if bounded { 0 } else { 8 }) as f64;
    let bottom_inset = ((layout
        .and_then(|l| l.padding_bottom_px)
        .unwrap_or(top_inset))
    .round() as i64)
        .max(if bounded { 0 } else { 8 }) as f64;
    let max_text_width = (safe_width - horizontal_inset * 2.0).max(20.0);
    let total_text_height: f64 = line_heights.iter().map(|h| *h as f64).sum();
    let available_height = (safe_height - top_inset - bottom_inset).max(0.0);
    let mut vertical_scale = if total_text_height > available_height && total_text_height > 0.0 {
        (available_height / total_text_height).clamp(0.25, 1.0)
    } else {
        1.0
    };
    let scaled_text_height = total_text_height * vertical_scale;
    let mut start_offset_y = match layout.and_then(|l| l.vertical_anchor.as_deref()) {
        Some("center") => {
            top_inset
                + ((available_height - scaled_text_height) / 2.0)
                    .max(0.0)
                    .round()
        }
        Some("bottom") => (safe_height - bottom_inset - scaled_text_height)
            .max(top_inset)
            .round(),
        _ => top_inset.round(),
    };
    let baseline_limit = safe_height - 4.0;
    let mut recovered_fit = false;
    if bounded && total_text_height > 0.0 {
        let mut baseline = start_offset_y;
        let omits_painted_content = paragraphs.iter().zip(&line_heights).any(|(paragraph, height)| {
            baseline += *height as f64 * vertical_scale;
            baseline > baseline_limit && (!paragraph.text.is_empty() || !paragraph.images.is_empty())
        });
        let fitted_height = (safe_height - top_inset - bottom_inset.max(4.0)).max(0.0);
        let fitted_scale = (fitted_height / total_text_height).min(1.0);
        if omits_painted_content && fitted_scale >= 0.25 {
            vertical_scale = fitted_scale;
            let fitted_text_height = total_text_height * vertical_scale;
            start_offset_y = match layout.and_then(|l| l.vertical_anchor.as_deref()) {
                Some("center") => top_inset + ((fitted_height - fitted_text_height) / 2.0).max(0.0).round(),
                Some("bottom") => (safe_height - bottom_inset.max(4.0) - fitted_text_height).max(top_inset).round(),
                _ => top_inset.round(),
            };
            recovered_fit = true;
        }
    }
    let mut cursor_y = start_offset_y;
    let mut unscaled_cursor_y = 0_i64;
    let mut lines = Vec::new();
    for (paragraph_index, paragraph) in paragraphs.iter().enumerate() {
        let font_size_pt = paragraph
            .style
            .as_ref()
            .and_then(|s| s.font_size_pt)
            .unwrap_or(12.0);
        let font_size_px = ((font_size_pt * 96.0) / 72.0).round().max(10.0);
        let estimated_text_width = estimate_text_width_px(&paragraph.text, font_size_px);
        let overflow_ratio = if estimated_text_width > 0.0 {
            max_text_width / estimated_text_width
        } else {
            1.0
        };
        let fitted_font_size_px = (if overflow_ratio < 1.0 {
            font_size_px * overflow_ratio
        } else {
            font_size_px
        } * vertical_scale)
            .round()
            .max(6.0);
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
            .unwrap_or(((fitted_font_size_px * 1.24).round().max(8.0)) as i64)
            as f64
            * vertical_scale;
        if recovered_fit {
            unscaled_cursor_y += line_heights[paragraph_index];
            cursor_y = (start_offset_y + unscaled_cursor_y as f64 * vertical_scale).min(baseline_limit);
        } else {
            cursor_y += line_height;
        }
        if cursor_y > baseline_limit {
            break;
        }
        let text_align = paragraph.align.unwrap_or(ParagraphAlignment::Left);
        let (anchor, x) = match text_align {
            ParagraphAlignment::Center => ("middle", safe_width / 2.0),
            ParagraphAlignment::Right => ("end", safe_width - right_inset),
            _ => ("start", horizontal_inset),
        };
        let text_decoration = [
            paragraph
                .style
                .as_ref()
                .and_then(|s| s.underline)
                .filter(|&u| u)
                .map(|_| "underline"),
            paragraph
                .style
                .as_ref()
                .and_then(|s| s.strike)
                .filter(|&s| s)
                .map(|_| "line-through"),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ");
        if !paragraph.text.is_empty() {
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
        if !paragraph.images.is_empty() {
            let available_width = (safe_width - horizontal_inset - right_inset).max(1.0);
            let total_width = paragraph
                .images
                .iter()
                .map(|image| image.width_px.min(available_width).max(1.0))
                .sum::<f64>();
            let force_right = paragraph.text.contains('\t')
                || paragraph.text.chars().take_while(|ch| *ch == ' ').count() >= 4;
            let mut image_x = if force_right || text_align == ParagraphAlignment::Right {
                (safe_width - right_inset - total_width).max(horizontal_inset)
            } else if text_align == ParagraphAlignment::Center {
                ((safe_width - total_width) / 2.0).max(horizontal_inset)
            } else {
                horizontal_inset
            };
            for image in &paragraph.images {
                let width = image.width_px.min(available_width).max(1.0);
                let scale = width / image.width_px.max(1.0);
                let height = (image.height_px * scale).min(line_height).max(1.0);
                let image_y = (cursor_y - height).max(0.0);
                if let Some(paint) = image.paint_bounds.as_ref() {
                    let scale_x = width / paint.layout_width_px;
                    let scale_y = height / paint.layout_height_px;
                    let paint_x = image_x + paint.x_px * scale_x;
                    let paint_y = image_y + paint.y_px * scale_y;
                    let paint_width = paint.width_px * scale_x;
                    let paint_height = paint.height_px * scale_y;
                    lines.push(format!(
                        r#"<image href="{}" x="{paint_x}" y="{paint_y}" width="{paint_width}" height="{paint_height}" preserveAspectRatio="none"/>"#,
                        escape_xml_text(&image.src),
                    ));
                } else {
                    lines.push(format!(
                        r#"<image href="{}" x="{image_x:.0}" y="{image_y:.0}" width="{width:.0}" height="{height:.0}" preserveAspectRatio="xMidYMid meet"/>"#,
                        escape_xml_text(&image.src),
                    ));
                }
                image_x += width;
            }
        }
    }
    format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{safe_width:.0}" height="{safe_height:.0}" viewBox="0 0 {safe_width:.0} {safe_height:.0}">
    <rect x="0" y="0" width="{safe_width:.0}" height="{safe_height:.0}" fill="none"/>
    {}
  </svg>"#,
        lines.join("")
    )
}

#[derive(Clone, Copy)]
struct DrawingGroupTransform {
    scale_x: f64,
    scale_y: f64,
    origin_x: f64,
    origin_y: f64,
    integer_origin: Option<(i64, i64)>,
}

impl DrawingGroupTransform {
    fn position(&self, x: i64, y: i64) -> (f64, f64) {
        let delta_x = self
            .integer_origin
            .map(|origin| x.wrapping_sub(origin.0) as f64)
            .unwrap_or_else(|| x as f64 - self.origin_x);
        let delta_y = self
            .integer_origin
            .map(|origin| y.wrapping_sub(origin.1) as f64)
            .unwrap_or_else(|| y as f64 - self.origin_y);
        (delta_x * self.scale_x, delta_y * self.scale_y)
    }
}

fn drawing_coordinates_are_exact(xml: &str) -> bool {
    crate::xml::extract_balanced_tag_blocks_in_order(xml, &["a:off", "a:ext", "a:chOff", "a:chExt"])
        .into_iter()
        .all(|range| {
            let tag = &xml[range.start..range.end];
            ["x", "y", "cx", "cy"].iter().all(|name| {
                get_attribute(tag, name).is_none_or(|raw| {
                    raw.parse::<i64>()
                        .is_ok_and(|value| value.unsigned_abs() <= (1_u64 << 53))
                })
            })
        })
}

struct GroupedDrawing<'a> {
    xml: &'a str,
    picture: bool,
    transform: DrawingGroupTransform,
    bitmap_fill_supported: bool,
}

fn collect_grouped_drawings<'a>(
    group_xml: &'a str,
    transform: DrawingGroupTransform,
    depth: usize,
    output: &mut Vec<GroupedDrawing<'a>>,
) -> Option<()> {
    if depth > 64 {
        return None;
    }
    let start = crate::xml::tag_token_end(group_xml, 0)?;
    let end = group_xml.rfind("</")?;
    let content = group_xml.get(start..end)?;
    for range in crate::xml::extract_balanced_tag_blocks_in_order(
        content,
        &["pic:pic", "wps:wsp", "wpg:grpSp"],
    ) {
        let xml = &content[range.start..range.end];
        if range.tag_name != "wpg:grpSp" {
            let picture = range.tag_name == "pic:pic";
            if depth > 0 && (picture || transform.scale_x != transform.scale_y) {
                let properties = crate::xml::direct_child_tag(
                    xml,
                    if picture { "pic:spPr" } else { "wps:spPr" },
                );
                let local_transform =
                    properties.and_then(|value| crate::xml::direct_child_tag(value, "a:xfrm"));
                if let Some(local_transform) = local_transform {
                    let opening =
                        &local_transform[..crate::xml::tag_token_end(local_transform, 0)?];
                    if get_attribute(opening, "rot").is_some_and(|raw| {
                        raw.trim().parse::<i64>().map_or(true, |angle| angle != 0)
                    }) {
                        return None;
                    }
                    if picture
                        && ["flipH", "flipV"].iter().any(|name| {
                            get_attribute(opening, name)
                                .is_some_and(|raw| !matches!(raw.trim(), "0" | "false"))
                        })
                    {
                        return None;
                    }
                }
            }
            output.push(GroupedDrawing {
                xml,
                picture,
                transform,
                bitmap_fill_supported: true,
            });
            continue;
        }
        let properties = extract_balanced_tag_blocks(xml, "wpg:grpSpPr")
            .into_iter()
            .next()?;
        let child_transform = extract_balanced_tag_blocks(&properties, "a:xfrm")
            .into_iter()
            .next()?;
        let opening = &child_transform[..crate::xml::tag_token_end(&child_transform, 0)?];
        for name in ["rot", "flipH", "flipV"] {
            if get_attribute(opening, name)
                .is_some_and(|value| !matches!(value.as_str(), "0" | "false"))
            {
                return None;
            }
        }
        let off = regex_tag(&child_transform, r"(?i)<a:off\b[^>]*/?>")?;
        let ext = regex_tag(&child_transform, r"(?i)<a:ext\b[^>]*/?>")?;
        let child_off = regex_tag(&child_transform, r"(?i)<a:chOff\b[^>]*/?>")?;
        let child_ext = regex_tag(&child_transform, r"(?i)<a:chExt\b[^>]*/?>")?;
        let width = parse_integer_attribute(&ext, "cx")? as f64;
        let height = parse_integer_attribute(&ext, "cy")? as f64;
        let child_width = parse_integer_attribute(&child_ext, "cx")? as f64;
        let child_height = parse_integer_attribute(&child_ext, "cy")? as f64;
        if width <= 0.0 || height <= 0.0 || child_width <= 0.0 || child_height <= 0.0 {
            return None;
        }
        let scale_x = width / child_width;
        let scale_y = height / child_height;
        let origin_x = parse_integer_attribute(&child_off, "x")? as f64
            - (parse_integer_attribute(&off, "x")? as f64 - transform.origin_x) / scale_x;
        let origin_y = parse_integer_attribute(&child_off, "y")? as f64
            - (parse_integer_attribute(&off, "y")? as f64 - transform.origin_y) / scale_y;
        let composed = DrawingGroupTransform {
            scale_x: transform.scale_x * scale_x,
            scale_y: transform.scale_y * scale_y,
            origin_x,
            origin_y,
            integer_origin: None,
        };
        if ![
            composed.scale_x,
            composed.scale_y,
            composed.origin_x,
            composed.origin_y,
        ]
        .into_iter()
        .all(f64::is_finite)
        {
            return None;
        }
        collect_grouped_drawings(xml, composed, depth + 1, output)?;
    }
    Some(())
}

fn grouped_drawings<'a>(
    group_xml: &'a str,
    transform: DrawingGroupTransform,
) -> Vec<GroupedDrawing<'a>> {
    let root_properties = crate::xml::direct_child_tag(group_xml, "wpg:grpSpPr");
    let root_transform =
        root_properties.and_then(|xml| crate::xml::direct_child_tag(xml, "a:xfrm"));
    let root_axis_aligned = drawing_coordinates_are_exact(group_xml)
        && root_transform.is_some_and(|xml| {
            let Some(end) = crate::xml::tag_token_end(xml, 0) else {
                return false;
            };
            ["rot", "flipH", "flipV"].iter().all(|name| {
                get_attribute(&xml[..end], name)
                    .is_none_or(|value| matches!(value.as_str(), "0" | "false"))
            })
        });
    let has_nested_groups = re::get_unchecked(r"<wpg:grpSp\b").is_match(group_xml);
    let mut result = Vec::new();
    if root_axis_aligned
        && has_nested_groups
        && collect_grouped_drawings(group_xml, transform, 0, &mut result).is_some()
    {
        return result;
    }
    crate::xml::extract_balanced_tag_blocks_in_order(group_xml, &["pic:pic", "wps:wsp"])
        .into_iter()
        .map(|range| GroupedDrawing {
            xml: &group_xml[range.start..range.end],
            picture: range.tag_name == "pic:pic",
            transform,
            bitmap_fill_supported: root_axis_aligned && !has_nested_groups,
        })
        .collect()
}

pub fn render_standalone_word_shape_svg(
    run_xml: &str,
    width_px: Option<f64>,
    height_px: Option<f64>,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
) -> Option<String> {
    if let Some(group_xml) = crate::xml::extract_balanced_tag_slices(run_xml, "wpg:wgp")
        .into_iter()
        .next()
    {
        let group_transform_xml = crate::xml::extract_balanced_tag_slices(&group_xml, "a:xfrm")
            .into_iter()
            .next()
            .unwrap_or_default();
        let child_offset_tag =
            regex_tag(&group_transform_xml, r"(?i)<a:chOff\b[^>]*/?>").unwrap_or_default();
        let child_extent_tag =
            regex_tag(&group_transform_xml, r"(?i)<a:chExt\b[^>]*/?>").unwrap_or_default();
        let child_offset_x = parse_integer_attribute(&child_offset_tag, "x").unwrap_or(0);
        let child_offset_y = parse_integer_attribute(&child_offset_tag, "y").unwrap_or(0);
        let child_extent_x = parse_integer_attribute(&child_extent_tag, "cx")
            .unwrap_or(1)
            .max(1);
        let child_extent_y = parse_integer_attribute(&child_extent_tag, "cy")
            .unwrap_or(1)
            .max(1);
        let safe_width = clamp_i64(js_round(width_px.unwrap_or(320.0)), 1, 2400);
        let safe_height = clamp_i64(js_round(height_px.unwrap_or(120.0)), 1, 2400);
        let scale_x = safe_width as f64 / child_extent_x as f64;
        let scale_y = safe_height as f64 / child_extent_y as f64;
        let mut elements = Vec::new();
        let root_transform = DrawingGroupTransform {
            scale_x,
            scale_y,
            origin_x: child_offset_x as f64,
            origin_y: child_offset_y as f64,
            integer_origin: Some((child_offset_x, child_offset_y)),
        };
        let grouped = grouped_drawings(&group_xml, root_transform);
        for (shape_index, drawing) in grouped.iter().enumerate() {
            let shape_xml = drawing.xml;
            let transform = drawing.transform;
            let scale_x = transform.scale_x;
            let scale_y = transform.scale_y;
            if drawing.picture {
                if let Some(element) =
                    render_grouped_picture_svg_element(shape_xml, transform, context)
                {
                    elements.push(element);
                }
                continue;
            }
            let shape_properties_xml = crate::xml::extract_balanced_tag_slices(&shape_xml, "wps:spPr")
                .into_iter()
                .next()
                .unwrap_or_default();
            let transform_xml = crate::xml::extract_balanced_tag_slices(&shape_properties_xml, "a:xfrm")
                .into_iter()
                .next()
                .unwrap_or_default();
            let off_tag = regex_tag(&transform_xml, r"(?i)<a:off\b[^>]*/?>").unwrap_or_default();
            let ext_tag = regex_tag(&transform_xml, r"(?i)<a:ext\b[^>]*/?>").unwrap_or_default();
            let (off_x_px, off_y_px) = transform.position(
                parse_integer_attribute(&off_tag, "x").unwrap_or(0),
                parse_integer_attribute(&off_tag, "y").unwrap_or(0),
            );
            let ext_x_px = parse_integer_attribute(&ext_tag, "cx").unwrap_or(0);
            let ext_y_px = parse_integer_attribute(&ext_tag, "cy").unwrap_or(0);
            let shape_width = js_round(ext_x_px as f64 * scale_x).max(1);
            let shape_height = js_round(ext_y_px as f64 * scale_y).max(1);
            let x = js_round(off_x_px);
            let y = js_round(off_y_px);
            let shape_transform = svg_grouped_shape_transform(
                x as f64,
                y as f64,
                shape_width as f64,
                shape_height as f64,
                &transform_xml,
            );
            let preset = get_attribute(
                &regex_tag(&shape_properties_xml, r"(?i)<a:prstGeom\b[^>]*>").unwrap_or_default(),
                "prst",
            )
            .map(|value| value.trim().to_string());
            let style_xml = crate::xml::extract_balanced_tag_slices(&shape_xml, "wps:style")
                .into_iter()
                .next()
                .unwrap_or_default();
            let fill = drawing
                .bitmap_fill_supported
                .then(|| {
                    drawing_tile_fill_markup(
                        &shape_properties_xml,
                        &transform_xml,
                        shape_width,
                        shape_height,
                        context,
                        &format!("group-bitmap-{shape_index}"),
                    )
                })
                .flatten()
                .unwrap_or_else(|| {
                    drawing_shape_fill_markup(
                        &format!("{shape_properties_xml}{style_xml}"),
                        &context.styles().theme_colors,
                        &format!("group-fill-{shape_index}"),
                    )
                });
            let stroke = drawing_shape_stroke_markup(
                &format!("{shape_properties_xml}{style_xml}"),
                &context.styles().theme_colors,
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
                .map(|svg| {
                    re::get_unchecked(r"(?i)^<svg\b")
                        .replace(&svg, "<svg x=\"0\" y=\"0\"")
                        .to_string()
                })
                .unwrap_or_default();
            let preset_path_data =
                drawing_preset_path_data(preset.as_deref(), shape_width, shape_height);

            let bitmap_fill = drawing
                .bitmap_fill_supported
                .then(|| {
                    render_rect_shape_bitmap_fill_svg(
                        &shape_properties_xml,
                        shape_width,
                        shape_height,
                        context,
                    )
                })
                .flatten();
            if let Some(bitmap) = bitmap_fill {
                elements.push(format!(
                    r#"<g{shape_transform}>{bitmap}<rect x="0" y="0" width="{shape_width}" height="{shape_height}" fill="none" {stroke}/>{local_text_box_svg}</g>"#,
                ));
                continue;
            }

            if preset.as_deref() == Some("line") {
                let line_width = ext_x_px as f64 * scale_x;
                let line_height = ext_y_px as f64 * scale_y;
                let line_transform = svg_grouped_shape_transform(
                    off_x_px,
                    off_y_px,
                    line_width,
                    line_height,
                    &transform_xml,
                );
                elements.push(format!(
                    r#"<g{line_transform}><line x1="0" y1="0" x2="{line_width}" y2="{line_height}" {stroke} fill="none" vector-effect="non-scaling-stroke"/>{local_text_box_svg}</g>"#,
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
                r#"<svg xmlns="http://www.w3.org/2000/svg" width="{safe_width}" height="{safe_height}" viewBox="0 0 {safe_width} {safe_height}" preserveAspectRatio="none">{}</svg>"#,
                elements.join("")
            ));
        }
    }

    let shape_xml = crate::xml::extract_balanced_tag_slices(run_xml, "wps:wsp")
        .into_iter()
        .next()?;
    if re::get(r"(?i)<w:txbxContent\b").is_some_and(|re| re.is_match(&shape_xml)) {
        return None;
    }
    let shape_properties_xml = crate::xml::extract_balanced_tag_slices(&shape_xml, "wps:spPr")
        .into_iter()
        .next()?;
    let safe_width = clamp_i64(js_round(width_px.unwrap_or(320.0)), 1, 2400);
    let safe_height = clamp_i64(js_round(height_px.unwrap_or(240.0)), 1, 2400);
    let rotation_degrees = get_attribute(
        &crate::xml::extract_balanced_tag_slices(&shape_properties_xml, "a:xfrm")
            .into_iter()
            .next()
            .unwrap_or_default(),
        "rot",
    )
    .and_then(|raw| raw.trim().parse::<f64>().ok())
    .filter(|value| value.is_finite())
    .map(|value| value / 60000.0);
    let mut rotation_layout =
        svg_rotation_layout(rotation_degrees, safe_width as f64, safe_height as f64);
    let transform_xml = crate::xml::extract_balanced_tag_slices(&shape_properties_xml, "a:xfrm")
        .into_iter()
        .next()
        .unwrap_or_default();
    let flip_h = get_attribute(&transform_xml, "flipH").is_some_and(|v| v == "1" || v == "true");
    let flip_v = get_attribute(&transform_xml, "flipV").is_some_and(|v| v == "1" || v == "true");
    if flip_h || flip_v {
        let flip = format!(
            "translate({} {}) scale({} {})",
            if flip_h { safe_width } else { 0 },
            if flip_v { safe_height } else { 0 },
            if flip_h { -1 } else { 1 },
            if flip_v { -1 } else { 1 }
        );
        if rotation_layout.transform_attribute.is_empty() {
            rotation_layout.transform_attribute = format!(r#" transform="{flip}""#);
        } else {
            rotation_layout.transform_attribute.pop();
            rotation_layout
                .transform_attribute
                .push_str(&format!(r#" {flip}""#));
        }
    }
    let preset = get_attribute(
        &regex_tag(&shape_properties_xml, r"(?i)<a:prstGeom\b[^>]*>").unwrap_or_default(),
        "prst",
    )
    .map(|value| value.trim().to_string());
    let style_xml = crate::xml::extract_balanced_tag_slices(&shape_xml, "wps:style")
        .into_iter()
        .next()
        .unwrap_or_default();
    if let Some(bitmap) = render_stretched_bitmap_shape_svg(
        &shape_properties_xml,
        &style_xml,
        safe_width,
        safe_height,
        &rotation_layout.transform_attribute,
        context,
    ) {
        return Some(format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="{}" height="{}" viewBox="0 0 {} {}"{}>{bitmap}</svg>"#,
            rotation_layout.view_box_width_px,
            rotation_layout.view_box_height_px,
            rotation_layout.view_box_width_px,
            rotation_layout.view_box_height_px,
            if rotation_layout.preserve_aspect_ratio_none {
                r#" preserveAspectRatio="none""#
            } else {
                ""
            },
        ));
    }
    let fill = drawing_shape_fill_markup(
        &format!("{shape_properties_xml}{style_xml}"),
        &context.styles().theme_colors,
        "shape-fill",
    );
    let stroke = drawing_shape_stroke_markup(
        &format!("{shape_properties_xml}{style_xml}"),
        &context.styles().theme_colors,
    );
    let path_data =
        drawing_shape_resolved_path_data(&shape_properties_xml, safe_width, safe_height);
    let preset_path_data = drawing_preset_path_data(preset.as_deref(), safe_width, safe_height);
    let body = if preset.as_deref() == Some("line") {
        let x1 = if width_px == Some(0.0) { 0.5 } else { 0.0 };
        let y1 = if height_px == Some(0.0) { 0.5 } else { 0.0 };
        let x2 = if width_px == Some(0.0) {
            0.5
        } else {
            safe_width as f64
        };
        let y2 = if height_px == Some(0.0) {
            0.5
        } else {
            safe_height as f64
        };
        format!(
            r#"<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" {stroke} fill="none" vector-effect="non-scaling-stroke"{}/>"#,
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
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{}" height="{}" viewBox="0 0 {} {}"{}><defs>{}</defs>{body}</svg>"#,
        rotation_layout.view_box_width_px,
        rotation_layout.view_box_height_px,
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
    transform: DrawingGroupTransform,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
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
    let scale_x = transform.scale_x;
    let scale_y = transform.scale_y;
    let (off_x_px, off_y_px) = transform.position(
        parse_integer_attribute(&off_tag, "x").unwrap_or(0),
        parse_integer_attribute(&off_tag, "y").unwrap_or(0),
    );
    let ext_x_px = parse_integer_attribute(&ext_tag, "cx").unwrap_or(0);
    let ext_y_px = parse_integer_attribute(&ext_tag, "cy").unwrap_or(0);
    let x = js_round(off_x_px);
    let y = js_round(off_y_px);
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

struct RectBitmapFill {
    relationship_id: String,
    offsets: [f64; 4],
}

fn simple_rect_bitmap_fill(shape_properties_xml: &str) -> Option<RectBitmapFill> {
    if !shape_properties_xml.contains("a:blipFill") {
        return None;
    }
    let geometry = crate::xml::direct_child_tag(shape_properties_xml, "a:prstGeom")?;
    if get_attribute(geometry, "prst").as_deref() != Some("rect") {
        return None;
    }
    let properties = crate::xml::extract_direct_child_tag_ranges(shape_properties_xml);
    if properties.iter().any(|child| {
        matches!(
            child.tag_name.as_str(),
            "a:custGeom" | "a:effectLst" | "a:effectDag"
        )
    }) {
        return None;
    }
    let fills = properties
        .iter()
        .filter(|child| {
            matches!(
                child.tag_name.as_str(),
                "a:blipFill"
                    | "a:solidFill"
                    | "a:gradFill"
                    | "a:pattFill"
                    | "a:grpFill"
                    | "a:noFill"
            )
        })
        .collect::<Vec<_>>();
    if fills.len() != 1 || fills[0].tag_name != "a:blipFill" {
        return None;
    }
    let fill_xml = &shape_properties_xml[fills[0].start..fills[0].end];
    let mut fill_children = crate::xml::extract_direct_child_tag_ranges(fill_xml);
    if fill_children.iter().filter(|child| child.tag_name == "a:srcRect").count() > 1 {
        return None;
    }
    for child in fill_children.iter().filter(|child| child.tag_name == "a:srcRect") {
        if !bitmap_rectangle_is_uncropped(&fill_xml[child.start..child.end]) {
            return None;
        }
    }
    fill_children.retain(|child| child.tag_name != "a:srcRect");
    if fill_children.len() != 2
        || fill_children[0].tag_name != "a:blip"
        || fill_children[1].tag_name != "a:stretch"
    {
        return None;
    }
    if get_attribute(fill_xml, "rotWithShape").is_some_and(|value| value != "1" && value != "true")
    {
        return None;
    }
    let blip = &fill_xml[fill_children[0].start..fill_children[0].end];
    if !crate::xml::extract_direct_child_tag_ranges(blip).is_empty()
        || get_attribute(blip, "r:link").is_some()
    {
        return None;
    }
    let stretch = &fill_xml[fill_children[1].start..fill_children[1].end];
    let stretch_children = crate::xml::extract_direct_child_tag_ranges(stretch);
    if stretch_children.len() != 1 || stretch_children[0].tag_name != "a:fillRect" {
        return None;
    }
    let fill_rect = &stretch[stretch_children[0].start..stretch_children[0].end];
    if !crate::xml::extract_direct_child_tag_ranges(fill_rect).is_empty() {
        return None;
    }
    let mut offsets = [0.0; 4];
    for (index, name) in ["l", "t", "r", "b"].into_iter().enumerate() {
        if let Some(value) = get_attribute(fill_rect, name) {
            let value = value.trim();
            offsets[index] = if let Some(percent) = value.strip_suffix('%') {
                percent.parse::<f64>().ok()? / 100.0
            } else {
                value.parse::<i32>().ok()? as f64 / 100_000.0
            };
            if !offsets[index].is_finite() {
                return None;
            }
        }
    }
    let width = 1.0 - offsets[0] - offsets[2];
    let height = 1.0 - offsets[1] - offsets[3];
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return None;
    }
    Some(RectBitmapFill {
        relationship_id: get_attribute(blip, "r:embed").filter(|id| !id.is_empty())?,
        offsets,
    })
}

fn render_rect_shape_bitmap_fill_svg(
    shape_properties_xml: &str,
    width_px: i64,
    height_px: i64,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
) -> Option<String> {
    if width_px <= 0 || height_px <= 0 {
        return None;
    }
    let fill = simple_rect_bitmap_fill(shape_properties_xml)?;
    let relationship_id = fill.relationship_id;
    let Some(part_name) = context.relationships.get(&relationship_id) else {
        context.push_warning(format!("Missing relationship target for {relationship_id}"));
        return None;
    };
    let Some(binary) = context.binary_assets.get(part_name) else {
        context.push_warning(format!("Missing image asset {part_name}"));
        return None;
    };
    if binary.is_empty() {
        return None;
    }
    let mime_type = content_type_for_part(part_name, &context.content_types)?;
    if !matches!(
        mime_type.as_str(),
        "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/bmp"
    ) {
        return None;
    }
    let src = format!("data:{mime_type};base64,{}", bytes_to_base64(binary));
    if fill.offsets.iter().any(|offset| *offset != 0.0) {
        let [left, top, right, bottom] = fill.offsets;
        let x = width_px as f64 * left;
        let y = height_px as f64 * top;
        let width = width_px as f64 * (1.0 - left - right);
        let height = height_px as f64 * (1.0 - top - bottom);
        if ![x, y, width, height].into_iter().all(f64::is_finite) {
            return None;
        }
        return Some(format!(
            r#"<svg x="0" y="0" width="{width_px}" height="{height_px}" viewBox="0 0 {width_px} {height_px}" overflow="hidden"><image href="{src}" x="{}" y="{}" width="{}" height="{}" preserveAspectRatio="none"/></svg>"#,
            format_js_number(x),
            format_js_number(y),
            format_js_number(width),
            format_js_number(height),
        ));
    }
    Some(format!(
        r#"<image href="{src}" x="0" y="0" width="{width_px}" height="{height_px}" preserveAspectRatio="none"/>"#
    ))
}



fn find_fill_token(xml: &str, token: &str, mut cursor: usize, boundary: bool) -> Option<usize> {
    while let Some(offset) = memchr::memchr(b'<', xml.as_bytes().get(cursor..)?) {
        let start = cursor + offset;
        let end = start.checked_add(token.len())?;
        if xml.get(start..end).is_some_and(|value| value.eq_ignore_ascii_case(token))
            && (!boundary || xml.as_bytes().get(end).is_none_or(|next| {
                !next.is_ascii_alphanumeric() && *next != b'_'
            }))
        {
            return Some(start);
        }
        cursor = start + 1;
    }
    None
}

fn remove_fill_tokens(xml: &str, opening: &str, closing: Option<&str>) -> Option<String> {
    let mut output = None;
    let mut cursor = 0;
    let mut search = 0;
    while let Some(start) = find_fill_token(xml, opening, search, true) {
        let end = if let Some(closing) = closing {
            let Some(end) = find_fill_token(xml, closing, start + opening.len(), false) else {
                break;
            };
            end + closing.len()
        } else {
            let Some(offset) = memchr::memchr(b'>', &xml.as_bytes()[start..]) else {
                break;
            };
            let end = start + offset + 1;
            if xml.as_bytes()[end - 2] != b'/' {
                search = start + 1;
                continue;
            }
            end
        };
        output.get_or_insert_with(|| String::with_capacity(xml.len())).push_str(&xml[cursor..start]);
        cursor = end;
        search = end;
    }
    if let Some(output) = output.as_mut() {
        output.push_str(&xml[cursor..]);
    }
    output
}

fn drawing_shape_fill_scope(xml: &str) -> std::borrow::Cow<'_, str> {
    let mut output = std::borrow::Cow::Borrowed(xml);
    if xml.is_ascii() {
        for (opening, closing) in [
            ("<a:ln", Some("</a:ln>")), ("<a:ln", None),
            ("<a:extLst", Some("</a:extLst>")), ("<a:extLst", None),
        ] {
            if let Some(value) = remove_fill_tokens(&output, opening, closing) {
                output = std::borrow::Cow::Owned(value);
            }
        }
    } else {
        for pattern in [r"(?is)<a:ln\b[\s\S]*?</a:ln>", r"(?i)<a:ln\b[^>]*/>", r"(?is)<a:extLst\b[\s\S]*?</a:extLst>", r"(?i)<a:extLst\b[^>]*/>"] {
            let replacement = match re::get_unchecked(pattern).replace_all(&output, "") {
                std::borrow::Cow::Owned(value) => Some(value),
                std::borrow::Cow::Borrowed(_) => None,
            };
            if let Some(value) = replacement {
                output = std::borrow::Cow::Owned(value);
            }
        }
    }
    output
}

fn drawing_shape_fill_markup(
    shape_properties_xml: &str,
    theme_colors: &crate::parse::context::ThemeColorMap,
    gradient_id: &str,
) -> ShapeFillMarkup {
    let fill_scope_xml = drawing_shape_fill_scope(shape_properties_xml);
    if let Some(solid_fill_xml) = extract_balanced_tag_blocks(&fill_scope_xml, "a:solidFill")
        .into_iter()
        .next()
    {
        if let Some((color, opacity)) =
            resolve_drawing_color_from_xml(Some(&solid_fill_xml), theme_colors)
        {
            return ShapeFillMarkup {
                fill_attribute: format!(r#"fill="{color}""#,)
                    + &opacity
                        .map(|o| format!(r#" fill-opacity="{o}""#))
                        .unwrap_or_default(),
                defs: Vec::new(),
            };
        }
    }

    if let Some(gradient_fill_xml) = extract_balanced_tag_blocks(&fill_scope_xml, "a:gradFill")
        .into_iter()
        .next()
    {
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

    if let Some(style_fill_ref_xml) = extract_balanced_tag_blocks(shape_properties_xml, "a:fillRef")
        .into_iter()
        .next()
    {
        if let Some((color, opacity)) =
            resolve_drawing_color_from_xml(Some(&style_fill_ref_xml), theme_colors)
        {
            return ShapeFillMarkup {
                fill_attribute: format!(r#"fill="{color}""#,)
                    + &opacity
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
        resolved
            .as_ref()
            .map(|(c, _)| c.as_str())
            .unwrap_or("#000000"),
        resolved
            .as_ref()
            .and_then(|(_, o)| o.map(|opacity| format!(r#" stroke-opacity="{opacity}""#)))
            .unwrap_or_default(),
        format_js_number(width_px.unwrap_or(1.0).max(0.0))
    )
}

const DRAWING_COMMAND_PATTERN: &str = r"(?is)<a:moveTo\b[\s\S]*?(?:</a:moveTo>|/>)|<a:lnTo\b[\s\S]*?(?:</a:lnTo>|/>)|<a:cubicBezTo\b[\s\S]*?(?:</a:cubicBezTo>|/>)|<a:close\b[\s\S]*?(?:</a:close>|/>)";

fn drawing_path_commands(xml: &str) -> impl Iterator<Item = &str> {
    let mut fallback =
        (!xml.is_ascii()).then(|| re::get_unchecked(DRAWING_COMMAND_PATTERN).find_iter(xml));
    let mut remaining = xml;
    let mut exhausted = 0u8;
    std::iter::from_fn(move || {
        if let Some(matches) = &mut fallback {
            return matches.next().map(|matched| matched.as_str());
        }
        while let Some(start) = memchr::memchr(b'<', remaining.as_bytes()) {
            let candidate = &remaining[start..];
            remaining = &candidate[1..];
            let name = ["a:moveTo", "a:lnTo", "a:cubicBezTo", "a:close"]
                .into_iter()
                .enumerate()
                .find(|(_, name)| {
                    remaining
                        .as_bytes()
                        .get(..name.len())
                        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(name.as_bytes()))
                        && remaining
                            .as_bytes()
                            .get(name.len())
                            .is_none_or(|byte| !byte.is_ascii_alphanumeric() && *byte != b'_')
                });
            let Some((id, name)) = name else {
                continue;
            };
            if exhausted & (1 << id) != 0 {
                continue;
            }
            let tail = &candidate[name.len() + 1..];
            let end = memchr::memchr2_iter(b'/', b'<', tail.as_bytes()).find_map(|position| {
                let token = &tail.as_bytes()[position..];
                if token.starts_with(b"/>") {
                    Some(position + 2)
                } else if token.starts_with(b"</")
                    && token
                        .get(2..name.len() + 2)
                        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(name.as_bytes()))
                    && token.get(name.len() + 2) == Some(&b'>')
                {
                    Some(position + name.len() + 3)
                } else {
                    None
                }
            });
            if let Some(end) = end {
                let end = name.len() + 1 + end;
                remaining = &candidate[end..];
                return Some(&candidate[..end]);
            }
            exhausted |= 1 << id;
        }
        None
    })
}

fn simple_drawing_point(command_xml: &str) -> Option<(&str, &str)> {
    let body = &command_xml[command_xml.find('>')? + 1..];
    let x = body.strip_prefix("<a:pt x=\"")?;
    let x_end = x.find('"')?;
    let y = x[x_end..].strip_prefix("\" y=\"")?;
    let y_end = y.find('"')?;
    if x_end == 0 || y_end == 0 || &y[y_end..] != "\"/>" {
        return None;
    }
    Some((&x[..x_end], &y[..y_end]))
}

fn drawing_shape_path_data(path_xml: &str, width_px: i64, height_px: i64) -> Option<String> {
    let path_tag = regex_tag(path_xml, r"(?i)<a:path\b[^>]*>").unwrap_or_default();
    let base_width = parse_integer_attribute(&path_tag, "w")
        .unwrap_or(21600)
        .max(1) as f64;
    let base_height = parse_integer_attribute(&path_tag, "h")
        .unwrap_or(21600)
        .max(1) as f64;
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
    for command_xml in drawing_path_commands(path_xml) {
        matched_any = true;
        let command_type = command_xml
            .get(..14)
            .unwrap_or(command_xml)
            .to_ascii_lowercase();
        if command_type.contains("close") {
            commands.push("Z".to_string());
            continue;
        }

        let points: Vec<(&str, &str)> = if let Some(point) = simple_drawing_point(command_xml) {
            vec![point]
        } else {
            re::get_unchecked(r#"(?i)<a:pt\b[^>]*x="([^"]+)"[^>]*y="([^"]+)"[^>]*/>"#)
                .captures_iter(command_xml)
                .map(|caps| {
                    (
                        caps.get(1).map(|m| m.as_str()).unwrap_or_default(),
                        caps.get(2).map(|m| m.as_str()).unwrap_or_default(),
                    )
                })
                .collect()
        };
        if command_type.contains("moveto") || command_type.contains("lnto") {
            let Some((x_raw, y_raw)) = points.first() else {
                continue;
            };
            let Some(scaled_point) = scale_point(x_raw, y_raw) else {
                continue;
            };
            commands.push(format!(
                "{}{scaled_point}",
                if command_type.contains("moveto") {
                    "M"
                } else {
                    "L"
                }
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
    let cubic_count = re::get_unchecked(r"(?i)<a:cubicBezTo\b")
        .find_iter(path_xml)
        .count();
    let line_count = re::get_unchecked(r"(?i)<a:lnTo\b")
        .find_iter(path_xml)
        .count();
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
    let path_xml = crate::xml::extract_balanced_tag_slices(shape_properties_xml, "a:path")
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
        "ellipse" => {
            let rx = width_px.max(1) as f64 / 2.0;
            let ry = height_px.max(1) as f64 / 2.0;
            let width = 2.0 * rx;
            Some(format!("M0 {ry} A{rx} {ry} 0 1 0 {width} {ry} A{rx} {ry} 0 1 0 0 {ry} Z"))
        }
        "flowChartDelay" => {
            let safe_width = width_px.max(1);
            let safe_height = height_px.max(1);
            let radius = js_round(safe_height as f64 / 2.0)
                .min(safe_width - 1)
                .max(1);
            let arc_x = safe_width - radius;
            Some(format!(
                "M0 0 H{arc_x} A{radius} {radius} 0 0 1 {arc_x} {safe_height} H0 Z"
            ))
        }
        "rtTriangle" => {
            let safe_width = width_px.max(1);
            let safe_height = height_px.max(1);
            Some(format!(
                "M0 {safe_height} L{safe_width} {safe_height} L0 0 Z"
            ))
        }
        _ => None,
    }
}

fn svg_grouped_shape_transform(
    x: f64,
    y: f64,
    width_px: f64,
    height_px: f64,
    transform_xml: &str,
) -> String {
    let mut transforms = vec![format!("translate({x} {y})")];
    let flip_re = re::get_unchecked(r"(?i)^(?:1|true)$");
    let flip_h =
        get_attribute(transform_xml, "flipH").is_some_and(|value| flip_re.is_match(&value));
    let flip_v =
        get_attribute(transform_xml, "flipV").is_some_and(|value| flip_re.is_match(&value));
    let rotation_degrees = get_attribute(transform_xml, "rot")
        .and_then(|raw| raw.trim().parse::<f64>().ok())
        .filter(|value| value.is_finite() && value.abs() > 0.0)
        .map(|value| value / 60000.0);

    if flip_h || flip_v || rotation_degrees.is_some() {
        let center_x = width_px / 2.0;
        let center_y = height_px / 2.0;
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
    let min_x = corners
        .iter()
        .map(|(x, _)| *x)
        .fold(f64::INFINITY, f64::min);
    let max_x = corners
        .iter()
        .map(|(x, _)| *x)
        .fold(f64::NEG_INFINITY, f64::max);
    let min_y = corners
        .iter()
        .map(|(_, y)| *y)
        .fold(f64::INFINITY, f64::min);
    let max_y = corners
        .iter()
        .map(|(_, y)| *y)
        .fold(f64::NEG_INFINITY, f64::max);
    let view_box_width_px = ((max_x - min_x - 1e-9).ceil() as i64).max(1);
    let view_box_height_px = ((max_y - min_y - 1e-9).ceil() as i64).max(1);

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
        } else if re::get(r"[\u{2e80}-\u{9fff}\u{3040}-\u{30ff}\u{ac00}-\u{d7af}]")
            .is_some_and(|re| re.is_match(&ch.to_string()))
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
    if re::get_unchecked(r"(?i)times|georgia|garamond|serif").is_match(trimmed) {
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
    re::get(pattern)?.find(xml).map(|m| m.as_str().to_string())
}

#[cfg(test)]
mod bitmap_fill_tests {
    use super::*;
    use crate::parse::empty_style_sheet;
    use std::{cell::RefCell, collections::HashMap};

    fn properties(offsets: &str) -> String {
        format!(
            r#"<wps:spPr><a:prstGeom prst="rect"/><a:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect {offsets}/></a:stretch></a:blipFill></wps:spPr>"#
        )
    }

    fn render(offsets: &str) -> Option<String> {
        let parts = HashMap::new();
        let assets = HashMap::from([("word/media/image.png".to_string(), vec![1, 2, 3])]);
        let context = ParseContext {
            parts: &parts,
            binary_assets: &assets,
            relationships: HashMap::from([(
                "rId1".to_string(),
                "word/media/image.png".to_string(),
            )]),
            content_types: Default::default(),
            style_sheet: empty_style_sheet(),
            warnings: RefCell::new(Vec::new()),
        };
        render_rect_shape_bitmap_fill_svg(&properties(offsets), 200, 100, &context)
    }

    #[test]
    fn zero_offsets_preserve_the_unclipped_representation() {
        let implicit = render("").unwrap();
        assert!(implicit.starts_with("<image "));
        assert_eq!(implicit, render(r#"l="0" t="0" r="0" b="0""#).unwrap());
        assert_eq!(implicit, render(r#"l="0%" r="0.0%""#).unwrap());
    }

    #[test]
    fn insets_scale_and_position_the_fill() {
        let svg = render(r#"l="10000" t="20000" r="25000" b="10000""#).unwrap();
        assert!(svg.contains(r#"x="20" y="20" width="130" height="70""#));
        assert!(svg.contains(r#"viewBox="0 0 200 100" overflow="hidden""#));
        assert_eq!(svg, render(r#"l="10%" t="20%" r="25%" b="10%""#).unwrap());
    }

    #[test]
    fn outsets_keep_the_shape_clip_and_preserve_source_bytes() {
        let svg = render(r#"l="-25000" r="-25000""#).unwrap();
        assert!(svg.contains(r#"x="-50" y="0" width="300" height="100""#));
        assert!(svg.contains("data:image/png;base64,AQID"));
        assert!(svg.contains(r#"overflow="hidden""#));
    }

    #[test]
    fn rejects_invalid_or_empty_fill_rectangles() {
        for offsets in [
            r#"l="50000" r="50000""#,
            r#"t="100001""#,
            r#"r="NaN%""#,
            r#"l="inf%""#,
            r#"b="invalid""#,
        ] {
            assert!(render(offsets).is_none(), "{offsets}");
        }
    }

    #[test]
    fn retains_guards_for_unsupported_fill_operations() {
        for xml in [
            properties("").replace("a:stretch", "a:tile"),
            properties("").replace("r:embed", "r:link"),
            properties("").replace("rect", "ellipse"),
            properties("").replace("<a:stretch>", "<a:srcRect l=\"10000\"/><a:stretch>"),
            properties("").replace("</wps:spPr>", "<a:effectLst/></wps:spPr>"),
        ] {
            assert!(simple_rect_bitmap_fill(&xml).is_none());
        }
    }
}
#[cfg(test)]
mod geometry_scan_tests {
    use super::*;

    #[test]
    fn drawing_commands_match_regex_across_boundaries() {
        let names = [
            "moveTo",
            "lnTo",
            "cubicBezTo",
            "close",
            "MOVETO",
            "cloſe",
            "lnToExtra",
            "moveTo-",
            "close.",
        ];
        let tails = ["/>", ">", " x=\"/>\">", "\n>", " ", ":>"];
        let bodies = [
            "",
            "<a:pt x=\"1\" y=\"2\"/>",
            "<a:pt y=\"2\" x=\"1\"/>",
            "<a:close/>",
            "text",
            "é",
            "<a:lnTo><a:pt x=\"-1\" y=\"0\"/>",
        ];
        let endings = [
            "",
            "</a:moveTo>",
            "</a:lnTo>",
            "</a:cubicBezTo>",
            "</a:close>",
            "</A:MOVETO>",
            "/>",
        ];
        let regex = re::get_unchecked(DRAWING_COMMAND_PATTERN);
        for name in names {
            for tail in tails {
                for body in bodies {
                    for ending in endings {
                        let xml =
                            format!("<a:path><a:{name}{tail}{body}{ending}<a:close/></a:path>");
                        let expected: Vec<_> =
                            regex.find_iter(&xml).map(|value| value.as_str()).collect();
                        assert_eq!(
                            drawing_path_commands(&xml).collect::<Vec<_>>(),
                            expected,
                            "{xml}"
                        );
                    }
                }
            }
        }
        let pieces = [
            "<",
            ">",
            "/>",
            "a:moveTo",
            "<a:lnTo",
            "</a:lnTo>",
            "<a:close/>",
            "<a:cubicBezTo>",
            "<a:pt x=\"1\" y=\"2\"/>",
            " ",
            "\n",
            "-",
            ":",
        ];
        let mut seed = 0x7bc2_9164_u64;
        for _ in 0..4096 {
            let mut xml = String::new();
            for _ in 0..32 {
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                xml.push_str(pieces[(seed >> 32) as usize % pieces.len()]);
            }
            let expected: Vec<_> = regex.find_iter(&xml).map(|value| value.as_str()).collect();
            assert_eq!(
                drawing_path_commands(&xml).collect::<Vec<_>>(),
                expected,
                "{xml}"
            );
        }
    }

    #[test]
    fn simple_points_preserve_captured_coordinates() {
        let regex = re::get_unchecked(r#"(?i)<a:pt\b[^>]*x="([^"]+)"[^>]*y="([^"]+)"[^>]*/>"#);
        let coordinates = [
            "", "1", "-2", " 1.5 ", "1e5", "NaN", "∞", "a&b", "x>y", "\"", "\" y=\"3",
        ];
        for x in coordinates {
            for y in coordinates {
                let xml = format!("<a:moveTo><a:pt x=\"{x}\" y=\"{y}\"/>");
                if let Some(point) = simple_drawing_point(&xml) {
                    let captures = regex.captures(&xml).unwrap();
                    assert_eq!(
                        point,
                        (
                            captures.get(1).unwrap().as_str(),
                            captures.get(2).unwrap().as_str()
                        )
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod shape_fill_scope_tests {
    use super::*;

    #[test]
    fn fill_exclusions_preserve_sequential_regex_semantics() {
        let fragments = [
            "", "<a:solidFill><a:srgbClr val='123456'/></a:solidFill>",
            "<a:ln/>", "<a:ln><a:solidFill/></a:ln>",
            "<A:LN><a:ln/></A:LN>", "<a:lnTo><a:pt x='1' y='2'/></a:lnTo>",
            "<a:extLst/>", "<a:extLst><a:ln/></a:extLst>",
            "<a:extLſt/>", "<!--<a:ln/>-->", "<![CDATA[<a:extLst/>]]>",
            "<a:ext<a:ln>discard</a:ln>Lst/>",
            "<a:ln-variant>discard</a:ln>", "<a:ln_unchanged/>",
            "<a:ln/><a:solidFill/><a:ln>discard</a:ln>",
            "<a:extLst><a:ln></a:extLst></a:ln>",
        ];
        for left in fragments {
            for right in fragments {
                let input = format!("{left}{right}");
                let mut expected = input.clone();
                for pattern in [r"(?is)<a:ln\b[\s\S]*?</a:ln>", r"(?i)<a:ln\b[^>]*/>", r"(?is)<a:extLst\b[\s\S]*?</a:extLst>", r"(?i)<a:extLst\b[^>]*/>"] {
                    expected = re::get_unchecked(pattern).replace_all(&expected, "").into_owned();
                }
                assert_eq!(drawing_shape_fill_scope(&input), expected);
            }
        }
        assert!(matches!(drawing_shape_fill_scope("<a:lnTo/>"), std::borrow::Cow::Borrowed(_)));
    }
}

fn png_tile_extent(data: &[u8], dpi: u32) -> Option<(f64, f64)> {
    if data.get(..8)? != b"\x89PNG\r\n\x1a\n" || data.get(12..16)? != b"IHDR" {
        return None;
    }
    let read = |offset| {
        Some(u32::from_be_bytes(
            data.get(offset..offset + 4)?.try_into().ok()?,
        ))
    };
    if read(8)? != 13 {
        return None;
    }
    let width = read(16)? as f64;
    let height = read(20)? as f64;
    if width == 0.0 || height == 0.0 {
        return None;
    }
    let mut density = (96.0, 96.0);
    let mut offset = 8_usize;
    while offset < data.len() {
        let length = read(offset)? as usize;
        let end = offset.checked_add(length)?.checked_add(12)?;
        if end > data.len() {
            return None;
        }
        let kind = data.get(offset + 4..offset + 8)?;
        if kind == b"pHYs" && length == 9 && data[offset + 16] == 1 {
            let x = read(offset + 8)?;
            let y = read(offset + 12)?;
            if x > 0 && y > 0 {
                density = (x as f64 * 0.0254, y as f64 * 0.0254);
            }
        }
        if kind == b"IDAT" || kind == b"IEND" {
            break;
        }
        offset = end;
    }
    if dpi != 0 {
        density = (dpi as f64, dpi as f64);
    }
    Some((width * 96.0 / density.0, height * 96.0 / density.1))
}

fn drawing_tile_fill_markup(
    properties: &str,
    transform: &str,
    width: i64,
    height: i64,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
    id: &str,
) -> Option<ShapeFillMarkup> {
    if !properties.contains("a:tile") {
        return None;
    }
    let children = crate::xml::extract_direct_child_tag_ranges(properties);
    let mut fills = children.iter().filter(|child| {
        matches!(
            child.tag_name.as_str(),
            "a:blipFill" | "a:solidFill" | "a:gradFill" | "a:pattFill" | "a:grpFill" | "a:noFill"
        )
    });
    let fill = fills.next()?;
    if fill.tag_name != "a:blipFill"
        || fills.next().is_some()
        || children
            .iter()
            .any(|child| matches!(child.tag_name.as_str(), "a:effectLst" | "a:effectDag"))
    {
        return None;
    }
    let fill = &properties[fill.start..fill.end];
    if get_attribute(fill, "rotWithShape")
        .is_some_and(|value| matches!(value.as_str(), "0" | "false"))
    {
        let opening = transform.get(..crate::xml::tag_token_end(transform, 0)?)?;
        if ["rot", "flipH", "flipV"].iter().any(|name| {
            get_attribute(opening, name).is_some_and(|value| !matches!(value.trim(), "0" | "false"))
        }) {
            return None;
        }
    }
    let fill_children = crate::xml::extract_direct_child_tag_ranges(fill);
    if fill_children
        .iter()
        .any(|child| !matches!(child.tag_name.as_str(), "a:blip" | "a:srcRect" | "a:tile"))
    {
        return None;
    }
    for name in ["a:blip", "a:tile"] {
        if fill_children
            .iter()
            .filter(|child| child.tag_name == name)
            .count()
            != 1
        {
            return None;
        }
    }
    if fill_children
        .iter()
        .filter(|child| child.tag_name == "a:srcRect")
        .count()
        > 1
    {
        return None;
    }
    let blip = crate::xml::direct_child_tag(fill, "a:blip")?;
    let tile = crate::xml::direct_child_tag(fill, "a:tile")?;
    if !crate::xml::extract_direct_child_tag_ranges(blip).is_empty()
        || !crate::xml::extract_direct_child_tag_ranges(tile).is_empty()
        || get_attribute(blip, "r:link").is_some()
    {
        return None;
    }
    let relationship = get_attribute(blip, "r:embed")?;
    let part = context.relationships.get(&relationship)?;
    let data = context.binary_assets.get(part)?;
    if content_type_for_part(part, &context.content_types)?.as_str() != "image/png" {
        return None;
    }
    let dpi = get_attribute(fill, "dpi")
        .map(|value| value.parse::<u32>())
        .transpose()
        .ok()?
        .unwrap_or(0);
    let (natural_width, natural_height) = png_tile_extent(data, dpi)?;
    let percentage = |tag: &str, name: &str, default: f64| -> Option<f64> {
        let Some(value) = get_attribute(tag, name) else {
            return Some(default);
        };
        let value = value.trim();
        let parsed = if let Some(percent) = value.strip_suffix('%') {
            percent.parse::<f64>().ok()? / 100.0
        } else {
            value.parse::<i32>().ok()? as f64 / 100_000.0
        };
        parsed.is_finite().then_some(parsed)
    };
    let source_rect = crate::xml::direct_child_tag(fill, "a:srcRect").unwrap_or("");
    let left = percentage(source_rect, "l", 0.0)?;
    let top = percentage(source_rect, "t", 0.0)?;
    let right = percentage(source_rect, "r", 0.0)?;
    let bottom = percentage(source_rect, "b", 0.0)?;
    let image_width = natural_width * percentage(tile, "sx", 1.0)?;
    let image_height = natural_height * percentage(tile, "sy", 1.0)?;
    let tile_width = image_width * (1.0 - left - right);
    let tile_height = image_height * (1.0 - top - bottom);
    if ![image_width, image_height, tile_width, tile_height]
        .into_iter()
        .all(|value| value.is_finite() && value > 0.0)
    {
        return None;
    }
    let alignment = get_attribute(tile, "algn").unwrap_or_else(|| "tl".into());
    let (horizontal, vertical) = match alignment.as_str() {
        "tl" => (0.0, 0.0),
        "t" => (0.5, 0.0),
        "tr" => (1.0, 0.0),
        "l" => (0.0, 0.5),
        "ctr" => (0.5, 0.5),
        "r" => (1.0, 0.5),
        "bl" => (0.0, 1.0),
        "b" => (0.5, 1.0),
        "br" => (1.0, 1.0),
        _ => return None,
    };
    let offset = |name| -> Option<f64> {
        Some(
            get_attribute(tile, name)
                .map(|value| value.parse::<i64>())
                .transpose()
                .ok()?
                .unwrap_or(0) as f64
                / 9525.0,
        )
    };
    let x = (width as f64 - tile_width) * horizontal + offset("tx")?;
    let y = (height as f64 - tile_height) * vertical + offset("ty")?;
    let flip = get_attribute(tile, "flip").unwrap_or_else(|| "none".into());
    let (flip_x, flip_y) = match flip.as_str() {
        "none" => (false, false),
        "x" => (true, false),
        "y" => (false, true),
        "xy" => (true, true),
        _ => return None,
    };
    let pattern_width = tile_width * if flip_x { 2.0 } else { 1.0 };
    let pattern_height = tile_height * if flip_y { 2.0 } else { 1.0 };
    let mut mirrors = String::new();
    if flip_x {
        mirrors.push_str(&format!(
            r##"<use href="#{id}-tile" transform="translate({} 0) scale(-1 1)"/>"##,
            format_js_number(pattern_width)
        ));
    }
    if flip_y {
        mirrors.push_str(&format!(
            r##"<use href="#{id}-tile" transform="translate(0 {}) scale(1 -1)"/>"##,
            format_js_number(pattern_height)
        ));
    }
    if flip_x && flip_y {
        mirrors.push_str(&format!(
            r##"<use href="#{id}-tile" transform="translate({} {}) scale(-1 -1)"/>"##,
            format_js_number(pattern_width),
            format_js_number(pattern_height)
        ));
    }
    let src = super::util::base64_data_uri("image/png", data);
    Some(ShapeFillMarkup {
        fill_attribute: format!(r#"fill="url(#{id})""#),
        defs: vec![format!(
            r#"<defs><pattern id="{id}" patternUnits="userSpaceOnUse" x="{}" y="{}" width="{}" height="{}"><svg id="{id}-tile" width="{}" height="{}" overflow="hidden"><image href="{src}" x="{}" y="{}" width="{}" height="{}" preserveAspectRatio="none"/></svg>{mirrors}</pattern></defs>"#,
            format_js_number(x),
            format_js_number(y),
            format_js_number(pattern_width),
            format_js_number(pattern_height),
            format_js_number(tile_width),
            format_js_number(tile_height),
            format_js_number(-left * image_width),
            format_js_number(-top * image_height),
            format_js_number(image_width),
            format_js_number(image_height)
        )],
    })
}

fn bitmap_blip_extensions_are_nonvisual(blip: &str) -> bool {
    let children = crate::xml::extract_direct_child_tag_ranges(blip);
    children.iter().all(|child| {
        if child.tag_name != "a:extLst" {
            return false;
        }
        let list = &blip[child.start..child.end];
        crate::xml::extract_direct_child_tag_ranges(list)
            .iter()
            .all(|child| {
                let extension = &list[child.start..child.end];
                if child.tag_name != "a:ext"
                    || get_attribute(extension, "uri").as_deref()
                        != Some("{28A0092B-C50C-407E-A947-70E740481C1C}")
                {
                    return false;
                }
                let values = crate::xml::extract_direct_child_tag_ranges(extension);
                values.len() == 1 && values[0].tag_name == "a14:useLocalDpi" && {
                    let value = &extension[values[0].start..values[0].end];
                    get_attribute(value, "val")
                        .is_some_and(|value| matches!(value.as_str(), "0" | "1" | "false" | "true"))
                        && crate::xml::extract_direct_child_tag_ranges(value).is_empty()
                }
            })
    })
}

fn bitmap_rectangle_is_uncropped(rectangle: &str) -> bool {
    crate::xml::extract_direct_child_tag_ranges(rectangle).is_empty()
        && ["l", "t", "r", "b"].iter().all(|name| {
            get_attribute(rectangle, name).is_none_or(|value| {
                value
                    .trim()
                    .strip_suffix('%')
                    .unwrap_or(value.trim())
                    .parse::<f64>()
                    .ok()
                    == Some(0.0)
            })
        })
}

fn bitmap_rectangle_offsets(rectangle: &str) -> Option<[f64; 4]> {
    if !crate::xml::extract_direct_child_tag_ranges(rectangle).is_empty() {
        return None;
    }
    let mut offsets = [0.0; 4];
    for (index, name) in ["l", "t", "r", "b"].into_iter().enumerate() {
        if let Some(value) = get_attribute(rectangle, name) {
            let value = value.trim();
            offsets[index] = if let Some(percent) = value.strip_suffix('%') {
                percent.parse::<f64>().ok()? / 100.0
            } else {
                value.parse::<i32>().ok()? as f64 / 100000.0
            };
        }
    }
    if offsets.iter().any(|value| !value.is_finite())
        || 1.0 - offsets[0] - offsets[2] <= 0.0
        || 1.0 - offsets[1] - offsets[3] <= 0.0
    {
        return None;
    }
    Some(offsets)
}

fn render_stretched_bitmap_shape_svg(
    properties: &str,
    style: &str,
    width: i64,
    height: i64,
    transform_attribute: &str,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
) -> Option<String> {
    if !properties.contains("a:blipFill") || width <= 0 || height <= 0 {
        return None;
    }
    let explicit_effects = crate::xml::direct_child_tag(properties, "a:effectLst")
        .or_else(|| crate::xml::direct_child_tag(properties, "a:effectDag"));
    if explicit_effects.is_none()
        && crate::xml::direct_child_tag(style, "a:effectRef").is_some_and(|effect| {
            get_attribute(effect, "idx").and_then(|value| value.parse::<u32>().ok()) != Some(0)
        })
    {
        return None;
    }
    let geometry = crate::xml::direct_child_tag(properties, "a:prstGeom")?;
    let preset = get_attribute(geometry, "prst")?;
    if !matches!(preset.as_str(), "rect" | "roundRect" | "ellipse") {
        return None;
    }
    let children = crate::xml::extract_direct_child_tag_ranges(properties);
    if children.iter().any(|child| {
        matches!(
            child.tag_name.as_str(),
            "a:custGeom" | "a:scene3d" | "a:sp3d"
        ) || (matches!(child.tag_name.as_str(), "a:effectLst" | "a:effectDag")
            && !crate::xml::extract_direct_child_tag_ranges(&properties[child.start..child.end])
                .is_empty())
    }) {
        return None;
    }
    let mut fills = children.iter().filter(|child| {
        matches!(
            child.tag_name.as_str(),
            "a:blipFill" | "a:solidFill" | "a:gradFill" | "a:pattFill" | "a:grpFill" | "a:noFill"
        )
    });
    let fill = fills.next()?;
    if fill.tag_name != "a:blipFill" || fills.next().is_some() {
        return None;
    }
    let fill = &properties[fill.start..fill.end];
    match get_attribute(fill, "rotWithShape").as_deref() {
        None | Some("1" | "true") => {}
        Some("0" | "false") => {
            if !transform_attribute.is_empty() {
                return None;
            }
        }
        _ => return None,
    }
    let children = crate::xml::extract_direct_child_tag_ranges(fill);
    if children.iter().any(|child| {
        !matches!(
            child.tag_name.as_str(),
            "a:blip" | "a:srcRect" | "a:stretch"
        )
    }) || ["a:blip", "a:stretch"].iter().any(|name| {
        children
            .iter()
            .filter(|child| child.tag_name == *name)
            .count()
            != 1
    }) || children
        .iter()
        .filter(|child| child.tag_name == "a:srcRect")
        .count()
        > 1
    {
        return None;
    }
    let crop = crate::xml::direct_child_tag(fill, "a:srcRect")
        .map(bitmap_rectangle_offsets).unwrap_or(Some([0.0; 4]))?;
    let blip = crate::xml::direct_child_tag(fill, "a:blip")?;
    if get_attribute(blip, "r:link").is_some() || !bitmap_blip_extensions_are_nonvisual(blip) {
        return None;
    }
    let stretch = crate::xml::direct_child_tag(fill, "a:stretch")?;
    let rectangles = crate::xml::extract_direct_child_tag_ranges(stretch);
    if rectangles.len() != 1
        || rectangles[0].tag_name != "a:fillRect"
    {
        return None;
    }
    let offsets = bitmap_rectangle_offsets(&stretch[rectangles[0].start..rectangles[0].end])?;
    let relationship = get_attribute(blip, "r:embed")?;
    let part = context.relationships.get(&relationship)?;
    let data = context.binary_assets.get(part)?;
    if data.is_empty() {
        return None;
    }
    let mime = content_type_for_part(part, &context.content_types)?;
    if !matches!(
        mime.as_str(),
        "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/bmp"
    ) {
        return None;
    }
    let mut radius = 0.0;
    if preset == "roundRect" {
        let mut adjustment = 16667.0;
        if let Some(adjustments) = crate::xml::direct_child_tag(geometry, "a:avLst") {
            let guides = crate::xml::extract_direct_child_tag_ranges(adjustments);
            if guides.len() > 1 {
                return None;
            }
            if let Some(guide) = guides.first() {
                let guide_xml = &adjustments[guide.start..guide.end];
                if guide.tag_name != "a:gd"
                    || get_attribute(guide_xml, "name").as_deref() != Some("adj")
                {
                    return None;
                }
                let formula = get_attribute(guide_xml, "fmla")?;
                let mut parts = formula.split_ascii_whitespace();
                if parts.next() != Some("val") {
                    return None;
                }
                adjustment = parts.next()?.parse::<f64>().ok()?;
                if !adjustment.is_finite() || parts.next().is_some() {
                    return None;
                }
            }
        }
        radius = width.min(height) as f64 * adjustment.clamp(0.0, 50000.0) / 100000.0;
    }
    let stroke = drawing_shape_stroke_markup(
        &format!("{properties}{style}"),
        &context.styles().theme_colors,
    );
    let attributes = format!(r#"fill="url(#shape-bitmap-fill)" {stroke}{transform_attribute}"#);
    let shape = if preset == "ellipse" {
        let rx = format_js_number(width as f64 / 2.0);
        let ry = format_js_number(height as f64 / 2.0);
        format!(r#"<ellipse cx="{rx}" cy="{ry}" rx="{rx}" ry="{ry}" {attributes}/>"#)
    } else {
        let rounding = if preset == "roundRect" {
            let radius = format_js_number(radius);
            format!(r#" rx="{radius}" ry="{radius}""#)
        } else {
            String::new()
        };
        format!(r#"<rect x="0" y="0" width="{width}" height="{height}"{rounding} {attributes}/>"#)
    };
    let src = super::util::base64_data_uri(&mime, data);
    let image_width = width as f64 * (1.0 - offsets[0] - offsets[2]) / (1.0 - crop[0] - crop[2]);
    let image_height = height as f64 * (1.0 - offsets[1] - offsets[3]) / (1.0 - crop[1] - crop[3]);
    let x = format_js_number(width as f64 * offsets[0] - image_width * crop[0]);
    let y = format_js_number(height as f64 * offsets[1] - image_height * crop[1]);
    let image_width = format_js_number(image_width);
    let image_height = format_js_number(image_height);
    Some(format!(
        r#"<defs><pattern id="shape-bitmap-fill" patternUnits="userSpaceOnUse" width="{width}" height="{height}" overflow="hidden"><image href="{src}" x="{x}" y="{y}" width="{image_width}" height="{image_height}" preserveAspectRatio="none"/></pattern></defs>{shape}"#
    ))
}

#[cfg(test)]
#[path = "shapes/tests.rs"]
mod fidelity_tests;
