use crate::model::{
    ParagraphDropCap, ParagraphDropCapType, ParagraphSpacing, ParagraphStyle,
    ParagraphTextAlignment, SharedParagraphStyle, SharedTextStyle, TextLigatures, TextStyle, VerticalAlign,
};
use crate::parse::context::{ParseContext, ThemeFontMap};
use crate::parse::re;
use crate::parse::util::{
    active_xml as prefer_alternate_content_choice, merge_paragraph_boolean,
    merge_paragraph_border_sets, merge_paragraph_indent, merge_paragraph_spacing,
    merge_paragraph_tab_stops, normalize_heading_level, normalize_hex_color,
    parse_paragraph_border_set_from_xml, parse_paragraph_indent_from_xml,
    parse_paragraph_numbering_from_xml, parse_paragraph_numbering_parts_from_xml,
    parse_paragraph_shading_from_xml, parse_paragraph_spacing_from_xml,
    parse_paragraph_tab_stops_from_xml, parse_text_run_border_style, resolve_theme_font,
    to_model_alignment,
};
use crate::xml::{
    extract_balanced_tag_blocks, get_attribute, parse_integer_attribute, parse_on_off_attribute,
    parse_underline_attribute,
};

pub fn parse_paragraph_drop_cap_from_xml(
    paragraph_properties_xml: &str,
) -> Option<ParagraphDropCap> {
    let frame_pr_tag =
        super::scan::find_tag_token_ref(paragraph_properties_xml, "w:framePr").unwrap_or_default();
    if frame_pr_tag.is_empty() {
        return None;
    }
    let drop_cap_raw =
        get_attribute(&frame_pr_tag, "w:dropCap").map(|v| v.trim().to_ascii_lowercase())?;
    let drop_cap_type = match drop_cap_raw.as_str() {
        "drop" => ParagraphDropCapType::Drop,
        "margin" => ParagraphDropCapType::Margin,
        _ => return None,
    };
    let lines = parse_integer_attribute(&frame_pr_tag, "w:lines");
    let wrap = get_attribute(&frame_pr_tag, "w:wrap").map(|v| v.trim().to_string());
    let horizontal_anchor = get_attribute(&frame_pr_tag, "w:hAnchor").map(|v| v.trim().to_string());
    let vertical_anchor = get_attribute(&frame_pr_tag, "w:vAnchor").map(|v| v.trim().to_string());
    let x_twips = parse_integer_attribute(&frame_pr_tag, "w:x");
    let y_twips = parse_integer_attribute(&frame_pr_tag, "w:y");
    let horizontal_space_twips = parse_integer_attribute(&frame_pr_tag, "w:hSpace");
    let vertical_space_twips = parse_integer_attribute(&frame_pr_tag, "w:vSpace");
    Some(ParagraphDropCap {
        drop_cap_type,
        lines: lines.filter(|l| *l > 0),
        wrap,
        horizontal_anchor,
        vertical_anchor,
        x_twips,
        y_twips,
        horizontal_space_twips,
        vertical_space_twips,
    })
}

pub(crate) fn parse_paragraph_text_alignment_from_xml(xml: &str) -> Option<ParagraphTextAlignment> {
    let tag = super::styles::direct_table_property(xml, "w:textAlignment")?;
    match get_attribute(tag, "w:val")?.to_ascii_lowercase().as_str() {
        "auto" => Some(ParagraphTextAlignment::Auto),
        "top" => Some(ParagraphTextAlignment::Top),
        "center" => Some(ParagraphTextAlignment::Center),
        "baseline" => Some(ParagraphTextAlignment::Baseline),
        "bottom" => Some(ParagraphTextAlignment::Bottom),
        _ => None,
    }
}

pub fn parse_paragraph_align_from_xml(xml: &str) -> Option<crate::model::ParagraphAlignment> {
    let alignment = super::scan::find_attribute_value_in_tag(xml, "w:jc", "w:val")
        .filter(|value| !value.is_empty());
    to_model_alignment(alignment.as_deref())
}

pub(crate) fn parse_text_ligatures_from_xml(xml: &str) -> Option<TextLigatures> {
    super::scan::find_attribute_value_in_tag(xml, "w14:ligatures", "w14:val")
        .as_deref()
        .and_then(TextLigatures::from_xml_value)
}

pub(crate) fn parse_contextual_alternates_from_xml(xml: &str) -> Option<bool> {
    let tag = super::scan::find_tag_token(xml, "w14:cntxtAlts")?;
    match get_attribute(&tag, "w14:val").as_deref() {
        None | Some("true" | "1") => Some(true),
        Some("false" | "0") => Some(false),
        _ => None,
    }
}

pub(crate) fn parse_character_scale_percent_value(raw: &str) -> Option<u16> {
    let value = raw.trim();
    let (digits, negative) = if let Some(digits) = value.strip_suffix('%') {
        (digits, false)
    } else if let Some(digits) = value.strip_prefix('-') {
        (digits, true)
    } else {
        (value.strip_prefix('+').unwrap_or(value), false)
    };
    if digits.is_empty() || !digits.bytes().all(|digit| digit.is_ascii_digit()) {
        return None;
    }
    let significant_digits = digits.trim_start_matches('0');
    let percent = if significant_digits.is_empty() {
        0
    } else {
        significant_digits.parse::<u16>().ok()?
    };
    (percent <= 600 && (!negative || percent == 0)).then_some(percent)
}

pub(crate) fn parse_character_scale_percent_from_xml(xml: &str) -> Option<u16> {
    let tag = super::scan::find_tag_token(xml, "w:w")?;
    get_attribute(&tag, "w:val")
        .as_deref()
        .map(parse_character_scale_percent_value)
        .unwrap_or(Some(100))
}

fn text_script_flags(xml: &str) -> u8 {
    if xml.is_ascii() && !xml.contains("&#") {
        return 0;
    }
    let mut flags = 0;
    if let Some(pattern) = re::get(r"(?is)<(?:w|a):t\b[^>]*>([\s\S]*?)</(?:w|a):t>") {
        for caps in pattern.captures_iter(xml) {
            if let Some(text) = caps.get(1) {
                for ch in crate::xml::decode_xml_entities(text.as_str()).chars() {
                    let code = ch as u32;
                    if matches!(code, 0x2e80..=0x9fff | 0xac00..=0xd7af) {
                        flags |= 1;
                    }
                    if matches!(code, 0x0590..=0x08ff | 0xfb1d..=0xfefc) {
                        flags |= 2;
                    }
                }
            }
        }
    }
    flags
}

pub fn parse_text_style_from_xml(xml: &str, theme_fonts: &ThemeFontMap) -> Option<TextStyle> {
    cached_text_style(xml, theme_fonts, text_script_flags(xml))
}

fn has_drawing_text_style_tags(xml: &str) -> bool {
    xml.split('<').skip(1).any(|tag| {
        if !super::scan::starts_with_ignore_ascii_case(tag, "a:") {
            return false;
        }
        let tag = &tag[2..];
        match tag.as_bytes().first().map(u8::to_ascii_lowercase) {
            Some(b'r') => super::scan::starts_with_ignore_ascii_case(tag, "rPr"),
            Some(b'd') => super::scan::starts_with_ignore_ascii_case(tag, "defRPr"),
            Some(b'l') => super::scan::starts_with_ignore_ascii_case(tag, "latin"),
            _ => false,
        }
    })
}

fn parse_text_style_with_scripts(
    xml: &str,
    theme_fonts: &ThemeFontMap,
    scripts: u8,
) -> Option<TextStyle> {
    if xml.is_empty() {
        return None;
    }
    let bold = parse_on_off_attribute(xml, "b");
    let italic = parse_on_off_attribute(xml, "i");
    let underline = parse_underline_attribute(xml);
    let strike = parse_on_off_attribute(xml, "strike");
    let all_caps = parse_on_off_attribute(xml, "caps");
    let small_caps = parse_on_off_attribute(xml, "smallCaps");

    let color_match = super::scan::find_attribute_value_in_tag(xml, "w:color", "w:val")
        .filter(|value| !value.is_empty());
    let highlight_match = super::scan::find_attribute_value_in_tag(xml, "w:highlight", "w:val")
        .filter(|value| !value.is_empty());
    let shading_tag = super::scan::find_tag_token_ref(xml, "w:shd");
    let character_spacing_match =
        super::scan::find_attribute_value_in_tag(xml, "w:spacing", "w:val");
    let size_match = super::scan::find_attribute_value_in_tag(xml, "w:sz", "w:val")
        .filter(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()));
    let complex_size_match = super::scan::find_attribute_value_in_tag(xml, "w:szCs", "w:val")
        .filter(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()));
    let run_fonts_tag = super::scan::find_tag_token_ref(xml, "w:rFonts").unwrap_or_default();
    let ascii_font = get_attribute(&run_fonts_tag, "w:ascii");
    let h_ansi_font = get_attribute(&run_fonts_tag, "w:hAnsi");
    let east_asia_font = get_attribute(&run_fonts_tag, "w:eastAsia");
    let complex_script_font = get_attribute(&run_fonts_tag, "w:cs");
    let ascii_theme_font = get_attribute(&run_fonts_tag, "w:asciiTheme");
    let h_ansi_theme_font = get_attribute(&run_fonts_tag, "w:hAnsiTheme");
    let east_asia_theme_font = get_attribute(&run_fonts_tag, "w:eastAsiaTheme");
    let complex_script_theme_font = get_attribute(&run_fonts_tag, "w:csTheme");
    let font_hint = get_attribute(&run_fonts_tag, "w:hint");
    let language_tag = super::scan::find_tag_token_ref(xml, "w:lang").unwrap_or_default();
    let language = get_attribute(&language_tag, "w:val");
    let language_east_asia = get_attribute(&language_tag, "w:eastAsia");
    let language_bidi = get_attribute(&language_tag, "w:bidi");
    let right_to_left = parse_on_off_attribute(xml, "rtl");
    let complex_script = parse_on_off_attribute(xml, "cs");
    let vertical_align_match =
        super::scan::find_attribute_value_in_tag(xml, "w:vertAlign", "w:val")
            .filter(|value| !value.is_empty());
    let drawing_xml = if has_drawing_text_style_tags(xml) {
        xml
    } else {
        ""
    };
    let drawing_bold_match = regex_capture(drawing_xml, r#"(?i)<a:rPr\b[^>]*\bb="([^"]+)""#);
    let drawing_italic_match = regex_capture(drawing_xml, r#"(?i)<a:rPr\b[^>]*\bi="([^"]+)""#);
    let drawing_underline_match = regex_capture(drawing_xml, r#"(?i)<a:rPr\b[^>]*\bu="([^"]+)""#);
    let drawing_strike_match =
        regex_capture(drawing_xml, r#"(?i)<a:rPr\b[^>]*\b(?:strike|s)="([^"]+)""#);
    let drawing_color_match = regex_capture(
        drawing_xml,
        r#"(?is)<a:rPr\b[\s\S]*?<a:(?:solidFill|srgbClr)\b[\s\S]*?<a:srgbClr\b[^>]*val="([^"]+)""#,
    );
    let drawing_size_match = regex_capture(drawing_xml, r#"(?i)<a:rPr\b[^>]*\bsz="(\d+)""#);
    let drawing_font_match = regex_capture(
        drawing_xml,
        r#"(?is)<a:rPr\b[\s\S]*?<a:latin\b[^>]*typeface="([^"]+)""#,
    );
    let drawing_default_font_match = regex_capture(
        drawing_xml,
        r#"(?is)<a:defRPr\b[\s\S]*?<a:latin\b[^>]*typeface="([^"]+)""#,
    );
    let drawing_any_latin_match =
        regex_capture(drawing_xml, r#"(?i)<a:latin\b[^>]*typeface="([^"]+)""#);
    let run_border_tag = super::scan::find_tag_token_ref(xml, "w:bdr");

    let contains_east_asia_glyphs = scripts & 1 != 0;
    let contains_complex_script_glyphs = scripts & 2 != 0;

    let mut style = TextStyle {
        bold: None,
        italic: None,
        underline: None,
        strike: None,
        all_caps: None,
        small_caps: None,
        color: None,
        highlight: None,
        background_color: None,
        font_size_pt: None,
        font_size_cs_pt: None,
        font_family: None,
        source_font_family: None,
        font_family_ascii: None,
        font_family_h_ansi: None,
        font_family_east_asia: None,
        font_family_cs: None,
        font_theme_ascii: None,
        font_theme_h_ansi: None,
        font_theme_east_asia: None,
        font_theme_cs: None,
        resolved_font_family_ascii: None,
        resolved_font_family_h_ansi: None,
        resolved_font_family_east_asia: None,
        resolved_font_family_cs: None,
        font_hint: None,
        language: None,
        language_east_asia: None,
        language_bidi: None,
        right_to_left: None,
        complex_script: None,
        character_spacing_twips: None,
        character_scale_percent: None,
        source_character_scale: None,
        kerning_min_font_size_pt: None,
        ligatures: None,
        contextual_alternates: None,
        vertical_align: None,
        run_border: None,
    };
    let mut has_any = false;

    if let Some(v) = bold {
        style.bold = Some(v);
        has_any = true;
    }
    if let Some(v) = italic {
        style.italic = Some(v);
        has_any = true;
    }
    if let Some(v) = underline {
        style.underline = Some(v);
        has_any = true;
    }
    if let Some(v) = strike {
        style.strike = Some(v);
        has_any = true;
    }
    if let Some(v) = all_caps {
        style.all_caps = Some(v);
        has_any = true;
    }
    if let Some(v) = small_caps {
        style.small_caps = Some(v);
        has_any = true;
    }

    if style.bold.is_none() {
        if let Some(value) = drawing_bold_match {
            let value = value.to_ascii_lowercase();
            style.bold = Some(value != "0" && value != "false");
            has_any = true;
        }
    }
    if style.italic.is_none() {
        if let Some(value) = drawing_italic_match {
            let value = value.to_ascii_lowercase();
            style.italic = Some(value != "0" && value != "false");
            has_any = true;
        }
    }
    if style.underline.is_none() {
        if let Some(value) = drawing_underline_match {
            let value = value.to_ascii_lowercase();
            style.underline = Some(value != "none" && value != "false" && value != "0");
            has_any = true;
        }
    }
    if style.strike.is_none() {
        if let Some(value) = drawing_strike_match {
            let value = value.to_ascii_lowercase();
            style.strike =
                Some(value != "nostrike" && value != "none" && value != "false" && value != "0");
            has_any = true;
        }
    }

    if let Some(color) = normalize_hex_color(color_match.as_deref()) {
        style.color = Some(color);
        has_any = true;
    } else if let Some(color) = normalize_hex_color(drawing_color_match.as_deref()) {
        style.color = Some(color);
        has_any = true;
    }

    if let Some(highlight) = highlight_match {
        style.highlight = Some(highlight);
        has_any = true;
    }

    if let Some(tag) = shading_tag.as_deref() {
        if let Some(fill) = normalize_hex_color(get_attribute(tag, "w:fill").as_deref()) {
            style.background_color = Some(fill);
            has_any = true;
        }
    }

    style.character_scale_percent = parse_character_scale_percent_from_xml(xml);
    style.source_character_scale = super::scan::find_attribute_value_in_tag(xml, "w:w", "w:val");
    has_any |= style.character_scale_percent.is_some() || style.source_character_scale.is_some();

    if let Some(spacing) = character_spacing_match.and_then(|v| v.parse::<i64>().ok()) {
        style.character_spacing_twips = Some(spacing);
        has_any = true;
    }

    if let Some(ligatures) = parse_text_ligatures_from_xml(xml) {
        style.ligatures = Some(ligatures);
        has_any = true;
    }
    if let Some(contextual_alternates) = parse_contextual_alternates_from_xml(xml) {
        style.contextual_alternates = Some(contextual_alternates);
        has_any = true;
    }

    if let Some(kerning) = super::scan::find_attribute_value_in_tag(xml, "w:kern", "w:val")
        .filter(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
        .and_then(|value| value.parse::<f64>().ok())
    {
        if kerning.is_finite() && kerning >= 0.0 {
            style.kerning_min_font_size_pt = Some(kerning / 2.0);
            has_any = true;
        }
    }

    if let Some(size) = size_match.and_then(|v| v.parse::<f64>().ok()) {
        style.font_size_pt = Some(size / 2.0);
        has_any = true;
    } else if let Some(size) = drawing_size_match.and_then(|v| v.parse::<f64>().ok()) {
        style.font_size_pt = Some(size / 100.0);
        has_any = true;
    }

    if let Some(size) = complex_size_match.and_then(|v| v.parse::<f64>().ok()) {
        style.font_size_cs_pt = Some(size / 2.0);
        has_any = true;
    }

    style.font_family_ascii = ascii_font.clone();
    style.font_family_h_ansi = h_ansi_font.clone();
    style.font_family_east_asia = east_asia_font.clone();
    style.font_family_cs = complex_script_font.clone();
    style.font_theme_ascii = ascii_theme_font.clone();
    style.font_theme_h_ansi = h_ansi_theme_font.clone();
    style.font_theme_east_asia = east_asia_theme_font.clone();
    style.font_theme_cs = complex_script_theme_font.clone();
    style.resolved_font_family_ascii = ascii_theme_font
        .as_deref()
        .and_then(|token| resolve_theme_font(Some(token), theme_fonts))
        .or_else(|| ascii_font.clone());
    style.resolved_font_family_h_ansi = h_ansi_theme_font
        .as_deref()
        .and_then(|token| resolve_theme_font(Some(token), theme_fonts))
        .or_else(|| h_ansi_font.clone());
    style.resolved_font_family_east_asia = east_asia_theme_font
        .as_deref()
        .and_then(|token| resolve_theme_font(Some(token), theme_fonts))
        .or_else(|| east_asia_font.clone());
    style.resolved_font_family_cs = complex_script_theme_font
        .as_deref()
        .and_then(|token| resolve_theme_font(Some(token), theme_fonts))
        .or_else(|| complex_script_font.clone());
    style.font_hint = font_hint;
    style.language = language;
    style.language_east_asia = language_east_asia;
    style.language_bidi = language_bidi;
    style.right_to_left = right_to_left;
    style.complex_script = complex_script;
    has_any |= style.font_family_ascii.is_some()
        || style.font_family_h_ansi.is_some()
        || style.font_family_east_asia.is_some()
        || style.font_family_cs.is_some()
        || style.font_theme_ascii.is_some()
        || style.font_theme_h_ansi.is_some()
        || style.font_theme_east_asia.is_some()
        || style.font_theme_cs.is_some()
        || style.resolved_font_family_ascii.is_some()
        || style.resolved_font_family_h_ansi.is_some()
        || style.resolved_font_family_east_asia.is_some()
        || style.resolved_font_family_cs.is_some()
        || style.font_hint.is_some()
        || style.language.is_some()
        || style.language_east_asia.is_some()
        || style.language_bidi.is_some()
        || style.right_to_left.is_some()
        || style.complex_script.is_some();

    let run_font_family = ascii_font.clone().or(h_ansi_font.clone());
    let run_theme_font_token = ascii_theme_font.clone().or(h_ansi_theme_font.clone());
    let east_asia_fallback_font = if contains_east_asia_glyphs {
        east_asia_font.clone()
    } else {
        None
    };
    let east_asia_fallback_theme_token = if contains_east_asia_glyphs {
        east_asia_theme_font.clone()
    } else {
        None
    };
    let complex_script_fallback_font = if contains_complex_script_glyphs {
        complex_script_font.clone()
    } else {
        None
    };
    let complex_script_fallback_theme_token = if contains_complex_script_glyphs {
        complex_script_theme_font.clone()
    } else {
        None
    };
    let symbol_fallback_font = {
        let font = east_asia_font.clone().or(complex_script_font.clone());
        font.as_deref()
            .filter(|f| {
                re::get_unchecked(r"(?i)(symbol|emoji|dingbats?|wingdings|webdings)").is_match(f)
            })
            .map(|_| east_asia_font.clone().or(complex_script_font.clone()))
            .flatten()
    };

    if let Some(family) = run_font_family {
        style.font_family = Some(family);
        has_any = true;
    } else if let Some(token) = run_theme_font_token.as_deref() {
        if let Some(family) = resolve_theme_font(Some(token), theme_fonts) {
            style.font_family = Some(family);
            has_any = true;
        }
    } else if let Some(family) = east_asia_fallback_font {
        style.font_family = Some(family);
        has_any = true;
    } else if let Some(token) = east_asia_fallback_theme_token.as_deref() {
        if let Some(family) = resolve_theme_font(Some(token), theme_fonts) {
            style.font_family = Some(family);
            has_any = true;
        }
    } else if let Some(family) = complex_script_fallback_font {
        style.font_family = Some(family);
        has_any = true;
    } else if let Some(token) = complex_script_fallback_theme_token.as_deref() {
        if let Some(family) = resolve_theme_font(Some(token), theme_fonts) {
            style.font_family = Some(family);
            has_any = true;
        }
    } else if let Some(family) = symbol_fallback_font {
        style.font_family = Some(family);
        has_any = true;
    } else if let Some(family) = drawing_font_match {
        style.font_family = Some(family);
        has_any = true;
    } else if let Some(family) = drawing_default_font_match {
        style.font_family = Some(family);
        has_any = true;
    } else if let Some(family) = drawing_any_latin_match {
        style.font_family = Some(family);
        has_any = true;
    }
    style.source_font_family = style.font_family.clone();

    if let Some(value) = vertical_align_match.map(|v| v.to_ascii_lowercase()) {
        style.vertical_align = match value.as_str() {
            "superscript" => Some(VerticalAlign::Superscript),
            "subscript" => Some(VerticalAlign::Subscript),
            _ => None,
        };
        if style.vertical_align.is_some() {
            has_any = true;
        }
    }

    if let Some(border) = parse_text_run_border_style(run_border_tag.as_deref()) {
        style.run_border = Some(border);
        has_any = true;
    }

    if has_any {
        Some(style)
    } else {
        None
    }
}

/// ECMA-376 §17.7.3 toggle-property resolution: a toggle set true by both the
/// paragraph style and the character style cancels out (XOR across style
/// application levels). Direct formatting and explicit `val="0"` stay
/// absolute, and basedOn chains resolve by normal inheritance beforehand.
fn resolve_toggle_property(
    default_value: Option<bool>,
    paragraph_value: Option<bool>,
    character_value: Option<bool>,
    direct_value: Option<bool>,
) -> Option<bool> {
    if direct_value.is_some() {
        return direct_value;
    }
    if paragraph_value == Some(true) && character_value == Some(true) {
        return Some(false);
    }
    character_value.or(paragraph_value).or(default_value)
}

type RawStyleEntries =
    std::collections::HashMap<String, Vec<(u8, ThemeFontMap, Option<SharedTextStyle>)>>;

#[derive(Default)]
struct RunStyleCache {
    entries: RawStyleEntries,
    resolved: std::collections::HashMap<String, Vec<ResolvedRunStyle>>,
    paragraphs:
        std::collections::HashMap<String, Vec<(Option<ParagraphSpacing>, Option<SharedParagraphStyle>)>>,
    mark_default: Option<CachedMarkDefaultStyle>,
    #[cfg(not(target_arch = "wasm32"))]
    sheet: Option<std::sync::Arc<super::context::ParsedStyleSheet>>,
}

struct CachedMarkDefaultStyle {
    document: Option<TextStyle>,
    bound_document: bool,
    table: Option<TextStyle>,
    style: Option<SharedTextStyle>,
}

struct ResolvedRunStyle {
    scripts: u8,
    paragraph: Option<String>,
    table: Option<Box<TextStyle>>,
    style: Option<SharedTextStyle>,
}

thread_local! {
    static RUN_STYLE_CACHE: std::cell::RefCell<Option<RunStyleCache>> = const { std::cell::RefCell::new(None) };
}

pub(crate) struct RunStyleCacheScope(Option<RunStyleCache>);

#[cfg(not(target_arch = "wasm32"))]
thread_local! {
    static RETAINED_RAW_STYLES: std::cell::RefCell<Option<RawStyleEntries>> = const { std::cell::RefCell::new(None) };
    static RETAINED_RESOLVED_STYLES: std::cell::RefCell<Option<RunStyleCache>> = const { std::cell::RefCell::new(None) };
}

pub(crate) fn bind_style_cache(sheet: &super::context::ParsedStyleSheet) {
    #[cfg(not(target_arch = "wasm32"))]
    if let Some(identity) = super::styles::cached_document_style_identity(sheet) {
        bind_shared_style_cache(identity);
    }
    #[cfg(target_arch = "wasm32")]
    let _ = sheet;
}

#[cfg(not(target_arch = "wasm32"))]
fn bind_shared_style_cache(sheet: std::sync::Arc<super::context::ParsedStyleSheet>) {
    RUN_STYLE_CACHE.with(|current| {
        let mut current = current.borrow_mut();
        let Some(current) = current.as_mut() else { return; };
        if current.sheet.as_ref().is_some_and(|previous| std::sync::Arc::ptr_eq(previous, &sheet)) {
            return;
        }
        let previous = RETAINED_RESOLVED_STYLES.with(|retained| retained.take())
            .filter(|previous| previous.sheet.as_ref().is_some_and(|previous| std::sync::Arc::ptr_eq(previous, &sheet)));
        current.resolved.clear();
        current.paragraphs.clear();
        current.mark_default = None;
        current.sheet = Some(sheet);
        if let Some(previous) = previous {
            current.resolved = previous.resolved;
            current.paragraphs = previous.paragraphs;
            current.mark_default = previous.mark_default;
        }
    });
}

pub(crate) fn run_style_cache_scope() -> RunStyleCacheScope {
    #[allow(unused_mut)]
    let mut current = RunStyleCache::default();
    #[cfg(not(target_arch = "wasm32"))]
    if RUN_STYLE_CACHE.with(|cache| cache.borrow().is_none()) {
        current.entries = RETAINED_RAW_STYLES
            .with(|cache| cache.take())
            .unwrap_or_default();
    }
    RunStyleCacheScope(RUN_STYLE_CACHE.with(|cache| cache.replace(Some(current))))
}

impl Drop for RunStyleCacheScope {
    fn drop(&mut self) {
        #[cfg(not(target_arch = "wasm32"))]
        let outer = self.0.is_none();
        let _current = RUN_STYLE_CACHE.with(|cache| cache.replace(self.0.take()));
        #[cfg(not(target_arch = "wasm32"))]
        if outer {
            if let Some(mut current) = _current {
                if current.entries.len() <= 512
                    && current.entries.keys().map(String::len).sum::<usize>() <= 512 * 1024
                    && current.entries.values().map(Vec::len).sum::<usize>() <= 1024
                {
                    RETAINED_RAW_STYLES
                        .with(|cache| cache.replace(Some(std::mem::take(&mut current.entries))));
                }
                current.entries = RawStyleEntries::default();
                if current.sheet.is_some()
                    && current.resolved.len() + current.paragraphs.len() <= 512
                    && current.resolved.keys().chain(current.paragraphs.keys()).map(String::len).sum::<usize>() <= 512 * 1024
                    && current.resolved.values().map(Vec::len).sum::<usize>()
                        + current.paragraphs.values().map(Vec::len).sum::<usize>() <= 1024
                {
                    RETAINED_RESOLVED_STYLES.with(|cache| cache.replace(Some(current)));
                }
            }
        }
    }
}

fn same_mark_default_style(left: Option<&TextStyle>, right: Option<&TextStyle>) -> bool {
    if left != right {
        return false;
    }
    let (Some(left), Some(right)) = (left, right) else {
        return true;
    };
    left.font_size_pt.map(f64::to_bits) == right.font_size_pt.map(f64::to_bits)
        && left.font_size_cs_pt.map(f64::to_bits) == right.font_size_cs_pt.map(f64::to_bits)
        && left.kerning_min_font_size_pt.map(f64::to_bits)
            == right.kerning_min_font_size_pt.map(f64::to_bits)
        && left
            .run_border
            .as_ref()
            .and_then(|border| border.size_eighth_pt)
            .map(f64::to_bits)
            == right
                .run_border
                .as_ref()
                .and_then(|border| border.size_eighth_pt)
                .map(f64::to_bits)
        && left
            .run_border
            .as_ref()
            .and_then(|border| border.space_pt)
            .map(f64::to_bits)
            == right
                .run_border
                .as_ref()
                .and_then(|border| border.space_pt)
                .map(f64::to_bits)
}

fn mark_document_is_bound(cache: &RunStyleCache, document: Option<&TextStyle>) -> bool {
    #[cfg(not(target_arch = "wasm32"))]
    {
        cache.sheet.as_ref().is_some_and(|sheet| {
            match (sheet.default_run_style.as_ref(), document) {
                (Some(left), Some(right)) => std::ptr::eq(left, right),
                (None, None) => true,
                _ => false,
            }
        })
    }
    #[cfg(target_arch = "wasm32")]
    {
        let _ = (cache, document);
        false
    }
}

pub(crate) fn cached_mark_default_style(
    document: Option<&TextStyle>,
    table: Option<&TextStyle>,
) -> Option<SharedTextStyle> {
    let cached = RUN_STYLE_CACHE.with(|cache| {
        let cache = cache.borrow();
        let cache = cache.as_ref()?;
        let entry = cache.mark_default.as_ref()?;
        ((entry.bound_document && mark_document_is_bound(cache, document)
            || same_mark_default_style(entry.document.as_ref(), document))
            && same_mark_default_style(entry.table.as_ref(), table))
        .then(|| entry.style.clone())
    });
    if let Some(style) = cached {
        return style;
    }
    let style: Option<SharedTextStyle> =
        super::util::merge_text_style_refs(&[document, table]).map(Into::into);
    RUN_STYLE_CACHE.with(|cache| {
        if let Some(cache) = cache.borrow_mut().as_mut() {
            cache.mark_default = Some(CachedMarkDefaultStyle {
                document: document.cloned(),
                bound_document: mark_document_is_bound(cache, document),
                table: table.cloned(),
                style: style.clone(),
            });
        }
    });
    style
}

pub(crate) fn cached_definition_style(xml: &str, fonts: &ThemeFontMap) -> Option<TextStyle> {
    cached_text_style(xml, fonts, 128)
}

fn cached_text_style(xml: &str, fonts: &ThemeFontMap, scripts: u8) -> Option<TextStyle> {
    if xml.is_empty() {
        return None;
    }
    if RUN_STYLE_CACHE.with(|cache| cache.borrow().is_none()) {
        return if scripts == 128 {
            super::styles::parse_definition_style_uncached(xml, fonts)
        } else {
            parse_text_style_with_scripts(xml, fonts, scripts)
        };
    }
    cached_shared_text_style(xml, fonts, scripts).map(SharedTextStyle::into_owned)
}

pub(crate) fn parse_shared_text_style_from_xml(
    xml: &str,
    fonts: &ThemeFontMap,
) -> Option<SharedTextStyle> {
    cached_shared_text_style(xml, fonts, text_script_flags(xml))
}

fn cached_shared_text_style(
    xml: &str,
    fonts: &ThemeFontMap,
    scripts: u8,
) -> Option<SharedTextStyle> {
    if xml.is_empty() {
        return None;
    }
    let cached = RUN_STYLE_CACHE.with(|cache| {
        let cache = cache.borrow();
        cache
            .as_ref()?
            .entries
            .get(xml)?
            .iter()
            .find(|(flags, theme, _)| *flags == scripts && theme == fonts)
            .map(|(_, _, style)| style.clone())
    });
    if let Some(style) = cached {
        return style;
    }
    let style = if scripts == 128 {
        super::styles::parse_definition_style_uncached(xml, fonts)
    } else {
        parse_text_style_with_scripts(xml, fonts, scripts)
    }
    .map(SharedTextStyle::from);
    if xml.len() <= 8192 {
        RUN_STYLE_CACHE.with(|cache| {
            if let Some(cache) = cache
                .borrow_mut()
                .as_mut()
                .filter(|cache| cache.entries.len() < 4096)
            {
                let variants = cache
                    .entries
                    .entry(xml.to_owned())
                    .or_insert_with(|| Vec::with_capacity(1));
                if variants.len() < 16 {
                    variants.push((scripts, fonts.clone(), style.clone()));
                }
            }
        });
    }
    return style;
}

fn ordinary_run_properties(run_xml: &str) -> Option<&str> {
    let mut properties = None;
    let mut seen = false;
    if let Some(ordinary) = crate::xml_index::for_each_child(run_xml, |name, xml| {
        seen = true;
        if name.eq_ignore_ascii_case("w:rPr") {
            return properties.replace(xml).is_none();
        }
        if name.eq_ignore_ascii_case("w:fldChar") && !xml.ends_with("/>") {
            return false;
        }
        [
            "w:t",
            "w:tab",
            "w:br",
            "w:cr",
            "w:sym",
            "w:noBreakHyphen",
            "w:softHyphen",
            "w:footnoteReference",
            "w:endnoteReference",
            "w:instrText",
            "w:fldChar",
            "w:lastRenderedPageBreak",
        ]
        .iter()
        .any(|tag| name.eq_ignore_ascii_case(tag))
    }) {
        return (ordinary && seen).then(|| properties.unwrap_or(""));
    }
    let ranges = crate::xml::extract_direct_child_tag_ranges(run_xml);
    let ordinary = !ranges.is_empty()
        && ranges
            .iter()
            .filter(|range| range.tag_name.eq_ignore_ascii_case("w:rPr"))
            .count()
            <= 1
        && ranges.iter().all(|range| {
            if range.tag_name.eq_ignore_ascii_case("w:fldChar")
                && !run_xml[range.start..range.end].ends_with("/>")
            {
                return false;
            }
            [
                "w:rPr",
                "w:t",
                "w:tab",
                "w:br",
                "w:cr",
                "w:sym",
                "w:noBreakHyphen",
                "w:softHyphen",
                "w:footnoteReference",
                "w:endnoteReference",
                "w:instrText",
                "w:fldChar",
                "w:lastRenderedPageBreak",
            ]
            .iter()
            .any(|tag| range.tag_name.eq_ignore_ascii_case(tag))
        });
    if ordinary {
        let properties = ranges
            .iter()
            .find(|range| range.tag_name.eq_ignore_ascii_case("w:rPr"))
            .map(|range| &run_xml[range.start..range.end])
            .unwrap_or("");
        return Some(properties);
    }
    None
}

fn parse_direct_run_style(
    run_xml: &str,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
) -> Option<TextStyle> {
    let text_box_content = prefer_alternate_content_choice(run_xml);
    let text_box_run_xml = extract_balanced_tag_blocks(&text_box_content, "w:txbxContent")
        .into_iter()
        .next()
        .and_then(|txbx| extract_balanced_tag_blocks(&txbx, "w:r").into_iter().next());
    parse_text_style_from_xml(
        text_box_run_xml.as_deref().unwrap_or(run_xml),
        &context.styles().theme_fonts,
    )
}

pub fn parse_run_style(
    run_xml: &str,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
    paragraph_style_id: Option<&str>,
) -> Option<TextStyle> {
    parse_run_style_in_table(run_xml, context, paragraph_style_id, None)
        .map(SharedTextStyle::into_owned)
}

pub(crate) fn parse_run_style_in_table(
    run_xml: &str,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
    paragraph_style_id: Option<&str>,
    table_run_style: Option<&TextStyle>,
) -> Option<SharedTextStyle> {
    let properties = ordinary_run_properties(run_xml);
    resolve_run_style(
        run_xml,
        properties,
        context,
        paragraph_style_id,
        table_run_style,
    )
}

pub(crate) fn parse_mark_run_style(
    properties: &str,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
    paragraph_style_id: Option<&str>,
    table_run_style: Option<&TextStyle>,
) -> Option<SharedTextStyle> {
    resolve_run_style(
        properties,
        Some(properties),
        context,
        paragraph_style_id,
        table_run_style,
    )
}

fn resolve_run_style(
    run_xml: &str,
    properties: Option<&str>,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
    paragraph_style_id: Option<&str>,
    table_run_style: Option<&TextStyle>,
) -> Option<SharedTextStyle> {
    let scripts = if properties.is_some_and(|xml| !xml.is_empty()) {
        text_script_flags(run_xml)
    } else {
        0
    };
    resolve_run_style_with_scripts(
        run_xml,
        properties,
        scripts,
        context,
        paragraph_style_id,
        table_run_style,
    )
}

pub(crate) fn parse_run_style_from_properties(
    run_xml: &str,
    properties: &str,
    scripts: u8,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
    paragraph_style_id: Option<&str>,
    table_run_style: Option<&TextStyle>,
) -> Option<SharedTextStyle> {
    resolve_run_style_with_scripts(
        run_xml,
        Some(properties),
        if properties.is_empty() { 0 } else { scripts },
        context,
        paragraph_style_id,
        table_run_style,
    )
}

fn resolve_run_style_with_scripts(
    run_xml: &str,
    properties: Option<&str>,
    scripts: u8,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
    paragraph_style_id: Option<&str>,
    table_run_style: Option<&TextStyle>,
) -> Option<SharedTextStyle> {
    if let Some(xml) = properties {
        let cached = RUN_STYLE_CACHE.with(|cache| {
            let cache = cache.borrow();
            cache
                .as_ref()?
                .resolved
                .get(xml)?
                .iter()
                .find(|entry| {
                    entry.scripts == scripts
                        && entry.paragraph.as_deref() == paragraph_style_id
                        && same_mark_default_style(entry.table.as_deref(), table_run_style)
                })
                .map(|entry| entry.style.clone())
        });
        if let Some(style) = cached {
            return style;
        }
    }
    let run_style_id = super::scan::find_attribute_value_in_tag(run_xml, "w:rStyle", "w:val")
        .filter(|value| !value.is_empty());
    let direct = match properties {
        Some(xml) => cached_shared_text_style(xml, &context.styles().theme_fonts, scripts),
        None => parse_direct_run_style(run_xml, context).map(SharedTextStyle::from),
    };
    let inherited_paragraph_run_style = paragraph_style_id
        .and_then(|id| context.styles().paragraph_style_by_id.get(id))
        .and_then(|style| style.run_style.as_ref());
    let inherited_run_style = run_style_id
        .as_deref()
        .and_then(|id| context.styles().run_style_by_id.get(id));
    let default_run_style = super::util::merge_text_style_refs(&[
        context.styles().default_run_style.as_ref(),
        table_run_style,
    ]);

    let toggle_of = |get: fn(&TextStyle) -> Option<bool>| {
        resolve_toggle_property(
            default_run_style.as_ref().and_then(get),
            inherited_paragraph_run_style.and_then(get),
            inherited_run_style.and_then(get),
            direct.as_deref().and_then(get),
        )
    };
    let bold = toggle_of(|s| s.bold);
    let italic = toggle_of(|s| s.italic);
    let strike = toggle_of(|s| s.strike);
    let all_caps = toggle_of(|s| s.all_caps);
    let small_caps = toggle_of(|s| s.small_caps);

    let merged = super::util::merge_text_style_refs(&[
        default_run_style.as_ref(),
        inherited_paragraph_run_style,
        inherited_run_style,
        direct.as_deref(),
    ]);
    let resolved = merged.map(|mut style| {
        style.bold = bold;
        style.italic = italic;
        style.strike = strike;
        style.all_caps = all_caps;
        style.small_caps = small_caps;
        SharedTextStyle::from(style)
    });
    if let Some(xml) = properties.filter(|xml| xml.len() <= 8192) {
        RUN_STYLE_CACHE.with(|cache| {
            if let Some(cache) = cache
                .borrow_mut()
                .as_mut()
                .filter(|cache| cache.resolved.len() < 4096)
            {
                let variants = cache
                    .resolved
                    .entry(xml.to_owned())
                    .or_insert_with(|| Vec::with_capacity(1));
                if variants.len() < 32 {
                    variants.push(ResolvedRunStyle {
                        scripts,
                        paragraph: paragraph_style_id.map(str::to_owned),
                        table: table_run_style.cloned().map(Box::new),
                        style: resolved.clone(),
                    });
                }
            }
        });
    }
    resolved
}

pub fn parse_paragraph_style(
    paragraph_xml: &str,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
) -> Option<ParagraphStyle> {
    parse_paragraph_style_in_table(paragraph_xml, context, None)
}

pub fn parse_paragraph_style_in_table(
    paragraph_xml: &str,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
    table_paragraph_spacing: Option<&ParagraphSpacing>,
) -> Option<ParagraphStyle> {
    let xml = super::styles::direct_table_property(paragraph_xml, "w:pPr").unwrap_or("");
    parse_paragraph_style_from_properties(xml, context, table_paragraph_spacing)
        .map(SharedParagraphStyle::into_owned)
}

pub(crate) fn parse_paragraph_style_from_properties(
    xml: &str,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
    table_paragraph_spacing: Option<&ParagraphSpacing>,
) -> Option<SharedParagraphStyle> {
    let cached = RUN_STYLE_CACHE.with(|cache| {
        let cache = cache.borrow();
        cache
            .as_ref()?
            .paragraphs
            .get(xml)?
            .iter()
            .find(|(spacing, _)| spacing.as_ref() == table_paragraph_spacing)
            .map(|(_, style)| style.clone())
    });
    if let Some(style) = cached {
        return style;
    }
    let style = parse_paragraph_style_uncached(xml, context, table_paragraph_spacing)
        .map(SharedParagraphStyle::from);
    if xml.len() <= 8192 {
        RUN_STYLE_CACHE.with(|cache| {
            if let Some(cache) = cache
                .borrow_mut()
                .as_mut()
                .filter(|cache| cache.paragraphs.len() < 4096)
            {
                let variants = cache
                    .paragraphs
                    .entry(xml.to_owned())
                    .or_insert_with(|| Vec::with_capacity(1));
                if variants.len() < 16 {
                    variants.push((table_paragraph_spacing.cloned(), style.clone()));
                }
            }
        });
    }
    style
}

fn parse_paragraph_style_uncached(
    original_paragraph_properties_xml: &str,
    context: &ParseContext<'_, impl std::borrow::Borrow<super::context::ParsedStyleSheet>>,
    table_paragraph_spacing: Option<&ParagraphSpacing>,
) -> Option<ParagraphStyle> {
    let paragraph_properties_xml =
        crate::xml::without_direct_child_tags(original_paragraph_properties_xml, "w:pPrChange");
    let alignment_match =
        super::scan::find_attribute_value_in_tag(&paragraph_properties_xml, "w:jc", "w:val")
            .filter(|value| !value.is_empty());
    let p_style_match =
        super::scan::find_attribute_value_in_tag(&paragraph_properties_xml, "w:pStyle", "w:val")
            .filter(|value| !value.is_empty());
    let direct_snap_to_grid = parse_on_off_attribute(&paragraph_properties_xml, "snapToGrid");
    let direct_text_alignment = parse_paragraph_text_alignment_from_xml(&paragraph_properties_xml);
    let direct_spacing = parse_paragraph_spacing_from_xml(&paragraph_properties_xml);
    let direct_indent = parse_paragraph_indent_from_xml(&paragraph_properties_xml);
    let direct_background_color = parse_paragraph_shading_from_xml(&paragraph_properties_xml);
    let direct_borders = parse_paragraph_border_set_from_xml(&paragraph_properties_xml);
    let direct_numbering = parse_paragraph_numbering_from_xml(&paragraph_properties_xml);
    let direct_tab_stops = parse_paragraph_tab_stops_from_xml(&paragraph_properties_xml);
    let direct_drop_cap = parse_paragraph_drop_cap_from_xml(&paragraph_properties_xml);
    let direct_contextual_spacing =
        parse_on_off_attribute(&paragraph_properties_xml, "contextualSpacing");
    let direct_keep_next = parse_on_off_attribute(&paragraph_properties_xml, "keepNext");
    let direct_keep_lines = parse_on_off_attribute(&paragraph_properties_xml, "keepLines");
    let direct_widow_control = parse_on_off_attribute(&paragraph_properties_xml, "widowControl");
    let direct_page_break_before =
        parse_on_off_attribute(&paragraph_properties_xml, "pageBreakBefore");
    let has_direct_num_pr =
        re::get_unchecked(r"(?i)<w:numPr\b").is_match(&paragraph_properties_xml);

    let explicit_style_id = p_style_match;
    let style_id = explicit_style_id
        .clone()
        .or_else(|| context.styles().default_paragraph_style_id.clone());
    let inherited = style_id
        .as_deref()
        .and_then(|id| context.styles().paragraph_style_by_id.get(id));
    let default_paragraph_style = context.styles().default_paragraph_style.as_ref();

    let align = to_model_alignment(alignment_match.as_deref())
        .or_else(|| inherited.and_then(|s| s.align))
        .or_else(|| default_paragraph_style.and_then(|s| s.align));
    let inherited_text_alignment = inherited
        .and_then(|style| style.text_alignment)
        .or_else(|| default_paragraph_style.and_then(|style| style.text_alignment))
        .or(context.styles().default_paragraph_text_alignment);
    let text_alignment = direct_text_alignment.or(inherited_text_alignment);
    let inherited_snap_to_grid = inherited
        .and_then(|style| style.snap_to_grid)
        .or_else(|| default_paragraph_style.and_then(|style| style.snap_to_grid));
    let snap_to_grid = direct_snap_to_grid.or(inherited_snap_to_grid);
    let heading_level = super::styles::parse_heading_level_from_outline(&paragraph_properties_xml)
        .unwrap_or_else(|| match inherited {
            Some(style) => style.heading_level,
            None => normalize_heading_level(explicit_style_id.as_deref())
                .or_else(|| default_paragraph_style.and_then(|s| s.heading_level)),
        });
    let numbering = if has_direct_num_pr {
        direct_numbering.or_else(|| {
            // A direct numPr without a usable numId either removes numbering
            // (numId present but <= 0) or, when it carries only an ilvl,
            // changes the level of the style-provided list (ECMA-376: numId
            // and ilvl inherit independently through the hierarchy).
            match parse_paragraph_numbering_parts_from_xml(&paragraph_properties_xml) {
                Some((None, Some(direct_ilvl))) => inherited
                    .and_then(|s| s.numbering.clone())
                    .or_else(|| default_paragraph_style.and_then(|s| s.numbering.clone()))
                    .map(|style_numbering| crate::model::ParagraphNumbering {
                        num_id: style_numbering.num_id,
                        ilvl: direct_ilvl.max(0),
                    }),
                _ => None,
            }
        })
    } else {
        direct_numbering
            .or_else(|| inherited.and_then(|s| s.numbering.clone()))
            .or_else(|| default_paragraph_style.and_then(|s| s.numbering.clone()))
    };
    // ECMA-376 style cascade: docDefaults < table style pPr < paragraph style
    // < direct pPr. The implicit default paragraph style (no explicit pStyle)
    // sits below the table-style layer; an explicit pStyle overrides it.
    let style_layer_spacing = if explicit_style_id.is_some() {
        merge_paragraph_spacing(
            table_paragraph_spacing,
            inherited.and_then(|s| s.spacing.as_ref()),
        )
    } else {
        merge_paragraph_spacing(
            inherited.and_then(|s| s.spacing.as_ref()),
            table_paragraph_spacing,
        )
    };
    let spacing = merge_paragraph_spacing(
        merge_paragraph_spacing(
            context.styles().doc_default_paragraph_spacing.as_ref(),
            style_layer_spacing.as_ref(),
        )
        .as_ref(),
        direct_spacing.as_ref(),
    );
    let indent = merge_paragraph_indent(
        merge_paragraph_indent(
            default_paragraph_style.and_then(|s| s.indent.as_ref()),
            inherited.and_then(|s| s.indent.as_ref()),
        )
        .as_ref(),
        direct_indent.as_ref(),
    );
    let background_color = direct_background_color.or_else(|| {
        inherited
            .and_then(|s| s.background_color.clone())
            .or_else(|| default_paragraph_style.and_then(|s| s.background_color.clone()))
    });
    let borders = merge_paragraph_border_sets(
        merge_paragraph_border_sets(
            default_paragraph_style.and_then(|s| s.borders.as_ref()),
            inherited.and_then(|s| s.borders.as_ref()),
        )
        .as_ref(),
        direct_borders.as_ref(),
    );
    let tab_stops = merge_paragraph_tab_stops(
        merge_paragraph_tab_stops(
            default_paragraph_style.and_then(|s| s.tab_stops.as_deref()),
            inherited.and_then(|s| s.tab_stops.as_deref()),
        )
        .as_deref(),
        Some(direct_tab_stops.as_slice()),
    );
    let contextual_spacing = merge_paragraph_boolean(
        merge_paragraph_boolean(
            default_paragraph_style.and_then(|s| s.contextual_spacing),
            inherited.and_then(|s| s.contextual_spacing),
        ),
        direct_contextual_spacing,
    );
    let keep_next = merge_paragraph_boolean(
        merge_paragraph_boolean(
            default_paragraph_style.and_then(|s| s.keep_next),
            inherited.and_then(|s| s.keep_next),
        ),
        direct_keep_next,
    );
    let keep_lines = merge_paragraph_boolean(
        merge_paragraph_boolean(
            default_paragraph_style.and_then(|s| s.keep_lines),
            inherited.and_then(|s| s.keep_lines),
        ),
        direct_keep_lines,
    );
    let widow_control = merge_paragraph_boolean(
        merge_paragraph_boolean(
            default_paragraph_style.and_then(|s| s.widow_control),
            inherited.and_then(|s| s.widow_control),
        ),
        direct_widow_control,
    );
    let page_break_before = merge_paragraph_boolean(
        merge_paragraph_boolean(
            default_paragraph_style.and_then(|s| s.page_break_before),
            inherited.and_then(|s| s.page_break_before),
        ),
        direct_page_break_before,
    );
    let style_name = inherited.map(|s| s.name.clone());

    if align.is_none()
        && snap_to_grid.is_none()
        && text_alignment.is_none()
        && heading_level.is_none()
        && style_id.is_none()
        && style_name.is_none()
        && numbering.is_none()
        && spacing.is_none()
        && indent.is_none()
        && background_color.is_none()
        && borders.is_none()
        && tab_stops.as_ref().is_none_or(|t| t.is_empty())
        && direct_drop_cap.is_none()
        && contextual_spacing.is_none()
        && keep_next.is_none()
        && keep_lines.is_none()
        && widow_control.is_none()
        && page_break_before.is_none()
    {
        return None;
    }

    Some(ParagraphStyle {
        align,
        snap_to_grid,
        source_snap_to_grid: snap_to_grid,
        source_has_snap_to_grid: Some(
            super::styles::direct_table_property(&paragraph_properties_xml, "w:snapToGrid")
                .is_some(),
        ),
        source_inherited_snap_to_grid: inherited_snap_to_grid,
        source_table_snap_to_grid: None,
        text_alignment,
        source_text_alignment: text_alignment,
        source_has_text_alignment: Some(
            super::styles::direct_table_property(&paragraph_properties_xml, "w:textAlignment")
                .is_some(),
        ),
        source_inherited_text_alignment: inherited_text_alignment,
        source_table_text_alignment: None,
        heading_level,
        style_id,
        style_name,
        numbering,
        source_before_auto_spacing: spacing
            .as_ref()
            .and_then(|spacing| spacing.before_auto_spacing),
        source_after_auto_spacing: spacing
            .as_ref()
            .and_then(|spacing| spacing.after_auto_spacing),
        spacing,
        indent,
        background_color,
        borders,
        tab_stops,
        drop_cap: direct_drop_cap,
        contextual_spacing,
        keep_next,
        keep_lines,
        widow_control,
        page_break_before,
    })
}

fn regex_capture(xml: &str, pattern: &str) -> Option<String> {
    if xml.is_empty() {
        return None;
    }
    re::get(pattern)?
        .captures(xml)
        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
}

#[cfg(test)]
mod shared_cache_tests {
    #[test]
    fn editing_one_cached_style_does_not_change_other_nodes() {
        let scope = super::run_style_cache_scope();
        let xml = "<w:rPr><w:b/></w:rPr>";
        let mut first = super::parse_shared_text_style_from_xml(xml, &Default::default()).unwrap();
        let second = super::parse_shared_text_style_from_xml(xml, &Default::default()).unwrap();
        drop(scope);
        first.bold = Some(false);
        assert_eq!(first.bold, Some(false));
        assert_eq!(second.bold, Some(true));
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod retained_style_tests {
    #[test]
    fn raw_style_reuse_preserves_theme_and_script_dependencies() {
        let xml = "<w:rPr><w:rFonts w:asciiTheme='minorHAnsi' w:eastAsia='East'/><w:b/><w:sz w:val='24'/></w:rPr>";
        for font in ["Serif", "Sans", "Serif"] {
            let theme = super::ThemeFontMap {
                minor_latin: Some(font.into()),
                ..Default::default()
            };
            for scripts in [0, 1, 2, 128] {
                let expected = if scripts == 128 {
                    crate::parse::styles::parse_definition_style_uncached(xml, &theme)
                } else {
                    super::parse_text_style_with_scripts(xml, &theme, scripts)
                };
                let _scope = super::run_style_cache_scope();
                assert_eq!(super::cached_text_style(xml, &theme, scripts), expected);
            }
        }
    }

    #[test]
    fn oversized_raw_style_sets_are_not_retained() {
        {
            let _scope = super::run_style_cache_scope();
            let theme = super::ThemeFontMap::default();
            for index in 1..=520 {
                let xml = format!("<w:rPr><w:sz w:val='{index}'/></w:rPr>");
                let actual = super::cached_text_style(&xml, &theme, 0).unwrap();
                assert_eq!(actual.font_size_pt, Some(index as f64 / 2.0));
            }
        }
        super::RETAINED_RAW_STYLES.with(|cache| assert!(cache.borrow().is_none()));
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod retained_resolution_tests {
    use super::*;
    use crate::package::{OoxmlPackage, OoxmlPart};
    use std::{cell::RefCell, collections::HashMap, sync::Arc};

    #[test]
    fn retained_resolution_is_bound_to_an_immutable_sheet() {
        let sheets: Vec<_> = ["Alpha", "Beta"].into_iter().enumerate().map(|(index, font)| {
            let name = "word/styles.xml".to_owned();
            let content = format!(r#"<w:styles><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="{font}"/><w:b w:val="{index}"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Main"><w:name w:val="{font}"/><w:pPr><w:spacing w:before="{}"/></w:pPr></w:style></w:styles>"#, 120 * (index + 1));
            let package = OoxmlPackage { parts: HashMap::from([(name.clone(), OoxmlPart { name, content })]), binary_assets: HashMap::new(), warnings: Vec::new() };
            Arc::new(super::super::styles::parse_document_style_sheet(&package))
        }).collect();
        let parts = HashMap::new();
        let assets = HashMap::new();
        let run = r#"<w:r><w:rPr><w:i/></w:rPr><w:t>text</w:t></w:r>"#;
        let paragraph = r#"<w:p><w:pPr><w:pStyle w:val="Main"/></w:pPr></w:p>"#;
        let mut expected_styles = Vec::new();
        for index in [0, 0, 1, 1, 0, 1, 0] {
            let sheet = &sheets[index];
            let context = ParseContext { relationships: HashMap::new(), content_types: Default::default(), parts: &parts, binary_assets: &assets, style_sheet: sheet.as_ref(), warnings: RefCell::new(Vec::new()) };
            let expected_run = parse_run_style(run, &context, Some("Main"));
            let expected_paragraph = parse_paragraph_style(paragraph, &context);
            expected_styles.push((expected_run.clone(), expected_paragraph.clone()));
            {
                let _scope = run_style_cache_scope();
                bind_shared_style_cache(Arc::clone(sheet));
                let mut actual_run = parse_run_style(run, &context, Some("Main"));
                let mut actual_paragraph = parse_paragraph_style(paragraph, &context);
                assert_eq!(actual_run, expected_run);
                assert_eq!(actual_paragraph, expected_paragraph);
                actual_run.as_mut().unwrap().font_family = Some("changed".to_owned());
                actual_paragraph.as_mut().unwrap().style_name = Some("changed".to_owned());
            }
            {
                let _scope = run_style_cache_scope();
                bind_shared_style_cache(Arc::clone(sheet));
                assert_eq!(parse_run_style(run, &context, Some("Main")), expected_run);
                assert_eq!(parse_paragraph_style(paragraph, &context), expected_paragraph);
                {
                    let _nested = run_style_cache_scope();
                    bind_shared_style_cache(Arc::clone(&sheets[1 - index]));
                }
                assert_eq!(parse_run_style(run, &context, Some("Main")), expected_run);
            }
        }
        assert_ne!(expected_styles[0], expected_styles[2]);
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod retained_numeric_style_tests {
    use super::*;
    use std::{cell::RefCell, collections::HashMap, sync::Arc};

    #[test]
    fn retained_table_formats_preserve_float_bits() {
        let sheet = Arc::new(super::super::context::ParsedStyleSheet::empty());
        let parts = HashMap::new();
        let assets = HashMap::new();
        let context = ParseContext { relationships: HashMap::new(), content_types: Default::default(), parts: &parts, binary_assets: &assets, style_sheet: sheet.as_ref(), warnings: RefCell::new(Vec::new()) };
        for value in [0.0_f64, -0.0_f64, 0.0_f64, -0.0_f64] {
            let mut table = parse_text_style_from_xml("<w:b/>", &Default::default()).unwrap();
            table.font_size_pt = Some(value);
            let _scope = run_style_cache_scope();
            bind_shared_style_cache(Arc::clone(&sheet));
            let actual = parse_run_style_in_table("<w:r><w:t>text</w:t></w:r>", &context, None, Some(&table)).unwrap();
            assert_eq!(actual.font_size_pt.unwrap().to_bits(), value.to_bits());
        }
    }
}

#[cfg(test)]
mod drawing_style_preflight_tests {
    use super::*;

    #[test]
    fn preflight_keeps_text_styles_and_ignores_geometry_only_content() {
        for xml in [
            r#"<a:rPr b="1"/>"#,
            r#"<A:RPR sz="1200"/>"#,
            r#"<a:defRPr><a:latin typeface="Primary"/></a:defRPr>"#,
            r#"<a:latin typeface="Primary"/>"#,
            r#"<![CDATA[<a:rPr b="1"/>]]>"#,
            r#"<a:rPr-extra b="1"/>"#,
        ] {
            assert!(has_drawing_text_style_tags(xml));
            assert!(parse_text_style_from_xml(xml, &Default::default()).is_some());
        }
        for xml in [
            "", "<a:", "<a:pt x=\"1\" y=\"2\"/>",
            "<a:rPrExtra/>", "<a:ln><a:noFill/></a:ln>",
            "<a:solidFill><a:srgbClr val=\"ffffff\"/></a:solidFill>",
        ] {
            assert!(parse_text_style_from_xml(xml, &Default::default()).is_none());
        }
        let xml = r#"<w:r><w:rPr><w:b/></w:rPr><a:pt x="1" y="2"/></w:r>"#;
        assert!(!has_drawing_text_style_tags(xml));
        assert_eq!(parse_text_style_from_xml(xml, &Default::default()).unwrap().bold, Some(true));
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod bound_mark_default_tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn bound_defaults_preserve_values_and_validate_unbound_inputs() {
        let mut defaults = parse_text_style_from_xml("<w:b/>", &Default::default()).unwrap();
        defaults.font_size_pt = Some(-0.0);
        let mut sheet = super::super::context::ParsedStyleSheet::empty();
        sheet.default_run_style = Some(defaults.clone());
        let sheet = Arc::new(sheet);
        let _scope = run_style_cache_scope();
        bind_shared_style_cache(Arc::clone(&sheet));
        for _ in 0..2 {
            let actual = cached_mark_default_style(sheet.default_run_style.as_ref(), None).unwrap();
            assert_eq!(*actual, defaults);
            assert_eq!(actual.font_size_pt.unwrap().to_bits(), (-0.0_f64).to_bits());
        }
        for value in [0.0_f64, -0.0_f64] {
            defaults.font_size_pt = Some(value);
            let actual = cached_mark_default_style(Some(&defaults), None).unwrap();
            assert_eq!(actual.font_size_pt.unwrap().to_bits(), value.to_bits());
        }
        defaults.bold = Some(false);
        assert_eq!(cached_mark_default_style(Some(&defaults), None).unwrap().bold, Some(false));
        assert_eq!(cached_mark_default_style(sheet.default_run_style.as_ref(), None).unwrap().bold, Some(true));
        let table = parse_text_style_from_xml("<w:i/>", &Default::default()).unwrap();
        assert_eq!(cached_mark_default_style(sheet.default_run_style.as_ref(), Some(&table)).unwrap().italic, Some(true));
        assert_eq!(cached_mark_default_style(sheet.default_run_style.as_ref(), None).unwrap().italic, None);
        bind_shared_style_cache(Arc::new(super::super::context::ParsedStyleSheet::empty()));
        assert!(cached_mark_default_style(None, None).is_none());
    }
}

#[cfg(test)]
mod shared_paragraph_cache_tests {
    use super::*;
    use std::{cell::RefCell, collections::HashMap};

    #[test]
    fn shared_paragraph_styles_preserve_cached_values_and_serialization() {
        let parts = HashMap::new();
        let assets = HashMap::new();
        let sheet = super::super::context::ParsedStyleSheet::empty();
        let context = ParseContext { relationships: HashMap::new(), content_types: Default::default(), parts: &parts, binary_assets: &assets, style_sheet: &sheet, warnings: RefCell::new(Vec::new()) };
        let _scope = run_style_cache_scope();
        let properties = "<w:pPr><w:jc w:val='center'/></w:pPr>";
        let mut first = parse_paragraph_style_from_properties(properties, &context, None).unwrap();
        let second = parse_paragraph_style_from_properties(properties, &context, None).unwrap();
        assert_eq!(serde_json::to_value(&second).unwrap(), serde_json::to_value(&*second).unwrap());
        first.style_name = Some("changed".into());
        assert!(second.style_name.is_none());
        assert_eq!(parse_paragraph_style_from_properties(properties, &context, None).unwrap(), second);
        let mut node: crate::model::ParagraphNode = serde_json::from_str(r#"{"type":"paragraph","children":[],"style":{"styleName":"base"}}"#).unwrap();
        let unchanged = node.clone();
        node.style.as_mut().unwrap().style_name = Some("changed".into());
        assert_eq!(unchanged.style.as_ref().unwrap().style_name.as_deref(), Some("base"));
    }
}
