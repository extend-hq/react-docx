//! DOCX serializer ported from `packages/serializer/src/index.ts`.

use std::collections::HashMap;

use crate::model::*;
use crate::package::{with_part, OoxmlPackage, OoxmlPart};
use crate::zip::{create_minimal_docx_package, package_to_bytes};

const REL_TYPE_IMAGE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const REL_TYPE_HYPERLINK: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const RELS_XMLNS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
const WORD_MAIN_NS: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const OFFICE_REL_NS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const DRAWING_MAIN_NS: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
const DRAWING_WORD_NS: &str =
    "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const DRAWING_PICTURE_NS: &str = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const WORD_2010_NS: &str = "http://schemas.microsoft.com/office/word/2010/wordml";
const MARKUP_COMPATIBILITY_NS: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";

const DEFAULT_SECTION_PROPERTIES_XML: &str = r#"<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>"#;

const MIME_BY_EXTENSION: &[(&str, &str)] = &[
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("bmp", "image/bmp"),
    ("webp", "image/webp"),
    ("svg", "image/svg+xml"),
];

const HIGHLIGHT_TO_WORD: &[(&str, &str)] = &[
    ("#ffff00", "yellow"),
    ("#ff0000", "red"),
    ("#00ff00", "green"),
    ("#00ffff", "cyan"),
    ("#0000ff", "blue"),
    ("#ff00ff", "magenta"),
    ("#000000", "black"),
    ("#ffffff", "white"),
    ("#808080", "darkGray"),
    ("#d3d3d3", "lightGray"),
    ("yellow", "yellow"),
    ("red", "red"),
    ("green", "green"),
    ("cyan", "cyan"),
    ("blue", "blue"),
    ("magenta", "magenta"),
    ("black", "black"),
    ("white", "white"),
    ("darkgray", "darkGray"),
    ("lightgray", "lightGray"),
];

const WORD_HIGHLIGHT_HEX_VALUES: &[(&str, &str)] = &[
    ("#ffff00", "yellow"),
    ("#ff0000", "red"),
    ("#00ff00", "green"),
    ("#00ffff", "cyan"),
    ("#0000ff", "blue"),
    ("#ff00ff", "magenta"),
    ("#000000", "black"),
    ("#ffffff", "white"),
    ("#808080", "darkGray"),
    ("#d3d3d3", "lightGray"),
];

#[derive(Clone, Debug, PartialEq, Eq)]
struct Relationship {
    id: String,
    r#type: String,
    target: String,
    target_mode: Option<String>,
}

struct ImageSerializationState<'a> {
    next_image_index: i64,
    next_relationship_index: i64,
    relationships: Vec<Relationship>,
    relationship_by_target: HashMap<String, Relationship>,
    pkg: &'a mut OoxmlPackage,
}

fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn should_preserve_whitespace(text: &str) -> bool {
    text.starts_with(char::is_whitespace)
        || text.ends_with(char::is_whitespace)
        || text.as_bytes().windows(2).any(|window| {
            window[0].is_ascii_whitespace() && window[1].is_ascii_whitespace()
        })
}

fn render_text_tokens(text: &str) -> String {
    let mut tokens: Vec<String> = Vec::new();
    let mut buffer = String::new();

    let flush_buffer = |buffer: &mut String, tokens: &mut Vec<String>| {
        if buffer.is_empty() {
            return;
        }
        let preserve = if should_preserve_whitespace(buffer) {
            r#" xml:space="preserve""#
        } else {
            ""
        };
        tokens.push(format!(
            "<w:t{preserve}>{}</w:t>",
            escape_xml(buffer)
        ));
        buffer.clear();
    };

    for character in text.chars() {
        if character == '\n' {
            flush_buffer(&mut buffer, &mut tokens);
            tokens.push("<w:br/>".to_string());
            continue;
        }
        if character == '\t' {
            flush_buffer(&mut buffer, &mut tokens);
            tokens.push("<w:tab/>".to_string());
            continue;
        }
        buffer.push(character);
    }

    flush_buffer(&mut buffer, &mut tokens);
    if tokens.is_empty() {
        tokens.push("<w:t/>".to_string());
    }

    tokens.join("")
}

fn normalize_hex_color(value: &str) -> Option<String> {
    let trimmed = value.trim().to_ascii_lowercase();
    if let Some(caps) = trimmed.strip_prefix('#').and_then(|rest| {
        if rest.len() == 3 && rest.chars().all(|ch| ch.is_ascii_hexdigit()) {
            let chars: Vec<char> = rest.chars().collect();
            Some(format!(
                "#{}{}{}{}{}{}",
                chars[0], chars[0], chars[1], chars[1], chars[2], chars[2]
            ))
        } else {
            None
        }
    }) {
        return Some(caps);
    }

    if let Some(rest) = trimmed.strip_prefix('#') {
        if rest.len() == 6 && rest.chars().all(|ch| ch.is_ascii_hexdigit()) {
            return Some(format!("#{rest}"));
        }
    }

    None
}

fn parse_hsl_color(value: &str) -> Option<(f64, f64, f64)> {
    let trimmed = value.trim();
    let open = trimmed.find("hsl")?;
    let inner = trimmed[open + 3..].trim_start_matches('a').trim();
    let inner = inner.strip_prefix('(')?.strip_suffix(')')?;
    let parts: Vec<&str> = inner.split('/').collect();
    let main = parts[0];
    let components: Vec<&str> = main.split(',').map(str::trim).collect();
    if components.len() < 3 {
        return None;
    }
    let h: f64 = components[0].parse().ok()?;
    let s_str = components[1].trim_end_matches('%');
    let l_str = components[2].trim_end_matches('%');
    let s: f64 = s_str.parse().ok()?;
    let l: f64 = l_str.parse().ok()?;
    if !h.is_finite() || !s.is_finite() || !l.is_finite() {
        return None;
    }
    Some((h, s, l))
}

fn hsl_to_hex(h: f64, s: f64, l: f64) -> String {
    let hue = ((h % 360.0) + 360.0) % 360.0;
    let saturation = (s.min(100.0).max(0.0)) / 100.0;
    let lightness = (l.min(100.0).max(0.0)) / 100.0;
    let chroma = (1.0 - (2.0 * lightness - 1.0).abs()) * saturation;
    let hue_prime = hue / 60.0;
    let x = chroma * (1.0 - ((hue_prime % 2.0) - 1.0).abs());
    let (mut r, mut g, mut b) = (0.0, 0.0, 0.0);

    if hue_prime >= 0.0 && hue_prime < 1.0 {
        r = chroma;
        g = x;
    } else if hue_prime < 2.0 {
        r = x;
        g = chroma;
    } else if hue_prime < 3.0 {
        g = chroma;
        b = x;
    } else if hue_prime < 4.0 {
        g = x;
        b = chroma;
    } else if hue_prime < 5.0 {
        r = x;
        b = chroma;
    } else {
        r = chroma;
        b = x;
    }

    let m = lightness - chroma / 2.0;
    let to_hex = |channel: f64| -> String {
        format!("{:02x}", ((channel + m) * 255.0).round() as i64)
    };

    format!("#{}{}{}", to_hex(r), to_hex(g), to_hex(b))
}

fn color_distance(a: &str, b: &str) -> f64 {
    let parse = |hex: &str| -> (f64, f64, f64) {
        let bytes = &hex.as_bytes()[1..];
        let r = i64::from_str_radix(std::str::from_utf8(&bytes[0..2]).unwrap_or("00"), 16)
            .unwrap_or(0) as f64;
        let g = i64::from_str_radix(std::str::from_utf8(&bytes[2..4]).unwrap_or("00"), 16)
            .unwrap_or(0) as f64;
        let b = i64::from_str_radix(std::str::from_utf8(&bytes[4..6]).unwrap_or("00"), 16)
            .unwrap_or(0) as f64;
        (r, g, b)
    };
    let (ar, ag, ab) = parse(a);
    let (br, bg, bb) = parse(b);
    let dr = ar - br;
    let dg = ag - bg;
    let db = ab - bb;
    dr * dr + dg * dg + db * db
}

fn closest_word_highlight(hex: &str) -> Option<&'static str> {
    let mut best: Option<&'static str> = None;
    let mut best_distance = f64::INFINITY;

    for (candidate_hex, candidate_value) in WORD_HIGHLIGHT_HEX_VALUES {
        let distance = color_distance(hex, candidate_hex);
        if distance < best_distance {
            best_distance = distance;
            best = Some(candidate_value);
        }
    }

    best
}

fn highlight_lookup(normalized: &str) -> Option<&'static str> {
    HIGHLIGHT_TO_WORD
        .iter()
        .find(|(key, _)| *key == normalized)
        .map(|(_, value)| *value)
}

fn normalize_word_highlight(value: Option<&str>) -> Option<String> {
    let value = value?;
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }

    if let Some(mapped) = highlight_lookup(&normalized) {
        return Some(mapped.to_string());
    }

    if let Some(hex) = normalize_hex_color(&normalized) {
        return highlight_lookup(&hex)
            .or_else(|| closest_word_highlight(&hex))
            .map(str::to_string);
    }

    if let Some((h, s, l)) = parse_hsl_color(&normalized) {
        let hsl_hex = hsl_to_hex(h, s, l);
        return highlight_lookup(&hsl_hex)
            .or_else(|| closest_word_highlight(&hsl_hex))
            .map(str::to_string);
    }

    None
}

fn run_properties_xml(style: Option<&TextStyle>) -> String {
    let Some(style) = style else {
        return String::new();
    };

    let mut fragments: Vec<String> = Vec::new();
    if style.bold == Some(true) {
        fragments.push("<w:b/>".to_string());
    }
    if style.italic == Some(true) {
        fragments.push("<w:i/>".to_string());
    }
    if style.underline == Some(true) {
        fragments.push(r#"<w:u w:val="single"/>"#.to_string());
    }
    if style.strike == Some(true) {
        fragments.push("<w:strike/>".to_string());
    }
    if let Some(color) = &style.color {
        fragments.push(format!(
            r#"<w:color w:val="{}"/>"#,
            color.replace('#', "")
        ));
    }

    if let Some(highlight) = normalize_word_highlight(style.highlight.as_deref()) {
        fragments.push(format!(r#"<w:highlight w:val="{highlight}"/>"#));
    }

    if let Some(background_color) = &style.background_color {
        fragments.push(format!(
            r#"<w:shd w:val="clear" w:color="auto" w:fill="{}"/>"#,
            background_color.replace('#', "").to_ascii_uppercase()
        ));
    }

    if let Some(font_size_pt) = style.font_size_pt {
        if font_size_pt.is_finite() {
            fragments.push(format!(
                r#"<w:sz w:val="{}"/>"#,
                (font_size_pt * 2.0).round() as i64
            ));
        }
    }

    if let Some(font_family) = &style.font_family {
        let escaped_font = escape_xml(font_family);
        fragments.push(format!(
            r#"<w:rFonts w:ascii="{escaped_font}" w:hAnsi="{escaped_font}" w:cs="{escaped_font}"/>"#
        ));
    }

    if let Some(vertical_align) = style.vertical_align {
        let val = match vertical_align {
            VerticalAlign::Superscript => "superscript",
            VerticalAlign::Subscript => "subscript",
        };
        fragments.push(format!(r#"<w:vertAlign w:val="{val}"/>"#));
    }

    if let Some(run_border) = &style.run_border {
        if !run_border.border_type.trim().is_empty() {
            let mut attrs = vec![format!(
                r#"w:val="{}""#,
                escape_xml(&run_border.border_type.trim().to_ascii_lowercase())
            )];
            if let Some(size) = run_border.size_eighth_pt {
                if size.is_finite() && size >= 0.0 {
                    attrs.push(format!(r#"w:sz="{}""#, size.round() as i64));
                }
            }
            if let Some(space) = run_border.space_pt {
                if space.is_finite() && space >= 0.0 {
                    attrs.push(format!(r#"w:space="{}""#, space.round() as i64));
                }
            }
            let color = run_border
                .color
                .as_deref()
                .map(|c| c.replace('#', "").to_ascii_uppercase())
                .unwrap_or_else(|| "auto".to_string());
            attrs.push(format!(r#"w:color="{color}""#));
            if let Some(frame) = run_border.frame {
                attrs.push(format!(r#"w:frame="{}""#, if frame { "1" } else { "0" }));
            }
            if let Some(shadow) = run_border.shadow {
                attrs.push(format!(r#"w:shadow="{}""#, if shadow { "1" } else { "0" }));
            }
            fragments.push(format!("<w:bdr {}/>", attrs.join(" ")));
        }
    }

    if fragments.is_empty() {
        String::new()
    } else {
        format!("<w:rPr>{}</w:rPr>", fragments.join(""))
    }
}

fn paragraph_border_edge_xml(
    side: &str,
    border: Option<&ParagraphBorderStyle>,
) -> String {
    let Some(border) = border else {
        return String::new();
    };
    let border_type = border.border_type.trim().to_ascii_lowercase();
    if border_type.is_empty() {
        return String::new();
    }

    let mut attrs = vec![format!(r#"w:val="{border_type}""#)];
    if let Some(size) = border.size_eighth_pt {
        if size.is_finite() && size >= 0.0 {
            attrs.push(format!(r#"w:sz="{}""#, size.round() as i64));
        }
    }
    if let Some(space) = border.space_pt {
        if space.is_finite() && space >= 0.0 {
            attrs.push(format!(r#"w:space="{}""#, space.round() as i64));
        }
    }
    let color = border
        .color
        .as_deref()
        .map(|c| c.replace('#', "").to_ascii_uppercase())
        .unwrap_or_else(|| "auto".to_string());
    attrs.push(format!(r#"w:color="{color}""#));
    if let Some(frame) = border.frame {
        attrs.push(format!(r#"w:frame="{}""#, if frame { "1" } else { "0" }));
    }
    if let Some(shadow) = border.shadow {
        attrs.push(format!(r#"w:shadow="{}""#, if shadow { "1" } else { "0" }));
    }

    format!("<w:{side} {}/>", attrs.join(" "))
}

fn paragraph_borders_xml(borders: Option<&ParagraphBorderSet>) -> String {
    let Some(borders) = borders else {
        return String::new();
    };

    let fragments = [
        paragraph_border_edge_xml("top", borders.top.as_ref()),
        paragraph_border_edge_xml("left", borders.left.as_ref()),
        paragraph_border_edge_xml("bottom", borders.bottom.as_ref()),
        paragraph_border_edge_xml("right", borders.right.as_ref()),
        paragraph_border_edge_xml("between", borders.between.as_ref()),
        paragraph_border_edge_xml("bar", borders.bar.as_ref()),
    ]
    .into_iter()
    .filter(|fragment| !fragment.is_empty())
    .collect::<Vec<_>>();

    if fragments.is_empty() {
        String::new()
    } else {
        format!("<w:pBdr>{}</w:pBdr>", fragments.join(""))
    }
}

fn paragraph_alignment_str(align: ParagraphAlignment) -> &'static str {
    match align {
        ParagraphAlignment::Left => "left",
        ParagraphAlignment::Center => "center",
        ParagraphAlignment::Right => "right",
        ParagraphAlignment::Justify => "justify",
    }
}

fn heading_level_number(level: HeadingLevel) -> u8 {
    match level {
        HeadingLevel::One => 1,
        HeadingLevel::Two => 2,
        HeadingLevel::Three => 3,
        HeadingLevel::Four => 4,
        HeadingLevel::Five => 5,
        HeadingLevel::Six => 6,
    }
}

fn paragraph_line_rule_str(rule: ParagraphLineRule) -> &'static str {
    match rule {
        ParagraphLineRule::Auto => "auto",
        ParagraphLineRule::Exact => "exact",
        ParagraphLineRule::AtLeast => "atLeast",
    }
}

fn paragraph_properties_xml(style: Option<&ParagraphStyle>) -> String {
    let Some(style) = style else {
        return String::new();
    };

    let mut fragments: Vec<String> = Vec::new();
    let paragraph_style_id = style.style_id.clone().or_else(|| {
        style
            .heading_level
            .map(|level| format!("Heading{}", heading_level_number(level)))
    });
    if let Some(paragraph_style_id) = paragraph_style_id {
        fragments.push(format!(
            r#"<w:pStyle w:val="{}"/>"#,
            escape_xml(&paragraph_style_id)
        ));
    }
    if let Some(align) = style.align {
        fragments.push(format!(
            r#"<w:jc w:val="{}"/>"#,
            paragraph_alignment_str(align)
        ));
    }
    if let Some(numbering) = &style.numbering {
        if numbering.num_id > 0 {
            let ilvl = numbering.ilvl.max(0);
            let num_id = numbering.num_id;
            fragments.push(format!(
                r#"<w:numPr><w:ilvl w:val="{ilvl}"/><w:numId w:val="{num_id}"/></w:numPr>"#
            ));
        }
    }

    let mut spacing_fragments: Vec<String> = Vec::new();
    if let Some(before) = twips_to_xml_non_negative(style.spacing.as_ref().and_then(|s| s.before_twips)) {
        spacing_fragments.push(format!(r#"w:before="{before}""#));
    }
    if let Some(after) = twips_to_xml_non_negative(style.spacing.as_ref().and_then(|s| s.after_twips)) {
        spacing_fragments.push(format!(r#"w:after="{after}""#));
    }
    if let Some(line) = twips_to_xml_non_negative(style.spacing.as_ref().and_then(|s| s.line_twips)) {
        spacing_fragments.push(format!(r#"w:line="{line}""#));
    }
    if let Some(line_rule) = style.spacing.as_ref().and_then(|s| s.line_rule) {
        let line_rule = match line_rule {
            ParagraphLineRule::AtLeast => "atLeast",
            other => paragraph_line_rule_str(other),
        };
        spacing_fragments.push(format!(r#"w:lineRule="{line_rule}""#));
    }
    if !spacing_fragments.is_empty() {
        fragments.push(format!("<w:spacing {}/>", spacing_fragments.join(" ")));
    }

    let mut indent_fragments: Vec<String> = Vec::new();
    if let Some(left) = twips_to_xml_non_negative(style.indent.as_ref().and_then(|i| i.left_twips)) {
        indent_fragments.push(format!(r#"w:left="{left}""#));
    }
    if let Some(right) = twips_to_xml_non_negative(style.indent.as_ref().and_then(|i| i.right_twips)) {
        indent_fragments.push(format!(r#"w:right="{right}""#));
    }
    if let Some(first_line) =
        twips_to_xml_non_negative(style.indent.as_ref().and_then(|i| i.first_line_twips))
    {
        indent_fragments.push(format!(r#"w:firstLine="{first_line}""#));
    }
    if let Some(hanging) =
        twips_to_xml_non_negative(style.indent.as_ref().and_then(|i| i.hanging_twips))
    {
        indent_fragments.push(format!(r#"w:hanging="{hanging}""#));
    }
    if !indent_fragments.is_empty() {
        fragments.push(format!("<w:ind {}/>", indent_fragments.join(" ")));
    }

    if let Some(drop_cap) = &style.drop_cap {
        let mut frame_fragments = vec![format!(
            r#"w:dropCap="{}""#,
            escape_xml(match drop_cap.drop_cap_type {
                ParagraphDropCapType::Drop => "drop",
                ParagraphDropCapType::Margin => "margin",
            })
        )];
        if let Some(lines) = drop_cap.lines {
            if lines > 0 {
                frame_fragments.push(format!(r#"w:lines="{lines}""#));
            }
        }
        if let Some(wrap) = &drop_cap.wrap {
            frame_fragments.push(format!(r#"w:wrap="{}""#, escape_xml(wrap)));
        }
        if let Some(horizontal_anchor) = &drop_cap.horizontal_anchor {
            frame_fragments.push(format!(
                r#"w:hAnchor="{}""#,
                escape_xml(horizontal_anchor)
            ));
        }
        if let Some(vertical_anchor) = &drop_cap.vertical_anchor {
            frame_fragments.push(format!(
                r#"w:vAnchor="{}""#,
                escape_xml(vertical_anchor)
            ));
        }
        if let Some(x) = twips_to_xml_non_negative(drop_cap.x_twips) {
            frame_fragments.push(format!(r#"w:x="{x}""#));
        }
        if let Some(y) = twips_to_xml_non_negative(drop_cap.y_twips) {
            frame_fragments.push(format!(r#"w:y="{y}""#));
        }
        if let Some(h_space) = twips_to_xml_non_negative(drop_cap.horizontal_space_twips) {
            frame_fragments.push(format!(r#"w:hSpace="{h_space}""#));
        }
        if let Some(v_space) = twips_to_xml_non_negative(drop_cap.vertical_space_twips) {
            frame_fragments.push(format!(r#"w:vSpace="{v_space}""#));
        }
        fragments.push(format!("<w:framePr {}/>", frame_fragments.join(" ")));
    }

    let paragraph_border_xml = paragraph_borders_xml(style.borders.as_ref());
    if !paragraph_border_xml.is_empty() {
        fragments.push(paragraph_border_xml);
    }

    if fragments.is_empty() {
        String::new()
    } else {
        format!("<w:pPr>{}</w:pPr>", fragments.join(""))
    }
}

fn twips_to_xml(value: Option<i64>) -> Option<i64> {
    let value = value?;
    let rounded = value;
    if rounded > 0 {
        Some(rounded)
    } else {
        None
    }
}

fn twips_to_xml_non_negative(value: Option<i64>) -> Option<i64> {
    let value = value?;
    if value >= 0 {
        Some(value)
    } else {
        None
    }
}

fn table_box_spacing_xml(spacing: Option<&TableBoxSpacing>, wrapper_tag_name: &str) -> String {
    let Some(spacing) = spacing else {
        return String::new();
    };

    let top = twips_to_xml(spacing.top_twips);
    let right = twips_to_xml(spacing.right_twips);
    let bottom = twips_to_xml(spacing.bottom_twips);
    let left = twips_to_xml(spacing.left_twips);

    let mut edges: Vec<String> = Vec::new();
    if let Some(top) = top {
        edges.push(format!(r#"<w:top w:w="{top}" w:type="dxa"/>"#));
    }
    if let Some(right) = right {
        edges.push(format!(r#"<w:right w:w="{right}" w:type="dxa"/>"#));
    }
    if let Some(bottom) = bottom {
        edges.push(format!(r#"<w:bottom w:w="{bottom}" w:type="dxa"/>"#));
    }
    if let Some(left) = left {
        edges.push(format!(r#"<w:left w:w="{left}" w:type="dxa"/>"#));
    }

    if edges.is_empty() {
        String::new()
    } else {
        format!("<{wrapper_tag_name}>{}</{wrapper_tag_name}>", edges.join(""))
    }
}

fn table_border_edge_xml(side: &str, border: Option<&TableBorderStyle>) -> String {
    let Some(border) = border else {
        return String::new();
    };
    let border_type = border.border_type.trim().to_ascii_lowercase();
    if border_type.is_empty() {
        return String::new();
    }

    let size = if let Some(size_eighth_pt) = border.size_eighth_pt {
        if size_eighth_pt.is_finite() && size_eighth_pt >= 0.0 {
            size_eighth_pt.round() as i64
        } else if border_type == "none" || border_type == "nil" {
            0
        } else {
            4
        }
    } else if border_type == "none" || border_type == "nil" {
        0
    } else {
        4
    };
    let color = border
        .color
        .as_deref()
        .map(|c| c.replace('#', "").to_ascii_uppercase())
        .unwrap_or_else(|| "auto".to_string());

    format!(
        r#"<w:{side} w:val="{border_type}" w:sz="{size}" w:space="0" w:color="{color}"/>"#
    )
}

fn table_borders_xml(borders: Option<&TableBorderSet>, wrapper_tag_name: &str) -> String {
    let Some(borders) = borders else {
        return String::new();
    };

    let edges = [
        table_border_edge_xml("top", borders.top.as_ref()),
        table_border_edge_xml("left", borders.left.as_ref()),
        table_border_edge_xml("bottom", borders.bottom.as_ref()),
        table_border_edge_xml("right", borders.right.as_ref()),
        table_border_edge_xml("insideH", borders.inside_h.as_ref()),
        table_border_edge_xml("insideV", borders.inside_v.as_ref()),
        table_border_edge_xml("tl2br", borders.tl2br.as_ref()),
        table_border_edge_xml("tr2bl", borders.tr2bl.as_ref()),
    ]
    .into_iter()
    .filter(|edge| !edge.is_empty())
    .collect::<Vec<_>>();

    if edges.is_empty() {
        String::new()
    } else {
        format!("<{wrapper_tag_name}>{}</{wrapper_tag_name}>", edges.join(""))
    }
}

fn parse_relationships_xml(xml: &str) -> Vec<Relationship> {
    let mut relationships = Vec::new();
    let mut search_from = 0;

    while let Some(start) = xml[search_from..].find("<Relationship") {
        let abs_start = search_from + start;
        let Some(end_rel) = xml[abs_start..].find('>') else {
            break;
        };
        let tag = &xml[abs_start..abs_start + end_rel + 1];
        search_from = abs_start + end_rel + 1;

        let id = extract_attribute(tag, "Id");
        let rel_type = extract_attribute(tag, "Type");
        let target = extract_attribute(tag, "Target");
        let target_mode = extract_attribute(tag, "TargetMode");

        if let (Some(id), Some(rel_type), Some(target)) = (id, rel_type, target) {
            relationships.push(Relationship {
                id,
                r#type: rel_type,
                target,
                target_mode,
            });
        }
    }

    relationships
}

fn extract_attribute(tag: &str, attribute: &str) -> Option<String> {
    let patterns = [
        format!(r#"{}=""#, attribute),
        format!(r#"{}=""#, attribute.to_ascii_lowercase()),
    ];
    for pattern in &patterns {
        if let Some(start) = tag.find(pattern) {
            let value_start = start + pattern.len();
            if let Some(end) = tag[value_start..].find('"') {
                return Some(tag[value_start..value_start + end].to_string());
            }
        }
    }
    None
}

fn normalize_word_part_name(part_name: &str) -> String {
    part_name.strip_prefix('/').unwrap_or(part_name).to_string()
}

fn relationship_part_name_for_word_part(part_name: &str) -> String {
    let normalized_part_name = normalize_word_part_name(part_name);
    if let Some(slash_index) = normalized_part_name.rfind('/') {
        let directory = &normalized_part_name[..slash_index];
        let basename = &normalized_part_name[slash_index + 1..];
        format!("{directory}/_rels/{basename}.rels")
    } else {
        format!("_rels/{normalized_part_name}.rels")
    }
}

fn render_relationships_xml(relationships: &[Relationship]) -> String {
    let serialized = relationships
        .iter()
        .map(|relationship| {
            let target_mode = relationship
                .target_mode
                .as_ref()
                .map(|mode| format!(r#" TargetMode="{}""#, escape_xml(mode)))
                .unwrap_or_default();
            format!(
                r#"<Relationship Id="{}" Type="{}" Target="{}"{target_mode}/>"#,
                escape_xml(&relationship.id),
                escape_xml(&relationship.r#type),
                escape_xml(&relationship.target)
            )
        })
        .collect::<String>();

    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="{RELS_XMLNS}">{serialized}</Relationships>"#
    )
}

fn strip_rid_prefix(id: &str) -> &str {
    if id.len() >= 3 && id[..3].eq_ignore_ascii_case("rId") {
        &id[3..]
    } else {
        id
    }
}

fn next_relationship_index(relationships: &[Relationship]) -> i64 {
    relationships
        .iter()
        .fold(1i64, |largest, relationship| {
            let parsed = strip_rid_prefix(&relationship.id)
                .parse::<f64>()
                .ok()
                .filter(|value| value.is_finite());
            if let Some(parsed) = parsed {
                ((parsed + 1.0).max(largest as f64)) as i64
            } else {
                largest
            }
        })
        .max(1)
}

fn decode_base64(input: &str) -> Option<Vec<u8>> {
    const DECODE: [i8; 128] = {
        let mut table = [-1i8; 128];
        let mut i = 0u8;
        while i < 26 {
            table[(b'A' + i) as usize] = i as i8;
            table[(b'a' + i) as usize] = (i + 26) as i8;
            i += 1;
        }
        let mut i = 0u8;
        while i < 10 {
            table[(b'0' + i) as usize] = (i + 52) as i8;
            i += 1;
        }
        table[b'+' as usize] = 62;
        table[b'/' as usize] = 63;
        table
    };

    let mut output = Vec::new();
    let mut buffer = 0u32;
    let mut bits = 0u32;

    for byte in input.bytes() {
        if byte == b'=' {
            break;
        }
        if byte.is_ascii_whitespace() {
            continue;
        }
        if byte >= 128 {
            return None;
        }
        let value = DECODE[byte as usize];
        if value < 0 {
            return None;
        }
        buffer = (buffer << 6) | value as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push(((buffer >> bits) & 0xff) as u8);
        }
    }

    Some(output)
}

fn decode_data_uri(data_uri: &str) -> Option<(String, Vec<u8>)> {
    let lower = data_uri.to_ascii_lowercase();
    if !lower.starts_with("data:") {
        return None;
    }
    let rest = &data_uri[5..];
    let semi = rest.find(';')?;
    let mime_type = rest[..semi].to_string();
    let payload = rest[semi + 1..].strip_prefix("base64,")?;
    let data = decode_base64(payload)?;
    Some((mime_type, data))
}

fn extension_from_mime_type(mime_type: Option<&str>) -> Option<&'static str> {
    let mime_type = mime_type?;
    let normalized = mime_type.to_ascii_lowercase();
    MIME_BY_EXTENSION
        .iter()
        .find(|(_, candidate)| *candidate == normalized)
        .map(|(extension, _)| *extension)
}

fn extension_from_part_name(part_name: Option<&str>) -> Option<String> {
    let part_name = part_name?;
    let dot_index = part_name.rfind('.')?;
    if dot_index == part_name.len() - 1 {
        return None;
    }
    Some(part_name[dot_index + 1..].to_ascii_lowercase())
}

fn target_from_part_name(part_name: &str) -> String {
    part_name
        .strip_prefix("word/")
        .unwrap_or(part_name)
        .to_string()
}

fn emu_from_px(px: Option<f64>, fallback_px: f64) -> i64 {
    ((px.unwrap_or(fallback_px)) * 9525.0).round() as i64
}

fn is_external_target(target: &str) -> bool {
    let mut chars = target.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphabetic() {
        return false;
    }
    for ch in chars {
        if ch == ':' {
            return true;
        }
        if !(ch.is_ascii_alphanumeric() || matches!(ch, '+' | '.' | '-')) {
            return false;
        }
    }
    false
}

fn content_types_has_extension(content: &str, extension: &str) -> bool {
    let needle = format!(r#"Extension="{extension}""#);
    content
        .as_bytes()
        .windows(needle.len())
        .any(|window| window.eq_ignore_ascii_case(needle.as_bytes()))
}

fn ensure_content_type_default(pkg: &mut OoxmlPackage, extension: &str, content_type: &str) {
    let Some(part) = pkg.parts.get("[Content_Types].xml").cloned() else {
        return;
    };

    if content_types_has_extension(&part.content, extension) {
        return;
    }

    let default_entry = format!(
        r#"<Default Extension="{extension}" ContentType="{content_type}"/>"#
    );
    let updated = if let Some(index) = part.content.rfind("</Types>") {
        format!(
            "{}{}{}",
            &part.content[..index],
            default_entry,
            &part.content[index..]
        )
    } else {
        part.content.clone()
    };

    pkg.parts.insert(
        "[Content_Types].xml".to_string(),
        OoxmlPart {
            name: "[Content_Types].xml".to_string(),
            content: updated,
        },
    );
}

fn ensure_image_part_and_relationship(
    image: &ImageRunNode,
    state: &mut ImageSerializationState<'_>,
) -> Option<(String, f64, f64, String)> {
    let mut part_name = image.part_name.clone();
    let mut image_data = image.data.clone();
    let mut content_type = image.content_type.clone();

    if part_name.is_none() || image_data.is_none() {
        if let Some(src) = &image.src {
            if let Some((decoded_mime, decoded_data)) = decode_data_uri(src) {
                image_data = Some(decoded_data);
                if content_type.is_none() {
                    content_type = Some(decoded_mime);
                }
                if part_name.is_none() {
                    let extension = extension_from_mime_type(content_type.as_deref()).unwrap_or("png");
                    part_name = Some(format!(
                        "word/media/image{}.{}",
                        state.next_image_index, extension
                    ));
                    state.next_image_index += 1;
                }
            }
        }
    }

    let part_name = part_name?;

    if let Some(data) = &image_data {
        if !state.pkg.binary_assets.contains_key(&part_name) {
            state
                .pkg
                .binary_assets
                .insert(part_name.clone(), data.clone());
        }
    }

    let extension = extension_from_part_name(Some(&part_name))
        .or_else(|| extension_from_mime_type(content_type.as_deref()).map(str::to_string))
        .unwrap_or_else(|| "png".to_string());
    let resolved_content_type = content_type.unwrap_or_else(|| {
        MIME_BY_EXTENSION
            .iter()
            .find(|(ext, _)| *ext == extension)
            .map(|(_, mime)| mime.to_string())
            .unwrap_or_else(|| "application/octet-stream".to_string())
    });
    ensure_content_type_default(state.pkg, &extension, &resolved_content_type);

    let target = target_from_part_name(&part_name);
    let relationship = if let Some(existing) = state.relationship_by_target.get(&target) {
        existing.clone()
    } else {
        let relationship = Relationship {
            id: format!("rId{}", state.next_relationship_index),
            r#type: REL_TYPE_IMAGE.to_string(),
            target: target.clone(),
            target_mode: None,
        };
        state.next_relationship_index += 1;
        state.relationships.push(relationship.clone());
        state
            .relationship_by_target
            .insert(target.clone(), relationship.clone());
        relationship
    };

    Some((
        relationship.id,
        image.width_px.unwrap_or(240.0),
        image.height_px.unwrap_or(160.0),
        image.alt.clone().unwrap_or_else(|| "DOCX image".to_string()),
    ))
}

fn ensure_hyperlink_relationship(target: &str, state: &mut ImageSerializationState<'_>) -> String {
    let target_mode = if is_external_target(target) {
        Some("External".to_string())
    } else {
        None
    };

    if let Some(existing) = state.relationships.iter().find(|candidate| {
        candidate.r#type == REL_TYPE_HYPERLINK
            && candidate.target == target
            && candidate.target_mode == target_mode
    }) {
        return existing.id.clone();
    }

    let relationship = Relationship {
        id: format!("rId{}", state.next_relationship_index),
        r#type: REL_TYPE_HYPERLINK.to_string(),
        target: target.to_string(),
        target_mode,
    };
    state.next_relationship_index += 1;
    let id = relationship.id.clone();
    state.relationships.push(relationship);
    id
}

fn image_horizontal_align_str(align: ImageHorizontalAlign) -> &'static str {
    match align {
        ImageHorizontalAlign::Left => "left",
        ImageHorizontalAlign::Center => "center",
        ImageHorizontalAlign::Right => "right",
        ImageHorizontalAlign::Inside => "inside",
        ImageHorizontalAlign::Outside => "outside",
    }
}

fn image_vertical_align_str(align: ImageVerticalAlign) -> &'static str {
    match align {
        ImageVerticalAlign::Top => "top",
        ImageVerticalAlign::Center => "center",
        ImageVerticalAlign::Bottom => "bottom",
        ImageVerticalAlign::Inside => "inside",
        ImageVerticalAlign::Outside => "outside",
    }
}

fn image_wrap_text_attr(wrap_text: Option<ImageWrapText>) -> String {
    wrap_text
        .map(|value| {
            let text = match value {
                ImageWrapText::BothSides => "bothSides",
                ImageWrapText::Left => "left",
                ImageWrapText::Right => "right",
                ImageWrapText::Largest => "largest",
            };
            format!(r#" wrapText="{}""#, escape_xml(text))
        })
        .unwrap_or_default()
}

fn drawing_run_xml(
    image: &ImageRunNode,
    state: &mut ImageSerializationState<'_>,
    run_id: i64,
) -> String {
    let Some((relationship_id, width_px, height_px, alt)) =
        ensure_image_part_and_relationship(image, state)
    else {
        return String::new();
    };

    let cx = emu_from_px(Some(width_px), 240.0);
    let cy = emu_from_px(Some(height_px), 160.0);

    if let Some(floating) = &image.floating {
        let dist_l = emu_from_px(floating.dist_l_px, 0.0);
        let dist_r = emu_from_px(floating.dist_r_px, 0.0);
        let dist_t = emu_from_px(floating.dist_t_px, 0.0);
        let dist_b = emu_from_px(floating.dist_b_px, 0.0);
        let relative_height = floating
            .z_index
            .filter(|value| *value >= 0)
            .unwrap_or(251_658_240);
        let horizontal_relative_to = floating
            .horizontal_relative_to
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("margin");
        let vertical_relative_to = floating
            .vertical_relative_to
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("paragraph");
        let position_h_xml = if let Some(horizontal_align) = floating.horizontal_align {
            format!(
                r#"<wp:positionH relativeFrom="{}"><wp:align>{}</wp:align></wp:positionH>"#,
                escape_xml(horizontal_relative_to),
                escape_xml(image_horizontal_align_str(horizontal_align))
            )
        } else {
            format!(
                r#"<wp:positionH relativeFrom="{}"><wp:posOffset>{}</wp:posOffset></wp:positionH>"#,
                escape_xml(horizontal_relative_to),
                emu_from_px(floating.x_px, 0.0)
            )
        };
        let position_v_xml = if let Some(vertical_align) = floating.vertical_align {
            format!(
                r#"<wp:positionV relativeFrom="{}"><wp:align>{}</wp:align></wp:positionV>"#,
                escape_xml(vertical_relative_to),
                escape_xml(image_vertical_align_str(vertical_align))
            )
        } else {
            format!(
                r#"<wp:positionV relativeFrom="{}"><wp:posOffset>{}</wp:posOffset></wp:positionV>"#,
                escape_xml(vertical_relative_to),
                emu_from_px(floating.y_px, 0.0)
            )
        };
        let wrap_xml = match floating.wrap_type {
            Some(ImageWrapType::WrapNone) => "<wp:wrapNone/>".to_string(),
            Some(ImageWrapType::TopAndBottom) => "<wp:wrapTopAndBottom/>".to_string(),
            Some(ImageWrapType::Tight) => format!(
                "<wp:wrapTight{}/>",
                image_wrap_text_attr(floating.wrap_text)
            ),
            Some(ImageWrapType::Through) => format!(
                "<wp:wrapThrough{}/>",
                image_wrap_text_attr(floating.wrap_text)
            ),
            Some(ImageWrapType::Square) => format!(
                "<wp:wrapSquare{}/>",
                image_wrap_text_attr(floating.wrap_text)
            ),
            None => "<wp:wrapNone/>".to_string(),
        };

        return format!(
            r#"<w:r><w:drawing><wp:anchor distT="{dist_t}" distB="{dist_b}" distL="{dist_l}" distR="{dist_r}" simplePos="0" relativeHeight="{relative_height}" behindDoc="{}" locked="0" layoutInCell="1" allowOverlap="1" xmlns:wp="{DRAWING_WORD_NS}"><wp:simplePos x="0" y="0"/>{position_h_xml}{position_v_xml}<wp:extent cx="{cx}" cy="{cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>{wrap_xml}<wp:docPr id="{run_id}" name="Picture {run_id}" descr="{}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="{DRAWING_MAIN_NS}" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="{DRAWING_MAIN_NS}"><a:graphicData uri="{DRAWING_PICTURE_NS}"><pic:pic xmlns:pic="{DRAWING_PICTURE_NS}"><pic:nvPicPr><pic:cNvPr id="0" name="Picture {run_id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="{relationship_id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>"#,
            if floating.behind_document == Some(true) {
                1
            } else {
                0
            },
            escape_xml(&alt)
        );
    }

    format!(
        r#"<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="{DRAWING_WORD_NS}"><wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{run_id}" name="Picture {run_id}" descr="{}"/><a:graphic xmlns:a="{DRAWING_MAIN_NS}"><a:graphicData uri="{DRAWING_PICTURE_NS}"><pic:pic xmlns:pic="{DRAWING_PICTURE_NS}"><pic:nvPicPr><pic:cNvPr id="0" name="Picture {run_id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="{relationship_id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"#,
        escape_xml(&alt)
    )
}

fn code_point_hex_from_symbol(symbol: Option<&str>, fallback_hex: &str) -> String {
    let Some(symbol) = symbol else {
        return fallback_hex.to_string();
    };
    let Some(first) = symbol.chars().next() else {
        return fallback_hex.to_string();
    };
    let code_point = first as u32;
    if code_point == 0 {
        return fallback_hex.to_string();
    }
    format!("{:04X}", code_point)
}

fn wrap_with_hyperlink_xml(xml: &str, link: Option<&str>, state: &mut ImageSerializationState<'_>) -> String {
    let normalized_link = link.map(str::trim).filter(|value| !value.is_empty());
    let Some(normalized_link) = normalized_link else {
        return xml.to_string();
    };

    if let Some(anchor) = normalized_link.strip_prefix('#') {
        return format!(
            r#"<w:hyperlink w:anchor="{}">{}</w:hyperlink>"#,
            escape_xml(anchor),
            xml
        );
    }

    let relationship_id = ensure_hyperlink_relationship(normalized_link, state);
    format!(r#"<w:hyperlink r:id="{relationship_id}">{xml}</w:hyperlink>"#)
}

fn resolve_dropdown_display_value(field: &FormFieldRunNode) -> String {
    let selected = field.value.as_deref().map(str::trim).unwrap_or("");
    if selected.is_empty() {
        return field
            .options
            .as_ref()
            .and_then(|options| options.first())
            .map(|option| option.display_text.clone())
            .unwrap_or_default();
    }

    if let Some(options) = &field.options {
        if let Some(matching_option) = options.iter().find(|option| {
            option.display_text.trim() == selected
                || option
                    .value
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .is_some_and(|value| value == selected)
        }) {
            return matching_option.display_text.clone();
        }
    }

    selected.to_string()
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum LegacyTextInputType {
    Regular,
    Number,
    Date,
    CurrentDate,
    CurrentTime,
    Calculated,
}

fn normalize_legacy_text_input_type(raw_value: Option<&str>) -> Option<LegacyTextInputType> {
    let raw_value = raw_value?;
    let normalized = raw_value.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }

    match normalized.as_str() {
        "regular" => Some(LegacyTextInputType::Regular),
        "number" => Some(LegacyTextInputType::Number),
        "date" => Some(LegacyTextInputType::Date),
        "currentdate" | "current_date" | "current-date" => Some(LegacyTextInputType::CurrentDate),
        "currenttime" | "current_time" | "current-time" => Some(LegacyTextInputType::CurrentTime),
        "calculated" | "calculation" => Some(LegacyTextInputType::Calculated),
        _ => None,
    }
}

fn legacy_text_input_type_str(value: LegacyTextInputType) -> &'static str {
    match value {
        LegacyTextInputType::Regular => "regular",
        LegacyTextInputType::Number => "number",
        LegacyTextInputType::Date => "date",
        LegacyTextInputType::CurrentDate => "currentDate",
        LegacyTextInputType::CurrentTime => "currentTime",
        LegacyTextInputType::Calculated => "calculated",
    }
}

fn legacy_on_off_tag_xml(tag_name: &str, value: Option<bool>) -> String {
    let Some(value) = value else {
        return String::new();
    };
    format!(r#"<w:{tag_name} w:val="{}"/>"#, if value { "1" } else { "0" })
}

fn legacy_form_field_run_xml(field: &FormFieldRunNode, state: &mut ImageSerializationState<'_>) -> String {
    let mut ff_data_fragments: Vec<String> = Vec::new();
    let widget = field.widget.as_ref();

    if let Some(name) = widget.and_then(|w| w.name.as_deref()).map(str::trim) {
        if !name.is_empty() {
            ff_data_fragments.push(format!(r#"<w:name w:val="{}"/>"#, escape_xml(name)));
        }
    }
    ff_data_fragments.push(legacy_on_off_tag_xml("enabled", widget.and_then(|w| w.enabled)));
    ff_data_fragments.push(legacy_on_off_tag_xml(
        "calcOnExit",
        widget.and_then(|w| w.calc_on_exit),
    ));

    let mut instruction = "FORMTEXT";
    let mut display_value = field.value.clone().unwrap_or_default();

    match field.field_type {
        FormFieldType::Checkbox => {
            instruction = "FORMCHECKBOX";
            let checked_symbol = field.checked_symbol.as_deref().unwrap_or("☒");
            let unchecked_symbol = field.unchecked_symbol.as_deref().unwrap_or("☐");
            display_value = if field.checked == Some(true) {
                checked_symbol.to_string()
            } else {
                unchecked_symbol.to_string()
            };

            let mut checkbox_fragments: Vec<String> = Vec::new();
            checkbox_fragments.push(legacy_on_off_tag_xml(
                "default",
                widget.and_then(|w| w.checkbox.as_ref()).and_then(|c| c.default_checked),
            ));
            checkbox_fragments.push(legacy_on_off_tag_xml("checked", field.checked));
            if widget
                .and_then(|w| w.checkbox.as_ref())
                .and_then(|c| c.size_mode)
                == Some(FormFieldCheckboxSizeMode::Auto)
            {
                checkbox_fragments.push("<w:sizeAuto/>".to_string());
            } else if let Some(size_pt) = widget
                .and_then(|w| w.checkbox.as_ref())
                .and_then(|c| c.size_pt)
            {
                if size_pt.is_finite() && size_pt > 0.0 {
                    checkbox_fragments.push(format!(
                        r#"<w:size w:val="{}"/>"#,
                        (size_pt * 2.0).round() as i64
                    ));
                }
            }
            if checkbox_fragments.is_empty() {
                ff_data_fragments.push("<w:checkBox/>".to_string());
            } else {
                ff_data_fragments.push(format!(
                    "<w:checkBox>{}</w:checkBox>",
                    checkbox_fragments.join("")
                ));
            }
        }
        FormFieldType::Dropdown => {
            instruction = "FORMDROPDOWN";
            display_value = resolve_dropdown_display_value(field);
            let mut dropdown_fragments: Vec<String> = Vec::new();
            if let Some(options) = &field.options {
                for option in options {
                    let display_text = option.display_text.trim();
                    if display_text.is_empty() {
                        continue;
                    }
                    dropdown_fragments.push(format!(
                        r#"<w:listEntry w:val="{}"/>"#,
                        escape_xml(display_text)
                    ));
                }
            }
            if let Some(default_value) = widget
                .and_then(|w| w.dropdown.as_ref())
                .and_then(|d| d.default_value.as_deref())
                .map(str::trim)
            {
                if !default_value.is_empty() {
                    dropdown_fragments.push(format!(
                        r#"<w:default w:val="{}"/>"#,
                        escape_xml(default_value)
                    ));
                }
            }
            if dropdown_fragments.is_empty() {
                ff_data_fragments.push("<w:ddList/>".to_string());
            } else {
                ff_data_fragments.push(format!(
                    "<w:ddList>{}</w:ddList>",
                    dropdown_fragments.join("")
                ));
            }
        }
        _ => {
            instruction = "FORMTEXT";
            let text_widget = widget.and_then(|w| w.text.as_ref());
            let normalized_input_type =
                normalize_legacy_text_input_type(text_widget.and_then(|t| t.input_type.as_deref()));
            let current_value = field.value.as_deref();
            let has_current_value = current_value
                .map(str::trim)
                .is_some_and(|value| !value.is_empty());
            let configured_default_text = text_widget.and_then(|t| t.default_text.as_deref());
            let has_configured_default_text = configured_default_text
                .map(str::trim)
                .is_some_and(|value| !value.is_empty());
            let default_text = if normalized_input_type == Some(LegacyTextInputType::Number)
                && !has_current_value
                && !has_configured_default_text
            {
                Some("0".to_string())
            } else {
                configured_default_text.map(str::to_string)
            };
            display_value = current_value
                .map(str::to_string)
                .or(default_text.clone())
                .unwrap_or_else(|| {
                    if normalized_input_type == Some(LegacyTextInputType::Number) {
                        "0".to_string()
                    } else {
                        String::new()
                    }
                });

            let mut text_fragments: Vec<String> = Vec::new();
            if let Some(input_type) = normalized_input_type {
                text_fragments.push(format!(
                    r#"<w:type w:val="{}"/>"#,
                    escape_xml(legacy_text_input_type_str(input_type))
                ));
            }
            if let Some(default_text) = &default_text {
                text_fragments.push(format!(
                    r#"<w:default w:val="{}"/>"#,
                    escape_xml(default_text)
                ));
            }
            if let Some(max_length) = text_widget.and_then(|t| t.max_length) {
                if max_length >= 0 {
                    text_fragments.push(format!(r#"<w:maxLength w:val="{max_length}"/>"#));
                }
            }
            let normalized_text_format = text_widget
                .and_then(|t| t.text_format.as_deref())
                .map(str::trim)
                .filter(|value| !value.is_empty());
            if let Some(format_value) = normalized_text_format {
                text_fragments.push(format!(
                    r#"<w:format w:val="{}"/>"#,
                    escape_xml(format_value)
                ));
            } else if normalized_input_type == Some(LegacyTextInputType::Number) {
                text_fragments.push(r#"<w:format w:val="0"/>"#.to_string());
            }
            if text_fragments.is_empty() {
                ff_data_fragments.push("<w:textInput/>".to_string());
            } else {
                ff_data_fragments.push(format!(
                    "<w:textInput>{}</w:textInput>",
                    text_fragments.join("")
                ));
            }
        }
    }

    let ff_data_xml = format!("<w:ffData>{}</w:ffData>", ff_data_fragments.join(""));
    let result_run_xml = format!(
        "<w:r>{}</w:r>",
        format!(
            "{}{}",
            run_properties_xml(field.style.as_ref()),
            render_text_tokens(&display_value)
        )
    );
    let legacy_field_xml = format!(
        "{}{}{}{}{}",
        format!(r#"<w:r><w:fldChar w:fldCharType="begin">{ff_data_xml}</w:fldChar></w:r>"#),
        format!(r#"<w:r><w:instrText xml:space="preserve"> {instruction} </w:instrText></w:r>"#),
        r#"<w:r><w:fldChar w:fldCharType="separate"/></w:r>"#,
        result_run_xml,
        r#"<w:r><w:fldChar w:fldCharType="end"/></w:r>"#
    );

    wrap_with_hyperlink_xml(&legacy_field_xml, field.link.as_deref(), state)
}

fn form_field_run_xml(field: &FormFieldRunNode, state: &mut ImageSerializationState<'_>) -> String {
    if let Some(source_xml) = &field.source_xml {
        return wrap_with_hyperlink_xml(source_xml, field.link.as_deref(), state);
    }

    if field.source_kind == Some(FormFieldSourceKind::Legacy) {
        return legacy_form_field_run_xml(field, state);
    }

    let mut properties: Vec<String> = Vec::new();
    if let Some(id) = field.id {
        properties.push(format!(r#"<w:id w:val="{id}"/>"#));
    }
    if let Some(title) = field.title.as_deref().map(str::trim) {
        if !title.is_empty() {
            properties.push(format!(r#"<w:alias w:val="{}"/>"#, escape_xml(title)));
        }
    }
    if let Some(tag) = field.tag.as_deref().map(str::trim) {
        if !tag.is_empty() {
            properties.push(format!(r#"<w:tag w:val="{}"/>"#, escape_xml(tag)));
        }
    }
    if let Some(placeholder) = field.placeholder.as_deref().map(str::trim) {
        if !placeholder.is_empty() {
            properties.push(format!(
                r#"<w:placeholder><w:docPart w:val="{}"/></w:placeholder>"#,
                escape_xml(placeholder)
            ));
        }
    }

    let mut display_value = field.value.clone().unwrap_or_default();
    match field.field_type {
        FormFieldType::Checkbox => {
            let checked_symbol = field.checked_symbol.as_deref().unwrap_or("☒");
            let unchecked_symbol = field.unchecked_symbol.as_deref().unwrap_or("☐");
            let checked_hex = code_point_hex_from_symbol(field.checked_symbol.as_deref(), "2612");
            let unchecked_hex =
                code_point_hex_from_symbol(field.unchecked_symbol.as_deref(), "2610");
            properties.push(format!(
                r#"<w14:checkbox><w14:checked w14:val="{}"/><w14:checkedState w14:val="{checked_hex}" w14:font="MS Gothic"/><w14:uncheckedState w14:val="{unchecked_hex}" w14:font="MS Gothic"/></w14:checkbox>"#,
                if field.checked == Some(true) { "1" } else { "0" }
            ));
            display_value = if field.checked == Some(true) {
                checked_symbol.to_string()
            } else {
                unchecked_symbol.to_string()
            };
        }
        FormFieldType::Dropdown => {
            let options_xml = field
                .options
                .as_ref()
                .map(|options| {
                    options
                        .iter()
                        .filter_map(|option| {
                            let display_text = option.display_text.trim();
                            if display_text.is_empty() {
                                return None;
                            }
                            let value = option
                                .value
                                .as_deref()
                                .map(str::trim)
                                .filter(|value| !value.is_empty())
                                .unwrap_or(display_text);
                            Some(format!(
                                r#"<w:listItem w:displayText="{}" w:value="{}"/>"#,
                                escape_xml(display_text),
                                escape_xml(value)
                            ))
                        })
                        .collect::<String>()
                })
                .unwrap_or_default();
            let last_value = field.value.as_deref().map(str::trim).filter(|v| !v.is_empty());
            properties.push(format!(
                "<w:dropDownList>{options_xml}{}</w:dropDownList>",
                last_value
                    .map(|value| format!(r#"<w:lastValue w:val="{}"/>"#, escape_xml(value)))
                    .unwrap_or_default()
            ));
            display_value = resolve_dropdown_display_value(field);
        }
        FormFieldType::Date => {
            let normalized_date = field.value.as_deref().map(str::trim).filter(|v| !v.is_empty());
            properties.push(format!(
                "<w:date>{}</w:date>",
                normalized_date
                    .map(|value| format!(r#"<w:fullDate w:val="{}"/>"#, escape_xml(value)))
                    .unwrap_or_default()
            ));
            display_value = normalized_date.unwrap_or("").to_string();
        }
        FormFieldType::Text => {
            properties.push("<w:text/>".to_string());
            display_value = field.value.clone().unwrap_or_default();
        }
    }

    let properties_xml = if properties.is_empty() {
        "<w:sdtPr/>".to_string()
    } else {
        format!("<w:sdtPr>{}</w:sdtPr>", properties.join(""))
    };
    let content_xml = format!(
        "<w:sdtContent><w:r>{}{}</w:r></w:sdtContent>",
        run_properties_xml(field.style.as_ref()),
        render_text_tokens(&display_value)
    );
    let sdt_xml = format!("<w:sdt>{properties_xml}{content_xml}</w:sdt>");
    wrap_with_hyperlink_xml(&sdt_xml, field.link.as_deref(), state)
}

fn paragraph_xml(
    paragraph: &ParagraphNode,
    state: &mut ImageSerializationState<'_>,
    run_id_ref: &mut i64,
) -> String {
    if let Some(source_xml) = &paragraph.source_xml {
        return source_xml.clone();
    }

    let runs = paragraph
        .children
        .iter()
        .filter_map(|child| {
            let xml = match child {
                ParagraphChildNode::Text(text_run) => {
                    let run_xml = format!(
                        "<w:r>{}{}</w:r>",
                        run_properties_xml(text_run.style.as_ref()),
                        render_text_tokens(&text_run.text)
                    );
                    wrap_with_hyperlink_xml(&run_xml, text_run.link.as_deref(), state)
                }
                ParagraphChildNode::FormField(form_field) => form_field_run_xml(form_field, state),
                ParagraphChildNode::Image(image) => {
                    *run_id_ref += 1;
                    drawing_run_xml(image, state, *run_id_ref)
                }
            };
            if xml.is_empty() {
                None
            } else {
                Some(xml)
            }
        })
        .collect::<String>();

    let paragraph_runs = if runs.is_empty() {
        "<w:r><w:t/></w:r>".to_string()
    } else {
        runs
    };
    format!(
        "<w:p>{}{}</w:p>",
        paragraph_properties_xml(paragraph.style.as_ref()),
        paragraph_runs
    )
}

fn table_cell_xml_content(
    nodes: &[TableCellContentNode],
    state: &mut ImageSerializationState<'_>,
    run_id_ref: &mut i64,
) -> String {
    nodes
        .iter()
        .map(|node| match node {
            TableCellContentNode::Paragraph(paragraph) => {
                paragraph_xml(paragraph, state, run_id_ref)
            }
            TableCellContentNode::Table(table) => table_xml(table, state, run_id_ref),
        })
        .collect()
}

fn table_layout_str(layout: TableLayout) -> &'static str {
    match layout {
        TableLayout::Fixed => "fixed",
        TableLayout::Autofit => "autofit",
    }
}

fn table_row_height_rule_str(rule: TableRowHeightRule) -> &'static str {
    match rule {
        TableRowHeightRule::Auto => "auto",
        TableRowHeightRule::AtLeast => "atLeast",
        TableRowHeightRule::Exact => "exact",
    }
}

fn table_cell_vertical_align_str(align: TableCellVerticalAlign) -> &'static str {
    match align {
        TableCellVerticalAlign::Top => "top",
        TableCellVerticalAlign::Center => "center",
        TableCellVerticalAlign::Bottom => "bottom",
    }
}

fn table_xml(table: &TableNode, state: &mut ImageSerializationState<'_>, run_id_ref: &mut i64) -> String {
    if let Some(source_xml) = &table.source_xml {
        return source_xml.clone();
    }

    let mut table_props: Vec<String> = Vec::new();
    if let Some(table_width_twips) = twips_to_xml(table.style.as_ref().and_then(|s| s.width_twips)) {
        table_props.push(format!(
            r#"<w:tblW w:w="{table_width_twips}" w:type="dxa"/>"#
        ));
    } else {
        table_props.push(r#"<w:tblW w:w="0" w:type="auto"/>"#.to_string());
    }

    if let Some(table_indent_twips) = twips_to_xml(table.style.as_ref().and_then(|s| s.indent_twips))
    {
        table_props.push(format!(
            r#"<w:tblInd w:w="{table_indent_twips}" w:type="dxa"/>"#
        ));
    }

    if let Some(layout) = table.style.as_ref().and_then(|s| s.layout) {
        table_props.push(format!(
            r#"<w:tblLayout w:type="{}"/>"#,
            table_layout_str(layout)
        ));
    }

    if let Some(table_cell_spacing_twips) =
        twips_to_xml_non_negative(table.style.as_ref().and_then(|s| s.cell_spacing_twips))
    {
        table_props.push(format!(
            r#"<w:tblCellSpacing w:w="{table_cell_spacing_twips}" w:type="dxa"/>"#
        ));
    }

    let table_cell_margin_xml = table_box_spacing_xml(
        table.style.as_ref().and_then(|s| s.cell_margin_twips.as_ref()),
        "w:tblCellMar",
    );
    if !table_cell_margin_xml.is_empty() {
        table_props.push(table_cell_margin_xml);
    }
    let table_border_xml = table_borders_xml(
        table.style.as_ref().and_then(|s| s.borders.as_ref()),
        "w:tblBorders",
    );
    if !table_border_xml.is_empty() {
        table_props.push(table_border_xml);
    }

    let table_grid_xml = table
        .style
        .as_ref()
        .and_then(|s| s.column_widths_twips.as_ref())
        .filter(|widths| !widths.is_empty())
        .map(|widths| {
            let cols = widths
                .iter()
                .filter_map(|width| twips_to_xml(Some(*width)))
                .map(|width| format!(r#"<w:gridCol w:w="{width}"/>"#))
                .collect::<String>();
            format!("<w:tblGrid>{cols}</w:tblGrid>")
        })
        .unwrap_or_default();

    let rows = table
        .rows
        .iter()
        .map(|row| {
            let mut row_props: Vec<String> = Vec::new();
            if let Some(background_color) = row.style.as_ref().and_then(|s| s.background_color.as_ref())
            {
                let fill = background_color.replace('#', "");
                row_props.push(format!(
                    r#"<w:shd w:val="clear" w:color="auto" w:fill="{fill}"/>"#
                ));
            }
            if let Some(row_height_twips) =
                twips_to_xml(row.style.as_ref().and_then(|s| s.height_twips))
            {
                let h_rule = row
                    .style
                    .as_ref()
                    .and_then(|s| s.height_rule)
                    .filter(|rule| {
                        matches!(
                            rule,
                            TableRowHeightRule::Exact
                                | TableRowHeightRule::AtLeast
                                | TableRowHeightRule::Auto
                        )
                    })
                    .map(|rule| format!(r#" w:hRule="{}""#, table_row_height_rule_str(rule)))
                    .unwrap_or_default();
                row_props.push(format!(
                    r#"<w:trHeight w:val="{row_height_twips}"{h_rule}/>"#
                ));
            }
            if row.style.as_ref().and_then(|s| s.cant_split) == Some(true) {
                row_props.push("<w:cantSplit/>".to_string());
            }

            let cells = row
                .cells
                .iter()
                .map(|cell| {
                    let serialized_cells =
                        table_cell_xml_content(&cell.nodes, state, run_id_ref);

                    let mut cell_props: Vec<String> = Vec::new();
                    if let Some(cell_width_twips) =
                        twips_to_xml(cell.style.as_ref().and_then(|s| s.width_twips))
                    {
                        cell_props.push(format!(
                            r#"<w:tcW w:w="{cell_width_twips}" w:type="dxa"/>"#
                        ));
                    }
                    if let Some(background_color) =
                        cell.style.as_ref().and_then(|s| s.background_color.as_ref())
                    {
                        let fill = background_color.replace('#', "");
                        cell_props.push(format!(
                            r#"<w:shd w:val="clear" w:color="auto" w:fill="{fill}"/>"#
                        ));
                    }
                    if let Some(grid_span) = cell.style.as_ref().and_then(|s| s.grid_span) {
                        if grid_span > 1 {
                            cell_props.push(format!(r#"<w:gridSpan w:val="{grid_span}"/>"#));
                        }
                    }
                    let cell_margin_xml = table_box_spacing_xml(
                        cell.style.as_ref().and_then(|s| s.margin_twips.as_ref()),
                        "w:tcMar",
                    );
                    if !cell_margin_xml.is_empty() {
                        cell_props.push(cell_margin_xml);
                    }
                    let cell_border_xml = table_borders_xml(
                        cell.style.as_ref().and_then(|s| s.borders.as_ref()),
                        "w:tcBorders",
                    );
                    if !cell_border_xml.is_empty() {
                        cell_props.push(cell_border_xml);
                    }
                    if let Some(vertical_align) =
                        cell.style.as_ref().and_then(|s| s.vertical_align)
                    {
                        if matches!(
                            vertical_align,
                            TableCellVerticalAlign::Top
                                | TableCellVerticalAlign::Center
                                | TableCellVerticalAlign::Bottom
                        ) {
                            cell_props.push(format!(
                                r#"<w:vAlign w:val="{}"/>"#,
                                table_cell_vertical_align_str(vertical_align)
                            ));
                        }
                    }

                    let tc_pr = if cell_props.is_empty() {
                        String::new()
                    } else {
                        format!("<w:tcPr>{}</w:tcPr>", cell_props.join(""))
                    };
                    format!(
                        "<w:tc>{}{}</w:tc>",
                        tc_pr,
                        if serialized_cells.is_empty() {
                            "<w:p><w:r><w:t/></w:r></w:p>"
                        } else {
                            &serialized_cells
                        }
                    )
                })
                .collect::<String>();

            let tr_pr = if row_props.is_empty() {
                String::new()
            } else {
                format!("<w:trPr>{}</w:trPr>", row_props.join(""))
            };
            format!("<w:tr>{tr_pr}{cells}</w:tr>")
        })
        .collect::<String>();

    format!(
        "<w:tbl><w:tblPr>{}</w:tblPr>{table_grid_xml}{rows}</w:tbl>",
        table_props.join("")
    )
}

const EMPTY_RELATIONSHIPS_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>"#;

fn create_image_serialization_state<'a>(
    base_package: &'a mut OoxmlPackage,
    owner_part_name: &str,
) -> ImageSerializationState<'a> {
    let relationship_part_name = relationship_part_name_for_word_part(owner_part_name);
    let relationships_xml = base_package
        .parts
        .get(&relationship_part_name)
        .map(|part| part.content.as_str())
        .unwrap_or(EMPTY_RELATIONSHIPS_XML);

    let relationships = parse_relationships_xml(relationships_xml);
    let relationship_by_target = relationships
        .iter()
        .map(|relationship| (relationship.target.clone(), relationship.clone()))
        .collect::<HashMap<_, _>>();

    let used_image_numbers = base_package
        .binary_assets
        .keys()
        .filter_map(|part_name| {
            let lower = part_name.to_ascii_lowercase();
            let prefix = "word/media/image";
            if !lower.starts_with(prefix) {
                return None;
            }
            let rest = &lower[prefix.len()..];
            let dot = rest.find('.')?;
            rest[..dot].parse::<i64>().ok()
        })
        .collect::<Vec<_>>();

    let next_image_index = used_image_numbers
        .iter()
        .copied()
        .max()
        .unwrap_or(0)
        .max(0)
        + 1;

    ImageSerializationState {
        next_image_index: next_image_index.max(1),
        next_relationship_index: next_relationship_index(&relationships),
        relationships,
        relationship_by_target,
        pkg: base_package,
    }
}

fn has_xmlns_prefix(open_tag: &str, prefix: &str) -> bool {
    let patterns = [
        format!(" xmlns:{prefix}=\""),
        format!(" xmlns:{prefix}='"),
    ];
    patterns.iter().any(|pattern| {
        open_tag
            .as_bytes()
            .windows(pattern.len())
            .any(|window| window.eq_ignore_ascii_case(pattern.as_bytes()))
    })
}

fn ensure_namespace(open_tag: &str, prefix: &str, namespace: &str) -> String {
    if has_xmlns_prefix(open_tag, prefix) {
        return open_tag.to_string();
    }

    if open_tag.ends_with('>') {
        format!(
            "{} xmlns:{prefix}=\"{namespace}\">",
            &open_tag[..open_tag.len() - 1]
        )
    } else {
        open_tag.to_string()
    }
}

fn ensure_ignorable_prefix(open_tag: &str, prefix: &str) -> String {
    let lower = open_tag.to_ascii_lowercase();
    let marker = " mc:ignorable=";
    if let Some(start) = lower.find(marker) {
        let quote_byte = open_tag.as_bytes()[start + marker.len()];
        let quote = quote_byte as char;
        let value_start = start + marker.len() + 1;
        let value_end = open_tag[value_start..]
            .find(quote)
            .map(|index| value_start + index)
            .unwrap_or(open_tag.len());
        let current_value = &open_tag[value_start..value_end];
        let tokens: Vec<&str> = current_value
            .split_whitespace()
            .map(str::trim)
            .filter(|token| !token.is_empty())
            .collect();
        if tokens.iter().any(|token| *token == prefix) {
            return open_tag.to_string();
        }
        let updated_value = if tokens.is_empty() {
            prefix.to_string()
        } else {
            format!("{} {}", tokens.join(" "), prefix)
        };
        return format!(
            "{} mc:Ignorable={}{}{}{}",
            &open_tag[..start],
            quote,
            updated_value,
            quote,
            &open_tag[value_end + 1..]
        );
    }

    if open_tag.ends_with('>') {
        format!(
            "{} mc:Ignorable=\"{prefix}\">",
            &open_tag[..open_tag.len() - 1]
        )
    } else {
        open_tag.to_string()
    }
}

fn ensure_word_section_part_open_tag(existing_part_content: Option<&str>, root_tag_name: &str) -> String {
    let existing_open_tag = existing_part_content.and_then(|content| {
        let pattern = format!("<{root_tag_name}");
        let start = content.find(&pattern)?;
        let end = content[start..].find('>')?;
        Some(content[start..start + end + 1].to_string())
    });

    let mut open_tag = existing_open_tag.unwrap_or_else(|| {
        format!(
            r#"<{root_tag_name} xmlns:w="{WORD_MAIN_NS}" xmlns:r="{OFFICE_REL_NS}">"#
        )
    });

    open_tag = ensure_namespace(&open_tag, "w", WORD_MAIN_NS);
    open_tag = ensure_namespace(&open_tag, "r", OFFICE_REL_NS);
    open_tag = ensure_namespace(&open_tag, "a", DRAWING_MAIN_NS);
    open_tag = ensure_namespace(&open_tag, "wp", DRAWING_WORD_NS);
    open_tag = ensure_namespace(&open_tag, "pic", DRAWING_PICTURE_NS);
    open_tag = ensure_namespace(&open_tag, "w14", WORD_2010_NS);
    open_tag = ensure_namespace(&open_tag, "mc", MARKUP_COMPATIBILITY_NS);
    open_tag = ensure_ignorable_prefix(&open_tag, "w14");
    open_tag
}

fn serialize_section_part_xml(
    section_nodes: &[DocNode],
    root_tag_name: &str,
    part_name: &str,
    pkg: &mut OoxmlPackage,
) -> (String, Vec<Relationship>) {
    let existing_content = pkg
        .parts
        .get(part_name)
        .map(|part| part.content.clone());
    let (body_xml, relationships) = {
        let mut state = create_image_serialization_state(pkg, part_name);
        let mut run_id_ref = 1i64;
        let body_xml = section_nodes
            .iter()
            .map(|node| match node {
                DocNode::Paragraph(paragraph) => {
                    paragraph_xml(paragraph, &mut state, &mut run_id_ref)
                }
                DocNode::Table(table) => table_xml(table, &mut state, &mut run_id_ref),
            })
            .collect::<String>();
        (body_xml, state.relationships)
    };
    let open_tag = ensure_word_section_part_open_tag(existing_content.as_deref(), root_tag_name);
    let xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>{open_tag}{body_xml}</{root_tag_name}>"#
    );
    (xml, relationships)
}

fn section_root_tag_name_for_part_name(part_name: &str) -> &'static str {
    if part_name.to_ascii_lowercase().contains("header") {
        "w:hdr"
    } else {
        "w:ftr"
    }
}

fn serialize_header_footer_parts(model: &DocModel, pkg: &mut OoxmlPackage) {
    let mut sections_by_part_name: HashMap<String, Vec<DocNode>> = HashMap::new();

    let mut add_part_sections = |sections: &[(String, Vec<DocNode>)]| {
        for (part_name, nodes) in sections {
            let normalized_part_name = normalize_word_part_name(part_name);
            if normalized_part_name.is_empty()
                || sections_by_part_name.contains_key(&normalized_part_name)
            {
                continue;
            }
            sections_by_part_name.insert(normalized_part_name, nodes.clone());
        }
    };

    add_part_sections(
        &model
            .metadata
            .header_sections
            .iter()
            .map(|section| (section.part_name.clone(), section.nodes.clone()))
            .collect::<Vec<_>>(),
    );
    add_part_sections(
        &model
            .metadata
            .footer_sections
            .iter()
            .map(|section| (section.part_name.clone(), section.nodes.clone()))
            .collect::<Vec<_>>(),
    );
    if let Some(sections) = &model.metadata.sections {
        for section in sections {
            add_part_sections(
                &section
                    .header_sections
                    .iter()
                    .map(|header| (header.part_name.clone(), header.nodes.clone()))
                    .collect::<Vec<_>>(),
            );
            add_part_sections(
                &section
                    .footer_sections
                    .iter()
                    .map(|footer| (footer.part_name.clone(), footer.nodes.clone()))
                    .collect::<Vec<_>>(),
            );
        }
    }

    let part_names: Vec<String> = sections_by_part_name.keys().cloned().collect();
    for part_name in part_names {
        let nodes = sections_by_part_name
            .remove(&part_name)
            .unwrap_or_default();
        let root_tag_name = section_root_tag_name_for_part_name(&part_name);
        let (xml, relationships) =
            serialize_section_part_xml(&nodes, root_tag_name, &part_name, pkg);
        pkg.parts.insert(
            part_name.clone(),
            OoxmlPart {
                name: part_name.clone(),
                content: xml,
            },
        );
        let relationship_part_name = relationship_part_name_for_word_part(&part_name);
        pkg.parts.insert(
            relationship_part_name.clone(),
            OoxmlPart {
                name: relationship_part_name,
                content: render_relationships_xml(&relationships),
            },
        );
    }
}

fn ensure_document_open_tag(model: &DocModel) -> String {
    let mut open_tag = model.metadata.document_open_tag.clone().unwrap_or_else(|| {
        format!(r#"<w:document xmlns:w="{WORD_MAIN_NS}" xmlns:r="{OFFICE_REL_NS}">"#)
    });

    open_tag = ensure_namespace(&open_tag, "w", WORD_MAIN_NS);
    open_tag = ensure_namespace(&open_tag, "r", OFFICE_REL_NS);
    open_tag = ensure_namespace(&open_tag, "a", DRAWING_MAIN_NS);
    open_tag = ensure_namespace(&open_tag, "wp", DRAWING_WORD_NS);
    open_tag = ensure_namespace(&open_tag, "pic", DRAWING_PICTURE_NS);
    open_tag = ensure_namespace(&open_tag, "w14", WORD_2010_NS);
    open_tag = ensure_namespace(&open_tag, "mc", MARKUP_COMPATIBILITY_NS);
    open_tag = ensure_ignorable_prefix(&open_tag, "w14");
    open_tag
}

fn model_to_document_xml_with_pkg(model: &DocModel, pkg: &mut OoxmlPackage) -> String {
    let document_part_name = "word/document.xml";
    let (body_xml, relationships) = {
        let mut state = create_image_serialization_state(pkg, document_part_name);
        let mut run_id_ref = 1i64;
        let body_xml = model
            .nodes
            .iter()
            .map(|node| match node {
                DocNode::Paragraph(paragraph) => {
                    paragraph_xml(paragraph, &mut state, &mut run_id_ref)
                }
                DocNode::Table(table) => table_xml(table, &mut state, &mut run_id_ref),
            })
            .collect::<String>();
        (body_xml, state.relationships)
    };

    let document_relationship_part_name =
        relationship_part_name_for_word_part(document_part_name);
    pkg.parts.insert(
        document_relationship_part_name.clone(),
        OoxmlPart {
            name: document_relationship_part_name,
            content: render_relationships_xml(&relationships),
        },
    );

    let document_open_tag = ensure_document_open_tag(model);
    let section_properties_xml = model
        .metadata
        .section_properties_xml
        .as_deref()
        .unwrap_or(DEFAULT_SECTION_PROPERTIES_XML);

    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>{document_open_tag}<w:body>{body_xml}{section_properties_xml}</w:body></w:document>"#
    )
}

pub fn model_to_document_xml(model: &DocModel, base_package: Option<&OoxmlPackage>) -> String {
    let mut pkg = base_package.cloned().unwrap_or_else(|| {
        create_minimal_docx_package(Some(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t/></w:r></w:p></w:body></w:document>"#,
        ))
    });
    model_to_document_xml_with_pkg(model, &mut pkg)
}

pub fn serialize_doc_model(model: &DocModel, base_package: Option<&OoxmlPackage>) -> OoxmlPackage {
    let mut seed = base_package
        .cloned()
        .unwrap_or_else(|| create_minimal_docx_package(None));
    let document_xml = model_to_document_xml_with_pkg(model, &mut seed);
    let with_document = with_part(
        &seed,
        OoxmlPart {
            name: "word/document.xml".to_string(),
            content: document_xml,
        },
    );
    let mut result = with_document;
    serialize_header_footer_parts(model, &mut result);
    result
}

pub fn serialize_docx(model: &DocModel, base_package: Option<&OoxmlPackage>) -> Result<Vec<u8>, String> {
    package_to_bytes(&serialize_doc_model(model, base_package))
}
