use crate::model::{
    ImageCrop, ImageFloating, ImageHorizontalAlign, ImageRunNode, ImageRunNodeType,
    ImageVerticalAlign, ImageWrapText, ImageWrapType,
};
use crate::parse::colors::normalize_hex_color;
use crate::parse::context::ParseContext;
use crate::parse::re;
use crate::parse::relationships::{bytes_to_base64, content_type_for_part};
use crate::parse::shapes::{
    parse_text_box_layout, parse_text_box_paragraphs, render_standalone_word_shape_svg,
    render_text_box_svg,
};
use crate::parse::util::{
    active_xml as prefer_alternate_content_choice, clamp, clamp_i64, emu_to_pixels,
    escape_xml_text, is_windows_metafile_content_type, rasterize_windows_metafile_to_png_data_uri,
    regex_capture, regex_capture_tag, svg_data_uri, to_image_horizontal_align,
    to_image_vertical_align, windows_metafile_to_svg_data_uri,
};
use crate::xml::{
    decode_xml_entities, extract_balanced_tag_blocks, extract_balanced_tag_blocks_in_order,
    get_attribute,
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

fn drawing_duotone_svg(run_xml: &str, source: &str, context: &ParseContext<'_>) -> Option<String> {
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
            &context.style_sheet.theme_colors,
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

pub fn parse_vml_size(run_xml: &str) -> (Option<f64>, Option<f64>) {
    let shape_tag = regex_capture_tag(run_xml, r"(?i)<v:shape\b[^>]*>").unwrap_or_default();
    let style = get_attribute(&shape_tag, "style").unwrap_or_default();
    if style.is_empty() {
        return (None, None);
    }

    let width_match =
        re::get_unchecked(r"(?i)width:\s*([0-9.]+)\s*(px|pt|in|cm|mm)").captures(&style);
    let height_match =
        re::get_unchecked(r"(?i)height:\s*([0-9.]+)\s*(px|pt|in|cm|mm)").captures(&style);

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
    let shape_tag = regex_capture_tag(run_xml, r"(?i)<v:shape\b[^>]*>").unwrap_or_default();
    let style_value = get_attribute(&shape_tag, "style")?;
    let declarations = parse_css_style_declarations(&style_value);
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
    let vml_size = parse_vml_size(run_xml);
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
    let floating = parse_floating_anchor_from_run_xml(run_xml)
        .or_else(|| parse_vml_floating_anchor_from_run_xml(run_xml));
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

fn vml_pixels(value: &str) -> Option<f64> {
    let value = value.trim();
    let split = value.find(|c: char| c.is_ascii_alphabetic())?;
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

fn vml_group_image(run_xml: &str, context: &ParseContext<'_>) -> Option<ImageRunNode> {
    if !run_xml.contains("<v:group") || run_xml.contains("<w:txbxContent") {
        return None;
    }
    let groups = extract_balanced_tag_blocks(run_xml, "v:group");
    if groups.len() != 1 {
        return None;
    }
    let group = &groups[0];
    if group.matches("<v:imagedata").count() < 2
        || run_xml.matches("<v:imagedata").count() != group.matches("<v:imagedata").count()
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
    let children = crate::xml_index::children(group)?;
    let mut elements = Vec::new();
    let mut canvas = (origin_x, origin_y, origin_x + extent_x, origin_y + extent_y);
    for child in children {
        let xml = &group[child.start..child.end];
        if child.tag_name == "w10:wrap" {
            continue;
        }
        if !matches!(child.tag_name.as_str(), "v:shape" | "v:rect" | "v:line") {
            return None;
        }
        let tag = &xml[..crate::xml::tag_token_end(xml, 0)?];
        let declarations =
            parse_css_style_declarations(&get_attribute(tag, "style").unwrap_or_default());
        if declarations.keys().any(|key| {
            !matches!(
                key.as_str(),
                "position" | "left" | "top" | "width" | "height" | "z-index"
            )
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
                        || ["opacity", "color", "color2", "on"]
                            .iter()
                            .any(|name| get_attribute(inner, name).is_some())
                    {
                        return None;
                    }
                }
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
                        "joinstyle",
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
                Some(value) => normalize_hex_color(Some(&value))?,
                None => "#ffffff".to_string(),
            }
        };
        let stroke = if get_attribute(tag, "stroked")
            .as_deref()
            .is_some_and(|v| matches!(v, "false" | "f" | "0"))
        {
            "none".to_string()
        } else {
            match get_attribute(tag, "strokecolor") {
                Some(value) => normalize_hex_color(Some(&value))?,
                None => "#000000".to_string(),
            }
        };
        let stroke_weight = get_attribute(tag, "strokeweight");
        if stroke != "none" && stroke_weight.is_none() {
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
            } else if xml.contains("<v:imagedata") {
                if xml.matches("<v:imagedata").count() != 1
                    || get_attribute(tag, "path").is_some()
                    || get_attribute(tag, "type").as_deref() != Some("#_x0000_t75")
                    || stroke != "none"
                    || get_attribute(tag, "fillcolor").is_some()
                {
                    return None;
                }
                let image = parse_run_image_block(xml, context)?;
                let src = escape_xml_text(image.src.as_deref()?);
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
    let width_px = if canvas_width == extent_x {
        width
    } else {
        canvas_width * width / extent_x
    };
    let height_px = if canvas_height == extent_y {
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
    if canvas != (origin_x, origin_y, origin_x + extent_x, origin_y + extent_y) {
        let anchor = floating.as_mut()?;
        if anchor.horizontal_align.is_some() || anchor.vertical_align.is_some() {
            return None;
        }
        *anchor.x_px.as_mut()? += (canvas.0 - origin_x) * width / extent_x;
        *anchor.y_px.as_mut()? += (canvas.1 - origin_y) * height / extent_y;
    }
    let svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width_px}" height="{height_px}" viewBox="{} {} {canvas_width} {canvas_height}" preserveAspectRatio="none">{body}</svg>"#,
        canvas.0, canvas.1
    );
    Some(ImageRunNode {
        r#type: ImageRunNodeType::Image,
        block_id: None,
        content_nodes: None,
        semantic_kind: None,
        math_ml: None,
        src: Some(svg_data_uri(&svg)),
        alt: None,
        width_px: Some(width_px),
        height_px: Some(height_px),
        part_name: None,
        content_type: Some("image/svg+xml".to_string()),
        data: None,
        source_xml: Some(run_xml.to_string()),
        crop: None,
        css_filter: None,
        css_opacity: None,
        floating,
        synthetic_text_box: None,
        text_box_text: None,
    })
}

pub fn parse_run_image_block(run_xml: &str, context: &ParseContext<'_>) -> Option<ImageRunNode> {
    let normalized_run_xml = prefer_alternate_content_choice(run_xml);
    let mut active_run_xml = normalized_run_xml.as_ref();
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
            src = Some(format!(
                "data:{mime_type};base64,{}",
                bytes_to_base64(binary)
            ));
            resolved_content_type = Some(mime_type);
        }
    }

    if let Some(source) = src.as_deref() {
        if let Some(duotone) = drawing_duotone_svg(active_run_xml, source, context) {
            src = Some(duotone);
        }
    }

    Some(ImageRunNode {
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

pub fn parse_run_images(run_xml: &str, context: &ParseContext<'_>) -> Vec<ImageRunNode> {
    parse_run_image_tokens(run_xml, context)
        .into_iter()
        .map(|(_, image)| image)
        .collect()
}

pub fn parse_run_image_tokens(
    run_xml: &str,
    context: &ParseContext<'_>,
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
