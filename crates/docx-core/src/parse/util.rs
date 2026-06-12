use std::collections::HashMap;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use crate::model::{
    ImageHorizontalAlign, ImageVerticalAlign, ParagraphAlignment, ParagraphBorderSet,
    ParagraphBorderStyle, ParagraphIndent, ParagraphLineRule, ParagraphSpacing,
    ParagraphTabStop, ParagraphTabStopAlignment, ParagraphTabStopLeader, TableBorderSet,
    TableBorderStyle, TextRunBorderStyle, TextStyle,
};
use crate::package::OoxmlPart;
use crate::parse::context::{ContentTypeLookup, ThemeColorMap, ThemeFontMap};
use crate::parse::re;
use crate::xml::{
    decode_xml_entities, extract_balanced_tag_blocks, get_attribute, normalize_alignment,
    parse_integer_attribute, parse_on_off_attribute,
};

pub fn regex_capture(xml: &str, pattern: &str) -> Option<String> {
    re::get(pattern)?
        .captures(xml)
        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
}

pub fn regex_capture_tag(xml: &str, pattern: &str) -> Option<String> {
    re::get(pattern)?
        .find(xml)
        .map(|m| m.as_str().to_string())
}

pub fn normalize_hex_color(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() || value.eq_ignore_ascii_case("auto") {
        return None;
    }

    if re::get(r"^[0-9a-fA-F]{6}$")?.is_match(value) {
        return Some(format!("#{value}"));
    }

    if re::get(r"^[0-9a-fA-F]{3}$")?.is_match(value) {
        let expanded: String = value.chars().flat_map(|c| [c, c]).collect();
        return Some(format!("#{expanded}"));
    }

    if re::get(r"^#[0-9a-fA-F]{6}$")?.is_match(value) {
        return Some(value.to_string());
    }

    None
}

pub fn emu_to_pixels(value: Option<&str>) -> Option<f64> {
    let value = value?;
    if value.is_empty() {
        return None;
    }
    let parsed: f64 = value.parse().ok()?;
    if !parsed.is_finite() {
        return None;
    }
    Some(((parsed / 9525.0) * 1000.0).round() / 1000.0)
}

pub fn emu_to_pixels_i64(value: Option<i64>) -> Option<f64> {
    value.and_then(|v| emu_to_pixels(Some(&v.to_string())))
}

pub fn to_model_alignment(raw: Option<&str>) -> Option<ParagraphAlignment> {
    match normalize_alignment(raw)? {
        "left" => Some(ParagraphAlignment::Left),
        "center" => Some(ParagraphAlignment::Center),
        "right" => Some(ParagraphAlignment::Right),
        "justify" => Some(ParagraphAlignment::Justify),
        _ => None,
    }
}

pub fn normalize_heading_level(value: Option<&str>) -> Option<crate::model::HeadingLevel> {
    let value = value?;
    let caps = re::get(r"(?i)heading\s*([1-6])")?.captures(value)?;
    let level: i64 = caps.get(1)?.as_str().parse().ok()?;
    match level {
        1 => Some(crate::model::HeadingLevel::One),
        2 => Some(crate::model::HeadingLevel::Two),
        3 => Some(crate::model::HeadingLevel::Three),
        4 => Some(crate::model::HeadingLevel::Four),
        5 => Some(crate::model::HeadingLevel::Five),
        6 => Some(crate::model::HeadingLevel::Six),
        _ => None,
    }
}

pub fn prefer_alternate_content_choice(xml: &str) -> String {
    if !xml.contains("<mc:AlternateContent") {
        return xml.to_string();
    }

    let re = re::get_unchecked(r"(?is)<mc:AlternateContent\b[\s\S]*?</mc:AlternateContent>");
    re.replace_all(xml, |caps: &regex_lite::Captures| {
        let alternate_xml = &caps[0];
        let choice_re = re::get_unchecked(r"(?is)<mc:Choice\b[\s\S]*?</mc:Choice>");
        let Some(choice_xml) = choice_re.find(alternate_xml) else {
            return alternate_xml.to_string();
        };
        let choice = choice_xml.as_str();
        let without_open = re::get_unchecked(r"(?i)<mc:Choice\b[^>]*>")
            .replace(choice, "")
            .to_string();
        re::get_unchecked(r"(?i)</mc:Choice>")
            .replace(&without_open, "")
            .to_string()
    })
    .to_string()
}

pub fn resolve_style_properties_block(style_xml: &str, tag_name: &str) -> String {
    let balanced = extract_balanced_tag_blocks(style_xml, tag_name)
        .into_iter()
        .next();
    if let Some(balanced) = balanced {
        return balanced;
    }

    regex_capture_tag(style_xml, &format!(r"(?i)<{tag_name}\b[^>]*/?>"))
        .unwrap_or_default()
}

pub fn merge_text_styles(styles: &[Option<TextStyle>]) -> Option<TextStyle> {
    let mut merged = TextStyle {
        bold: None,
        italic: None,
        underline: None,
        strike: None,
        color: None,
        highlight: None,
        background_color: None,
        font_size_pt: None,
        font_family: None,
        character_spacing_twips: None,
        vertical_align: None,
        run_border: None,
    };
    let mut has_any = false;

    for style in styles.iter().flatten() {
        has_any = true;
        if style.bold.is_some() {
            merged.bold = style.bold;
        }
        if style.italic.is_some() {
            merged.italic = style.italic;
        }
        if style.underline.is_some() {
            merged.underline = style.underline;
        }
        if style.strike.is_some() {
            merged.strike = style.strike;
        }
        if style.color.is_some() {
            merged.color = style.color.clone();
        }
        if style.highlight.is_some() {
            merged.highlight = style.highlight.clone();
        }
        if style.background_color.is_some() {
            merged.background_color = style.background_color.clone();
        }
        if style.font_size_pt.is_some() {
            merged.font_size_pt = style.font_size_pt;
        }
        if style.font_family.is_some() {
            merged.font_family = style.font_family.clone();
        }
        if style.character_spacing_twips.is_some() {
            merged.character_spacing_twips = style.character_spacing_twips;
        }
        if style.vertical_align.is_some() {
            merged.vertical_align = style.vertical_align;
        }
        if let Some(ref border) = style.run_border {
            merged.run_border = Some(border.clone());
        }
    }

    if has_any {
        Some(merged)
    } else {
        None
    }
}

pub fn merge_paragraph_spacing(
    inherited: Option<&ParagraphSpacing>,
    direct: Option<&ParagraphSpacing>,
) -> Option<ParagraphSpacing> {
    if inherited.is_none() && direct.is_none() {
        return None;
    }
    let merged = ParagraphSpacing {
        before_twips: direct
            .and_then(|d| d.before_twips)
            .or(inherited.and_then(|i| i.before_twips)),
        after_twips: direct
            .and_then(|d| d.after_twips)
            .or(inherited.and_then(|i| i.after_twips)),
        line_twips: direct
            .and_then(|d| d.line_twips)
            .or(inherited.and_then(|i| i.line_twips)),
        line_rule: direct
            .and_then(|d| d.line_rule)
            .or(inherited.and_then(|i| i.line_rule)),
    };
    if merged.before_twips.is_none()
        && merged.after_twips.is_none()
        && merged.line_twips.is_none()
        && merged.line_rule.is_none()
    {
        return None;
    }
    Some(merged)
}

pub fn merge_paragraph_indent(
    inherited: Option<&ParagraphIndent>,
    direct: Option<&ParagraphIndent>,
) -> Option<ParagraphIndent> {
    if inherited.is_none() && direct.is_none() {
        return None;
    }
    let merged = ParagraphIndent {
        left_twips: direct
            .and_then(|d| d.left_twips)
            .or(inherited.and_then(|i| i.left_twips)),
        right_twips: direct
            .and_then(|d| d.right_twips)
            .or(inherited.and_then(|i| i.right_twips)),
        first_line_twips: direct
            .and_then(|d| d.first_line_twips)
            .or(inherited.and_then(|i| i.first_line_twips)),
        hanging_twips: direct
            .and_then(|d| d.hanging_twips)
            .or(inherited.and_then(|i| i.hanging_twips)),
    };
    if merged.left_twips.is_none()
        && merged.right_twips.is_none()
        && merged.first_line_twips.is_none()
        && merged.hanging_twips.is_none()
    {
        return None;
    }
    Some(merged)
}

pub fn merge_paragraph_boolean(inherited: Option<bool>, direct: Option<bool>) -> Option<bool> {
    direct.or(inherited)
}

pub fn merge_paragraph_border_style(
    inherited: Option<&ParagraphBorderStyle>,
    direct: Option<&ParagraphBorderStyle>,
) -> Option<ParagraphBorderStyle> {
    if inherited.is_none() && direct.is_none() {
        return None;
    }
    let border_type = direct
        .map(|d| d.border_type.clone())
        .or_else(|| inherited.map(|i| i.border_type.clone()))?;
    Some(ParagraphBorderStyle {
        border_type,
        color: direct
            .and_then(|d| d.color.clone())
            .or_else(|| inherited.and_then(|i| i.color.clone())),
        size_eighth_pt: direct
            .and_then(|d| d.size_eighth_pt)
            .or(inherited.and_then(|i| i.size_eighth_pt)),
        space_pt: direct
            .and_then(|d| d.space_pt)
            .or(inherited.and_then(|i| i.space_pt)),
        frame: direct.and_then(|d| d.frame).or(inherited.and_then(|i| i.frame)),
        shadow: direct
            .and_then(|d| d.shadow)
            .or(inherited.and_then(|i| i.shadow)),
    })
}

pub fn merge_paragraph_border_sets(
    inherited: Option<&ParagraphBorderSet>,
    direct: Option<&ParagraphBorderSet>,
) -> Option<ParagraphBorderSet> {
    if inherited.is_none() && direct.is_none() {
        return None;
    }
    let merged = ParagraphBorderSet {
        top: merge_paragraph_border_style(inherited.and_then(|i| i.top.as_ref()), direct.and_then(|d| d.top.as_ref())),
        right: merge_paragraph_border_style(inherited.and_then(|i| i.right.as_ref()), direct.and_then(|d| d.right.as_ref())),
        bottom: merge_paragraph_border_style(inherited.and_then(|i| i.bottom.as_ref()), direct.and_then(|d| d.bottom.as_ref())),
        left: merge_paragraph_border_style(inherited.and_then(|i| i.left.as_ref()), direct.and_then(|d| d.left.as_ref())),
        between: merge_paragraph_border_style(inherited.and_then(|i| i.between.as_ref()), direct.and_then(|d| d.between.as_ref())),
        bar: merge_paragraph_border_style(inherited.and_then(|i| i.bar.as_ref()), direct.and_then(|d| d.bar.as_ref())),
    };
    if merged.top.is_none()
        && merged.right.is_none()
        && merged.bottom.is_none()
        && merged.left.is_none()
        && merged.between.is_none()
        && merged.bar.is_none()
    {
        return None;
    }
    Some(merged)
}

pub fn merge_paragraph_tab_stops(
    inherited: Option<&[ParagraphTabStop]>,
    direct: Option<&[ParagraphTabStop]>,
) -> Option<Vec<ParagraphTabStop>> {
    if inherited.is_none() && direct.is_none() {
        return None;
    }
    let mut by_position: HashMap<i64, ParagraphTabStop> = HashMap::new();
    for stop in inherited.unwrap_or(&[]) {
        if let Some(pos) = stop.position_twips {
            by_position.insert(pos, stop.clone());
        }
    }
    for stop in direct.unwrap_or(&[]) {
        if let Some(pos) = stop.position_twips {
            by_position.insert(pos, stop.clone());
        }
    }
    if by_position.is_empty() {
        return None;
    }
    let mut combined: Vec<_> = by_position.into_values().collect();
    combined.sort_by_key(|s| s.position_twips.unwrap_or(0));
    Some(combined)
}

pub fn merge_table_border_sets(
    inherited: Option<&TableBorderSet>,
    direct: Option<&TableBorderSet>,
) -> Option<TableBorderSet> {
    if inherited.is_none() && direct.is_none() {
        return None;
    }
    let merged = TableBorderSet {
        top: direct.and_then(|d| d.top.clone()).or_else(|| inherited.and_then(|i| i.top.clone())),
        right: direct.and_then(|d| d.right.clone()).or_else(|| inherited.and_then(|i| i.right.clone())),
        bottom: direct.and_then(|d| d.bottom.clone()).or_else(|| inherited.and_then(|i| i.bottom.clone())),
        left: direct.and_then(|d| d.left.clone()).or_else(|| inherited.and_then(|i| i.left.clone())),
        inside_h: direct.and_then(|d| d.inside_h.clone()).or_else(|| inherited.and_then(|i| i.inside_h.clone())),
        inside_v: direct.and_then(|d| d.inside_v.clone()).or_else(|| inherited.and_then(|i| i.inside_v.clone())),
        tl2br: direct.and_then(|d| d.tl2br.clone()).or_else(|| inherited.and_then(|i| i.tl2br.clone())),
        tr2bl: direct.and_then(|d| d.tr2bl.clone()).or_else(|| inherited.and_then(|i| i.tr2bl.clone())),
    };
    if merged.top.is_none()
        && merged.right.is_none()
        && merged.bottom.is_none()
        && merged.left.is_none()
        && merged.inside_h.is_none()
        && merged.inside_v.is_none()
        && merged.tl2br.is_none()
        && merged.tr2bl.is_none()
    {
        return None;
    }
    Some(merged)
}

pub fn on_off_value_to_boolean(value: Option<&str>) -> Option<bool> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }
    let normalized = value.to_ascii_lowercase();
    if ["0", "false", "off", "no"].contains(&normalized.as_str()) {
        return Some(false);
    }
    Some(true)
}

pub fn decode_xml_attribute(value: Option<&str>) -> Option<String> {
    value.map(decode_xml_entities)
}

pub fn decode_hex_code_point(value: Option<&str>) -> Option<String> {
    let value = value?.trim().trim_start_matches("0x").trim_start_matches("0X");
    if value.is_empty() || !value.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let code_point = i32::from_str_radix(value, 16).ok()?;
    if code_point <= 0 {
        return None;
    }
    char::from_u32(code_point as u32).map(|c| c.to_string())
}

pub fn parse_on_off_tag_value(tag_xml: Option<&str>, attributes: &[&str]) -> Option<bool> {
    let tag_xml = tag_xml?;
    for attribute in attributes {
        if let Some(raw) = get_attribute(tag_xml, attribute) {
            return on_off_value_to_boolean(Some(&raw));
        }
    }
    Some(true)
}

pub fn clamp(value: f64, minimum: f64, maximum: f64) -> f64 {
    value.max(minimum).min(maximum)
}

pub fn clamp_i64(value: i64, minimum: i64, maximum: i64) -> i64 {
    value.max(minimum).min(maximum)
}

pub fn escape_xml_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub fn svg_data_uri(svg: &str) -> String {
    format!(
        "data:image/svg+xml;charset=utf-8,{}",
        urlencoding_like(svg)
    )
}

fn urlencoding_like(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

pub fn bytes_to_base64(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

pub fn extension_from_part_name(part_name: &str) -> Option<String> {
    let last_dot = part_name.rfind('.')?;
    if last_dot == part_name.len() - 1 {
        return None;
    }
    Some(part_name[last_dot + 1..].to_ascii_lowercase())
}

pub fn content_type_for_part(part_name: &str, content_types: &ContentTypeLookup) -> Option<String> {
    if let Some(override_type) = content_types
        .override_by_part_name
        .get(part_name)
        .or_else(|| content_types.override_by_part_name.get(&format!("/{part_name}")))
    {
        return Some(override_type.clone());
    }
    let extension = extension_from_part_name(part_name)?;
    let mime_by_extension: HashMap<&str, &str> = [
        ("png", "image/png"),
        ("jpg", "image/jpeg"),
        ("jpeg", "image/jpeg"),
        ("gif", "image/gif"),
        ("bmp", "image/bmp"),
        ("wmf", "image/wmf"),
        ("emf", "image/emf"),
        ("webp", "image/webp"),
        ("svg", "image/svg+xml"),
    ]
    .into_iter()
    .collect();
    content_types
        .default_by_extension
        .get(&extension)
        .cloned()
        .or_else(|| mime_by_extension.get(extension.as_str()).map(|s| (*s).to_string()))
}

pub fn resolve_part_path(base_part_name: &str, target: &str) -> String {
    if target.is_empty() {
        return String::new();
    }
    if re::get_unchecked(r"(?i)^[a-z][a-z0-9+.-]*:").is_match(target) || target.starts_with('#')
    {
        return target.to_string();
    }
    if target.starts_with('/') {
        return target[1..].to_string();
    }
    let mut output: Vec<&str> = base_part_name.split('/').collect();
    output.pop();
    for segment in target.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            output.pop();
            continue;
        }
        output.push(segment);
    }
    output.join("/")
}

pub fn relationship_part_name_for_part(part_name: &str) -> String {
    let mut segments: Vec<&str> = part_name.split('/').collect();
    let file_name = segments.pop().unwrap_or("");
    let folder = segments.join("/");
    if folder.is_empty() {
        format!("_rels/{file_name}.rels")
    } else {
        format!("{folder}/_rels/{file_name}.rels")
    }
}

pub fn parse_relationships_from_parts(
    parts: &HashMap<String, OoxmlPart>,
    part_name: &str,
) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let relationships_part_name = relationship_part_name_for_part(part_name);
    let Some(relationships_part) = parts.get(&relationships_part_name) else {
        return map;
    };
    let re = re::get_unchecked(r"(?i)<Relationship\b[^>]*>");
    for mat in re.find_iter(&relationships_part.content) {
        let tag = mat.as_str();
        let Some(id) = get_attribute(tag, "Id") else { continue };
        let Some(target) = get_attribute(tag, "Target") else { continue };
        map.insert(id, resolve_part_path(part_name, &target));
    }
    map
}

pub fn is_windows_metafile_content_type(content_type: Option<&str>, part_name: Option<&str>) -> bool {
    if let Some(normalized) = content_type.map(|value| value.trim().to_ascii_lowercase()) {
        if matches!(
            normalized.as_str(),
            "image/wmf"
                | "image/x-wmf"
                | "application/x-wmf"
                | "image/emf"
                | "image/x-emf"
                | "application/x-emf"
        ) {
            return true;
        }
    }
    matches!(
        part_name.and_then(extension_from_part_name).as_deref(),
        Some("wmf" | "emf")
    )
}

pub fn rasterize_windows_metafile_to_png_data_uri(_bytes: &[u8], _part_name: Option<&str>) -> Option<String> {
    None
}

/// Converts vector EMF assets to an SVG data URI. WMF and EMFs containing
/// unsupported records (text, raster blits, ...) return `None` so the caller
/// keeps the unsupported-image placeholder.
pub fn windows_metafile_to_svg_data_uri(bytes: &[u8]) -> Option<String> {
    crate::emf::emf_to_svg(bytes).map(|svg| svg_data_uri(&svg))
}

pub fn resolve_theme_font(theme_token: Option<&str>, theme_fonts: &ThemeFontMap) -> Option<String> {
    let theme_token = theme_token?;
    let normalized = theme_token.to_ascii_lowercase();
    if normalized.starts_with("major") {
        if normalized.contains("eastasia") {
            return theme_fonts
                .major_east_asia
                .clone()
                .or_else(|| theme_fonts.major_latin.clone());
        }
        if normalized.contains("bidi") || normalized.contains("cs") {
            return theme_fonts
                .major_complex_script
                .clone()
                .or_else(|| theme_fonts.major_latin.clone());
        }
        return theme_fonts.major_latin.clone();
    }
    if normalized.starts_with("minor") {
        if normalized.contains("eastasia") {
            return theme_fonts
                .minor_east_asia
                .clone()
                .or_else(|| theme_fonts.minor_latin.clone());
        }
        if normalized.contains("bidi") || normalized.contains("cs") {
            return theme_fonts
                .minor_complex_script
                .clone()
                .or_else(|| theme_fonts.minor_latin.clone());
        }
        return theme_fonts.minor_latin.clone();
    }
    None
}

pub fn default_drawing_scheme_colors() -> ThemeColorMap {
    [
        ("bg1", "#ffffff"),
        ("bg2", "#f3f4f6"),
        ("tx1", "#000000"),
        ("tx2", "#1f2937"),
        ("dk1", "#000000"),
        ("dk2", "#1f2937"),
        ("lt1", "#ffffff"),
        ("lt2", "#f3f4f6"),
        ("accent1", "#4472c4"),
        ("accent2", "#ed7d31"),
        ("accent3", "#70ad47"),
        ("accent4", "#5b9bd5"),
        ("accent5", "#7030a0"),
        ("accent6", "#ffc000"),
        ("hlink", "#0563c1"),
        ("folhlink", "#954f72"),
        ("followedhyperlink", "#954f72"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect()
}

pub fn resolve_drawing_color_from_xml(
    color_xml: Option<&str>,
    theme_colors: &ThemeColorMap,
) -> Option<(String, Option<f64>)> {
    let color_xml = color_xml?;
    let srgb = normalize_hex_color(regex_capture(color_xml, r#"(?i)<a:srgbClr\b[^>]*val="([^"]+)""#).as_deref());
    let sys = normalize_hex_color(regex_capture(color_xml, r#"(?i)<a:sysClr\b[^>]*lastClr="([^"]+)""#).as_deref());
    let scheme_token = regex_capture(color_xml, r#"(?i)<a:schemeClr\b[^>]*val="([^"]+)""#)
        .map(|t| t.trim().to_ascii_lowercase());
    let scheme = scheme_token.as_ref().and_then(|token| {
        theme_colors
            .get(token)
            .cloned()
            .or_else(|| default_drawing_scheme_colors().get(token).cloned())
    });
    let color = srgb.or(sys).or(scheme)?;
    let alpha_raw = regex_capture(color_xml, r#"(?i)<a:alpha\b[^>]*val="(\d+)""#);
    let opacity = alpha_raw.and_then(|raw| {
        let alpha: f64 = raw.parse().ok()?;
        if alpha >= 0.0 {
            Some((alpha / 100_000.0).clamp(0.0, 1.0))
        } else {
            None
        }
    });
    Some((color, opacity))
}

pub fn parse_paragraph_spacing_from_xml(xml: &str) -> Option<ParagraphSpacing> {
    if xml.is_empty() {
        return None;
    }
    let spacing_tag = regex_capture_tag(xml, r"(?i)<w:spacing\b[^>]*/?>")?;
    let line_rule_raw = get_attribute(&spacing_tag, "w:lineRule")
        .map(|v| v.to_ascii_lowercase());
    let line_rule = match line_rule_raw.as_deref() {
        Some("auto") => Some(ParagraphLineRule::Auto),
        Some("exact") => Some(ParagraphLineRule::Exact),
        Some("atleast") => Some(ParagraphLineRule::AtLeast),
        _ => None,
    };
    let spacing = ParagraphSpacing {
        before_twips: parse_integer_attribute(&spacing_tag, "w:before"),
        after_twips: parse_integer_attribute(&spacing_tag, "w:after"),
        line_twips: parse_integer_attribute(&spacing_tag, "w:line"),
        line_rule,
    };
    if spacing.before_twips.is_none()
        && spacing.after_twips.is_none()
        && spacing.line_twips.is_none()
        && spacing.line_rule.is_none()
    {
        return None;
    }
    Some(spacing)
}

pub fn parse_paragraph_indent_from_xml(xml: &str) -> Option<ParagraphIndent> {
    if xml.is_empty() {
        return None;
    }
    let indent_tag = regex_capture_tag(xml, r"(?i)<w:ind\b[^>]*/?>")?;
    let indent = ParagraphIndent {
        left_twips: parse_integer_attribute(&indent_tag, "w:left"),
        right_twips: parse_integer_attribute(&indent_tag, "w:right"),
        first_line_twips: parse_integer_attribute(&indent_tag, "w:firstLine"),
        hanging_twips: parse_integer_attribute(&indent_tag, "w:hanging"),
    };
    if indent.left_twips.is_none()
        && indent.right_twips.is_none()
        && indent.first_line_twips.is_none()
        && indent.hanging_twips.is_none()
    {
        return None;
    }
    Some(indent)
}

pub fn parse_paragraph_shading_from_xml(xml: &str) -> Option<String> {
    if xml.is_empty() {
        return None;
    }
    let shading_tag = regex_capture_tag(xml, r"(?i)<w:shd\b[^>]*/?>")?;
    normalize_hex_color(get_attribute(&shading_tag, "w:fill").as_deref())
}

pub fn parse_text_run_border_style(tag_xml: Option<&str>) -> Option<TextRunBorderStyle> {
    let tag_xml = tag_xml?;
    let border_type = get_attribute(tag_xml, "w:val")?.trim().to_ascii_lowercase();
    if border_type.is_empty() {
        return None;
    }
    let size_eighth_pt = parse_integer_attribute(tag_xml, "w:sz").map(|v| v as f64);
    let space_pt = parse_integer_attribute(tag_xml, "w:space").map(|v| v as f64);
    let raw_color = get_attribute(tag_xml, "w:color");
    let color = if raw_color.as_deref().map(|c| c.eq_ignore_ascii_case("auto")).unwrap_or(false) {
        None
    } else {
        normalize_hex_color(raw_color.as_deref())
    };
    let frame = get_attribute(tag_xml, "w:frame")
        .as_deref()
        .and_then(|value| on_off_value_to_boolean(Some(value)));
    let shadow = get_attribute(tag_xml, "w:shadow")
        .as_deref()
        .and_then(|value| on_off_value_to_boolean(Some(value)));
    Some(TextRunBorderStyle {
        border_type,
        color,
        size_eighth_pt: size_eighth_pt.filter(|v| *v >= 0.0),
        space_pt: space_pt.filter(|v| *v >= 0.0),
        frame,
        shadow,
    })
}

pub fn parse_paragraph_border_style(tag_xml: Option<&str>) -> Option<ParagraphBorderStyle> {
    let tag_xml = tag_xml?;
    let border_type = get_attribute(tag_xml, "w:val")?.trim().to_ascii_lowercase();
    if border_type.is_empty() {
        return None;
    }
    let size_eighth_pt = parse_integer_attribute(tag_xml, "w:sz").map(|v| v as f64);
    let space_pt = parse_integer_attribute(tag_xml, "w:space").map(|v| v as f64);
    let raw_color = get_attribute(tag_xml, "w:color");
    let color = if raw_color.as_deref().map(|c| c.eq_ignore_ascii_case("auto")).unwrap_or(false) {
        Some("#000000".to_string())
    } else {
        normalize_hex_color(raw_color.as_deref())
    };
    let frame = get_attribute(tag_xml, "w:frame")
        .as_deref()
        .and_then(|value| on_off_value_to_boolean(Some(value)));
    let shadow = get_attribute(tag_xml, "w:shadow")
        .as_deref()
        .and_then(|value| on_off_value_to_boolean(Some(value)));
    Some(ParagraphBorderStyle {
        border_type,
        color,
        size_eighth_pt: size_eighth_pt.filter(|v| *v >= 0.0),
        space_pt: space_pt.filter(|v| *v >= 0.0),
        frame,
        shadow,
    })
}

pub fn parse_paragraph_border_set_from_xml(xml: &str) -> Option<ParagraphBorderSet> {
    if xml.is_empty() {
        return None;
    }
    let paragraph_border_xml = extract_balanced_tag_blocks(xml, "w:pBdr")
        .into_iter()
        .next()
        .or_else(|| regex_capture_tag(xml, r"(?i)<w:pBdr\b[^>]*/?>"))?;
    if paragraph_border_xml.is_empty() {
        return None;
    }
    let top = parse_paragraph_border_style(regex_capture_tag(&paragraph_border_xml, r"(?i)<w:top\b[^>]*/?>").as_deref());
    let right = parse_paragraph_border_style(regex_capture_tag(&paragraph_border_xml, r"(?i)<w:right\b[^>]*/?>").as_deref());
    let bottom = parse_paragraph_border_style(regex_capture_tag(&paragraph_border_xml, r"(?i)<w:bottom\b[^>]*/?>").as_deref());
    let left = parse_paragraph_border_style(regex_capture_tag(&paragraph_border_xml, r"(?i)<w:left\b[^>]*/?>").as_deref());
    let between = parse_paragraph_border_style(regex_capture_tag(&paragraph_border_xml, r"(?i)<w:between\b[^>]*/?>").as_deref());
    let bar = parse_paragraph_border_style(regex_capture_tag(&paragraph_border_xml, r"(?i)<w:bar\b[^>]*/?>").as_deref());
    if top.is_none() && right.is_none() && bottom.is_none() && left.is_none() && between.is_none() && bar.is_none() {
        return None;
    }
    Some(ParagraphBorderSet { top, right, bottom, left, between, bar })
}

pub fn parse_table_border_style(tag_xml: Option<&str>) -> Option<TableBorderStyle> {
    let tag_xml = tag_xml?;
    let border_type = get_attribute(tag_xml, "w:val")?.trim().to_ascii_lowercase();
    if border_type.is_empty() {
        return None;
    }
    let size_eighth_pt = parse_integer_attribute(tag_xml, "w:sz").map(|v| v as f64);
    let raw_color = get_attribute(tag_xml, "w:color");
    let color = if raw_color.as_deref().map(|c| c.eq_ignore_ascii_case("auto")).unwrap_or(false) {
        Some("#000000".to_string())
    } else {
        normalize_hex_color(raw_color.as_deref())
    };
    Some(TableBorderStyle {
        border_type,
        color,
        size_eighth_pt: size_eighth_pt.filter(|v| *v >= 0.0),
    })
}

pub fn parse_table_border_set(xml: &str) -> Option<TableBorderSet> {
    let top = parse_table_border_style(regex_capture_tag(xml, r"(?i)<w:top\b[^>]*/?>").as_deref());
    let right = parse_table_border_style(regex_capture_tag(xml, r"(?i)<w:right\b[^>]*/?>").as_deref());
    let bottom = parse_table_border_style(regex_capture_tag(xml, r"(?i)<w:bottom\b[^>]*/?>").as_deref());
    let left = parse_table_border_style(regex_capture_tag(xml, r"(?i)<w:left\b[^>]*/?>").as_deref());
    let inside_h = parse_table_border_style(regex_capture_tag(xml, r"(?i)<w:insideH\b[^>]*/?>").as_deref());
    let inside_v = parse_table_border_style(regex_capture_tag(xml, r"(?i)<w:insideV\b[^>]*/?>").as_deref());
    let tl2br = parse_table_border_style(regex_capture_tag(xml, r"(?i)<w:tl2br\b[^>]*/?>").as_deref());
    let tr2bl = parse_table_border_style(regex_capture_tag(xml, r"(?i)<w:tr2bl\b[^>]*/?>").as_deref());
    if top.is_none() && right.is_none() && bottom.is_none() && left.is_none()
        && inside_h.is_none() && inside_v.is_none() && tl2br.is_none() && tr2bl.is_none()
    {
        return None;
    }
    Some(TableBorderSet { top, right, bottom, left, inside_h, inside_v, tl2br, tr2bl })
}

pub fn normalize_tab_stop_alignment(value: Option<&str>) -> Option<ParagraphTabStopAlignment> {
    match value?.to_ascii_lowercase().as_str() {
        "left" => Some(ParagraphTabStopAlignment::Left),
        "center" => Some(ParagraphTabStopAlignment::Center),
        "right" => Some(ParagraphTabStopAlignment::Right),
        "decimal" => Some(ParagraphTabStopAlignment::Decimal),
        "bar" => Some(ParagraphTabStopAlignment::Bar),
        _ => None,
    }
}

pub fn normalize_tab_stop_leader(value: Option<&str>) -> Option<ParagraphTabStopLeader> {
    match value? {
        "none" => Some(ParagraphTabStopLeader::LeaderNone),
        "dot" => Some(ParagraphTabStopLeader::Dot),
        "hyphen" => Some(ParagraphTabStopLeader::Hyphen),
        "underscore" => Some(ParagraphTabStopLeader::Underscore),
        "middleDot" => Some(ParagraphTabStopLeader::MiddleDot),
        _ => None,
    }
}

pub fn parse_paragraph_tab_stops_from_xml(xml: &str) -> Vec<ParagraphTabStop> {
    if xml.is_empty() {
        return Vec::new();
    }
    let tabs_tag = regex_capture_tag(
        xml,
        r"(?is)<w:tabs\b[^>]*>[\s\S]*?</w:tabs>|<w:tabs\b[^>]*/>",
    )
    .unwrap_or_default();
    if tabs_tag.is_empty() {
        return Vec::new();
    }
    let re = re::get_unchecked(r"(?i)<w:tab\b[^>]*/>");
    let mut tab_stops = Vec::new();
    for mat in re.find_iter(&tabs_tag) {
        let tab_tag = mat.as_str();
        let Some(position_twips) = parse_integer_attribute(tab_tag, "w:pos") else {
            continue;
        };
        tab_stops.push(ParagraphTabStop {
            alignment: normalize_tab_stop_alignment(get_attribute(tab_tag, "w:val").as_deref())
                .or(Some(ParagraphTabStopAlignment::Left)),
            leader: normalize_tab_stop_leader(get_attribute(tab_tag, "w:leader").as_deref())
                .or(Some(ParagraphTabStopLeader::LeaderNone)),
            position_twips: Some(position_twips),
        });
    }
    tab_stops.sort_by_key(|s| s.position_twips.unwrap_or(0));
    tab_stops
}

pub fn parse_paragraph_numbering_from_xml(xml: &str) -> Option<crate::model::ParagraphNumbering> {
    if xml.is_empty() {
        return None;
    }
    let numbering_xml = extract_balanced_tag_blocks(xml, "w:numPr")
        .into_iter()
        .next()
        .or_else(|| regex_capture_tag(xml, r"(?i)<w:numPr\b[^>]*/?>"))?;
    if numbering_xml.is_empty() {
        return None;
    }
    let num_id_raw = regex_capture(&numbering_xml, r#"(?i)<w:numId\b[^>]*w:val="(-?\d+)""#)?;
    let num_id: i64 = num_id_raw.parse().ok()?;
    if num_id <= 0 {
        return None;
    }
    let ilvl_raw = regex_capture(&numbering_xml, r#"(?i)<w:ilvl\b[^>]*w:val="(-?\d+)""#);
    let ilvl_value: i64 = ilvl_raw.and_then(|v| v.parse().ok()).unwrap_or(0);
    Some(crate::model::ParagraphNumbering {
        num_id,
        ilvl: ilvl_value.max(0),
    })
}

pub fn to_image_horizontal_align(raw: Option<&str>) -> Option<ImageHorizontalAlign> {
    match raw? {
        "left" => Some(ImageHorizontalAlign::Left),
        "center" => Some(ImageHorizontalAlign::Center),
        "right" => Some(ImageHorizontalAlign::Right),
        "inside" => Some(ImageHorizontalAlign::Inside),
        "outside" => Some(ImageHorizontalAlign::Outside),
        _ => None,
    }
}

pub fn to_image_vertical_align(raw: Option<&str>) -> Option<ImageVerticalAlign> {
    match raw? {
        "top" => Some(ImageVerticalAlign::Top),
        "center" => Some(ImageVerticalAlign::Center),
        "bottom" => Some(ImageVerticalAlign::Bottom),
        "inside" => Some(ImageVerticalAlign::Inside),
        "outside" => Some(ImageVerticalAlign::Outside),
        _ => None,
    }
}

pub fn strip_text_box_content(xml: &str) -> String {
    let re = re::get_unchecked(r"(?is)<w:txbxContent\b[\s\S]*?</w:txbxContent>");
    re.replace_all(xml, "").to_string()
}

pub fn normalize_legacy_form_display_value(value: Option<&str>) -> Option<String> {
    let value = value?;
    let normalized = value
        .replace('\u{2002}', " ")
        .replace('\u{2003}', " ")
        .replace('\u{00a0}', " ");
    if normalized.trim().is_empty() {
        None
    } else {
        Some(normalized)
    }
}
