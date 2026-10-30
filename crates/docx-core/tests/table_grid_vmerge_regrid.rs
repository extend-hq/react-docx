use std::cell::RefCell;
use std::collections::HashMap;

use docx_core::parse::{empty_style_sheet, parse_table, ParseContext};

/// Placeholder-grid tables whose vertical-merge continuation cells are stamped
/// with grid-matching widths must still regrid: the continuation cells inherit
/// the anchor's geometry, so only anchor/normal cells count as conflict
/// evidence.
#[test]
fn regrids_when_continuation_cells_echo_placeholder_grid() {
    let table_xml = r#"<w:tbl>
  <w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>
  <w:tblGrid><w:gridCol w:w="500"/><w:gridCol w:w="500"/></w:tblGrid>
  <w:tr>
    <w:tc><w:tcPr><w:tcW w:type="dxa" w:w="200"/><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>anchor</w:t></w:r></w:p></w:tc>
    <w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1300"/></w:tcPr><w:p><w:r><w:t>wide</w:t></w:r></w:p></w:tc>
  </w:tr>
  <w:tr>
    <w:tc><w:tcPr><w:tcW w:type="dxa" w:w="500"/><w:vMerge/></w:tcPr><w:p/></w:tc>
    <w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1300"/></w:tcPr><w:p><w:r><w:t>wide</w:t></w:r></w:p></w:tc>
  </w:tr>
  <w:tr>
    <w:tc><w:tcPr><w:tcW w:type="dxa" w:w="500"/><w:vMerge/></w:tcPr><w:p/></w:tc>
    <w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1300"/></w:tcPr><w:p><w:r><w:t>wide</w:t></w:r></w:p></w:tc>
  </w:tr>
</w:tbl>"#;
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
    let table = parse_table(table_xml, &context);
    let grid = table
        .style
        .as_ref()
        .and_then(|style| style.column_widths_twips.clone())
        .expect("grid");
    assert_eq!(grid, vec![200, 1300], "expected union-regridded columns");
    assert_eq!(
        table.rows[0].cells[0]
            .style
            .as_ref()
            .and_then(|s| s.row_span),
        Some(3)
    );
}

/// Uniform placeholder grids (equal divisions of the table width) with
/// complete per-cell tcW must regrid even when every deviation is under the
/// 20% conflict threshold, to preserve text placement in nested layout tables.
#[test]
fn regrids_uniform_placeholder_grid_with_small_deviations() {
    let table_xml = r#"<w:tbl>
  <w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>
  <w:tblGrid><w:gridCol w:w="651"/><w:gridCol w:w="651"/></w:tblGrid>
  <w:tr>
    <w:tc><w:tcPr><w:tcW w:type="dxa" w:w="560"/></w:tcPr><w:p><w:r><w:t>mbique</w:t></w:r></w:p></w:tc>
    <w:tc><w:tcPr><w:tcW w:type="dxa" w:w="760"/></w:tcPr><w:p><w:r><w:t>Karen Cav</w:t></w:r></w:p></w:tc>
  </w:tr>
</w:tbl>"#;
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
    let table = parse_table(table_xml, &context);
    let grid = table
        .style
        .as_ref()
        .and_then(|style| style.column_widths_twips.clone())
        .expect("grid");
    assert_eq!(grid, vec![560, 760]);
}

/// A non-uniform grid with the same small deviations must keep the original
/// conservative behavior (no regrid below the conflict threshold).
#[test]
fn keeps_nonuniform_grid_with_small_deviations() {
    let table_xml = r#"<w:tbl>
  <w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>
  <w:tblGrid><w:gridCol w:w="600"/><w:gridCol w:w="702"/></w:tblGrid>
  <w:tr>
    <w:tc><w:tcPr><w:tcW w:type="dxa" w:w="560"/></w:tcPr><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc>
    <w:tc><w:tcPr><w:tcW w:type="dxa" w:w="760"/></w:tcPr><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc>
  </w:tr>
</w:tbl>"#;
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
    let table = parse_table(table_xml, &context);
    let grid = table
        .style
        .as_ref()
        .and_then(|style| style.column_widths_twips.clone())
        .expect("grid");
    assert_eq!(grid, vec![600, 702]);
}
