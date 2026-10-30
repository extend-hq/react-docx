use crate::model::{
    DocModel, DocNode, ParagraphChildNode, ParagraphNode, TableCellContentNode, TableLayout,
    TableNode,
};

struct PhysicalGrid {
    widths: Vec<i64>,
    spans: Vec<i64>,
}

fn physical_grid(table: &TableNode) -> Result<Option<PhysicalGrid>, String> {
    let Some(style) = table.style.as_ref() else {
        return Ok(None);
    };
    let Some(collapsed) = style.collapsed_grid_columns.as_ref() else {
        return Ok(None);
    };
    if collapsed.is_empty() {
        return Ok(None);
    }
    if style.layout != Some(TableLayout::Fixed) || style.cell_spacing_twips.unwrap_or(0) != 0 {
        return Err("Collapsed columns require fixed layout without cell spacing".into());
    }
    let widths = style
        .column_widths_twips
        .as_ref()
        .ok_or("Collapsed columns require a logical grid")?;
    let mut marked = vec![false; widths.len()];
    for &column in collapsed {
        if column >= widths.len() || marked[column] || widths[column] != 0 {
            return Err("Collapsed column indices must be unique zero-width grid entries".into());
        }
        marked[column] = true;
    }
    let mut boundaries = Vec::with_capacity(widths.len() + 1);
    let mut physical_widths = Vec::with_capacity(widths.len() - collapsed.len());
    boundaries.push(0usize);
    for (column, &width) in widths.iter().enumerate() {
        if !marked[column] {
            if width <= 0 {
                return Err("Unmarked physical columns must have positive widths".into());
            }
            physical_widths.push(width);
        }
        boundaries.push(physical_widths.len());
    }
    if physical_widths.is_empty() {
        return Err("Collapsed grid has no physical columns".into());
    }
    let mut spans = Vec::new();
    for row in &table.rows {
        if row.style.as_ref().is_some_and(|value| {
            value.grid_before.unwrap_or(0) != 0 || value.grid_after.unwrap_or(0) != 0
        }) {
            return Err("Collapsed columns do not support omitted row columns".into());
        }
        let mut cursor = 0usize;
        for cell in &row.cells {
            let span = cell
                .style
                .as_ref()
                .and_then(|value| value.grid_span)
                .unwrap_or(1);
            if span < 1 {
                return Err("Cell spans must be positive".into());
            }
            let span = usize::try_from(span).map_err(|_| "Cell span exceeds the logical grid")?;
            let end = cursor
                .checked_add(span)
                .ok_or("Cell span exceeds the logical grid")?;
            if end >= boundaries.len() {
                return Err("Cell span exceeds the logical grid".into());
            }
            let physical_span = boundaries[end] - boundaries[cursor];
            if physical_span == 0 {
                return Err("Cell occupies only collapsed columns".into());
            }
            spans.push(physical_span as i64);
            cursor = end;
        }
    }
    Ok(Some(PhysicalGrid {
        widths: physical_widths,
        spans,
    }))
}

/// Materialize a validated physical grid before committing a structural edit.
pub fn materialize_collapsed_table_grid(table: &TableNode) -> Result<Option<TableNode>, String> {
    let Some(physical) = physical_grid(table)? else {
        return Ok(None);
    };
    let mut result = table.clone();
    let result_style = result.style.as_mut().expect("Style checked before cloning");
    result_style.column_widths_twips = Some(physical.widths);
    result_style.collapsed_grid_columns = None;
    let mut spans = physical.spans.into_iter();
    for row in &mut result.rows {
        for cell in &mut row.cells {
            let span = spans.next().expect("Every cell span was validated");
            if let Some(style) = cell.style.as_mut() {
                style.grid_span = (span > 1).then_some(span);
            } else if span > 1 {
                return Err("A spanning cell is missing its style".into());
            }
        }
    }
    result.source_xml = None;
    result.source_text_patches = None;
    Ok(Some(result))
}

fn validate_table(table: &TableNode) -> Result<(), String> {
    if physical_grid(table)?.is_some() {
        let style = table.style.as_ref().expect("Validated table has a style");
        if style.style_id != style.source_style_id {
            return Err(
                "Collapsed table grid must be materialized before changing table style".into(),
            );
        }
        if style.borders.as_ref().is_some_and(|borders| {
            [
                &borders.top,
                &borders.right,
                &borders.bottom,
                &borders.left,
                &borders.inside_h,
                &borders.inside_v,
                &borders.tl2br,
                &borders.tr2bl,
            ]
            .into_iter()
            .flatten()
            .any(|border| border.border_type != "none" && border.border_type != "nil")
        }) {
            return Err("Collapsed table grid requires zero border spacing before export".into());
        }
    }
    for row in &table.rows {
        for cell in &row.cells {
            for node in &cell.nodes {
                match node {
                    TableCellContentNode::Table(table) => validate_table(table)?,
                    TableCellContentNode::Paragraph(paragraph) => validate_paragraph(paragraph)?,
                }
            }
        }
    }
    if let Some(patches) = &table.source_text_patches {
        for patch in patches {
            validate_paragraph(&patch.paragraph)?;
        }
    }
    Ok(())
}

fn validate_paragraph(paragraph: &ParagraphNode) -> Result<(), String> {
    for child in &paragraph.children {
        if let ParagraphChildNode::Image(image) = child {
            if let Some(nodes) = &image.content_nodes {
                validate_nodes(nodes)?;
            }
        }
    }
    Ok(())
}

fn validate_nodes(nodes: &[DocNode]) -> Result<(), String> {
    for node in nodes {
        match node {
            DocNode::Table(table) => validate_table(table)?,
            DocNode::Paragraph(paragraph) => validate_paragraph(paragraph)?,
        }
    }
    Ok(())
}

/// Reject unsupported marked grids before a fallible serialization entry point.
pub fn validate_collapsed_table_grids(model: &DocModel) -> Result<(), String> {
    validate_nodes(&model.nodes)?;
    for header in &model.metadata.header_sections {
        validate_nodes(&header.nodes)?;
    }
    for footer in &model.metadata.footer_sections {
        validate_nodes(&footer.nodes)?;
    }
    if let Some(sections) = &model.metadata.sections {
        for section in sections {
            for header in &section.header_sections {
                validate_nodes(&header.nodes)?;
            }
            for footer in &section.footer_sections {
                validate_nodes(&footer.nodes)?;
            }
        }
    }
    for notes in [&model.metadata.footnotes, &model.metadata.endnotes]
        .into_iter()
        .flatten()
    {
        for note in notes {
            if let Some(nodes) = &note.nodes {
                validate_nodes(nodes)?;
            }
        }
    }
    if let Some(comments) = &model.metadata.comments {
        for comment in comments {
            if let Some(nodes) = &comment.nodes {
                validate_nodes(nodes)?;
            }
        }
    }
    Ok(())
}
