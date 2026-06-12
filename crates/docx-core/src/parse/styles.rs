use std::collections::{HashMap, HashSet};

use crate::model::{
    HeadingLevel, ImageHorizontalAlign, ImageVerticalAlign, ParagraphAlignment,
    ParagraphBorderSet, ParagraphBorderStyle, ParagraphIndent, ParagraphLineRule,
    ParagraphNumbering, ParagraphSpacing, ParagraphStyle, ParagraphStyleDefinition,
    ParagraphTabStop, ParagraphTabStopAlignment, ParagraphTabStopLeader, TableBorderSet,
    TableBorderStyle, TableBoxSpacing, TableFloating, TableLayout, TextRunBorderStyle,
    TextStyle, VerticalAlign,
};
use crate::package::OoxmlPackage;
use super::colors::normalize_hex_color;
use crate::model::NumberingDefinitionSet;
use super::context::{
    empty_style_sheet, ParsedStyleSheet, ParsedTableLook, ParsedTableProperties,
    ParsedTableStyleCondition, ParsedTableStyleDefinition, TableConditionalStyleType,
    ThemeColorMap, ThemeFontMap,
};
use crate::xml::{
    decode_xml_entities, extract_balanced_tag_blocks, get_attribute, normalize_alignment,
    parse_integer_attribute, parse_on_off_attribute, parse_underline_attribute,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RawStyleType {
    Paragraph,
    Character,
    Numbering,
    Table,
}

struct RawStyleDefinition {
    id: String,
    style_type: RawStyleType,
    name: String,
    based_on_id: Option<String>,
    next_style_id: Option<String>,
    align: Option<ParagraphAlignment>,
    heading_level: Option<HeadingLevel>,
    numbering: Option<ParagraphNumbering>,
    spacing: Option<ParagraphSpacing>,
    indent: Option<ParagraphIndent>,
    background_color: Option<String>,
    borders: Option<ParagraphBorderSet>,
    tab_stops: Option<Vec<ParagraphTabStop>>,
    contextual_spacing: Option<bool>,
    keep_next: Option<bool>,
    keep_lines: Option<bool>,
    widow_control: Option<bool>,
    page_break_before: Option<bool>,
    run_style: Option<TextStyle>,
    ui_priority: Option<i64>,
    is_default: Option<bool>,
    is_primary: Option<bool>,
}

const DEFAULT_TABLE_LOOK: ParsedTableLook = ParsedTableLook {
    first_row: false,
    last_row: false,
    first_col: false,
    last_col: false,
    no_h_band: true,
    no_v_band: true,
    row_band_size: 1,
    col_band_size: 1,
};

fn map_alignment(value: Option<&str>) -> Option<ParagraphAlignment> {
    match normalize_alignment(value)? {
        "left" => Some(ParagraphAlignment::Left),
        "center" => Some(ParagraphAlignment::Center),
        "right" => Some(ParagraphAlignment::Right),
        "justify" => Some(ParagraphAlignment::Justify),
        _ => None,
    }
}

/// Mirrors TypeScript `normalizeHeadingLevel`.
pub fn normalize_heading_level(value: Option<&str>) -> Option<HeadingLevel> {
    let value = value?;
    let lower = value.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let needle = b"heading";
    let mut index = 0;

    while index + needle.len() <= bytes.len() {
        if bytes[index..index + needle.len()]
            .iter()
            .zip(needle.iter())
            .all(|(left, right)| left.eq_ignore_ascii_case(right))
        {
            let mut cursor = index + needle.len();
            while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
                cursor += 1;
            }
            if let Some(digit) = bytes
                .get(cursor)
                .and_then(|byte| (*byte as char).to_digit(10))
            {
                if (1..=6).contains(&digit) {
                    return match digit {
                        1 => Some(HeadingLevel::One),
                        2 => Some(HeadingLevel::Two),
                        3 => Some(HeadingLevel::Three),
                        4 => Some(HeadingLevel::Four),
                        5 => Some(HeadingLevel::Five),
                        6 => Some(HeadingLevel::Six),
                        _ => None,
                    };
                }
            }
        }
        index += 1;
    }

    None
}

/// Mirrors TypeScript `parseParagraphNumberingFromXml`.
pub fn parse_paragraph_numbering_from_xml(xml: &str) -> Option<ParagraphNumbering> {
    if xml.is_empty() {
        return None;
    }

    let numbering_xml = extract_balanced_tag_blocks(xml, "w:numPr")
        .into_iter()
        .next()
        .or_else(|| super::scan::find_tag_token(xml, "w:numPr"))
        .unwrap_or_default();
    if numbering_xml.is_empty() {
        return None;
    }

    let num_id_raw = find_namespaced_integer_attribute(&numbering_xml, "w:numId", "w:val");
    let num_id = num_id_raw?;
    if num_id <= 0 {
        return None;
    }

    let ilvl_raw = find_namespaced_integer_attribute(&numbering_xml, "w:ilvl", "w:val");
    let ilvl_value = ilvl_raw.unwrap_or(0);

    Some(ParagraphNumbering {
        num_id,
        ilvl: if ilvl_value >= 0 { ilvl_value } else { 0 },
    })
}

fn find_namespaced_integer_attribute(xml: &str, tag_name: &str, attribute: &str) -> Option<i64> {
    let tag = super::scan::find_tag_token(xml, tag_name)?;
    parse_integer_attribute(&tag, attribute)
}

/// Mirrors TypeScript `parseParagraphSpacingFromXml`.
pub fn parse_paragraph_spacing_from_xml(xml: &str) -> Option<ParagraphSpacing> {
    if xml.is_empty() {
        return None;
    }

    let spacing_tag = super::scan::find_tag_token(xml, "w:spacing")?;
    let line_rule_raw = get_attribute(&spacing_tag, "w:lineRule")
        .map(|value| value.to_ascii_lowercase());
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

/// Mirrors TypeScript `parseParagraphIndentFromXml`.
pub fn parse_paragraph_indent_from_xml(xml: &str) -> Option<ParagraphIndent> {
    if xml.is_empty() {
        return None;
    }

    let indent_tag = super::scan::find_tag_token(xml, "w:ind")?;
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

fn normalize_tab_stop_alignment(value: Option<&str>) -> Option<ParagraphTabStopAlignment> {
    match value?.to_ascii_lowercase().as_str() {
        "left" => Some(ParagraphTabStopAlignment::Left),
        "center" => Some(ParagraphTabStopAlignment::Center),
        "right" => Some(ParagraphTabStopAlignment::Right),
        "decimal" => Some(ParagraphTabStopAlignment::Decimal),
        "bar" => Some(ParagraphTabStopAlignment::Bar),
        _ => None,
    }
}

fn normalize_tab_stop_leader(value: Option<&str>) -> Option<ParagraphTabStopLeader> {
    match value?.to_ascii_lowercase().as_str() {
        "none" => Some(ParagraphTabStopLeader::LeaderNone),
        "dot" => Some(ParagraphTabStopLeader::Dot),
        "hyphen" => Some(ParagraphTabStopLeader::Hyphen),
        "underscore" => Some(ParagraphTabStopLeader::Underscore),
        "middledot" => Some(ParagraphTabStopLeader::MiddleDot),
        _ => None,
    }
}

/// Mirrors TypeScript `parseParagraphTabStopsFromXml`.
pub fn parse_paragraph_tab_stops_from_xml(xml: &str) -> Vec<ParagraphTabStop> {
    if xml.is_empty() {
        return Vec::new();
    }

    let tabs_xml = extract_balanced_tag_blocks(xml, "w:tabs")
        .into_iter()
        .next()
        .or_else(|| super::scan::find_tag_token(xml, "w:tabs"))
        .unwrap_or_default();
    if tabs_xml.is_empty() {
        return Vec::new();
    }

    let mut tab_stops = Vec::new();
    for tab_tag in super::scan::find_all_tag_tokens(&tabs_xml, "w:tab") {
        let alignment = normalize_tab_stop_alignment(get_attribute(&tab_tag, "w:val").as_deref());
        let leader = normalize_tab_stop_leader(get_attribute(&tab_tag, "w:leader").as_deref());
        let Some(position_twips) = parse_integer_attribute(&tab_tag, "w:pos") else {
            continue;
        };
        tab_stops.push(ParagraphTabStop {
            alignment: alignment.or(Some(ParagraphTabStopAlignment::Left)),
            leader: leader.or(Some(ParagraphTabStopLeader::LeaderNone)),
            position_twips: Some(position_twips),
        });
    }

    tab_stops.sort_by_key(|stop| stop.position_twips.unwrap_or(0));
    tab_stops
}

/// Mirrors TypeScript `parseParagraphShadingFromXml`.
pub fn parse_paragraph_shading_from_xml(xml: &str) -> Option<String> {
    if xml.is_empty() {
        return None;
    }
    let shading_tag = super::scan::find_tag_token(xml, "w:shd")?;
    normalize_hex_color(get_attribute(&shading_tag, "w:fill").as_deref())
}

fn parse_on_off_value(value: Option<&str>) -> Option<bool> {
    let value = value?;
    let normalized = value.trim().to_ascii_lowercase();
    Some(
        normalized != "0"
            && normalized != "false"
            && normalized != "none"
            && normalized != "off",
    )
}

/// Mirrors TypeScript `parseParagraphBorderStyle`.
pub fn parse_paragraph_border_style(tag_xml: Option<&str>) -> Option<ParagraphBorderStyle> {
    let tag_xml = tag_xml?;
    let border_type = get_attribute(tag_xml, "w:val")?.trim().to_ascii_lowercase();
    if border_type.is_empty() {
        return None;
    }

    let size_eighth_pt = parse_integer_attribute(tag_xml, "w:sz");
    let space_pt = parse_integer_attribute(tag_xml, "w:space");
    let raw_color = get_attribute(tag_xml, "w:color");
    let color = if raw_color
        .as_deref()
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("auto"))
    {
        Some("#000000".to_string())
    } else {
        normalize_hex_color(raw_color.as_deref())
    };

    Some(ParagraphBorderStyle {
        border_type,
        size_eighth_pt: size_eighth_pt.filter(|value| *value >= 0).map(|value| value as f64),
        space_pt: space_pt.filter(|value| *value >= 0).map(|value| value as f64),
        color,
        frame: parse_on_off_value(get_attribute(tag_xml, "w:frame").as_deref()),
        shadow: parse_on_off_value(get_attribute(tag_xml, "w:shadow").as_deref()),
    })
}

/// Mirrors TypeScript `parseTextRunBorderStyle`.
pub fn parse_text_run_border_style(tag_xml: Option<&str>) -> Option<TextRunBorderStyle> {
    let tag_xml = tag_xml?;
    let border_type = get_attribute(tag_xml, "w:val")?.trim().to_ascii_lowercase();
    if border_type.is_empty() {
        return None;
    }

    let size_eighth_pt = parse_integer_attribute(tag_xml, "w:sz");
    let space_pt = parse_integer_attribute(tag_xml, "w:space");
    let raw_color = get_attribute(tag_xml, "w:color");
    let color = if raw_color
        .as_deref()
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("auto"))
    {
        None
    } else {
        normalize_hex_color(raw_color.as_deref())
    };

    Some(TextRunBorderStyle {
        border_type,
        size_eighth_pt: size_eighth_pt.filter(|value| *value >= 0).map(|value| value as f64),
        space_pt: space_pt.filter(|value| *value >= 0).map(|value| value as f64),
        color,
        frame: parse_on_off_value(get_attribute(tag_xml, "w:frame").as_deref()),
        shadow: parse_on_off_value(get_attribute(tag_xml, "w:shadow").as_deref()),
    })
}

/// Mirrors TypeScript `parseParagraphBorderSetFromXml`.
pub fn parse_paragraph_border_set_from_xml(xml: &str) -> Option<ParagraphBorderSet> {
    if xml.is_empty() {
        return None;
    }

    let paragraph_border_xml = extract_balanced_tag_blocks(xml, "w:pBdr")
        .into_iter()
        .next()
        .or_else(|| super::scan::find_tag_token(xml, "w:pBdr"))
        .unwrap_or_default();
    if paragraph_border_xml.is_empty() {
        return None;
    }

    let top = parse_paragraph_border_style(
        super::scan::find_tag_token(&paragraph_border_xml, "w:top").as_deref(),
    );
    let right = parse_paragraph_border_style(
        super::scan::find_tag_token(&paragraph_border_xml, "w:right").as_deref(),
    );
    let bottom = parse_paragraph_border_style(
        super::scan::find_tag_token(&paragraph_border_xml, "w:bottom").as_deref(),
    );
    let left = parse_paragraph_border_style(
        super::scan::find_tag_token(&paragraph_border_xml, "w:left").as_deref(),
    );
    let between = parse_paragraph_border_style(
        super::scan::find_tag_token(&paragraph_border_xml, "w:between").as_deref(),
    );
    let bar = parse_paragraph_border_style(
        super::scan::find_tag_token(&paragraph_border_xml, "w:bar").as_deref(),
    );

    if top.is_none()
        && right.is_none()
        && bottom.is_none()
        && left.is_none()
        && between.is_none()
        && bar.is_none()
    {
        return None;
    }

    Some(ParagraphBorderSet {
        top,
        right,
        bottom,
        left,
        between,
        bar,
    })
}

/// Mirrors TypeScript `parseTableBoxSpacing`.
pub fn parse_table_box_spacing(xml: &str) -> Option<TableBoxSpacing> {
    let top_match = super::scan::find_tag_token(xml, "w:top");
    // Word writes the bidi-aware w:start/w:end instead of w:left/w:right in
    // newer documents; treat them as left/right (LTR rendering).
    let right_match = super::scan::find_tag_token(xml, "w:right")
        .or_else(|| super::scan::find_tag_token(xml, "w:end"));
    let bottom_match = super::scan::find_tag_token(xml, "w:bottom");
    let left_match = super::scan::find_tag_token(xml, "w:left")
        .or_else(|| super::scan::find_tag_token(xml, "w:start"));

    let spacing = TableBoxSpacing {
        top_twips: top_match
            .as_deref()
            .and_then(|tag| parse_integer_attribute(tag, "w:w")),
        right_twips: right_match
            .as_deref()
            .and_then(|tag| parse_integer_attribute(tag, "w:w")),
        bottom_twips: bottom_match
            .as_deref()
            .and_then(|tag| parse_integer_attribute(tag, "w:w")),
        left_twips: left_match
            .as_deref()
            .and_then(|tag| parse_integer_attribute(tag, "w:w")),
    };

    if spacing.top_twips.is_none()
        && spacing.right_twips.is_none()
        && spacing.bottom_twips.is_none()
        && spacing.left_twips.is_none()
    {
        return None;
    }

    Some(spacing)
}

/// Mirrors TypeScript `parseTableBorderStyle`.
pub fn parse_table_border_style(tag_xml: Option<&str>) -> Option<TableBorderStyle> {
    let tag_xml = tag_xml?;
    let border_type = get_attribute(tag_xml, "w:val")?.trim().to_ascii_lowercase();
    if border_type.is_empty() {
        return None;
    }

    let size_eighth_pt = parse_integer_attribute(tag_xml, "w:sz");
    let raw_color = get_attribute(tag_xml, "w:color");
    let color = if raw_color
        .as_deref()
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("auto"))
    {
        Some("#000000".to_string())
    } else {
        normalize_hex_color(raw_color.as_deref())
    };

    Some(TableBorderStyle {
        border_type,
        size_eighth_pt: size_eighth_pt.filter(|value| *value >= 0).map(|value| value as f64),
        color,
    })
}

/// Mirrors TypeScript `parseTableBorderSet`.
pub fn parse_table_border_set(xml: &str) -> Option<TableBorderSet> {
    let top = parse_table_border_style(super::scan::find_tag_token(xml, "w:top").as_deref());
    let right = parse_table_border_style(super::scan::find_tag_token(xml, "w:right").as_deref());
    let bottom =
        parse_table_border_style(super::scan::find_tag_token(xml, "w:bottom").as_deref());
    let left = parse_table_border_style(super::scan::find_tag_token(xml, "w:left").as_deref());
    let inside_h =
        parse_table_border_style(super::scan::find_tag_token(xml, "w:insideH").as_deref());
    let inside_v =
        parse_table_border_style(super::scan::find_tag_token(xml, "w:insideV").as_deref());
    let tl2br = parse_table_border_style(super::scan::find_tag_token(xml, "w:tl2br").as_deref());
    let tr2bl = parse_table_border_style(super::scan::find_tag_token(xml, "w:tr2bl").as_deref());

    if top.is_none()
        && right.is_none()
        && bottom.is_none()
        && left.is_none()
        && inside_h.is_none()
        && inside_v.is_none()
        && tl2br.is_none()
        && tr2bl.is_none()
    {
        return None;
    }

    Some(TableBorderSet {
        top,
        right,
        bottom,
        left,
        inside_h,
        inside_v,
        tl2br,
        tr2bl,
    })
}

fn has_table_properties(properties: &ParsedTableProperties) -> bool {
    properties.width_twips.is_some()
        || properties.indent_twips.is_some()
        || properties.layout.is_some()
        || properties.cell_spacing_twips.is_some()
        || properties.floating.is_some()
        || properties.cell_margin_twips.is_some()
}

/// Mirrors TypeScript `parseFloatingTableStyle`.
pub fn parse_floating_table_style(
    table_properties_xml: Option<&str>,
) -> Option<TableFloating> {
    let table_properties_xml = table_properties_xml?;
    let floating_tag = super::scan::find_tag_token(table_properties_xml, "w:tblpPr")?;

    let x_twips = parse_integer_attribute(&floating_tag, "w:tblpX");
    let y_twips = parse_integer_attribute(&floating_tag, "w:tblpY");
    let left_from_text_twips = parse_integer_attribute(&floating_tag, "w:leftFromText");
    let right_from_text_twips = parse_integer_attribute(&floating_tag, "w:rightFromText");
    let top_from_text_twips = parse_integer_attribute(&floating_tag, "w:topFromText");
    let bottom_from_text_twips = parse_integer_attribute(&floating_tag, "w:bottomFromText");
    let horizontal_anchor = get_attribute(&floating_tag, "w:horzAnchor");
    let vertical_anchor = get_attribute(&floating_tag, "w:vertAnchor");
    let horizontal_align_raw = get_attribute(&floating_tag, "w:tblpXSpec")
        .map(|value| value.trim().to_ascii_lowercase());
    let vertical_align_raw = get_attribute(&floating_tag, "w:tblpYSpec")
        .map(|value| value.trim().to_ascii_lowercase());

    let horizontal_align = match horizontal_align_raw.as_deref() {
        Some("left") => Some(ImageHorizontalAlign::Left),
        Some("center") => Some(ImageHorizontalAlign::Center),
        Some("right") => Some(ImageHorizontalAlign::Right),
        Some("inside") => Some(ImageHorizontalAlign::Inside),
        Some("outside") => Some(ImageHorizontalAlign::Outside),
        _ => None,
    };
    let vertical_align = match vertical_align_raw.as_deref() {
        Some("top") => Some(ImageVerticalAlign::Top),
        Some("center") => Some(ImageVerticalAlign::Center),
        Some("bottom") => Some(ImageVerticalAlign::Bottom),
        Some("inside") => Some(ImageVerticalAlign::Inside),
        Some("outside") => Some(ImageVerticalAlign::Outside),
        _ => None,
    };

    if x_twips.is_none()
        && y_twips.is_none()
        && left_from_text_twips.is_none()
        && right_from_text_twips.is_none()
        && top_from_text_twips.is_none()
        && bottom_from_text_twips.is_none()
        && horizontal_anchor.is_none()
        && vertical_anchor.is_none()
        && horizontal_align.is_none()
        && vertical_align.is_none()
    {
        return None;
    }

    Some(TableFloating {
        x_twips,
        y_twips,
        left_from_text_twips,
        right_from_text_twips,
        top_from_text_twips,
        bottom_from_text_twips,
        horizontal_anchor,
        vertical_anchor,
        horizontal_align,
        vertical_align,
    })
}

/// Mirrors TypeScript `parseTableStylePropertiesFromXml`.
pub fn parse_table_style_properties_from_xml(
    table_properties_xml: Option<&str>,
) -> Option<ParsedTableProperties> {
    let table_properties_xml = table_properties_xml?;

    let table_width_tag = super::scan::find_tag_token(table_properties_xml, "w:tblW");
    let table_width_type = table_width_tag
        .as_deref()
        .and_then(|tag| get_attribute(tag, "w:type"))
        .map(|value| value.to_ascii_lowercase());
    let table_width_raw = table_width_tag
        .as_deref()
        .and_then(|tag| parse_integer_attribute(tag, "w:w"));
    let width_twips = if table_width_type.as_deref() == Some("dxa")
        && table_width_raw.is_some_and(|value| value > 0)
    {
        table_width_raw
    } else {
        None
    };

    let table_indent_tag = super::scan::find_tag_token(table_properties_xml, "w:tblInd");
    let table_indent_type = table_indent_tag
        .as_deref()
        .and_then(|tag| get_attribute(tag, "w:type"))
        .map(|value| value.to_ascii_lowercase());
    let table_indent_raw = table_indent_tag
        .as_deref()
        .and_then(|tag| parse_integer_attribute(tag, "w:w"));
    let indent_twips = if table_indent_type.as_deref() == Some("dxa")
        && table_indent_raw.is_some_and(|value| value != 0)
    {
        table_indent_raw
    } else {
        None
    };

    let table_layout_tag = super::scan::find_tag_token(table_properties_xml, "w:tblLayout");
    let table_layout_raw = table_layout_tag
        .as_deref()
        .and_then(|tag| get_attribute(tag, "w:type"))
        .map(|value| value.to_ascii_lowercase());
    let layout = match table_layout_raw.as_deref() {
        Some("fixed") => Some(TableLayout::Fixed),
        Some("autofit") => Some(TableLayout::Autofit),
        _ => None,
    };

    let table_cell_spacing_tag =
        super::scan::find_tag_token(table_properties_xml, "w:tblCellSpacing");
    let table_cell_spacing_type = table_cell_spacing_tag
        .as_deref()
        .and_then(|tag| get_attribute(tag, "w:type"))
        .map(|value| value.to_ascii_lowercase());
    let table_cell_spacing_raw = table_cell_spacing_tag
        .as_deref()
        .and_then(|tag| parse_integer_attribute(tag, "w:w"));
    let cell_spacing_twips = if table_cell_spacing_type.as_deref() == Some("dxa")
        && table_cell_spacing_raw.is_some_and(|value| value >= 0)
    {
        table_cell_spacing_raw
    } else {
        None
    };

    let table_cell_margin_xml = extract_balanced_tag_blocks(table_properties_xml, "w:tblCellMar")
        .into_iter()
        .next()
        .or_else(|| super::scan::find_tag_token(table_properties_xml, "w:tblCellMar"));
    let cell_margin_twips = table_cell_margin_xml
        .as_deref()
        .and_then(parse_table_box_spacing);
    let floating = parse_floating_table_style(Some(table_properties_xml));

    let properties = ParsedTableProperties {
        width_twips,
        indent_twips,
        layout,
        cell_spacing_twips,
        cell_margin_twips,
        floating,
    };

    if has_table_properties(&properties) {
        Some(properties)
    } else {
        None
    }
}

fn merge_table_style_properties(
    inherited: Option<&ParsedTableProperties>,
    direct: Option<&ParsedTableProperties>,
) -> Option<ParsedTableProperties> {
    if inherited.is_none() && direct.is_none() {
        return None;
    }

    let merged = ParsedTableProperties {
        width_twips: direct
            .and_then(|value| value.width_twips)
            .or_else(|| inherited.and_then(|value| value.width_twips)),
        indent_twips: direct
            .and_then(|value| value.indent_twips)
            .or_else(|| inherited.and_then(|value| value.indent_twips)),
        layout: direct
            .and_then(|value| value.layout)
            .or_else(|| inherited.and_then(|value| value.layout)),
        cell_spacing_twips: direct
            .and_then(|value| value.cell_spacing_twips)
            .or_else(|| inherited.and_then(|value| value.cell_spacing_twips)),
        floating: direct
            .and_then(|value| value.floating.clone())
            .or_else(|| inherited.and_then(|value| value.floating.clone())),
        cell_margin_twips: direct
            .and_then(|value| value.cell_margin_twips.clone())
            .or_else(|| inherited.and_then(|value| value.cell_margin_twips.clone())),
    };

    if has_table_properties(&merged) {
        Some(merged)
    } else {
        None
    }
}

fn merge_table_look(
    direct: Option<&ParsedTableLook>,
    inherited: Option<&ParsedTableLook>,
) -> ParsedTableLook {
    let mut merged = DEFAULT_TABLE_LOOK;
    if let Some(inherited) = inherited {
        merged = inherited.clone();
    }
    if let Some(direct) = direct {
        merged = direct.clone();
    }
    merged
}

fn normalize_table_conditional_style_type(value: Option<&str>) -> Option<TableConditionalStyleType> {
    match value?.trim().to_ascii_lowercase().as_str() {
        "wholtable" | "wholetable" => Some(TableConditionalStyleType::WholeTable),
        "firstrow" => Some(TableConditionalStyleType::FirstRow),
        "lastrow" => Some(TableConditionalStyleType::LastRow),
        "firstcol" => Some(TableConditionalStyleType::FirstCol),
        "lastcol" => Some(TableConditionalStyleType::LastCol),
        "band1horz" => Some(TableConditionalStyleType::Band1Horz),
        "band2horz" => Some(TableConditionalStyleType::Band2Horz),
        "band1vert" => Some(TableConditionalStyleType::Band1Vert),
        "band2vert" => Some(TableConditionalStyleType::Band2Vert),
        "nwcell" => Some(TableConditionalStyleType::NwCell),
        "necell" => Some(TableConditionalStyleType::NeCell),
        "swcell" => Some(TableConditionalStyleType::SwCell),
        "secell" => Some(TableConditionalStyleType::SeCell),
        _ => None,
    }
}

fn merge_table_border_sets(
    inherited: Option<&TableBorderSet>,
    direct: Option<&TableBorderSet>,
) -> Option<TableBorderSet> {
    if inherited.is_none() && direct.is_none() {
        return None;
    }

    let merged = TableBorderSet {
        top: direct
            .and_then(|value| value.top.clone())
            .or_else(|| inherited.and_then(|value| value.top.clone())),
        right: direct
            .and_then(|value| value.right.clone())
            .or_else(|| inherited.and_then(|value| value.right.clone())),
        bottom: direct
            .and_then(|value| value.bottom.clone())
            .or_else(|| inherited.and_then(|value| value.bottom.clone())),
        left: direct
            .and_then(|value| value.left.clone())
            .or_else(|| inherited.and_then(|value| value.left.clone())),
        inside_h: direct
            .and_then(|value| value.inside_h.clone())
            .or_else(|| inherited.and_then(|value| value.inside_h.clone())),
        inside_v: direct
            .and_then(|value| value.inside_v.clone())
            .or_else(|| inherited.and_then(|value| value.inside_v.clone())),
        tl2br: direct
            .and_then(|value| value.tl2br.clone())
            .or_else(|| inherited.and_then(|value| value.tl2br.clone())),
        tr2bl: direct
            .and_then(|value| value.tr2bl.clone())
            .or_else(|| inherited.and_then(|value| value.tr2bl.clone())),
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

/// Mirrors TypeScript `parseTableLook`.
pub fn parse_table_look(table_properties_xml: Option<&str>) -> Option<ParsedTableLook> {
    let table_properties_xml = table_properties_xml?;
    let table_look_tag = super::scan::find_tag_token(table_properties_xml, "w:tblLook")?;
    let look_mask_raw = get_attribute(&table_look_tag, "w:val");
    let look_mask = look_mask_raw
        .as_deref()
        .and_then(|raw| i64::from_str_radix(raw, 16).ok());

    let row_band_size_tag = super::scan::find_tag_token(table_properties_xml, "w:tblStyleRowBandSize")
        .or_else(|| {
            extract_balanced_tag_blocks(table_properties_xml, "w:tblStyleRowBandSize")
                .into_iter()
                .next()
        });
    let col_band_size_tag = super::scan::find_tag_token(table_properties_xml, "w:tblStyleColBandSize")
        .or_else(|| {
            extract_balanced_tag_blocks(table_properties_xml, "w:tblStyleColBandSize")
                .into_iter()
                .next()
        });
    let row_band_size_raw = row_band_size_tag
        .as_deref()
        .and_then(|tag| parse_integer_attribute(tag, "w:val"))
        .unwrap_or(1);
    let col_band_size_raw = col_band_size_tag
        .as_deref()
        .and_then(|tag| parse_integer_attribute(tag, "w:val"))
        .unwrap_or(1);

    let resolve_on_off_attribute = |attribute: &str| -> Option<bool> {
        let value = get_attribute(&table_look_tag, attribute)?.to_ascii_lowercase();
        match value.as_str() {
            "1" | "true" | "on" => Some(true),
            "0" | "false" | "off" => Some(false),
            _ => None,
        }
    };

    let has_look_mask = look_mask.is_some();
    let mask_value = look_mask.unwrap_or(0);

    Some(ParsedTableLook {
        first_row: resolve_on_off_attribute("w:firstRow")
            .unwrap_or((mask_value & 0x0020) != 0),
        last_row: resolve_on_off_attribute("w:lastRow")
            .unwrap_or((mask_value & 0x0040) != 0),
        first_col: resolve_on_off_attribute("w:firstColumn")
            .unwrap_or((mask_value & 0x0080) != 0),
        last_col: resolve_on_off_attribute("w:lastColumn")
            .unwrap_or((mask_value & 0x0100) != 0),
        no_h_band: resolve_on_off_attribute("w:noHBand")
            .unwrap_or((mask_value & 0x0200) != 0),
        no_v_band: resolve_on_off_attribute("w:noVBand")
            .unwrap_or((mask_value & 0x0400) != 0),
        row_band_size: row_band_size_raw.max(1),
        col_band_size: col_band_size_raw.max(1),
    })
}

/// Mirrors TypeScript `parseTableConditionalStyleFromXml`.
pub fn parse_table_conditional_style_from_xml(
    xml: &str,
    theme_fonts: &ThemeFontMap,
) -> Option<ParsedTableStyleCondition> {
    if xml.is_empty() {
        return None;
    }

    let table_properties_xml = extract_balanced_tag_blocks(xml, "w:tblPr")
        .into_iter()
        .next()
        .unwrap_or_default();
    let paragraph_properties_xml = extract_balanced_tag_blocks(xml, "w:pPr")
        .into_iter()
        .next()
        .unwrap_or_default();
    let row_properties_xml = extract_balanced_tag_blocks(xml, "w:trPr")
        .into_iter()
        .next()
        .unwrap_or_default();
    let cell_properties_xml = extract_balanced_tag_blocks(xml, "w:tcPr")
        .into_iter()
        .next()
        .unwrap_or_default();
    let run_properties_xml = resolve_style_properties_block(xml, "w:rPr");
    let table_look = parse_table_look(Some(&table_properties_xml));
    let paragraph_align = map_alignment(
        super::scan::find_attribute_value_in_tag(&paragraph_properties_xml, "w:jc", "w:val")
            .as_deref(),
    );

    let row_shading_tag = super::scan::find_tag_token(&row_properties_xml, "w:shd");
    let cell_shading_tag = super::scan::find_tag_token(&cell_properties_xml, "w:shd")
        .or_else(|| super::scan::find_tag_token(&table_properties_xml, "w:shd"));
    let row_background_color = row_shading_tag
        .as_deref()
        .and_then(|tag| get_attribute(tag, "w:fill"))
        .as_deref()
        .and_then(|value| normalize_hex_color(Some(value)));
    let cell_background_color = cell_shading_tag
        .as_deref()
        .and_then(|tag| get_attribute(tag, "w:fill"))
        .as_deref()
        .and_then(|value| normalize_hex_color(Some(value)));
    let run_style = parse_text_style_from_xml(&run_properties_xml, theme_fonts);

    let table_borders_xml = extract_balanced_tag_blocks(&table_properties_xml, "w:tblBorders")
        .into_iter()
        .next()
        .or_else(|| super::scan::find_tag_token(&table_properties_xml, "w:tblBorders"));
    let cell_borders_xml = extract_balanced_tag_blocks(&cell_properties_xml, "w:tcBorders")
        .into_iter()
        .next()
        .or_else(|| super::scan::find_tag_token(&cell_properties_xml, "w:tcBorders"));
    let table_borders = table_borders_xml
        .as_deref()
        .and_then(parse_table_border_set);
    let cell_borders = cell_borders_xml.as_deref().and_then(parse_table_border_set);
    let table_properties = parse_table_style_properties_from_xml(Some(&table_properties_xml));

    if row_background_color.is_none()
        && cell_background_color.is_none()
        && paragraph_align.is_none()
        && run_style.is_none()
        && table_borders.is_none()
        && cell_borders.is_none()
        && table_properties.is_none()
        && table_look.is_none()
    {
        return None;
    }

    Some(ParsedTableStyleCondition {
        row_background_color,
        cell_background_color,
        paragraph_align,
        run_style,
        table_borders,
        cell_borders,
        table_properties,
        table_look,
    })
}

fn merge_table_conditional_style(
    inherited: Option<&ParsedTableStyleCondition>,
    direct: Option<&ParsedTableStyleCondition>,
) -> Option<ParsedTableStyleCondition> {
    if inherited.is_none() && direct.is_none() {
        return None;
    }

    let merged = ParsedTableStyleCondition {
        row_background_color: direct
            .and_then(|value| value.row_background_color.clone())
            .or_else(|| inherited.and_then(|value| value.row_background_color.clone())),
        cell_background_color: direct
            .and_then(|value| value.cell_background_color.clone())
            .or_else(|| inherited.and_then(|value| value.cell_background_color.clone())),
        paragraph_align: direct
            .and_then(|value| value.paragraph_align)
            .or_else(|| inherited.and_then(|value| value.paragraph_align)),
        run_style: merge_text_styles(
            inherited.and_then(|value| value.run_style.clone()),
            direct.and_then(|value| value.run_style.clone()),
        ),
        table_borders: merge_table_border_sets(
            inherited.and_then(|value| value.table_borders.as_ref()),
            direct.and_then(|value| value.table_borders.as_ref()),
        ),
        cell_borders: merge_table_border_sets(
            inherited.and_then(|value| value.cell_borders.as_ref()),
            direct.and_then(|value| value.cell_borders.as_ref()),
        ),
        table_properties: merge_table_style_properties(
            inherited.and_then(|value| value.table_properties.as_ref()),
            direct.and_then(|value| value.table_properties.as_ref()),
        ),
        table_look: Some(merge_table_look(
            direct.and_then(|value| value.table_look.as_ref()),
            inherited.and_then(|value| value.table_look.as_ref()),
        )),
    };

    if merged.row_background_color.is_none()
        && merged.cell_background_color.is_none()
        && merged.paragraph_align.is_none()
        && merged.run_style.is_none()
        && merged.table_borders.is_none()
        && merged.cell_borders.is_none()
        && merged.table_properties.is_none()
        && merged.table_look.is_none()
    {
        return None;
    }

    Some(merged)
}

/// Mirrors TypeScript `mergeTextStyles`.
pub fn merge_text_styles(
    inherited: Option<TextStyle>,
    direct: Option<TextStyle>,
) -> Option<TextStyle> {
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

    for style in [inherited, direct].into_iter().flatten() {
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
        if style.run_border.is_some() {
            merged.run_border = style.run_border.clone();
        }
    }

    let has_any = merged.bold.is_some()
        || merged.italic.is_some()
        || merged.underline.is_some()
        || merged.strike.is_some()
        || merged.color.is_some()
        || merged.highlight.is_some()
        || merged.background_color.is_some()
        || merged.font_size_pt.is_some()
        || merged.font_family.is_some()
        || merged.character_spacing_twips.is_some()
        || merged.vertical_align.is_some()
        || merged.run_border.is_some();

    if has_any { Some(merged) } else { None }
}

fn merge_paragraph_spacing(
    inherited: Option<&ParagraphSpacing>,
    direct: Option<&ParagraphSpacing>,
) -> Option<ParagraphSpacing> {
    if inherited.is_none() && direct.is_none() {
        return None;
    }

    let merged = ParagraphSpacing {
        before_twips: direct
            .and_then(|value| value.before_twips)
            .or_else(|| inherited.and_then(|value| value.before_twips)),
        after_twips: direct
            .and_then(|value| value.after_twips)
            .or_else(|| inherited.and_then(|value| value.after_twips)),
        line_twips: direct
            .and_then(|value| value.line_twips)
            .or_else(|| inherited.and_then(|value| value.line_twips)),
        line_rule: direct
            .and_then(|value| value.line_rule)
            .or_else(|| inherited.and_then(|value| value.line_rule)),
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

fn merge_paragraph_indent(
    inherited: Option<&ParagraphIndent>,
    direct: Option<&ParagraphIndent>,
) -> Option<ParagraphIndent> {
    if inherited.is_none() && direct.is_none() {
        return None;
    }

    let merged = ParagraphIndent {
        left_twips: direct
            .and_then(|value| value.left_twips)
            .or_else(|| inherited.and_then(|value| value.left_twips)),
        right_twips: direct
            .and_then(|value| value.right_twips)
            .or_else(|| inherited.and_then(|value| value.right_twips)),
        first_line_twips: direct
            .and_then(|value| value.first_line_twips)
            .or_else(|| inherited.and_then(|value| value.first_line_twips)),
        hanging_twips: direct
            .and_then(|value| value.hanging_twips)
            .or_else(|| inherited.and_then(|value| value.hanging_twips)),
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

fn merge_paragraph_background_color(
    inherited: Option<&str>,
    direct: Option<&str>,
) -> Option<String> {
    direct
        .map(str::to_string)
        .or_else(|| inherited.map(str::to_string))
}

fn merge_paragraph_border_style(
    inherited: Option<&ParagraphBorderStyle>,
    direct: Option<&ParagraphBorderStyle>,
) -> Option<ParagraphBorderStyle> {
    if inherited.is_none() && direct.is_none() {
        return None;
    }

    let border_type = direct
        .map(|value| value.border_type.clone())
        .or_else(|| inherited.map(|value| value.border_type.clone()))?;
    if border_type.is_empty() {
        return None;
    }

    Some(ParagraphBorderStyle {
        border_type,
        color: direct
            .and_then(|value| value.color.clone())
            .or_else(|| inherited.and_then(|value| value.color.clone())),
        size_eighth_pt: direct
            .and_then(|value| value.size_eighth_pt)
            .or_else(|| inherited.and_then(|value| value.size_eighth_pt)),
        space_pt: direct
            .and_then(|value| value.space_pt)
            .or_else(|| inherited.and_then(|value| value.space_pt)),
        frame: direct
            .and_then(|value| value.frame)
            .or_else(|| inherited.and_then(|value| value.frame)),
        shadow: direct
            .and_then(|value| value.shadow)
            .or_else(|| inherited.and_then(|value| value.shadow)),
    })
}

fn merge_paragraph_border_sets(
    inherited: Option<&ParagraphBorderSet>,
    direct: Option<&ParagraphBorderSet>,
) -> Option<ParagraphBorderSet> {
    if inherited.is_none() && direct.is_none() {
        return None;
    }

    let merged = ParagraphBorderSet {
        top: merge_paragraph_border_style(
            inherited.and_then(|value| value.top.as_ref()),
            direct.and_then(|value| value.top.as_ref()),
        ),
        right: merge_paragraph_border_style(
            inherited.and_then(|value| value.right.as_ref()),
            direct.and_then(|value| value.right.as_ref()),
        ),
        bottom: merge_paragraph_border_style(
            inherited.and_then(|value| value.bottom.as_ref()),
            direct.and_then(|value| value.bottom.as_ref()),
        ),
        left: merge_paragraph_border_style(
            inherited.and_then(|value| value.left.as_ref()),
            direct.and_then(|value| value.left.as_ref()),
        ),
        between: merge_paragraph_border_style(
            inherited.and_then(|value| value.between.as_ref()),
            direct.and_then(|value| value.between.as_ref()),
        ),
        bar: merge_paragraph_border_style(
            inherited.and_then(|value| value.bar.as_ref()),
            direct.and_then(|value| value.bar.as_ref()),
        ),
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

fn merge_paragraph_tab_stops(
    inherited: Option<&[ParagraphTabStop]>,
    direct: Option<&[ParagraphTabStop]>,
) -> Option<Vec<ParagraphTabStop>> {
    if inherited.is_none() && direct.is_none() {
        return None;
    }

    let mut by_position = HashMap::new();
    for stop in inherited.unwrap_or(&[]) {
        if let Some(position) = stop.position_twips {
            by_position.insert(position, stop.clone());
        }
    }
    for stop in direct.unwrap_or(&[]) {
        if let Some(position) = stop.position_twips {
            by_position.insert(position, stop.clone());
        }
    }

    if by_position.is_empty() {
        return None;
    }

    let mut combined: Vec<ParagraphTabStop> = by_position.into_values().collect();
    combined.sort_by_key(|stop| stop.position_twips.unwrap_or(0));
    Some(combined)
}

fn merge_paragraph_boolean(inherited: Option<bool>, direct: Option<bool>) -> Option<bool> {
    if direct.is_some() {
        direct
    } else {
        inherited
    }
}

fn resolve_theme_font(theme_token: Option<&str>, theme_fonts: &ThemeFontMap) -> Option<String> {
    let normalized = theme_token?.to_ascii_lowercase();
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

fn find_drawing_rpr_attribute(xml: &str, attribute: &str) -> Option<String> {
    let tag = super::scan::find_tag_token(xml, "a:rPr")?;
    get_attribute(&tag, attribute)
}

fn find_drawing_latin_typeface(xml: &str) -> Option<String> {
    if let Some(block) = extract_balanced_tag_blocks(xml, "a:rPr").into_iter().next() {
        if let Some(latin) = extract_balanced_tag_blocks(&block, "a:latin")
            .into_iter()
            .next()
            .or_else(|| super::scan::find_tag_token(&block, "a:latin"))
        {
            if let Some(typeface) = get_attribute(&latin, "typeface") {
                return Some(typeface);
            }
        }
    }

    if let Some(block) = extract_balanced_tag_blocks(xml, "a:defRPr").into_iter().next() {
        if let Some(latin) = extract_balanced_tag_blocks(&block, "a:latin")
            .into_iter()
            .next()
            .or_else(|| super::scan::find_tag_token(&block, "a:latin"))
        {
            if let Some(typeface) = get_attribute(&latin, "typeface") {
                return Some(typeface);
            }
        }
    }

    super::scan::find_tag_token(xml, "a:latin")
        .and_then(|latin| get_attribute(&latin, "typeface"))
}

fn find_drawing_color(xml: &str) -> Option<String> {
    if let Some(block) = extract_balanced_tag_blocks(xml, "a:rPr").into_iter().next() {
        if let Some(color_xml) = extract_balanced_tag_blocks(&block, "a:solidFill")
            .into_iter()
            .next()
            .or_else(|| super::scan::find_tag_token(&block, "a:solidFill"))
        {
            if let Some(srgb) = super::scan::find_tag_token(&color_xml, "a:srgbClr") {
                if let Some(color) = get_attribute(&srgb, "val").as_deref().and_then(|value| normalize_hex_color(Some(value))) {
                    return Some(color);
                }
            }
        }
        if let Some(srgb) = super::scan::find_tag_token(&block, "a:srgbClr") {
            if let Some(color) = get_attribute(&srgb, "val").as_deref().and_then(|value| normalize_hex_color(Some(value))) {
                return Some(color);
            }
        }
    }
    None
}

fn contains_east_asia_glyphs(text: &str) -> bool {
    text.chars().any(|ch| {
        matches!(ch,
            '\u{2e80}'..='\u{9fff}'
                | '\u{3040}'..='\u{30ff}'
                | '\u{ac00}'..='\u{d7af}'
        )
    })
}

fn contains_complex_script_glyphs(text: &str) -> bool {
    text.chars().any(|ch| {
        matches!(ch,
            '\u{0590}'..='\u{08ff}'
                | '\u{fb1d}'..='\u{fefc}'
        )
    })
}

fn collect_decoded_text_samples(xml: &str) -> String {
    let mut samples = String::new();
    for tag_name in ["w:t", "a:t"] {
        for block in extract_balanced_tag_blocks(xml, tag_name) {
            if let Some(start) = block.find('>') {
                let end = block.rfind("</").unwrap_or(block.len());
                if start + 1 < end {
                    samples.push_str(&decode_xml_entities(&block[start + 1..end]));
                }
            }
        }
    }
    samples
}

/// Mirrors TypeScript `parseTextStyleFromXml`.
pub fn parse_text_style_from_xml(xml: &str, theme_fonts: &ThemeFontMap) -> Option<TextStyle> {
    if xml.is_empty() {
        return None;
    }

    let bold = parse_on_off_attribute(xml, "b");
    let italic = parse_on_off_attribute(xml, "i");
    let underline = parse_underline_attribute(xml);
    let strike = parse_on_off_attribute(xml, "strike");

    let color_match = super::scan::find_attribute_value_in_tag(xml, "w:color", "w:val");
    let highlight_match = super::scan::find_attribute_value_in_tag(xml, "w:highlight", "w:val");
    let shading_tag = super::scan::find_tag_token(xml, "w:shd");
    let character_spacing_match =
        super::scan::find_attribute_value_in_tag(xml, "w:spacing", "w:val");
    let size_match = super::scan::find_attribute_value_in_tag(xml, "w:sz", "w:val")
        .or_else(|| super::scan::find_attribute_value_in_tag(xml, "w:szCs", "w:val"));
    let run_fonts_tag = super::scan::find_tag_token(xml, "w:rFonts").unwrap_or_default();
    let ascii_font = get_attribute(&run_fonts_tag, "w:ascii");
    let h_ansi_font = get_attribute(&run_fonts_tag, "w:hAnsi");
    let east_asia_font = get_attribute(&run_fonts_tag, "w:eastAsia");
    let complex_script_font = get_attribute(&run_fonts_tag, "w:cs");
    let ascii_theme_font = get_attribute(&run_fonts_tag, "w:asciiTheme");
    let h_ansi_theme_font = get_attribute(&run_fonts_tag, "w:hAnsiTheme");
    let east_asia_theme_font = get_attribute(&run_fonts_tag, "w:eastAsiaTheme");
    let complex_script_theme_font = get_attribute(&run_fonts_tag, "w:csTheme");
    let vertical_align_match =
        super::scan::find_attribute_value_in_tag(xml, "w:vertAlign", "w:val");
    let drawing_bold_match = find_drawing_rpr_attribute(xml, "b");
    let drawing_italic_match = find_drawing_rpr_attribute(xml, "i");
    let drawing_underline_match = find_drawing_rpr_attribute(xml, "u");
    let drawing_strike_match = find_drawing_rpr_attribute(xml, "strike")
        .or_else(|| find_drawing_rpr_attribute(xml, "s"));
    let drawing_color_match = find_drawing_color(xml);
    let drawing_size_match = find_drawing_rpr_attribute(xml, "sz");
    let drawing_font_match = find_drawing_latin_typeface(xml);
    let run_border_tag = super::scan::find_tag_token(xml, "w:bdr");
    let decoded_text_samples = collect_decoded_text_samples(xml);
    let contains_east_asia = contains_east_asia_glyphs(&decoded_text_samples);
    let contains_complex_script = contains_complex_script_glyphs(&decoded_text_samples);

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

    style.bold = bold;
    style.italic = italic;
    style.underline = underline;
    style.strike = strike;

    if style.bold.is_none() {
        if let Some(value) = drawing_bold_match {
            let value = value.to_ascii_lowercase();
            style.bold = Some(value != "0" && value != "false");
        }
    }
    if style.italic.is_none() {
        if let Some(value) = drawing_italic_match {
            let value = value.to_ascii_lowercase();
            style.italic = Some(value != "0" && value != "false");
        }
    }
    if style.underline.is_none() {
        if let Some(value) = drawing_underline_match {
            let value = value.to_ascii_lowercase();
            style.underline = Some(value != "none" && value != "false" && value != "0");
        }
    }
    if style.strike.is_none() {
        if let Some(value) = drawing_strike_match {
            let value = value.to_ascii_lowercase();
            style.strike = Some(
                value != "nostrike" && value != "none" && value != "false" && value != "0",
            );
        }
    }

    if let Some(color) = normalize_hex_color(color_match.as_deref()) {
        style.color = Some(color);
    } else if let Some(color) = drawing_color_match {
        style.color = Some(color);
    }

    if let Some(highlight) = highlight_match {
        style.highlight = Some(highlight);
    }

    if let Some(shading_tag) = shading_tag {
        if let Some(shading_fill) =
            normalize_hex_color(get_attribute(&shading_tag, "w:fill").as_deref())
        {
            style.background_color = Some(shading_fill);
        }
    }

    if let Some(character_spacing) = character_spacing_match.and_then(|raw| raw.parse::<i64>().ok())
    {
        style.character_spacing_twips = Some(character_spacing);
    }

    if let Some(size_raw) = size_match.and_then(|raw| raw.parse::<f64>().ok()) {
        style.font_size_pt = Some(size_raw / 2.0);
    } else if let Some(size_raw) = drawing_size_match.and_then(|raw| raw.parse::<f64>().ok()) {
        style.font_size_pt = Some(size_raw / 100.0);
    }

    let run_font_family = ascii_font.or(h_ansi_font);
    let run_theme_font_token = ascii_theme_font.or(h_ansi_theme_font);
    let east_asia_fallback_font = if contains_east_asia {
        east_asia_font.clone()
    } else {
        None
    };
    let east_asia_fallback_theme_token = if contains_east_asia {
        east_asia_theme_font
    } else {
        None
    };
    let complex_script_fallback_font = if contains_complex_script {
        complex_script_font.clone()
    } else {
        None
    };
    let complex_script_fallback_theme_token = if contains_complex_script {
        complex_script_theme_font
    } else {
        None
    };
    let symbol_fallback_font = {
        let candidate = east_asia_font.or(complex_script_font);
        candidate.filter(|font| {
            let lower = font.to_ascii_lowercase();
            lower.contains("symbol")
                || lower.contains("emoji")
                || lower.contains("dingbat")
                || lower.contains("wingding")
                || lower.contains("webding")
        })
    };

    if let Some(font_family) = run_font_family {
        style.font_family = Some(font_family);
    } else if let Some(theme_token) = run_theme_font_token.as_deref() {
        if let Some(font_family) = resolve_theme_font(Some(theme_token), theme_fonts) {
            style.font_family = Some(font_family);
        }
    } else if let Some(font_family) = east_asia_fallback_font {
        style.font_family = Some(font_family);
    } else if let Some(theme_token) = east_asia_fallback_theme_token.as_deref() {
        if let Some(font_family) = resolve_theme_font(Some(theme_token), theme_fonts) {
            style.font_family = Some(font_family);
        }
    } else if let Some(font_family) = complex_script_fallback_font {
        style.font_family = Some(font_family);
    } else if let Some(theme_token) = complex_script_fallback_theme_token.as_deref() {
        if let Some(font_family) = resolve_theme_font(Some(theme_token), theme_fonts) {
            style.font_family = Some(font_family);
        }
    } else if let Some(font_family) = symbol_fallback_font {
        style.font_family = Some(font_family);
    } else if let Some(font_family) = drawing_font_match {
        style.font_family = Some(font_family);
    }

    if let Some(vertical_align_value) = vertical_align_match.map(|value| value.to_ascii_lowercase())
    {
        style.vertical_align = match vertical_align_value.as_str() {
            "superscript" => Some(VerticalAlign::Superscript),
            "subscript" => Some(VerticalAlign::Subscript),
            _ => None,
        };
    }

    style.run_border = parse_text_run_border_style(run_border_tag.as_deref());

    merge_text_styles(None, Some(style))
}

/// Mirrors TypeScript `parseParagraphAlignFromXml`.
pub fn parse_paragraph_align_from_xml(xml: &str) -> Option<ParagraphAlignment> {
    map_alignment(
        super::scan::find_attribute_value_in_tag(xml, "w:jc", "w:val")
            .as_deref(),
    )
}

fn parse_heading_level_from_outline(xml: &str) -> Option<HeadingLevel> {
    let outline_value = super::scan::find_attribute_value_in_tag(xml, "w:outlineLvl", "w:val")?;
    let level = outline_value.parse::<i64>().ok()? + 1;
    match level {
        1 => Some(HeadingLevel::One),
        2 => Some(HeadingLevel::Two),
        3 => Some(HeadingLevel::Three),
        4 => Some(HeadingLevel::Four),
        5 => Some(HeadingLevel::Five),
        6 => Some(HeadingLevel::Six),
        _ => None,
    }
}

fn parse_style_type(value: Option<&str>) -> Option<RawStyleType> {
    match value?.to_ascii_lowercase().as_str() {
        "paragraph" => Some(RawStyleType::Paragraph),
        "character" => Some(RawStyleType::Character),
        "numbering" => Some(RawStyleType::Numbering),
        "table" => Some(RawStyleType::Table),
        _ => None,
    }
}

fn resolve_style_properties_block(style_xml: &str, tag_name: &str) -> String {
    extract_balanced_tag_blocks(style_xml, tag_name)
        .into_iter()
        .next()
        .or_else(|| super::scan::find_tag_token(style_xml, tag_name))
        .unwrap_or_default()
}

fn strip_table_conditional_style_blocks(style_xml: &str) -> String {
    if style_xml.is_empty() {
        return style_xml.to_string();
    }

    let mut output = style_xml.to_string();
    loop {
        let before_len = output.len();
        output = remove_balanced_tag_blocks(&output, "w:tblStylePr");
        output = remove_self_closing_tags(&output, "w:tblStylePr");
        if output.len() == before_len {
            break;
        }
    }
    output
}

fn remove_balanced_tag_blocks(xml: &str, tag_name: &str) -> String {
    let mut output = String::new();
    let mut last_index = 0;
    for range in extract_balanced_tag_ranges(xml, tag_name) {
        output.push_str(&xml[last_index..range.start]);
        last_index = range.end;
    }
    output.push_str(&xml[last_index..]);
    output
}

fn remove_self_closing_tags(xml: &str, tag_name: &str) -> String {
    let mut output = String::new();
    let mut last_index = 0;
    let open_prefix = format!("<{tag_name}");
    let mut index = 0;
    while index < xml.len() {
        if xml.as_bytes().get(index) != Some(&b'<')
            || !super::scan::starts_with_ignore_ascii_case(&xml[index..], &open_prefix)
        {
            index += 1;
            continue;
        }

        let after_prefix = index + open_prefix.len();
        let mut cursor = after_prefix;
        let bytes = xml.as_bytes();
        while cursor < bytes.len() {
            if bytes[cursor] == b'>' {
                let token = &xml[index..=cursor];
                if token.ends_with("/>") || token.ends_with("/ >") {
                    output.push_str(&xml[last_index..index]);
                    last_index = cursor + 1;
                }
                index = cursor + 1;
                break;
            }
            cursor += 1;
        }
        if cursor >= bytes.len() {
            break;
        }
    }
    output.push_str(&xml[last_index..]);
    output
}

fn extract_balanced_tag_ranges(xml: &str, tag_name: &str) -> Vec<crate::xml::TagRange> {
    crate::xml::extract_balanced_tag_ranges(xml, tag_name)
}

fn read_typeface(xml: &str, tag_name: &str) -> Option<String> {
    let token = super::scan::find_tag_token(xml, &format!("a:{tag_name}"))?;
    let value = get_attribute(&token, "typeface")?.trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

/// Mirrors TypeScript `parseThemeFonts`.
pub fn parse_theme_fonts(pkg: &OoxmlPackage) -> ThemeFontMap {
    let Some(theme_xml) = pkg
        .parts
        .get("word/theme/theme1.xml")
        .map(|part| part.content.as_str())
    else {
        return ThemeFontMap::default();
    };

    let major_font_xml = extract_balanced_tag_blocks(theme_xml, "a:majorFont")
        .into_iter()
        .next()
        .unwrap_or_default();
    let minor_font_xml = extract_balanced_tag_blocks(theme_xml, "a:minorFont")
        .into_iter()
        .next()
        .unwrap_or_default();

    ThemeFontMap {
        major_latin: read_typeface(&major_font_xml, "latin"),
        major_east_asia: read_typeface(&major_font_xml, "ea"),
        major_complex_script: read_typeface(&major_font_xml, "cs"),
        minor_latin: read_typeface(&minor_font_xml, "latin"),
        minor_east_asia: read_typeface(&minor_font_xml, "ea"),
        minor_complex_script: read_typeface(&minor_font_xml, "cs"),
    }
}

fn parse_theme_color_from_tag(color_xml: &str) -> Option<String> {
    if let Some(explicit) = super::scan::find_attribute_value_in_tag(color_xml, "a:srgbClr", "w:val")
        .as_deref()
        .and_then(|value| normalize_hex_color(Some(value)))
    {
        return Some(explicit);
    }

    super::scan::find_attribute_value_in_tag(color_xml, "a:sysClr", "lastClr")
        .as_deref()
        .and_then(|value| normalize_hex_color(Some(value)))
}

/// Mirrors TypeScript `parseThemeColors`.
pub fn parse_theme_colors(pkg: &OoxmlPackage) -> ThemeColorMap {
    let Some(theme_xml) = pkg
        .parts
        .get("word/theme/theme1.xml")
        .map(|part| part.content.as_str())
    else {
        return ThemeColorMap::new();
    };

    let color_scheme_xml = extract_balanced_tag_blocks(theme_xml, "a:clrScheme")
        .into_iter()
        .next()
        .unwrap_or_default();
    if color_scheme_xml.is_empty() {
        return ThemeColorMap::new();
    }

    let color_names = [
        "dk1",
        "lt1",
        "dk2",
        "lt2",
        "accent1",
        "accent2",
        "accent3",
        "accent4",
        "accent5",
        "accent6",
        "hlink",
        "folHlink",
        "bg1",
        "bg2",
        "tx1",
        "tx2",
        "followedHyperlink",
    ];

    let mut colors = ThemeColorMap::new();
    for name in color_names {
        let tag_match = extract_balanced_tag_blocks(&color_scheme_xml, &format!("a:{name}"))
            .into_iter()
            .next()
            .or_else(|| super::scan::find_tag_token(&color_scheme_xml, &format!("a:{name}")));
        let Some(tag_match) = tag_match else {
            continue;
        };
        if let Some(color) = parse_theme_color_from_tag(&tag_match) {
            colors.insert(name.to_ascii_lowercase(), color);
        }
    }

    colors
}

/// Mirrors TypeScript `parseStyleSheet`.
pub fn parse_style_sheet(pkg: &OoxmlPackage) -> ParsedStyleSheet {
    let Some(styles_xml) = pkg.parts.get("word/styles.xml").map(|part| part.content.as_str()) else {
        return empty_style_sheet();
    };

    let theme_fonts = parse_theme_fonts(pkg);
    let theme_colors = parse_theme_colors(pkg);
    let doc_defaults_xml = extract_balanced_tag_blocks(styles_xml, "w:docDefaults")
        .into_iter()
        .next()
        .unwrap_or_default();

    let default_paragraph_style = {
        let paragraph_defaults = resolve_style_properties_block(&doc_defaults_xml, "w:pPr");
        let default_paragraph_has_num_pr = super::scan::contains_tag(&paragraph_defaults, "w:numPr");
        let align = parse_paragraph_align_from_xml(&paragraph_defaults);
        let spacing = parse_paragraph_spacing_from_xml(&paragraph_defaults);
        let indent = parse_paragraph_indent_from_xml(&paragraph_defaults);
        let background_color = parse_paragraph_shading_from_xml(&paragraph_defaults);
        let borders = parse_paragraph_border_set_from_xml(&paragraph_defaults);
        let tab_stops = parse_paragraph_tab_stops_from_xml(&paragraph_defaults);
        let parsed_default_numbering = parse_paragraph_numbering_from_xml(&paragraph_defaults);
        let numbering = if default_paragraph_has_num_pr && parsed_default_numbering.is_none() {
            Some(ParagraphNumbering { num_id: 0, ilvl: 0 })
        } else {
            parsed_default_numbering
        };
        let contextual_spacing = parse_on_off_attribute(&paragraph_defaults, "contextualSpacing");
        let keep_next = parse_on_off_attribute(&paragraph_defaults, "keepNext");
        let keep_lines = parse_on_off_attribute(&paragraph_defaults, "keepLines");
        let widow_control = parse_on_off_attribute(&paragraph_defaults, "widowControl");
        let page_break_before = parse_on_off_attribute(&paragraph_defaults, "pageBreakBefore");

        if align.is_none()
            && spacing.is_none()
            && indent.is_none()
            && background_color.is_none()
            && borders.is_none()
            && tab_stops.is_empty()
            && numbering.is_none()
            && contextual_spacing.is_none()
            && keep_next.is_none()
            && keep_lines.is_none()
            && widow_control.is_none()
            && page_break_before.is_none()
        {
            None
        } else {
            Some(ParagraphStyle {
                align,
                heading_level: None,
                style_id: None,
                style_name: None,
                numbering,
                spacing,
                indent,
                background_color,
                borders,
                tab_stops: if tab_stops.is_empty() {
                    None
                } else {
                    Some(tab_stops)
                },
                contextual_spacing,
                keep_next,
                keep_lines,
                widow_control,
                page_break_before,
                drop_cap: None,
            })
        }
    };

    let default_run_style =
        parse_text_style_from_xml(&resolve_style_properties_block(&doc_defaults_xml, "w:rPr"), &theme_fonts);

    let mut raw_styles_by_id = HashMap::new();
    let mut raw_table_styles_by_id = HashMap::new();

    for style_xml in extract_balanced_tag_blocks(styles_xml, "w:style") {
        let style_tag = super::scan::find_tag_token(&style_xml, "w:style").unwrap_or_default();
        let style_id = get_attribute(&style_tag, "w:styleId");
        let style_type = parse_style_type(get_attribute(&style_tag, "w:type").as_deref());
        let (Some(style_id), Some(style_type)) = (style_id, style_type) else {
            continue;
        };

        let name_tag = super::scan::find_tag_token(&style_xml, "w:name").unwrap_or_default();
        let based_on_tag = super::scan::find_tag_token(&style_xml, "w:basedOn").unwrap_or_default();
        let next_tag = super::scan::find_tag_token(&style_xml, "w:next").unwrap_or_default();
        let ui_priority_tag =
            super::scan::find_tag_token(&style_xml, "w:uiPriority").unwrap_or_default();
        let paragraph_properties_xml = resolve_style_properties_block(&style_xml, "w:pPr");
        let style_has_paragraph_num_pr =
            super::scan::contains_tag(&paragraph_properties_xml, "w:numPr");
        let run_properties_xml = resolve_style_properties_block(&style_xml, "w:rPr");

        let heading_level = normalize_heading_level(Some(&style_id))
            .or_else(|| {
                normalize_heading_level(get_attribute(&name_tag, "w:val").as_deref())
            })
            .or_else(|| parse_heading_level_from_outline(&paragraph_properties_xml));

        let parsed_style_numbering = parse_paragraph_numbering_from_xml(&paragraph_properties_xml);
        let tab_stops = parse_paragraph_tab_stops_from_xml(&paragraph_properties_xml);

        raw_styles_by_id.insert(
            style_id.clone(),
            RawStyleDefinition {
                id: style_id.clone(),
                style_type,
                name: get_attribute(&name_tag, "w:val").unwrap_or(style_id.clone()),
                based_on_id: get_attribute(&based_on_tag, "w:val"),
                next_style_id: get_attribute(&next_tag, "w:val"),
                align: parse_paragraph_align_from_xml(&paragraph_properties_xml),
                heading_level,
                numbering: if style_has_paragraph_num_pr && parsed_style_numbering.is_none() {
                    Some(ParagraphNumbering { num_id: 0, ilvl: 0 })
                } else {
                    parsed_style_numbering
                },
                spacing: parse_paragraph_spacing_from_xml(&paragraph_properties_xml),
                indent: parse_paragraph_indent_from_xml(&paragraph_properties_xml),
                background_color: parse_paragraph_shading_from_xml(&paragraph_properties_xml),
                borders: parse_paragraph_border_set_from_xml(&paragraph_properties_xml),
                tab_stops: if tab_stops.is_empty() {
                    None
                } else {
                    Some(tab_stops)
                },
                contextual_spacing: parse_on_off_attribute(
                    &paragraph_properties_xml,
                    "contextualSpacing",
                ),
                keep_next: parse_on_off_attribute(&paragraph_properties_xml, "keepNext"),
                keep_lines: parse_on_off_attribute(&paragraph_properties_xml, "keepLines"),
                widow_control: parse_on_off_attribute(&paragraph_properties_xml, "widowControl"),
                page_break_before: parse_on_off_attribute(
                    &paragraph_properties_xml,
                    "pageBreakBefore",
                ),
                run_style: parse_text_style_from_xml(&run_properties_xml, &theme_fonts),
                ui_priority: get_attribute(&ui_priority_tag, "w:val")
                    .and_then(|raw| raw.parse::<f64>().ok())
                    .filter(|value| value.is_finite())
                    .map(|value| value.round() as i64),
                is_default: get_attribute(&style_tag, "w:default")
                    .is_some_and(|value| value == "1")
                    .then_some(true),
                is_primary: super::scan::contains_tag(&style_xml, "w:qFormat").then_some(true),
            },
        );

        if style_type == RawStyleType::Table {
            let mut conditions = HashMap::new();
            let whole_table_source_xml = strip_table_conditional_style_blocks(&style_xml);
            if let Some(whole_table_condition) =
                parse_table_conditional_style_from_xml(&whole_table_source_xml, &theme_fonts)
            {
                conditions.insert(TableConditionalStyleType::WholeTable, whole_table_condition);
            }

            for conditional_style_xml in extract_balanced_tag_blocks(&style_xml, "w:tblStylePr") {
                let conditional_style_tag =
                    super::scan::find_tag_token(&conditional_style_xml, "w:tblStylePr")
                        .unwrap_or_default();
                let Some(conditional_type) = normalize_table_conditional_style_type(
                    get_attribute(&conditional_style_tag, "w:type").as_deref(),
                ) else {
                    continue;
                };
                if let Some(condition) =
                    parse_table_conditional_style_from_xml(&conditional_style_xml, &theme_fonts)
                {
                    conditions.insert(conditional_type, condition);
                }
            }

            raw_table_styles_by_id.insert(
                style_id.clone(),
                ParsedTableStyleDefinition {
                    id: style_id.clone(),
                    based_on_id: get_attribute(&based_on_tag, "w:val"),
                    name: get_attribute(&name_tag, "w:val").unwrap_or(style_id),
                    conditions,
                    floating: None,
                    properties: None,
                },
            );
        }
    }

    let mut run_style_cache = HashMap::new();
    fn resolve_run_style(
        style_id: &str,
        raw_styles_by_id: &HashMap<String, RawStyleDefinition>,
        run_style_cache: &mut HashMap<String, Option<TextStyle>>,
        stack: &mut HashSet<String>,
    ) -> Option<TextStyle> {
        if let Some(cached) = run_style_cache.get(style_id) {
            return cached.to_owned();
        }
        if stack.contains(style_id) {
            return None;
        }
        stack.insert(style_id.to_string());

        let style = raw_styles_by_id.get(style_id)?;
        let inherited = style
            .based_on_id
            .as_deref()
            .and_then(|based_on_id| {
                resolve_run_style(based_on_id, raw_styles_by_id, run_style_cache, stack)
            });
        let resolved = merge_text_styles(inherited, style.run_style.clone());
        run_style_cache.insert(style_id.to_string(), resolved.clone());
        stack.remove(style_id);
        resolved
    }

    let mut paragraph_style_cache = HashMap::new();
    fn resolve_paragraph_style(
        style_id: &str,
        raw_styles_by_id: &HashMap<String, RawStyleDefinition>,
        paragraph_style_cache: &mut HashMap<String, Option<ParagraphStyleDefinition>>,
        stack: &mut HashSet<String>,
    ) -> Option<ParagraphStyleDefinition> {
        if let Some(cached) = paragraph_style_cache.get(style_id) {
            return cached.to_owned();
        }
        if stack.contains(style_id) {
            return None;
        }
        stack.insert(style_id.to_string());

        let style = raw_styles_by_id.get(style_id)?;
        if style.style_type != RawStyleType::Paragraph {
            paragraph_style_cache.insert(style_id.to_string(), None);
            stack.remove(style_id);
            return None;
        }

        let inherited = style.based_on_id.as_deref().and_then(|based_on_id| {
            raw_styles_by_id
                .get(based_on_id)
                .filter(|parent| parent.style_type == RawStyleType::Paragraph)
                .and_then(|_| {
                    resolve_paragraph_style(
                        based_on_id,
                        raw_styles_by_id,
                        paragraph_style_cache,
                        stack,
                    )
                })
        });

        let resolved = ParagraphStyleDefinition {
            id: style.id.clone(),
            name: style.name.clone(),
            based_on_id: style.based_on_id.clone(),
            next_style_id: style.next_style_id.clone(),
            align: style.align.or(inherited.as_ref().and_then(|value| value.align)),
            heading_level: style
                .heading_level
                .or(inherited.as_ref().and_then(|value| value.heading_level)),
            numbering: style
                .numbering
                .clone()
                .or_else(|| inherited.as_ref().and_then(|value| value.numbering.clone())),
            spacing: merge_paragraph_spacing(
                inherited.as_ref().and_then(|value| value.spacing.as_ref()),
                style.spacing.as_ref(),
            ),
            indent: merge_paragraph_indent(
                inherited.as_ref().and_then(|value| value.indent.as_ref()),
                style.indent.as_ref(),
            ),
            background_color: merge_paragraph_background_color(
                inherited.as_ref().and_then(|value| value.background_color.as_deref()),
                style.background_color.as_deref(),
            ),
            borders: merge_paragraph_border_sets(
                inherited.as_ref().and_then(|value| value.borders.as_ref()),
                style.borders.as_ref(),
            ),
            tab_stops: merge_paragraph_tab_stops(
                inherited.as_ref().and_then(|value| value.tab_stops.as_deref()),
                style.tab_stops.as_deref(),
            ),
            contextual_spacing: merge_paragraph_boolean(
                inherited
                    .as_ref()
                    .and_then(|value| value.contextual_spacing),
                style.contextual_spacing,
            ),
            keep_next: merge_paragraph_boolean(
                inherited.as_ref().and_then(|value| value.keep_next),
                style.keep_next,
            ),
            keep_lines: merge_paragraph_boolean(
                inherited.as_ref().and_then(|value| value.keep_lines),
                style.keep_lines,
            ),
            widow_control: merge_paragraph_boolean(
                inherited.as_ref().and_then(|value| value.widow_control),
                style.widow_control,
            ),
            page_break_before: merge_paragraph_boolean(
                inherited.as_ref().and_then(|value| value.page_break_before),
                style.page_break_before,
            ),
            run_style: merge_text_styles(
                inherited.as_ref().and_then(|value| value.run_style.clone()),
                style.run_style.clone(),
            ),
            ui_priority: style
                .ui_priority
                .or_else(|| inherited.as_ref().and_then(|value| value.ui_priority)),
            is_default: style.is_default,
            is_primary: style.is_primary,
        };

        paragraph_style_cache.insert(style_id.to_string(), Some(resolved.clone()));
        stack.remove(style_id);
        Some(resolved)
    }

    let mut paragraph_styles: Vec<ParagraphStyleDefinition> = raw_styles_by_id
        .values()
        .filter(|style| style.style_type == RawStyleType::Paragraph)
        .filter_map(|style| {
            let mut stack = HashSet::new();
            resolve_paragraph_style(
                &style.id,
                &raw_styles_by_id,
                &mut paragraph_style_cache,
                &mut stack,
            )
        })
        .collect();

    paragraph_styles.sort_by(|left, right| {
        let left_priority = left.ui_priority.unwrap_or(9999);
        let right_priority = right.ui_priority.unwrap_or(9999);
        if left_priority != right_priority {
            left_priority.cmp(&right_priority)
        } else {
            left.name.cmp(&right.name)
        }
    });

    let paragraph_style_by_id = paragraph_styles
        .iter()
        .map(|style| (style.id.clone(), style.clone()))
        .collect::<HashMap<_, _>>();

    let mut run_style_by_id = HashMap::new();
    for style_id in raw_styles_by_id.keys() {
        let mut stack = HashSet::new();
        if let Some(resolved) = resolve_run_style(
            style_id,
            &raw_styles_by_id,
            &mut run_style_cache,
            &mut stack,
        ) {
            run_style_by_id.insert(style_id.clone(), resolved);
        }
    }

    let mut table_style_cache = HashMap::new();
    fn resolve_table_style(
        style_id: &str,
        raw_table_styles_by_id: &HashMap<String, ParsedTableStyleDefinition>,
        table_style_cache: &mut HashMap<String, Option<ParsedTableStyleDefinition>>,
        stack: &mut HashSet<String>,
    ) -> Option<ParsedTableStyleDefinition> {
        if let Some(cached) = table_style_cache.get(style_id) {
            return cached.to_owned();
        }
        if stack.contains(style_id) {
            return None;
        }
        stack.insert(style_id.to_string());

        let style = raw_table_styles_by_id.get(style_id)?;
        let inherited = style.based_on_id.as_deref().and_then(|based_on_id| {
            resolve_table_style(
                based_on_id,
                raw_table_styles_by_id,
                table_style_cache,
                stack,
            )
        });

        let mut conditions = HashMap::new();
        for conditional_type in TableConditionalStyleType::ALL {
            if let Some(merged_condition) = merge_table_conditional_style(
                inherited
                    .as_ref()
                    .and_then(|value| value.conditions.get(&conditional_type)),
                style.conditions.get(&conditional_type),
            ) {
                conditions.insert(conditional_type, merged_condition);
            }
        }

        let resolved = ParsedTableStyleDefinition {
            id: style.id.clone(),
            based_on_id: style.based_on_id.clone(),
            name: style.name.clone(),
            conditions,
            floating: style.floating.clone(),
            properties: style.properties.clone(),
        };

        table_style_cache.insert(style_id.to_string(), Some(resolved.clone()));
        stack.remove(style_id);
        Some(resolved)
    }

    let mut table_style_by_id = HashMap::new();
    for style_id in raw_table_styles_by_id.keys() {
        let mut stack = HashSet::new();
        if let Some(resolved) = resolve_table_style(
            style_id,
            &raw_table_styles_by_id,
            &mut table_style_cache,
            &mut stack,
        ) {
            table_style_by_id.insert(style_id.clone(), resolved);
        }
    }

    let default_paragraph_style_id = paragraph_styles
        .iter()
        .find(|style| style.is_default == Some(true))
        .map(|style| style.id.clone())
        .or_else(|| {
            if paragraph_style_by_id.contains_key("Normal") {
                Some("Normal".to_string())
            } else {
                None
            }
        });

    let resolved_default_paragraph_style = default_paragraph_style_id
        .as_ref()
        .and_then(|style_id| paragraph_style_by_id.get(style_id).cloned());

    let merged_default_paragraph_style = resolved_default_paragraph_style.as_ref().map(|resolved| {
        ParagraphStyle {
            align: resolved.align.or(default_paragraph_style.as_ref().and_then(|value| value.align)),
            heading_level: resolved.heading_level,
            style_id: default_paragraph_style_id.clone(),
            style_name: Some(resolved.name.clone()),
            numbering: resolved
                .numbering
                .clone()
                .or_else(|| default_paragraph_style.as_ref().and_then(|value| value.numbering.clone())),
            spacing: merge_paragraph_spacing(
                default_paragraph_style.as_ref().and_then(|value| value.spacing.as_ref()),
                resolved.spacing.as_ref(),
            ),
            indent: merge_paragraph_indent(
                default_paragraph_style.as_ref().and_then(|value| value.indent.as_ref()),
                resolved.indent.as_ref(),
            ),
            background_color: merge_paragraph_background_color(
                default_paragraph_style
                    .as_ref()
                    .and_then(|value| value.background_color.as_deref()),
                resolved.background_color.as_deref(),
            ),
            borders: merge_paragraph_border_sets(
                default_paragraph_style.as_ref().and_then(|value| value.borders.as_ref()),
                resolved.borders.as_ref(),
            ),
            tab_stops: merge_paragraph_tab_stops(
                default_paragraph_style
                    .as_ref()
                    .and_then(|value| value.tab_stops.as_deref()),
                resolved.tab_stops.as_deref(),
            ),
            contextual_spacing: merge_paragraph_boolean(
                default_paragraph_style
                    .as_ref()
                    .and_then(|value| value.contextual_spacing),
                resolved.contextual_spacing,
            ),
            keep_next: merge_paragraph_boolean(
                default_paragraph_style.as_ref().and_then(|value| value.keep_next),
                resolved.keep_next,
            ),
            keep_lines: merge_paragraph_boolean(
                default_paragraph_style.as_ref().and_then(|value| value.keep_lines),
                resolved.keep_lines,
            ),
            widow_control: merge_paragraph_boolean(
                default_paragraph_style
                    .as_ref()
                    .and_then(|value| value.widow_control),
                resolved.widow_control,
            ),
            page_break_before: merge_paragraph_boolean(
                default_paragraph_style
                    .as_ref()
                    .and_then(|value| value.page_break_before),
                resolved.page_break_before,
            ),
            drop_cap: None,
        }
    });

    let mut table_paragraph_spacing_by_style_id = HashMap::new();
    for (style_id, style) in raw_styles_by_id
        .iter()
        .filter(|(_, style)| style.style_type == RawStyleType::Table)
    {
        let mut chain = Vec::new();
        let mut cursor = Some(style_id.clone());
        let mut seen = HashSet::new();
        while let Some(id) = cursor {
            if !seen.insert(id.clone()) {
                break;
            }
            let Some(chain_style) = raw_styles_by_id.get(&id) else {
                break;
            };
            if chain_style.style_type != RawStyleType::Table {
                break;
            }
            chain.push(chain_style);
            cursor = chain_style.based_on_id.clone();
        }
        let mut merged_spacing: Option<crate::model::ParagraphSpacing> = None;
        for chain_style in chain.iter().rev() {
            merged_spacing = crate::parse::util::merge_paragraph_spacing(
                merged_spacing.as_ref(),
                chain_style.spacing.as_ref(),
            );
        }
        if let Some(spacing) = merged_spacing {
            table_paragraph_spacing_by_style_id.insert(style_id.clone(), spacing);
        }
    }

    ParsedStyleSheet {
        paragraph_styles,
        paragraph_style_by_id,
        run_style_by_id,
        table_style_by_id,
        table_paragraph_spacing_by_style_id,
        default_paragraph_style: merged_default_paragraph_style,
        default_paragraph_style_id,
        default_run_style: merge_text_styles(
            default_run_style,
            resolved_default_paragraph_style.and_then(|value| value.run_style),
        ),
        theme_colors,
        theme_fonts,
    }
}

pub fn clone_paragraph_style_definition(style: &ParagraphStyleDefinition) -> ParagraphStyleDefinition {
    style.clone()
}

pub fn clone_numbering_definitions(definitions: &NumberingDefinitionSet) -> NumberingDefinitionSet {
    definitions.clone()
}

#[cfg(test)]
mod table_box_spacing_tests {
    use super::parse_table_box_spacing;

    #[test]
    fn parses_start_end_aliases() {
        let xml = r#"<w:tcMar><w:start w:w="0" w:type="dxa"/><w:end w:w="0" w:type="dxa"/></w:tcMar>"#;
        let spacing = parse_table_box_spacing(xml).expect("spacing");
        assert_eq!(spacing.left_twips, Some(0));
        assert_eq!(spacing.right_twips, Some(0));
        assert_eq!(spacing.top_twips, None);
        assert_eq!(spacing.bottom_twips, None);
    }
}
