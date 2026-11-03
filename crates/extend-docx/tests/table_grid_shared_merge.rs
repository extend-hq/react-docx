use std::cell::RefCell;
use std::collections::HashMap;

use extend_docx::model::TableNode;
use extend_docx::parse::{empty_style_sheet, parse_table, ParseContext};

fn cell(width: Option<i64>, span: i64, merge: Option<&str>) -> String {
    let width = width
        .map(|value| format!(r#"<w:tcW w:type="dxa" w:w="{value}"/>"#))
        .unwrap_or_default();
    let span = format!(r#"<w:gridSpan w:val="{span}"/>"#);
    let merge = merge
        .map(|value| format!(r#"<w:vMerge w:val="{value}"/>"#))
        .unwrap_or_default();
    format!("<w:tc><w:tcPr>{width}{span}{merge}</w:tcPr><w:p/></w:tc>")
}

fn row(cells: &[String]) -> String {
    format!("<w:tr>{}</w:tr>", cells.concat())
}

fn ordinary_row(widths: &[i64]) -> String {
    row(&widths
        .iter()
        .map(|&width| cell(Some(width), 1, None))
        .collect::<Vec<_>>())
}

fn parse(grid: &[i64], rows: &[String]) -> TableNode {
    let grid = grid
        .iter()
        .map(|width| format!(r#"<w:gridCol w:w="{width}"/>"#))
        .collect::<String>();
    let xml = format!(
        r#"<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>{grid}</w:tblGrid>{}</w:tbl>"#,
        rows.concat()
    );
    let parts = HashMap::new();
    let binary_assets = HashMap::new();
    let context = ParseContext {
        relationships: HashMap::new(),
        content_types: Default::default(),
        parts: &parts,
        binary_assets: &binary_assets,
        style_sheet: empty_style_sheet(),
        warnings: RefCell::new(Vec::new()),
    };
    parse_table(&xml, &context)
}

fn widths(table: &TableNode) -> &[i64] {
    table
        .style
        .as_ref()
        .unwrap()
        .column_widths_twips
        .as_deref()
        .unwrap()
}

fn spans(table: &TableNode, row: usize) -> Vec<i64> {
    table.rows[row]
        .cells
        .iter()
        .map(|cell| {
            cell.style
                .as_ref()
                .and_then(|style| style.grid_span)
                .unwrap_or(1)
        })
        .collect()
}

#[test]
fn preserves_full_row_merge_over_repeated_measured_columns() {
    for columns in [3, 5, 8] {
        let measured = vec![1200; columns];
        let complete = ordinary_row(&measured);
        let table = parse(
            &vec![1400; columns],
            &[
                complete.clone(),
                complete,
                row(&[cell(Some(1200), columns as i64, None)]),
            ],
        );
        assert_eq!(widths(&table), measured);
        assert_eq!(spans(&table, 2), vec![columns as i64]);
        assert_eq!(spans(&table, 0), vec![1; columns]);
    }
}

#[test]
fn preserves_split_merged_header_with_singleton_restarts() {
    let complete = ordinary_row(&[1100; 7]);
    let table = parse(
        &[1100; 7],
        &[
            row(&[
                cell(Some(500), 2, Some("restart")),
                cell(Some(2500), 5, Some("restart")),
            ]),
            complete.clone(),
            complete,
        ],
    );
    assert_eq!(widths(&table), &[1100; 7]);
    assert_eq!(spans(&table, 0), vec![2, 5]);
    assert_eq!(spans(&table, 1), vec![1; 7]);
    assert_eq!(
        table.rows[0].cells[0].style.as_ref().unwrap().row_span,
        Some(1)
    );
}

#[test]
fn derives_nonuniform_columns_from_repeated_measurements() {
    let measured = [300, 700, 1100];
    let complete = ordinary_row(&measured);
    let table = parse(
        &[800, 1200, 1600],
        &[complete.clone(), complete, row(&[cell(Some(300), 3, None)])],
    );
    assert_eq!(widths(&table), &measured);
    assert_eq!(spans(&table, 2), vec![3]);
}

#[test]
fn does_not_infer_shared_columns_from_one_row_or_empty_rows() {
    let table = parse(
        &[1000; 3],
        &[
            ordinary_row(&[900; 3]),
            row(&[]),
            row(&[]),
            row(&[cell(Some(900), 3, None)]),
        ],
    );
    assert_eq!(widths(&table), &[900; 3]);
    assert_eq!(table.rows.len(), 2);
    assert_eq!(spans(&table, 1), vec![1]);
}

#[test]
fn does_not_infer_shared_columns_from_continuations_or_restarts() {
    for merge in ["restart", "continue"] {
        let table = parse(
            &[1000; 3],
            &[
                ordinary_row(&[900; 3]),
                row(&vec![cell(Some(900), 1, Some(merge)); 3]),
                row(&[cell(Some(900), 3, None)]),
            ],
        );
        assert_eq!(spans(&table, 2), vec![1], "{merge}");
    }
}

#[test]
fn ignores_continuation_widths_after_independent_rows_establish_columns() {
    let complete = ordinary_row(&[900; 3]);
    let table = parse(
        &[1000; 3],
        &[
            complete.clone(),
            complete,
            row(&[cell(Some(900), 3, Some("restart"))]),
            row(&[cell(Some(5000), 3, Some("continue"))]),
        ],
    );
    assert_eq!(widths(&table), &[900; 3]);
    assert_eq!(spans(&table, 2), vec![3]);
    assert_eq!(spans(&table, 3), vec![3]);
    assert_eq!(
        table.rows[2].cells[0].style.as_ref().unwrap().row_span,
        Some(2)
    );
    assert_eq!(
        table.rows[3].cells[0]
            .style
            .as_ref()
            .unwrap()
            .v_merge_continuation,
        Some(true)
    );
}

#[test]
fn retains_union_repair_when_complete_rows_disagree() {
    let complete = ordinary_row(&[900; 3]);
    let table = parse(
        &[1000; 3],
        &[
            complete.clone(),
            complete,
            ordinary_row(&[700, 1100, 900]),
            row(&[cell(Some(900), 3, None)]),
        ],
    );
    assert_eq!(widths(&table), &[700, 200, 900, 900]);
    assert_eq!(spans(&table, 3), vec![2]);
}

#[test]
fn retains_union_repair_when_a_single_column_measurement_conflicts() {
    let complete = ordinary_row(&[900; 4]);
    let table = parse(
        &[1000; 4],
        &[
            complete.clone(),
            complete,
            row(&[cell(Some(700), 1, None), cell(Some(900), 3, None)]),
        ],
    );
    assert_eq!(widths(&table), &[700, 200, 700, 200, 900, 900]);
    assert_eq!(spans(&table, 2), vec![1, 2]);
}

#[test]
fn retains_union_repair_when_a_row_does_not_cover_the_source_grid() {
    let complete = ordinary_row(&[900; 4]);
    let table = parse(
        &[1000; 4],
        &[complete.clone(), complete, row(&[cell(Some(900), 3, None)])],
    );
    assert_eq!(widths(&table), &[900; 4]);
    assert_eq!(spans(&table, 2), vec![1]);
}

#[test]
fn retains_union_repair_when_a_source_column_is_collapsed() {
    let complete = ordinary_row(&[400; 3]);
    let table = parse(
        &[1000, 0, 1000],
        &[complete.clone(), complete, row(&[cell(Some(400), 3, None)])],
    );
    assert_eq!(widths(&table), &[400; 3]);
    assert_eq!(spans(&table, 2), vec![1]);
}

#[test]
fn retains_union_repair_when_a_merged_preference_exceeds_anchored_width() {
    let complete = ordinary_row(&[900; 4]);
    let table = parse(
        &[1000; 4],
        &[
            complete.clone(),
            complete,
            row(&[cell(Some(900), 4, None)]),
            row(&[cell(Some(4000), 4, None)]),
        ],
    );
    assert_eq!(widths(&table), &[900, 900, 900, 900, 400]);
    assert_eq!(spans(&table, 2), vec![1]);
    assert_eq!(spans(&table, 3), vec![5]);
}

#[test]
fn retains_union_repair_when_noncontinuation_widths_are_missing() {
    let complete = ordinary_row(&[200; 3]);
    let table = parse(
        &[1000; 3],
        &[
            complete.clone(),
            complete,
            row(&vec![cell(None, 1, None); 3]),
            row(&[cell(Some(200), 3, None)]),
        ],
    );
    assert_eq!(widths(&table), &[200, 200, 200, 400, 1000, 1000]);
    assert_eq!(spans(&table, 3), vec![1]);
}

#[test]
fn leaves_row_skips_on_the_existing_grid_path() {
    for skip in ["gridBefore", "gridAfter"] {
        let complete = ordinary_row(&[900; 3]);
        let skipped = format!(
            r#"<w:tr><w:trPr><w:{skip} w:val="1"/></w:trPr>{}</w:tr>"#,
            vec![cell(Some(900), 1, None); 2].concat()
        );
        let table = parse(
            &[1000; 3],
            &[
                complete.clone(),
                complete,
                row(&[cell(Some(900), 3, None)]),
                skipped,
            ],
        );
        assert_eq!(widths(&table), &[1000; 3], "{skip}");
        assert_eq!(spans(&table, 2), vec![3], "{skip}");
    }
}

#[test]
fn retains_distinct_boundaries_when_rows_disagree() {
    let table = parse(
        &[1000; 2],
        &[ordinary_row(&[400, 1600]), ordinary_row(&[1200, 800])],
    );
    assert_eq!(widths(&table), &[400, 800, 800]);
    assert_eq!(spans(&table, 0), vec![1, 2]);
    assert_eq!(spans(&table, 1), vec![2, 1]);
}

#[test]
fn retains_union_repair_for_orphaned_continuations() {
    let complete = ordinary_row(&[1000; 3]);
    let table = parse(
        &[1200; 3],
        &[
            complete.clone(),
            complete,
            row(&[cell(Some(5000), 3, Some("continue"))]),
        ],
    );
    assert_eq!(widths(&table), &[1000; 3]);
    assert_eq!(spans(&table, 2), vec![1]);
}

#[test]
fn retains_union_repair_for_partially_overlapping_continuations() {
    let complete = ordinary_row(&[1000; 3]);
    let table = parse(
        &[1200; 3],
        &[
            complete.clone(),
            complete,
            row(&[
                cell(Some(500), 2, Some("restart")),
                cell(Some(1000), 1, None),
            ]),
            row(&[
                cell(Some(1000), 1, Some("continue")),
                cell(Some(2000), 2, None),
            ]),
        ],
    );
    assert_eq!(widths(&table), &[500; 6]);
    assert_eq!(spans(&table, 2), vec![1, 2]);
    assert_eq!(spans(&table, 3), vec![1, 4]);
}

#[test]
fn retains_union_repair_when_a_continuation_combines_anchors() {
    let complete = ordinary_row(&[1000; 3]);
    let table = parse(
        &[1200; 3],
        &[
            complete.clone(),
            complete,
            row(&[
                cell(Some(500), 1, Some("restart")),
                cell(Some(1500), 2, Some("restart")),
            ]),
            row(&[cell(Some(3000), 3, Some("continue"))]),
        ],
    );
    assert_eq!(widths(&table), &[500, 500, 1000, 1000]);
    assert_eq!(spans(&table, 3), vec![1]);
}
