use std::collections::HashSet;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use unicode_segmentation::UnicodeSegmentation;

use crate::model::*;
use crate::package::OoxmlPackage;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockType {
    Text,
    Heading,
    SectionHeading,
    Figure,
    Table,
    TableHead,
    TableCell,
    KeyValue,
    PageNumber,
    Barcode,
    Formula,
    Header,
    Footer,
    Watermark,
    Legend,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRef {
    pub document_id: String,
    pub node_id: String,
    pub part_name: String,
    pub story: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end: Option<usize>,
    pub offset_encoding: String,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractDocumentBlocksOptions {
    #[serde(default)]
    pub include_words: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentWord {
    pub object: String,
    pub id: String,
    pub block_id: String,
    pub content: String,
    pub source_refs: Vec<SourceRef>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ParagraphInline {
    Text {
        start: usize,
        end: usize,
        text: String,
        style: Option<SharedTextStyle>,
        link: Option<String>,
        #[serde(rename = "noteReference")]
        note_reference: Option<NoteReference>,
    },
    FormField {
        #[serde(rename = "blockId")]
        block_id: String,
        start: usize,
        end: usize,
        text: String,
    },
    Block {
        #[serde(rename = "blockId")]
        block_id: String,
        offset: usize,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphDetails {
    pub r#type: String,
    pub kind: String,
    pub style: Option<ParagraphStyle>,
    pub style_id: String,
    pub heading_level: Option<HeadingLevel>,
    pub numbering: Option<ParagraphNumbering>,
    pub field_instructions: Vec<String>,
    pub inlines: Vec<ParagraphInline>,
}

/// Eager semantic details with an unrestricted JSON representation for imported data.
#[derive(Clone, Debug, Serialize)]
#[serde(untagged)]
pub enum BlockDetails {
    Paragraph(Box<ParagraphDetails>),
    Raw(Value),
}

impl BlockDetails {
    pub fn to_json_value(&self) -> Value {
        match self {
            Self::Paragraph(details) => serde_json::to_value(details)
                .expect("paragraph details contain JSON-compatible values"),
            Self::Raw(value) => value.clone(),
        }
    }
}

impl PartialEq for BlockDetails {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Raw(left), Self::Raw(right)) => left == right,
            _ => self.to_json_value() == other.to_json_value(),
        }
    }
}

impl<'de> Deserialize<'de> for BlockDetails {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Value::deserialize(deserializer).map(Self::Raw)
    }
}

impl From<Value> for BlockDetails {
    fn from(value: Value) -> Self {
        Self::Raw(value)
    }
}

impl From<ParagraphDetails> for BlockDetails {
    fn from(details: ParagraphDetails) -> Self {
        Self::Paragraph(Box::new(details))
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentBlock {
    pub object: String,
    pub id: String,
    pub r#type: BlockType,
    pub content: String,
    pub details: BlockDetails,
    pub source_refs: Vec<SourceRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_block_id: Option<String>,
    pub children: Vec<DocumentBlock>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub words: Option<Vec<DocumentWord>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuredDocument {
    pub schema_version: u32,
    pub parser_version: String,
    pub document_id: String,
    pub blocks: Vec<DocumentBlock>,
    pub warnings: Vec<String>,
    pub geometry_status: String,
}

pub fn package_identity(package: &OoxmlPackage) -> String {
    let mut hash = Sha256::new();
    let mut parts: Vec<_> = package.parts.iter().collect();
    parts.sort_by_key(|(name, _)| *name);
    for (name, part) in parts {
        hash.update((name.len() as u64).to_le_bytes());
        hash.update(name.as_bytes());
        hash.update((part.content.len() as u64).to_le_bytes());
        hash.update(part.content.as_bytes());
    }
    let mut assets: Vec<_> = package.binary_assets.iter().collect();
    assets.sort_by_key(|(name, _)| *name);
    for (name, bytes) in assets {
        hash.update((name.len() as u64).to_le_bytes());
        hash.update(name.as_bytes());
        hash.update((bytes.len() as u64).to_le_bytes());
        hash.update(bytes);
    }
    format!("{:x}", hash.finalize())
}

fn image_url(image: &ImageRunNode) -> Option<String> {
    if let Some(src) = image.src.as_ref().filter(|src| !src.trim().is_empty()) {
        return Some(src.clone());
    }
    let data = image.data.as_deref().filter(|data| !data.is_empty())?;
    let content_type = image
        .content_type
        .as_deref()
        .filter(|content_type| !content_type.trim().is_empty())
        .unwrap_or("application/octet-stream");
    let capacity = 13usize
        .checked_add(content_type.len())?
        .checked_add(base64::encoded_len(data.len(), true)?)?;
    let mut url = String::with_capacity(capacity);
    url.push_str("data:");
    url.push_str(content_type);
    url.push_str(";base64,");
    base64::engine::general_purpose::STANDARD.encode_string(data, &mut url);
    Some(url)
}

fn source_part(model: &DocModel, kind: &str) -> String {
    model
        .metadata
        .source_part_names
        .as_ref()
        .and_then(|names| names.get(kind))
        .cloned()
        .unwrap_or_else(|| format!("word/{kind}.xml"))
}

pub fn assign_source_ids(model: &mut DocModel, document_id: &str) {
    fn paragraph(node: &mut ParagraphNode, id: String) {
        node.block_id = Some(id.clone());
        for (index, child) in node.children.iter_mut().enumerate() {
            if let ParagraphChildNode::Image(image) = child {
                let image_id = format!("{id}/child/{index}");
                image.block_id = Some(image_id.clone());
                if let Some(content) = &mut image.content_nodes {
                    nodes(content, &format!("{image_id}/content"));
                }
            }
        }
    }
    fn table(node: &mut TableNode, id: String) {
        node.block_id = Some(id.clone());
        for (ri, row) in node.rows.iter_mut().enumerate() {
            for (ci, cell) in row.cells.iter_mut().enumerate() {
                for (ni, child) in cell.nodes.iter_mut().enumerate() {
                    let id = format!("{id}/row/{ri}/cell/{ci}/{ni}");
                    match child {
                        TableCellContentNode::Paragraph(p) => paragraph(p, id),
                        TableCellContentNode::Table(t) => table(t, id),
                    }
                }
            }
        }
    }
    fn nodes(content: &mut [DocNode], root: &str) {
        for (index, node) in content.iter_mut().enumerate() {
            let id = format!("{root}/{index}");
            match node {
                DocNode::Paragraph(p) => paragraph(p, id),
                DocNode::Table(t) => table(t, id),
            }
        }
    }
    model.metadata.document_id = Some(document_id.to_string());
    let root = format!("docx:{document_id}");
    let main_part = source_part(model, "document");
    let footnote_part = source_part(model, "footnotes");
    let endnote_part = source_part(model, "endnotes");
    let comment_part = source_part(model, "comments");
    nodes(&mut model.nodes, &format!("{root}/{main_part}/body"));
    for header in &mut model.metadata.header_sections {
        nodes(&mut header.nodes, &format!("{root}/{}", header.part_name));
    }
    for footer in &mut model.metadata.footer_sections {
        nodes(&mut footer.nodes, &format!("{root}/{}", footer.part_name));
    }
    for section in model.metadata.sections.iter_mut().flatten() {
        for header in &mut section.header_sections {
            nodes(&mut header.nodes, &format!("{root}/{}", header.part_name));
        }
        for footer in &mut section.footer_sections {
            nodes(&mut footer.nodes, &format!("{root}/{}", footer.part_name));
        }
    }
    for (kind, part, notes) in [
        ("footnote", footnote_part, &mut model.metadata.footnotes),
        ("endnote", endnote_part, &mut model.metadata.endnotes),
    ] {
        for note in notes.iter_mut().flatten() {
            if let Some(content) = &mut note.nodes {
                nodes(content, &format!("{root}/{part}/{kind}/{}", note.id));
            }
        }
    }
    for comment in model.metadata.comments.iter_mut().flatten() {
        if let Some(content) = &mut comment.nodes {
            nodes(
                content,
                &format!("{root}/{comment_part}/comment/{}", comment.id),
            );
        }
    }
}

struct Extractor {
    document_id: String,
    part_name: String,
    story: String,
    include_words: bool,
}

impl Extractor {
    fn block(
        &self,
        id: String,
        kind: BlockType,
        content: String,
        details: impl Into<BlockDetails>,
        children: Vec<DocumentBlock>,
        parent: Option<&str>,
    ) -> DocumentBlock {
        DocumentBlock {
            object: "block".into(),
            id: id.clone(),
            r#type: kind,
            content,
            details: details.into(),
            source_refs: vec![SourceRef {
                document_id: self.document_id.clone(),
                node_id: id,
                part_name: self.part_name.clone(),
                story: self.story.clone(),
                start: None,
                end: None,
                offset_encoding: "utf-16".into(),
            }],
            parent_block_id: parent.map(str::to_string),
            children,
            words: None,
        }
    }

    fn words(&self, block_id: &str, content: &str) -> Vec<DocumentWord> {
        let mut offset = 0;
        content
            .split_word_bounds()
            .filter_map(|word| {
                let start = offset;
                offset += word.encode_utf16().count();
                if word.chars().all(char::is_whitespace) {
                    return None;
                }
                Some(DocumentWord {
                    object: "word".into(),
                    id: format!("{block_id}/word/{start}-{offset}"),
                    block_id: block_id.into(),
                    content: word.into(),
                    source_refs: vec![SourceRef {
                        document_id: self.document_id.clone(),
                        node_id: block_id.into(),
                        part_name: self.part_name.clone(),
                        story: self.story.clone(),
                        start: Some(start),
                        end: Some(offset),
                        offset_encoding: "utf-16".into(),
                    }],
                })
            })
            .collect()
    }

    fn story_block(&self, nodes: &[DocNode], kind: BlockType) -> DocumentBlock {
        let id = format!("docx:{}/{}/story", self.document_id, self.part_name);
        let children = self.nodes(nodes, Some(&id));
        let content = children
            .iter()
            .map(|b| b.content.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        let refs = children
            .iter()
            .flat_map(|b| b.source_refs.clone())
            .collect();
        let mut block = self.block(id, kind, content, json!({"kind":"story"}), children, None);
        block.source_refs = refs;
        block
    }

    fn nodes(&self, nodes: &[DocNode], parent: Option<&str>) -> Vec<DocumentBlock> {
        nodes
            .iter()
            .enumerate()
            .map(|(index, node)| {
                let fallback = format!("{}/{}", parent.unwrap_or("document"), index);
                match node {
                    DocNode::Paragraph(p) => self.paragraph(p, &fallback, parent),
                    DocNode::Table(t) => self.table(t, &fallback, parent),
                }
            })
            .collect()
    }

    fn paragraph(&self, p: &ParagraphNode, fallback: &str, parent: Option<&str>) -> DocumentBlock {
        let id = p.block_id.as_deref().unwrap_or(fallback);
        let style = p.style.as_ref();
        let style_id = style.and_then(|s| s.style_id.as_deref()).unwrap_or("");
        let field_instructions = p
            .source_xml
            .as_deref()
            .map(|xml| {
                crate::xml::extract_balanced_tag_blocks(xml, "w:instrText")
                    .iter()
                    .map(|field| {
                        field
                            .split_once('>')
                            .map(|(_, value)| {
                                crate::xml::decode_xml_entities(
                                    value.split("</").next().unwrap_or(""),
                                )
                            })
                            .unwrap_or_default()
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let joined_instructions = field_instructions.join("").to_uppercase();
        let instruction_kind = joined_instructions.split_whitespace().next().unwrap_or("");
        let kind = if matches!(instruction_kind, "PAGE" | "NUMPAGES" | "SECTIONPAGES") {
            BlockType::PageNumber
        } else if matches!(instruction_kind, "DISPLAYBARCODE" | "MERGEBARCODE") {
            BlockType::Barcode
        } else if style.and_then(|s| s.heading_level).is_some() {
            BlockType::Heading
        } else if style_id.eq_ignore_ascii_case("title")
            || style_id.eq_ignore_ascii_case("subtitle")
        {
            BlockType::SectionHeading
        } else if style_id.eq_ignore_ascii_case("caption") {
            BlockType::Legend
        } else {
            BlockType::Text
        };
        let mut content = String::new();
        let mut inline = Vec::with_capacity(p.children.len());
        let mut children = Vec::new();
        let mut text_offset = 0;
        for (index, child) in p.children.iter().enumerate() {
            match child {
                ParagraphChildNode::Text(run) => {
                    let start = text_offset;
                    text_offset += run.text.encode_utf16().count();
                    content.push_str(&run.text);
                    inline.push(ParagraphInline::Text {
                        start,
                        end: text_offset,
                        text: run.text.clone(),
                        style: run.style.clone(),
                        link: run.link.clone(),
                        note_reference: run.note_reference.clone(),
                    });
                }
                ParagraphChildNode::FormField(field) => {
                    let child_id = format!("{id}/child/{index}");
                    let value = field.value.clone().unwrap_or_else(|| {
                        field
                            .checked
                            .map(|checked| if checked { "☒" } else { "☐" }.to_string())
                            .unwrap_or_default()
                    });
                    let start = text_offset;
                    text_offset += value.encode_utf16().count();
                    content.push_str(&value);
                    inline.push(ParagraphInline::FormField {
                        block_id: child_id.clone(),
                        start,
                        end: text_offset,
                        text: value.clone(),
                    });
                    children.push(self.block(
                        child_id,
                        BlockType::KeyValue,
                        value,
                        json!({"type":"key_value_details", "kind":"form_field", "field":field}),
                        Vec::new(),
                        Some(id),
                    ));
                }
                ParagraphChildNode::Image(image) => {
                    let child_id = format!("{id}/child/{index}");
                    let kind = match image.semantic_kind.as_deref() {
                        Some("formula") => BlockType::Formula,
                        Some("watermark") => BlockType::Watermark,
                        Some("barcode") => BlockType::Barcode,
                        _ => BlockType::Figure,
                    };
                    let image_id = image.block_id.as_deref().unwrap_or(&child_id);
                    inline.push(ParagraphInline::Block {
                        block_id: image_id.to_owned(),
                        offset: text_offset,
                    });
                    let nested = image
                        .content_nodes
                        .as_ref()
                        .map(|nodes| self.nodes(nodes, Some(image_id)))
                        .unwrap_or_default();
                    let text = if nested.is_empty() {
                        image
                            .text_box_text
                            .clone()
                            .or_else(|| image.alt.clone())
                            .unwrap_or_default()
                    } else {
                        nested
                            .iter()
                            .map(|b| b.content.as_str())
                            .collect::<Vec<_>>()
                            .join("\n")
                    };
                    let mut details = json!({"kind":image.semantic_kind.as_deref().unwrap_or(if image.synthetic_text_box == Some(true) {"text_box"} else {"image"}), "mathMl":image.math_ml, "asset":image.part_name, "alt":image.alt, "contentType":image.content_type, "width":image.width_px, "height":image.height_px, "floating":image.floating});
                    if let Some(url) = image_url(image) {
                        details
                            .as_object_mut()
                            .unwrap()
                            .insert("imageUrl".into(), Value::String(url));
                    }
                    children.push(self.block(
                        image_id.to_string(),
                        kind,
                        text,
                        details,
                        nested,
                        Some(id),
                    ));
                }
            }
        }
        let details = ParagraphDetails {
            r#type: "text_details".into(),
            kind: "paragraph".into(),
            style: p.style.clone(),
            style_id: style_id.into(),
            heading_level: style.and_then(|s| s.heading_level),
            numbering: style.and_then(|s| s.numbering.clone()),
            field_instructions,
            inlines: inline,
        };
        let mut block = self.block(id.to_string(), kind, content, details, children, parent);
        if self.include_words {
            block.words = Some(self.words(id, &block.content));
        }
        block
    }

    fn table(&self, table: &TableNode, fallback: &str, parent: Option<&str>) -> DocumentBlock {
        let id = table.block_id.as_deref().unwrap_or(fallback);
        let mut children = Vec::new();
        let mut row_text = Vec::new();
        let mut column_count = 0;
        for (ri, row) in table.rows.iter().enumerate() {
            let row_id = format!("{id}/row/{ri}");
            let is_header = row
                .style
                .as_ref()
                .and_then(|s| s.is_header)
                .unwrap_or(false);
            let mut cells = Vec::new();
            let mut cell_text = Vec::new();
            let mut column_index = row.style.as_ref().and_then(|s| s.grid_before).unwrap_or(0);
            for (ci, cell) in row.cells.iter().enumerate() {
                let cell_id = format!("{row_id}/cell/{ci}");
                let content = cell
                    .nodes
                    .iter()
                    .enumerate()
                    .map(|(ni, node)| match node {
                        TableCellContentNode::Paragraph(p) => {
                            self.paragraph(p, &format!("{cell_id}/{ni}"), Some(&cell_id))
                        }
                        TableCellContentNode::Table(t) => {
                            self.table(t, &format!("{cell_id}/{ni}"), Some(&cell_id))
                        }
                    })
                    .collect::<Vec<_>>();
                let text = content
                    .iter()
                    .map(|b| b.content.as_str())
                    .collect::<Vec<_>>()
                    .join("\n");
                cell_text.push(text.clone());
                cells.push(self.block(cell_id, BlockType::TableCell, text, json!({"type":"table_cell_details", "rowIndex":ri, "columnIndex":column_index, "cellIndex":ci, "columnSpan":cell.style.as_ref().and_then(|s|s.grid_span).unwrap_or(1), "rowSpan":cell.style.as_ref().and_then(|s|s.row_span).unwrap_or(1), "isHeader":is_header, "style":cell.style}), content, Some(if is_header { &row_id } else { id })));
                column_index += cell
                    .style
                    .as_ref()
                    .and_then(|s| s.grid_span)
                    .unwrap_or(1)
                    .max(1);
            }
            column_count = column_count.max(column_index);
            let text = cell_text.join("\t");
            row_text.push(text.clone());
            if is_header {
                children.push(self.block(
                    row_id,
                    BlockType::TableHead,
                    text,
                    json!({"rowIndex":ri}),
                    cells,
                    Some(id),
                ));
            } else {
                children.extend(cells);
            }
        }
        self.block(
            id.to_string(),
            BlockType::Table,
            row_text.join("\n"),
            json!({"type":"table_details", "rowCount":table.rows.len(), "columnCount":column_count}),
            children,
            parent,
        )
    }
}

fn without_empty_blocks(blocks: Vec<DocumentBlock>, parent: Option<&str>) -> Vec<DocumentBlock> {
    blocks
        .into_iter()
        .flat_map(|mut block| {
            block.children = without_empty_blocks(block.children, Some(&block.id));
            block.parent_block_id = parent.map(str::to_string);
            let has_text = block
                .content
                .chars()
                .any(|c| !c.is_whitespace() && !matches!(c, '\u{200b}' | '\u{feff}' | '\u{00ad}'));
            let has_object = matches!(
                block.r#type,
                BlockType::Figure
                    | BlockType::Formula
                    | BlockType::Barcode
                    | BlockType::Watermark
                    | BlockType::KeyValue
            );
            if !has_text && !has_object {
                if matches!(block.r#type, BlockType::Text) {
                    for child in &mut block.children {
                        child.parent_block_id = parent.map(str::to_string);
                    }
                    return block.children;
                }
                if block.children.is_empty() {
                    return Vec::new();
                }
            }
            vec![block]
        })
        .collect()
}

pub fn extract_document_blocks(model: &DocModel) -> StructuredDocument {
    extract_document_blocks_with_options(model, ExtractDocumentBlocksOptions::default())
}

pub fn extract_document_blocks_with_options(
    model: &DocModel,
    options: ExtractDocumentBlocksOptions,
) -> StructuredDocument {
    let document_id = model
        .metadata
        .document_id
        .clone()
        .unwrap_or_else(|| "unsaved".into());
    let mut extractor = Extractor {
        document_id: document_id.clone(),
        part_name: source_part(model, "document"),
        story: "body".into(),
        include_words: options.include_words,
    };
    let mut blocks = extractor.nodes(&model.nodes, None);
    let mut seen = HashSet::new();
    let headers = model.metadata.header_sections.iter().chain(
        model
            .metadata
            .sections
            .iter()
            .flatten()
            .flat_map(|s| s.header_sections.iter()),
    );
    for header in headers {
        if !seen.insert(header.part_name.clone()) {
            continue;
        }
        extractor.part_name = header.part_name.clone();
        extractor.story = "header".into();
        blocks.push(extractor.story_block(&header.nodes, BlockType::Header));
    }
    let footers = model.metadata.footer_sections.iter().chain(
        model
            .metadata
            .sections
            .iter()
            .flatten()
            .flat_map(|s| s.footer_sections.iter()),
    );
    for footer in footers {
        if !seen.insert(footer.part_name.clone()) {
            continue;
        }
        extractor.part_name = footer.part_name.clone();
        extractor.story = "footer".into();
        blocks.push(extractor.story_block(&footer.nodes, BlockType::Footer));
    }
    for (kind, notes) in [
        ("footnote", &model.metadata.footnotes),
        ("endnote", &model.metadata.endnotes),
    ] {
        extractor.part_name = source_part(model, &format!("{kind}s"));
        extractor.story = kind.into();
        for note in notes.iter().flatten() {
            if let Some(nodes) = &note.nodes {
                blocks.extend(extractor.nodes(nodes, None));
            }
        }
    }
    extractor.part_name = source_part(model, "comments");
    extractor.story = "comment".into();
    for comment in model.metadata.comments.iter().flatten() {
        if let Some(nodes) = &comment.nodes {
            blocks.extend(extractor.nodes(nodes, None));
        }
    }
    StructuredDocument {
        schema_version: 1,
        parser_version: env!("CARGO_PKG_VERSION").into(),
        document_id,
        blocks: without_empty_blocks(blocks, None),
        warnings: model.metadata.warnings.clone(),
        geometry_status: "requires_layout".into(),
    }
}
