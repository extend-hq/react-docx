use std::cell::RefCell;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use docx_core::parse::{empty_style_sheet, parse_table, ParseContext};
use docx_core::{build_doc_model, parse_docx};

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
        table.rows[0].cells[0].style.as_ref().and_then(|s| s.row_span),
        Some(3)
    );
}

/// 2F73J4NP2YHKVISKHDIDJ7RGPDKTQZ7D.doc page 2 is a borderless 20-row table
/// emulating a two-column page layout: placeholder 21x498 grid, real geometry
/// in per-cell tcW values, vmerged margin columns. Regrid must recover the
/// per-row boundaries and tcMar w:start/w:end margins must parse.
#[test]
fn regrids_2f73_two_column_layout_table() {
    let path = "/Users/andrewluo/Documents/DOC testing/2F73J4NP2YHKVISKHDIDJ7RGPDKTQZ7D.doc";
    if !Path::new(path).exists() {
        eprintln!("skipping: corpus file missing");
        return;
    }
    let bytes = fs::read(path).expect("read file");
    let model = build_doc_model(&parse_docx(&bytes).expect("parse"));
    let table = match &model.nodes[20] {
        docx_core::model::DocNode::Table(table) => table,
        _ => panic!("expected node 20 to be the layout table"),
    };
    let grid = table
        .style
        .as_ref()
        .and_then(|style| style.column_widths_twips.clone())
        .expect("grid");
    assert_eq!(grid.iter().sum::<i64>(), 9874);
    assert_eq!(&grid[..2], &[134, 1440]);

    // Row 0 cells must span to the document's real widths.
    let spanned_widths: Vec<i64> = {
        let mut cursor = 0usize;
        table.rows[0]
            .cells
            .iter()
            .map(|cell| {
                let span = cell
                    .style
                    .as_ref()
                    .and_then(|style| style.grid_span)
                    .unwrap_or(1)
                    .max(1) as usize;
                let width: i64 = grid.iter().skip(cursor).take(span).sum();
                cursor += span;
                width
            })
            .collect()
    };
    assert_eq!(spanned_widths, vec![134, 1440, 4240, 4060]);

    // tcMar uses w:start/w:end; the zero margins must reach the model.
    let margin = table.rows[5].cells[7]
        .style
        .as_ref()
        .and_then(|style| style.margin_twips.clone())
        .expect("cell margins");
    assert_eq!(margin.left_twips, Some(0));
    assert_eq!(margin.right_twips, Some(0));
}

/// Uniform placeholder grids (equal divisions of the table width) with
/// complete per-cell tcW must regrid even when every deviation is under the
/// 20% conflict threshold — small shifts still tear apart text fragments that
/// nested layout tables position (2ED27NR7CISW7J4PHXXBZ6OFPVDFHMFB.doc:
/// "Karen Cav"/"anaugh").
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

/// 2ED27NR7CISW7J4PHXXBZ6OFPVDFHMFB.doc: the "Karen Cavanaugh" fragments live
/// in a depth-2 nested table whose placeholder grid is [651,651]; the real
/// cell widths [560,760] must win or the name tears apart at the cell seam.
#[test]
fn regrids_2ed2_nested_karen_table() {
    let path = "/Users/andrewluo/Documents/DOC testing/2ED27NR7CISW7J4PHXXBZ6OFPVDFHMFB.doc";
    if !Path::new(path).exists() {
        eprintln!("skipping: corpus file missing");
        return;
    }
    let bytes = fs::read(path).expect("read file");
    let model = build_doc_model(&parse_docx(&bytes).expect("parse"));
    let outer = match &model.nodes[5] {
        docx_core::model::DocNode::Table(table) => table,
        _ => panic!("expected node 5 to be the Africa Region layout table"),
    };
    let giant_cell = &outer.rows[19].cells[0];
    let depth1 = giant_cell
        .nodes
        .iter()
        .find_map(|node| match node {
            docx_core::model::TableCellContentNode::Table(table) => Some(table),
            _ => None,
        })
        .expect("depth-1 nested table");
    assert_eq!(
        depth1.style.as_ref().and_then(|s| s.column_widths_twips.clone()),
        Some(vec![360, 1302, 990, 972, 994, 1300, 994, 930])
    );
    let karen_host_cell = &depth1.rows[0].cells[1];
    let depth2 = karen_host_cell
        .nodes
        .iter()
        .find_map(|node| match node {
            docx_core::model::TableCellContentNode::Table(table) => Some(table),
            _ => None,
        })
        .expect("depth-2 nested table");
    assert_eq!(
        depth2.style.as_ref().and_then(|s| s.column_widths_twips.clone()),
        Some(vec![560, 760])
    );
}
