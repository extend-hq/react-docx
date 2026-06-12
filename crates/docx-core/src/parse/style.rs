use crate::model::{
    ParagraphDropCap, ParagraphDropCapType, ParagraphSpacing, ParagraphStyle, TextStyle,
    VerticalAlign,
};
use crate::parse::context::{ParseContext, ThemeFontMap};
use crate::parse::re;
use crate::parse::util::{
    merge_paragraph_boolean, merge_paragraph_border_sets, merge_paragraph_indent,
    merge_paragraph_spacing, merge_paragraph_tab_stops, merge_text_styles,
    normalize_heading_level, normalize_hex_color, parse_paragraph_border_set_from_xml,
    parse_paragraph_indent_from_xml, parse_paragraph_numbering_from_xml,
    parse_paragraph_shading_from_xml, parse_paragraph_spacing_from_xml,
    parse_paragraph_tab_stops_from_xml, parse_text_run_border_style, prefer_alternate_content_choice,
    resolve_style_properties_block, resolve_theme_font, to_model_alignment,
};
use crate::xml::{
    extract_balanced_tag_blocks, get_attribute, parse_integer_attribute, parse_on_off_attribute,
    parse_underline_attribute,
};

pub fn parse_paragraph_drop_cap_from_xml(
    paragraph_properties_xml: &str,
) -> Option<ParagraphDropCap> {
    let frame_pr_tag =
        regex_tag(paragraph_properties_xml, r"(?i)<w:framePr\b[^>]*/?>").unwrap_or_default();
    if frame_pr_tag.is_empty() {
        return None;
    }
    let drop_cap_raw = get_attribute(&frame_pr_tag, "w:dropCap")
        .map(|v| v.trim().to_ascii_lowercase())?;
    let drop_cap_type = match drop_cap_raw.as_str() {
        "drop" => ParagraphDropCapType::Drop,
        "margin" => ParagraphDropCapType::Margin,
        _ => return None,
    };
    let lines = parse_integer_attribute(&frame_pr_tag, "w:lines");
    let wrap = get_attribute(&frame_pr_tag, "w:wrap").map(|v| v.trim().to_string());
    let horizontal_anchor =
        get_attribute(&frame_pr_tag, "w:hAnchor").map(|v| v.trim().to_string());
    let vertical_anchor =
        get_attribute(&frame_pr_tag, "w:vAnchor").map(|v| v.trim().to_string());
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

pub fn parse_paragraph_align_from_xml(xml: &str) -> Option<crate::model::ParagraphAlignment> {
    let alignment = regex_capture(xml, r#"(?i)<w:jc\b[^>]*w:val="([^"]+)""#);
    to_model_alignment(alignment.as_deref())
}

pub fn parse_text_style_from_xml(xml: &str, theme_fonts: &ThemeFontMap) -> Option<TextStyle> {
    if xml.is_empty() {
        return None;
    }

    let bold = parse_on_off_attribute(xml, "b");
    let italic = parse_on_off_attribute(xml, "i");
    let underline = parse_underline_attribute(xml);
    let strike = parse_on_off_attribute(xml, "strike");

    let color_match = regex_capture(xml, r#"(?i)<w:color\b[^>]*w:val="([^"]+)""#);
    let highlight_match = regex_capture(xml, r#"(?i)<w:highlight\b[^>]*w:val="([^"]+)""#);
    let shading_tag = regex_tag(xml, r"(?i)<w:shd\b[^>]*/?>");
    let character_spacing_match = regex_capture(xml, r#"(?i)<w:spacing\b[^>]*w:val="(-?\d+)""#);
    let size_match = regex_capture(xml, r#"(?i)<w:sz\b[^>]*w:val="(\d+)""#)
        .or_else(|| regex_capture(xml, r#"(?i)<w:szCs\b[^>]*w:val="(\d+)""#));
    let run_fonts_tag = regex_tag(xml, r"(?i)<w:rFonts\b[^>]*/?>").unwrap_or_default();
    let ascii_font = get_attribute(&run_fonts_tag, "w:ascii");
    let h_ansi_font = get_attribute(&run_fonts_tag, "w:hAnsi");
    let east_asia_font = get_attribute(&run_fonts_tag, "w:eastAsia");
    let complex_script_font = get_attribute(&run_fonts_tag, "w:cs");
    let ascii_theme_font = get_attribute(&run_fonts_tag, "w:asciiTheme");
    let h_ansi_theme_font = get_attribute(&run_fonts_tag, "w:hAnsiTheme");
    let east_asia_theme_font = get_attribute(&run_fonts_tag, "w:eastAsiaTheme");
    let complex_script_theme_font = get_attribute(&run_fonts_tag, "w:csTheme");
    let vertical_align_match = regex_capture(xml, r#"(?i)<w:vertAlign\b[^>]*w:val="([^"]+)""#);
    let drawing_bold_match = regex_capture(xml, r#"(?i)<a:rPr\b[^>]*\bb="([^"]+)""#);
    let drawing_italic_match = regex_capture(xml, r#"(?i)<a:rPr\b[^>]*\bi="([^"]+)""#);
    let drawing_underline_match = regex_capture(xml, r#"(?i)<a:rPr\b[^>]*\bu="([^"]+)""#);
    let drawing_strike_match =
        regex_capture(xml, r#"(?i)<a:rPr\b[^>]*\b(?:strike|s)="([^"]+)""#);
    let drawing_color_match = regex_capture(
        xml,
        r#"(?is)<a:rPr\b[\s\S]*?<a:(?:solidFill|srgbClr)\b[\s\S]*?<a:srgbClr\b[^>]*val="([^"]+)""#,
    );
    let drawing_size_match = regex_capture(xml, r#"(?i)<a:rPr\b[^>]*\bsz="(\d+)""#);
    let drawing_font_match = regex_capture(
        xml,
        r#"(?is)<a:rPr\b[\s\S]*?<a:latin\b[^>]*typeface="([^"]+)""#,
    );
    let drawing_default_font_match = regex_capture(
        xml,
        r#"(?is)<a:defRPr\b[\s\S]*?<a:latin\b[^>]*typeface="([^"]+)""#,
    );
    let drawing_any_latin_match = regex_capture(xml, r#"(?i)<a:latin\b[^>]*typeface="([^"]+)""#);
    let run_border_tag = regex_tag(xml, r"(?i)<w:bdr\b[^>]*/?>");

    let decoded_text_samples: String = re::get(r"(?is)<(?:w|a):t\b[^>]*>([\s\S]*?)</(?:w|a):t>")
        .map(|re| {
            re.captures_iter(xml)
                .filter_map(|caps| caps.get(1).map(|m| crate::xml::decode_xml_entities(m.as_str())))
                .collect()
        })
        .unwrap_or_default();

    let contains_east_asia_glyphs =
        re::get(r"[\u{2e80}-\u{9fff}\u{3040}-\u{30ff}\u{ac00}-\u{d7af}]").is_some_and(|re| re.is_match(&decoded_text_samples));
    let contains_complex_script_glyphs = re::get(r"[\u{0590}-\u{08ff}\u{fb1d}-\u{fefc}]").is_some_and(|re| re.is_match(&decoded_text_samples));

    let mut style = TextStyle {
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
            style.strike = Some(value != "nostrike" && value != "none" && value != "false" && value != "0");
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

    if let Some(spacing) = character_spacing_match.and_then(|v| v.parse::<i64>().ok()) {
        style.character_spacing_twips = Some(spacing);
        has_any = true;
    }

    if let Some(size) = size_match.and_then(|v| v.parse::<f64>().ok()) {
        style.font_size_pt = Some(size / 2.0);
        has_any = true;
    } else if let Some(size) = drawing_size_match.and_then(|v| v.parse::<f64>().ok()) {
        style.font_size_pt = Some(size / 100.0);
        has_any = true;
    }

    let run_font_family = ascii_font.or(h_ansi_font);
    let run_theme_font_token = ascii_theme_font.or(h_ansi_theme_font);
    let east_asia_fallback_font = if contains_east_asia_glyphs {
        east_asia_font.clone()
    } else {
        None
    };
    let east_asia_fallback_theme_token = if contains_east_asia_glyphs {
        east_asia_theme_font
    } else {
        None
    };
    let complex_script_fallback_font = if contains_complex_script_glyphs {
        complex_script_font.clone()
    } else {
        None
    };
    let complex_script_fallback_theme_token = if contains_complex_script_glyphs {
        complex_script_theme_font
    } else {
        None
    };
    let symbol_fallback_font = {
        let font = east_asia_font.clone().or(complex_script_font.clone());
        font.as_deref()
            .filter(|f| {
                re::get_unchecked(r"(?i)(symbol|emoji|dingbats?|wingdings|webdings)").is_match(f)
            })
            .map(|_| east_asia_font.or(complex_script_font))
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

pub fn parse_run_style(
    run_xml: &str,
    context: &ParseContext<'_>,
    paragraph_style_id: Option<&str>,
) -> Option<TextStyle> {
    let run_style_id = regex_capture(run_xml, r#"(?i)<w:rStyle\b[^>]*w:val="([^"]+)""#);
    let text_box_content = prefer_alternate_content_choice(run_xml);
    let text_box_run_xml = extract_balanced_tag_blocks(&text_box_content, "w:txbxContent")
        .into_iter()
        .next()
        .and_then(|txbx| extract_balanced_tag_blocks(&txbx, "w:r").into_iter().next());
    let direct = parse_text_style_from_xml(
        text_box_run_xml.as_deref().unwrap_or(run_xml),
        &context.style_sheet.theme_fonts,
    );
    let inherited_paragraph_run_style = paragraph_style_id
        .and_then(|id| context.style_sheet.paragraph_style_by_id.get(id))
        .and_then(|style| style.run_style.clone());
    let inherited_run_style = run_style_id
        .as_deref()
        .and_then(|id| context.style_sheet.run_style_by_id.get(id).cloned());
    merge_text_styles(&[
        context.style_sheet.default_run_style.clone(),
        inherited_paragraph_run_style,
        inherited_run_style,
        direct,
    ])
}

pub fn parse_paragraph_style(
    paragraph_xml: &str,
    context: &ParseContext<'_>,
) -> Option<ParagraphStyle> {
    parse_paragraph_style_in_table(paragraph_xml, context, None)
}

pub fn parse_paragraph_style_in_table(
    paragraph_xml: &str,
    context: &ParseContext<'_>,
    table_paragraph_spacing: Option<&ParagraphSpacing>,
) -> Option<ParagraphStyle> {
    let paragraph_properties_xml = extract_balanced_tag_blocks(paragraph_xml, "w:pPr")
        .into_iter()
        .next()
        .or_else(|| regex_tag(paragraph_xml, r"(?i)<w:pPr\b[^>]*/?>"))
        .unwrap_or_default();
    let alignment_match = regex_capture(
        &paragraph_properties_xml,
        r#"(?i)<w:jc\b[^>]*w:val="([^"]+)""#,
    );
    let p_style_match = regex_capture(
        &paragraph_properties_xml,
        r#"(?i)<w:pStyle\b[^>]*w:val="([^"]+)""#,
    );
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
    let has_direct_num_pr = re::get_unchecked(r"(?i)<w:numPr\b").is_match(&paragraph_properties_xml);

    let explicit_style_id = p_style_match;
    let style_id = explicit_style_id
        .clone()
        .or_else(|| context.style_sheet.default_paragraph_style_id.clone());
    let inherited = style_id
        .as_deref()
        .and_then(|id| context.style_sheet.paragraph_style_by_id.get(id));
    let default_paragraph_style = context.style_sheet.default_paragraph_style.as_ref();

    let align = to_model_alignment(alignment_match.as_deref())
        .or_else(|| inherited.and_then(|s| s.align))
        .or_else(|| default_paragraph_style.and_then(|s| s.align));
    let heading_level = normalize_heading_level(explicit_style_id.as_deref())
        .or_else(|| inherited.and_then(|s| s.heading_level))
        .or_else(|| default_paragraph_style.and_then(|s| s.heading_level));
    let numbering = if has_direct_num_pr {
        direct_numbering
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
            default_paragraph_style.and_then(|s| s.spacing.as_ref()),
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
        heading_level,
        style_id,
        style_name,
        numbering,
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
    re::get(pattern)?
        .captures(xml)
        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
}

fn regex_tag(xml: &str, pattern: &str) -> Option<String> {
    re::get(pattern)?
        .find(xml)
        .map(|m| m.as_str().to_string())
}
