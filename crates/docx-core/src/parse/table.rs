use std::collections::HashMap;

use crate::model::{
    ParagraphAlignment, TableCellContentNode, TableCellNode, TableCellNodeType, TableCellStyle,
    TableCellVerticalAlign, TableLayout, TableNode, TableNodeType, TableRowHeightRule, TableRowNode,
    TableRowNodeType, TableRowStyle, TableStyle, TextStyle,
};
use crate::parse::re;
use crate::parse::context::{
    default_table_look, ParsedTableLook, ParsedTableProperties, ParsedTableStyleCondition,
    ParsedTableStyleDefinition, TableConditionalStyleType,
};
use crate::parse::paragraph::parse_paragraph_in_table;
use crate::parse::style::parse_paragraph_align_from_xml;
use crate::parse::styles::parse_table_box_spacing;
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
    let block_ranges = extract_balanced_tag_blocks_in_order(cell_xml, &["w:p", "w:tbl"]);
    let parsed: Vec<TableCellContentNode> = block_ranges
        .iter()
        .filter_map(|block| {
            let block_xml = &cell_xml[block.start..block.end];
            if block_xml.starts_with("<w:p") || block_xml.starts_with("<W:p") {
                return Some(TableCellContentNode::Paragraph(parse_paragraph_in_table(
                    block_xml,
                    context,
                    table_paragraph_spacing,
                )));
            }
            if block_xml.starts_with("<w:tbl") || block_xml.starts_with("<W:tbl") {
                return Some(TableCellContentNode::Table(Box::new(parse_table(block_xml, context))));
            }
            None
        })
        .collect();
    if !parsed.is_empty() {
        return parsed;
    }
    vec![TableCellContentNode::Paragraph(parse_paragraph_in_table(
        "<w:p><w:r><w:t/></w:r></w:p>",
        context,
        table_paragraph_spacing,
    ))]
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
    let nodes = parse_table_cell_content(cell_xml, context, table_paragraph_spacing);
    let cell_properties_xml = extract_balanced_tag_blocks(cell_xml, "w:tcPr")
        .into_iter()
        .next()
        .or_else(|| regex_tag(cell_xml, r"(?i)<w:tcPr\b[^>]*/?>"));
    let background_color = cell_properties_xml
        .as_deref()
        .and_then(|xml| regex_capture(xml, r#"(?i)<w:shd\b[^>]*w:fill="([^"]+)""#))
        .as_deref()
        .and_then(|value| normalize_hex_color(Some(value)));
    let grid_span = cell_properties_xml
        .as_deref()
        .and_then(|xml| regex_capture(xml, r#"(?i)<w:gridSpan\b[^>]*w:val="(\d+)""#))
        .and_then(|v| v.parse::<i64>().ok());
    let cell_width_tag = cell_properties_xml
        .as_deref()
        .and_then(|xml| regex_tag(xml, r"(?i)<w:tcW\b[^>]*>"));
    let cell_width_type = cell_width_tag
        .as_deref()
        .and_then(|tag| get_attribute(tag, "w:type"))
        .map(|v| v.to_ascii_lowercase());
    let width_twips_raw = cell_width_tag
        .as_deref()
        .and_then(|tag| parse_integer_attribute(tag, "w:w"));
    let width_twips = if cell_width_type.as_deref() == Some("dxa")
        && width_twips_raw.is_some_and(|v| v > 0)
    {
        width_twips_raw
    } else {
        None
    };
    let cell_margin_xml = cell_properties_xml
        .as_deref()
        .and_then(|xml| regex_find(xml, r"(?is)<w:tcMar\b[\s\S]*?</w:tcMar>|<w:tcMar\b[^>]*/?>"));
    let margin_twips = cell_margin_xml.and_then(parse_table_box_spacing);
    let cell_borders_xml = cell_properties_xml.as_deref().and_then(|xml| {
        regex_find(
            xml,
            r"(?is)<w:tcBorders\b[\s\S]*?</w:tcBorders>|<w:tcBorders\b[^>]*/?>",
        )
    });
    let borders = cell_borders_xml.and_then(parse_table_border_set);
    let vertical_align_tag = cell_properties_xml
        .as_deref()
        .and_then(|xml| regex_tag(xml, r"(?i)<w:vAlign\b[^>]*>"));
    let vertical_align_raw = vertical_align_tag
        .as_deref()
        .and_then(|tag| get_attribute(tag, "w:val"))
        .map(|v| v.to_ascii_lowercase());
    let vertical_align = match vertical_align_raw.as_deref() {
        Some("top") => Some(TableCellVerticalAlign::Top),
        Some("center") => Some(TableCellVerticalAlign::Center),
        Some("bottom") => Some(TableCellVerticalAlign::Bottom),
        _ => None,
    };
    let v_merge_tag = cell_properties_xml
        .as_deref()
        .and_then(|xml| regex_tag(xml, r"(?i)<w:vMerge\b[^>]*/?>"));
    let v_merge_raw = v_merge_tag
        .as_deref()
        .and_then(|tag| get_attribute(tag, "w:val"))
        .map(|v| v.to_ascii_lowercase());
    let v_merge = if v_merge_tag.is_some() {
        Some(if v_merge_raw.as_deref() == Some("restart") {
            "restart".to_string()
        } else {
            "continue".to_string()
        })
    } else {
        None
    };
    let has_cell_style = background_color.is_some()
        || grid_span.is_some_and(|v| v > 1)
        || width_twips.is_some()
        || margin_twips.is_some()
        || vertical_align.is_some()
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
                    margin_twips,
                    vertical_align,
                    borders,
                })
            } else {
                None
            },
            nodes,
        },
        v_merge,
    }
}

pub fn parse_table(
    table_xml: &str,
    context: &crate::parse::context::ParseContext<'_>,
) -> TableNode {
    let table_properties_xml = extract_balanced_tag_blocks(table_xml, "w:tblPr")
        .into_iter()
        .next()
        .or_else(|| regex_tag(table_xml, r"(?i)<w:tblPr\b[^>]*/?>"));
    let table_style_id = table_properties_xml
        .as_deref()
        .and_then(|xml| regex_capture(xml, r#"(?i)<w:tblStyle\b[^>]*w:val="([^"]+)""#));
    let table_style = table_style_id
        .as_deref()
        .and_then(|id| context.style_sheet.table_style_by_id.get(id));
    let table_paragraph_spacing = table_style_id
        .as_deref()
        .and_then(|id| context.style_sheet.table_paragraph_spacing_by_style_id.get(id));
    let style_table_properties = table_style
        .and_then(|style| style.conditions.get(&TableConditionalStyleType::WholeTable))
        .and_then(|condition| condition.table_properties.clone());
    let style_table_look = table_style
        .and_then(|style| style.conditions.get(&TableConditionalStyleType::WholeTable))
        .and_then(|condition| condition.table_look.clone());
    let explicit_properties = parse_table_style_properties_from_xml(table_properties_xml.as_deref());
    let merged_properties = merge_table_style_properties(style_table_properties.as_ref(), explicit_properties.as_ref());
    let width_twips = merged_properties.as_ref().and_then(|p| p.width_twips);
    let indent_twips = merged_properties.as_ref().and_then(|p| p.indent_twips);
    let layout = merged_properties.as_ref().and_then(|p| p.layout);
    let cell_spacing_twips = merged_properties.as_ref().and_then(|p| p.cell_spacing_twips);
    let floating = merged_properties.as_ref().and_then(|p| p.floating.clone());
    let cell_margin_twips = merged_properties.as_ref().and_then(|p| p.cell_margin_twips.clone());
    let table_borders_xml = table_properties_xml.as_deref().and_then(|xml| {
        regex_find(
            xml,
            r"(?is)<w:tblBorders\b[\s\S]*?</w:tblBorders>|<w:tblBorders\b[^>]*/?>",
        )
    });
    let explicit_borders = table_borders_xml.and_then(parse_table_border_set);
    let table_grid_xml = regex_find(table_xml, r"(?is)<w:tblGrid\b[\s\S]*?</w:tblGrid>");
    let column_widths_twips: Vec<i64> = table_grid_xml
        .map(|grid| {
            re::get_unchecked(r"(?i)<w:gridCol\b[^>]*>")
                .find_iter(grid)
                .filter_map(|m| parse_integer_attribute(m.as_str(), "w:w"))
                .filter(|&width| width > 0)
                .collect()
        })
        .unwrap_or_default();
    let table_look = merge_table_look(
        parse_table_look(table_properties_xml.as_deref()),
        style_table_look.as_ref(),
    );
    let mut rows: Vec<TableRowNode> = Vec::new();
    #[derive(Clone, Copy)]
    struct VerticalMergeAnchor {
        row_index: usize,
        cell_index: usize,
    }
    let mut active_vertical_merge_by_column: HashMap<i64, VerticalMergeAnchor> = HashMap::new();
    for row_xml in extract_balanced_tag_blocks(table_xml, "w:tr") {
        let row_properties_xml = extract_balanced_tag_blocks(&row_xml, "w:trPr")
            .into_iter()
            .next()
            .or_else(|| regex_tag(&row_xml, r"(?i)<w:trPr\b[^>]*/?>"));
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
        let parsed_cells: Vec<ParsedTableCellResult> = extract_balanced_tag_blocks(&row_xml, "w:tc")
            .into_iter()
            .map(|cell_xml| parse_table_cell(&cell_xml, context, table_paragraph_spacing))
            .collect();
        if parsed_cells.is_empty() {
            continue;
        }
        let mut cells = Vec::new();
        let mut column_cursor = 0i64;
        for parsed_cell in parsed_cells {
            let mut cell = parsed_cell.cell;
            let column_span = cell.style.as_ref().and_then(|s| s.grid_span).unwrap_or(1).max(1);
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
                continuation_anchors.sort_unstable_by_key(|anchor| (anchor.row_index, anchor.cell_index));
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
                                margin_twips: None,
                                vertical_align: None,
                                borders: None,
                            });
                            anchor_style.row_span =
                                Some(anchor_style.row_span.unwrap_or(1) + 1);
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
                    margin_twips: None,
                    vertical_align: None,
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
                    margin_twips: None,
                    vertical_align: None,
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
            style: if row_background_color.is_some()
                || row_height_twips.is_some()
                || row_height_rule.is_some()
                || row_cant_split.is_some()
                || row_is_header.is_some()
            {
                Some(TableRowStyle {
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
    let column_widths_twips = normalize_conflicting_table_grid(column_widths_twips, &mut rows);
    let column_count = column_widths_twips
        .len()
        .max(
            rows.iter()
                .map(|row| {
                    row.cells.iter().fold(0i64, |total, cell| {
                        total + cell.style.as_ref().and_then(|s| s.grid_span).filter(|&v| v > 1).unwrap_or(1)
                    })
                })
                .max()
                .unwrap_or(0) as usize,
        )
        .max(1) as i64;
    if let Some(table_style) = table_style {
        let row_count = rows.len() as i64;
        for (row_index, row) in rows.iter_mut().enumerate() {
            let mut column_cursor = 0i64;
            for cell in &mut row.cells {
                let column_span = cell.style.as_ref().and_then(|s| s.grid_span).unwrap_or(1).max(1);
                let start_column_index = column_cursor;
                let end_column_index = start_column_index + column_span - 1;
                column_cursor += column_span;
                if cell.style.as_ref().and_then(|s| s.v_merge_continuation).unwrap_or(false) {
                    continue;
                }
                let condition = resolve_table_condition_for_cell(
                    table_style,
                    &table_look,
                    row_index as i64,
                    row_count,
                    start_column_index,
                    end_column_index,
                    column_count,
                );
                let Some(condition) = condition else { continue };
                if condition.row_background_color.is_some()
                    && row
                        .style
                        .as_ref()
                        .and_then(|s| s.background_color.as_ref())
                        .is_none()
                {
                    let row_style = row.style.get_or_insert(TableRowStyle {
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
                        margin_twips: None,
                        vertical_align: None,
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
                        margin_twips: None,
                        vertical_align: None,
                        borders: None,
                    });
                    cell_style.borders = merge_table_border_sets(
                        Some(cell_borders),
                        cell_style.borders.as_ref(),
                    );
                }
                if let Some(paragraph_align) = condition.paragraph_align {
                    apply_paragraph_alignment_to_table_cell_content(&mut cell.nodes, paragraph_align);
                }
                if let Some(ref run_style) = condition.run_style {
                    apply_run_style_to_table_cell_content(&mut cell.nodes, run_style.clone());
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
    let has_table_style = width_twips.is_some()
        || indent_twips.is_some()
        || layout.is_some()
        || cell_spacing_twips.is_some()
        || floating.is_some()
        || cell_margin_twips.is_some()
        || !column_widths_twips.is_empty()
        || resolved_table_borders.is_some();
    TableNode {
        r#type: TableNodeType::Table,
        rows,
        style: if has_table_style {
            Some(TableStyle {
                width_twips,
                indent_twips,
                layout,
                cell_spacing_twips,
                cell_margin_twips,
                column_widths_twips: if column_widths_twips.is_empty() {
                    None
                } else {
                    Some(column_widths_twips)
                },
                borders: resolved_table_borders,
                floating,
            })
        } else {
            None
        },
        source_xml: Some(table_xml.to_string()),
    }
}

/// Some generators emit a placeholder tblGrid while each row's real geometry
/// lives in per-cell tcW values (rows may even have differing boundaries).
/// Word's fixed-layout algorithm trusts cell widths over the grid, so when the
/// two disagree on most measured cells, rebuild the grid as the union of all
/// row boundaries and remap every cell's gridSpan onto it.
fn normalize_conflicting_table_grid(
    grid: Vec<i64>,
    rows: &mut [TableRowNode],
) -> Vec<i64> {
    const BOUNDARY_TOLERANCE_TWIPS: i64 = 80;
    // Temporary A/B toggle for corpus verification; remove before commit.
    const LEGACY_GATE: bool = false;
    if grid.is_empty() || rows.is_empty() {
        return grid;
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
        return grid;
    }

    // Generators that slice page layouts into (nested) tables emit uniform
    // placeholder grids — equal divisions of the table width — while the real
    // geometry lives in per-cell tcW values. Small per-cell deviations slip
    // under the conflict ratio below yet still misplace the text fragments the
    // cells position, so when the declared grid is uniform and every cell
    // carries an explicit width, trust the cell widths outright.
    let grid_is_uniform =
        grid.len() > 1 && grid.iter().all(|&width| (width - grid[0]).abs() <= 1);
    let cells_fully_measured = rows.iter().all(|row| {
        row.cells
            .iter()
            .all(|cell| is_continuation(cell) || width_of(cell).is_some())
    });
    let uniform_placeholder_grid = grid_is_uniform && cells_fully_measured;

    // Conflict detection: do explicit cell widths disagree with the grid?
    let mut measured_rows = 0usize;
    let mut conflict_rows = 0usize;
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
    if measured_rows == 0
        || (!uniform_placeholder_grid && conflict_rows * 2 <= measured_rows)
    {
        return grid;
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
        return grid;
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

    // Remap each cell's span onto the union grid.
    anchor_width_by_bucket.clear();
    for row in rows.iter_mut() {
        let mut cursor = 0usize;
        let mut position = 0i64;
        for cell in &mut row.cells {
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
            let start_index = snap(position);
            position += width;
            let end_index = snap(position).max(start_index + 1);
            let new_span = (end_index - start_index) as i64;
            if new_span > 1 {
                let style = cell.style.get_or_insert(TableCellStyle {
                    background_color: None,
                    grid_span: None,
                    row_span: None,
                    v_merge_continuation: None,
                    width_twips: None,
                    margin_twips: None,
                    vertical_align: None,
                    borders: None,
                });
                style.grid_span = Some(new_span);
            } else if let Some(style) = cell.style.as_mut() {
                style.grid_span = None;
            }
        }
    }

    merged.windows(2).map(|pair| pair[1] - pair[0]).collect()
}

fn parse_table_style_properties_from_xml(
    table_properties_xml: Option<&str>,
) -> Option<ParsedTableProperties> {
    let table_properties_xml = table_properties_xml?;
    let table_width_tag = regex_tag(table_properties_xml, r"(?i)<w:tblW\b[^>]*>");
    let table_width_type = table_width_tag
        .as_deref()
        .and_then(|tag| get_attribute(tag, "w:type"))
        .map(|v| v.to_ascii_lowercase());
    let table_width_raw = table_width_tag
        .as_deref()
        .and_then(|tag| parse_integer_attribute(tag, "w:w"));
    let width_twips = if table_width_type.as_deref() == Some("dxa")
        && table_width_raw.is_some_and(|v| v > 0)
    {
        table_width_raw
    } else {
        None
    };
    let table_indent_tag = regex_tag(table_properties_xml, r"(?i)<w:tblInd\b[^>]*>");
    let table_indent_type = table_indent_tag
        .as_deref()
        .and_then(|tag| get_attribute(tag, "w:type"))
        .map(|v| v.to_ascii_lowercase());
    let table_indent_raw = table_indent_tag
        .as_deref()
        .and_then(|tag| parse_integer_attribute(tag, "w:w"));
    let indent_twips = if table_indent_type.as_deref() == Some("dxa")
        && table_indent_raw.is_some_and(|v| v != 0)
    {
        table_indent_raw
    } else {
        None
    };
    let table_layout_tag = regex_tag(table_properties_xml, r"(?i)<w:tblLayout\b[^>]*>");
    let table_layout_raw = table_layout_tag
        .as_deref()
        .and_then(|tag| get_attribute(tag, "w:type"))
        .map(|v| v.to_ascii_lowercase());
    let layout = match table_layout_raw.as_deref() {
        Some("fixed") => Some(TableLayout::Fixed),
        Some("autofit") => Some(TableLayout::Autofit),
        _ => None,
    };
    let table_cell_spacing_tag = regex_tag(table_properties_xml, r"(?i)<w:tblCellSpacing\b[^>]*/?>");
    let table_cell_spacing_type = table_cell_spacing_tag
        .as_deref()
        .and_then(|tag| get_attribute(tag, "w:type"))
        .map(|v| v.to_ascii_lowercase());
    let table_cell_spacing_raw = table_cell_spacing_tag
        .as_deref()
        .and_then(|tag| parse_integer_attribute(tag, "w:w"));
    let cell_spacing_twips = if table_cell_spacing_type.as_deref() == Some("dxa")
        && table_cell_spacing_raw.is_some_and(|v| v >= 0)
    {
        table_cell_spacing_raw
    } else {
        None
    };
    let table_cell_margin_xml = regex_find(
        table_properties_xml,
        r"(?is)<w:tblCellMar\b[\s\S]*?</w:tblCellMar>|<w:tblCellMar\b[^>]*/?>",
    );
    let cell_margin_twips = table_cell_margin_xml.and_then(parse_table_box_spacing);
    let floating = parse_floating_table_style(table_properties_xml);
    Some(ParsedTableProperties {
        width_twips,
        indent_twips,
        layout,
        cell_spacing_twips,
        cell_margin_twips,
        floating,
    })
}

fn merge_table_style_properties(
    inherited: Option<&ParsedTableProperties>,
    direct: Option<&ParsedTableProperties>,
) -> Option<ParsedTableProperties> {
    if inherited.is_none() && direct.is_none() {
        return None;
    }
    Some(ParsedTableProperties {
        width_twips: direct
            .and_then(|d| d.width_twips)
            .or(inherited.and_then(|i| i.width_twips)),
        indent_twips: direct
            .and_then(|d| d.indent_twips)
            .or(inherited.and_then(|i| i.indent_twips)),
        layout: direct
            .and_then(|d| d.layout)
            .or(inherited.and_then(|i| i.layout)),
        cell_spacing_twips: direct
            .and_then(|d| d.cell_spacing_twips)
            .or(inherited.and_then(|i| i.cell_spacing_twips)),
        floating: direct
            .and_then(|d| d.floating.clone())
            .or_else(|| inherited.and_then(|i| i.floating.clone())),
        cell_margin_twips: direct
            .and_then(|d| d.cell_margin_twips.clone())
            .or_else(|| inherited.and_then(|i| i.cell_margin_twips.clone())),
    })
}

fn parse_table_look(table_properties_xml: Option<&str>) -> Option<ParsedTableLook> {
    let table_properties_xml = table_properties_xml?;
    let table_look_tag = regex_tag(table_properties_xml, r"(?i)<w:tblLook\b[^>]*/?>").unwrap_or_default();
    if table_look_tag.is_empty() {
        return None;
    }
    let look_mask_raw = get_attribute(&table_look_tag, "w:val");
    let look_mask = look_mask_raw.and_then(|v| i64::from_str_radix(&v, 16).ok());
    let row_band_size_tag = regex_tag(table_properties_xml, r"(?i)<w:tblStyleRowBandSize\b[^>]*/?>")
        .or_else(|| extract_balanced_tag_blocks(table_properties_xml, "w:tblStyleRowBandSize").into_iter().next());
    let col_band_size_tag = regex_tag(table_properties_xml, r"(?i)<w:tblStyleColBandSize\b[^>]*/?>")
        .or_else(|| extract_balanced_tag_blocks(table_properties_xml, "w:tblStyleColBandSize").into_iter().next());
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

fn merge_table_look(direct: Option<ParsedTableLook>, inherited: Option<&ParsedTableLook>) -> ParsedTableLook {
    let mut merged = default_table_look();
    if let Some(inherited) = inherited {
        merged = inherited.clone();
    }
    if let Some(direct) = direct {
        merged = direct;
    }
    merged
}

fn parse_floating_table_style(
    table_properties_xml: &str,
) -> Option<crate::model::TableFloating> {
    let floating_tag = regex_tag(table_properties_xml, r"(?i)<w:tblpPr\b[^>]*/?>")?;
    let x_twips = parse_integer_attribute(&floating_tag, "w:tblpX");
    let y_twips = parse_integer_attribute(&floating_tag, "w:tblpY");
    let left_from_text_twips = parse_integer_attribute(&floating_tag, "w:leftFromText");
    let right_from_text_twips = parse_integer_attribute(&floating_tag, "w:rightFromText");
    let top_from_text_twips = parse_integer_attribute(&floating_tag, "w:topFromText");
    let bottom_from_text_twips = parse_integer_attribute(&floating_tag, "w:bottomFromText");
    let horizontal_anchor = get_attribute(&floating_tag, "w:horzAnchor");
    let vertical_anchor = get_attribute(&floating_tag, "w:vertAnchor");
    let horizontal_align = super::util::to_image_horizontal_align(
        get_attribute(&floating_tag, "w:tblpXSpec")
            .map(|v| v.trim().to_ascii_lowercase())
            .as_deref()
            .filter(|v| matches!(*v, "left" | "center" | "right" | "inside" | "outside")),
    );
    let vertical_align = super::util::to_image_vertical_align(
        get_attribute(&floating_tag, "w:tblpYSpec")
            .map(|v| v.trim().to_ascii_lowercase())
            .as_deref()
            .filter(|v| matches!(*v, "top" | "center" | "bottom" | "inside" | "outside")),
    );
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
    Some(crate::model::TableFloating {
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

fn resolve_table_condition_for_cell(
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
        paragraph_align: direct
            .and_then(|d| d.paragraph_align)
            .or(inherited.and_then(|i| i.paragraph_align)),
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
        && merged.paragraph_align.is_none()
        && merged.run_style.is_none()
        && merged.table_borders.is_none()
        && merged.cell_borders.is_none()
    {
        return None;
    }
    Some(merged)
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
                    align: None,
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
                        apply_paragraph_alignment_to_table_cell_content(&mut cell.nodes, paragraph_align);
                    }
                }
            }
        }
    }
}

fn apply_run_style_to_paragraph(paragraph: &mut crate::model::ParagraphNode, run_style: TextStyle) {
    for child in &mut paragraph.children {
        match child {
            crate::model::ParagraphChildNode::Text(text) => {
                text.style = merge_text_styles(&[text.style.clone(), Some(run_style.clone())]);
            }
            crate::model::ParagraphChildNode::FormField(field) => {
                field.style = merge_text_styles(&[field.style.clone(), Some(run_style.clone())]);
            }
            crate::model::ParagraphChildNode::Image(_) => {}
        }
    }
}

fn apply_run_style_to_table_cell_content(nodes: &mut [TableCellContentNode], run_style: TextStyle) {
    for node in nodes.iter_mut() {
        match node {
            TableCellContentNode::Paragraph(paragraph) => {
                apply_run_style_to_paragraph(paragraph, run_style.clone());
            }
            TableCellContentNode::Table(nested_table) => {
                for row in &mut nested_table.rows {
                    for cell in &mut row.cells {
                        apply_run_style_to_table_cell_content(&mut cell.nodes, run_style.clone());
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
    re::get(pattern)?
        .find(xml)
        .map(|m| m.as_str().to_string())
}

fn regex_find<'a>(xml: &'a str, pattern: &str) -> Option<&'a str> {
    re::get(pattern)?.find(xml).map(|m| m.as_str())
}
