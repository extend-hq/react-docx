use docx_core::*;
use serde_json::{json, Value};

fn paragraph(p: &ParagraphNode) -> Value {
    let children: Vec<_> = p.children.iter().map(|child| match child {
        ParagraphChildNode::Text(text) => json!({"type":"text", "text":text.text,
            "style":{"bold":text.style.as_ref().and_then(|s|s.bold),"italic":text.style.as_ref().and_then(|s|s.italic)}, "link":text.link}),
        ParagraphChildNode::FormField(field) => json!({"type":"form-field", "fieldType":field.field_type,
            "sourceKind":field.source_kind, "value":field.value,
            "checked":field.checked, "checkedSymbol":field.checked_symbol, "uncheckedSymbol":field.unchecked_symbol,
            "style":{"bold":field.style.as_ref().and_then(|s|s.bold),"italic":field.style.as_ref().and_then(|s|s.italic)}, "link":field.link}),
        ParagraphChildNode::Image(image) => json!({"type":"image", "mathMl":image.math_ml,
            "contentNodes":image.content_nodes.as_deref().map(nodes), "syntheticTextBox":image.synthetic_text_box,
            "textBoxText":image.text_box_text, "partName":image.part_name,
            "src":if image.src.as_ref().is_some_and(|s|!s.is_empty()) || image.data.as_ref().is_some_and(|d|!d.is_empty()) {Some("[present]")} else {None}}),
    }).collect();
    json!({"type":"paragraph", "children":children,
        "style":{"headingLevel":p.style.as_ref().and_then(|s|s.heading_level),"numbering":p.style.as_ref().and_then(|s|s.numbering.as_ref())}})
}

fn table(t: &TableNode) -> Value {
    let rows: Vec<_> = t.rows.iter().map(|row| {
        let cells: Vec<_> = row.cells.iter().map(|cell| {
            let content: Vec<_> = cell.nodes.iter().map(|node| match node {
                TableCellContentNode::Paragraph(p) => paragraph(p),
                TableCellContentNode::Table(t) => table(t),
            }).collect();
            json!({"nodes":content,"style":{"gridSpan":cell.style.as_ref().and_then(|s|s.grid_span),
                "rowSpan":cell.style.as_ref().and_then(|s|s.row_span)}})
        }).collect();
        json!({"cells":cells})
    }).collect();
    json!({"type":"table","rows":rows})
}

fn nodes(items: &[DocNode]) -> Vec<Value> {
    items.iter().map(|node| match node {
        DocNode::Paragraph(p) => paragraph(p),
        DocNode::Table(t) => table(t),
    }).collect()
}

pub fn model(model: &DocModel) -> Value {
    let meta = &model.metadata;
    let headers = |items: &[HeaderSection]| items.iter().map(|s|json!({"partName":s.part_name,"nodes":nodes(&s.nodes)})).collect::<Vec<_>>();
    let footers = |items: &[FooterSection]| items.iter().map(|s|json!({"partName":s.part_name,"nodes":nodes(&s.nodes)})).collect::<Vec<_>>();
    let notes = |items: &Option<Vec<DocumentNoteDefinition>>| items.iter().flatten().map(|n|json!({"nodes":n.nodes.as_deref().map(nodes)})).collect::<Vec<_>>();
    let sections: Vec<_> = meta.sections.iter().flatten().map(|s|json!({"headerSections":headers(&s.header_sections),"footerSections":footers(&s.footer_sections)})).collect();
    let comments: Vec<_> = meta.comments.iter().flatten().map(|c|json!({"nodes":c.nodes.as_deref().map(nodes)})).collect();
    let mut result = json!({"nodes":nodes(&model.nodes),"metadata":{"headerSections":headers(&meta.header_sections),
        "footerSections":footers(&meta.footer_sections),"sections":sections,
        "footnotes":notes(&meta.footnotes),"endnotes":notes(&meta.endnotes),"comments":comments}});
    fn omit_nulls(value: &mut Value) {
        match value {
            Value::Object(map) => { map.retain(|_, value| !value.is_null()); for value in map.values_mut() { omit_nulls(value); } }
            Value::Array(items) => { for value in items { omit_nulls(value); } }
            _ => {}
        }
    }
    omit_nulls(&mut result);
    result
}

pub fn blocks(document: &StructuredDocument) -> Value {
    fn block(item: &DocumentBlock) -> Value {
        let mut details = json!({"kind":item.details.get("kind")});
        if item.details.get("inlines").is_some() { details["inlines"] = json!([]); }
        let keep_content = item.details.get("inlines").is_some()
            || (item.details.get("kind").and_then(Value::as_str) == Some("text_box") && item.children.is_empty());
        let children: Vec<_> = item.children.iter().map(block).collect();
        json!({"id":item.id,"type":item.r#type,"details":details,"content":if keep_content {item.content.as_str()} else {""},
            "sourceRefs":item.source_refs,"children":children})
    }
    let items: Vec<_> = document.blocks.iter().map(block).collect();
    json!({"documentId":document.document_id,"blocks":items})
}
