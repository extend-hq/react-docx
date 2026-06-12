use std::collections::HashSet;

use serde::Serialize;

use crate::model::{
    ImageCrop, ImageFloating, ImageHorizontalAlign, ImageRunNode, ImageRunNodeType,
    ImageVerticalAlign, ImageWrapText, ImageWrapType,
};
use crate::parse::colors::normalize_hex_color;
use crate::parse::re;
use crate::parse::context::ParseContext;
use crate::parse::relationships::{bytes_to_base64, content_type_for_part};
use crate::parse::shapes::{
    parse_text_box_layout, parse_text_box_paragraphs, render_standalone_word_shape_svg,
    render_text_box_svg,
};
use crate::parse::util::{
    clamp, clamp_i64, emu_to_pixels, escape_xml_text, is_windows_metafile_content_type,
    prefer_alternate_content_choice, rasterize_windows_metafile_to_png_data_uri, regex_capture,
    regex_capture_tag, svg_data_uri, to_image_horizontal_align, to_image_vertical_align,
    windows_metafile_to_svg_data_uri,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageDedupeKey<'a> {
    src: Option<&'a str>,
    content_type: Option<&'a str>,
    width_px: Option<f64>,
    height_px: Option<f64>,
    floating: Option<&'a ImageFloating>,
    synthetic_text_box: Option<bool>,
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
    let caps = re::get_unchecked(r"(?i)(-?[0-9]+(?:\.[0-9]+)?)\s*(px|pt|in|cm|mm)\b")
        .captures(value)?;
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

fn to_px_from_emu(value: Option<&str>) -> Option<f64> {
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
    let position_h_block =
        regex_capture(run_xml, r"(?is)(<wp:positionH\b[^>]*>[\s\S]*?</wp:positionH>)");
    let position_v_block =
        regex_capture(run_xml, r"(?is)(<wp:positionV\b[^>]*>[\s\S]*?</wp:positionV>)");
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
    let dist_l_px = to_px_from_emu(dist_l_raw.as_deref());
    let dist_r_px = to_px_from_emu(dist_r_raw.as_deref());
    let dist_t_px = to_px_from_emu(dist_t_raw.as_deref());
    let dist_b_px = to_px_from_emu(dist_b_raw.as_deref());
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
        behind_document: if behind_document {
            Some(true)
        } else {
            None
        },
        z_index,
    })
}

pub fn parse_drawing_image_css_filter(run_xml: &str) -> Option<String> {
    let mut filters = Vec::new();

    if re::get(r"(?i)<a14:artisticPastelsSmooth\b")
        .is_some_and(|re| re.is_match(run_xml))
    {
        filters.extend([
            "saturate(0.76)",
            "contrast(0.94)",
            "brightness(1.04)",
        ]);
    }

    let color_temperature_raw =
        regex_capture(run_xml, r#"(?i)<a14:colorTemperature\b[^>]*colorTemp="(\d+)""#);
    if let Some(raw) = color_temperature_raw.as_deref() {
        if let Ok(color_temperature) = raw.parse::<f64>() {
            if color_temperature.is_finite() {
                if color_temperature >= 9000.0 {
                    filters.extend(["hue-rotate(-6deg)", "saturate(1.04)"]);
                } else if color_temperature <= 4500.0 {
                    filters.extend(["sepia(0.1)", "saturate(1.02)"]);
                }
            }
        }
    }

    if re::get(r#"(?is)<a:duotone>[\s\S]*?<a:schemeClr\b[^>]*val="accent3""#)
        .is_some_and(|re| re.is_match(run_xml))
    {
        filters.extend([
            "grayscale(1)",
            "sepia(0.55)",
            "hue-rotate(35deg)",
            "saturate(1.55)",
            "brightness(0.9)",
        ]);
    }

    if filters.is_empty() {
        None
    } else {
        Some(filters.join(" "))
    }
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

    if has_crop { Some(crop) } else { None }
}

pub fn parse_vml_size(run_xml: &str) -> (Option<f64>, Option<f64>) {
    let shape_tag = regex_capture_tag(run_xml, r"(?i)<v:shape\b[^>]*>").unwrap_or_default();
    let style = get_attribute(&shape_tag, "style").unwrap_or_default();
    if style.is_empty() {
        return (None, None);
    }

    let width_match = re::get_unchecked(r"(?i)width:\s*([0-9.]+)\s*(px|pt|in|cm|mm)").captures(&style);
    let height_match = re::get_unchecked(r"(?i)height:\s*([0-9.]+)\s*(px|pt|in|cm|mm)").captures(&style);

    let width_px = width_match
        .as_ref()
        .and_then(|caps| {
            css_length_value_and_unit_to_pixels(caps.get(1)?.as_str(), caps.get(2)?.as_str())
        });
    let height_px = height_match
        .as_ref()
        .and_then(|caps| {
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
    let wrap_type = normalize_vml_wrap_type(declarations.get("mso-wrap-style").map(String::as_str));
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
        wrap_text: None,
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
        .map(|caps| decode_xml_entities(caps.get(1).map(|m| m.as_str()).unwrap_or("")).trim().to_string())
        .collect();
    if !values.is_empty() {
        return values;
    }

    let fallback_re = re::get_unchecked(r"(?is)<c:v>([\s\S]*?)</c:v>");
    fallback_re
        .captures_iter(xml)
        .map(|caps| decode_xml_entities(caps.get(1).map(|m| m.as_str()).unwrap_or("")).trim().to_string())
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
    if parsed.is_finite() { parsed } else { 0.0 }
}

fn parse_chart_data(chart_xml: &str) -> Option<ParsedChartData> {
    let kind = parse_chart_type(chart_xml)?;
    let series_blocks = extract_balanced_tag_blocks(chart_xml, "c:ser");
    let mut series = Vec::new();

    for (index, series_xml) in series_blocks.into_iter().enumerate() {
        let tx_block = regex_capture_tag(&series_xml, r"(?is)<c:tx\b[\s\S]*?</c:tx>")
            .unwrap_or_default();
        let name = parse_chart_points(&tx_block)
            .into_iter()
            .next()
            .unwrap_or_else(|| format!("Series {}", index + 1));
        let val_block = regex_capture_tag(&series_xml, r"(?is)<c:val\b[\s\S]*?</c:val>")
            .unwrap_or_default();
        let values = parse_chart_points(&val_block)
            .into_iter()
            .map(|value| parse_chart_number(&value))
            .collect::<Vec<_>>();
        let cat_block = regex_capture_tag(&series_xml, r"(?is)<c:cat\b[\s\S]*?</c:cat>")
            .unwrap_or_default();
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
    (
        cx + radius * radians.cos(),
        cy + radius * radians.sin(),
    )
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
    let values = base_series.map(|series| series.values.as_slice()).unwrap_or(&[]);
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
    let outer_radius = ((width_px.min(height_px) * 0.26).round() as i64)
        .clamp(30, 160) as f64;
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
        let large_arc_flag = if end_angle - start_angle > 180.0 { 1 } else { 0 };
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
    let width_px = extent_cx
        .as_deref()
        .and_then(|raw| emu_to_pixels(Some(raw)))
        .or(vml_size.0);
    let height_px = extent_cy
        .as_deref()
        .and_then(|raw| emu_to_pixels(Some(raw)))
        .or(vml_size.1);
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

pub fn parse_run_image_block(run_xml: &str, context: &ParseContext<'_>) -> Option<ImageRunNode> {
    let normalized_run_xml = prefer_alternate_content_choice(run_xml);
    let mut active_run_xml = normalized_run_xml.as_str();
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
    let contains_text_box_content = re::get_unchecked(r"(?i)<w:txbxContent\b").is_match(active_run_xml);

    if standalone_shape_svg.is_some()
        && (contains_grouped_or_standalone_shape || relationship_id.is_none())
    {
        return Some(ImageRunNode {
            r#type: ImageRunNodeType::Image,
            src: Some(svg_data_uri(standalone_shape_svg.as_deref().unwrap_or_default())),
            alt: Some(
                alt.unwrap_or_else(|| {
                    if contains_text_box_content {
                        "Text box".to_string()
                    } else {
                        "Shape".to_string()
                    }
                }),
            ),
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

        if let Some(chart_src) = chart_xml.and_then(|xml| {
            chart_xml_to_svg_data_uri(xml, width_px, height_px)
        }) {
            return Some(ImageRunNode {
                r#type: ImageRunNodeType::Image,
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

    Some(ImageRunNode {
        r#type: ImageRunNodeType::Image,
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
    let candidate_ranges = extract_balanced_tag_blocks_in_order(
        run_xml,
        &[
            "mc:AlternateContent",
            "w:drawing",
            "w:pict",
            "w:object",
        ],
    );
    let candidate_xml_blocks: Vec<&str> = if candidate_ranges.is_empty() {
        vec![run_xml]
    } else {
        candidate_ranges
            .iter()
            .map(|range| &run_xml[range.start..range.end])
            .collect()
    };

    let mut images = Vec::new();
    let mut seen_keys = HashSet::new();
    for candidate_xml in candidate_xml_blocks {
        let Some(image) = parse_run_image_block(candidate_xml, context) else {
            continue;
        };

        let dedupe_key = serde_json::to_string(&ImageDedupeKey {
            src: image.src.as_deref(),
            content_type: image.content_type.as_deref(),
            width_px: image.width_px,
            height_px: image.height_px,
            floating: image.floating.as_ref(),
            synthetic_text_box: image.synthetic_text_box,
        })
        .unwrap_or_default();

        if !seen_keys.insert(dedupe_key) {
            continue;
        }
        images.push(image);
    }

    images
}
