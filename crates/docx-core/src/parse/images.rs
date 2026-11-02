use crate::model::{
    ImageCrop, ImageFloating, ImageHorizontalAlign, ImagePaintBounds, ImageRunNode, ImageRunNodeType,
    ImageVerticalAlign, ImageWrapText, ImageWrapType,
};
use crate::parse::colors::normalize_hex_color;
use crate::parse::context::ParseContext;
use crate::parse::re;
use crate::parse::relationships::content_type_for_part;
use crate::parse::shapes::{
    parse_text_box_layout, parse_text_box_paragraphs, render_bounded_text_box_svg,
    render_standalone_word_shape_svg, render_text_box_svg,
};
use crate::parse::util::{
    active_xml as prefer_alternate_content_choice, clamp, clamp_i64, emu_to_pixels,
    escape_xml_text, is_windows_metafile_content_type, rasterize_windows_metafile_to_png_data_uri,
    regex_capture, regex_capture_tag, svg_data_uri, to_image_horizontal_align,
    to_image_vertical_align, windows_metafile_to_svg_data_uri,
};
use crate::xml::{
    decode_xml_entities, extract_balanced_tag_blocks, extract_balanced_tag_blocks_in_order,
    get_attribute, get_attribute_ref,
};

const CHART_COLOR_PALETTE: [&str; 8] = [
    "#2563eb", "#f97316", "#22c55e", "#eab308", "#a855f7", "#06b6d4", "#ef4444", "#14b8a6",
];

const CHART_CONTENT_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";

#[derive(Clone, Debug)]
struct ParsedChartSeries {
    name: String,
    values: Vec<f64>,
    categories: Vec<String>,
    color: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ChartKind {
    Bar,
    Line,
    Pie,
    Doughnut,
}

#[derive(Clone, Debug)]
struct ParsedChartData {
    kind: ChartKind,
    title: Option<String>,
    categories: Vec<String>,
    series: Vec<ParsedChartSeries>,
}

fn css_length_value_and_unit_to_pixels(value: &str, unit: &str) -> Option<f64> {
    let numeric: f64 = value.parse().ok()?;
    if !numeric.is_finite() {
        return None;
    }
    match unit.to_ascii_lowercase().as_str() {
        "px" => Some(numeric.round()),
        "pt" => Some(((numeric * 96.0) / 72.0).round()),
        "in" => Some((numeric * 96.0).round()),
        "cm" => Some(((numeric * 96.0) / 2.54).round()),
        "mm" => Some(((numeric * 96.0) / 25.4).round()),
        _ => None,
    }
}

pub fn css_length_to_pixels(value: Option<&str>) -> Option<f64> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }
    let caps =
        re::get_unchecked(r"(?i)(-?[0-9]+(?:\.[0-9]+)?)\s*(px|pt|in|cm|mm)\b").captures(value)?;
    css_length_value_and_unit_to_pixels(caps.get(1)?.as_str(), caps.get(2)?.as_str())
}

fn parse_css_style_declarations(style_value: &str) -> std::collections::HashMap<String, String> {
    let mut declarations = std::collections::HashMap::new();
    for entry in style_value.split(';') {
        let entry = entry.trim();
        if entry.is_empty() {
            continue;
        }
        let Some(separator_index) = entry.find(':') else {
            continue;
        };
        if separator_index == 0 {
            continue;
        }
        let key = entry[..separator_index].trim().to_ascii_lowercase();
        let value = entry[separator_index + 1..].trim();
        if key.is_empty() || value.is_empty() {
            continue;
        }
        declarations.insert(key, value.to_string());
    }
    declarations
}

fn parse_css_length_pixels(style_token: Option<&str>) -> Option<f64> {
    css_length_to_pixels(style_token)
}

fn parse_wrap_distance_px(value: Option<&str>) -> Option<f64> {
    // Unsigned wrap distances can encode signed negative values.
    if let Some(distance) = value.and_then(|raw| raw.trim().parse::<u32>().ok()) {
        if distance > i32::MAX as u32 {
            return Some(0.0);
        }
    }
    emu_to_pixels(value).map(|resolved| resolved.max(0.0))
}

fn parse_wp_wrap_type(wrap_type_raw: Option<&str>) -> Option<ImageWrapType> {
    match wrap_type_raw?.to_ascii_lowercase().as_str() {
        "wrapnone" => Some(ImageWrapType::WrapNone),
        "wrapsquare" => Some(ImageWrapType::Square),
        "wraptight" => Some(ImageWrapType::Tight),
        "wrapthrough" => Some(ImageWrapType::Through),
        "wraptopandbottom" => Some(ImageWrapType::TopAndBottom),
        _ => None,
    }
}

fn parse_wp_wrap_text(wrap_text_raw: Option<&str>) -> Option<ImageWrapText> {
    match wrap_text_raw?.trim() {
        "bothSides" => Some(ImageWrapText::BothSides),
        "left" => Some(ImageWrapText::Left),
        "right" => Some(ImageWrapText::Right),
        "largest" => Some(ImageWrapText::Largest),
        _ => None,
    }
}

pub fn parse_floating_anchor_from_run_xml(run_xml: &str) -> Option<ImageFloating> {
    let anchor_tag = regex_capture_tag(run_xml, r"(?i)<wp:anchor\b[^>]*>")?;
    let position_h_block = regex_capture(
        run_xml,
        r"(?is)(<wp:positionH\b[^>]*>[\s\S]*?</wp:positionH>)",
    );
    let position_v_block = regex_capture(
        run_xml,
        r"(?is)(<wp:positionV\b[^>]*>[\s\S]*?</wp:positionV>)",
    );
    let position_h_tag = position_h_block
        .as_deref()
        .and_then(|block| regex_capture_tag(block, r"(?i)<wp:positionH\b[^>]*>"));
    let position_v_tag = position_v_block
        .as_deref()
        .and_then(|block| regex_capture_tag(block, r"(?i)<wp:positionV\b[^>]*>"));
    let wrap_tag = regex_capture_tag(
        run_xml,
        r"(?i)<wp:(?:wrapNone|wrapSquare|wrapTight|wrapThrough|wrapTopAndBottom)\b[^>]*/?>",
    );

    let x_offset_raw = position_h_block
        .as_deref()
        .and_then(|block| regex_capture(block, r"(?i)<wp:posOffset>(-?\d+)</wp:posOffset>"));
    let y_offset_raw = position_v_block
        .as_deref()
        .and_then(|block| regex_capture(block, r"(?i)<wp:posOffset>(-?\d+)</wp:posOffset>"));
    let horizontal_align_raw = position_h_block
        .as_deref()
        .and_then(|block| regex_capture(block, r"(?i)<wp:align>([^<]+)</wp:align>"));
    let vertical_align_raw = position_v_block
        .as_deref()
        .and_then(|block| regex_capture(block, r"(?i)<wp:align>([^<]+)</wp:align>"));
    let dist_l_raw = get_attribute(&anchor_tag, "distL");
    let dist_r_raw = get_attribute(&anchor_tag, "distR");
    let dist_t_raw = get_attribute(&anchor_tag, "distT");
    let dist_b_raw = get_attribute(&anchor_tag, "distB");
    let z_index_raw = get_attribute(&anchor_tag, "relativeHeight");

    let x_px = emu_to_pixels(x_offset_raw.as_deref());
    let y_px = emu_to_pixels(y_offset_raw.as_deref());
    let z_index = z_index_raw
        .as_deref()
        .and_then(|raw| raw.parse::<f64>().ok())
        .filter(|value| value.is_finite())
        .map(|value| value.round() as i64);
    let horizontal_relative_to = position_h_tag
        .as_deref()
        .and_then(|tag| get_attribute(tag, "relativeFrom"));
    let vertical_relative_to = position_v_tag
        .as_deref()
        .and_then(|tag| get_attribute(tag, "relativeFrom"));
    let horizontal_align_lower = horizontal_align_raw
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_lowercase);
    let vertical_align_lower = vertical_align_raw
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_lowercase);
    let horizontal_align = to_image_horizontal_align(horizontal_align_lower.as_deref());
    let vertical_align = to_image_vertical_align(vertical_align_lower.as_deref());
    let dist_l_px = parse_wrap_distance_px(dist_l_raw.as_deref());
    let dist_r_px = parse_wrap_distance_px(dist_r_raw.as_deref());
    let dist_t_px = parse_wrap_distance_px(dist_t_raw.as_deref());
    let dist_b_px = parse_wrap_distance_px(dist_b_raw.as_deref());
    let wrap_type_raw = wrap_tag.as_deref().and_then(|tag| {
        regex_capture(
            tag,
            r"(?i)<wp:(wrapNone|wrapSquare|wrapTight|wrapThrough|wrapTopAndBottom)\b",
        )
    });
    let wrap_type = parse_wp_wrap_type(wrap_type_raw.as_deref());
    let wrap_text = wrap_tag
        .as_deref()
        .and_then(|tag| get_attribute(tag, "wrapText"))
        .as_deref()
        .and_then(|raw| parse_wp_wrap_text(Some(raw)));
    let behind_document = get_attribute(&anchor_tag, "behindDoc").as_deref() == Some("1");

    if x_px.is_none()
        && y_px.is_none()
        && horizontal_align.is_none()
        && vertical_align.is_none()
        && horizontal_relative_to.is_none()
        && vertical_relative_to.is_none()
        && dist_l_px.is_none()
        && dist_r_px.is_none()
        && dist_t_px.is_none()
        && dist_b_px.is_none()
        && wrap_type.is_none()
        && wrap_text.is_none()
        && z_index.is_none()
        && !behind_document
    {
        return None;
    }

    Some(ImageFloating {
        x_px,
        y_px,
        horizontal_align,
        vertical_align,
        horizontal_relative_to,
        vertical_relative_to,
        dist_l_px,
        dist_r_px,
        dist_t_px,
        dist_b_px,
        wrap_type,
        wrap_text,
        behind_document: if behind_document { Some(true) } else { None },
        z_index,
    })
}

/// Image effects are resolved into the rendered source, with no CSS approximation.
pub fn parse_drawing_image_css_filter(_run_xml: &str) -> Option<String> {
    None
}

fn drawing_duotone_svg(
    run_xml: &str,
    source: &str,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
) -> Option<String> {
    let effect = extract_balanced_tag_blocks(run_xml, "a:duotone")
        .into_iter()
        .next()?;
    let tags = ["a:srgbClr", "a:schemeClr", "a:sysClr", "a:prstClr"];
    let colors = extract_balanced_tag_blocks_in_order(&effect, &tags);
    if colors.len() != 2 {
        return None;
    }
    let mut endpoints = [[0.0; 3]; 2];
    for (index, range) in colors.iter().enumerate() {
        let resolved = super::colors::resolve_drawing_color_from_xml(
            Some(&effect[range.start..range.end]),
            &context.styles().theme_colors,
        )?;
        for channel in 0..3 {
            endpoints[index][channel] =
                u8::from_str_radix(&resolved.color[1 + channel * 2..3 + channel * 2], 16).ok()?
                    as f64
                    / 255.0;
        }
    }
    let [dark, light] = endpoints;
    Some(svg_data_uri(&format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1" height="1" viewBox="0 0 1 1" preserveAspectRatio="none"><defs><filter id="duotone" x="0" y="0" width="100%" height="100%" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0 0 0 1 0"/><feComponentTransfer><feFuncR type="table" tableValues="{} {}"/><feFuncG type="table" tableValues="{} {}"/><feFuncB type="table" tableValues="{} {}"/></feComponentTransfer></filter></defs><image xlink:href="{}" width="1" height="1" preserveAspectRatio="none" filter="url(#duotone)"/></svg>"#,
        dark[0],
        light[0],
        dark[1],
        light[1],
        dark[2],
        light[2],
        escape_xml_text(source)
    )))
}

pub fn parse_drawing_image_opacity(run_xml: &str) -> Option<f64> {
    let alpha_raw = regex_capture(run_xml, r#"(?i)<a:alphaModFix\b[^>]*amt="(\d+)""#)?;
    let alpha: f64 = alpha_raw.parse().ok()?;
    if !alpha.is_finite() {
        return None;
    }
    Some(clamp(alpha / 100_000.0, 0.0, 1.0))
}

pub fn parse_drawing_image_crop(run_xml: &str) -> Option<ImageCrop> {
    let src_rect_tag = regex_capture_tag(run_xml, r"(?i)<a:srcRect\b[^>]*/>")
        .or_else(|| regex_capture_tag(run_xml, r"(?is)<a:srcRect\b[^>]*>[\s\S]*?</a:srcRect>"))?;

    let parse_crop_fraction = |attribute_name: &str| -> Option<f64> {
        let raw_value = get_attribute(&src_rect_tag, attribute_name)?;
        let value: f64 = raw_value.parse().ok()?;
        if !value.is_finite() {
            return None;
        }
        Some(clamp(value / 100_000.0, 0.0, 1.0))
    };

    let crop = ImageCrop {
        left_fraction: parse_crop_fraction("l"),
        top_fraction: parse_crop_fraction("t"),
        right_fraction: parse_crop_fraction("r"),
        bottom_fraction: parse_crop_fraction("b"),
    };

    let has_crop = [
        crop.left_fraction,
        crop.top_fraction,
        crop.right_fraction,
        crop.bottom_fraction,
    ]
    .into_iter()
    .flatten()
    .any(|value| value.is_finite() && value > 0.0);

    if has_crop {
        Some(crop)
    } else {
        None
    }
}

fn vml_shape_style(run_xml: &str) -> Option<String> {
    let shape_tag = regex_capture_tag(run_xml, r"(?i)<v:shape\b[^>]*>").unwrap_or_default();
    get_attribute(&shape_tag, "style")
}

pub fn parse_vml_size(run_xml: &str) -> (Option<f64>, Option<f64>) {
    let style = vml_shape_style(run_xml).unwrap_or_default();
    parse_vml_size_from_style(&style)
}

fn parse_vml_size_from_style(style: &str) -> (Option<f64>, Option<f64>) {
    if style.is_empty() {
        return (None, None);
    }

    let width_match =
        re::get_unchecked(r"(?i)width:\s*([0-9.]+)\s*(px|pt|in|cm|mm)").captures(style);
    let height_match =
        re::get_unchecked(r"(?i)height:\s*([0-9.]+)\s*(px|pt|in|cm|mm)").captures(style);

    let width_px = width_match.as_ref().and_then(|caps| {
        css_length_value_and_unit_to_pixels(caps.get(1)?.as_str(), caps.get(2)?.as_str())
    });
    let height_px = height_match.as_ref().and_then(|caps| {
        css_length_value_and_unit_to_pixels(caps.get(1)?.as_str(), caps.get(2)?.as_str())
    });

    (width_px, height_px)
}

fn normalize_vml_relative_to(raw: Option<&str>, axis: &str) -> Option<String> {
    let normalized = raw?.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    if matches!(
        normalized.as_str(),
        "page" | "margin" | "column" | "paragraph" | "line"
    ) {
        return Some(normalized);
    }
    if normalized == "text" {
        return Some("paragraph".to_string());
    }
    if normalized == "char" || normalized == "character" {
        let _ = axis;
        return Some("line".to_string());
    }
    None
}

fn normalize_vml_horizontal_align(raw: Option<&str>) -> Option<ImageHorizontalAlign> {
    let normalized = raw?.trim().to_ascii_lowercase();
    to_image_horizontal_align(Some(normalized.as_str()))
}

fn normalize_vml_vertical_align(raw: Option<&str>) -> Option<ImageVerticalAlign> {
    let normalized = raw?.trim().to_ascii_lowercase();
    to_image_vertical_align(Some(normalized.as_str()))
}

fn normalize_vml_wrap_type(raw: Option<&str>) -> Option<ImageWrapType> {
    let normalized = raw?.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "square" => Some(ImageWrapType::Square),
        "tight" => Some(ImageWrapType::Tight),
        "through" => Some(ImageWrapType::Through),
        "topandbottom" | "top-and-bottom" | "topbottom" => Some(ImageWrapType::TopAndBottom),
        "none" | "inline" => Some(ImageWrapType::WrapNone),
        _ => None,
    }
}

fn parse_vml_numeric(raw: Option<&str>) -> Option<i64> {
    let parsed: f64 = raw?.trim().parse().ok()?;
    if !parsed.is_finite() {
        return None;
    }
    Some(parsed.round() as i64)
}

pub fn parse_vml_floating_anchor_from_run_xml(run_xml: &str) -> Option<ImageFloating> {
    let style_value = vml_shape_style(run_xml)?;
    parse_vml_floating_anchor_from_style(run_xml, &style_value)
}

fn parse_vml_floating_anchor_from_style(run_xml: &str, style_value: &str) -> Option<ImageFloating> {
    let declarations = parse_css_style_declarations(style_value);
    if declarations.is_empty() {
        return None;
    }

    let x_px = parse_css_length_pixels(declarations.get("left").map(String::as_str))
        .or_else(|| parse_css_length_pixels(declarations.get("margin-left").map(String::as_str)));
    let y_px = parse_css_length_pixels(declarations.get("top").map(String::as_str))
        .or_else(|| parse_css_length_pixels(declarations.get("margin-top").map(String::as_str)));
    let horizontal_relative_to = normalize_vml_relative_to(
        declarations
            .get("mso-position-horizontal-relative")
            .map(String::as_str),
        "horizontal",
    );
    let vertical_relative_to = normalize_vml_relative_to(
        declarations
            .get("mso-position-vertical-relative")
            .map(String::as_str),
        "vertical",
    );
    let horizontal_position_mode = declarations
        .get("mso-position-horizontal")
        .map(|value| value.trim().to_ascii_lowercase());
    let vertical_position_mode = declarations
        .get("mso-position-vertical")
        .map(|value| value.trim().to_ascii_lowercase());
    let horizontal_align = horizontal_position_mode
        .as_deref()
        .filter(|mode| *mode != "absolute")
        .and_then(|mode| normalize_vml_horizontal_align(Some(mode)));
    let vertical_align = vertical_position_mode
        .as_deref()
        .filter(|mode| *mode != "absolute")
        .and_then(|mode| normalize_vml_vertical_align(Some(mode)));
    let dist_l_px = parse_css_length_pixels(
        declarations
            .get("mso-wrap-distance-left")
            .map(String::as_str),
    );
    let dist_r_px = parse_css_length_pixels(
        declarations
            .get("mso-wrap-distance-right")
            .map(String::as_str),
    );
    let dist_t_px = parse_css_length_pixels(
        declarations
            .get("mso-wrap-distance-top")
            .map(String::as_str),
    );
    let dist_b_px = parse_css_length_pixels(
        declarations
            .get("mso-wrap-distance-bottom")
            .map(String::as_str),
    );
    let wrap_tag = regex_capture_tag(run_xml, r"(?i)<w10:wrap\b[^>]*/?>");
    let wrap_type = wrap_tag
        .as_deref()
        .and_then(|tag| get_attribute(tag, "type"))
        .as_deref()
        .and_then(|raw| normalize_vml_wrap_type(Some(raw)))
        .or_else(|| {
            normalize_vml_wrap_type(declarations.get("mso-wrap-style").map(String::as_str))
        });
    let wrap_text = wrap_tag
        .as_deref()
        .and_then(|tag| get_attribute(tag, "side"))
        .as_deref()
        .and_then(|raw| match raw.trim().to_ascii_lowercase().as_str() {
            "both" | "bothsides" => Some(ImageWrapText::BothSides),
            "left" => Some(ImageWrapText::Left),
            "right" => Some(ImageWrapText::Right),
            "largest" => Some(ImageWrapText::Largest),
            _ => None,
        });
    let z_index = parse_vml_numeric(declarations.get("z-index").map(String::as_str));
    let behind_document = z_index.is_some_and(|index| index < 0);

    if x_px.is_none()
        && y_px.is_none()
        && horizontal_relative_to.is_none()
        && vertical_relative_to.is_none()
        && horizontal_align.is_none()
        && vertical_align.is_none()
        && dist_l_px.is_none()
        && dist_r_px.is_none()
        && dist_t_px.is_none()
        && dist_b_px.is_none()
        && wrap_type.is_none()
        && wrap_text.is_none()
        && z_index.is_none()
    {
        return None;
    }

    Some(ImageFloating {
        x_px,
        y_px,
        horizontal_align,
        vertical_align,
        horizontal_relative_to,
        vertical_relative_to,
        dist_l_px: dist_l_px.map(|value| value.max(0.0)),
        dist_r_px: dist_r_px.map(|value| value.max(0.0)),
        dist_t_px: dist_t_px.map(|value| value.max(0.0)),
        dist_b_px: dist_b_px.map(|value| value.max(0.0)),
        wrap_type,
        wrap_text,
        behind_document: if behind_document { Some(true) } else { None },
        z_index,
    })
}

fn chart_color(raw_color: Option<&str>, index: usize) -> String {
    normalize_hex_color(raw_color)
        .unwrap_or_else(|| CHART_COLOR_PALETTE[index % CHART_COLOR_PALETTE.len()].to_string())
}

fn parse_chart_points(xml: &str) -> Vec<String> {
    let re = re::get_unchecked(r"(?is)<c:pt\b[\s\S]*?<c:v>([\s\S]*?)</c:v>[\s\S]*?</c:pt>");
    let values: Vec<String> = re
        .captures_iter(xml)
        .map(|caps| {
            decode_xml_entities(caps.get(1).map(|m| m.as_str()).unwrap_or(""))
                .trim()
                .to_string()
        })
        .collect();
    if !values.is_empty() {
        return values;
    }

    let fallback_re = re::get_unchecked(r"(?is)<c:v>([\s\S]*?)</c:v>");
    fallback_re
        .captures_iter(xml)
        .map(|caps| {
            decode_xml_entities(caps.get(1).map(|m| m.as_str()).unwrap_or(""))
                .trim()
                .to_string()
        })
        .collect()
}

fn parse_chart_title(chart_xml: &str) -> Option<String> {
    let title_xml = regex_capture_tag(chart_xml, r"(?is)<c:title\b[\s\S]*?</c:title>")?;
    let re = re::get_unchecked(r"(?is)<(?:a:t|c:v)\b[^>]*>([\s\S]*?)</(?:a:t|c:v)>");
    let title = re
        .captures_iter(&title_xml)
        .map(|caps| decode_xml_entities(caps.get(1).map(|m| m.as_str()).unwrap_or("")))
        .collect::<Vec<_>>()
        .join(" ");
    let title = re::get_unchecked(r"\s+")
        .replace_all(title.trim(), " ")
        .to_string();
    if title.is_empty() {
        None
    } else {
        Some(title)
    }
}

fn parse_chart_type(chart_xml: &str) -> Option<ChartKind> {
    if re::get_unchecked(r"(?i)<c:barChart\b").is_match(chart_xml) {
        return Some(ChartKind::Bar);
    }
    if re::get_unchecked(r"(?i)<c:lineChart\b").is_match(chart_xml) {
        return Some(ChartKind::Line);
    }
    if re::get_unchecked(r"(?i)<c:pieChart\b").is_match(chart_xml) {
        return Some(ChartKind::Pie);
    }
    if re::get_unchecked(r"(?i)<c:doughnutChart\b").is_match(chart_xml) {
        return Some(ChartKind::Doughnut);
    }
    None
}

fn parse_chart_number(raw_value: &str) -> f64 {
    let parsed: f64 = raw_value.replace(',', "").trim().parse().unwrap_or(0.0);
    if parsed.is_finite() {
        parsed
    } else {
        0.0
    }
}

fn parse_chart_data(chart_xml: &str) -> Option<ParsedChartData> {
    let kind = parse_chart_type(chart_xml)?;
    let series_blocks = extract_balanced_tag_blocks(chart_xml, "c:ser");
    let mut series = Vec::new();

    for (index, series_xml) in series_blocks.into_iter().enumerate() {
        let tx_block =
            regex_capture_tag(&series_xml, r"(?is)<c:tx\b[\s\S]*?</c:tx>").unwrap_or_default();
        let name = parse_chart_points(&tx_block)
            .into_iter()
            .next()
            .unwrap_or_else(|| format!("Series {}", index + 1));
        let val_block =
            regex_capture_tag(&series_xml, r"(?is)<c:val\b[\s\S]*?</c:val>").unwrap_or_default();
        let values = parse_chart_points(&val_block)
            .into_iter()
            .map(|value| parse_chart_number(&value))
            .collect::<Vec<_>>();
        let cat_block =
            regex_capture_tag(&series_xml, r"(?is)<c:cat\b[\s\S]*?</c:cat>").unwrap_or_default();
        let categories = parse_chart_points(&cat_block);
        let color = chart_color(
            regex_capture(&series_xml, r#"(?i)<a:srgbClr\b[^>]*val="([^"]+)""#).as_deref(),
            index,
        );

        if values.is_empty() {
            continue;
        }

        series.push(ParsedChartSeries {
            name: {
                let trimmed = name.trim();
                if trimmed.is_empty() {
                    format!("Series {}", index + 1)
                } else {
                    trimmed.to_string()
                }
            },
            values,
            categories,
            color,
        });
    }

    if series.is_empty() {
        return None;
    }

    let point_count = series
        .iter()
        .map(|item| item.values.len().max(item.categories.len()))
        .max()
        .unwrap_or(0)
        .max(0);
    let categories_template = series
        .iter()
        .find(|item| !item.categories.is_empty())
        .map(|item| item.categories.as_slice())
        .unwrap_or(&[]);
    let categories = (0..point_count)
        .map(|index| {
            let label = categories_template
                .get(index)
                .map(String::as_str)
                .unwrap_or("");
            let trimmed = label.trim();
            if trimmed.is_empty() {
                format!("Item {}", index + 1)
            } else {
                trimmed.to_string()
            }
        })
        .collect::<Vec<_>>();

    let series = series
        .into_iter()
        .map(|mut item| {
            item.values = (0..point_count)
                .map(|index| {
                    item.values
                        .get(index)
                        .copied()
                        .filter(|value| value.is_finite())
                        .unwrap_or(0.0)
                })
                .collect();
            item
        })
        .collect();

    Some(ParsedChartData {
        kind,
        title: parse_chart_title(chart_xml),
        categories,
        series,
    })
}

fn polar_to_cartesian(cx: f64, cy: f64, radius: f64, angle: f64) -> (f64, f64) {
    let radians = (angle - 90.0) * std::f64::consts::PI / 180.0;
    (cx + radius * radians.cos(), cy + radius * radians.sin())
}

fn render_cartesian_chart_svg(chart: &ParsedChartData, width_px: f64, height_px: f64) -> String {
    let title = chart
        .title
        .as_deref()
        .map(|title| {
            format!(
                r##"<text x="16" y="20" font-size="14" fill="#111827">{}</text>"##,
                escape_xml_text(title)
            )
        })
        .unwrap_or_default();

    let margin_top = if chart.title.is_some() { 34.0 } else { 22.0 };
    let margin = (margin_top, 20.0, 54.0, 54.0);
    let plot_width = (width_px - margin.1 - margin.3).max(40.0);
    let plot_height = (height_px - margin.0 - margin.2).max(40.0);

    let all_values: Vec<f64> = chart
        .series
        .iter()
        .flat_map(|series| series.values.iter().copied())
        .collect();
    let max_value = all_values
        .into_iter()
        .chain(std::iter::once(0.0))
        .fold(1.0_f64, |acc, value| acc.max(value))
        .max(1.0);
    let grid_lines = 4;
    let grid = (0..=grid_lines)
        .map(|step| {
            let value = (max_value * (grid_lines - step) as f64) / grid_lines as f64;
            let y = margin.0 + (plot_height * step as f64) / grid_lines as f64;
            format!(
                r##"<line x1="{:.0}" y1="{:.0}" x2="{:.0}" y2="{:.0}" stroke="#e5e7eb" stroke-width="1"/><text x="{:.0}" y="{:.0}" text-anchor="end" font-size="10" fill="#6b7280">{:.1}</text>"##,
                margin.3,
                y,
                margin.3 + plot_width,
                y,
                margin.3 - 6.0,
                y + 4.0,
                value
            )
        })
        .collect::<Vec<_>>()
        .join("");

    let category_count = chart.categories.len().max(1) as f64;
    let group_width = plot_width / category_count;
    let category_labels = chart
        .categories
        .iter()
        .enumerate()
        .map(|(index, category)| {
            let x = margin.3 + group_width * index as f64 + group_width / 2.0;
            format!(
                r##"<text x="{:.0}" y="{:.0}" text-anchor="middle" font-size="10" fill="#4b5563">{}</text>"##,
                x,
                margin.0 + plot_height + 18.0,
                escape_xml_text(category)
            )
        })
        .collect::<Vec<_>>()
        .join("");

    let series_markup = if chart.kind == ChartKind::Bar {
        let series_count = chart.series.len().max(1) as f64;
        let bar_group_width = group_width * 0.8;
        let bar_width = (bar_group_width / series_count - 2.0).max(2.0);
        chart
            .series
            .iter()
            .enumerate()
            .map(|(series_index, series)| {
                series
                    .values
                    .iter()
                    .enumerate()
                    .map(|(point_index, value)| {
                        let safe_value = value.max(0.0);
                        let bar_height = (safe_value / max_value) * plot_height;
                        let x = margin.3
                            + point_index as f64 * group_width
                            + (group_width - bar_group_width) / 2.0
                            + series_index as f64 * (bar_group_width / series_count);
                        let y = margin.0 + plot_height - bar_height;
                        format!(
                            r#"<rect x="{:.0}" y="{:.0}" width="{:.0}" height="{:.0}" fill="{}" rx="1.5"/>"#,
                            x,
                            y,
                            bar_width,
                            bar_height.max(1.0),
                            series.color
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("")
            })
            .collect::<Vec<_>>()
            .join("")
    } else {
        chart
            .series
            .iter()
            .map(|series| {
                let points: Vec<(f64, f64)> = series
                    .values
                    .iter()
                    .enumerate()
                    .map(|(index, value)| {
                        let safe_value = value.max(0.0);
                        let x = margin.3 + group_width * index as f64 + group_width / 2.0;
                        let y = margin.0 + plot_height - (safe_value / max_value) * plot_height;
                        (x, y)
                    })
                    .filter(|(x, y)| x.is_finite() && y.is_finite())
                    .collect();
                if points.is_empty() {
                    return String::new();
                }
                let path = points
                    .iter()
                    .enumerate()
                    .map(|(index, (x, y))| {
                        if index == 0 {
                            format!("M{x} {y}")
                        } else {
                            format!("L{x} {y}")
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(" ");
                let circles = points
                    .iter()
                    .map(|(x, y)| {
                        format!(
                            r#"<circle cx="{x:.0}" cy="{y:.0}" r="2.5" fill="{}" />"#,
                            series.color
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("");
                format!(
                    r#"<path d="{path}" fill="none" stroke="{}" stroke-width="2" />{circles}"#,
                    series.color
                )
            })
            .collect::<Vec<_>>()
            .join("")
    };

    let legend = chart
        .series
        .iter()
        .enumerate()
        .map(|(index, series)| {
            let x = margin.3 + index as f64 * 120.0;
            let y = 8.0;
            format!(
                r##"<rect x="{x:.0}" y="{y:.0}" width="10" height="10" rx="2" fill="{}"/><text x="{:.0}" y="{:.0}" font-size="10" fill="#374151">{}</text>"##,
                series.color,
                x + 14.0,
                y + 9.0,
                escape_xml_text(&series.name)
            )
        })
        .collect::<Vec<_>>()
        .join("");

    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{width_px:.0}" height="{height_px:.0}" viewBox="0 0 {width_px:.0} {height_px:.0}">
    <rect x="0" y="0" width="{width_px:.0}" height="{height_px:.0}" fill="#ffffff"/>
    {title}
    {grid}
    <line x1="{:.0}" y1="{:.0}" x2="{:.0}" y2="{:.0}" stroke="#9ca3af"/>
    <line x1="{:.0}" y1="{:.0}" x2="{:.0}" y2="{:.0}" stroke="#9ca3af"/>
    {series_markup}
    {category_labels}
    {legend}
  </svg>"##,
        margin.3,
        margin.0 + plot_height,
        margin.3 + plot_width,
        margin.0 + plot_height,
        margin.3,
        margin.0,
        margin.3,
        margin.0 + plot_height,
    )
}

fn render_pie_chart_svg(chart: &ParsedChartData, width_px: f64, height_px: f64) -> String {
    let base_series = chart.series.first();
    let values = base_series
        .map(|series| series.values.as_slice())
        .unwrap_or(&[]);
    let total = values
        .iter()
        .map(|value| value.max(0.0))
        .sum::<f64>()
        .max(0.0001);
    let categories = if !chart.categories.is_empty() {
        chart.categories.clone()
    } else {
        (0..values.len())
            .map(|index| format!("Item {}", index + 1))
            .collect()
    };
    let colors: Vec<String> = if chart.series.len() > 1 {
        chart.series.iter().map(|item| item.color.clone()).collect()
    } else {
        CHART_COLOR_PALETTE
            .iter()
            .map(|color| (*color).to_string())
            .collect()
    };

    let center_x = (width_px * 0.34).round();
    let center_y = (height_px * 0.56).round();
    let outer_radius = ((width_px.min(height_px) * 0.26).round() as i64).clamp(30, 160) as f64;
    let inner_radius = if chart.kind == ChartKind::Doughnut {
        (outer_radius * 0.55).round()
    } else {
        0.0
    };

    let mut start_angle = 0.0;
    let mut slices = Vec::new();
    for (index, value) in values.iter().enumerate() {
        let safe_value = value.max(0.0);
        let angle = (safe_value / total) * 360.0;
        let end_angle = start_angle + angle.max(0.001);
        let large_arc_flag = if end_angle - start_angle > 180.0 {
            1
        } else {
            0
        };
        let fill = &colors[index % colors.len()];

        let (start_outer_x, start_outer_y) =
            polar_to_cartesian(center_x, center_y, outer_radius, start_angle);
        let (end_outer_x, end_outer_y) =
            polar_to_cartesian(center_x, center_y, outer_radius, end_angle);

        let path = if inner_radius > 0.0 {
            let (start_inner_x, start_inner_y) =
                polar_to_cartesian(center_x, center_y, inner_radius, start_angle);
            let (end_inner_x, end_inner_y) =
                polar_to_cartesian(center_x, center_y, inner_radius, end_angle);
            format!(
                "M {start_outer_x} {start_outer_y} A {outer_radius} {outer_radius} 0 {large_arc_flag} 1 {end_outer_x} {end_outer_y} L {end_inner_x} {end_inner_y} A {inner_radius} {inner_radius} 0 {large_arc_flag} 0 {start_inner_x} {start_inner_y} Z"
            )
        } else {
            format!(
                "M {center_x} {center_y} L {start_outer_x} {start_outer_y} A {outer_radius} {outer_radius} 0 {large_arc_flag} 1 {end_outer_x} {end_outer_y} Z"
            )
        };

        slices.push(format!(
            r##"<path d="{path}" fill="{fill}" stroke="#ffffff" stroke-width="1"/>"##
        ));
        start_angle = end_angle;
    }

    let title = chart
        .title
        .as_deref()
        .map(|title| {
            format!(
                r##"<text x="16" y="20" font-size="14" fill="#111827">{}</text>"##,
                escape_xml_text(title)
            )
        })
        .unwrap_or_default();

    let legend = categories
        .iter()
        .enumerate()
        .map(|(index, category)| {
            let x = (width_px * 0.63).round();
            let y = 36.0 + index as f64 * 18.0;
            let color = &colors[index % colors.len()];
            let value = values.get(index).copied().unwrap_or(0.0);
            format!(
                r##"<rect x="{x:.0}" y="{:.0}" width="10" height="10" rx="2" fill="{color}"/><text x="{:.0}" y="{y:.0}" font-size="10" fill="#374151">{} ({value})</text>"##,
                y - 8.0,
                x + 14.0,
                escape_xml_text(category)
            )
        })
        .collect::<Vec<_>>()
        .join("");

    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{width_px:.0}" height="{height_px:.0}" viewBox="0 0 {width_px:.0} {height_px:.0}">
    <rect x="0" y="0" width="{width_px:.0}" height="{height_px:.0}" fill="#ffffff"/>
    {title}
    {}
    {legend}
  </svg>"##,
        slices.join("")
    )
}

fn chart_xml_to_svg_data_uri(
    chart_xml: &str,
    width_px: Option<f64>,
    height_px: Option<f64>,
) -> Option<String> {
    let chart = parse_chart_data(chart_xml)?;
    let safe_width = clamp_i64(width_px.unwrap_or(640.0).round() as i64, 240, 1600) as f64;
    let safe_height = clamp_i64(height_px.unwrap_or(360.0).round() as i64, 180, 1200) as f64;
    let svg = match chart.kind {
        ChartKind::Pie | ChartKind::Doughnut => {
            render_pie_chart_svg(&chart, safe_width, safe_height)
        }
        ChartKind::Bar | ChartKind::Line => {
            render_cartesian_chart_svg(&chart, safe_width, safe_height)
        }
    };
    Some(svg_data_uri(&svg))
}

fn resolve_preferred_drawing_relationship_id(run_xml: &str) -> Option<String> {
    regex_capture(
        run_xml,
        r#"(?is)<a:ext\b[^>]*>[\s\S]*?<asvg:svgBlip\b[^>]*r:embed="([^"]+)""#,
    )
    .or_else(|| {
        regex_capture(
            run_xml,
            r#"(?is)<a:ext\b[^>]*>[\s\S]*?<asvg:svgBlip\b[^>]*r:link="([^"]+)""#,
        )
    })
    .or_else(|| regex_capture(run_xml, r#"(?i)<a:blip\b[^>]*r:embed="([^"]+)""#))
    .or_else(|| regex_capture(run_xml, r#"(?i)<a:blip\b[^>]*r:link="([^"]+)""#))
}

fn resolve_run_image_layout(run_xml: &str) -> (Option<f64>, Option<f64>, Option<ImageFloating>) {
    let extent_cx = regex_capture(run_xml, r#"(?i)<wp:extent\b[^>]*cx="(\d+)""#);
    let extent_cy = regex_capture(run_xml, r#"(?i)<wp:extent\b[^>]*cy="(\d+)""#);
    let vml_style = vml_shape_style(run_xml);
    let vml_size = parse_vml_size_from_style(vml_style.as_deref().unwrap_or_default());
    let drawing_width_px = extent_cx
        .as_deref()
        .and_then(|raw| emu_to_pixels(Some(raw)));
    let drawing_height_px = extent_cy
        .as_deref()
        .and_then(|raw| emu_to_pixels(Some(raw)));
    // A VML textbox can contain DrawingML images. Its outer VML dimensions
    // govern the textbox; a nested wp:extent governs only the inline image.
    let width_px = vml_size.0.or(drawing_width_px);
    let height_px = vml_size.1.or(drawing_height_px);
    let floating = parse_floating_anchor_from_run_xml(run_xml).or_else(|| {
        vml_style
            .as_deref()
            .and_then(|style| parse_vml_floating_anchor_from_style(run_xml, style))
    });
    (width_px, height_px, floating)
}

fn resolve_doc_pr_alt(run_xml: &str) -> Option<String> {
    let doc_pr_tag = regex_capture_tag(run_xml, r"(?i)<wp:docPr\b[^>]*>")?;
    get_attribute(&doc_pr_tag, "descr")
        .or_else(|| get_attribute(&doc_pr_tag, "title"))
        .or_else(|| get_attribute(&doc_pr_tag, "name"))
}

fn vml_finite(value: &str) -> Option<f64> {
    let value: f64 = value.trim().parse().ok()?;
    value.is_finite().then_some(value)
}

pub(crate) fn vml_pixels(value: &str) -> Option<f64> {
    let value = value.trim();
    let Some(split) = value.find(|c: char| c.is_ascii_alphabetic()) else {
        return vml_finite(value);
    };
    let number = vml_finite(&value[..split])?;
    let factor = match value[split..].trim().to_ascii_lowercase().as_str() {
        "px" => 1.0,
        "pt" => 96.0 / 72.0,
        "in" => 96.0,
        "cm" => 96.0 / 2.54,
        "mm" => 96.0 / 25.4,
        _ => return None,
    };
    let pixels = number * factor;
    pixels.is_finite().then_some(pixels)
}

fn vml_pair(value: &str) -> Option<(f64, f64)> {
    let mut parts = value
        .split(|c: char| c == ',' || c.is_ascii_whitespace())
        .filter(|v| !v.is_empty());
    let result = (vml_finite(parts.next()?)?, vml_finite(parts.next()?)?);
    parts.next().is_none().then_some(result)
}

fn vml_svg_path(path: &str) -> Option<String> {
    vml_explicit_svg_path(path).or_else(|| vml_compact_svg_path(path))
}

fn vml_compact_svg_path(path: &str) -> Option<String> {
    use std::fmt::Write;

    let mut result = String::with_capacity(path.len());
    let mut remaining = path.trim();
    let mut current = (0.0, 0.0);
    let mut start = current;
    while !remaining.is_empty() {
        let command = *remaining.as_bytes().first()?;
        if !matches!(command, b'm' | b'l' | b'r' | b'c' | b'x' | b'e')
            || (result.is_empty() && command != b'm')
        {
            return None;
        }
        remaining = &remaining[1..];
        let end = remaining
            .find(|c: char| c.is_ascii_alphabetic())
            .unwrap_or(remaining.len());
        let parameters = remaining[..end].trim();
        let mut numbers = Vec::new();
        if !parameters.is_empty() {
            for field in parameters.split(',') {
                if field.trim().is_empty() {
                    numbers.push(0.0);
                } else {
                    for number in field.split_ascii_whitespace() {
                        numbers.push(vml_finite(number)?);
                    }
                }
            }
        }
        let valid = match command {
            b'm' | b'l' | b'r' => !numbers.is_empty() && numbers.len() % 2 == 0,
            b'c' => !numbers.is_empty() && numbers.len() % 6 == 0,
            _ => numbers.is_empty(),
        };
        if !valid {
            return None;
        }
        remaining = remaining[end..].trim();
        match command {
            b'e' => {
                if !remaining.is_empty() {
                    return None;
                }
            }
            b'x' => {
                result.push('Z');
                current = start;
            }
            b'c' => {
                result.push('C');
                for (index, value) in numbers.iter().enumerate() {
                    if index != 0 {
                        result.push(' ');
                    }
                    write!(result, "{value}").ok()?;
                }
                current = (numbers[numbers.len() - 2], numbers[numbers.len() - 1]);
            }
            _ => {
                for (index, pair) in numbers.chunks_exact(2).enumerate() {
                    let point = if command == b'r' {
                        (current.0 + pair[0], current.1 + pair[1])
                    } else {
                        (pair[0], pair[1])
                    };
                    if !point.0.is_finite() || !point.1.is_finite() {
                        return None;
                    }
                    let output_command = if command == b'm' && index == 0 {
                        start = point;
                        'M'
                    } else {
                        'L'
                    };
                    write!(result, "{output_command}{} {}", point.0, point.1).ok()?;
                    current = point;
                }
            }
        }
    }
    (!result.is_empty()).then_some(result)
}

fn vml_explicit_svg_path(path: &str) -> Option<String> {
    let mut result = String::with_capacity(path.len());
    let mut remaining = path.trim();
    while !remaining.is_empty() {
        let command = *remaining.as_bytes().first()?;
        if !matches!(command, b'm' | b'l' | b'c' | b'x' | b'e') {
            return None;
        }
        if result.is_empty() && command != b'm' {
            return None;
        }
        remaining = &remaining[1..];
        let end = remaining
            .find(|c: char| c.is_ascii_alphabetic())
            .unwrap_or(remaining.len());
        let parameters = remaining[..end].trim();
        if parameters.starts_with(',')
            || parameters.ends_with(',')
            || parameters.split(',').any(|value| value.trim().is_empty()) && !parameters.is_empty()
        {
            return None;
        }
        let numbers = parameters
            .split(|c: char| c == ',' || c.is_ascii_whitespace())
            .filter(|value| !value.is_empty())
            .map(vml_finite)
            .collect::<Option<Vec<_>>>()?;
        let valid = match command {
            b'm' | b'l' => !numbers.is_empty() && numbers.len() % 2 == 0,
            b'c' => !numbers.is_empty() && numbers.len() % 6 == 0,
            _ => numbers.is_empty(),
        };
        if !valid {
            return None;
        }
        remaining = remaining[end..].trim();
        if command == b'e' {
            if !remaining.is_empty() {
                return None;
            }
        } else {
            result.push(if command == b'x' {
                'Z'
            } else {
                (command as char).to_ascii_uppercase()
            });
            result.push_str(parameters);
        }
    }
    (!result.is_empty()).then_some(result)
}

fn vml_path_stays_on_axis(path: &str, axis: usize, origin: f64) -> bool {
    path.split(|c: char| c.is_ascii_alphabetic() || c == ',' || c.is_ascii_whitespace())
        .filter(|value| !value.is_empty())
        .enumerate()
        .all(|(index, value)| index % 2 != axis || vml_finite(value) == Some(origin))
}

fn vml_path_bounds(
    path: &str,
    x: f64,
    y: f64,
    scale_x: f64,
    scale_y: f64,
    origin_x: f64,
    origin_y: f64,
) -> Option<(f64, f64, f64, f64)> {
    let mut values = path
        .split(|c: char| c.is_ascii_alphabetic() || c == ',' || c.is_ascii_whitespace())
        .filter(|value| !value.is_empty());
    let mut bounds = (
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    );
    while let Some(value) = values.next() {
        let px = x + (vml_finite(value)? - origin_x) * scale_x;
        let py = y + (vml_finite(values.next()?)? - origin_y) * scale_y;
        if !px.is_finite() || !py.is_finite() {
            return None;
        }
        bounds.0 = bounds.0.min(px);
        bounds.1 = bounds.1.min(py);
        bounds.2 = bounds.2.max(px);
        bounds.3 = bounds.3.max(py);
    }
    bounds.0.is_finite().then_some(bounds)
}

fn vml_attributes_are_known(xml: &str, names: &[&[u8]]) -> bool {
    let mut reader = quick_xml::Reader::from_str(xml);
    let Ok(quick_xml::events::Event::Start(element) | quick_xml::events::Event::Empty(element)) =
        reader.read_event()
    else {
        return false;
    };
    element.attributes().all(|attribute| {
        attribute.is_ok_and(|attribute| {
            names.contains(&attribute.key.as_ref().as_bytes())
                || attribute.key.as_ref().starts_with("xmlns:")
        })
    })
}

fn vml_bitmap_rectangle_type(xml: &str) -> bool {
    let Some(end) = crate::xml::tag_token_end(xml, 0) else {
        return false;
    };
    let opening = &xml[..end];
    if !vml_attributes_are_known(
        xml,
        &[
            b"id",
            b"coordsize",
            b"o:spt",
            b"o:preferrelative",
            b"path",
            b"filled",
            b"stroked",
        ],
    ) || get_attribute(opening, "id").as_deref() != Some("_x0000_t75")
        || get_attribute(opening, "coordsize").and_then(|value| vml_pair(&value))
            != Some((21600.0, 21600.0))
        || get_attribute(opening, "o:spt").as_deref() != Some("75")
        || get_attribute(opening, "path").as_deref() != Some("m@4@5l@4@11@9@11@9@5xe")
        || !["filled", "stroked"].iter().all(|name| {
            get_attribute(opening, name)
                .is_some_and(|value| matches!(value.as_str(), "f" | "false" | "0"))
        })
        || get_attribute(opening, "o:preferrelative")
            .is_some_and(|value| !matches!(value.as_str(), "t" | "true" | "1"))
    {
        return false;
    }
    let children = crate::xml::extract_direct_child_tag_ranges(xml);
    let mut formulas_seen = false;
    let mut seen = std::collections::HashSet::new();
    for child in children {
        if !seen.insert(child.tag_name.clone()) {
            return false;
        }
        let inner = &xml[child.start..child.end];
        let valid = match child.tag_name.as_str() {
            "v:stroke" => {
                vml_attributes_are_known(inner, &[b"joinstyle"])
                    && get_attribute(inner, "joinstyle").as_deref() == Some("miter")
                    && crate::xml::extract_direct_child_tag_ranges(inner).is_empty()
            }
            "v:path" => {
                vml_attributes_are_known(
                    inner,
                    &[b"o:extrusionok", b"gradientshapeok", b"o:connecttype"],
                ) && crate::xml::extract_direct_child_tag_ranges(inner).is_empty()
            }
            "o:lock" => {
                vml_attributes_are_known(inner, &[b"v:ext", b"aspectratio"])
                    && crate::xml::extract_direct_child_tag_ranges(inner).is_empty()
            }
            "v:formulas" => {
                formulas_seen = true;
                let expected = [
                    "if lineDrawn pixelLineWidth 0",
                    "sum @0 1 0",
                    "sum 0 0 @1",
                    "prod @2 1 2",
                    "prod @3 21600 pixelWidth",
                    "prod @3 21600 pixelHeight",
                    "sum @0 0 1",
                    "prod @6 1 2",
                    "prod @7 21600 pixelWidth",
                    "sum @8 21600 0",
                    "prod @7 21600 pixelHeight",
                    "sum @10 21600 0",
                ];
                let formulas = crate::xml::extract_direct_child_tag_ranges(inner);
                vml_attributes_are_known(inner, &[])
                    && formulas.len() == expected.len()
                    && formulas.iter().zip(expected).all(|(formula, expected)| {
                        let item = &inner[formula.start..formula.end];
                        formula.tag_name == "v:f"
                            && vml_attributes_are_known(item, &[b"eqn"])
                            && get_attribute(item, "eqn").is_some_and(|value| {
                                value
                                    .split_ascii_whitespace()
                                    .eq(expected.split_ascii_whitespace())
                            })
                            && crate::xml::extract_direct_child_tag_ranges(item).is_empty()
                    })
            }
            _ => false,
        };
        if !valid {
            return false;
        }
    }
    formulas_seen
}

fn vml_textbox_rectangle_type(xml: &str) -> bool {
    let Some(end) = crate::xml::tag_token_end(xml, 0) else {
        return false;
    };
    let tag = &xml[..end];
    if !vml_attributes_are_known(tag, &[b"id", b"coordsize", b"o:spt", b"path"])
        || get_attribute(tag, "id").as_deref() != Some("_x0000_t202")
        || get_attribute(tag, "o:spt").as_deref() != Some("202")
        || get_attribute(tag, "coordsize").and_then(|value| vml_pair(&value))
            != Some((21600.0, 21600.0))
        || get_attribute(tag, "path").as_deref() != Some("m,l,21600r21600,l21600,xe")
    {
        return false;
    }
    let mut stroke = false;
    let mut path = false;
    for child in crate::xml::extract_direct_child_tag_ranges(xml) {
        let inner = &xml[child.start..child.end];
        if !crate::xml::extract_direct_child_tag_ranges(inner).is_empty() {
            return false;
        }
        match child.tag_name.as_str() {
            "v:stroke" if !stroke => {
                stroke = true;
                if !vml_attributes_are_known(inner, &[b"joinstyle"])
                    || get_attribute(inner, "joinstyle").as_deref() != Some("miter")
                {
                    return false;
                }
            }
            "v:path" if !path => {
                path = true;
                if !vml_attributes_are_known(inner, &[b"gradientshapeok", b"o:connecttype"])
                    || get_attribute(inner, "gradientshapeok").as_deref() != Some("t")
                    || get_attribute(inner, "o:connecttype").as_deref() != Some("rect")
                {
                    return false;
                }
            }
            _ => return false,
        }
    }
    stroke && path
}

fn vml_editing_lock(xml: &str) -> bool {
    vml_attributes_are_known(xml, &[b"v:ext", b"aspectratio"])
        && get_attribute(xml, "v:ext").as_deref() == Some("edit")
        && get_attribute(xml, "aspectratio")
            .is_none_or(|value| matches!(value.as_str(), "t" | "f" | "true" | "false" | "0" | "1"))
        && crate::xml::extract_direct_child_tag_ranges(xml).is_empty()
}

fn vml_no_wrap(xml: &str) -> bool {
    vml_attributes_are_known(xml, &[b"type"])
        && get_attribute(xml, "type").as_deref() == Some("none")
        && crate::xml::extract_direct_child_tag_ranges(xml).is_empty()
}

fn vml_identity_group(xml: &str) -> Option<()> {
    let tag = &xml[..crate::xml::tag_token_end(xml, 0)?];
    if !vml_attributes_are_known(
        tag,
        &[
            b"id",
            b"o:spid",
            b"alt",
            b"style",
            b"coordorigin",
            b"coordsize",
        ],
    ) || get_attribute(tag, "alt").is_some_and(|value| !value.is_empty())
    {
        return None;
    }
    let declarations = parse_css_style_declarations(&get_attribute(tag, "style")?);
    if declarations.get("position").map(String::as_str) != Some("absolute")
        || declarations.iter().any(|(key, value)| {
            !matches!(
                key.as_str(),
                "position" | "left" | "top" | "width" | "height"
            ) && !(key == "visibility" && value == "visible")
                && !(key == "z-index" && vml_finite(value) == Some(0.0))
        })
    {
        return None;
    }
    let origin = vml_pair(&get_attribute(tag, "coordorigin").unwrap_or_else(|| "0,0".into()))?;
    let size = vml_pair(&get_attribute(tag, "coordsize")?)?;
    let left = declarations
        .get("left")
        .map(|value| vml_finite(value))
        .unwrap_or(Some(0.0))?;
    let top = declarations
        .get("top")
        .map(|value| vml_finite(value))
        .unwrap_or(Some(0.0))?;
    let width = vml_finite(declarations.get("width")?)?;
    let height = vml_finite(declarations.get("height")?)?;
    (origin == (left, top) && size == (width, height) && width > 0.0 && height > 0.0).then_some(())
}

fn vml_group_leaves(xml: &str) -> Option<Vec<crate::xml::TaggedRange>> {
    fn append(
        xml: &str,
        offset: usize,
        depth: usize,
        output: &mut Vec<crate::xml::TaggedRange>,
    ) -> Option<()> {
        if depth > 32 {
            return None;
        }
        for mut child in crate::xml::extract_direct_child_tag_ranges(xml) {
            let inner = &xml[child.start..child.end];
            if child.tag_name == "v:group" {
                vml_identity_group(inner)?;
                append(inner, offset + child.start, depth + 1, output)?;
            } else {
                if depth > 0 {
                    let tag = &inner[..crate::xml::tag_token_end(inner, 0)?];
                    let style = parse_css_style_declarations(
                        &get_attribute(tag, "style").unwrap_or_default(),
                    );
                    if style
                        .get("z-index")
                        .is_some_and(|value| vml_finite(value) != Some(0.0))
                    {
                        return None;
                    }
                }
                child.start += offset;
                child.end += offset;
                output.push(child);
            }
        }
        Some(())
    }
    let mut output = Vec::new();
    append(xml, 0, 0, &mut output)?;
    Some(output)
}

fn vml_canvas_hit_test_shape(xml: &str, origin: (f64, f64), extent: (f64, f64)) -> bool {
    let Some(end) = crate::xml::tag_token_end(xml, 0) else {
        return false;
    };
    let tag = &xml[..end];
    if !vml_attributes_are_known(tag, &[b"id", b"o:spid", b"type", b"style"])
        || get_attribute(tag, "type").as_deref() != Some("#_x0000_t75")
    {
        return false;
    }
    let declarations =
        parse_css_style_declarations(&get_attribute(tag, "style").unwrap_or_default());
    if declarations.get("position").map(String::as_str) != Some("absolute")
        || declarations.iter().any(|(key, value)| {
            !matches!(
                key.as_str(),
                "position" | "left" | "top" | "width" | "height"
            ) && !(key == "visibility" && value == "visible")
        })
    {
        return false;
    }
    for (key, expected) in [
        ("left", origin.0),
        ("top", origin.1),
        ("width", extent.0),
        ("height", extent.1),
    ] {
        let value = declarations
            .get(key)
            .map(|value| vml_finite(value))
            .unwrap_or(Some(0.0));
        if value != Some(expected) {
            return false;
        }
    }
    let mut fill = false;
    let mut path = false;
    for child in crate::xml::extract_direct_child_tag_ranges(xml) {
        let inner = &xml[child.start..child.end];
        if !crate::xml::extract_direct_child_tag_ranges(inner).is_empty() {
            return false;
        }
        match child.tag_name.as_str() {
            "v:fill" if !fill => {
                fill = true;
                if !vml_attributes_are_known(inner, &[b"o:detectmouseclick"])
                    || get_attribute(inner, "o:detectmouseclick").as_deref() != Some("t")
                {
                    return false;
                }
            }
            "v:path" if !path => {
                path = true;
                if !vml_attributes_are_known(inner, &[b"o:connecttype"])
                    || get_attribute(inner, "o:connecttype").as_deref() != Some("none")
                {
                    return false;
                }
            }
            _ => return false,
        }
    }
    fill && path
}

fn vml_declares_unpainted_bitmap(xml: &str) -> bool {
    let mut found = false;
    for definition in extract_balanced_tag_blocks(xml, "v:shapetype") {
        let Some(end) = crate::xml::tag_token_end(&definition, 0) else {
            return false;
        };
        if get_attribute(&definition[..end], "id").as_deref() == Some("_x0000_t75") {
            if !vml_bitmap_rectangle_type(&definition) {
                return false;
            }
            found = true;
        }
    }
    found
}

fn vml_inherits_unpainted_bitmap(
    group: &str,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
) -> bool {
    let mut found = false;
    for part in context
        .parts
        .values()
        .filter(|part| part.content.contains(group))
    {
        if !vml_declares_unpainted_bitmap(&part.content) {
            return false;
        }
        found = true;
    }
    found
}

fn vml_rect_has_default_stroke(xml: &str) -> bool {
    let Some(end) = crate::xml::tag_token_end(xml, 0) else {
        return false;
    };
    let tag = &xml[..end];
    get_attribute(tag, "strokeweight").is_none()
        && !get_attribute(tag, "stroked")
            .is_some_and(|value| matches!(value.as_str(), "f" | "false" | "0"))
}

fn vml_browser_bitmap_src(src: &str, part_name: Option<&str>, content_type: Option<&str>) -> bool {
    if part_name
        .and_then(|value| value.rsplit_once('.'))
        .is_some_and(|(_, suffix)| {
            suffix.eq_ignore_ascii_case("emf") || suffix.eq_ignore_ascii_case("wmf")
        })
        || content_type.is_some_and(|value| {
            [
                "image/x-emf",
                "image/emf",
                "image/x-wmf",
                "image/wmf",
                "application/x-msmetafile",
            ]
            .iter()
            .any(|kind| value.eq_ignore_ascii_case(kind))
        })
    {
        return false;
    }
    [
        "data:image/png;",
        "data:image/jpeg;",
        "data:image/gif;",
        "data:image/bmp;",
        "data:image/webp;",
        "data:image/svg+xml;",
    ]
    .iter()
    .any(|prefix| src.starts_with(prefix))
}

fn vml_named_paint_color(value: &str) -> Option<&'static str> {
    let value = value.trim();
    let color = match value.len() {
        3..=7 => value,
        _ => return None,
    };
    Some(match color {
        name if name.eq_ignore_ascii_case("black") => "#000000",
        name if name.eq_ignore_ascii_case("silver") => "#c0c0c0",
        name if name.eq_ignore_ascii_case("gray") => "#808080",
        name if name.eq_ignore_ascii_case("white") => "#ffffff",
        name if name.eq_ignore_ascii_case("maroon") => "#800000",
        name if name.eq_ignore_ascii_case("red") => "#ff0000",
        name if name.eq_ignore_ascii_case("purple") => "#800080",
        name if name.eq_ignore_ascii_case("fuchsia") => "#ff00ff",
        name if name.eq_ignore_ascii_case("green") => "#008000",
        name if name.eq_ignore_ascii_case("lime") => "#00ff00",
        name if name.eq_ignore_ascii_case("olive") => "#808000",
        name if name.eq_ignore_ascii_case("yellow") => "#ffff00",
        name if name.eq_ignore_ascii_case("navy") => "#000080",
        name if name.eq_ignore_ascii_case("blue") => "#0000ff",
        name if name.eq_ignore_ascii_case("teal") => "#008080",
        name if name.eq_ignore_ascii_case("aqua") => "#00ffff",
        _ => return None,
    })
}

fn vml_paint_color(value: &str) -> Option<String> {
    normalize_hex_color(Some(value))
        .or_else(|| vml_named_paint_color(value).map(str::to_owned))
}

fn vml_has_active_named_paint(tag_name: &str, xml: &str) -> bool {
    if !matches!(tag_name, "v:shape" | "v:rect" | "v:line") {
        return false;
    }
    let Some(end) = crate::xml::tag_token_end(xml, 0) else {
        return false;
    };
    let tag = &xml[..end];
    let is_named = |name| {
        get_attribute_ref(tag, name)
            .is_some_and(|value| vml_named_paint_color(value).is_some())
    };
    if !get_attribute_ref(tag, "filled")
        .is_some_and(|value| matches!(value, "f" | "false" | "0"))
        && is_named("fillcolor")
    {
        return true;
    }
    if !is_named("strokecolor") {
        return false;
    }
    let stroked = get_attribute_ref(tag, "stroked");
    if stroked
        .is_some_and(|value| matches!(value, "f" | "false" | "0"))
    {
        return false;
    }
    let is_bitmap = xml.contains("<v:imagedata") && !xml.contains("<w:txbxContent");
    !(is_bitmap && stroked.is_none())
}



fn vml_group_has_explicit_defaults(tag_name: &str, xml: &str) -> bool {
    if !matches!(tag_name, "v:shape" | "v:rect" | "v:line") {
        return false;
    }
    let Some(end) = crate::xml::tag_token_end(xml, 0) else {
        return false;
    };
    let has_default = |tag: &str| {
        get_attribute_ref(tag, "style").is_some_and(|style| {
            parse_css_style_declarations(style).iter().any(|(key, value)| {
                (key == "mso-wrap-style" && value == "square")
                    || (key == "v-text-anchor" && value == "top")
                    || key == "mso-next-textbox"
            })
        })
    };
    if has_default(&xml[..end]) {
        return true;
    }
    if !xml.contains("<v:textbox") {
        return false;
    }
    crate::xml::extract_direct_child_tag_ranges(xml).iter().any(|child| {
        child.tag_name == "v:textbox" && has_default(&xml[child.start..child.end])
    })
}


fn vml_inline_reference_hints(
    style: &std::collections::HashMap<String, String>,
    has_root_wrap: bool,
    floating: Option<&ImageFloating>,
) -> bool {
    if has_root_wrap
        || style.keys().any(|key| {
            !matches!(
                key.as_str(),
                "width"
                    | "height"
                    | "position"
                    | "mso-position-horizontal-relative"
                    | "mso-position-vertical-relative"
            )
        })
        || style.get("position").is_some_and(|value| {
            !value.eq_ignore_ascii_case("static") && !value.eq_ignore_ascii_case("relative")
        })
    {
        return false;
    }
    let Some(ImageFloating {
        x_px: None,
        y_px: None,
        horizontal_align: None,
        vertical_align: None,
        horizontal_relative_to,
        vertical_relative_to,
        dist_l_px: None,
        dist_r_px: None,
        dist_t_px: None,
        dist_b_px: None,
        wrap_type: None,
        wrap_text: None,
        behind_document: None,
        z_index: None,
    }) = floating
    else {
        return false;
    };
    horizontal_relative_to.is_some() || vertical_relative_to.is_some()
}

fn vml_group_image(
    run_xml: &str,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
) -> Option<ImageRunNode> {
    vml_group_image_with_owner(run_xml, context, None)
}

pub(crate) fn parse_vml_group_image_from_part(
    run_xml: &str,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
    owner_part_name: &str,
) -> Option<ImageRunNode> {
    let part = context.parts.get(owner_part_name)?;
    if part.name != owner_part_name {
        return None;
    }
    vml_group_image_with_owner(run_xml, context, Some(owner_part_name))
}

fn vml_group_image_with_owner(
    run_xml: &str,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
    owner_part_name: Option<&str>,
) -> Option<ImageRunNode> {
    if !run_xml.contains("<v:group") || !run_xml.contains("<v:imagedata") {
        return None;
    }
    let groups = extract_balanced_tag_blocks(run_xml, "v:group");
    if groups.len() != 1 {
        return None;
    }
    let group = &groups[0];
    let has_text_box = group.contains("<w:txbxContent");
    let bitmap_count = group.matches("<v:imagedata").count();
    if bitmap_count == 0
        || run_xml.matches("<v:imagedata").count() != bitmap_count
    {
        return None;
    }
    {
        let _scope = crate::xml_index::scope(std::iter::once(("", run_xml)), Default::default());
        let roots = crate::xml_index::children(run_xml)?;
        if roots
            .iter()
            .any(|child| !matches!(child.tag_name.as_str(), "v:group" | "v:shapetype"))
        {
            return None;
        }
    }
    let opening = &group[..crate::xml::tag_token_end(group, 0)?];
    if [
        "filled",
        "fillcolor",
        "stroked",
        "strokecolor",
        "strokeweight",
        "opacity",
    ]
    .iter()
    .any(|name| get_attribute(opening, name).is_some())
    {
        return None;
    }
    let style_text = get_attribute(opening, "style")?;
    let style = parse_css_style_declarations(&style_text);
    if ["rotation", "flip", "visibility", "display"]
        .iter()
        .any(|key| style.contains_key(*key))
    {
        return None;
    }
    let width = vml_pixels(style.get("width")?)?;
    let height = vml_pixels(style.get("height")?)?;
    if width <= 0.0 || height <= 0.0 {
        return None;
    }
    let (origin_x, origin_y) =
        vml_pair(&get_attribute(opening, "coordorigin").unwrap_or_else(|| "0,0".into()))?;
    let (extent_x, extent_y) =
        vml_pair(&get_attribute(opening, "coordsize").unwrap_or_else(|| "1000,1000".into()))?;
    if extent_x <= 0.0 || extent_y <= 0.0 {
        return None;
    }
    let _index_scope =
        crate::xml_index::scope(std::iter::once(("", group.as_str())), Default::default());
    let original_children = crate::xml_index::children(group)?;
    if !has_text_box && bitmap_count == 1 {
        if style.iter().any(|(key, value)| {
            !matches!(key.as_str(), "width" | "height")
                && !(key == "position" && matches!(value.as_str(), "static" | "relative"))
        }) || original_children.iter().any(|child| {
            !matches!(child.tag_name.as_str(), "v:shape" | "v:shapetype")
        }) {
            return None;
        }
        let mut shapes = original_children.iter().filter(|child| child.tag_name == "v:shape");
        let shape = shapes.next()?;
        if shapes.next().is_some() {
            return None;
        }
        let xml = &group[shape.start..shape.end];
        let tag = &xml[..crate::xml::tag_token_end(xml, 0)?];
        let declarations = parse_css_style_declarations(&get_attribute(tag, "style")?);
        let x = declarations.get("left").map(|value| vml_finite(value)).unwrap_or(Some(0.0))?;
        let y = declarations.get("top").map(|value| vml_finite(value)).unwrap_or(Some(0.0))?;
        let w = vml_finite(declarations.get("width")?)?;
        let h = vml_finite(declarations.get("height")?)?;
        if w <= 0.0 || h <= 0.0
            || (x >= origin_x && y >= origin_y && x + w <= origin_x + extent_x && y + h <= origin_y + extent_y)
        {
            return None;
        }
        let relationship = resolve_preferred_drawing_relationship_id(xml)
            .or_else(|| regex_capture(xml, r#"(?i)<v:imagedata\b[^>]*r:id="([^"]+)""#))
            .or_else(|| regex_capture(xml, r#"(?i)<c:chart\b[^>]*r:id="([^"]+)""#))?;
        let part_name = context.relationships.get(&relationship)?;
        context.binary_assets.get(part_name)?;
    }
    let mut root_wraps = original_children
        .iter()
        .filter(|child| child.tag_name == "w10:wrap");
    let root_wrap = root_wraps
        .next()
        .map(|child| &group[child.start..child.end]);
    let multiple_root_wraps = root_wraps.next().is_some();
    let nested_groups = original_children
        .iter()
        .any(|child| child.tag_name == "v:group");
    let children = if nested_groups {
        vml_group_leaves(group)?
    } else {
        original_children
    };
    let has_placeholder = get_attribute(opening, "editas").as_deref() == Some("canvas")
        && children.iter().any(|child| {
            child.tag_name == "v:shape"
                && vml_canvas_hit_test_shape(
                    &group[child.start..child.end],
                    (origin_x, origin_y),
                    (extent_x, extent_y),
                )
        });
    let skip_placeholder = has_placeholder && vml_inherits_unpainted_bitmap(group, context);
    let mut bitmap_definition = false;
    let mut textbox_definition = false;
    for child in children
        .iter()
        .filter(|child| child.tag_name == "v:shapetype")
    {
        let xml = &group[child.start..child.end];
        if !bitmap_definition && vml_bitmap_rectangle_type(xml) {
            bitmap_definition = true;
        } else if !textbox_definition && vml_textbox_rectangle_type(xml) {
            textbox_definition = true;
        } else {
            return None;
        }
    }
    if bitmap_definition || textbox_definition {
        for child in &children {
            if child.tag_name == "v:shapetype" {
                continue;
            }
            let xml = &group[child.start..child.end];
            let tag = &xml[..crate::xml::tag_token_end(xml, 0)?];
            if !matches!(child.tag_name.as_str(), "v:shape" | "v:rect" | "v:line") {
                if get_attribute(tag, "type").is_some()
                    && (child.tag_name != "w10:wrap" || !vml_no_wrap(xml) || multiple_root_wraps)
                {
                    return None;
                }
                continue;
            }
            if let Some(kind) = get_attribute(tag, "type") {
                let supported = match kind.as_str() {
                    "#_x0000_t75" => {
                        xml.contains("<v:imagedata")
                            || (skip_placeholder
                                && vml_canvas_hit_test_shape(
                                    xml,
                                    (origin_x, origin_y),
                                    (extent_x, extent_y),
                                ))
                    }
                    "#_x0000_t202" => {
                        textbox_definition
                            && xml.contains("<w:txbxContent")
                            && ["filled", "stroked"].iter().all(|name| {
                                get_attribute(tag, name).is_some_and(|value| {
                                    matches!(value.as_str(), "f" | "false" | "0")
                                })
                            })
                    }
                    _ => false,
                };
                if !supported
                    || crate::xml::extract_direct_child_tag_ranges(xml)
                        .iter()
                        .any(|item| item.tag_name == "v:formulas")
                    || ["path", "coordorigin", "coordsize", "adj"]
                        .iter()
                        .any(|name| get_attribute(tag, name).is_some())
                {
                    return None;
                }
            }
        }
    }
    let metadata_type_reference = (bitmap_definition || textbox_definition)
        && children.iter().any(|child| {
            child.tag_name == "w10:wrap" && vml_no_wrap(&group[child.start..child.end])
        });
    let named_paint_present = || {
        children.iter().any(|child| {
            vml_has_active_named_paint(&child.tag_name, &group[child.start..child.end])
        })
    };
    if multiple_root_wraps && named_paint_present() {
        return None;
    }
    let expanded_support = nested_groups
        || metadata_type_reference
        || textbox_definition
        || skip_placeholder
        || children.iter().any(|child| {
            let xml = &group[child.start..child.end];
            child.tag_name == "o:lock"
                || vml_has_active_named_paint(&child.tag_name, xml)
                || vml_group_has_explicit_defaults(&child.tag_name, xml)
                || (child.tag_name == "v:rect" && vml_rect_has_default_stroke(xml))
                || (child.tag_name == "v:shape"
                    && (xml.contains("<o:lock") || xml.contains("<w10:wrap")))
        });
    if expanded_support {
        let mut containing_part = false;
        for part in context
            .parts
            .values()
            .filter(|part| match owner_part_name {
                Some(owner) => part.name == owner,
                None => part.content.contains(group.as_str()),
            })
        {
            containing_part = true;
            for definition in extract_balanced_tag_blocks(&part.content, "v:shapetype") {
                let end = crate::xml::tag_token_end(&definition, 0)?;
                let kind = get_attribute(&definition[..end], "id");
                match kind.as_deref() {
                    Some("_x0000_t75") if !vml_bitmap_rectangle_type(&definition) => return None,
                    Some("_x0000_t202")
                        if has_text_box && !vml_textbox_rectangle_type(&definition) =>
                    {
                        return None
                    }
                    _ => {}
                }
            }
        }
        if !containing_part {
            return None;
        }
    }
    if root_wrap.is_some_and(|wrap| !vml_no_wrap(wrap)) && named_paint_present() {
        let anchor = format!(r#"<v:shape style="{}">"#, escape_xml_text(&style_text));
        let floating = parse_vml_floating_anchor_from_run_xml(&anchor);
        if vml_inline_reference_hints(&style, false, floating.as_ref()) {
            return None;
        }
    }
    let mut elements = Vec::new();
    let mut browser_bitmap_payloads = true;
    let mut canvas = (origin_x, origin_y, origin_x + extent_x, origin_y + extent_y);
    for child in children {
        let xml = &group[child.start..child.end];
        if child.tag_name == "o:lock" && vml_editing_lock(xml) {
            continue;
        }
        if skip_placeholder
            && child.tag_name == "v:shape"
            && vml_canvas_hit_test_shape(xml, (origin_x, origin_y), (extent_x, extent_y))
        {
            continue;
        }
        if matches!(
            child.tag_name.as_str(),
            "w10:wrap" | "w10:anchorlock" | "v:shapetype"
        ) {
            continue;
        }
        if !matches!(child.tag_name.as_str(), "v:shape" | "v:rect" | "v:line") {
            return None;
        }
        let tag = &xml[..crate::xml::tag_token_end(xml, 0)?];
        let declarations =
            parse_css_style_declarations(&get_attribute(tag, "style").unwrap_or_default());
        if declarations.iter().any(|(key, value)| {
            !(matches!(
                key.as_str(),
                "position" | "left" | "top" | "width" | "height" | "z-index"
            ) || (key == "visibility" && value == "visible")
                || (key == "mso-wrap-style" && matches!(value.as_str(), "none" | "square"))
                || (key == "v-text-anchor" && value == "top"))
        }) {
            return None;
        }
        if get_attribute(tag, "opacity").is_some() {
            return None;
        }
        let z = declarations
            .get("z-index")
            .map(|value| vml_finite(value))
            .unwrap_or(Some(0.0))?;
        if child.tag_name != "v:shape" && xml.contains("<v:imagedata") {
            return None;
        }
        let mut dotted = false;
        for item in crate::xml_index::children(xml)? {
            let inner = &xml[item.start..item.end];
            match item.tag_name.as_str() {
                "v:imagedata" => {
                    for attribute in [
                        "croptop",
                        "cropleft",
                        "cropright",
                        "cropbottom",
                        "gain",
                        "blacklevel",
                        "gamma",
                        "chromakey",
                        "grayscale",
                        "bilevel",
                    ] {
                        if get_attribute(inner, attribute).is_some() {
                            return None;
                        }
                    }
                }
                "v:fill" => {
                    if get_attribute(inner, "type")
                        .as_deref()
                        .is_some_and(|value| value != "solid")
                        || ["opacity", "color", "color2", "on"].iter().any(|name| {
                            get_attribute(inner, name).is_some()
                                && (*name != "opacity"
                                    || !get_attribute(tag, "filled").is_some_and(|value| {
                                        matches!(value.as_str(), "f" | "false" | "0")
                                    }))
                        })
                    {
                        return None;
                    }
                }
                "v:formulas" => {}
                "v:path" => {
                    if ["v", "fillok", "strokeok", "shadowok", "limo"]
                        .iter()
                        .any(|name| get_attribute(inner, name).is_some())
                    {
                        return None;
                    }
                }
                "v:stroke" => {
                    if [
                        "on",
                        "weight",
                        "color",
                        "color2",
                        "opacity",
                        "style",
                        "linestyle",
                        "miterlimit",
                        "endcap",
                        "filltype",
                        "src",
                        "imagesize",
                        "imagealignshape",
                        "startarrow",
                        "startarrowwidth",
                        "startarrowlength",
                        "endarrow",
                        "endarrowwidth",
                        "endarrowlength",
                    ]
                    .iter()
                    .any(|name| get_attribute(inner, name).is_some())
                        || get_attribute(inner, "joinstyle").is_some_and(|value| value != "round")
                        || !crate::xml_index::children(inner)?.is_empty()
                    {
                        return None;
                    }
                    match get_attribute(inner, "dashstyle")
                        .as_deref()
                        .unwrap_or("solid")
                    {
                        "solid" => {}
                        "dot" => dotted = true,
                        _ => return None,
                    }
                }
                "o:lock" if vml_editing_lock(inner) => {}
                "w10:wrap" if vml_no_wrap(inner) => {}
                "v:textbox" => {
                    if get_attribute(tag, "type").as_deref() != Some("#_x0000_t202")
                        || get_attribute(tag, "path").is_some()
                        || get_attribute(inner, "style").is_some_and(|style| {
                            parse_css_style_declarations(&style)
                                .iter()
                                .any(|(key, value)| {
                                    match key.as_str() {
                                        "mso-fit-shape-to-text" => !matches!(value.as_str(), "t" | "true"),
                                        "v-text-anchor" => value != "top",
                                        "mso-next-textbox" => !value.strip_prefix('#')
                                            .filter(|target| !target.is_empty())
                                            .is_some_and(|target| get_attribute_ref(tag, "id") == Some(target)),
                                        _ => true,
                                    }
                                })
                        })
                    {
                        return None;
                    }
                }
                _ => return None,
            }
        }
        let fill = if get_attribute(tag, "filled")
            .as_deref()
            .is_some_and(|v| matches!(v, "false" | "f" | "0"))
        {
            "none".to_string()
        } else {
            match get_attribute(tag, "fillcolor") {
                Some(value) => vml_paint_color(&value)?,
                None => "#ffffff".to_string(),
            }
        };
        let is_bitmap = xml.contains("<v:imagedata") && !xml.contains("<w:txbxContent");
        let stroke = if (is_bitmap && get_attribute(tag, "stroked").is_none())
            || get_attribute(tag, "stroked")
                .as_deref()
                .is_some_and(|v| matches!(v, "false" | "f" | "0"))
        {
            "none".to_string()
        } else {
            match get_attribute(tag, "strokecolor") {
                Some(value) => vml_paint_color(&value)?,
                None => "#000000".to_string(),
            }
        };
        let stroke_weight = get_attribute(tag, "strokeweight");
        if stroke != "none" && stroke_weight.is_none() && child.tag_name != "v:rect" {
            return None;
        }
        let stroke_width = stroke_weight
            .map(|value| vml_pixels(&value))
            .unwrap_or(Some(1.0))?;
        if stroke_width < 0.0 {
            return None;
        }
        let dash = if dotted {
            format!(
                r#" stroke-dasharray="{} {}""#,
                stroke_width,
                stroke_width * 2.0
            )
        } else {
            String::new()
        };
        let paint = format!(
            r#"fill="{fill}" fill-rule="evenodd" stroke="{stroke}" stroke-width="{stroke_width}" stroke-linejoin="round" vector-effect="non-scaling-stroke"{dash}"#
        );
        let bounds;
        let element = if child.tag_name == "v:line" {
            let (x1, y1) = vml_pair(&get_attribute(tag, "from")?)?;
            let (x2, y2) = vml_pair(&get_attribute(tag, "to")?)?;
            bounds = (x1.min(x2), y1.min(y2), x1.max(x2), y1.max(y2));
            format!(r#"<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" {paint}/>"#)
        } else {
            let x = declarations
                .get("left")
                .map(|value| vml_finite(value))
                .unwrap_or(Some(0.0))?;
            let y = declarations
                .get("top")
                .map(|value| vml_finite(value))
                .unwrap_or(Some(0.0))?;
            let w = vml_finite(declarations.get("width")?)?;
            let h = vml_finite(declarations.get("height")?)?;
            if w <= 0.0 || h <= 0.0 {
                return None;
            }
            if child.tag_name == "v:rect" {
                bounds = (x, y, x + w, y + h);
                format!(r#"<rect x="{x}" y="{y}" width="{w}" height="{h}" {paint}/>"#)
            } else if xml.contains("<w:txbxContent") {
                if get_attribute(tag, "type").as_deref() != Some("#_x0000_t202")
                    || xml.matches("<v:textbox").count() != 1
                {
                    return None;
                }
                let paragraphs = parse_text_box_paragraphs(xml, context);
                let physical_width = w * width / extent_x;
                let physical_height = h * height / extent_y;
                if !physical_width.is_finite() || !physical_height.is_finite() {
                    return None;
                }
                let mut layout = parse_text_box_layout(xml);
                if let Some(layout) = layout.as_mut() {
                    if let Some(inset) = regex_capture_tag(xml, r"(?i)<v:textbox\b[^>]*>")
                        .and_then(|tag| get_attribute(&tag, "inset"))
                    {
                        for (padding, value) in [
                            &mut layout.padding_left_px,
                            &mut layout.padding_top_px,
                            &mut layout.padding_right_px,
                            &mut layout.padding_bottom_px,
                        ]
                        .into_iter()
                        .zip(inset.split(','))
                        {
                            if vml_finite(value) == Some(0.0) {
                                *padding = Some(0.0);
                            }
                        }
                    }
                }
                let text = render_bounded_text_box_svg(
                    &paragraphs,
                    physical_width,
                    physical_height,
                    layout.as_ref(),
                );
                let text_width = physical_width.round().clamp(1.0, 2400.0);
                let text_height = physical_height.round().clamp(1.0, 2400.0);
                bounds = (x, y, x + w, y + h);
                format!(
                    r#"<rect x="{x}" y="{y}" width="{w}" height="{h}" {paint}/><svg x="{x}" y="{y}" width="{w}" height="{h}" viewBox="0 0 {text_width} {text_height}" preserveAspectRatio="none" overflow="hidden">{text}</svg>"#
                )
            } else if is_bitmap {
                if xml.matches("<v:imagedata").count() != 1
                    || get_attribute(tag, "path").is_some()
                    || get_attribute(tag, "type").as_deref() != Some("#_x0000_t75")
                    || stroke != "none"
                    || get_attribute(tag, "fillcolor").is_some()
                {
                    return None;
                }
                let image = parse_run_image_block(xml, context)?;
                let image_src = image.src.as_deref()?;
                browser_bitmap_payloads &= vml_browser_bitmap_src(
                    image_src,
                    image.part_name.as_deref(),
                    image.content_type.as_deref(),
                );
                if expanded_support && !browser_bitmap_payloads {
                    return None;
                }
                let src = escape_xml_text(image_src);
                bounds = (x, y, x + w, y + h);
                format!(
                    r#"<image href="{src}" x="{x}" y="{y}" width="{w}" height="{h}" preserveAspectRatio="none"/>"#
                )
            } else {
                let path = vml_svg_path(&get_attribute(tag, "path")?)?;
                let (cx, cy) =
                    vml_pair(&get_attribute(tag, "coordorigin").unwrap_or_else(|| "0,0".into()))?;
                let (cw, ch) = vml_pair(&get_attribute(tag, "coordsize")?)?;
                if cw < 0.0 || ch < 0.0 || (cw == 0.0 && ch == 0.0) {
                    return None;
                }
                if (cw == 0.0 && (fill != "none" || !vml_path_stays_on_axis(&path, 0, cx)))
                    || (ch == 0.0 && (fill != "none" || !vml_path_stays_on_axis(&path, 1, cy)))
                {
                    return None;
                }
                let scale_x = if cw == 0.0 { 1.0 } else { w / cw };
                let scale_y = if ch == 0.0 { 1.0 } else { h / ch };
                if !scale_x.is_finite() || !scale_y.is_finite() {
                    return None;
                }
                bounds = vml_path_bounds(&path, x, y, scale_x, scale_y, cx, cy)?;
                format!(
                    r#"<path d="{path}" transform="translate({x} {y}) scale({scale_x} {scale_y}) translate({} {})" {paint}/>"#,
                    -cx, -cy
                )
            }
        };
        let stroke_radius = if stroke == "none" {
            0.0
        } else {
            stroke_width * 0.5
        };
        let padding_x = stroke_radius * extent_x / width;
        let padding_y = stroke_radius * extent_y / height;
        canvas.0 = canvas.0.min(bounds.0 - padding_x);
        canvas.1 = canvas.1.min(bounds.1 - padding_y);
        canvas.2 = canvas.2.max(bounds.2 + padding_x);
        canvas.3 = canvas.3.max(bounds.3 + padding_y);
        elements.push((z, element));
    }
    elements.sort_by(|left, right| left.0.total_cmp(&right.0));
    let body = elements
        .into_iter()
        .map(|(_, element)| element)
        .collect::<String>();
    let canvas_width = canvas.2 - canvas.0;
    let canvas_height = canvas.3 - canvas.1;
    let mut width_px = if canvas_width == extent_x {
        width
    } else {
        canvas_width * width / extent_x
    };
    let mut height_px = if canvas_height == extent_y {
        height
    } else {
        canvas_height * height / extent_y
    };
    if !width_px.is_finite() || !height_px.is_finite() {
        return None;
    }
    let anchor = format!(r#"<v:shape style="{}">"#, escape_xml_text(&style_text));
    let mut floating = parse_vml_floating_anchor_from_run_xml(&anchor);
    if let Some(anchor) = floating.as_mut() {
        if anchor.horizontal_align.is_none() {
            if let Some(value) = style.get("margin-left") {
                anchor.x_px = Some(vml_pixels(value)?);
            }
        }
        if anchor.vertical_align.is_none() {
            if let Some(value) = style.get("margin-top") {
                anchor.y_px = Some(vml_pixels(value)?);
            }
        }
    }
    if expanded_support && vml_inline_reference_hints(&style, false, floating.as_ref()) {
        if let Some(wrap) = root_wrap {
            if !multiple_root_wraps && vml_no_wrap(wrap) {
                let anchor = floating.as_mut()?;
                anchor.horizontal_relative_to = None;
                anchor.vertical_relative_to = None;
                anchor.wrap_type = Some(ImageWrapType::WrapNone);
            }
        } else {
            floating = None;
        }
    }
    if !multiple_root_wraps {
        if let Some(wrap) = root_wrap {
            if let Some(declared) = parse_vml_floating_anchor_from_style(wrap, &style_text) {
                if declared.wrap_type.is_some() || declared.wrap_text.is_some() {
                    let anchor = floating.get_or_insert_with(|| declared.clone());
                    anchor.wrap_type = declared.wrap_type;
                    anchor.wrap_text = declared.wrap_text;
                }
            }
        }
    }
    let paint_bounds = if canvas != (origin_x, origin_y, origin_x + extent_x, origin_y + extent_y) {
        let x_px = (canvas.0 - origin_x) * width / extent_x;
        let y_px = (canvas.1 - origin_y) * height / extent_y;
        if !x_px.is_finite() || !y_px.is_finite() || width_px <= 0.0 || height_px <= 0.0 {
            return None;
        }
        if let Some(anchor) = floating.as_mut() {
            if anchor.horizontal_align.is_some() || anchor.vertical_align.is_some() {
                return None;
            }
            *anchor.x_px.as_mut()? += x_px;
            *anchor.y_px.as_mut()? += y_px;
            None
        } else {
            let x_px = if width == extent_x { canvas.0 - origin_x } else { x_px };
            let y_px = if height == extent_y { canvas.1 - origin_y } else { y_px };
            if width == extent_x {
                width_px = canvas_width;
            }
            if height == extent_y {
                height_px = canvas_height;
            }
            Some(Box::new(ImagePaintBounds {
                x_px,
                y_px,
                width_px,
                height_px,
                layout_width_px: width,
                layout_height_px: height,
            }))
        }
    } else {
        None
    };
    if !has_text_box && bitmap_count == 1 && paint_bounds.is_none() {
        return None;
    }
    if paint_bounds.is_some() && !browser_bitmap_payloads {
        return None;
    }
    let svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width_px}" height="{height_px}" viewBox="{} {} {canvas_width} {canvas_height}" preserveAspectRatio="none">{body}</svg>"#,
        canvas.0, canvas.1
    );
    Some(ImageRunNode {
        width_px: Some(if paint_bounds.is_some() { width } else { width_px }),
        height_px: Some(if paint_bounds.is_some() { height } else { height_px }),
        paint_bounds,
        r#type: ImageRunNodeType::Image,
        block_id: None,
        content_nodes: None,
        semantic_kind: None,
        math_ml: None,
        src: Some(svg_data_uri(&svg)),
        alt: has_text_box.then(|| resolve_doc_pr_alt(run_xml).unwrap_or_else(|| "Text box".into())),
        part_name: None,
        content_type: Some("image/svg+xml".to_string()),
        data: None,
        source_xml: Some(run_xml.to_string()),
        crop: None,
        css_filter: None,
        css_opacity: None,
        floating,
        synthetic_text_box: has_text_box.then_some(true),
        text_box_text: None,
    })
}

pub fn parse_run_image_block(
    run_xml: &str,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
) -> Option<ImageRunNode> {
    let normalized_run_xml = prefer_alternate_content_choice(run_xml);
    let mut active_run_xml = normalized_run_xml.as_ref();
    let _drawing_index = if active_run_xml.len() > 8192
        && crate::xml_index::tag(active_run_xml, "w:drawing").is_none()
    {
        Some(crate::xml_index::scope(
            std::iter::once(("", active_run_xml)),
            Default::default(),
        ))
    } else {
        None
    };
    if let Some(image) = vml_group_image(active_run_xml, context) {
        return Some(image);
    }
    let (mut width_px, mut height_px, mut floating) = resolve_run_image_layout(active_run_xml);
    let mut alt = resolve_doc_pr_alt(active_run_xml);
    let mut chart_relationship_id =
        regex_capture(active_run_xml, r#"(?i)<c:chart\b[^>]*r:id="([^"]+)""#);
    let mut relationship_id = resolve_preferred_drawing_relationship_id(active_run_xml)
        .or_else(|| regex_capture(active_run_xml, r#"(?i)<v:imagedata\b[^>]*r:id="([^"]+)""#))
        .or_else(|| chart_relationship_id.clone());

    if relationship_id.is_none() && normalized_run_xml != run_xml {
        active_run_xml = run_xml;
        chart_relationship_id =
            regex_capture(active_run_xml, r#"(?i)<c:chart\b[^>]*r:id="([^"]+)""#);
        relationship_id = resolve_preferred_drawing_relationship_id(active_run_xml)
            .or_else(|| regex_capture(active_run_xml, r#"(?i)<v:imagedata\b[^>]*r:id="([^"]+)""#))
            .or_else(|| chart_relationship_id.clone());
        (width_px, height_px, floating) = resolve_run_image_layout(active_run_xml);
        alt = resolve_doc_pr_alt(active_run_xml);
    }

    let part_name = relationship_id
        .as_deref()
        .and_then(|id| context.relationships.get(id).cloned());
    if relationship_id.is_some() && part_name.is_none() {
        context.push_warning(format!(
            "Missing relationship target for {}",
            relationship_id.as_deref().unwrap_or_default()
        ));
    }

    let content_type = part_name
        .as_deref()
        .and_then(|name| content_type_for_part(name, &context.content_types));
    let binary = part_name
        .as_deref()
        .and_then(|name| context.binary_assets.get(name).map(Vec::as_slice));
    let crop = parse_drawing_image_crop(active_run_xml);
    let css_filter = parse_drawing_image_css_filter(active_run_xml);
    let css_opacity = parse_drawing_image_opacity(active_run_xml);

    let likely_chart_part = chart_relationship_id.is_some()
        || part_name
            .as_deref()
            .is_some_and(|name| name.contains("/charts/"))
        || content_type.as_deref() == Some(CHART_CONTENT_TYPE);

    let standalone_shape_svg =
        render_standalone_word_shape_svg(active_run_xml, width_px, height_px, context);
    let contains_grouped_or_standalone_shape =
        re::get_unchecked(r"(?i)<wpg:wgp\b|<wps:wsp\b").is_match(active_run_xml);
    let contains_text_box_content =
        re::get_unchecked(r"(?i)<w:txbxContent\b").is_match(active_run_xml);

    // A grouped drawing renders through the group pipeline so sibling pictures and
    // vector layers survive alongside the textbox content; only a bare textbox shape
    // (where the group renderer yields nothing) falls back to the flat textbox SVG.
    if contains_text_box_content && standalone_shape_svg.is_none() {
        let text_box_paragraphs = parse_text_box_paragraphs(active_run_xml, context);
        if !text_box_paragraphs.is_empty() {
            let text_box_src = svg_data_uri(&render_text_box_svg(
                &text_box_paragraphs,
                width_px,
                height_px,
                parse_text_box_layout(active_run_xml).as_ref(),
            ));
            return Some(ImageRunNode {
                paint_bounds: None,
                r#type: ImageRunNodeType::Image,
                block_id: None,
                content_nodes: None,
                semantic_kind: None,
                math_ml: None,
                src: Some(text_box_src),
                alt: Some(alt.unwrap_or_else(|| "Text box".to_string())),
                width_px,
                height_px,
                part_name: None,
                content_type: Some("image/svg+xml".to_string()),
                data: None,
                source_xml: Some(active_run_xml.to_string()),
                crop,
                css_filter,
                css_opacity,
                floating,
                synthetic_text_box: Some(true),
                text_box_text: None,
            });
        }
    }

    if standalone_shape_svg.is_some()
        && (contains_grouped_or_standalone_shape || relationship_id.is_none())
    {
        let svg = standalone_shape_svg.as_deref().unwrap_or_default();
        if !re::get_unchecked(r"(?i)<wpg:wgp\b").is_match(active_run_xml) {
            let transform = extract_balanced_tag_blocks(active_run_xml, "a:xfrm")
                .into_iter()
                .next()
                .unwrap_or_default();
            let angle = get_attribute(&transform, "rot")
                .and_then(|v| v.parse::<f64>().ok())
                .filter(|v| v.is_finite())
                .unwrap_or(0.0)
                / 60000.0;
            let svg_tag = regex_capture_tag(svg, r"<svg\b[^>]*>").unwrap_or_default();
            let source_width =
                width_px.or_else(|| get_attribute(&svg_tag, "width").and_then(|v| v.parse().ok()));
            let source_height = height_px
                .or_else(|| get_attribute(&svg_tag, "height").and_then(|v| v.parse().ok()));
            if let (Some(old_width), Some(old_height)) = (source_width, source_height) {
                let (sin, cos) = angle.to_radians().sin_cos();
                let width = (old_width * cos.abs() + old_height * sin.abs()).max(1.0);
                let height = (old_width * sin.abs() + old_height * cos.abs()).max(1.0);
                if let Some(anchor) = floating.as_mut() {
                    if let Some(x) = anchor.x_px.as_mut() {
                        *x += (old_width - width) / 2.0;
                    }
                    if let Some(y) = anchor.y_px.as_mut() {
                        *y += (old_height - height) / 2.0;
                    }
                }
                width_px = Some(width);
                height_px = Some(height);
            }
        }
        return Some(ImageRunNode {
            paint_bounds: None,
            r#type: ImageRunNodeType::Image,
            block_id: None,
            content_nodes: None,
            semantic_kind: None,
            math_ml: None,
            src: Some(svg_data_uri(
                standalone_shape_svg.as_deref().unwrap_or_default(),
            )),
            alt: Some(alt.unwrap_or_else(|| {
                if contains_text_box_content {
                    "Text box".to_string()
                } else {
                    "Shape".to_string()
                }
            })),
            width_px,
            height_px,
            part_name: None,
            content_type: Some("image/svg+xml".to_string()),
            data: None,
            source_xml: Some(active_run_xml.to_string()),
            crop,
            css_filter,
            css_opacity,
            floating,
            synthetic_text_box: if contains_text_box_content {
                Some(true)
            } else {
                None
            },
            text_box_text: None,
        });
    }

    if likely_chart_part {
        let chart_xml = part_name
            .as_deref()
            .and_then(|name| context.parts.get(name))
            .map(|part| part.content.as_str());
        if chart_xml.is_none() {
            if let Some(name) = part_name.as_deref() {
                context.push_warning(format!("Missing chart part {name}"));
            }
        }

        if let Some(chart_src) =
            chart_xml.and_then(|xml| chart_xml_to_svg_data_uri(xml, width_px, height_px))
        {
            return Some(ImageRunNode {
                paint_bounds: None,
                r#type: ImageRunNodeType::Image,
                block_id: None,
                content_nodes: None,
                semantic_kind: None,
                math_ml: None,
                src: Some(chart_src),
                alt: Some(alt.unwrap_or_else(|| "Chart".to_string())),
                width_px,
                height_px,
                part_name: None,
                content_type: Some("image/svg+xml".to_string()),
                data: None,
                source_xml: Some(active_run_xml.to_string()),
                crop,
                css_filter,
                css_opacity,
                floating,
                synthetic_text_box: None,
                text_box_text: None,
            });
        }
    }

    if relationship_id.is_none() {
        let text_box_paragraphs = parse_text_box_paragraphs(active_run_xml, context);
        if text_box_paragraphs.is_empty() {
            return None;
        }

        let text_box_src = svg_data_uri(&render_text_box_svg(
            &text_box_paragraphs,
            width_px,
            height_px,
            parse_text_box_layout(active_run_xml).as_ref(),
        ));
        return Some(ImageRunNode {
            paint_bounds: None,
            r#type: ImageRunNodeType::Image,
            block_id: None,
            content_nodes: None,
            semantic_kind: None,
            math_ml: None,
            src: Some(text_box_src),
            alt: Some(alt.unwrap_or_else(|| "Text box".to_string())),
            width_px,
            height_px,
            part_name: None,
            content_type: Some("image/svg+xml".to_string()),
            data: None,
            source_xml: Some(active_run_xml.to_string()),
            crop,
            css_filter,
            css_opacity,
            floating,
            synthetic_text_box: Some(true),
            text_box_text: None,
        });
    }

    let mut src: Option<String> = None;
    let mut resolved_content_type = content_type.clone();
    let mut resolved_css_opacity = css_opacity;
    if let Some(binary) = binary {
        let mime_type = part_name
            .as_deref()
            .and_then(|name| content_type_for_part(name, &context.content_types))
            .or(content_type.clone())
            .unwrap_or_else(|| "application/octet-stream".to_string());
        if is_windows_metafile_content_type(Some(&mime_type), part_name.as_deref()) {
            src = windows_metafile_to_svg_data_uri(binary);
            if src.is_some() {
                resolved_content_type = Some("image/svg+xml".to_string());
                resolved_css_opacity = None;
            } else {
                src = rasterize_windows_metafile_to_png_data_uri(binary, part_name.as_deref());
                if src.is_some() {
                    resolved_content_type = Some("image/png".to_string());
                    resolved_css_opacity = None;
                }
            }
        }

        if src.is_none() {
            src = Some(super::util::base64_data_uri(&mime_type, binary));
            resolved_content_type = Some(mime_type);
        }
    }

    if let Some(source) = src.as_deref() {
        if let Some(duotone) = drawing_duotone_svg(active_run_xml, source, context) {
            src = Some(duotone);
        }
    }

    Some(ImageRunNode {
        paint_bounds: None,
        r#type: ImageRunNodeType::Image,
        block_id: None,
        content_nodes: None,
        semantic_kind: None,
        math_ml: None,
        src,
        alt,
        width_px,
        height_px,
        part_name,
        content_type: resolved_content_type,
        data: binary.map(|bytes| bytes.to_vec()),
        source_xml: Some(active_run_xml.to_string()),
        crop,
        css_filter,
        css_opacity: resolved_css_opacity,
        floating,
        synthetic_text_box: None,
        text_box_text: None,
    })
}

pub fn parse_run_images(
    run_xml: &str,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
) -> Vec<ImageRunNode> {
    parse_run_image_tokens(run_xml, context)
        .into_iter()
        .map(|(_, image)| image)
        .collect()
}

pub fn parse_run_image_tokens(
    run_xml: &str,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
) -> Vec<(usize, ImageRunNode)> {
    if !memchr::memchr_iter(b'<', run_xml.as_bytes()).any(|position| {
        let tag = &run_xml[position + 1..];
        ["a:", "wp:", "v:", "c:", "wps:", "wpg:", "w:txbxContent"]
            .iter()
            .any(|prefix| super::scan::starts_with_ignore_ascii_case(tag, prefix))
    }) {
        return Vec::new();
    }
    let active_run_xml = prefer_alternate_content_choice(run_xml);
    let run_xml = active_run_xml.as_ref();
    let candidate_ranges = extract_balanced_tag_blocks_in_order(
        run_xml,
        &["mc:AlternateContent", "w:drawing", "w:pict", "w:object"],
    );
    let candidate_xml_blocks: Vec<(usize, &str)> = if candidate_ranges.is_empty() {
        vec![(0, run_xml)]
    } else {
        candidate_ranges
            .iter()
            .map(|range| (range.start, &run_xml[range.start..range.end]))
            .collect()
    };

    let mut images = Vec::new();
    for (source_start, candidate_xml) in candidate_xml_blocks {
        let Some(image) = parse_run_image_block(candidate_xml, context) else {
            continue;
        };
        images.push((source_start, image));
    }

    images
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rectangular_bitmap_type() -> &'static str {
        r#"<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/><v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/><v:f eqn="sum 0 0 @1"/><v:f eqn="prod @2 1 2"/><v:f eqn="prod @3 21600 pixelWidth"/><v:f eqn="prod @3 21600 pixelHeight"/><v:f eqn="sum @0 0 1"/><v:f eqn="prod @6 1 2"/><v:f eqn="prod @7 21600 pixelWidth"/><v:f eqn="sum @8 21600 0"/><v:f eqn="prod @7 21600 pixelHeight"/><v:f eqn="sum @10 21600 0"/></v:formulas></v:shapetype>"#
    }

    #[test]
    fn bitmap_type_declarations_reject_geometry_and_paint_overrides() {
        let xml = rectangular_bitmap_type();
        assert!(vml_bitmap_rectangle_type(xml));
        for changed in [
            xml.replace("filled=\"f\"", "filled=\"t\""),
            xml.replace("stroked=\"f\"", "stroked=\"t\""),
            xml.replace("21600 pixelWidth", "10800 pixelWidth"),
            xml.replace("<v:shapetype ", "<v:shapetype opacity=\"0.5\" "),
            xml.replace("</v:shapetype>", "<v:fill color=\"red\"/></v:shapetype>"),
        ] {
            assert!(!vml_bitmap_rectangle_type(&changed));
        }
    }

    #[test]
    fn rectangular_textbox_declarations_reject_inherited_effects() {
        let xml = r#"<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>"#;
        assert!(vml_textbox_rectangle_type(xml));
        for changed in [
            xml.replace("<v:shapetype ", "<v:shapetype fillcolor=\"red\" "),
            xml.replace("21600r21600", "21600r10800"),
            xml.replace("joinstyle=\"miter\"", "joinstyle=\"round\""),
            xml.replace("</v:shapetype>", "<v:shadow on=\"t\"/></v:shapetype>"),
        ] {
            assert!(!vml_textbox_rectangle_type(&changed));
        }
    }

    #[test]
    fn identity_groups_preserve_leaf_order_and_overflow_geometry() {
        let xml = r#"<v:group><v:rect id="first"/><v:group id="座標" alt="" style="position:absolute;left:10;top:20;width:100;height:200" coordorigin="10,20" coordsize="100,200"><v:shape id="middle" style="position:absolute;left:-5;top:12;width:140;height:230"/><v:group style="position:absolute;left:30;top:40;width:50;height:60" coordorigin="30,40" coordsize="50,60"><v:line id="last" from="-20,70" to="240,70"/></v:group></v:group></v:group>"#;
        let leaves = vml_group_leaves(xml).unwrap();
        assert_eq!(leaves.len(), 3);
        let ids: Vec<_> = leaves
            .iter()
            .map(|range| get_attribute(&xml[range.start..range.end], "id").unwrap())
            .collect();
        assert_eq!(ids, ["first", "middle", "last"]);
        let last = &xml[leaves[2].start..leaves[2].end];
        assert_eq!(get_attribute(last, "from").as_deref(), Some("-20,70"));
        assert_eq!(get_attribute(last, "to").as_deref(), Some("240,70"));
        for changed in [
            xml.replace("coordorigin=\"10,20\"", "coordorigin=\"0,0\""),
            xml.replace("coordsize=\"100,200\"", "coordsize=\"200,200\""),
            xml.replace("alt=\"\"", "alt=\"label\""),
            xml.replace("left:10", "rotation:90;left:10"),
            xml.replace("left:-5", "z-index:1;left:-5"),
            xml.replace("alt=\"\"", "filled=\"t\" alt=\"\""),
        ] {
            assert!(vml_group_leaves(&changed).is_none());
        }
    }

    #[test]
    fn canvas_hit_testing_requires_exact_nonvisual_structure_and_type() {
        let xml = r##"<v:shape type="#_x0000_t75" style="position:absolute;width:100;height:80;visibility:visible"><v:fill o:detectmouseclick="t"/><v:path o:connecttype="none"/></v:shape>"##;
        assert!(vml_canvas_hit_test_shape(xml, (0.0, 0.0), (100.0, 80.0)));
        for changed in [
            xml.replace("<v:shape ", "<v:shape filled=\"t\" "),
            xml.replace("width:100", "width:101"),
            xml.replace("<v:fill ", "<v:fill color=\"red\" "),
            xml.replace("</v:shape>", "<v:imagedata r:id=\"image\"/></v:shape>"),
        ] {
            assert!(!vml_canvas_hit_test_shape(
                &changed,
                (0.0, 0.0),
                (100.0, 80.0)
            ));
        }
        let definition = rectangular_bitmap_type();
        assert!(vml_declares_unpainted_bitmap(definition));
        assert!(!vml_declares_unpainted_bitmap(xml));
        assert!(!vml_declares_unpainted_bitmap(&format!(
            "{definition}{}",
            definition.replace("stroked=\"f\"", "stroked=\"t\"")
        )));
    }

    #[test]
    fn nonvisual_properties_and_bitmap_formats_are_bounded() {
        assert!(vml_editing_lock(
            r#"<o:lock v:ext="edit" aspectratio="f"/>"#
        ));
        assert!(!vml_editing_lock(
            r#"<o:lock v:ext="view" aspectratio="f"/>"#
        ));
        assert!(!vml_editing_lock(r#"<o:lock v:ext="edit" rotation="t"/>"#));
        assert!(vml_no_wrap(r#"<w10:wrap type="none"/>"#));
        assert!(!vml_no_wrap(r#"<w10:wrap type="none" anchorx="page"/>"#));
        assert!(!vml_no_wrap(r#"<w10:wrap type="square"/>"#));
        assert!(vml_browser_bitmap_src(
            "data:image/png;base64,AA==",
            None,
            None
        ));
        assert!(vml_browser_bitmap_src(
            "data:image/svg+xml;charset=utf-8,%3Csvg",
            None,
            None
        ));
        assert!(!vml_browser_bitmap_src(
            "data:image/x-emf;base64,AA==",
            None,
            None
        ));
        assert!(!vml_browser_bitmap_src(
            "data:image/svg+xml;charset=utf-8,%3Csvg",
            Some("media/vector.emf"),
            Some("image/svg+xml")
        ));
        assert!(!vml_browser_bitmap_src(
            "data:image/png;base64,AA==",
            None,
            Some("image/x-wmf")
        ));
    }

    #[test]
    fn named_paint_preflight_tracks_consumed_colors() {
        for (name, xml) in [
            ("v:rect", r#"<v:rect fillcolor="black"/>"#),
            ("v:rect", r#"<v:rect strokecolor="NAVY" strokeweight="1px"/>"#),
            ("v:line", r#"<v:line fillcolor=" green "/>"#),
            ("v:rect", r#"<v:rect strokecolor="black" strokeweight="0px"/>"#),
        ] {
            assert!(vml_has_active_named_paint(name, xml));
        }
        for (name, xml) in [
            ("v:rect", r#"<v:rect filled="f" fillcolor="black"/>"#),
            ("v:rect", r#"<v:rect stroked="false" strokecolor="black"/>"#),
            ("v:rect", r##"<v:rect fillcolor="#000000" strokecolor="000000"/>"##),
            ("v:rect", r#"<v:rect fillcolor="windowText"/>"#),
            ("v:shape", r#"<v:shape strokecolor="black"><v:imagedata/></v:shape>"#),
            ("v:shape", r#"<v:shape><v:fill color="black"/></v:shape>"#),
            ("v:shapetype", r#"<v:shapetype fillcolor="black"/>"#),
        ] {
            assert!(!vml_has_active_named_paint(name, xml));
        }
    }

    #[test]
    fn grouped_bitmap_named_paint_matches_rgb_and_enables_preflight() {
        use crate::{package::OoxmlPart, parse::empty_style_sheet};
        use base64::Engine;
        use std::{cell::RefCell, collections::HashMap};
        let render = |extension: &str, color: &str, definition: &str, style: &str, wrap: &str| {
            let source = format!(
                r##"<w:pict><v:group style="width:100pt;height:100pt;{style}" coordsize="100,100"><v:shape type="#_x0000_t75" style="position:absolute;left:10;top:10;width:20;height:20"><v:imagedata r:id="rId1"/></v:shape><v:rect style="position:absolute;left:70;top:70;width:20;height:20" strokeweight="1px" fillcolor="{color}" strokecolor="{color}"/><v:shape type="#_x0000_t75" style="position:absolute;left:40;top:10;width:20;height:20"><v:imagedata r:id="rId1"/></v:shape>{wrap}</v:group></w:pict>"##
            );
            let name = "word/document.xml".to_string();
            let parts = HashMap::from([(
                name.clone(),
                OoxmlPart {
                    name,
                    content: format!("{definition}{source}"),
                },
            )]);
            let target = format!("word/media/image.{extension}");
            let pixels = base64::engine::general_purpose::STANDARD
                .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==")
                .expect("valid PNG payload");
            let assets = HashMap::from([(target.clone(), pixels)]);
            let context = ParseContext {
                relationships: HashMap::from([("rId1".to_string(), target)]),
                content_types: Default::default(),
                parts: &parts,
                binary_assets: &assets,
                style_sheet: empty_style_sheet(),
                warnings: RefCell::new(Vec::new()),
            };
            vml_group_image(&source, &context)
        };
        for (name, rgb) in [
            ("black", "#000000"),
            ("NAVY", "#000080"),
            (" green ", "#008000"),
            ("silver", "#c0c0c0"),
            ("gray", "#808080"),
            ("white", "#ffffff"),
            ("maroon", "#800000"),
            ("red", "#ff0000"),
            ("purple", "#800080"),
            ("fuchsia", "#ff00ff"),
            ("lime", "#00ff00"),
            ("olive", "#808000"),
            ("yellow", "#ffff00"),
            ("blue", "#0000ff"),
            ("teal", "#008080"),
            ("aqua", "#00ffff"),
        ] {
            let named = render("png", name, "", "", "").expect("resolved named paint");
            let explicit = render("png", rgb, "", "", "").expect("explicit RGB paint");
            assert_eq!(named.src, explicit.src);
            assert_eq!(named.width_px, explicit.width_px);
            assert_eq!(named.height_px, explicit.height_px);
            assert_eq!(named.src.as_deref().unwrap().matches("%3Cimage%20").count(), 2);
        }
        for unresolved in [
            "auto", "windowText", "currentColor", "transparent", "url(#paint)", "black [0]",
        ] {
            assert!(render("png", unresolved, "", "", "").is_none());
        }
        assert!(render("emf", "black", "", "", "").is_none());
        assert!(render("emf", "#000000", "", "", "").is_some());
        let conflicting = r#"<v:shapetype id="_x0000_t75" path="m0,0l1,1xe"/>"#;
        assert!(render("png", "black", conflicting, "", "").is_none());
        assert!(render("png", "#000000", conflicting, "", "").is_some());
        let reference = "mso-position-horizontal-relative:char;mso-position-vertical-relative:line";
        for metadata in [
            r#"<w10:wrap type="none"/><w10:wrap type="none"/>"#,
            r#"<w10:wrap type="square"/>"#,
            r#"<w10:wrap type="none" anchorx="page"/>"#,
        ] {
            assert!(render("png", "black", "", reference, metadata).is_none());
            assert!(render("png", "#000000", "", reference, metadata).is_some());
        }
        let duplicate = r#"<w10:wrap type="none"/><w10:wrap type="none"/>"#;
        assert!(render("png", "black", "", "position:absolute;left:1pt", duplicate).is_none());
        let none = r#"<w10:wrap type="none"/>"#;
        let image = render("png", "black", "", reference, none).unwrap();
        let floating = image.floating.unwrap();
        assert!(floating.horizontal_relative_to.is_none());
        assert!(floating.vertical_relative_to.is_none());
        assert!(matches!(floating.wrap_type, Some(ImageWrapType::WrapNone)));
    }

    #[test]
    fn default_rectangle_stroke_enables_the_metafile_guard_before_leaf_rendering() {
        use crate::{package::OoxmlPart, parse::empty_style_sheet};
        use std::{cell::RefCell, collections::HashMap};
        let xml = r##"<w:pict><v:group style="width:100pt;height:100pt" coordsize="100,100"><v:shape type="#_x0000_t75" style="position:absolute;left:10;top:10;width:20;height:20"><v:imagedata r:id="rId1"/></v:shape><v:shape type="#_x0000_t75" style="position:absolute;left:40;top:10;width:20;height:20"><v:imagedata r:id="rId1"/></v:shape><v:rect style="position:absolute;left:70;top:70;width:20;height:20"/></v:group></w:pict>"##;
        let render = |extension: &str, source: &str| {
            let name = "word/document.xml".to_string();
            let parts = HashMap::from([(
                name.clone(),
                OoxmlPart {
                    name,
                    content: source.to_string(),
                },
            )]);
            let target = format!("word/media/image.{extension}");
            let assets = HashMap::from([(target.clone(), vec![1, 2, 3])]);
            let context = ParseContext {
                relationships: HashMap::from([("rId1".to_string(), target)]),
                content_types: Default::default(),
                parts: &parts,
                binary_assets: &assets,
                style_sheet: empty_style_sheet(),
                warnings: RefCell::new(Vec::new()),
            };
            vml_group_image(source, &context)
        };
        assert!(render("png", xml).is_some());
        assert!(render("emf", xml).is_none());
        assert!(render(
            "emf",
            &xml.replace("<v:rect style=", "<v:rect stroked=\"f\" style=")
        )
        .is_some());
        assert!(render(
            "emf",
            &xml.replace("<v:rect style=", "<v:rect strokeweight=\"1px\" style=")
        )
        .is_some());
        let conflicting = xml.replace(
            "<v:group ",
            "<v:shapetype id=\"_x0000_t75\" path=\"m0,0l1,1xe\"/><v:group ",
        );
        assert!(render("png", &conflicting).is_none());
    }

    fn inline_group_package(
        style_suffix: &str,
        metadata: &str,
        expanded: bool,
    ) -> crate::OoxmlPackage {
        use base64::Engine;
        let lock = if expanded {
            r#"<o:lock v:ext="edit" aspectratio="f"/><w10:wrap type="none"/>"#
        } else {
            ""
        };
        let document = format!(
            r##"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w10="urn:schemas-microsoft-com:office:word"><w:body><w:p><w:r><w:pict>{}<v:group style="width:100pt;height:80pt;mso-position-horizontal-relative:char;mso-position-vertical-relative:line{style_suffix}" coordsize="100,80"><v:shape type="#_x0000_t75" style="position:absolute;left:10;top:10;width:20;height:20"><v:imagedata r:id="rId1"/>{lock}</v:shape><v:shape type="#_x0000_t75" style="position:absolute;left:40;top:10;width:20;height:20"><v:imagedata r:id="rId1"/></v:shape>{metadata}</v:group></w:pict></w:r></w:p><w:sectPr/></w:body></w:document>"##,
            rectangular_bitmap_type()
        );
        let mut package = crate::create_minimal_docx_package(Some(&document));
        let rel_name = "word/_rels/document.xml.rels".to_string();
        package.parts.insert(rel_name.clone(), crate::OoxmlPart {
            name: rel_name,
            content: r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image.png"/></Relationships>"#.to_string(),
        });
        package.binary_assets.insert("word/media/image.png".to_string(),
            base64::engine::general_purpose::STANDARD
                .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==")
                .unwrap());
        package
    }

    fn overflow_group_package(style: &str, geometry: &str, line: &str) -> crate::OoxmlPackage {
        let mut package = inline_group_package("", "", false);
        let document = format!(
            r##"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w10="urn:schemas-microsoft-com:office:word"><w:body><w:p><w:r><w:pict><v:group style="{style}" {geometry}><v:shape type="#_x0000_t75" style="position:absolute;left:20;top:25;width:30;height:30" stroked="f"><v:imagedata r:id="rId1"/></v:shape>{line}<v:shape type="#_x0000_t202" style="position:absolute;left:65;top:20;width:150;height:40" filled="f" stroked="f"><v:textbox inset="0,0,0,0"><w:txbxContent><w:p><w:r><w:t>Upper story</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape><v:shape type="#_x0000_t202" style="position:absolute;left:145;top:70;width:150;height:40" filled="f" stroked="f"><v:textbox inset="0,0,0,0"><w:txbxContent><w:p><w:r><w:t>Lower story</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></v:group></w:pict></w:r></w:p><w:sectPr/></w:body></w:document>"##,
        );
        package.parts.get_mut("word/document.xml").unwrap().content = document;
        package
    }


    fn render_style_group(package: &crate::OoxmlPackage) -> Option<ImageRunNode> {
        use std::{cell::RefCell, collections::HashMap};
        let source = extract_balanced_tag_blocks(&package.parts["word/document.xml"].content, "w:pict")
            .into_iter().next().unwrap();
        let context = ParseContext {
            relationships: HashMap::from([("rId1".to_string(), "word/media/image.png".to_string())]),
            content_types: Default::default(),
            parts: &package.parts,
            binary_assets: &package.binary_assets,
            style_sheet: crate::parse::empty_style_sheet(),
            warnings: RefCell::new(Vec::new()),
        };
        vml_group_image(&source, &context)
    }

    fn style_group_package() -> crate::OoxmlPackage {
        overflow_group_package("width:270pt;height:105pt", r#"coordsize="360,140""#,
            r##"<v:shape type="#_x0000_t75" style="position:absolute;left:20;top:70;width:30;height:30" stroked="f"><v:imagedata r:id="rId1"/></v:shape>"##)
    }

    #[test]
    fn explicit_default_group_styles_preserve_payload_and_placement() {
        let package = style_group_package();
        let expected = render_style_group(&package).unwrap();
        assert_eq!(svg_fragment_count(&expected, "data:image/png;base64,"), 2);
        assert_eq!(svg_fragment_count(&expected, "Upper story"), 1);
        assert_eq!(svg_fragment_count(&expected, "Lower story"), 1);
        for style in ["mso-wrap-style:square;", "v-text-anchor:top;", "mso-wrap-style:square;v-text-anchor:top;"] {
            let mut explicit = package.clone();
            let part = explicit.parts.get_mut("word/document.xml").unwrap();
            part.content = part.content.replace("position:absolute;", &format!("position:absolute;{style}"));
            let actual = render_style_group(&explicit).unwrap();
            assert_eq!(actual.src, expected.src);
            assert_eq!(actual.width_px, expected.width_px);
            assert_eq!(actual.height_px, expected.height_px);
            assert_eq!(actual.paint_bounds, expected.paint_bounds);
            assert_eq!(serde_json::to_value(actual.floating).unwrap(), serde_json::to_value(&expected.floating).unwrap());
        }
    }

    #[test]
    fn self_linked_group_textboxes_terminate_without_cross_box_flow() {
        let mut package = style_group_package();
        let expected = render_style_group(&package).unwrap();
        let part = package.parts.get_mut("word/document.xml").unwrap();
        for id in ["box-a", "box-b"] {
            part.content = part.content.replacen(r##"<v:shape type="#_x0000_t202""##,
                &format!(r##"<v:shape id="{id}" type="#_x0000_t202""##), 1);
            part.content = part.content.replacen("<v:textbox inset=",
                &format!(r##"<v:textbox style="mso-next-textbox:#{id};v-text-anchor:top" inset="##), 1);
        }
        let actual = render_style_group(&package).unwrap();
        assert_eq!(actual.src, expected.src);
        assert_eq!(svg_fragment_count(&actual, "data:image/png;base64,"), 2);
        for (from, to) in [
            ("mso-next-textbox:#box-a", "mso-next-textbox:#box-b"),
            ("mso-next-textbox:#box-a", "mso-next-textbox:#missing"),
            ("mso-next-textbox:#box-a", "mso-next-textbox:#"),
            ("mso-next-textbox:#box-a", "mso-next-textbox:box-a"),
            ("v-text-anchor:top", "v-text-anchor:bottom"),
            ("v-text-anchor:top", "mso-fit-shape-to-text:false"),
        ] {
            let mut unsupported = package.clone();
            let part = unsupported.parts.get_mut("word/document.xml").unwrap();
            part.content = part.content.replace(from, to);
            assert!(render_style_group(&unsupported).is_none(), "{to}");
        }
    }


    #[test]
    fn explicit_default_bitmap_group_exports_inline() {
        use crate::model::{DocNode, ParagraphChildNode};
        let mut package = inline_group_package("", "", false);
        let part = package.parts.get_mut("word/document.xml").unwrap();
        part.content = part.content.replace("position:absolute;", "position:absolute;mso-wrap-style:square;");
        let mut model = crate::build_doc_model(&package);
        let DocNode::Paragraph(paragraph) = &mut model.nodes[0] else {
            panic!("paragraph")
        };
        let ParagraphChildNode::Image(image) = &mut paragraph.children[0] else {
            panic!("image")
        };
        assert!(image.floating.is_none());
        assert_eq!(svg_fragment_count(image, "data:image/png;base64,"), 2);
        image.width_px = Some(160.0);
        image.height_px = Some(80.0);
        paragraph.source_xml = None;
        let exported = crate::serialize_doc_model(&model, Some(&package));
        let xml = &exported.parts["word/document.xml"].content;
        assert!(xml.contains("<wp:inline "));
        assert!(!xml.contains("<wp:anchor "));
    }

    #[test]
    fn grouped_bitmap_root_wrap_survives_edit_and_export() {
        use crate::model::{DocNode, ParagraphChildNode};
        for (kind, expected, export_tag) in [
            ("topAndBottom", ImageWrapType::TopAndBottom, "<wp:wrapTopAndBottom"),
            ("square", ImageWrapType::Square, "<wp:wrapSquare"),
            ("tight", ImageWrapType::Tight, "<wp:wrapTight"),
            ("through", ImageWrapType::Through, "<wp:wrapThrough"),
            ("none", ImageWrapType::WrapNone, "<wp:wrapNone"),
        ] {
            let metadata = format!(r#"<w10:wrap type="{kind}" side="right"/>"#);
            let package = inline_group_package(";position:absolute;left:12px;top:8px", &metadata, true);
            let mut model = crate::build_doc_model(&package);
            let DocNode::Paragraph(paragraph) = &mut model.nodes[0] else {
                panic!("paragraph")
            };
            let ParagraphChildNode::Image(image) = &mut paragraph.children[0] else {
                panic!("image")
            };
            assert_eq!(svg_fragment_count(image, "data:image/png;base64,"), 2);
            let floating = image.floating.as_ref().unwrap();
            assert_eq!(floating.wrap_type, Some(expected.clone()), "{kind}");
            assert_eq!(floating.wrap_text, Some(ImageWrapText::Right));
            assert_eq!((floating.x_px, floating.y_px), (Some(12.0), Some(8.0)));
            image.width_px = Some(160.0);
            image.height_px = Some(80.0);
            paragraph.source_xml = None;
            let exported = crate::serialize_doc_model(&model, Some(&package));
            let xml = &exported.parts["word/document.xml"].content;
            assert!(xml.contains("<wp:anchor "));
            assert!(xml.contains(export_tag), "{kind}");
            let reparsed = crate::build_doc_model(&exported);
            let DocNode::Paragraph(paragraph) = &reparsed.nodes[0] else {
                panic!("paragraph")
            };
            let ParagraphChildNode::Image(image) = &paragraph.children[0] else {
                panic!("image")
            };
            assert_eq!(image.floating.as_ref().unwrap().wrap_type, Some(expected), "{kind}");
        }
    }

    #[test]
    fn group_wrap_metadata_creates_anchor_without_position_hints() {
        let mut package = style_group_package();
        let part = package.parts.get_mut("word/document.xml").unwrap();
        part.content = part.content.replace("</v:group>", r#"<w10:wrap type="topAndBottom"/></v:group>"#);
        let image = render_style_group(&package).unwrap();
        let floating = image.floating.as_ref().unwrap();
        assert_eq!(floating.wrap_type, Some(ImageWrapType::TopAndBottom));
        assert_eq!((floating.x_px, floating.y_px), (None, None));
        assert_eq!(svg_fragment_count(&image, "data:image/png;base64,"), 2);
    }

    fn first_group_image(package: &crate::OoxmlPackage) -> ImageRunNode {
        let model = crate::build_doc_model(package);
        let crate::model::DocNode::Paragraph(paragraph) = &model.nodes[0] else {
            panic!("paragraph")
        };
        let crate::model::ParagraphChildNode::Image(image) = &paragraph.children[0] else {
            panic!("image")
        };
        (**image).clone()
    }

    fn svg_fragment_count(image: &ImageRunNode, fragment: &str) -> usize {
        let encoded = svg_data_uri(fragment);
        image.src.as_ref().unwrap().matches(encoded.split_once(',').unwrap().1).count()
    }

    #[test]
    fn inline_overflow_preserves_logical_frame_payload_and_stories() {
        let package = overflow_group_package("width:270pt;height:105pt", r#"coordorigin="0,0" coordsize="360,140""#,
            r##"<v:line from="0,120" to="360,120" strokecolor="#3355aa" strokeweight="0.75pt"/>"##);
        let image = first_group_image(&package);
        assert_eq!((image.width_px, image.height_px), (Some(360.0), Some(140.0)));
        assert!(image.floating.is_none());
        assert_eq!(image.paint_bounds.as_deref(), Some(&ImagePaintBounds {
            x_px: -0.5, y_px: 0.0, width_px: 361.0, height_px: 140.0,
            layout_width_px: 360.0, layout_height_px: 140.0,
        }));
        assert_eq!(svg_fragment_count(&image, r#"viewBox="-0.5 0 361 140""#), 1);
        assert_eq!(svg_fragment_count(&image, "data:image/png;base64,"), 1);
        let stories = image.content_nodes.as_ref().unwrap();
        assert_eq!(stories.len(), 2);
        for (story, expected) in stories.iter().zip(["Upper story", "Lower story"]) {
            let crate::model::DocNode::Paragraph(paragraph) = story else {
                panic!("story paragraph")
            };
            let crate::model::ParagraphChildNode::Text(text) = &paragraph.children[0] else {
                panic!("story text")
            };
            assert_eq!(text.text, expected);
        }
        let encoded = serde_json::to_value(&image).unwrap();
        assert_eq!(encoded["paintBounds"]["xPx"], -0.5);
        assert_eq!(serde_json::from_value::<ImageRunNode>(encoded).unwrap(), image);
    }

    #[test]
    fn inline_overflow_maps_nonzero_coordinate_origin_and_nonunit_scale() {
        let package = overflow_group_package("width:540pt;height:420pt", r#"coordorigin="10,20" coordsize="360,140""#,
            r##"<v:line from="10,20" to="370,160" strokecolor="#3355aa" strokeweight="0.75pt"/>"##);
        let image = first_group_image(&package);
        assert_eq!((image.width_px, image.height_px), (Some(720.0), Some(560.0)));
        assert_eq!(image.paint_bounds.as_deref(), Some(&ImagePaintBounds {
            x_px: -0.5, y_px: -0.5, width_px: 721.0, height_px: 561.0,
            layout_width_px: 720.0, layout_height_px: 560.0,
        }));
        assert_eq!(svg_fragment_count(&image, r#"viewBox="9.75 19.875 360.5 140.25""#), 1);
        assert_eq!(svg_fragment_count(&image, "data:image/png;base64,"), 1);
        assert!(image.floating.is_none());
    }

    #[test]
    fn floating_overflow_keeps_existing_anchor_and_canvas_contract() {
        let package = overflow_group_package("position:absolute;left:12px;top:8px;width:270pt;height:105pt", r#"coordsize="360,140""#,
            r##"<v:line from="0,120" to="360,120" strokecolor="#3355aa" strokeweight="0.75pt"/>"##);
        let image = first_group_image(&package);
        assert_eq!((image.width_px, image.height_px), (Some(361.0), Some(140.0)));
        assert!(image.paint_bounds.is_none());
        let floating = image.floating.as_ref().unwrap();
        assert_eq!((floating.x_px, floating.y_px), (Some(11.5), Some(8.0)));
        assert!(serde_json::to_value(&image).unwrap().get("paintBounds").is_none());
    }

    #[test]
    fn in_frame_inline_group_omits_paint_metadata() {
        let package = overflow_group_package("width:270pt;height:105pt", r#"coordsize="360,140""#,
            r##"<v:line from="1,120" to="359,120" strokecolor="#3355aa" strokeweight="0.75pt"/>"##);
        let image = first_group_image(&package);
        assert_eq!((image.width_px, image.height_px), (Some(360.0), Some(140.0)));
        assert!(image.paint_bounds.is_none());
        assert!(image.floating.is_none());
        assert!(serde_json::to_value(&image).unwrap().get("paintBounds").is_none());
    }

    #[test]
    fn inline_reference_normalization_precedes_overflow_mapping_only_in_admitted_domain() {
        let mut package = overflow_group_package("width:270pt;height:105pt;mso-position-horizontal-relative:char;mso-position-vertical-relative:line", r#"coordsize="360,140""#,
            r##"<v:line from="0,120" to="360,120" strokecolor="#3355aa" strokeweight="0.75pt"/>"##);
        let part = package.parts.get_mut("word/document.xml").unwrap();
        part.content = part.content.replace("</v:group>", "<o:lock v:ext=\"edit\" aspectratio=\"f\"/></v:group>");
        let image = first_group_image(&package);
        assert!(image.paint_bounds.is_some());
        assert!(image.floating.is_none());
        assert_eq!(svg_fragment_count(&image, "data:image/png;base64,"), 1);
    }

    #[test]
    fn single_bitmap_overflow_keeps_inline_frame_and_payload() {
        let mut package = inline_group_package("", "", false);
        let document = package.parts.get_mut("word/document.xml").unwrap();
        let start = document.content.find("<v:group ").unwrap();
        let end = document.content.find("</v:group>").unwrap() + "</v:group>".len();
        document.content.replace_range(start..end,
            r##"<v:group style="width:270pt;height:105pt" coordsize="360,140"><v:shape type="#_x0000_t75" style="position:absolute;left:-0.5;top:0;width:361;height:140" stroked="f"><v:imagedata r:id="rId1"/></v:shape></v:group>"##);
        let image = first_group_image(&package);
        assert_eq!((image.width_px, image.height_px), (Some(360.0), Some(140.0)));
        assert!(image.floating.is_none());
        assert_eq!(image.paint_bounds.as_deref(), Some(&ImagePaintBounds {
            x_px: -0.5, y_px: 0.0, width_px: 361.0, height_px: 140.0,
            layout_width_px: 360.0, layout_height_px: 140.0,
        }));
        assert_eq!(svg_fragment_count(&image, "data:image/png;base64,"), 1);
        assert!(image.content_nodes.is_none());
        for (find, replace) in [
            ("left:-0.5;top:0;width:361", "left:0;top:0;width:360"),
            ("width:270pt;height:105pt", "position:absolute;left:12px;top:8px;width:270pt;height:105pt"),
        ] {
            let mut unchanged = package.clone();
            let document = unchanged.parts.get_mut("word/document.xml").unwrap();
            document.content = document.content.replace(find, replace);
            let fallback = first_group_image(&unchanged);
            assert!(fallback.paint_bounds.is_none());
            assert_eq!(fallback.content_type.as_deref(), Some("image/png"));
        }
        let mut missing_relationship = package.clone();
        missing_relationship.parts.get_mut("word/_rels/document.xml.rels").unwrap().content =
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>"#.to_string();
        let model = crate::build_doc_model(&missing_relationship);
        assert_eq!(model.metadata.warnings.iter().filter(|warning| warning.as_str() == "Missing relationship target for rId1").count(), 1);
        let mut unsupported = package.clone();
        unsupported.parts.get_mut("word/_rels/document.xml.rels").unwrap().content =
            unsupported.parts["word/_rels/document.xml.rels"].content.replace("image.png", "image.wmf");
        let bytes = unsupported.binary_assets.remove("word/media/image.png").unwrap();
        unsupported.binary_assets.insert("word/media/image.wmf".to_string(), bytes);
        let fallback = first_group_image(&unsupported);
        assert!(fallback.paint_bounds.is_none());
        assert_ne!(fallback.content_type.as_deref(), Some("image/svg+xml"));
    }

    #[test]
    fn edited_group_exports_inline_only_without_anchor_data() {
        use crate::model::{DocNode, ParagraphChildNode};
        for (style, metadata, expanded, anchored) in [
            ("", "", true, false),
            ("", "<w10:anchorlock/>", true, false),
            (";position:static", "", true, false),
            (";position:relative", "", true, false),
            (";position:absolute", "", true, true),
            (";left:0px;top:0px", "", true, true),
            (";margin-left:0;margin-top:0", "", true, true),
            (";mso-position-horizontal:center", "", true, true),
            (";mso-wrap-style:none", "", true, true),
            (";z-index:0", "", true, true),
            (";mso-wrap-distance-left:0px", "", true, true),
            ("", r#"<w10:wrap type="none"/>"#, true, true),
            ("", "", false, true),
        ] {
            let package = inline_group_package(style, metadata, expanded);
            let mut model = crate::build_doc_model(&package);
            let DocNode::Paragraph(paragraph) = &mut model.nodes[0] else {
                panic!("paragraph")
            };
            let ParagraphChildNode::Image(image) = &mut paragraph.children[0] else {
                panic!("image")
            };
            assert_eq!(image.content_type.as_deref(), Some("image/svg+xml"));
            assert_eq!(image.floating.is_some(), anchored, "{style} {metadata}");
            let restored_wrap = style.is_empty() && metadata == r#"<w10:wrap type="none"/>"#;
            if restored_wrap {
                assert_eq!(
                    serde_json::to_value(&image.floating).unwrap(),
                    serde_json::json!({"wrapType": "none"})
                );
            }
            let original_source = image.src.clone();
            image.width_px = Some(160.0);
            image.height_px = Some(80.0);
            assert_eq!(image.src, original_source);
            paragraph.source_xml = None;
            let exported = crate::serialize_doc_model(&model, Some(&package));
            let xml = &exported.parts["word/document.xml"].content;
            assert_eq!(xml.contains("<wp:anchor "), anchored, "{style} {metadata}");
            assert_eq!(xml.contains("<wp:inline "), !anchored, "{style} {metadata}");
            assert!(xml.contains(r#"<wp:extent cx="1524000" cy="762000"/>"#));
            assert!(exported.binary_assets.values().any(|bytes| {
                std::str::from_utf8(bytes).is_ok_and(|svg| {
                    svg.starts_with("<svg") && svg.matches("data:image/png;base64,").count() == 2
                })
            }));
            if restored_wrap {
                assert!(xml.contains(r#"<wp:positionH relativeFrom="margin">"#));
                assert!(!xml.contains(r#"<wp:positionH relativeFrom="line">"#));
                assert!(xml.contains("<wp:wrapNone/>"));
                let reparsed = crate::build_doc_model(&exported);
                let DocNode::Paragraph(paragraph) = &reparsed.nodes[0] else {
                    panic!("paragraph")
                };
                let ParagraphChildNode::Image(image) = &paragraph.children[0] else {
                    panic!("image")
                };
                let floating = image.floating.as_ref().unwrap();
                assert_eq!(floating.horizontal_relative_to.as_deref(), Some("margin"));
                assert_eq!(floating.wrap_type, Some(ImageWrapType::WrapNone));
                assert_eq!((image.width_px, image.height_px), (Some(160.0), Some(80.0)));
            }
            if !anchored {
                assert!(!xml.contains("<wp:positionH"));
                let reparsed = crate::build_doc_model(&exported);
                let DocNode::Paragraph(paragraph) = &reparsed.nodes[0] else {
                    panic!("paragraph")
                };
                let ParagraphChildNode::Image(image) = &paragraph.children[0] else {
                    panic!("image")
                };
                assert!(image.floating.is_none());
                assert_eq!((image.width_px, image.height_px), (Some(160.0), Some(80.0)));
            }
        }
    }

    #[test]
    fn reference_hint_normalization_preserves_every_anchor_field() {
        let style = parse_css_style_declarations("width:100pt;height:80pt;mso-position-horizontal-relative:char;mso-position-vertical-relative:line");
        let hints = serde_json::json!({"horizontalRelativeTo":"line","verticalRelativeTo":"line"});
        let floating: ImageFloating = serde_json::from_value(hints.clone()).unwrap();
        assert!(vml_inline_reference_hints(&style, false, Some(&floating)));
        assert!(!vml_inline_reference_hints(&style, true, Some(&floating)));
        for (field, value) in [
            ("xPx", serde_json::json!(0)),
            ("yPx", serde_json::json!(0)),
            ("horizontalAlign", serde_json::json!("center")),
            ("verticalAlign", serde_json::json!("center")),
            ("distLPx", serde_json::json!(0)),
            ("distRPx", serde_json::json!(0)),
            ("distTPx", serde_json::json!(0)),
            ("distBPx", serde_json::json!(0)),
            ("wrapType", serde_json::json!("none")),
            ("wrapText", serde_json::json!("bothSides")),
            ("behindDocument", serde_json::json!(false)),
            ("zIndex", serde_json::json!(0)),
        ] {
            let mut modified = hints.clone();
            modified[field] = value;
            let anchor: ImageFloating = serde_json::from_value(modified).unwrap();
            assert!(
                !vml_inline_reference_hints(&style, false, Some(&anchor)),
                "{field}"
            );
        }
    }

    #[test]
    fn group_wrap_types_are_not_shape_type_references() {
        use crate::{package::OoxmlPart, parse::empty_style_sheet};
        use base64::Engine;
        use std::{cell::RefCell, collections::HashMap};
        let xml = format!(
            r##"<w:pict><v:group editas="canvas" style="width:100pt;height:80pt" coordsize="100,80">{}<v:shape type="#_x0000_t75" style="position:absolute;width:100;height:80"><v:fill o:detectmouseclick="t"/><v:path o:connecttype="none"/></v:shape><v:shape type="#_x0000_t75" style="position:absolute;left:10;width:20;height:20"><v:imagedata r:id="rId1"/></v:shape><v:shape type="#_x0000_t75" style="position:absolute;left:40;width:20;height:20"><v:imagedata r:id="rId1"/></v:shape><w10:wrap type="none"/><w10:anchorlock/></v:group></w:pict>"##,
            rectangular_bitmap_type()
        );
        let render = |extension: &str, source: &str, part_prefix: &str| {
            let name = "word/document.xml".to_string();
            let parts = HashMap::from([(
                name.clone(),
                OoxmlPart {
                    name,
                    content: format!("{part_prefix}{source}"),
                },
            )]);
            let target = format!("word/media/image.{extension}");
            let pixels = base64::engine::general_purpose::STANDARD
                .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==")
                .unwrap();
            let payload = if extension == "emf" {
                vec![1, 2, 3]
            } else {
                pixels
            };
            let assets = HashMap::from([(target.clone(), payload)]);
            let context = ParseContext {
                relationships: HashMap::from([("rId1".to_string(), target)]),
                content_types: Default::default(),
                parts: &parts,
                binary_assets: &assets,
                style_sheet: empty_style_sheet(),
                warnings: RefCell::new(Vec::new()),
            };
            vml_group_image(source, &context)
        };
        let image = render("png", &xml, "").unwrap();
        assert_eq!(image.src.unwrap().matches("%3Cimage%20").count(), 2);
        assert!(render("emf", &xml, "").is_none());
        let unknown_shape = xml.replacen(
            "left:10;width:20;height:20\"><v:imagedata",
            "left:10;width:20;height:20\" path=\"m0,0l1,1xe\"><v:imagedata",
            1,
        );
        assert!(render("png", &unknown_shape, "").is_none());
        assert!(render("png", &xml.replace("#_x0000_t75", "#_x0000_t999"), "").is_none());
        let direct = xml
            .replace(
                r##"<v:shape type="#_x0000_t75" style="position:absolute;width:100;height:80"><v:fill o:detectmouseclick="t"/><v:path o:connecttype="none"/></v:shape>"##,
                "",
            )
            .replace("editas=\"canvas\" ", "")
            .replace("<v:shape type=", "<v:shape stroked=\"f\" strokeweight=\"1px\" type=");
        assert!(render("png", &direct, "").is_some());
        assert!(render("emf", &direct, "").is_none());
        let conflicting = rectangular_bitmap_type().replace("stroked=\"f\"", "stroked=\"t\"");
        assert!(render("png", &direct, &conflicting).is_none());
        for metadata in [
            r#"<w10:wrap type="none"/><w10:wrap type="none"/>"#,
            r#"<w10:wrap type="square"/>"#,
            r#"<w10:wrap type="none" anchorx="page"/>"#,
            r#"<w10:anchorlock type="none"/>"#,
        ] {
            let unsupported = direct.replace(r#"<w10:wrap type="none"/>"#, metadata);
            assert!(render("png", &unsupported, "").is_none());
        }
    }

    #[test]
    fn compact_vml_paths_resolve_relative_coordinates() {
        assert_eq!(
            vml_svg_path("m10,20r5,-2,-3,4xe").as_deref(),
            Some("M10 20L15 18L12 22Z")
        );
        assert_eq!(
            vml_svg_path("m10,l,,,20r5,l5,30r10,l15,20,15,xe").as_deref(),
            Some("M10 0L0 0L0 20L5 20L5 30L15 30L15 20L15 0Z")
        );
        assert_eq!(
            vml_svg_path("m10,20r5,5xr2,3e").as_deref(),
            Some("M10 20L15 25ZL12 23")
        );
        assert_eq!(
            vml_svg_path("m0,0c10,10,,,25,13e").as_deref(),
            Some("M0 0C10 10 0 0 25 13")
        );
        assert!(vml_svg_path("m0,0r1e").is_none());
        assert!(vml_svg_path("m0,0r@1,@2e").is_none());
        assert!(vml_svg_path("m0,0q1,2e").is_none());
    }

    #[test]
    fn explicit_vml_paths_keep_their_serialization() {
        assert_eq!(
            vml_svg_path("m 1,2 l 3,4 5,6 x e").as_deref(),
            Some("M1,2L3,4 5,6Z")
        );
        assert_eq!(vml_pixels("0"), Some(0.0));
        assert_eq!(vml_pixels("12.5"), Some(12.5));
        assert_eq!(vml_pixels("3pt"), Some(4.0));
    }

    #[test]
    fn vml_wrap_element_overrides_style_and_preserves_side() {
        let xml = r#"<w:pict><v:shape style="position:absolute;left:-60.15pt;top:-45pt;mso-wrap-style:square;z-index:-1"><w10:wrap type="none" side="right"/></v:shape></w:pict>"#;
        let floating = parse_vml_floating_anchor_from_run_xml(xml).expect("VML anchor");
        assert_eq!(floating.wrap_type, Some(ImageWrapType::WrapNone));
        assert_eq!(floating.wrap_text, Some(ImageWrapText::Right));
        assert_eq!(floating.z_index, Some(-1));
        assert_eq!(floating.behind_document, Some(true));
        assert!(floating.x_px.is_some_and(|x| (x + 80.0).abs() < 0.01));
        assert!(floating.y_px.is_some_and(|y| (y + 60.0).abs() < 0.01));
    }

    #[test]
    fn outer_vml_size_wins_over_nested_drawing_extent() {
        let xml = r#"<w:pict><v:shape style="width:558pt;height:738pt"><v:textbox><w:txbxContent><w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="476250"/></wp:inline></w:drawing></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict>"#;
        let (width, height, _) = resolve_run_image_layout(xml);
        assert!(width.is_some_and(|value| (value - 744.0).abs() < 0.01));
        assert!(height.is_some_and(|value| (value - 984.0).abs() < 0.01));
    }
}

#[cfg(test)]
mod shared_vml_layout_style_tests {
    use super::*;

    #[test]
    fn first_shape_with_missing_or_empty_style_blocks_later_shapes() {
        for first in [r#"<v:shape/>"#, r#"<v:shape style=""/>"#, r#"<v:shape style=" "/>"#] {
            let xml = format!(r#"{first}<v:shape style="width:40px;left:12px"/>"#);
            let (width, height, floating) = resolve_run_image_layout(&xml);
            assert_eq!((width, height), (None, None));
            assert!(floating.is_none());
            assert_eq!(parse_vml_size(&xml), (None, None));
            assert!(parse_vml_floating_anchor_from_run_xml(&xml).is_none());
        }
    }

    #[test]
    fn dimension_and_position_declaration_precedence_remains_distinct() {
        let xml = r#"<v:shape style="width:8px;width:16px;height:12pt;left:1px;left:2px"/>"#;
        let (width, height, floating) = resolve_run_image_layout(xml);
        assert_eq!((width, height), (Some(8.0), Some(16.0)));
        assert_eq!(floating.unwrap().x_px, Some(2.0));
        assert_eq!(parse_vml_size(xml), (Some(8.0), Some(16.0)));
        assert_eq!(parse_vml_floating_anchor_from_run_xml(xml).unwrap().x_px, Some(2.0));
    }

    #[test]
    fn case_folding_and_existing_token_boundaries_select_the_first_shape() {
        for name in ["v:shape", "V:SHAPE", "v:ſhape", "v:shapeλ", "v:shape-extra"] {
            let xml = format!(r#"<{name} style="width:7px;left:3px"/><v:shape style="width:9px;left:5px"/>"#);
            let (width, _, floating) = resolve_run_image_layout(&xml);
            assert_eq!(width, Some(7.0), "{name}");
            assert_eq!(floating.unwrap().x_px, Some(3.0), "{name}");
        }
        let xml = r#"<v:shape_extra style="width:7px;left:3px"/><v:shape style="width:9px;left:5px"/>"#;
        let (width, _, floating) = resolve_run_image_layout(xml);
        assert_eq!(width, Some(9.0));
        assert_eq!(floating.unwrap().x_px, Some(5.0));
    }

    #[test]
    fn vml_dimensions_override_drawing_extent_without_changing_anchor_priority() {
        let xml = r#"<v:shape style="width:8px;height:9px;left:17px"/><wp:extent cx="952500" cy="1905000"/><wp:anchor><wp:positionH relativeFrom="page"><wp:posOffset>95250</wp:posOffset></wp:positionH></wp:anchor>"#;
        let (width, height, floating) = resolve_run_image_layout(xml);
        assert_eq!((width, height), (Some(8.0), Some(9.0)));
        let floating = floating.unwrap();
        assert_eq!(floating.x_px, Some(10.0));
        assert_eq!(floating.horizontal_relative_to.as_deref(), Some("page"));
    }

    #[test]
    fn absent_vml_dimensions_keep_extent_and_empty_anchor_falls_back() {
        let xml = r#"<v:shape style="left:17px"/><wp:extent cx="952500" cy="1905000"/><wp:anchor/>"#;
        let (width, height, floating) = resolve_run_image_layout(xml);
        assert_eq!((width, height), (Some(100.0), Some(200.0)));
        assert_eq!(floating.unwrap().x_px, Some(17.0));
    }

    #[test]
    fn wrap_selection_keeps_whole_run_scope() {
        let xml = r#"<w10:wrap type="tight" side="right"/><v:shape style="width:8px;left:3px"><w10:wrap type="square" side="left"/></v:shape>"#;
        let (width, _, floating) = resolve_run_image_layout(xml);
        assert_eq!(width, Some(8.0));
        let floating = floating.unwrap();
        assert!(matches!(floating.wrap_type, Some(ImageWrapType::Tight)));
        assert!(matches!(floating.wrap_text, Some(ImageWrapText::Right)));
    }
}
