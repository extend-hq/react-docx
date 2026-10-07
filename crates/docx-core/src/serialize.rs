//! DOCX serializer ported from `packages/serializer/src/index.ts`.

use std::collections::HashMap;

use crate::model::*;
use crate::package::{with_part, OoxmlPackage, OoxmlPart};
use crate::xml::{decode_xml_entities, extract_balanced_tag_ranges, get_attribute};
use crate::zip::{create_minimal_docx_package, package_to_bytes};

const REL_TYPE_IMAGE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const REL_TYPE_HYPERLINK: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const REL_TYPE_COMMENTS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
const REL_TYPE_COMMENTS_EXTENDED: &str =
    "http://schemas.microsoft.com/office/2011/relationships/commentsExtended";
const REL_TYPE_SETTINGS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings";
const RELS_XMLNS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
const WORD_MAIN_NS: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const OFFICE_REL_NS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const DRAWING_MAIN_NS: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
const DRAWING_WORD_NS: &str =
    "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const DRAWING_PICTURE_NS: &str = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const WORD_2010_NS: &str = "http://schemas.microsoft.com/office/word/2010/wordml";
const WORD_2012_NS: &str = "http://schemas.microsoft.com/office/word/2012/wordml";
const MARKUP_COMPATIBILITY_NS: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";

const COMMENTS_CONTENT_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml";
const COMMENTS_EXTENDED_CONTENT_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml";
const SETTINGS_CONTENT_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml";

const SETTINGS_TAIL_ORDER: &[&str] = &[
    "w:defaultTabStop", "w:autoHyphenation", "w:consecutiveHyphenLimit",
    "w:hyphenationZone", "w:doNotHyphenateCaps", "w:showEnvelope",
    "w:summaryLength", "w:clickAndTypeStyle", "w:defaultTableStyle",
    "w:evenAndOddHeaders", "w:bookFoldRevPrinting", "w:bookFoldPrinting",
    "w:bookFoldPrintingSheets", "w:drawingGridHorizontalSpacing",
    "w:drawingGridVerticalSpacing", "w:displayHorizontalDrawingGridEvery",
    "w:displayVerticalDrawingGridEvery", "w:doNotUseMarginsForDrawingGridOrigin",
    "w:drawingGridHorizontalOrigin", "w:drawingGridVerticalOrigin",
    "w:doNotShadeFormData", "w:noPunctuationKerning", "w:characterSpacingControl",
    "w:printTwoOnOne", "w:strictFirstAndLastChars", "w:noLineBreaksAfter",
    "w:noLineBreaksBefore", "w:savePreviewPicture", "w:doNotValidateAgainstSchema",
    "w:saveInvalidXml", "w:ignoreMixedContent", "w:alwaysShowPlaceholderText",
    "w:doNotDemarcateInvalidXml", "w:saveXmlDataOnly", "w:useXSLTWhenSaving",
    "w:saveThroughXslt", "w:showXMLTags", "w:alwaysMergeEmptyNamespace",
    "w:updateFields", "w:hdrShapeDefaults", "w:footnotePr", "w:endnotePr",
    "w:compat", "w:docVars", "w:rsids", "m:mathPr", "w:uiCompat97To2003",
    "w:attachedSchema", "w:themeFontLang", "w:clrSchemeMapping",
    "w:doNotIncludeSubdocsInStats", "w:doNotAutoCompressPictures", "w:forceUpgrade",
    "w:captions", "w:readModeInkLockDown", "sl:schemaLibrary", "w:shapeDefaults",
    "w:decimalSymbol", "w:listSeparator", "w14:docId", "w14:discardImageEditingData",
    "w14:defaultImageDpi", "w14:conflictMode", "w15:chartTrackingRefBased", "w15:docId",
];

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
    paragraph_text_alignment_by_style_id: HashMap<String, ParagraphTextAlignment>,
    default_paragraph_text_alignment: Option<ParagraphTextAlignment>,
    paragraph_style_alignment_owners: HashMap<String, ParagraphTextAlignment>,
    table_styles: HashMap<String, crate::parse::ParsedTableStyleDefinition>,
    current_table_text_alignment: Option<ParagraphTextAlignment>,
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
    if let Some(font_size_pt) = style.font_size_cs_pt {
        if font_size_pt.is_finite() {
            fragments.push(format!(
                r#"<w:szCs w:val="{}"/>"#,
                (font_size_pt * 2.0).round() as i64
            ));
        }
    }

    let has_explicit_font_slots = style.font_family_ascii.is_some()
        || style.font_family_h_ansi.is_some()
        || style.font_family_east_asia.is_some()
        || style.font_family_cs.is_some()
        || style.font_theme_ascii.is_some()
        || style.font_theme_h_ansi.is_some()
        || style.font_theme_east_asia.is_some()
        || style.font_theme_cs.is_some()
        || style.font_hint.is_some();
    let font_family_was_edited = style.source_font_family.is_some()
        && style.font_family.as_deref() != style.source_font_family.as_deref();
    let mut font_attrs = Vec::new();
    if font_family_was_edited {
        if let Some(font_family) = &style.font_family {
            let escaped_font = escape_xml(font_family);
            font_attrs.extend([
                format!(r#"w:ascii="{escaped_font}""#),
                format!(r#"w:hAnsi="{escaped_font}""#),
                format!(r#"w:cs="{escaped_font}""#),
            ]);
        }
    } else if has_explicit_font_slots {
        for (name, value) in [
            ("w:ascii", style.font_family_ascii.as_deref()),
            ("w:hAnsi", style.font_family_h_ansi.as_deref()),
            ("w:eastAsia", style.font_family_east_asia.as_deref()),
            ("w:cs", style.font_family_cs.as_deref()),
            ("w:asciiTheme", style.font_theme_ascii.as_deref()),
            ("w:hAnsiTheme", style.font_theme_h_ansi.as_deref()),
            ("w:eastAsiaTheme", style.font_theme_east_asia.as_deref()),
            ("w:csTheme", style.font_theme_cs.as_deref()),
            ("w:hint", style.font_hint.as_deref()),
        ] {
            if let Some(value) = value {
                font_attrs.push(format!(r#"{name}="{}""#, escape_xml(value)));
            }
        }
    } else if let Some(font_family) = &style.font_family {
        let escaped_font = escape_xml(font_family);
        font_attrs.extend([
            format!(r#"w:ascii="{escaped_font}""#),
            format!(r#"w:hAnsi="{escaped_font}""#),
            format!(r#"w:cs="{escaped_font}""#),
        ]);
    }
    if !font_attrs.is_empty() {
        fragments.push(format!("<w:rFonts {}/>", font_attrs.join(" ")));
    }

    let mut language_attrs = Vec::new();
    for (name, value) in [
        ("w:val", style.language.as_deref()),
        ("w:eastAsia", style.language_east_asia.as_deref()),
        ("w:bidi", style.language_bidi.as_deref()),
    ] {
        if let Some(value) = value {
            language_attrs.push(format!(r#"{name}="{}""#, escape_xml(value)));
        }
    }
    if !language_attrs.is_empty() {
        fragments.push(format!("<w:lang {}/>", language_attrs.join(" ")));
    }

    if let Some(right_to_left) = style.right_to_left {
        fragments.push(if right_to_left {
            "<w:rtl/>".to_string()
        } else {
            r#"<w:rtl w:val="0"/>"#.to_string()
        });
    }
    if let Some(complex_script) = style.complex_script {
        fragments.push(if complex_script {
            "<w:cs/>".to_string()
        } else {
            r#"<w:cs w:val="0"/>"#.to_string()
        });
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

fn tab_stop_alignment_str(alignment: ParagraphTabStopAlignment) -> &'static str {
    match alignment {
        ParagraphTabStopAlignment::Left => "left",
        ParagraphTabStopAlignment::Center => "center",
        ParagraphTabStopAlignment::Right => "right",
        ParagraphTabStopAlignment::Decimal => "decimal",
        ParagraphTabStopAlignment::Bar => "bar",
    }
}

fn tab_stop_leader_str(leader: ParagraphTabStopLeader) -> &'static str {
    match leader {
        ParagraphTabStopLeader::LeaderNone => "none",
        ParagraphTabStopLeader::Dot => "dot",
        ParagraphTabStopLeader::Hyphen => "hyphen",
        ParagraphTabStopLeader::Underscore => "underscore",
        ParagraphTabStopLeader::MiddleDot => "middleDot",
    }
}

fn on_off_element_xml(tag_name: &str, value: Option<bool>) -> String {
    match value {
        Some(true) => format!("<w:{tag_name}/>"),
        Some(false) => format!(r#"<w:{tag_name} w:val="0"/>"#),
        None => String::new(),
    }
}

fn paragraph_properties_xml(style: Option<&ParagraphStyle>, text_alignment: Option<ParagraphTextAlignment>) -> String {
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

    for fragment in [
        on_off_element_xml("keepNext", style.keep_next),
        on_off_element_xml("keepLines", style.keep_lines),
        on_off_element_xml("pageBreakBefore", style.page_break_before),
    ] {
        if !fragment.is_empty() {
            fragments.push(fragment);
        }
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

    let widow_control_xml = on_off_element_xml("widowControl", style.widow_control);
    if !widow_control_xml.is_empty() {
        fragments.push(widow_control_xml);
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

    let paragraph_border_xml = paragraph_borders_xml(style.borders.as_ref());
    if !paragraph_border_xml.is_empty() {
        fragments.push(paragraph_border_xml);
    }

    if let Some(background_color) = &style.background_color {
        let fill = background_color.replace('#', "").to_ascii_uppercase();
        if !fill.is_empty() {
            fragments.push(format!(
                r#"<w:shd w:val="clear" w:color="auto" w:fill="{}"/>"#,
                escape_xml(&fill)
            ));
        }
    }

    if let Some(tab_stops) = &style.tab_stops {
        let tabs = tab_stops
            .iter()
            .filter_map(|tab_stop| {
                let position = tab_stop.position_twips?;
                let alignment = tab_stop_alignment_str(
                    tab_stop.alignment.unwrap_or(ParagraphTabStopAlignment::Left),
                );
                let leader = tab_stop
                    .leader
                    .filter(|leader| *leader != ParagraphTabStopLeader::LeaderNone)
                    .map(|leader| format!(r#" w:leader="{}""#, tab_stop_leader_str(leader)))
                    .unwrap_or_default();
                Some(format!(
                    r#"<w:tab w:val="{alignment}"{leader} w:pos="{position}"/>"#
                ))
            })
            .collect::<Vec<_>>();
        if !tabs.is_empty() {
            fragments.push(format!("<w:tabs>{}</w:tabs>", tabs.join("")));
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

    let contextual_spacing_xml =
        on_off_element_xml("contextualSpacing", style.contextual_spacing);
    if !contextual_spacing_xml.is_empty() {
        fragments.push(contextual_spacing_xml);
    }

    if let Some(align) = style.align {
        fragments.push(format!(
            r#"<w:jc w:val="{}"/>"#,
            paragraph_alignment_str(align)
        ));
    }

    if let Some(text_alignment) = text_alignment {
        fragments.push(format!(r#"<w:textAlignment w:val="{}"/>"#, paragraph_text_alignment_str(text_alignment)));
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

    let top = twips_to_xml_non_negative(spacing.top_twips);
    let right = twips_to_xml_non_negative(spacing.right_twips);
    let bottom = twips_to_xml_non_negative(spacing.bottom_twips);
    let left = twips_to_xml_non_negative(spacing.left_twips);

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

        let id = extract_attribute(tag, "Id").map(|value| decode_xml_entities(&value));
        let rel_type = extract_attribute(tag, "Type").map(|value| decode_xml_entities(&value));
        let target = extract_attribute(tag, "Target").map(|value| decode_xml_entities(&value));
        let target_mode =
            extract_attribute(tag, "TargetMode").map(|value| decode_xml_entities(&value));

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

fn ensure_content_type_override(pkg: &mut OoxmlPackage, part_name: &str, content_type: &str) {
    let Some(part) = pkg.parts.get("[Content_Types].xml").cloned() else {
        return;
    };
    let normalized_part_name = if part_name.starts_with('/') {
        part_name.to_string()
    } else {
        format!("/{part_name}")
    };
    for range in extract_balanced_tag_ranges(&part.content, "Override") {
        let Some(open_end) = opening_tag_end(&part.content, range.start) else {
            continue;
        };
        let open_tag = &part.content[range.start..open_end];
        if !get_attribute(open_tag, "PartName")
            .is_some_and(|value| value.eq_ignore_ascii_case(&normalized_part_name))
        {
            continue;
        }
        if get_attribute(open_tag, "ContentType").as_deref() == Some(content_type) {
            return;
        }
        let updated_open_tag = set_xml_attribute(open_tag, "ContentType", content_type);
        let mut updated = part.content.clone();
        updated.replace_range(range.start..open_end, &updated_open_tag);
        pkg.parts.insert(
            "[Content_Types].xml".to_string(),
            OoxmlPart {
                name: "[Content_Types].xml".to_string(),
                content: updated,
            },
        );
        return;
    }

    let entry = format!(
        r#"<Override PartName="{}" ContentType="{}"/>"#,
        escape_xml(&normalized_part_name),
        escape_xml(content_type)
    );
    let updated = if let Some(index) = part.content.rfind("</Types>") {
        format!("{}{}{}", &part.content[..index], entry, &part.content[index..])
    } else {
        part.content
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

fn source_run_text(run_xml: &str) -> Option<String> {
    let tokens = crate::parse::parse_run_text_tokens(run_xml);
    if tokens.len() != 1 || tokens[0].note_reference.is_some() {
        return None;
    }

    let text_ranges = extract_balanced_tag_ranges(run_xml, "w:t");
    if text_ranges.len() != 1 {
        return None;
    }

    Some(tokens[0].text.clone())
}

fn ensure_xml_space_preserve(opening_tag: &str) -> String {
    let lower = opening_tag.to_ascii_lowercase();
    let needle = "xml:space";
    let mut search_from = 0usize;

    while let Some(relative_start) = lower[search_from..].find(needle) {
        let attribute_start = search_from + relative_start;
        let before_is_boundary = attribute_start == 0
            || opening_tag.as_bytes()[attribute_start - 1].is_ascii_whitespace();
        let mut cursor = attribute_start + needle.len();
        while opening_tag
            .as_bytes()
            .get(cursor)
            .is_some_and(|byte| byte.is_ascii_whitespace())
        {
            cursor += 1;
        }
        if before_is_boundary && opening_tag.as_bytes().get(cursor) == Some(&b'=') {
            cursor += 1;
            while opening_tag
                .as_bytes()
                .get(cursor)
                .is_some_and(|byte| byte.is_ascii_whitespace())
            {
                cursor += 1;
            }
            let quote = opening_tag.as_bytes().get(cursor).copied();
            if quote == Some(b'\'') || quote == Some(b'"') {
                let quote = quote.unwrap_or(b'"');
                let value_start = cursor + 1;
                let value_end = opening_tag.as_bytes()[value_start..]
                    .iter()
                    .position(|byte| *byte == quote)
                    .map(|offset| value_start + offset);
                if let Some(value_end) = value_end {
                    let mut updated = opening_tag.to_string();
                    updated.replace_range(value_start..value_end, "preserve");
                    return updated;
                }
            }
        }
        search_from = attribute_start + needle.len();
    }

    let mut updated = opening_tag.to_string();
    updated.insert_str(updated.len() - 1, r#" xml:space="preserve""#);
    updated
}

fn replace_source_run_text(run_xml: &str, text: &str) -> Option<String> {
    let text_range = extract_balanced_tag_ranges(run_xml, "w:t")
        .into_iter()
        .next()?;
    let source_text_tag = &run_xml[text_range.start..text_range.end];

    let replacement = if text.contains(['\n', '\t']) || source_text_tag.trim_end().ends_with("/>") {
        render_text_tokens(text)
    } else {
        let opening_end = source_text_tag.find('>')?;
        let closing_start = source_text_tag.rfind("</w:t")?;
        if closing_start < opening_end {
            return None;
        }

        let mut opening_tag = source_text_tag[..=opening_end].to_string();
        if should_preserve_whitespace(text) {
            opening_tag = ensure_xml_space_preserve(&opening_tag);
        }
        format!(
            "{opening_tag}{}{closing_tag}",
            escape_xml(text),
            closing_tag = &source_text_tag[closing_start..]
        )
    };

    let mut patched = String::with_capacity(run_xml.len() + replacement.len());
    patched.push_str(&run_xml[..text_range.start]);
    patched.push_str(&replacement);
    patched.push_str(&run_xml[text_range.end..]);
    Some(patched)
}

/// Preserve the original paragraph and run markup for the common editing path
/// where plain text changes but the run structure and formatting do not. This
/// keeps unsupported paragraph/run properties, bookmarks, revision boundaries,
/// and extension markup intact instead of regenerating the whole paragraph from
/// the intentionally smaller public model.
fn source_text_patch_xml_is_safe(source_xml: &str) -> bool {
    let lower = source_xml.to_ascii_lowercase();
    [
        "<w:fldchar",
        "<w:fldsimple",
        "<w:instrtext",
        "<w:tab",
        "<w:br",
        "<w:cr",
        "<w:footnotereference",
        "<w:endnotereference",
        "<w:drawing",
        "<w:pict",
        "<w:object",
        "<w:sdt",
        "<w:ins",
        "<w:del",
        "<w:conflictins",
        "<w:conflictdel",
        "<w:movefrom",
        "<w:moveto",
        "<w:commentrangestart",
        "<w:commentrangeend",
        "<w:commentreference",
        "<w:bookmarkstart",
        "<w:bookmarkend",
        "<w:customxml",
        "<w:smarttag",
        "<w:permstart",
        "<w:permend",
        "<w:prooferr",
        "<w:subdoc",
        "<w:altchunk",
        "<mc:alternatecontent",
    ]
    .iter()
    .all(|marker| !lower.contains(marker))
}

fn patch_source_paragraph_text(
    paragraph: &ParagraphNode,
    source_xml: &str,
    patch_plan: &ParagraphSourceTextPatch,
) -> Option<String> {
    if !source_text_patch_xml_is_safe(source_xml) {
        return None;
    }
    let current_runs = paragraph
        .children
        .iter()
        .map(|child| match child {
            ParagraphChildNode::Text(run) => Some(run),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    let source_ranges = extract_balanced_tag_ranges(source_xml, "w:r");
    if source_ranges.len() != current_runs.len() || patch_plan.runs.len() != current_runs.len() {
        return None;
    }
    if current_runs
        .iter()
        .zip(&patch_plan.runs)
        .any(|(current, expected)| {
            current.style != expected.style
                || current.link != expected.link
                || current.note_reference != expected.note_reference
        })
    {
        return None;
    }

    let source_text = source_ranges
        .iter()
        .flat_map(|range| crate::parse::parse_run_text_tokens(&source_xml[range.start..range.end]))
        .map(|token| token.text)
        .collect::<String>();
    let current_text = current_runs
        .iter()
        .map(|run| run.text.as_str())
        .collect::<String>();

    if source_text == current_text {
        return Some(source_xml.to_string());
    }
    let mut replacements = Vec::with_capacity(source_ranges.len());
    for (range, current_run) in source_ranges.iter().zip(current_runs) {
        let source_run_xml = &source_xml[range.start..range.end];
        let original_text = source_run_text(source_run_xml)?;
        if original_text == current_run.text {
            continue;
        }
        replacements.push((
            range.start,
            range.end,
            replace_source_run_text(source_run_xml, &current_run.text)?,
        ));
    }

    let mut patched = source_xml.to_string();
    for (start, end, replacement) in replacements.into_iter().rev() {
        patched.replace_range(start..end, &replacement);
    }
    Some(patched)
}

const PARAGRAPH_MARK_TAIL_ORDER: &[&str] = &["w:rPr", "w:sectPr", "w:pPrChange"];
const MARK_PROPERTY_ORDER: &[&str] = &[
    "w:ins",
    "w:del",
    "w:moveFrom",
    "w:moveTo",
    "w14:conflictIns",
    "w14:conflictDel",
    "w:rStyle",
    "w:rFonts",
    "w:b",
    "w:bCs",
    "w:i",
    "w:iCs",
    "w:caps",
    "w:smallCaps",
    "w:strike",
    "w:dStrike",
    "w:outline",
    "w:shadow",
    "w:emboss",
    "w:imprint",
    "w:noProof",
    "w:snapToGrid",
    "w:vanish",
    "w:webHidden",
    "w:color",
    "w:spacing",
    "w:w",
    "w:kern",
    "w:position",
    "w:sz",
    "w:szCs",
    "w:highlight",
    "w:u",
    "w:effect",
    "w:bdr",
    "w:shd",
    "w:fitText",
    "w:vertAlign",
    "w:rtl",
    "w:cs",
    "w:em",
    "w:lang",
    "w:eastAsianLayout",
    "w:specVanish",
    "w:oMath",
    "w14:glow",
    "w14:shadow",
    "w14:reflection",
    "w14:textOutline",
    "w14:textFill",
    "w14:scene3d",
    "w14:props3d",
    "w14:ligatures",
    "w14:numForm",
    "w14:numSpacing",
    "w14:stylisticSets",
    "w14:cntxtAlts",
    "w:rPrChange",
];

fn direct_property_children(xml: &str) -> Vec<(String, crate::xml::TagRange)> {
    crate::xml::extract_direct_child_tag_ranges(xml)
        .into_iter()
        .map(|range| {
            (
                range.tag_name,
                crate::xml::TagRange {
                    start: range.start,
                    end: range.end,
                },
            )
        })
        .collect()
}

const MARK_MANAGED_PROPERTIES: &[&str] = &[
    "w:rFonts",
    "w:b",
    "w:i",
    "w:u",
    "w:strike",
    "w:color",
    "w:highlight",
    "w:shd",
    "w:sz",
    "w:szCs",
    "w:lang",
    "w:rtl",
    "w:cs",
    "w:spacing",
    "w:vertAlign",
    "w:bdr",
];

fn property_attributes(tag_name: &str) -> &'static [&'static str] {
    match tag_name {
        "w:rFonts" => &[
            "w:ascii",
            "w:hAnsi",
            "w:eastAsia",
            "w:cs",
            "w:asciiTheme",
            "w:hAnsiTheme",
            "w:eastAsiaTheme",
            "w:csTheme",
            "w:hint",
        ],
        "w:lang" => &["w:val", "w:eastAsia", "w:bidi"],
        "w:shd" => &["w:val", "w:color", "w:fill"],
        "w:bdr" => &["w:val", "w:color", "w:sz", "w:space", "w:frame", "w:shadow"],
        _ => &["w:val"],
    }
}

fn remove_xml_attribute(tag: &str, name: &str) -> String {
    let Some((value_start, value_end)) = attribute_value_range(tag, name) else {
        return tag.to_string();
    };
    let mut start = value_start.saturating_sub(1);
    while start > 0
        && (tag.as_bytes()[start - 1].is_ascii_whitespace() || tag.as_bytes()[start - 1] == b'=')
    {
        start -= 1;
    }
    start = start.saturating_sub(name.len());
    while start > 0 && tag.as_bytes()[start - 1].is_ascii_whitespace() {
        start -= 1;
    }
    let mut updated = tag.to_string();
    updated.replace_range(start..value_end + 1, "");
    updated
}

fn insert_property_child(
    xml: &str,
    container: &str,
    name: &str,
    child: &str,
    order: &[&str],
) -> String {
    let open_end = opening_tag_end(xml, 0).unwrap_or(xml.len());
    let opening = &xml[..open_end];
    if opening.trim_end().ends_with("/>") {
        return format!(
            "{}>{child}</{container}>",
            opening
                .trim_end()
                .trim_end_matches('>')
                .trim_end()
                .trim_end_matches('/')
                .trim_end()
        );
    }
    let mut insert_at = xml.rfind(&format!("</{container}>")).unwrap_or(xml.len());
    if let Some(rank) = order.iter().position(|value| *value == name) {
        for (other_name, range) in direct_property_children(xml) {
            if order
                .iter()
                .position(|value| *value == other_name)
                .is_some_and(|other_rank| other_rank > rank)
            {
                insert_at = insert_at.min(range.start);
            }
        }
    }
    let mut updated = xml.to_string();
    updated.insert_str(insert_at, child);
    updated
}

fn merge_mark_properties_xml(source: &str, generated: &str) -> String {
    let source_children = direct_property_children(source);
    let generated = generated.to_string();
    let generated_children = direct_property_children(&generated);
    let mut consumed = std::collections::HashSet::new();
    let mut replacements = Vec::new();
    for (name, range) in source_children {
        if !MARK_MANAGED_PROPERTIES.contains(&name.as_str()) {
            continue;
        }
        let block = &source[range.start..range.end];
        let replacement = generated_children
            .iter()
            .enumerate()
            .find(|(index, (other_name, _))| !consumed.contains(index) && *other_name == name);
        if let Some((index, (_, generated_range))) = replacement {
            consumed.insert(index);
            let generated_block = &generated[generated_range.start..generated_range.end];
            let merged = {
                let end = opening_tag_end(block, 0).unwrap_or(block.len());
                let generated_end =
                    opening_tag_end(generated_block, 0).unwrap_or(generated_block.len());
                let mut opening = block[..end].to_string();
                for attribute in property_attributes(&name) {
                    opening = if let Some(value) =
                        get_attribute(&generated_block[..generated_end], attribute)
                    {
                        set_xml_attribute(&opening, attribute, &value)
                    } else {
                        remove_xml_attribute(&opening, attribute)
                    };
                }
                format!("{opening}{}", &block[end..])
            };
            replacements.push((range.start, range.end, merged));
        } else {
            replacements.push((range.start, range.end, String::new()));
        }
    }
    let mut updated = replace_xml_ranges(source, replacements);
    for (index, (name, range)) in generated_children.iter().enumerate() {
        if !consumed.contains(&index) {
            updated = insert_property_child(
                &updated,
                "w:rPr",
                name,
                &generated[range.start..range.end],
                MARK_PROPERTY_ORDER,
            );
        }
    }
    updated
}

fn paragraph_mark_properties_xml(style: Option<&TextStyle>) -> String {
    let order = MARK_PROPERTY_ORDER;
    let mut generated = run_properties_xml(style);
    if generated.is_empty() {
        generated = "<w:rPr/>".to_string();
    }
    if let Some(style) = style {
        for (name, value) in [
            ("b", style.bold),
            ("i", style.italic),
            ("strike", style.strike),
        ] {
            if value == Some(false) {
                generated = insert_property_child(
                    &generated,
                    "w:rPr",
                    &format!("w:{name}"),
                    &on_off_element_xml(name, value),
                    order,
                );
            }
        }
        if style.underline == Some(false) {
            generated =
                insert_property_child(&generated, "w:rPr", "w:u", r#"<w:u w:val="none"/>"#, order);
        }
        if let Some(spacing) = style.character_spacing_twips {
            generated = insert_property_child(
                &generated,
                "w:rPr",
                "w:spacing",
                &format!(r#"<w:spacing w:val="{spacing}"/>"#),
                order,
            );
        }
    }
    merge_mark_properties_xml("<w:rPr/>", &generated)
}

fn paragraph_mark_xml(paragraph: &ParagraphNode, source: Option<&str>) -> String {
    if paragraph.paragraph_mark_style == paragraph.source_paragraph_mark_style
        && (source.is_some() || paragraph.source_paragraph_mark_style.is_some())
    {
        return source.unwrap_or_default().to_string();
    }
    if paragraph.paragraph_mark_style.is_none() && source.is_none() {
        return String::new();
    }
    let generated = paragraph_mark_properties_xml(paragraph.paragraph_mark_style.as_ref());
    source
        .map(|source| merge_mark_properties_xml(source, &generated))
        .unwrap_or(generated)
}

fn serialized_paragraph_text_alignment(
    style: &ParagraphStyle,
    state: &ImageSerializationState<'_>,
) -> Option<ParagraphTextAlignment> {
    let effective = style
        .text_alignment
        .or(style.source_inherited_text_alignment);
    let style_id = style.style_id.clone().or_else(|| {
        style
            .heading_level
            .map(|level| format!("Heading{}", heading_level_number(level)))
    });
    let inherited = style_id
        .as_ref()
        .and_then(|id| state.paragraph_style_alignment_owners.get(id).copied())
        .or(state.current_table_text_alignment)
        .or_else(|| {
            style_id
                .as_ref()
                .and_then(|id| state.paragraph_text_alignment_by_style_id.get(id).copied())
        })
        .or(state.default_paragraph_text_alignment);
    let inherited_only = style.text_alignment.is_none()
        || (style.source_has_text_alignment == Some(false)
            && style.text_alignment == style.source_text_alignment);
    if inherited_only && inherited == effective {
        None
    } else {
        effective
    }
}

struct TableAlignmentContext {
    style_id: Option<String>,
    look: crate::parse::ParsedTableLook,
    grid_bound: i64,
    columns: i64,
    rows: i64,
}

fn resolve_table_alignment_context(
    table: &TableNode,
    state: &ImageSerializationState<'_>,
    source_xml: Option<&str>,
) -> TableAlignmentContext {
    let style_id = table
        .style
        .as_ref()
        .and_then(|style| style.style_id.clone())
        .or_else(|| {
            if table
                .style
                .as_ref()
                .is_some_and(|style| style.source_style_id.is_some())
            {
                return None;
            }
            source_xml
                .and_then(|xml| crate::parse::direct_table_property(xml, "w:tblPr"))
                .and_then(|xml| crate::parse::direct_table_property(xml, "w:tblStyle"))
                .and_then(|tag| get_attribute(tag, "w:val"))
        });
    let inherited_look = style_id
        .as_ref()
        .and_then(|id| state.table_styles.get(id))
        .and_then(|style| {
            style
                .conditions
                .get(&crate::parse::TableConditionalStyleType::WholeTable)
        })
        .and_then(|condition| condition.table_look.clone());
    let direct_look = source_xml
        .and_then(|xml| crate::parse::direct_table_property(xml, "w:tblPr"))
        .and_then(|xml| crate::parse::direct_table_property(xml, "w:tblLook"))
        .and_then(|xml| crate::parse::parse_table_look(Some(xml)));
    let look = direct_look
        .or(inherited_look)
        .unwrap_or_else(crate::parse::default_table_look);
    let grid_bound = crate::parse::table_grid_column_bound(table);
    let columns = table
        .rows
        .iter()
        .map(|row| {
            row.cells
                .iter()
                .fold(0i64, |total, cell| {
                    total.saturating_add(
                        cell.style
                            .as_ref()
                            .and_then(|style| style.grid_span)
                            .unwrap_or(1)
                            .max(1),
                    )
                })
                .saturating_add(crate::parse::resolve_table_grid_skip_count(
                    row.style.as_ref().and_then(|style| style.grid_before),
                    grid_bound,
                ))
                .saturating_add(crate::parse::resolve_table_grid_skip_count(
                    row.style.as_ref().and_then(|style| style.grid_after),
                    grid_bound,
                ))
        })
        .max()
        .unwrap_or(0)
        .max(grid_bound)
        .max(1);
    TableAlignmentContext {
        style_id,
        look,
        grid_bound,
        columns,
        rows: table.rows.len() as i64,
    }
}

fn table_cell_text_alignment(
    context: &TableAlignmentContext,
    row: usize,
    column: i64,
    span: i64,
    state: &ImageSerializationState<'_>,
) -> Option<ParagraphTextAlignment> {
    let style = context
        .style_id
        .as_ref()
        .and_then(|id| state.table_styles.get(id))?;
    crate::parse::resolve_table_condition_for_cell(
        style,
        &context.look,
        row as i64,
        context.rows,
        column,
        column + span - 1,
        context.columns,
    )
    .and_then(|condition| condition.paragraph_text_alignment)
}

fn cell_alignment_context_changed(
    cell: &TableCellNode,
    state: &ImageSerializationState<'_>,
) -> bool {
    cell.nodes.iter().any(|node| match node {
        TableCellContentNode::Paragraph(paragraph) => {
            paragraph.style.as_ref().is_some_and(|style| {
                style.source_has_text_alignment == Some(false)
                    && style.text_alignment == style.source_text_alignment
                    && serialized_paragraph_text_alignment(style, state).is_some()
            })
        }
        TableCellContentNode::Table(table) => {
            table_alignment_context_changed(table, state, table.source_xml.as_deref())
        }
    })
}

fn table_alignment_context_changed(
    table: &TableNode,
    state: &ImageSerializationState<'_>,
    source: Option<&str>,
) -> bool {
    let context = resolve_table_alignment_context(table, state, source);
    table.rows.iter().enumerate().any(|(row_index, row)| {
        let bound = context.grid_bound;
        let mut column = crate::parse::resolve_table_grid_skip_count(
            row.style.as_ref().and_then(|style| style.grid_before),
            bound,
        );
        row.cells.iter().any(|cell| {
            let span = cell
                .style
                .as_ref()
                .and_then(|style| style.grid_span)
                .unwrap_or(1)
                .max(1);
            let current = table_cell_text_alignment(&context, row_index, column, span, state);
            column += span;
            cell.nodes.iter().any(|node| match node {
                TableCellContentNode::Paragraph(paragraph) => {
                    paragraph.style.as_ref().is_some_and(|style| {
                        if style.source_has_text_alignment != Some(false)
                            || style.text_alignment != style.source_text_alignment
                        {
                            return false;
                        }
                        let style_id = style.style_id.as_ref();
                        let inherited = style_id
                            .and_then(|id| state.paragraph_style_alignment_owners.get(id).copied())
                            .or(current)
                            .or_else(|| {
                                style_id.and_then(|id| {
                                    state.paragraph_text_alignment_by_style_id.get(id).copied()
                                })
                            })
                            .or(state.default_paragraph_text_alignment);
                        inherited
                            != style
                                .text_alignment
                                .or(style.source_inherited_text_alignment)
                    })
                }
                TableCellContentNode::Table(nested) => {
                    table_alignment_context_changed(nested, state, nested.source_xml.as_deref())
                }
            })
        })
    })
}

fn paragraph_properties_with_mark_xml(
    paragraph: &ParagraphNode,
    state: &ImageSerializationState<'_>,
) -> String {
    let text_alignment = paragraph
        .style
        .as_ref()
        .and_then(|style| serialized_paragraph_text_alignment(style, state));
    let properties = paragraph_properties_xml(paragraph.style.as_ref(), text_alignment);
    let mark = paragraph_mark_xml(
        paragraph,
        paragraph.source_paragraph_mark_properties_xml.as_deref(),
    );
    if mark.is_empty() {
        return properties;
    }
    insert_property_child(
        if properties.is_empty() {
            "<w:pPr/>"
        } else {
            &properties
        },
        "w:pPr",
        "w:rPr",
        &mark,
        PARAGRAPH_MARK_TAIL_ORDER,
    )
}

fn patch_source_paragraph_mark(paragraph: &ParagraphNode, source: &str) -> String {
    if paragraph.paragraph_mark_style == paragraph.source_paragraph_mark_style {
        return source.to_string();
    }
    let ppr_range = direct_property_children(source)
        .into_iter()
        .find(|(name, _)| name == "w:pPr")
        .map(|(_, range)| range);
    let original_properties = ppr_range
        .as_ref()
        .map(|range| &source[range.start..range.end])
        .unwrap_or("<w:pPr/>");
    let mark_range = direct_property_children(original_properties)
        .into_iter()
        .find(|(name, _)| name == "w:rPr")
        .map(|(_, range)| range);
    let mark = paragraph_mark_xml(
        paragraph,
        mark_range
            .as_ref()
            .map(|range| &original_properties[range.start..range.end]),
    );
    let mut properties = original_properties.to_string();
    if let Some(range) = mark_range {
        properties.replace_range(range.start..range.end, &mark);
    } else if !mark.is_empty() {
        properties = insert_property_child(
            &properties,
            "w:pPr",
            "w:rPr",
            &mark,
            PARAGRAPH_MARK_TAIL_ORDER,
        );
    }
    let mut updated = source.to_string();
    if let Some(range) = ppr_range {
        updated.replace_range(range.start..range.end, &properties);
    } else if paragraph.paragraph_mark_style.is_some() {
        let insert_at = opening_tag_end(source, 0).unwrap_or(0);
        updated.insert_str(insert_at, &properties);
    }
    updated
}
fn paragraph_text_alignment_str(value: ParagraphTextAlignment) -> &'static str {
    match value {
        ParagraphTextAlignment::Auto => "auto",
        ParagraphTextAlignment::Top => "top",
        ParagraphTextAlignment::Center => "center",
        ParagraphTextAlignment::Baseline => "baseline",
        ParagraphTextAlignment::Bottom => "bottom",
    }
}

fn patch_source_paragraph_text_alignment(
    paragraph: &ParagraphNode,
    source: &str,
    state: &ImageSerializationState<'_>,
) -> String {
    let Some(style) = paragraph.style.as_ref() else {
        return source.to_string();
    };
    if style.text_alignment == style.source_text_alignment
        && (style.source_has_text_alignment.is_none() || style.source_text_alignment.is_none())
    {
        return source.to_string();
    }
    let range = direct_property_children(source)
        .into_iter()
        .find(|(name, _)| name == "w:pPr")
        .map(|(_, range)| range);
    let properties = range
        .as_ref()
        .map(|range| &source[range.start..range.end])
        .unwrap_or("<w:pPr/>");
    let desired = serialized_paragraph_text_alignment(style, state);
    let current = crate::parse::direct_table_property(properties, "w:textAlignment")
        .and_then(|tag| get_attribute(tag, "w:val"));
    if current.as_deref() == desired.map(paragraph_text_alignment_str) {
        return source.to_string();
    }
    let attributes =
        desired.map(|value| [("w:val", paragraph_text_alignment_str(value).to_string())]);
    let updated = patch_direct_table_property(
        properties,
        "w:pPr",
        "w:textAlignment",
        attributes.as_ref().map(|values| values.as_slice()),
        &[
            "w:textDirection",
            "w:textAlignment",
            "w:textboxTightWrap",
            "w:outlineLvl",
            "w:divId",
            "w:cnfStyle",
            "w:rPr",
            "w:sectPr",
            "w:pPrChange",
        ],
    );
    let mut source = source.to_string();
    if let Some(range) = range {
        source.replace_range(range.start..range.end, &updated);
    } else if desired.is_some() {
        let end = opening_tag_end(&source, 0).unwrap_or(0);
        source.insert_str(end, &updated);
    }
    source
}

fn patch_source_paragraph_properties(
    paragraph: &ParagraphNode,
    source: &str,
    state: &ImageSerializationState<'_>,
) -> String {
    let marked = patch_source_paragraph_mark(paragraph, source);
    patch_source_paragraph_text_alignment(paragraph, &marked, state)
}

fn paragraph_xml(
    paragraph: &ParagraphNode,
    state: &mut ImageSerializationState<'_>,
    run_id_ref: &mut i64,
) -> String {
    if let Some(source_xml) = &paragraph.source_xml {
        if let Some(patch_plan) = &paragraph.source_text_patch {
            if let Some(patched) = patch_source_paragraph_text(paragraph, source_xml, patch_plan) {
                return patch_source_paragraph_properties(paragraph, &patched, state);
            }
        } else {
            return patch_source_paragraph_properties(paragraph, source_xml, state);
        }
    }

    let runs = paragraph
        .children
        .iter()
        .filter_map(|child| {
            let xml = match child {
                ParagraphChildNode::Text(text_run) => {
                    let has_note_reference = text_run.note_reference.is_some();
                    let note_reference_xml = text_run
                        .note_reference
                        .as_ref()
                        .map(|reference| match reference.kind {
                            NoteReferenceKind::Footnote => format!(
                                r#"<w:footnoteReference w:id="{}"/>"#,
                                reference.id
                            ),
                            NoteReferenceKind::Endnote => format!(
                                r#"<w:endnoteReference w:id="{}"/>"#,
                                reference.id
                            ),
                        })
                        .unwrap_or_default();
                    let text_xml = if has_note_reference && text_run.text.is_empty() {
                        String::new()
                    } else {
                        render_text_tokens(&text_run.text)
                    };
                    let run_xml = format!(
                        "<w:r>{}{}{}</w:r>",
                        run_properties_xml(text_run.style.as_ref()),
                        note_reference_xml,
                        text_xml
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
        paragraph_properties_with_mark_xml(paragraph, state),
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

fn patch_table_source_text(
    table: &TableNode,
    source_xml: &str,
    state: &mut ImageSerializationState<'_>,
    run_id_ref: &mut i64,
) -> Option<String> {
    let patches = table.source_text_patches.as_deref()?;
    if patches.is_empty() {
        return Some(source_xml.to_string());
    }

    let mut patched = source_xml.to_string();
    for patch in patches {
        if patch.source_paragraph_xml.is_empty() {
            return None;
        }
        let mut matches = patched.match_indices(&patch.source_paragraph_xml);
        let (start, _) = matches.next()?;
        if matches.next().is_some() {
            return None;
        }
        let end = start + patch.source_paragraph_xml.len();
        let replacement = paragraph_xml(&patch.paragraph, state, run_id_ref);
        patched.replace_range(start..end, &replacement);
    }
    Some(patched)
}

const TABLE_PROPERTIES_ORDER: &[&str] = &[
    "w:tblStyle",
    "w:tblpPr",
    "w:tblOverlap",
    "w:bidiVisual",
    "w:tblStyleRowBandSize",
    "w:tblStyleColBandSize",
    "w:tblW",
    "w:jc",
    "w:tblCellSpacing",
    "w:tblInd",
    "w:tblBorders",
    "w:shd",
    "w:tblLayout",
    "w:tblCellMar",
    "w:tblLook",
    "w:tblCaption",
    "w:tblDescription",
    "w:tblPrChange",
];
const CELL_PROPERTIES_ORDER: &[&str] = &[
    "w:cnfStyle",
    "w:tcW",
    "w:gridSpan",
    "w:hMerge",
    "w:vMerge",
    "w:tcBorders",
    "w:shd",
    "w:noWrap",
    "w:tcMar",
    "w:textDirection",
    "w:tcFitText",
    "w:vAlign",
    "w:hideMark",
    "w:headers",
    "w:cellIns",
    "w:cellDel",
    "w:cellMerge",
    "w:tcPrChange",
];

fn effective_table_width(
    preferred: Option<&TablePreferredWidth>,
    legacy: Option<i64>,
    source: Option<&TableWidthSource>,
) -> Option<TablePreferredWidth> {
    if let Some(source) = source {
        if preferred != source.preferred_width.as_ref() {
            return preferred
                .cloned()
                .or_else(|| source.inherited_preferred_width.clone());
        }
        if legacy != source.width_twips {
            return legacy
                .map(|value| TablePreferredWidth::Dxa {
                    value: value as f64,
                })
                .or_else(|| source.inherited_preferred_width.clone());
        }
    }
    preferred.cloned().or_else(|| {
        legacy.map(|value| TablePreferredWidth::Dxa {
            value: value as f64,
        })
    })
}

fn table_width_edit(
    preferred: Option<&TablePreferredWidth>,
    legacy: Option<i64>,
    source: Option<&TableWidthSource>,
) -> Option<Option<TablePreferredWidth>> {
    if let Some(source) = source {
        if preferred != source.preferred_width.as_ref() {
            return Some(preferred.cloned());
        }
        if legacy != source.width_twips {
            return Some(legacy.map(|value| TablePreferredWidth::Dxa {
                value: value as f64,
            }));
        }
        None
    } else {
        effective_table_width(preferred, legacy, None).map(Some)
    }
}

fn table_width_attributes(width: &TablePreferredWidth) -> Option<[(&'static str, String); 2]> {
    let (kind, value) = match width {
        TablePreferredWidth::Dxa { value } if value.is_finite() && *value >= 0.0 => (
            "dxa",
            if value.fract() == 0.0 {
                format!("{value:.0}")
            } else {
                format!("{}pt", value / 20.0)
            },
        ),
        TablePreferredWidth::Pct { value } if value.is_finite() && *value >= 0.0 => {
            let fiftieths = value * 50.0;
            (
                "pct",
                if fiftieths.fract() == 0.0 {
                    format!("{fiftieths:.0}")
                } else {
                    format!("{value}%")
                },
            )
        }
        TablePreferredWidth::Auto => ("auto", "0".to_string()),
        TablePreferredWidth::Nil => ("nil", "0".to_string()),
        _ => return None,
    };
    Some([("w:w", value), ("w:type", kind.to_string())])
}

fn table_width_xml(name: &str, width: Option<&TablePreferredWidth>) -> Option<String> {
    let attributes = table_width_attributes(width?)?;
    Some(format!(
        r#"<{name} w:w="{}" w:type="{}"/>"#,
        attributes[0].1, attributes[1].1
    ))
}

fn table_alignment_str(value: TableAlignment) -> &'static str {
    match value {
        TableAlignment::Left => "left",
        TableAlignment::Center => "center",
        TableAlignment::Right => "right",
    }
}

fn patch_direct_table_property(
    xml: &str,
    container: &str,
    name: &str,
    attributes: Option<&[(&str, String)]>,
    order: &[&str],
) -> String {
    let ranges: Vec<_> = direct_property_children(xml)
        .into_iter()
        .filter(|(tag, _)| tag == name)
        .map(|(_, range)| range)
        .collect();
    let Some(attributes) = attributes else {
        return replace_xml_ranges(
            xml,
            ranges
                .into_iter()
                .map(|range| (range.start, range.end, String::new()))
                .collect(),
        );
    };
    if let Some(first) = ranges.first() {
        let existing = &xml[first.start..first.end];
        let end = opening_tag_end(existing, 0).unwrap_or(existing.len());
        let mut tag = existing[..end].to_string();
        for (attribute, value) in attributes {
            tag = set_xml_attribute(&tag, attribute, value);
        }
        tag.push_str(&existing[end..]);
        let mut replacements = vec![(first.start, first.end, tag)];
        replacements.extend(
            ranges
                .into_iter()
                .skip(1)
                .map(|range| (range.start, range.end, String::new())),
        );
        return replace_xml_ranges(xml, replacements);
    }
    let mut child = format!("<{name}/>");
    for (attribute, value) in attributes {
        child = set_xml_attribute(&child, attribute, value);
    }
    insert_property_child(xml, container, name, &child, order)
}

fn patch_table_properties(
    xml: &str,
    container: &str,
    width_name: &str,
    width: Option<Option<TablePreferredWidth>>,
    alignment: Option<Option<TableAlignment>>,
    bidi: Option<Option<bool>>,
    order: &[&str],
) -> String {
    if width.is_none() && alignment.is_none() && bidi.is_none() {
        return xml.to_string();
    }
    let range = direct_property_children(xml)
        .into_iter()
        .find(|(tag, _)| tag == container)
        .map(|(_, range)| range);
    let original = range.as_ref().map(|range| &xml[range.start..range.end]);
    let mut properties = original
        .map(str::to_string)
        .unwrap_or_else(|| format!("<{container}/>"));
    if let Some(width) = width {
        let current = crate::parse::direct_table_property(&properties, width_name)
            .and_then(crate::parse::parse_table_preferred_width);
        if current != width {
            let attributes = width.as_ref().and_then(table_width_attributes);
            properties = patch_direct_table_property(
                &properties,
                container,
                width_name,
                attributes.as_ref().map(|values| values.as_slice()),
                order,
            );
        }
    }
    if let Some(alignment) = alignment {
        let current = crate::parse::direct_table_property(&properties, "w:jc")
            .and_then(|tag| get_attribute(tag, "w:val"));
        let desired = alignment.map(|value| table_alignment_str(value).to_string());
        if current != desired {
            let attributes = desired.map(|value| [("w:val", value)]);
            properties = patch_direct_table_property(
                &properties,
                container,
                "w:jc",
                attributes.as_ref().map(|values| values.as_slice()),
                order,
            );
        }
    }
    if let Some(bidi) = bidi {
        let current = crate::parse::direct_table_property(&properties, "w:bidiVisual")
            .and_then(|tag| crate::xml::parse_on_off_attribute(tag, "bidiVisual"));
        if current != bidi {
            let attributes =
                bidi.map(|value| [("w:val", if value { "1" } else { "0" }.to_string())]);
            properties = patch_direct_table_property(
                &properties,
                container,
                "w:bidiVisual",
                attributes.as_ref().map(|values| values.as_slice()),
                order,
            );
        }
    }
    if let Some(range) = range {
        let mut patched = xml.to_string();
        patched.replace_range(range.start..range.end, &properties);
        patched
    } else if !direct_property_children(&properties).is_empty() {
        let mut patched = xml.to_string();
        let end = opening_tag_end(xml, 0).unwrap_or(xml.len());
        patched.insert_str(end, &properties);
        patched
    } else {
        xml.to_string()
    }
}

const ROW_PROPERTIES_ORDER: &[&str] = &[
    "w:cnfStyle",
    "w:divId",
    "w:gridBefore",
    "w:gridAfter",
    "w:wBefore",
    "w:wAfter",
    "w:cantSplit",
    "w:trHeight",
    "w:tblHeader",
    "w:tblCellSpacing",
    "w:jc",
    "w:hidden",
    "w:ins",
    "w:del",
    "w:trPrChange",
];

fn row_has_source_geometry_edits(row: &TableRowNode) -> bool {
    let Some(style) = row.style.as_ref() else {
        return false;
    };
    if let Some(source) = style.source_row_geometry.as_ref() {
        style.grid_before != source.grid_before
            || style.grid_after != source.grid_after
            || style.width_before != source.width_before
            || style.width_after != source.width_after
    } else {
        style.grid_before.is_some()
            || style.grid_after.is_some()
            || style.width_before.is_some()
            || style.width_after.is_some()
    }
}

fn patch_row_source_geometry(row: &TableRowNode, xml: &str) -> String {
    if !row_has_source_geometry_edits(row) {
        return xml.to_string();
    }
    let style = row.style.as_ref().unwrap();
    let source = style.source_row_geometry.as_ref();
    let range = direct_property_children(xml)
        .into_iter()
        .find(|(name, _)| name == "w:trPr")
        .map(|(_, range)| range);
    let mut properties = range
        .as_ref()
        .map(|range| xml[range.start..range.end].to_string())
        .unwrap_or_else(|| "<w:trPr/>".to_string());
    for (name, current, baseline) in [
        (
            "w:gridBefore",
            style.grid_before,
            source.and_then(|source| source.grid_before),
        ),
        (
            "w:gridAfter",
            style.grid_after,
            source.and_then(|source| source.grid_after),
        ),
    ] {
        if (source.is_none() && current.is_none())
            || (source.is_some() && current == baseline)
            || current.is_some_and(|value| value < 0)
        {
            continue;
        }
        let attributes = current.map(|value| [("w:val", value.to_string())]);
        properties = patch_direct_table_property(
            &properties,
            "w:trPr",
            name,
            attributes.as_ref().map(|values| values.as_slice()),
            ROW_PROPERTIES_ORDER,
        );
    }
    for (name, current, baseline) in [
        (
            "w:wBefore",
            style.width_before.as_ref(),
            source.and_then(|source| source.width_before.as_ref()),
        ),
        (
            "w:wAfter",
            style.width_after.as_ref(),
            source.and_then(|source| source.width_after.as_ref()),
        ),
    ] {
        if (source.is_none() && current.is_none()) || (source.is_some() && current == baseline) {
            continue;
        }
        let actual = crate::parse::direct_table_property(&properties, name)
            .and_then(crate::parse::parse_table_preferred_width);
        if actual.as_ref() == current {
            continue;
        }
        let attributes = current.and_then(table_width_attributes);
        properties = patch_direct_table_property(
            &properties,
            "w:trPr",
            name,
            attributes.as_ref().map(|values| values.as_slice()),
            ROW_PROPERTIES_ORDER,
        );
    }
    let mut updated = xml.to_string();
    if let Some(range) = range {
        updated.replace_range(range.start..range.end, &properties);
    } else if !direct_property_children(&properties).is_empty() {
        let end = direct_property_children(xml)
            .into_iter()
            .find(|(name, _)| name == "w:tblPrEx")
            .map(|(_, range)| range.end)
            .unwrap_or_else(|| opening_tag_end(xml, 0).unwrap_or(0));
        updated.insert_str(end, &properties);
    }
    updated
}

fn row_has_source_property_edits(row: &TableRowNode) -> bool {
    row_has_source_geometry_edits(row) || row.cells.iter().any(cell_has_source_property_edits)
}

fn paragraph_has_source_property_edits(paragraph: &ParagraphNode) -> bool {
    paragraph.paragraph_mark_style != paragraph.source_paragraph_mark_style
        || paragraph
            .style
            .as_ref()
            .is_some_and(|style| style.text_alignment != style.source_text_alignment)
}

fn cell_has_source_property_edits(cell: &TableCellNode) -> bool {
    cell.style.as_ref().is_some_and(|style| {
        style.text_direction != style.source_text_direction || table_width_edit(
            style.preferred_width.as_ref(),
            style.width_twips,
            style.source_width.as_ref(),
        )
        .is_some()
    }) || cell.nodes.iter().any(|node| match node {
        TableCellContentNode::Paragraph(paragraph) => {
            paragraph_has_source_property_edits(paragraph)
        }
        TableCellContentNode::Table(table) => table_has_source_property_edits(table),
    })
}

fn table_has_source_property_edits(table: &TableNode) -> bool {
    table.style.as_ref().is_some_and(|style| {
        table_width_edit(
            style.preferred_width.as_ref(),
            style.width_twips,
            style.source_width.as_ref(),
        )
        .is_some()
            || style.style_id != style.source_style_id
            || style.alignment != style.source_alignment
            || style.bidi_visual != style.source_bidi_visual
    }) || table.rows.iter().any(row_has_source_property_edits)
}

fn patch_table_source_properties(
    table: &TableNode,
    source_xml: &str,
    state: &mut ImageSerializationState<'_>,
) -> Option<String> {
    let previous = state.current_table_text_alignment;
    let result = patch_table_source_properties_inner(table, source_xml, state);
    state.current_table_text_alignment = previous;
    result
}

fn patch_table_source_properties_inner(
    table: &TableNode,
    source_xml: &str,
    state: &mut ImageSerializationState<'_>,
) -> Option<String> {
    let identity_changed = table
        .style
        .as_ref()
        .is_some_and(|style| style.style_id != style.source_style_id);
    if !table_has_source_property_edits(table)
        && !table_alignment_context_changed(table, state, Some(source_xml))
    {
        return Some(source_xml.to_string());
    }
    let width = table.style.as_ref().and_then(|style| {
        table_width_edit(
            style.preferred_width.as_ref(),
            style.width_twips,
            style.source_width.as_ref(),
        )
    });
    let alignment = table
        .style
        .as_ref()
        .filter(|style| style.alignment != style.source_alignment)
        .map(|style| style.alignment);
    let bidi = table
        .style
        .as_ref()
        .filter(|style| style.bidi_visual != style.source_bidi_visual)
        .map(|style| style.bidi_visual);
    let mut source = patch_table_properties(
        source_xml,
        "w:tblPr",
        "w:tblW",
        width,
        alignment,
        bidi,
        TABLE_PROPERTIES_ORDER,
    );
    if let Some(style) = table
        .style
        .as_ref()
        .filter(|style| style.style_id != style.source_style_id)
    {
        let range = direct_property_children(&source)
            .into_iter()
            .find(|(name, _)| name == "w:tblPr")
            .map(|(_, range)| range);
        let properties = range
            .as_ref()
            .map(|range| &source[range.start..range.end])
            .unwrap_or("<w:tblPr/>");
        let attributes = style
            .style_id
            .as_ref()
            .map(|value| [("w:val", value.clone())]);
        let properties = patch_direct_table_property(
            properties,
            "w:tblPr",
            "w:tblStyle",
            attributes.as_ref().map(|values| values.as_slice()),
            TABLE_PROPERTIES_ORDER,
        );
        if let Some(range) = range {
            source.replace_range(range.start..range.end, &properties);
        } else if style.style_id.is_some() {
            let end = opening_tag_end(&source, 0).unwrap_or(0);
            source.insert_str(end, &properties);
        }
    }
    if !identity_changed
        && !table.rows.iter().any(row_has_source_property_edits)
        && !table_alignment_context_changed(table, state, Some(&source))
    {
        return Some(source);
    }
    let context = resolve_table_alignment_context(table, state, Some(&source));
    let rows = extract_balanced_tag_ranges(&source, "w:tr");
    if rows.len() != table.rows.len() {
        return None;
    }
    let mut row_replacements = Vec::new();
    for (row_index, (range, row)) in rows.into_iter().zip(&table.rows).enumerate() {
        let patched_row = patch_row_source_geometry(row, &source[range.start..range.end]);
        let row_xml = patched_row.as_str();
        let cells = extract_balanced_tag_ranges(row_xml, "w:tc");
        if cells.len() != row.cells.len() {
            return None;
        }
        let mut cell_replacements = Vec::new();
        let bound = context.grid_bound;
        let mut column = crate::parse::resolve_table_grid_skip_count(
            row.style.as_ref().and_then(|style| style.grid_before),
            bound,
        );
        for (cell_range, cell) in cells.into_iter().zip(&row.cells) {
            let span = cell
                .style
                .as_ref()
                .and_then(|style| style.grid_span)
                .unwrap_or(1)
                .max(1);
            state.current_table_text_alignment =
                table_cell_text_alignment(&context, row_index, column, span, state);
            column += span;
            let cell_xml = &row_xml[cell_range.start..cell_range.end];
            let width = cell.style.as_ref().and_then(|style| {
                table_width_edit(
                    style.preferred_width.as_ref(),
                    style.width_twips,
                    style.source_width.as_ref(),
                )
            });
            let mut patched_cell = patch_table_properties(
                cell_xml,
                "w:tcPr",
                "w:tcW",
                width,
                None,
                None,
                CELL_PROPERTIES_ORDER,
            );
            if let Some(style) = cell.style.as_ref().filter(|style| style.text_direction != style.source_text_direction) {
                let range = direct_property_children(&patched_cell).into_iter()
                    .find(|(name, _)| name == "w:tcPr").map(|(_, range)| range);
                let properties = range.as_ref()
                    .map(|range| &patched_cell[range.start..range.end]).unwrap_or("<w:tcPr/>");
                let attributes = style.text_direction.as_ref().map(|value| [("w:val", value.clone())]);
                let properties = patch_direct_table_property(properties, "w:tcPr", "w:textDirection",
                    attributes.as_ref().map(|values| values.as_slice()), CELL_PROPERTIES_ORDER);
                if let Some(range) = range {
                    patched_cell.replace_range(range.start..range.end, &properties);
                } else if style.text_direction.is_some() {
                    let end = opening_tag_end(&patched_cell, 0).unwrap_or(0);
                    patched_cell.insert_str(end, &properties);
                }
            }
            if identity_changed
                || cell_alignment_context_changed(cell, state)
                || cell.nodes.iter().any(|node| match node {
                    TableCellContentNode::Paragraph(paragraph) => {
                        paragraph_has_source_property_edits(paragraph)
                    }
                    TableCellContentNode::Table(table) => table_has_source_property_edits(table),
                })
            {
                let blocks = crate::xml::extract_balanced_tag_blocks_in_order(
                    &patched_cell,
                    &["w:p", "w:tbl"],
                );
                if blocks.len() != cell.nodes.len() {
                    return None;
                }
                let mut replacements = Vec::new();
                for (range, node) in blocks.into_iter().zip(&cell.nodes) {
                    let source = &patched_cell[range.start..range.end];
                    let replacement = match node {
                        TableCellContentNode::Paragraph(paragraph)
                            if range.tag_name.eq_ignore_ascii_case("w:p") =>
                        {
                            patch_source_paragraph_properties(paragraph, source, state)
                        }
                        TableCellContentNode::Table(table)
                            if range.tag_name.eq_ignore_ascii_case("w:tbl") =>
                        {
                            patch_table_source_properties(table, source, state)?
                        }
                        _ => return None,
                    };
                    replacements.push((range.start, range.end, replacement));
                }
                patched_cell = replace_xml_ranges(&patched_cell, replacements);
            }
            cell_replacements.push((cell_range.start, cell_range.end, patched_cell));
        }
        row_replacements.push((
            range.start,
            range.end,
            replace_xml_ranges(row_xml, cell_replacements),
        ));
    }
    Some(replace_xml_ranges(&source, row_replacements))
}

fn table_xml(table: &TableNode, state: &mut ImageSerializationState<'_>, run_id_ref: &mut i64) -> String {
    if let Some(source_xml) = &table.source_xml {
        let source = if table.source_text_patches.as_ref().is_some_and(|patches| !patches.is_empty()) {
            patch_table_source_text(table, source_xml, state, run_id_ref)
        } else {
            Some(source_xml.clone())
        };
        if let Some(patched) = source.and_then(|source| patch_table_source_properties(table, &source, state)) {
            return patched;
        }
    }

    let mut table_props: Vec<String> = Vec::new();
    if let Some(style_id) = table.style.as_ref().and_then(|style| style.style_id.as_ref()) {
        table_props.push(format!(r#"<w:tblStyle w:val="{}"/>"#, escape_xml(style_id)));
    }

    // tblpPr precedes tblW in the tblPr child sequence.
    if let Some(floating) = table.style.as_ref().and_then(|s| s.floating.as_ref()) {
        let mut attrs = String::new();
        if let Some(value) = floating.left_from_text_twips {
            attrs.push_str(&format!(r#" w:leftFromText="{value}""#));
        }
        if let Some(value) = floating.right_from_text_twips {
            attrs.push_str(&format!(r#" w:rightFromText="{value}""#));
        }
        if let Some(value) = floating.top_from_text_twips {
            attrs.push_str(&format!(r#" w:topFromText="{value}""#));
        }
        if let Some(value) = floating.bottom_from_text_twips {
            attrs.push_str(&format!(r#" w:bottomFromText="{value}""#));
        }
        if let Some(value) = floating.vertical_anchor.as_ref() {
            attrs.push_str(&format!(r#" w:vertAnchor="{}""#, escape_xml(value)));
        }
        if let Some(value) = floating.horizontal_anchor.as_ref() {
            attrs.push_str(&format!(r#" w:horzAnchor="{}""#, escape_xml(value)));
        }
        if let Some(align) = floating.horizontal_align {
            attrs.push_str(&format!(
                r#" w:tblpXSpec="{}""#,
                image_horizontal_align_str(align)
            ));
        }
        if let Some(value) = floating.x_twips {
            attrs.push_str(&format!(r#" w:tblpX="{value}""#));
        }
        if let Some(align) = floating.vertical_align {
            attrs.push_str(&format!(
                r#" w:tblpYSpec="{}""#,
                image_vertical_align_str(align)
            ));
        }
        if let Some(value) = floating.y_twips {
            attrs.push_str(&format!(r#" w:tblpY="{value}""#));
        }
        if !attrs.is_empty() {
            table_props.push(format!("<w:tblpPr{attrs}/>"));
        }
    }
    let preferred_width = table.style.as_ref().and_then(|style| {
        effective_table_width(style.preferred_width.as_ref(), style.width_twips, style.source_width.as_ref())
    });
    if let Some(xml) = table_width_xml("w:tblW", preferred_width.as_ref()) {
        table_props.push(xml);
    }
    if let Some(alignment) = table.style.as_ref().and_then(|style| style.alignment.or(style.source_inherited_alignment)) {
        table_props.push(format!(r#"<w:jc w:val="{}"/>"#, table_alignment_str(alignment)));
    }
    if let Some(bidi_visual) = table.style.as_ref().and_then(|style| style.bidi_visual.or(style.source_inherited_bidi_visual)) {
        table_props.push(format!(r#"<w:bidiVisual w:val="{}"/>"#, if bidi_visual { "1" } else { "0" }));
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

    table_props.sort_by_key(|xml| {
        let name = xml[1..].split(|ch: char| ch.is_whitespace() || ch == '/' || ch == '>').next().unwrap_or_default();
        TABLE_PROPERTIES_ORDER.iter().position(|value| *value == name).unwrap_or(usize::MAX)
    });

    let table_grid_xml = table
        .style
        .as_ref()
        .and_then(|s| s.column_widths_twips.as_ref())
        .map(|widths| {
            let cols = widths
                .iter()
                .filter_map(|width| twips_to_xml_non_negative(Some(*width)))
                .map(|width| format!(r#"<w:gridCol w:w="{width}"/>"#))
                .collect::<String>();
            format!("<w:tblGrid>{cols}</w:tblGrid>")
        })
        .unwrap_or_default();

    let context = resolve_table_alignment_context(table, state, None);
    let previous_table_alignment = state.current_table_text_alignment;
    let rows = table
        .rows
        .iter()
        .enumerate()
        .map(|(row_index, row)| {
            let mut row_props: Vec<String> = Vec::new();
            for (name, count) in [
                ("w:gridBefore", row.style.as_ref().and_then(|style| style.grid_before)),
                ("w:gridAfter", row.style.as_ref().and_then(|style| style.grid_after)),
            ] {
                if let Some(count) = count.filter(|count| *count >= 0) {
                    row_props.push(format!(r#"<{name} w:val="{count}"/>"#));
                }
            }
            for (name, width) in [
                ("w:wBefore", row.style.as_ref().and_then(|style| style.width_before.as_ref())),
                ("w:wAfter", row.style.as_ref().and_then(|style| style.width_after.as_ref())),
            ] {
                if let Some(xml) = table_width_xml(name, width) { row_props.push(xml); }
            }

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
            if let Some(is_header) = row.style.as_ref().and_then(|s| s.is_header) {
                row_props.push(if is_header {
                    "<w:tblHeader/>".to_string()
                } else {
                    r#"<w:tblHeader w:val="0"/>"#.to_string()
                });
            }

            row_props.sort_by_key(|xml| {
                let name = xml[1..].split(|ch: char| ch.is_whitespace() || ch == '/' || ch == '>').next().unwrap_or_default();
                ROW_PROPERTIES_ORDER.iter().position(|value| *value == name).unwrap_or(usize::MAX)
            });

            let bound = context.grid_bound;
            let mut column = crate::parse::resolve_table_grid_skip_count(row.style.as_ref().and_then(|style| style.grid_before), bound);
            let cells = row
                .cells
                .iter()
                .map(|cell| {
                    let span = cell.style.as_ref().and_then(|style| style.grid_span).unwrap_or(1).max(1);
                    state.current_table_text_alignment = table_cell_text_alignment(&context, row_index, column, span, state);
                    column += span;
                    let serialized_cells =
                        table_cell_xml_content(&cell.nodes, state, run_id_ref);

                    let mut cell_props: Vec<String> = Vec::new();
                    let preferred_width = cell.style.as_ref().and_then(|style| {
                        effective_table_width(style.preferred_width.as_ref(), style.width_twips, style.source_width.as_ref())
                    });
                    if let Some(xml) = table_width_xml("w:tcW", preferred_width.as_ref()) {
                        cell_props.push(xml);
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
                    if cell
                        .style
                        .as_ref()
                        .and_then(|s| s.v_merge_continuation)
                        == Some(true)
                    {
                        cell_props.push("<w:vMerge/>".to_string());
                    } else if cell.style.as_ref().and_then(|s| s.row_span).is_some() {
                        cell_props.push(r#"<w:vMerge w:val="restart"/>"#.to_string());
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
                    if let Some(direction) = cell.style.as_ref().and_then(|s| s.text_direction.as_deref()) {
                        cell_props.push(format!(r#"<w:textDirection w:val="{}"/>"#, escape_xml(direction)));
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

    state.current_table_text_alignment = previous_table_alignment;
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

    let styles = crate::parse::parse_style_sheet(base_package);
    let paragraph_style_alignment_owners = styles.paragraph_style_by_id.iter()
        .filter(|(_, style)| style.source_has_text_alignment == Some(true))
        .filter_map(|(id, style)| style.text_alignment.map(|value| (id.clone(), value))).collect();
    let table_styles = styles.table_style_by_id;
    let paragraph_text_alignment_by_style_id = styles.paragraph_style_by_id.into_iter()
        .filter_map(|(id, style)| style.text_alignment.map(|value| (id, value))).collect();
    let default_paragraph_text_alignment = styles.default_paragraph_style.as_ref()
        .and_then(|style| style.text_alignment).or(styles.default_paragraph_text_alignment);
    ImageSerializationState {
        paragraph_style_alignment_owners,
        table_styles,
        current_table_text_alignment: None,
        paragraph_text_alignment_by_style_id,
        default_paragraph_text_alignment,
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

fn opening_tag_end(xml: &str, start: usize) -> Option<usize> {
    let mut quote: Option<u8> = None;
    for (offset, byte) in xml.as_bytes().iter().copied().enumerate().skip(start) {
        if let Some(active_quote) = quote {
            if byte == active_quote {
                quote = None;
            }
            continue;
        }
        if byte == b'\'' || byte == b'"' {
            quote = Some(byte);
            continue;
        }
        if byte == b'>' {
            return Some(offset + 1);
        }
    }
    None
}

fn attribute_value_range(open_tag: &str, attribute_name: &str) -> Option<(usize, usize)> {
    let bytes = open_tag.as_bytes();
    let name = attribute_name.as_bytes();
    let mut index = 1usize;
    while index + name.len() <= bytes.len() {
        let matches_name = bytes[index..index + name.len()]
            .iter()
            .zip(name.iter())
            .all(|(left, right)| left.eq_ignore_ascii_case(right));
        let before_boundary = index == 0 || bytes[index - 1].is_ascii_whitespace();
        if !matches_name || !before_boundary {
            index += 1;
            continue;
        }
        let mut cursor = index + name.len();
        while bytes.get(cursor).is_some_and(|byte| byte.is_ascii_whitespace()) {
            cursor += 1;
        }
        if bytes.get(cursor) != Some(&b'=') {
            index += 1;
            continue;
        }
        cursor += 1;
        while bytes.get(cursor).is_some_and(|byte| byte.is_ascii_whitespace()) {
            cursor += 1;
        }
        let quote = *bytes.get(cursor)?;
        if quote != b'\'' && quote != b'"' {
            index += 1;
            continue;
        }
        let value_start = cursor + 1;
        let value_end = bytes[value_start..]
            .iter()
            .position(|byte| *byte == quote)
            .map(|offset| value_start + offset)?;
        return Some((value_start, value_end));
    }
    None
}

fn set_xml_attribute(open_tag: &str, name: &str, value: &str) -> String {
    let escaped = escape_xml(value);
    if let Some((value_start, value_end)) = attribute_value_range(open_tag, name) {
        let mut updated = open_tag.to_string();
        updated.replace_range(value_start..value_end, &escaped);
        return updated;
    }

    let mut insert_at = open_tag.len().saturating_sub(1);
    while insert_at > 0 && open_tag.as_bytes()[insert_at - 1].is_ascii_whitespace() {
        insert_at -= 1;
    }
    if insert_at > 0 && open_tag.as_bytes()[insert_at - 1] == b'/' {
        insert_at -= 1;
    }
    let mut updated = open_tag.to_string();
    updated.insert_str(insert_at, &format!(r#" {name}="{escaped}""#));
    updated
}

fn deterministic_comment_paragraph_id(comment_id: i64) -> String {
    let normalized = comment_id.max(0) as u64;
    format!("{:08X}", (0xC000_0000u64 + normalized) & 0xFFFF_FFFF)
}

fn source_comment_paragraph_id(source_xml: &str) -> Option<String> {
    let range = extract_balanced_tag_ranges(source_xml, "w:p").into_iter().last()?;
    let open_end = opening_tag_end(source_xml, range.start)?;
    get_attribute(&source_xml[range.start..open_end], "w14:paraId")
}

fn ensure_comment_paragraph_id(source_xml: &str, paragraph_id: &str) -> String {
    let Some(range) = extract_balanced_tag_ranges(source_xml, "w:p").into_iter().last() else {
        return source_xml.to_string();
    };
    let Some(open_end) = opening_tag_end(source_xml, range.start) else {
        return source_xml.to_string();
    };
    let open_tag = &source_xml[range.start..open_end];
    let updated_open_tag = set_xml_attribute(open_tag, "w14:paraId", paragraph_id);
    format!(
        "{}{}{}",
        &source_xml[..range.start],
        updated_open_tag,
        &source_xml[open_end..]
    )
}

fn comment_paragraph_id(comment: &DocumentCommentDefinition) -> String {
    comment
        .extended_paragraph_id
        .clone()
        .or_else(|| comment.source_xml.as_deref().and_then(source_comment_paragraph_id))
        .unwrap_or_else(|| deterministic_comment_paragraph_id(comment.id))
}

fn render_comment_block(
    comment: &DocumentCommentDefinition,
    ensure_paragraph_id: bool,
) -> (String, String) {
    let paragraph_id = comment_paragraph_id(comment);
    if let Some(source_xml) = &comment.source_xml {
        let rendered = if ensure_paragraph_id {
            ensure_comment_paragraph_id(source_xml, &paragraph_id)
        } else {
            source_xml.clone()
        };
        return (rendered, paragraph_id);
    }

    let mut attributes = vec![format!(r#"w:id="{}""#, comment.id)];
    if let Some(author) = &comment.author {
        attributes.push(format!(r#"w:author="{}""#, escape_xml(author)));
    }
    if let Some(initials) = &comment.initials {
        attributes.push(format!(r#"w:initials="{}""#, escape_xml(initials)));
    }
    if let Some(date) = &comment.date {
        attributes.push(format!(r#"w:date="{}""#, escape_xml(date)));
    }
    let preserve = if should_preserve_whitespace(&comment.text) {
        r#" xml:space="preserve""#
    } else {
        ""
    };
    (
        format!(
            r#"<w:comment {}><w:p w14:paraId="{}"><w:r><w:t{}>{}</w:t></w:r></w:p></w:comment>"#,
            attributes.join(" "),
            escape_xml(&paragraph_id),
            preserve,
            escape_xml(&comment.text)
        ),
        paragraph_id,
    )
}

fn comment_id_from_block(block: &str) -> Option<i64> {
    let open_end = opening_tag_end(block, 0)?;
    get_attribute(&block[..open_end], "w:id")?.parse().ok()
}

fn replace_xml_ranges(
    source: &str,
    mut replacements: Vec<(usize, usize, String)>,
) -> String {
    replacements.sort_by(|left, right| right.0.cmp(&left.0));
    let mut updated = source.to_string();
    for (start, end, value) in replacements {
        updated.replace_range(start..end, &value);
    }
    updated
}

fn ensure_comments_root_namespaces(xml: &str) -> String {
    let Some(root) = extract_balanced_tag_ranges(xml, "w:comments").into_iter().next() else {
        return xml.to_string();
    };
    let Some(open_end) = opening_tag_end(xml, root.start) else {
        return xml.to_string();
    };
    let mut open_tag = xml[root.start..open_end].to_string();
    open_tag = ensure_namespace(&open_tag, "w", WORD_MAIN_NS);
    open_tag = ensure_namespace(&open_tag, "w14", WORD_2010_NS);
    open_tag = ensure_namespace(&open_tag, "mc", MARKUP_COMPATIBILITY_NS);
    open_tag = ensure_ignorable_prefix(&open_tag, "w14");
    format!("{}{}{}", &xml[..root.start], open_tag, &xml[open_end..])
}

fn merge_comments_xml(
    existing: Option<&str>,
    rendered_by_id: &HashMap<i64, String>,
) -> String {
    if let Some(existing) = existing {
        let ranges = extract_balanced_tag_ranges(existing, "w:comment");
        let mut seen = std::collections::HashSet::new();
        let replacements = ranges
            .into_iter()
            .filter_map(|range| {
                let block = &existing[range.start..range.end];
                let id = comment_id_from_block(block)?;
                let rendered = rendered_by_id.get(&id)?;
                seen.insert(id);
                Some((range.start, range.end, rendered.clone()))
            })
            .collect::<Vec<_>>();
        let mut merged = replace_xml_ranges(existing, replacements);
        let mut missing = rendered_by_id
            .iter()
            .filter(|(id, _)| !seen.contains(id))
            .collect::<Vec<_>>();
        missing.sort_by_key(|(id, _)| **id);
        if !missing.is_empty() {
            let appended = missing
                .into_iter()
                .map(|(_, block)| block.as_str())
                .collect::<String>();
            if let Some(close_start) = merged.rfind("</w:comments>") {
                merged.insert_str(close_start, &appended);
            }
        }
        return ensure_comments_root_namespaces(&merged);
    }

    let mut rendered = rendered_by_id.iter().collect::<Vec<_>>();
    rendered.sort_by_key(|(id, _)| **id);
    let blocks = rendered
        .into_iter()
        .map(|(_, block)| block.as_str())
        .collect::<String>();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="{WORD_MAIN_NS}" xmlns:w14="{WORD_2010_NS}" xmlns:mc="{MARKUP_COMPATIBILITY_NS}" mc:Ignorable="w14">{blocks}</w:comments>"#
    )
}

#[derive(Clone)]
struct CommentExtendedState {
    done: Option<bool>,
    parent_paragraph_id: Option<String>,
    patch_done: bool,
    patch_parent: bool,
}

fn patch_comment_extended_block(
    block: &str,
    state: &CommentExtendedState,
    force: bool,
) -> String {
    let Some(open_end) = opening_tag_end(block, 0) else {
        return block.to_string();
    };
    let mut open_tag = block[..open_end].to_string();
    if (force || state.patch_done) && state.done.is_some() {
        let done = state.done.unwrap_or(false);
        open_tag = set_xml_attribute(&open_tag, "w15:done", if done { "1" } else { "0" });
    }
    if (force || state.patch_parent) && state.parent_paragraph_id.is_some() {
        let parent_id = state.parent_paragraph_id.as_deref().unwrap_or_default();
        open_tag = set_xml_attribute(&open_tag, "w15:paraIdParent", parent_id);
    }
    format!("{}{}", open_tag, &block[open_end..])
}

fn merge_comments_extended_xml(
    existing: Option<&str>,
    desired: &HashMap<String, CommentExtendedState>,
) -> Option<String> {
    if desired.is_empty() {
        return existing.map(str::to_string);
    }
    if let Some(existing) = existing {
        let ranges = extract_balanced_tag_ranges(existing, "w15:commentEx");
        let mut seen = std::collections::HashSet::new();
        let replacements = ranges
            .into_iter()
            .filter_map(|range| {
                let block = &existing[range.start..range.end];
                let open_end = opening_tag_end(block, 0)?;
                let paragraph_id = get_attribute(&block[..open_end], "w15:paraId")?;
                let state = desired.get(&paragraph_id)?;
                seen.insert(paragraph_id);
                Some((
                    range.start,
                    range.end,
                    patch_comment_extended_block(block, state, false),
                ))
            })
            .collect::<Vec<_>>();
        let mut merged = replace_xml_ranges(existing, replacements);
        let mut missing = desired
            .iter()
            .filter(|(paragraph_id, _)| !seen.contains(*paragraph_id))
            .collect::<Vec<_>>();
        missing.sort_by_key(|(paragraph_id, _)| *paragraph_id);
        let appended = missing
            .into_iter()
            .map(|(paragraph_id, state)| {
                let mut tag = format!(
                    r#"<w15:commentEx w15:paraId="{}"/>"#,
                    escape_xml(paragraph_id)
                );
                tag = patch_comment_extended_block(&tag, state, true);
                tag
            })
            .collect::<String>();
        if let Some(close_start) = merged.rfind("</w15:commentsEx>") {
            merged.insert_str(close_start, &appended);
        }
        return Some(merged);
    }

    let mut states = desired.iter().collect::<Vec<_>>();
    states.sort_by_key(|(paragraph_id, _)| *paragraph_id);
    let entries = states
        .into_iter()
        .map(|(paragraph_id, state)| {
            let tag = format!(
                r#"<w15:commentEx w15:paraId="{}"/>"#,
                escape_xml(paragraph_id)
            );
            patch_comment_extended_block(&tag, state, true)
        })
        .collect::<String>();
    Some(format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w15:commentsEx xmlns:w15="{WORD_2012_NS}">{entries}</w15:commentsEx>"#
    ))
}

fn ensure_document_relationship(pkg: &mut OoxmlPackage, relationship_type: &str, target: &str) {
    let part_name = "word/_rels/document.xml.rels";
    let existing = pkg
        .parts
        .get(part_name)
        .map(|part| part.content.clone())
        .unwrap_or_else(|| EMPTY_RELATIONSHIPS_XML.to_string());
    let relationships = parse_relationships_xml(&existing);
    if relationships.iter().any(|relationship| {
        relationship.r#type == relationship_type && relationship.target == target
    }) {
        return;
    }
    let relationship = format!(
        r#"<Relationship Id="rId{}" Type="{}" Target="{}"/>"#,
        next_relationship_index(&relationships),
        escape_xml(relationship_type),
        escape_xml(target)
    );
    let updated = if let Some(close_start) = existing.rfind("</Relationships>") {
        format!(
            "{}{}{}",
            &existing[..close_start],
            relationship,
            &existing[close_start..]
        )
    } else if let Some(root_start) = existing.find("<Relationships") {
        if let Some(root_end) = opening_tag_end(&existing, root_start) {
            let root_tag = &existing[root_start..root_end];
            if root_tag.trim_end().ends_with("/>") {
                let slash = root_tag
                    .rfind('/')
                    .unwrap_or(root_tag.len().saturating_sub(1));
                format!(
                    "{}{}>{}</Relationships>{}",
                    &existing[..root_start],
                    &root_tag[..slash],
                    relationship,
                    &existing[root_end..]
                )
            } else {
                existing
            }
        } else {
            existing
        }
    } else {
        existing
    };
    pkg.parts.insert(
        part_name.to_string(),
        OoxmlPart {
            name: part_name.to_string(),
            content: updated,
        },
    );
}

fn serialize_comment_parts(model: &DocModel, pkg: &mut OoxmlPackage) {
    let Some(comments) = model.metadata.comments.as_ref().filter(|comments| !comments.is_empty()) else {
        return;
    };

    let extended_comment_ids = comments
        .iter()
        .filter(|comment| {
            comment.resolved.is_some()
                || comment.source_resolved.is_some()
                || comment.resolution_dirty == Some(true)
                || comment.is_new == Some(true)
                || comment.parent_id.is_some()
        })
        .map(|comment| comment.id)
        .chain(comments.iter().filter_map(|comment| comment.parent_id))
        .collect::<std::collections::HashSet<_>>();
    let paragraph_id_by_comment_id = comments
        .iter()
        .map(|comment| (comment.id, comment_paragraph_id(comment)))
        .collect::<HashMap<_, _>>();
    let rendered_by_id = comments
        .iter()
        .map(|comment| {
            let (rendered, _) =
                render_comment_block(comment, extended_comment_ids.contains(&comment.id));
            (comment.id, rendered)
        })
        .collect::<HashMap<_, _>>();

    let comments_xml = merge_comments_xml(
        pkg.parts.get("word/comments.xml").map(|part| part.content.as_str()),
        &rendered_by_id,
    );
    pkg.parts.insert(
        "word/comments.xml".to_string(),
        OoxmlPart {
            name: "word/comments.xml".to_string(),
            content: comments_xml,
        },
    );

    let desired_extended = comments
        .iter()
        .filter(|comment| extended_comment_ids.contains(&comment.id))
        .filter_map(|comment| {
            let paragraph_id = paragraph_id_by_comment_id.get(&comment.id)?.clone();
            let parent_paragraph_id = comment
                .parent_id
                .and_then(|parent_id| paragraph_id_by_comment_id.get(&parent_id).cloned());
            Some((
                paragraph_id,
                CommentExtendedState {
                    done: comment.resolved.or(comment.source_resolved),
                    parent_paragraph_id,
                    patch_done: comment.resolution_dirty == Some(true)
                        || comment.is_new == Some(true),
                    patch_parent: comment.is_new == Some(true),
                },
            ))
        })
        .collect::<HashMap<_, _>>();
    if let Some(comments_extended_xml) = merge_comments_extended_xml(
        pkg.parts
            .get("word/commentsExtended.xml")
            .map(|part| part.content.as_str()),
        &desired_extended,
    ) {
        pkg.parts.insert(
            "word/commentsExtended.xml".to_string(),
            OoxmlPart {
                name: "word/commentsExtended.xml".to_string(),
                content: comments_extended_xml,
            },
        );
    }

    ensure_content_type_override(pkg, "word/comments.xml", COMMENTS_CONTENT_TYPE);
    ensure_document_relationship(pkg, REL_TYPE_COMMENTS, "comments.xml");
    if pkg.parts.contains_key("word/commentsExtended.xml") {
        ensure_content_type_override(
            pkg,
            "word/commentsExtended.xml",
            COMMENTS_EXTENDED_CONTENT_TYPE,
        );
        ensure_document_relationship(
            pkg,
            REL_TYPE_COMMENTS_EXTENDED,
            "commentsExtended.xml",
        );
    }
}

fn upsert_settings_element(
    xml: &str,
    container_tag: &str,
    tag_name: &str,
    attributes: &[(&str, &str)],
    matches: impl Fn(&str) -> bool,
) -> String {
    for range in extract_balanced_tag_ranges(xml, tag_name) {
        let Some(open_end) = opening_tag_end(xml, range.start) else {
            continue;
        };
        let opening_tag = &xml[range.start..open_end];
        if !matches(opening_tag) {
            continue;
        }
        let updated_tag = attributes.iter().fold(opening_tag.to_string(), |tag, (name, value)| {
            set_xml_attribute(&tag, name, value)
        });
        let mut updated = xml.to_string();
        updated.replace_range(range.start..open_end, &updated_tag);
        return updated;
    }

    let attributes_xml = attributes.iter().map(|(name, value)| {
        format!(r#" {name}="{}""#, escape_xml(value))
    }).collect::<String>();
    let child_xml = format!("<{tag_name}{attributes_xml}/>");
    let Some(container_range) = extract_balanced_tag_ranges(xml, container_tag).into_iter().next() else {
        return xml.to_string();
    };
    let Some(open_end) = opening_tag_end(xml, container_range.start) else {
        return xml.to_string();
    };
    let opening_tag = &xml[container_range.start..open_end];
    let mut updated = xml.to_string();
    if opening_tag.trim_end().ends_with("/>") {
        let expanded = format!(
            "{}>{child_xml}</{container_tag}>",
            opening_tag.trim_end().trim_end_matches('>').trim_end().trim_end_matches('/').trim_end(),
        );
        updated.replace_range(container_range.start..container_range.end, &expanded);
        return updated;
    }
    let closing_tag = format!("</{container_tag}>");
    let Some(close_start) = xml[container_range.start..container_range.end].rfind(&closing_tag) else {
        return xml.to_string();
    };
    let mut insert_at = container_range.start + close_start;
    if container_tag == "w:settings" {
        if let Some(index) = SETTINGS_TAIL_ORDER.iter().position(|name| *name == tag_name) {
            for following_tag in &SETTINGS_TAIL_ORDER[index + 1..] {
                if let Some(range) = extract_balanced_tag_ranges(xml, following_tag).into_iter().next() {
                    if range.start >= open_end && range.start < insert_at {
                        insert_at = range.start;
                    }
                }
            }
        }
    }
    updated.insert_str(insert_at, &child_xml);
    updated
}

fn remove_settings_element(xml: &str, tag_name: &str, matches: impl Fn(&str) -> bool) -> String {
    let mut updated = xml.to_string();
    for range in extract_balanced_tag_ranges(xml, tag_name).into_iter().rev() {
        let Some(open_end) = opening_tag_end(xml, range.start) else {
            continue;
        };
        if matches(&xml[range.start..open_end]) {
            updated.replace_range(range.start..range.end, "");
        }
    }
    updated
}

const COMPAT_PROPERTIES_ORDER: &[&str] = &[
    "w:useSingleBorderforContiguousCells",
    "w:wpJustification",
    "w:noTabHangInd",
    "w:noLeading",
    "w:spaceForUL",
    "w:noColumnBalance",
    "w:balanceSingleByteDoubleByteWidth",
    "w:noExtraLineSpacing",
    "w:doNotLeaveBackslashAlone",
    "w:ulTrailSpace",
    "w:doNotExpandShiftReturn",
    "w:spacingInWholePoints",
    "w:lineWrapLikeWord6",
    "w:printBodyTextBeforeHeader",
    "w:printColBlack",
    "w:wpSpaceWidth",
    "w:showBreaksInFrames",
    "w:subFontBySize",
    "w:suppressBottomSpacing",
    "w:suppressTopSpacing",
    "w:suppressSpacingAtTopOfPage",
    "w:suppressTopSpacingWP",
    "w:suppressSpBfAfterPgBrk",
    "w:swapBordersFacingPages",
    "w:convMailMergeEsc",
    "w:truncateFontHeightsLikeWP6",
    "w:mwSmallCaps",
    "w:usePrinterMetrics",
    "w:doNotSuppressParagraphBorders",
    "w:wrapTrailSpaces",
    "w:footnoteLayoutLikeWW8",
    "w:shapeLayoutLikeWW8",
    "w:alignTablesRowByRow",
    "w:forgetLastTabAlignment",
    "w:adjustLineHeightInTable",
    "w:autoSpaceLikeWord95",
    "w:noSpaceRaiseLower",
    "w:doNotUseHTMLParagraphAutoSpacing",
    "w:layoutRawTableWidth",
    "w:layoutTableRowsApart",
    "w:useWord97LineBreakRules",
    "w:doNotBreakWrappedTables",
    "w:doNotSnapToGridInCell",
    "w:selectFldWithFirstOrLastChar",
    "w:applyBreakingRules",
    "w:doNotWrapTextWithPunct",
    "w:doNotUseEastAsianBreakRules",
    "w:useWord2002TableStyleRules",
    "w:growAutofit",
    "w:useFELayout",
    "w:useNormalStyleForList",
    "w:doNotUseIndentAsNumberingTabStop",
    "w:useAltKinsokuLineBreakRules",
    "w:allowSpaceOfSameStyleInTable",
    "w:doNotSuppressIndentation",
    "w:doNotAutofitConstrainedTables",
    "w:autofitToFirstFixedWidthCell",
    "w:underlineTabInNumList",
    "w:displayHangulFixedWidth",
    "w:splitPgBreakAndParaMark",
    "w:doNotVertAlignCellWithSp",
    "w:doNotBreakConstrainedForcedTable",
    "w:doNotVertAlignInTxbx",
    "w:useAnsiKerningPairs",
    "w:cachedColBalance",
    "w:compatSetting",
];

fn serialize_document_settings(model: &DocModel, pkg: &mut OoxmlPackage) {
    let original_compatibility = crate::parse::parse_document_compatibility_settings(pkg);
    let original_tab_stop = crate::parse::parse_document_default_tab_stop_twips(pkg);
    let compatibility = model.metadata.compatibility.as_ref();
    let raw_compatibility_mode = compatibility.and_then(|settings| settings.compatibility_mode);
    let compatibility_mode = raw_compatibility_mode.filter(|mode| u32::try_from(*mode).is_ok());
    let even_and_odd_headers = compatibility.and_then(|settings| settings.even_and_odd_headers);
    let default_tab_stop = model
        .metadata
        .default_tab_stop_twips
        .filter(|value| *value >= 0);
    let imported_settings = model.metadata.document_settings_imported == Some(true);
    let mode_changed = (compatibility_mode.is_some()
        || (imported_settings && raw_compatibility_mode.is_none()))
        && compatibility_mode
            != original_compatibility
                .as_ref()
                .and_then(|settings| settings.compatibility_mode);
    let headers_changed = (even_and_odd_headers.is_some() || imported_settings)
        && even_and_odd_headers
            != original_compatibility
                .as_ref()
                .and_then(|settings| settings.even_and_odd_headers);
    let tabs_changed = (default_tab_stop.is_some()
        || (imported_settings && model.metadata.default_tab_stop_twips.is_none()))
        && default_tab_stop != original_tab_stop;
    let imported_line_settings = model.metadata.line_spacing_compatibility_imported == Some(true);
    let line_settings = [
        (
            "w:noLeading",
            compatibility.and_then(|value| value.no_leading),
            original_compatibility
                .as_ref()
                .and_then(|value| value.no_leading),
        ),
        (
            "w:spaceForUL",
            compatibility.and_then(|value| value.space_for_ul),
            original_compatibility
                .as_ref()
                .and_then(|value| value.space_for_ul),
        ),
        (
            "w:noExtraLineSpacing",
            compatibility.and_then(|value| value.no_extra_line_spacing),
            original_compatibility
                .as_ref()
                .and_then(|value| value.no_extra_line_spacing),
        ),
        (
            "w:suppressBottomSpacing",
            compatibility.and_then(|value| value.suppress_bottom_spacing),
            original_compatibility
                .as_ref()
                .and_then(|value| value.suppress_bottom_spacing),
        ),
        (
            "w:suppressTopSpacingWP",
            compatibility.and_then(|value| value.suppress_top_spacing_wp),
            original_compatibility
                .as_ref()
                .and_then(|value| value.suppress_top_spacing_wp),
        ),
        (
            "w:truncateFontHeightsLikeWP6",
            compatibility.and_then(|value| value.truncate_font_heights_like_wp6),
            original_compatibility
                .as_ref()
                .and_then(|value| value.truncate_font_heights_like_wp6),
        ),
    ];
    let line_settings_changed = line_settings.iter().any(|(_, current, original)| {
        (current.is_some() || imported_line_settings) && current != original
    });
    if !mode_changed && !headers_changed && !tabs_changed && !line_settings_changed {
        return;
    }

    let mut settings_xml = pkg.parts.get("word/settings.xml")
        .map(|part| part.content.clone())
        .unwrap_or_else(|| format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="{WORD_MAIN_NS}"/>"#,
        ));
    if tabs_changed {
        settings_xml = if let Some(default_tab_stop) = default_tab_stop {
            let value = default_tab_stop.to_string();
            upsert_settings_element(
                &settings_xml,
                "w:settings",
                "w:defaultTabStop",
                &[("w:val", &value)],
                |_| true,
            )
        } else {
            remove_settings_element(&settings_xml, "w:defaultTabStop", |_| true)
        };
    }
    if headers_changed {
        settings_xml = if let Some(even_and_odd_headers) = even_and_odd_headers {
            let value = if even_and_odd_headers { "1" } else { "0" };
            upsert_settings_element(
                &settings_xml,
                "w:settings",
                "w:evenAndOddHeaders",
                &[("w:val", value)],
                |_| true,
            )
        } else {
            remove_settings_element(&settings_xml, "w:evenAndOddHeaders", |_| true)
        };
    }
    if mode_changed {
        let compat_range = extract_balanced_tag_ranges(&settings_xml, "w:compat")
            .into_iter()
            .next();
        let compat_xml = compat_range
            .as_ref()
            .map(|range| &settings_xml[range.start..range.end])
            .unwrap_or("<w:compat/>");
        let matches_mode = |tag: &str| {
            get_attribute(tag, "w:name").as_deref() == Some("compatibilityMode")
                && get_attribute(tag, "w:uri").as_deref()
                    == Some("http://schemas.microsoft.com/office/word")
        };
        let updated_compat = if let Some(compatibility_mode) = compatibility_mode {
            let mode = compatibility_mode.to_string();
            upsert_settings_element(
                compat_xml,
                "w:compat",
                "w:compatSetting",
                &[
                    ("w:name", "compatibilityMode"),
                    ("w:uri", "http://schemas.microsoft.com/office/word"),
                    ("w:val", &mode),
                ],
                matches_mode,
            )
        } else {
            remove_settings_element(compat_xml, "w:compatSetting", matches_mode)
        };
        if let Some(range) = compat_range {
            settings_xml.replace_range(range.start..range.end, &updated_compat);
        } else {
            settings_xml =
                upsert_settings_element(&settings_xml, "w:settings", "w:compat", &[], |_| true);
            if let Some(range) = extract_balanced_tag_ranges(&settings_xml, "w:compat")
                .into_iter()
                .next()
            {
                settings_xml.replace_range(range.start..range.end, &updated_compat);
            }
        }
    }
    if line_settings_changed {
        let range = extract_balanced_tag_ranges(&settings_xml, "w:settings")
            .into_iter()
            .next()
            .and_then(|settings| {
                direct_property_children(&settings_xml[settings.start..settings.end])
                    .into_iter()
                    .find(|(name, _)| name == "w:compat")
                    .map(|(_, child)| crate::xml::TagRange {
                        start: settings.start + child.start,
                        end: settings.start + child.end,
                    })
            });
        let mut compat = range
            .as_ref()
            .map(|range| settings_xml[range.start..range.end].to_string())
            .unwrap_or_else(|| "<w:compat/>".to_string());
        for (name, current, original) in line_settings {
            if (current.is_none() && !imported_line_settings) || current == original {
                continue;
            }
            let attributes =
                current.map(|value| [("w:val", if value { "1" } else { "0" }.to_string())]);
            compat = patch_direct_table_property(
                &compat,
                "w:compat",
                name,
                attributes.as_ref().map(|values| values.as_slice()),
                COMPAT_PROPERTIES_ORDER,
            );
        }
        if let Some(range) = range {
            settings_xml.replace_range(range.start..range.end, &compat);
        } else if !direct_property_children(&compat).is_empty() {
            settings_xml =
                upsert_settings_element(&settings_xml, "w:settings", "w:compat", &[], |_| true);
            if let Some(range) = extract_balanced_tag_ranges(&settings_xml, "w:compat")
                .into_iter()
                .next()
            {
                settings_xml.replace_range(range.start..range.end, &compat);
            }
        }
    }
    pkg.parts.insert(
        "word/settings.xml".to_string(),
        OoxmlPart {
            name: "word/settings.xml".to_string(),
            content: settings_xml,
        },
    );
    ensure_content_type_override(pkg, "word/settings.xml", SETTINGS_CONTENT_TYPE);
    ensure_document_relationship(pkg, REL_TYPE_SETTINGS, "settings.xml");
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
    serialize_comment_parts(model, &mut result);
    serialize_document_settings(model, &mut result);
    result
}

pub fn serialize_docx(model: &DocModel, base_package: Option<&OoxmlPackage>) -> Result<Vec<u8>, String> {
    package_to_bytes(&serialize_doc_model(model, base_package))
}
