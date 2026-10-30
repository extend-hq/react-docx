use std::collections::HashMap;

use crate::model::{
    ParagraphAlignment, TableBorderSet, TableBoxSpacing, TableCellContentNode, TableCellNode,
    TableCellNodeType, TableCellStyle, TableCellVerticalAlign, TableLayout, TableNode,
    TableNodeType, TableRowGeometrySource, TableRowHeightRule, TableRowNode, TableRowNodeType,
    TableRowStyle, TableStyle, TableWidthSource, TextStyle,
};
use crate::parse::context::{
    default_table_look, ParsedTableLook, ParsedTableStyleCondition, ParsedTableStyleDefinition,
    TableConditionalStyleType,
};
use crate::parse::paragraph::parse_paragraph_with_table_run_style;
use crate::parse::re;
use crate::parse::styles::{
    direct_table_property, merge_table_style_properties, parse_table_box_spacing,
    parse_table_preferred_width, parse_table_style_properties_from_xml, preferred_width_twips,
};
use crate::parse::util::{
    merge_table_border_sets, merge_text_styles, normalize_hex_color, parse_table_border_set,
};
use crate::xml::{
    extract_balanced_tag_blocks, extract_balanced_tag_blocks_in_order, get_attribute,
    parse_integer_attribute, parse_on_off_attribute,
};

pub fn parse_table_cell_content(
    cell_xml: &str,
    context: &crate::parse::context::ParseContext<'_>,
    table_paragraph_spacing: Option<&crate::model::ParagraphSpacing>,
) -> Vec<TableCellContentNode> {
    parse_table_cell_content_with_run_style(cell_xml, context, table_paragraph_spacing, None)
}

fn parse_table_cell_content_with_run_style(
    cell_xml: &str,
    context: &crate::parse::context::ParseContext<'_>,
    table_paragraph_spacing: Option<&crate::model::ParagraphSpacing>,
    table_run_style: Option<&TextStyle>,
) -> Vec<TableCellContentNode> {
    let block_ranges = extract_balanced_tag_blocks_in_order(cell_xml, &["w:p", "w:tbl"]);
    let parsed: Vec<TableCellContentNode> = block_ranges
        .iter()
        .filter_map(|block| {
            let block_xml = &cell_xml[block.start..block.end];
            if block_xml.starts_with("<w:p") || block_xml.starts_with("<W:p") {
                return Some(TableCellContentNode::Paragraph(
                    parse_paragraph_with_table_run_style(
                        block_xml,
                        context,
                        table_paragraph_spacing,
                        table_run_style,
                    ),
                ));
            }
            if block_xml.starts_with("<w:tbl") || block_xml.starts_with("<W:tbl") {
                return Some(TableCellContentNode::Table(Box::new(parse_table(
                    block_xml, context,
                ))));
            }
            None
        })
        .collect();
    if !parsed.is_empty() {
        return parsed;
    }
    vec![TableCellContentNode::Paragraph(
        parse_paragraph_with_table_run_style(
            "<w:p><w:r><w:t/></w:r></w:p>",
            context,
            table_paragraph_spacing,
            table_run_style,
        ),
    )]
}

#[derive(Clone, Debug)]
pub struct ParsedTableCellResult {
    pub cell: TableCellNode,
    pub v_merge: Option<String>,
}

pub fn parse_table_cell(
    cell_xml: &str,
    context: &crate::parse::context::ParseContext<'_>,
    table_paragraph_spacing: Option<&crate::model::ParagraphSpacing>,
) -> ParsedTableCellResult {
    let mut result = parse_table_cell_geometry(cell_xml);
    result.cell.nodes = parse_table_cell_content(cell_xml, context, table_paragraph_spacing);
    result
}

#[derive(Default)]
struct CellPropertyTokens<'a> {
    values: [Option<&'a str>; 9],
    margins: [Option<&'a str>; 6],
    borders: [Option<&'a str>; 8],
}

fn indexed_cell_property_tokens(xml: &str) -> Option<CellPropertyTokens<'_>> {
    let mut tokens = CellPropertyTokens::default();
    let mut container = None;
    let complete = crate::xml_index::for_each_element(xml, |element| {
        if element.source_start == 0 {
            return element.name == "w:tcPr";
        }
        let leaf = element.content().is_none_or(|text| text.trim().is_empty());
        if let Some((kind, end)) = container {
            if element.source_start < end {
                if !leaf {
                    return false;
                }
                let edge = match element.name {
                    "w:top" => 0,
                    "w:right" => 1,
                    "w:bottom" => 2,
                    "w:left" => 3,
                    "w:start" if kind == 3 => 4,
                    "w:end" if kind == 3 => 5,
                    "w:insideH" if kind == 4 => 4,
                    "w:insideV" if kind == 4 => 5,
                    "w:tl2br" if kind == 4 => 6,
                    "w:tr2bl" if kind == 4 => 7,
                    _ => return false,
                };
                let slots = if kind == 3 {
                    tokens.margins.as_mut_slice()
                } else {
                    tokens.borders.as_mut_slice()
                };
                slots[edge].get_or_insert(element.xml);
                return true;
            }
            container = None;
        }
        let property = match element.name {
            "w:shd" => 0,
            "w:gridSpan" => 1,
            "w:tcW" => 2,
            "w:tcMar" => 3,
            "w:tcBorders" => 4,
            "w:vAlign" => 5,
            "w:vMerge" => 6,
            "w:textDirection" => 7,
            "w:noWrap" => 8,
            "w:cnfStyle" | "w:tcFitText" | "w:hideMark" | "w:hMerge" | "w:cellIns"
            | "w:cellDel" | "w:cellMerge" => return leaf,
            _ => return false,
        };
        if tokens.values[property].is_some() {
            return false;
        }
        if matches!(property, 3 | 4) {
            container = Some((property, element.source_start + element.xml.len()));
        } else if !leaf {
            return false;
        }
        tokens.values[property] = Some(element.xml);
        true
    })?;
    complete.then_some(tokens)
}

impl CellPropertyTokens<'_> {
    fn margin_spacing(&self) -> Option<TableBoxSpacing> {
        let spacing = TableBoxSpacing {
            top_twips: self.margins[0].and_then(|tag| parse_integer_attribute(tag, "w:w")),
            right_twips: self.margins[1]
                .or(self.margins[5])
                .and_then(|tag| parse_integer_attribute(tag, "w:w")),
            bottom_twips: self.margins[2].and_then(|tag| parse_integer_attribute(tag, "w:w")),
            left_twips: self.margins[3]
                .or(self.margins[4])
                .and_then(|tag| parse_integer_attribute(tag, "w:w")),
        };
        (spacing.top_twips.is_some()
            || spacing.right_twips.is_some()
            || spacing.bottom_twips.is_some()
            || spacing.left_twips.is_some())
        .then_some(spacing)
    }

    fn border_set(&self) -> Option<TableBorderSet> {
        let [top, right, bottom, left, inside_h, inside_v, tl2br, tr2bl] =
            self.borders.map(super::util::parse_table_border_style);
        let present = top.is_some()
            || right.is_some()
            || bottom.is_some()
            || left.is_some()
            || inside_h.is_some()
            || inside_v.is_some()
            || tl2br.is_some()
            || tr2bl.is_some();
        present.then_some(TableBorderSet {
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
}

fn parse_table_cell_geometry(cell_xml: &str) -> ParsedTableCellResult {
    let source = direct_table_property(cell_xml, "w:tcPr");
    let tokens = source.and_then(indexed_cell_property_tokens);
    let owned_fallback = if tokens.is_none() {
        source.map(str::to_owned)
    } else {
        None
    };
    let cell_properties_xml = owned_fallback.as_deref();
    let property = |index, name| {
        if let Some(tokens) = &tokens {
            tokens.values[index]
        } else {
            cell_properties_xml.and_then(|xml| direct_table_property(xml, name))
        }
    };
    let shading_xml = if let Some(tokens) = &tokens {
        tokens.values[0]
    } else {
        cell_properties_xml
    };
    let background_color = shading_xml
        .and_then(|xml| {
            re::get_unchecked(r#"(?i)<w:shd\b[^>]*w:fill="([^"]+)""#)
                .captures(xml)
                .and_then(|caps| caps.get(1).map(|value| value.as_str()))
        })
        .and_then(|value| normalize_hex_color(Some(value)));
    let grid_span = property(1, "w:gridSpan").and_then(|tag| parse_integer_attribute(tag, "w:val"));
    let preferred_width = property(2, "w:tcW").and_then(parse_table_preferred_width);
    let width_twips = preferred_width.as_ref().and_then(preferred_width_twips);
    let margin_twips = if let Some(tokens) = &tokens {
        tokens.margin_spacing()
    } else {
        cell_properties_xml
            .and_then(|xml| {
                regex_find(xml, r"(?is)<w:tcMar\b[\s\S]*?</w:tcMar>|<w:tcMar\b[^>]*/?>")
            })
            .and_then(parse_table_box_spacing)
    };
    let borders = if let Some(tokens) = &tokens {
        tokens.border_set()
    } else {
        cell_properties_xml
            .and_then(|xml| {
                regex_find(
                    xml,
                    r"(?is)<w:tcBorders\b[\s\S]*?</w:tcBorders>|<w:tcBorders\b[^>]*/?>",
                )
            })
            .and_then(parse_table_border_set)
    };
    let vertical_align_tag = if let Some(tokens) = &tokens {
        tokens.values[5]
    } else {
        cell_properties_xml.and_then(|xml| regex_find(xml, r"(?i)<w:vAlign\b[^>]*>"))
    };
    let vertical_align_raw =
        vertical_align_tag.and_then(|tag| crate::xml::get_attribute_ref(tag, "w:val"));
    let vertical_align = match vertical_align_raw {
        Some(value) if value.eq_ignore_ascii_case("top") => Some(TableCellVerticalAlign::Top),
        Some(value) if value.eq_ignore_ascii_case("center") => Some(TableCellVerticalAlign::Center),
        Some(value) if value.eq_ignore_ascii_case("bottom") => Some(TableCellVerticalAlign::Bottom),
        _ => None,
    };
    let v_merge_tag = if let Some(tokens) = &tokens {
        tokens.values[6]
    } else {
        cell_properties_xml.and_then(|xml| regex_find(xml, r"(?i)<w:vMerge\b[^>]*/?>"))
    };
    let text_direction = property(7, "w:textDirection")
        .and_then(|tag| get_attribute(tag, "w:val"))
        .filter(|value| {
            matches!(
                value.as_str(),
                "lrTb" | "tbRl" | "btLr" | "lrTbV" | "tbRlV" | "tbLrV"
            )
        });
    let no_wrap = property(8, "w:noWrap").and_then(|tag| parse_on_off_attribute(tag, "noWrap"));
    let v_merge_raw = v_merge_tag.and_then(|tag| crate::xml::get_attribute_ref(tag, "w:val"));
    let v_merge = if v_merge_tag.is_some() {
        Some(
            if v_merge_raw.is_some_and(|value| value.eq_ignore_ascii_case("restart")) {
                "restart".to_string()
            } else {
                "continue".to_string()
            },
        )
    } else {
        None
    };
    let has_cell_style = background_color.is_some()
        || grid_span.is_some_and(|v| v > 1)
        || preferred_width.is_some()
        || width_twips.is_some()
        || margin_twips.is_some()
        || vertical_align.is_some()
        || text_direction.is_some()
        || no_wrap.is_some()
        || borders.is_some();
    ParsedTableCellResult {
        cell: TableCellNode {
            r#type: TableCellNodeType::TableCell,
            style: if has_cell_style {
                Some(TableCellStyle {
                    background_color,
                    grid_span: grid_span.filter(|&v| v > 1),
                    row_span: None,
                    v_merge_continuation: None,
                    width_twips,
                    source_width: Some(TableWidthSource {
                        preferred_width: preferred_width.clone(),
                        width_twips,
                        inherited_preferred_width: None,
                    }),
                    preferred_width,
                    margin_twips,
                    vertical_align,
                    source_text_direction: text_direction.clone(),
                    text_direction,
                    no_wrap,
                    source_no_wrap: no_wrap,
                    borders,
                })
            } else {
                None
            },
            nodes: Vec::new(),
        },
        v_merge,
    }
}

pub fn parse_table(
    table_xml: &str,
    context: &crate::parse::context::ParseContext<'_>,
) -> TableNode {
    let table_properties_xml = direct_table_property(table_xml, "w:tblPr");
    let table_style_id = table_properties_xml
        .as_deref()
        .and_then(|xml| direct_table_property(xml, "w:tblStyle"))
        .and_then(|tag| get_attribute(tag, "w:val"));
    let resolved_table_style_id = table_style_id
        .as_deref()
        .or(context.style_sheet.default_table_style_id.as_deref());
    let table_style =
        resolved_table_style_id.and_then(|id| context.style_sheet.table_style_by_id.get(id));
    let table_paragraph_spacing = resolved_table_style_id.and_then(|id| {
        context
            .style_sheet
            .table_paragraph_spacing_by_style_id
            .get(id)
    });
    let style_table_properties = table_style
        .and_then(|style| style.conditions.get(&TableConditionalStyleType::WholeTable))
        .and_then(|condition| condition.table_properties.clone());
    let style_table_look = table_style
        .and_then(|style| style.conditions.get(&TableConditionalStyleType::WholeTable))
        .and_then(|condition| condition.table_look.clone());
    let explicit_properties =
        parse_table_style_properties_from_xml(table_properties_xml.as_deref());
    let merged_properties = merge_table_style_properties(
        style_table_properties.as_ref(),
        explicit_properties.as_ref(),
    );
    let width_twips = merged_properties.as_ref().and_then(|p| p.width_twips);
    let preferred_width = merged_properties
        .as_ref()
        .and_then(|p| p.preferred_width.clone());
    let alignment = merged_properties.as_ref().and_then(|p| p.alignment);
    let bidi_visual = merged_properties.as_ref().and_then(|p| p.bidi_visual);
    let indent_twips = merged_properties.as_ref().and_then(|p| p.indent_twips);
    let layout = merged_properties.as_ref().and_then(|p| p.layout);
    let cell_spacing_twips = merged_properties
        .as_ref()
        .and_then(|p| p.cell_spacing_twips);
    let floating = merged_properties.as_ref().and_then(|p| p.floating.clone());
    let cell_margin_twips = merged_properties
        .as_ref()
        .and_then(|p| p.cell_margin_twips.clone());
    let table_borders_xml = table_properties_xml.as_deref().and_then(|xml| {
        regex_find(
            xml,
            r"(?is)<w:tblBorders\b[\s\S]*?</w:tblBorders>|<w:tblBorders\b[^>]*/?>",
        )
    });
    let explicit_borders = table_borders_xml.and_then(parse_table_border_set);
    let table_grid_xml = direct_table_property(table_xml, "w:tblGrid");
    let column_widths_twips: Vec<i64> = table_grid_xml
        .map(|grid| {
            crate::xml::extract_direct_child_tag_ranges(grid)
                .into_iter()
                .filter(|range| range.tag_name.eq_ignore_ascii_case("w:gridCol"))
                .filter_map(|range| parse_integer_attribute(&grid[range.start..range.end], "w:w"))
                .filter(|&width| width >= 0)
                .collect()
        })
        .unwrap_or_default();
    let table_look = merge_table_look(
        parse_table_look(table_properties_xml.as_deref()),
        style_table_look.as_ref(),
    );
    let preserve_collapsed_base = layout == Some(TableLayout::Fixed)
        && cell_spacing_twips.unwrap_or(0) == 0
        && explicit_borders.is_none()
        && table_style.is_none_or(|style| {
            !style.has_row_cell_spacing
                && style.conditions.iter().all(|(kind, condition)| {
                    *kind == TableConditionalStyleType::WholeTable
                        && condition.table_borders.is_none()
                })
        });
    let row_blocks: Vec<_> = crate::xml::extract_balanced_tag_slices(table_xml, "w:tr")
        .into_iter()
        .filter(|row| {
            direct_table_property(row, "w:trPr")
                .and_then(|properties| direct_table_property(properties, "w:del"))
                .is_none()
        })
        .collect();
    let source_grid_bound = table_grid_xml
        .map(|_| column_widths_twips.len() as i64)
        .unwrap_or_else(|| {
            row_blocks
                .iter()
                .map(|row| {
                    crate::xml::extract_balanced_tag_slices(row, "w:tc")
                        .iter()
                        .fold(0i64, |total, cell| {
                            let span = direct_table_property(cell, "w:tcPr")
                                .and_then(|xml| direct_table_property(xml, "w:gridSpan"))
                                .and_then(|tag| parse_integer_attribute(tag, "w:val"))
                                .unwrap_or(1)
                                .max(1);
                            total.saturating_add(span)
                        })
                })
                .max()
                .unwrap_or(0)
        });
    let mut rows: Vec<TableRowNode> = Vec::new();
    let mut cell_sources_by_row: Vec<Vec<&str>> = Vec::new();
    #[derive(Clone, Copy)]
    struct VerticalMergeAnchor {
        row_index: usize,
        cell_index: usize,
    }
    let mut active_vertical_merge_by_column: HashMap<i64, VerticalMergeAnchor> = HashMap::new();
    let mut has_row_spacing_override = false;
    let mut has_row_table_exception = false;
    for row_xml in row_blocks {
        let row_properties_xml = direct_table_property(row_xml, "w:trPr");
        has_row_table_exception |= direct_table_property(row_xml, "w:tblPrEx").is_some();
        if preserve_collapsed_base && !has_row_spacing_override {
            has_row_spacing_override = row_properties_xml
                .and_then(|properties| direct_table_property(properties, "w:tblCellSpacing"))
                .is_some()
                || direct_table_property(row_xml, "w:tblPrEx")
                    .and_then(|properties| direct_table_property(properties, "w:tblCellSpacing"))
                    .is_some();
        }
        let grid_before = row_properties_xml
            .as_deref()
            .and_then(|xml| direct_table_property(xml, "w:gridBefore"))
            .and_then(|tag| parse_integer_attribute(tag, "w:val"))
            .filter(|value| *value >= 0);
        let grid_after = row_properties_xml
            .as_deref()
            .and_then(|xml| direct_table_property(xml, "w:gridAfter"))
            .and_then(|tag| parse_integer_attribute(tag, "w:val"))
            .filter(|value| *value >= 0);
        let width_before = row_properties_xml
            .as_deref()
            .and_then(|xml| direct_table_property(xml, "w:wBefore"))
            .and_then(parse_table_preferred_width);
        let width_after = row_properties_xml
            .as_deref()
            .and_then(|xml| direct_table_property(xml, "w:wAfter"))
            .and_then(parse_table_preferred_width);
        let row_background_color = row_properties_xml
            .as_deref()
            .and_then(|xml| regex_capture(xml, r#"(?i)<w:shd\b[^>]*w:fill="([^"]+)""#))
            .as_deref()
            .and_then(|value| normalize_hex_color(Some(value)));
        let row_height_tag = row_properties_xml
            .as_deref()
            .and_then(|xml| regex_tag(xml, r"(?i)<w:trHeight\b[^>]*>"));
        let row_height_raw = row_height_tag
            .as_deref()
            .and_then(|tag| parse_integer_attribute(tag, "w:val"));
        let row_height_twips = row_height_raw.filter(|&v| v > 0);
        let row_height_rule_raw = row_height_tag
            .as_deref()
            .and_then(|tag| get_attribute(tag, "w:hRule"))
            .map(|v| v.to_ascii_lowercase());
        let row_height_rule = match row_height_rule_raw.as_deref() {
            Some("atleast") => Some(TableRowHeightRule::AtLeast),
            Some("exact") => Some(TableRowHeightRule::Exact),
            Some("auto") => Some(TableRowHeightRule::Auto),
            _ => None,
        };
        let row_cant_split = row_properties_xml
            .as_deref()
            .and_then(|xml| parse_on_off_attribute(xml, "cantSplit"));
        let row_is_header = row_properties_xml
            .as_deref()
            .and_then(|xml| parse_on_off_attribute(xml, "tblHeader"));
        let cell_sources = crate::xml::extract_balanced_tag_slices(row_xml, "w:tc");
        let parsed_cells: Vec<ParsedTableCellResult> = cell_sources
            .iter()
            .map(|cell_xml| parse_table_cell_geometry(cell_xml))
            .collect();
        if parsed_cells.is_empty() {
            continue;
        }
        cell_sources_by_row.push(cell_sources);
        let mut cells = Vec::new();
        let mut column_cursor = resolve_table_grid_skip_count(grid_before, source_grid_bound);
        for parsed_cell in parsed_cells {
            let mut cell = parsed_cell.cell;
            let column_span = cell
                .style
                .as_ref()
                .and_then(|s| s.grid_span)
                .unwrap_or(1)
                .max(1);
            let start_column = column_cursor;
            let end_column = start_column + column_span - 1;
            column_cursor += column_span;
            if parsed_cell.v_merge.as_deref() == Some("continue") {
                let mut continuation_anchors = Vec::new();
                for column_index in start_column..=end_column {
                    if let Some(anchor) = active_vertical_merge_by_column.get(&column_index) {
                        continuation_anchors.push(*anchor);
                    }
                }
                continuation_anchors
                    .sort_unstable_by_key(|anchor| (anchor.row_index, anchor.cell_index));
                continuation_anchors.dedup_by_key(|anchor| (anchor.row_index, anchor.cell_index));
                for anchor in continuation_anchors {
                    if let Some(row) = rows.get_mut(anchor.row_index) {
                        if let Some(anchor_cell) = row.cells.get_mut(anchor.cell_index) {
                            let anchor_style = anchor_cell.style.get_or_insert(TableCellStyle {
                                background_color: None,
                                grid_span: None,
                                row_span: None,
                                v_merge_continuation: None,
                                width_twips: None,
                                preferred_width: None,
                                source_width: None,
                                margin_twips: None,
                                vertical_align: None,
                                text_direction: None,
                                source_text_direction: None,
                                no_wrap: None,
                                source_no_wrap: None,
                                borders: None,
                            });
                            anchor_style.row_span = Some(anchor_style.row_span.unwrap_or(1) + 1);
                        }
                    }
                    for column_index in start_column..=end_column {
                        active_vertical_merge_by_column.insert(column_index, anchor);
                    }
                }
                let mut style = cell.style.unwrap_or(TableCellStyle {
                    background_color: None,
                    grid_span: None,
                    row_span: None,
                    v_merge_continuation: None,
                    width_twips: None,
                    preferred_width: None,
                    source_width: None,
                    margin_twips: None,
                    vertical_align: None,
                    text_direction: None,
                    source_text_direction: None,
                    no_wrap: None,
                    source_no_wrap: None,
                    borders: None,
                });
                style.v_merge_continuation = Some(true);
                cell.style = Some(style);
                cells.push(cell);
                continue;
            }
            if parsed_cell.v_merge.as_deref() == Some("restart") {
                let mut style = cell.style.unwrap_or(TableCellStyle {
                    background_color: None,
                    grid_span: None,
                    row_span: None,
                    v_merge_continuation: None,
                    width_twips: None,
                    preferred_width: None,
                    source_width: None,
                    margin_twips: None,
                    vertical_align: None,
                    text_direction: None,
                    source_text_direction: None,
                    no_wrap: None,
                    source_no_wrap: None,
                    borders: None,
                });
                style.row_span = Some(1);
                cell.style = Some(style.clone());
                let anchor = VerticalMergeAnchor {
                    row_index: rows.len(),
                    cell_index: cells.len(),
                };
                for column_index in start_column..=end_column {
                    active_vertical_merge_by_column.insert(column_index, anchor);
                }
            } else {
                for column_index in start_column..=end_column {
                    active_vertical_merge_by_column.remove(&column_index);
                }
            }
            cells.push(cell);
        }
        rows.push(TableRowNode {
            r#type: TableRowNodeType::TableRow,
            cells,
            style: if grid_before.is_some()
                || grid_after.is_some()
                || width_before.is_some()
                || width_after.is_some()
                || row_background_color.is_some()
                || row_height_twips.is_some()
                || row_height_rule.is_some()
                || row_cant_split.is_some()
                || row_is_header.is_some()
            {
                Some(TableRowStyle {
                    grid_before,
                    grid_after,
                    source_row_geometry: Some(TableRowGeometrySource {
                        grid_before,
                        grid_after,
                        width_before: width_before.clone(),
                        width_after: width_after.clone(),
                    }),
                    width_before,
                    width_after,
                    background_color: row_background_color,
                    height_twips: row_height_twips,
                    height_rule: row_height_rule,
                    cant_split: row_cant_split,
                    is_header: row_is_header,
                })
            } else {
                None
            },
        });
    }
    let (column_widths_twips, collapsed_grid_columns) = if rows.iter().any(|row| {
        row.style.as_ref().is_some_and(|style| {
            style.grid_before.unwrap_or(0) > 0 || style.grid_after.unwrap_or(0) > 0
        })
    }) {
        (column_widths_twips, None)
    } else {
        let preserve_collapsed = preserve_collapsed_base
            && !has_row_spacing_override
            && rows.iter().all(|row| {
                row.style.as_ref().is_none_or(|style| {
                    style.grid_before.unwrap_or(0) == 0 && style.grid_after.unwrap_or(0) == 0
                })
            });
        normalize_conflicting_table_grid(
            column_widths_twips,
            &mut rows,
            preserve_collapsed,
            preserve_collapsed
                && floating.is_none()
                && !has_row_table_exception
                && matches!(
                    preferred_width.as_ref(),
                    Some(crate::model::TablePreferredWidth::Auto)
                ),
        )
    };
    let column_count = column_widths_twips
        .len()
        .max(
            rows.iter()
                .map(|row| {
                    row.cells.iter().fold(0i64, |total, cell| {
                        total
                            + cell
                                .style
                                .as_ref()
                                .and_then(|s| s.grid_span)
                                .filter(|&v| v > 1)
                                .unwrap_or(1)
                    }) + resolve_table_grid_skip_count(
                        row.style.as_ref().and_then(|style| style.grid_before),
                        source_grid_bound,
                    ) + resolve_table_grid_skip_count(
                        row.style.as_ref().and_then(|style| style.grid_after),
                        source_grid_bound,
                    )
                })
                .max()
                .unwrap_or(0) as usize,
        )
        .max(1) as i64;
    // Resolve cell geometry before parsing text so conditional table formatting
    // enters the cascade below paragraph, character, and direct run properties.
    {
        let row_count = rows.len() as i64;
        for (row_index, row) in rows.iter_mut().enumerate() {
            let mut column_cursor = resolve_table_grid_skip_count(
                row.style.as_ref().and_then(|style| style.grid_before),
                source_grid_bound,
            );
            for (cell_index, cell) in row.cells.iter_mut().enumerate() {
                let column_span = cell
                    .style
                    .as_ref()
                    .and_then(|s| s.grid_span)
                    .unwrap_or(1)
                    .max(1);
                let start_column_index = column_cursor;
                let end_column_index = start_column_index + column_span - 1;
                column_cursor += column_span;
                let condition = table_style.and_then(|table_style| {
                    resolve_table_condition_for_cell(
                        table_style,
                        &table_look,
                        row_index as i64,
                        row_count,
                        start_column_index,
                        end_column_index,
                        column_count,
                    )
                });
                cell.nodes = parse_table_cell_content_with_run_style(
                    &cell_sources_by_row[row_index][cell_index],
                    context,
                    table_paragraph_spacing,
                    condition
                        .as_ref()
                        .and_then(|value| value.run_style.as_ref()),
                );
                let Some(condition) = condition else { continue };
                if cell
                    .style
                    .as_ref()
                    .and_then(|style| style.preferred_width.as_ref())
                    .is_none()
                {
                    if let Some(preferred_width) = condition.cell_preferred_width.as_ref() {
                        let cell_style = cell.style.get_or_insert(TableCellStyle {
                            background_color: None,
                            grid_span: None,
                            row_span: None,
                            v_merge_continuation: None,
                            width_twips: None,
                            preferred_width: None,
                            source_width: None,
                            margin_twips: None,
                            vertical_align: None,
                            text_direction: None,
                            source_text_direction: None,
                            no_wrap: None,
                            source_no_wrap: None,
                            borders: None,
                        });
                        cell_style.preferred_width = Some(preferred_width.clone());
                        cell_style.width_twips = preferred_width_twips(preferred_width);
                    }
                }
                if let Some(style) = cell.style.as_mut() {
                    style.source_width = Some(TableWidthSource {
                        preferred_width: style.preferred_width.clone(),
                        width_twips: style.width_twips,
                        inherited_preferred_width: condition.cell_preferred_width.clone(),
                    });
                }
                if cell
                    .style
                    .as_ref()
                    .and_then(|s| s.v_merge_continuation)
                    .unwrap_or(false)
                {
                    continue;
                }
                if condition.row_background_color.is_some()
                    && row
                        .style
                        .as_ref()
                        .and_then(|s| s.background_color.as_ref())
                        .is_none()
                {
                    let row_style = row.style.get_or_insert(TableRowStyle {
                        grid_before: None,
                        grid_after: None,
                        width_before: None,
                        width_after: None,
                        source_row_geometry: None,
                        background_color: None,
                        height_twips: None,
                        height_rule: None,
                        cant_split: None,
                        is_header: None,
                    });
                    row_style.background_color = condition.row_background_color.clone();
                }
                if condition.cell_background_color.is_some()
                    && cell
                        .style
                        .as_ref()
                        .and_then(|s| s.background_color.as_ref())
                        .is_none()
                    && row
                        .style
                        .as_ref()
                        .and_then(|s| s.background_color.as_ref())
                        .is_none()
                {
                    let cell_style = cell.style.get_or_insert(TableCellStyle {
                        background_color: None,
                        grid_span: None,
                        row_span: None,
                        v_merge_continuation: None,
                        width_twips: None,
                        preferred_width: None,
                        source_width: None,
                        margin_twips: None,
                        vertical_align: None,
                        text_direction: None,
                        source_text_direction: None,
                        no_wrap: None,
                        source_no_wrap: None,
                        borders: None,
                    });
                    cell_style.background_color = condition.cell_background_color.clone();
                }
                if let Some(ref cell_borders) = condition.cell_borders {
                    let cell_style = cell.style.get_or_insert(TableCellStyle {
                        background_color: None,
                        grid_span: None,
                        row_span: None,
                        v_merge_continuation: None,
                        width_twips: None,
                        preferred_width: None,
                        source_width: None,
                        margin_twips: None,
                        vertical_align: None,
                        text_direction: None,
                        source_text_direction: None,
                        no_wrap: None,
                        source_no_wrap: None,
                        borders: None,
                    });
                    cell_style.borders =
                        merge_table_border_sets(Some(cell_borders), cell_style.borders.as_ref());
                }
                if let Some(text_alignment) = condition.paragraph_text_alignment {
                    apply_text_alignment_to_table_cell_content(
                        &mut cell.nodes,
                        text_alignment,
                        context,
                    );
                }
                if let Some(snap_to_grid) = condition.paragraph_snap_to_grid {
                    apply_snap_to_grid_to_table_cell_content(
                        &mut cell.nodes,
                        snap_to_grid,
                        context,
                    );
                }
                if let Some(paragraph_align) = condition.paragraph_align {
                    apply_paragraph_alignment_to_table_cell_content(
                        &mut cell.nodes,
                        paragraph_align,
                    );
                }
            }
        }
    }
    let resolved_table_borders = merge_table_border_sets(
        table_style
            .and_then(|style| style.conditions.get(&TableConditionalStyleType::WholeTable))
            .and_then(|condition| condition.table_borders.as_ref()),
        explicit_borders.as_ref(),
    );
    for row in &mut rows {
        for cell in &mut row.cells {
            if let Some(style) = cell.style.as_mut() {
                style.source_width = Some(TableWidthSource {
                    preferred_width: style.preferred_width.clone(),
                    width_twips: style.width_twips,
                    inherited_preferred_width: style
                        .source_width
                        .as_ref()
                        .and_then(|source| source.inherited_preferred_width.clone()),
                });
            }
        }
    }
    let has_table_style = table_style_id.is_some()
        || table_grid_xml.is_some()
        || preferred_width.is_some()
        || alignment.is_some()
        || bidi_visual.is_some()
        || width_twips.is_some()
        || indent_twips.is_some()
        || layout.is_some()
        || cell_spacing_twips.is_some()
        || floating.is_some()
        || cell_margin_twips.is_some()
        || !column_widths_twips.is_empty()
        || resolved_table_borders.is_some();
    TableNode {
        r#type: TableNodeType::Table,
        block_id: None,
        rows,
        style: if has_table_style {
            Some(TableStyle {
                style_id: table_style_id.clone(),
                source_style_id: table_style_id,
                width_twips,
                source_width: Some(TableWidthSource {
                    preferred_width: preferred_width.clone(),
                    width_twips,
                    inherited_preferred_width: style_table_properties
                        .as_ref()
                        .and_then(|properties| properties.preferred_width.clone()),
                }),
                preferred_width,
                alignment,
                source_alignment: alignment,
                source_inherited_alignment: style_table_properties
                    .as_ref()
                    .and_then(|properties| properties.alignment),
                bidi_visual,
                source_bidi_visual: bidi_visual,
                source_inherited_bidi_visual: style_table_properties
                    .as_ref()
                    .and_then(|properties| properties.bidi_visual),
                indent_twips,
                layout,
                cell_spacing_twips,
                cell_margin_twips,
                column_widths_twips: if column_widths_twips.is_empty() && table_grid_xml.is_none() {
                    None
                } else {
                    Some(column_widths_twips)
                },
                collapsed_grid_columns,
                borders: resolved_table_borders,
                floating,
            })
        } else {
            None
        },
        source_xml: Some(table_xml.to_string()),
        source_text_patches: None,
    }
}

/// Some generators emit a placeholder tblGrid while each row's real geometry
/// lives in per-cell tcW values (rows may even have differing boundaries).
/// Preserve the existing physical reconstruction when preferred widths differ
/// from the declared grid, while retaining compatible logical boundaries.
fn normalize_conflicting_table_grid(
    grid: Vec<i64>,
    rows: &mut [TableRowNode],
    preserve_collapsed_columns: bool,
    resolve_shared_constraints: bool,
) -> (Vec<i64>, Option<Vec<usize>>) {
    const BOUNDARY_TOLERANCE_TWIPS: i64 = 80;
    if grid.is_empty() || rows.is_empty() {
        return (grid, None);
    }

    let span_of = |cell: &TableCellNode| -> usize {
        cell.style
            .as_ref()
            .and_then(|style| style.grid_span)
            .unwrap_or(1)
            .max(1) as usize
    };
    let width_of = |cell: &TableCellNode| -> Option<i64> {
        cell.style
            .as_ref()
            .and_then(|style| style.width_twips)
            .filter(|&width| width > 0)
    };
    let is_continuation = |cell: &TableCellNode| -> bool {
        cell.style
            .as_ref()
            .and_then(|style| style.v_merge_continuation)
            .unwrap_or(false)
    };

    // Only regrid when the declared grid is structurally consistent with the
    // rows (cell spans actually address its columns) but width-wrong. When the
    // grid is structurally bogus (e.g. one gridCol for a three-column table),
    // the row-derived fallbacks downstream already model Word's behavior.
    let max_span_sum = rows
        .iter()
        .map(|row| row.cells.iter().map(|cell| span_of(cell)).sum::<usize>())
        .max()
        .unwrap_or(0);
    if max_span_sum != grid.len() {
        return (grid, None);
    }

    // Generators that slice page layouts into (nested) tables emit uniform
    // placeholder grids — equal divisions of the table width — while the real
    // geometry lives in per-cell tcW values. Small per-cell deviations slip
    // under the conflict ratio below yet still misplace the text fragments the
    // cells position, so when the declared grid is uniform and every cell
    // carries an explicit width, trust the cell widths outright.
    let grid_is_uniform = grid.len() > 1 && grid.iter().all(|&width| (width - grid[0]).abs() <= 1);
    let cells_fully_measured = rows.iter().all(|row| {
        row.cells
            .iter()
            .all(|cell| is_continuation(cell) || width_of(cell).is_some())
    });
    let uniform_placeholder_grid = grid_is_uniform && cells_fully_measured;

    // Conflict detection: do explicit cell widths disagree with the grid?
    let mut measured_rows = 0usize;
    let mut conflict_rows = 0usize;
    let mut has_width_difference = false;
    for row in rows.iter() {
        let mut cursor = 0usize;
        let mut measured = 0usize;
        let mut conflicts = 0usize;
        for cell in &row.cells {
            let span = span_of(cell);
            let expected: i64 = grid.iter().skip(cursor).take(span).sum();
            cursor += span;
            // Continuation cells inherit the anchor row's geometry, and
            // generators often stamp them with placeholder widths copied from
            // the bogus grid — they are evidence of nothing.
            if is_continuation(cell) {
                continue;
            }
            let Some(actual) = width_of(cell) else {
                continue;
            };
            has_width_difference |= actual != expected;
            if expected <= 0 {
                continue;
            }
            measured += 1;
            if (actual - expected).abs() * 5 > expected {
                conflicts += 1;
            }
        }
        if measured > 0 {
            measured_rows += 1;
            if conflicts * 2 > measured {
                conflict_rows += 1;
            }
        }
    }
    // Retain shared columns when the preferred widths already agree. A union
    // of cell boundaries can otherwise erase columns inside spanning cells.
    if !has_width_difference
        || measured_rows == 0
        || (!uniform_placeholder_grid && conflict_rows * 2 <= measured_rows)
    {
        return (grid, None);
    }

    // Union of every row's cumulative cell boundaries; cells without an
    // explicit width fall back to the original grid width for their span.
    // Vertically merged cells must share the anchor row's width: HTML rowspan
    // cannot express per-row geometry, so continuation cells adopt the
    // anchor's width and the difference is absorbed by the cells that follow
    // (matching how LibreOffice resolves such tables).
    let bucket_of = |position: i64| -> i64 {
        (position + BOUNDARY_TOLERANCE_TWIPS / 2) / BOUNDARY_TOLERANCE_TWIPS
    };
    let mut anchor_width_by_bucket: HashMap<i64, i64> = HashMap::new();
    let mut boundaries: Vec<i64> = vec![0];
    for row in rows.iter() {
        let mut cursor = 0usize;
        let mut position = 0i64;
        for cell in &row.cells {
            let span = span_of(cell);
            let fallback: i64 = grid.iter().skip(cursor).take(span).sum();
            cursor += span;
            let own_width = width_of(cell).unwrap_or(fallback.max(1));
            let bucket = bucket_of(position);
            let width = if is_continuation(cell) {
                *anchor_width_by_bucket.get(&bucket).unwrap_or(&own_width)
            } else {
                anchor_width_by_bucket.insert(bucket, own_width);
                own_width
            };
            position += width;
            boundaries.push(position);
        }
    }
    boundaries.sort_unstable();
    let mut merged: Vec<i64> = Vec::new();
    for boundary in boundaries {
        match merged.last() {
            Some(&last) if boundary - last <= BOUNDARY_TOLERANCE_TWIPS => {}
            _ => merged.push(boundary),
        }
    }
    if merged.len() < 2 {
        return (grid, None);
    }

    let snap = |value: i64| -> usize {
        match merged.binary_search(&value) {
            Ok(index) => index,
            Err(index) => {
                if index == 0 {
                    0
                } else if index >= merged.len() {
                    merged.len() - 1
                } else if value - merged[index - 1] <= merged[index] - value {
                    index - 1
                } else {
                    index
                }
            }
        }
    };

    let mut source_boundaries = vec![None; grid.len() + 1];
    let mut source_topology_consistent = true;
    let mut resolved_spans = Vec::new();
    anchor_width_by_bucket.clear();
    for row in rows.iter() {
        let mut cursor = 0usize;
        let mut position = 0i64;
        let mut resolved_cursor = 0usize;
        for cell in &row.cells {
            let span = span_of(cell);
            let source_start = cursor;
            let fallback: i64 = grid.iter().skip(cursor).take(span).sum();
            cursor += span;
            let own_width = width_of(cell).unwrap_or(fallback.max(1));
            let bucket = bucket_of(position);
            let width = if is_continuation(cell) {
                *anchor_width_by_bucket.get(&bucket).unwrap_or(&own_width)
            } else {
                anchor_width_by_bucket.insert(bucket, own_width);
                own_width
            };
            let start_index = snap(position);
            position += width;
            let end_index = snap(position).max(start_index + 1);
            let new_span = (end_index - start_index) as i64;
            resolved_spans.push(new_span);
            if start_index != resolved_cursor || end_index >= merged.len() {
                source_topology_consistent = false;
            } else {
                for (column, boundary) in [
                    (source_start, merged[start_index]),
                    (cursor, merged[end_index]),
                ] {
                    match source_boundaries.get_mut(column) {
                        Some(value @ None) => *value = Some(boundary),
                        Some(Some(value)) if *value == boundary => {}
                        _ => source_topology_consistent = false,
                    }
                }
            }
            resolved_cursor += new_span as usize;
        }
    }
    // Keep logical columns when all rows agree on their resolved boundaries.
    // Interior columns may be unobserved because every row spans over them.
    if source_topology_consistent {
        if let Some(resolved_grid) =
            preserve_shared_grid_topology(&grid, &source_boundaries, preserve_collapsed_columns)
        {
            let collapsed: Vec<_> = resolved_grid
                .iter()
                .enumerate()
                .filter_map(|(column, &width)| (width == 0).then_some(column))
                .collect();
            if collapsed.is_empty()
                || resolved_grid
                    .iter()
                    .copied()
                    .filter(|&width| width > 0)
                    .eq(merged.windows(2).map(|pair| pair[1] - pair[0]))
            {
                return (resolved_grid, (!collapsed.is_empty()).then_some(collapsed));
            }
        }
    }

    if !source_topology_consistent && resolve_shared_constraints {
        if let Some(widths) = resolve_shared_column_preferences(grid.len(), rows) {
            return (widths, None);
        }
    }

    let mut resolved_spans = resolved_spans.into_iter();
    for row in rows.iter_mut() {
        for cell in &mut row.cells {
            let new_span = resolved_spans.next().unwrap_or(1);
            if new_span > 1 {
                let style = cell.style.get_or_insert(TableCellStyle {
                    background_color: None,
                    grid_span: None,
                    row_span: None,
                    v_merge_continuation: None,
                    width_twips: None,
                    preferred_width: None,
                    source_width: None,
                    margin_twips: None,
                    vertical_align: None,
                    text_direction: None,
                    source_text_direction: None,
                    no_wrap: None,
                    source_no_wrap: None,
                    borders: None,
                });
                style.grid_span = Some(new_span);
            } else if let Some(style) = cell.style.as_mut() {
                style.grid_span = None;
            }
        }
    }

    (
        merged.windows(2).map(|pair| pair[1] - pair[0]).collect(),
        None,
    )
}

/// Resolve fully anchored cell preferences on the shared logical columns.
fn resolve_shared_column_preferences(columns: usize, rows: &[TableRowNode]) -> Option<Vec<i64>> {
    let mut constraints: Vec<Vec<(usize, i64)>> = vec![Vec::new(); columns + 1];
    let mut anchored = vec![false; columns];
    for row in rows {
        let mut start = 0usize;
        for cell in &row.cells {
            let style = cell.style.as_ref()?;
            let span = usize::try_from(style.grid_span.unwrap_or(1)).ok()?;
            if span == 0 {
                return None;
            }
            let end = start.checked_add(span)?;
            if end > columns {
                return None;
            }
            if !style.v_merge_continuation.unwrap_or(false) {
                if !matches!(
                    style.preferred_width.as_ref(),
                    Some(crate::model::TablePreferredWidth::Dxa { .. })
                ) {
                    return None;
                }
                let width = style.width_twips.filter(|&value| value > 0)?;
                constraints[end].push((start, width));
                if span == 1 {
                    anchored[start] = true;
                }
            }
            start = end;
        }
        if start != columns {
            return None;
        }
    }
    if anchored.iter().any(|&value| !value) {
        return None;
    }
    let mut boundaries = vec![0i64; columns + 1];
    for end in 1..=columns {
        let mut position = boundaries[end - 1];
        for &(start, width) in &constraints[end] {
            position = position.max(boundaries[start].checked_add(width)?);
        }
        boundaries[end] = position;
    }
    Some(
        boundaries
            .windows(2)
            .map(|pair| pair[1] - pair[0])
            .collect(),
    )
}

fn preserve_shared_grid_topology(
    grid: &[i64],
    boundaries: &[Option<i64>],
    allow_collapsed: bool,
) -> Option<Vec<i64>> {
    if boundaries.first().copied().flatten() != Some(0)
        || boundaries.last().copied().flatten().is_none()
        || grid.iter().any(|&width| width <= 0)
    {
        return None;
    }
    let minimum_column_width = if allow_collapsed { 0 } else { 1 };
    let mut result = Vec::with_capacity(grid.len());
    let mut start = 0usize;
    let mut position = 0i64;
    for (end, boundary) in boundaries.iter().enumerate().skip(1) {
        let Some(boundary) = *boundary else { continue };
        let width = boundary.checked_sub(position)?;
        if width < minimum_column_width * (end - start) as i64 {
            return None;
        }
        let source_width: i128 = grid[start..end].iter().map(|&value| value as i128).sum();
        let mut source_position = 0i128;
        let mut resolved_position = 0i64;
        for &column_width in &grid[start..end] {
            source_position += column_width as i128;
            let next_position = (source_position * width as i128 / source_width) as i64;
            let resolved_width = next_position - resolved_position;
            if resolved_width < minimum_column_width {
                return None;
            }
            result.push(resolved_width);
            resolved_position = next_position;
        }
        start = end;
        position = boundary;
    }
    Some(result)
}

fn parse_table_look(table_properties_xml: Option<&str>) -> Option<ParsedTableLook> {
    let table_properties_xml = table_properties_xml?;
    let table_look_tag =
        regex_tag(table_properties_xml, r"(?i)<w:tblLook\b[^>]*/?>").unwrap_or_default();
    if table_look_tag.is_empty() {
        return None;
    }
    let look_mask_raw = get_attribute(&table_look_tag, "w:val");
    let look_mask = look_mask_raw.and_then(|v| i64::from_str_radix(&v, 16).ok());
    let row_band_size_tag = regex_tag(
        table_properties_xml,
        r"(?i)<w:tblStyleRowBandSize\b[^>]*/?>",
    )
    .or_else(|| {
        extract_balanced_tag_blocks(table_properties_xml, "w:tblStyleRowBandSize")
            .into_iter()
            .next()
    });
    let col_band_size_tag = regex_tag(
        table_properties_xml,
        r"(?i)<w:tblStyleColBandSize\b[^>]*/?>",
    )
    .or_else(|| {
        extract_balanced_tag_blocks(table_properties_xml, "w:tblStyleColBandSize")
            .into_iter()
            .next()
    });
    let row_band_size_raw = row_band_size_tag
        .as_deref()
        .and_then(|tag| parse_integer_attribute(tag, "w:val"))
        .unwrap_or(1)
        .max(1);
    let col_band_size_raw = col_band_size_tag
        .as_deref()
        .and_then(|tag| parse_integer_attribute(tag, "w:val"))
        .unwrap_or(1)
        .max(1);
    let resolve_on_off = |attribute: &str| -> Option<bool> {
        let value = get_attribute(&table_look_tag, attribute)?.to_ascii_lowercase();
        match value.as_str() {
            "1" | "true" | "on" => Some(true),
            "0" | "false" | "off" => Some(false),
            _ => None,
        }
    };
    let mask_value = look_mask.unwrap_or(0);
    Some(ParsedTableLook {
        first_row: resolve_on_off("w:firstRow").unwrap_or(mask_value & 0x0020 != 0),
        last_row: resolve_on_off("w:lastRow").unwrap_or(mask_value & 0x0040 != 0),
        first_col: resolve_on_off("w:firstColumn").unwrap_or(mask_value & 0x0080 != 0),
        last_col: resolve_on_off("w:lastColumn").unwrap_or(mask_value & 0x0100 != 0),
        no_h_band: resolve_on_off("w:noHBand").unwrap_or(mask_value & 0x0200 != 0),
        no_v_band: resolve_on_off("w:noVBand").unwrap_or(mask_value & 0x0400 != 0),
        row_band_size: row_band_size_raw,
        col_band_size: col_band_size_raw,
    })
}

fn merge_table_look(
    direct: Option<ParsedTableLook>,
    inherited: Option<&ParsedTableLook>,
) -> ParsedTableLook {
    let mut merged = default_table_look();
    if let Some(inherited) = inherited {
        merged = inherited.clone();
    }
    if let Some(direct) = direct {
        merged = direct;
    }
    merged
}

pub(crate) fn resolve_table_grid_skip_count(count: Option<i64>, bound: i64) -> i64 {
    count
        .filter(|value| *value >= 0 && *value <= bound)
        .unwrap_or(0)
}

pub(crate) fn table_grid_column_bound(table: &TableNode) -> i64 {
    if let Some(widths) = table
        .style
        .as_ref()
        .and_then(|style| style.column_widths_twips.as_ref())
    {
        widths.len() as i64
    } else {
        table
            .rows
            .iter()
            .map(|row| {
                row.cells.iter().fold(0i64, |total, cell| {
                    total.saturating_add(
                        cell.style
                            .as_ref()
                            .and_then(|style| style.grid_span)
                            .unwrap_or(1)
                            .max(1),
                    )
                })
            })
            .max()
            .unwrap_or(0)
    }
}

pub(crate) fn resolve_table_condition_for_cell(
    table_style: &ParsedTableStyleDefinition,
    table_look: &ParsedTableLook,
    row_index: i64,
    row_count: i64,
    start_column_index: i64,
    end_column_index: i64,
    column_count: i64,
) -> Option<ParsedTableStyleCondition> {
    let mut condition_types = vec![TableConditionalStyleType::WholeTable];
    let is_first_row = row_index == 0;
    let is_last_row = row_index == row_count - 1;
    let is_first_column = start_column_index == 0;
    let is_last_column = end_column_index >= column_count - 1;
    let row_band_size = table_look.row_band_size.max(1);
    let col_band_size = table_look.col_band_size.max(1);
    if !table_look.no_h_band {
        let band_row_index = row_index - if table_look.first_row { 1 } else { 0 };
        if band_row_index >= 0 {
            let band_row_group = band_row_index / row_band_size;
            condition_types.push(if band_row_group % 2 == 0 {
                TableConditionalStyleType::Band1Horz
            } else {
                TableConditionalStyleType::Band2Horz
            });
        }
    }
    if !table_look.no_v_band {
        let band_column_index = start_column_index - if table_look.first_col { 1 } else { 0 };
        if band_column_index >= 0 {
            let band_column_group = band_column_index / col_band_size;
            condition_types.push(if band_column_group % 2 == 0 {
                TableConditionalStyleType::Band1Vert
            } else {
                TableConditionalStyleType::Band2Vert
            });
        }
    }
    if table_look.first_row && is_first_row {
        condition_types.push(TableConditionalStyleType::FirstRow);
    }
    if table_look.last_row && is_last_row {
        condition_types.push(TableConditionalStyleType::LastRow);
    }
    if table_look.first_col && is_first_column {
        condition_types.push(TableConditionalStyleType::FirstCol);
    }
    if table_look.last_col && is_last_column {
        condition_types.push(TableConditionalStyleType::LastCol);
    }
    if table_look.first_row && table_look.first_col && is_first_row && is_first_column {
        condition_types.push(TableConditionalStyleType::NwCell);
    }
    if table_look.first_row && table_look.last_col && is_first_row && is_last_column {
        condition_types.push(TableConditionalStyleType::NeCell);
    }
    if table_look.last_row && table_look.first_col && is_last_row && is_first_column {
        condition_types.push(TableConditionalStyleType::SwCell);
    }
    if table_look.last_row && table_look.last_col && is_last_row && is_last_column {
        condition_types.push(TableConditionalStyleType::SeCell);
    }
    let mut resolved_condition: Option<ParsedTableStyleCondition> = None;
    for condition_type in condition_types {
        resolved_condition = merge_table_conditional_style(
            resolved_condition.as_ref(),
            table_style.conditions.get(&condition_type),
        );
    }
    resolved_condition
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
            .and_then(|d| d.row_background_color.clone())
            .or_else(|| inherited.and_then(|i| i.row_background_color.clone())),
        cell_background_color: direct
            .and_then(|d| d.cell_background_color.clone())
            .or_else(|| inherited.and_then(|i| i.cell_background_color.clone())),
        cell_preferred_width: direct
            .and_then(|value| value.cell_preferred_width.clone())
            .or_else(|| inherited.and_then(|value| value.cell_preferred_width.clone())),
        paragraph_align: direct
            .and_then(|d| d.paragraph_align)
            .or(inherited.and_then(|i| i.paragraph_align)),
        paragraph_text_alignment: direct
            .and_then(|value| value.paragraph_text_alignment)
            .or_else(|| inherited.and_then(|value| value.paragraph_text_alignment)),
        paragraph_snap_to_grid: direct
            .and_then(|value| value.paragraph_snap_to_grid)
            .or_else(|| inherited.and_then(|value| value.paragraph_snap_to_grid)),
        run_style: merge_text_styles(&[
            inherited.and_then(|i| i.run_style.clone()),
            direct.and_then(|d| d.run_style.clone()),
        ]),
        table_borders: merge_table_border_sets(
            inherited.and_then(|i| i.table_borders.as_ref()),
            direct.and_then(|d| d.table_borders.as_ref()),
        ),
        cell_borders: merge_table_border_sets(
            inherited.and_then(|i| i.cell_borders.as_ref()),
            direct.and_then(|d| d.cell_borders.as_ref()),
        ),
        table_properties: None,
        table_look: None,
    };
    if merged.row_background_color.is_none()
        && merged.cell_background_color.is_none()
        && merged.cell_preferred_width.is_none()
        && merged.paragraph_align.is_none()
        && merged.paragraph_text_alignment.is_none()
        && merged.paragraph_snap_to_grid.is_none()
        && merged.run_style.is_none()
        && merged.table_borders.is_none()
        && merged.cell_borders.is_none()
    {
        return None;
    }
    Some(merged)
}

fn apply_snap_to_grid_to_table_cell_content(
    nodes: &mut [TableCellContentNode],
    table_snap_to_grid: bool,
    context: &crate::parse::context::ParseContext<'_>,
) {
    for node in nodes {
        let TableCellContentNode::Paragraph(paragraph) = node else {
            continue;
        };
        let properties = paragraph
            .source_xml
            .as_deref()
            .and_then(|xml| direct_table_property(xml, "w:pPr"))
            .unwrap_or_default();
        let direct_property = direct_table_property(properties, "w:snapToGrid");
        let direct =
            direct_property.and_then(|tag| crate::xml::parse_on_off_attribute(tag, "snapToGrid"));
        let explicit_style = direct_table_property(properties, "w:pStyle")
            .and_then(|tag| get_attribute(tag, "w:val"))
            .and_then(|id| context.style_sheet.paragraph_style_by_id.get(&id))
            .filter(|style| style.source_has_snap_to_grid != Some(false))
            .and_then(|style| style.snap_to_grid);
        let inherited = explicit_style.or(Some(table_snap_to_grid));
        let style = paragraph.style.get_or_insert_with(Default::default);
        style.snap_to_grid = direct.or(inherited);
        style.source_snap_to_grid = style.snap_to_grid;
        style.source_has_snap_to_grid = Some(direct_property.is_some());
        style.source_inherited_snap_to_grid = inherited;
        style.source_table_snap_to_grid = Some(table_snap_to_grid);
    }
}

fn apply_text_alignment_to_table_cell_content(
    nodes: &mut [TableCellContentNode],
    table_alignment: crate::model::ParagraphTextAlignment,
    context: &crate::parse::context::ParseContext<'_>,
) {
    for node in nodes {
        let TableCellContentNode::Paragraph(paragraph) = node else {
            continue;
        };
        let properties = paragraph
            .source_xml
            .as_deref()
            .and_then(|xml| direct_table_property(xml, "w:pPr"))
            .unwrap_or_default();
        let direct = super::style::parse_paragraph_text_alignment_from_xml(properties);
        let explicit_style = direct_table_property(properties, "w:pStyle")
            .and_then(|tag| get_attribute(tag, "w:val"))
            .and_then(|id| context.style_sheet.paragraph_style_by_id.get(&id))
            .filter(|style| style.source_has_text_alignment != Some(false))
            .and_then(|style| style.text_alignment);
        let inherited = explicit_style.or(Some(table_alignment));
        let style = paragraph.style.get_or_insert(crate::model::ParagraphStyle {
            source_before_auto_spacing: None,
            source_after_auto_spacing: None,
            align: None,
            snap_to_grid: None,
            source_snap_to_grid: None,
            source_has_snap_to_grid: None,
            source_inherited_snap_to_grid: None,
            source_table_snap_to_grid: None,
            text_alignment: None,
            source_text_alignment: None,
            source_has_text_alignment: None,
            source_inherited_text_alignment: None,
            source_table_text_alignment: None,
            heading_level: None,
            style_id: None,
            style_name: None,
            numbering: None,
            spacing: None,
            indent: None,
            background_color: None,
            borders: None,
            tab_stops: None,
            contextual_spacing: None,
            keep_next: None,
            keep_lines: None,
            widow_control: None,
            page_break_before: None,
            drop_cap: None,
        });
        style.text_alignment = direct.or(inherited);
        style.source_has_text_alignment =
            Some(direct_table_property(properties, "w:textAlignment").is_some());
        style.source_text_alignment = style.text_alignment;
        style.source_inherited_text_alignment = inherited;
        style.source_table_text_alignment = Some(table_alignment);
    }
}

fn paragraph_has_direct_alignment(paragraph: &crate::model::ParagraphNode) -> bool {
    let Some(source_xml) = paragraph.source_xml.as_deref() else {
        return false;
    };
    let paragraph_properties_xml = extract_balanced_tag_blocks(source_xml, "w:pPr")
        .into_iter()
        .next()
        .or_else(|| regex_tag(source_xml, r"(?i)<w:pPr\b[^>]*/?>"))
        .unwrap_or_default();
    re::get(r"(?i)<w:jc\b").is_some_and(|re| re.is_match(&paragraph_properties_xml))
}

fn apply_paragraph_alignment_to_table_cell_content(
    nodes: &mut [TableCellContentNode],
    paragraph_align: ParagraphAlignment,
) {
    for node in nodes.iter_mut() {
        match node {
            TableCellContentNode::Paragraph(paragraph) => {
                if paragraph_has_direct_alignment(paragraph) {
                    continue;
                }
                let style = paragraph.style.get_or_insert(crate::model::ParagraphStyle {
                    source_before_auto_spacing: None,
                    source_after_auto_spacing: None,
                    align: None,
                    snap_to_grid: None,
                    source_snap_to_grid: None,
                    source_has_snap_to_grid: None,
                    source_inherited_snap_to_grid: None,
                    source_table_snap_to_grid: None,
                    text_alignment: None,
                    source_text_alignment: None,
                    source_has_text_alignment: None,
                    source_inherited_text_alignment: None,
                    source_table_text_alignment: None,
                    heading_level: None,
                    style_id: None,
                    style_name: None,
                    numbering: None,
                    spacing: None,
                    indent: None,
                    background_color: None,
                    borders: None,
                    tab_stops: None,
                    contextual_spacing: None,
                    keep_next: None,
                    keep_lines: None,
                    widow_control: None,
                    page_break_before: None,
                    drop_cap: None,
                });
                style.align = Some(paragraph_align);
            }
            TableCellContentNode::Table(nested_table) => {
                for row in &mut nested_table.rows {
                    for cell in &mut row.cells {
                        apply_paragraph_alignment_to_table_cell_content(
                            &mut cell.nodes,
                            paragraph_align,
                        );
                    }
                }
            }
        }
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

fn regex_find<'a>(xml: &'a str, pattern: &str) -> Option<&'a str> {
    re::get(pattern)?.find(xml).map(|m| m.as_str())
}
