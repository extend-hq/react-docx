use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use unicode_segmentation::UnicodeSegmentation;

use crate::model::*;
use crate::package::OoxmlPackage;
use crate::revisions::{ReviewedDocument, RevisionCollector};

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

struct FormFieldSemanticDetails<'a>(&'a FormFieldRunNode);

impl Serialize for FormFieldSemanticDetails<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeMap;
        let field = self.0;
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("type", &field.r#type)?;
        map.serialize_entry("fieldType", &field.field_type)?;
        macro_rules! optional {
            ($name:literal, $value:expr) => {
                if let Some(value) = $value.as_ref() {
                    map.serialize_entry($name, value)?;
                }
            };
        }
        optional!("sourceKind", field.source_kind);
        optional!("id", field.id);
        optional!("tag", field.tag);
        optional!("title", field.title);
        optional!("placeholder", field.placeholder);
        optional!("checked", field.checked);
        optional!("value", field.value);
        optional!("options", field.options);
        optional!("widget", field.widget);
        optional!("checkedSymbol", field.checked_symbol);
        optional!("uncheckedSymbol", field.unchecked_symbol);
        optional!("style", field.style);
        optional!("link", field.link);
        optional!("sourceXml", field.source_xml);
        map.end()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphDetails {
    pub r#type: String,
    pub kind: String,
    pub style: Option<SharedParagraphStyle>,
    pub style_id: String,
    pub heading_level: Option<HeadingLevel>,
    pub numbering: Option<ParagraphNumbering>,
    pub field_instructions: Vec<String>,
    pub inlines: Vec<ParagraphInline>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableCellDetails {
    pub r#type: String,
    pub row_index: usize,
    pub column_index: i64,
    pub cell_index: usize,
    pub column_span: i64,
    pub row_span: i64,
    pub is_header: bool,
    pub style: Option<TableCellStyle>,
}

/// Eager semantic details with an unrestricted JSON representation for imported data.
#[derive(Clone, Debug, Serialize)]
#[serde(untagged)]
pub enum BlockDetails {
    Paragraph(Box<ParagraphDetails>),
    TableCell(Box<TableCellDetails>),
    Raw(Value),
}

impl BlockDetails {
    pub fn to_json_value(&self) -> Value {
        match self {
            Self::Paragraph(details) => serde_json::to_value(details)
                .expect("paragraph details contain JSON-compatible values"),
            Self::TableCell(details) => serde_json::to_value(details)
                .expect("table cell details contain JSON-compatible values"),
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

impl From<TableCellDetails> for BlockDetails {
    fn from(details: TableCellDetails) -> Self {
        Self::TableCell(Box::new(details))
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
    crate::parse::append_base64(data, &mut url);
    Some(url)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImagePresentation {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
    aspect_ratio: f64,
    opacity: f64,
}

fn presented_image_url(image: &ImageRunNode, source: &str) -> Option<(String, ImagePresentation)> {
    let opacity = image
        .css_opacity
        .filter(|v| v.is_finite())
        .unwrap_or(1.0)
        .clamp(0.0, 1.0);
    if image.crop.is_none() && opacity == 1.0 {
        return None;
    }
    let mut width = image.width_px.filter(|v| v.is_finite() && *v > 0.0)?;
    let mut height = image.height_px.filter(|v| v.is_finite() && *v > 0.0)?;
    let mut image_width = width;
    let mut image_height = height;
    let mut x = 0.0;
    let mut y = 0.0;
    if let Some(crop) = &image.crop {
        let edge = |v: Option<f64>| v.unwrap_or(0.0).clamp(0.0, 1.0);
        let left = edge(crop.left_fraction);
        let top = edge(crop.top_fraction);
        let across = 1.0 - left - edge(crop.right_fraction);
        let down = 1.0 - top - edge(crop.bottom_fraction);
        if across > 0.0 && down > 0.0 && (across < 1.0 || down < 1.0) {
            // Cropping snaps the frame, scaled image, and offsets to whole CSS pixels in that order.
            width = width.round().max(1.0);
            height = height.round().max(1.0);
            image_width = (width / across).round().max(1.0);
            image_height = (height / down).round().max(1.0);
            x = -(image_width * left).round();
            y = -(image_height * top).round();
        }
    }
    if (width == image_width && height == image_height && opacity == 1.0)
        || !image_width.is_finite()
        || !image_height.is_finite()
    {
        return None;
    }
    let (header, _) = source.split_once(',')?;
    let mime = header.split(';').next()?.strip_prefix("data:image/")?;
    if !matches!(mime, "png" | "jpeg" | "gif" | "webp" | "bmp" | "svg+xml") {
        return None;
    }
    let source = crate::parse::escape_xml_text(source);
    let presentation = ImagePresentation {
        left: -x / image_width,
        top: -y / image_height,
        right: ((-x + width) / image_width).min(1.0),
        bottom: ((-y + height) / image_height).min(1.0),
        aspect_ratio: width / height,
        opacity,
    };
    if !presentation.aspect_ratio.is_finite() {
        return None;
    }
    let svg = crate::parse::svg_data_uri(&format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{width}" height="{height}" viewBox="0 0 {width} {height}"><image x="{x}" y="{y}" width="{image_width}" height="{image_height}" preserveAspectRatio="none" opacity="{opacity}" xlink:href="{source}"/></svg>"#
    ));
    Some((svg, presentation))
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

fn indexed_path<const N: usize>(prefix: &str, components: [(&str, usize); N]) -> String {
    let mut buffers: [itoa::Buffer; N] = std::array::from_fn(|_| itoa::Buffer::new());
    let mut numbers = [""; N];
    let mut capacity = prefix.len();
    for ((buffer, (separator, number)), rendered) in buffers.iter_mut().zip(components).zip(numbers.iter_mut()) {
        *rendered = buffer.format(number);
        capacity += separator.len() + rendered.len();
    }
    let mut result = String::with_capacity(capacity);
    result.push_str(prefix);
    for ((separator, _), number) in components.into_iter().zip(numbers) {
        result.push_str(separator);
        result.push_str(number);
    }
    result
}

pub fn assign_source_ids(model: &mut DocModel, document_id: &str) {
    fn paragraph(node: &mut ParagraphNode, id: String) {
        for (index, child) in node.children.iter_mut().enumerate() {
            if let ParagraphChildNode::Image(image) = child {
                let image_id = indexed_path(&id, [("/child/", index)]);
                if let Some(content) = &mut image.content_nodes {
                    nodes(content, &format!("{image_id}/content"));
                }
                image.block_id = Some(image_id);
            }
        }
        node.block_id = Some(id);
    }
    fn table(node: &mut TableNode, id: String) {
        for (ri, row) in node.rows.iter_mut().enumerate() {
            for (ci, cell) in row.cells.iter_mut().enumerate() {
                for (ni, child) in cell.nodes.iter_mut().enumerate() {
                    let id = indexed_path(&id, [("/row/", ri), ("/cell/", ci), ("/", ni)]);
                    match child {
                        TableCellContentNode::Paragraph(p) => paragraph(p, id),
                        TableCellContentNode::Table(t) => table(t, id),
                    }
                }
            }
        }
        node.block_id = Some(id);
    }
    fn nodes(content: &mut [DocNode], root: &str) {
        for (index, node) in content.iter_mut().enumerate() {
            let id = indexed_path(root, [("/", index)]);
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

fn joined_block_content(blocks: &[DocumentBlock], separator: &str) -> String {
    let capacity = blocks.iter().map(|block| block.content.len()).sum::<usize>()
        + separator.len() * blocks.len().saturating_sub(1);
    let mut content = String::with_capacity(capacity);
    for (index, block) in blocks.iter().enumerate() {
        if index > 0 {
            content.push_str(separator);
        }
        content.push_str(&block.content);
    }
    content
}

fn paragraph_field_instructions(xml: &str) -> Vec<String> {
    if crate::xml::find_ignore_ascii_case(xml, 0, "<w:instrText").is_none() {
        return Vec::new();
    }
    crate::xml::extract_balanced_tag_ranges(xml, "w:instrText")
        .into_iter()
        .map(|range| {
            xml[range.start..range.end]
                .split_once('>')
                .map(|(_, value)| {
                    crate::xml::decode_xml_entities(value.split("</").next().unwrap_or(""))
                })
                .unwrap_or_default()
        })
        .collect()
}

struct Extractor {
    document_id: String,
    part_name: String,
    story: String,
    include_words: bool,
    review: Option<RevisionCollector>,
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
                    id: indexed_path(block_id, [("/word/", start), ("-", offset)]),
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

    fn story_block(&mut self, nodes: &[DocNode], kind: BlockType) -> DocumentBlock {
        let id = format!("docx:{}/{}/story", self.document_id, self.part_name);
        let children = self.story_nodes(nodes, Some(&id));
        let content = joined_block_content(&children, "\n");
        let refs = children
            .iter()
            .flat_map(|b| b.source_refs.clone())
            .collect();
        let mut block = self.block(id, kind, content, json!({"kind":"story"}), children, None);
        block.source_refs = refs;
        block
    }

    fn story_nodes(&mut self, nodes: &[DocNode], parent: Option<&str>) -> Vec<DocumentBlock> {
        let moves = self.review.as_mut().map(|r| std::mem::take(&mut r.moves));
        let blocks = self.nodes(nodes, parent);
        if let (Some(review), Some(moves)) = (&mut self.review, moves) {
            review.moves = moves;
        }
        blocks
    }

    fn nodes(&mut self, nodes: &[DocNode], parent: Option<&str>) -> Vec<DocumentBlock> {
        nodes
            .iter()
            .enumerate()
            .map(|(index, node)| {
                let fallback = indexed_path(parent.unwrap_or("document"), [("/", index)]);
                match node {
                    DocNode::Paragraph(p) => self.paragraph(p, &fallback, parent),
                    DocNode::Table(t) => self.table(t, &fallback, parent),
                }
            })
            .collect()
    }

    fn paragraph(&mut self, p: &ParagraphNode, fallback: &str, parent: Option<&str>) -> DocumentBlock {
        let id = p.block_id.as_deref().unwrap_or(fallback);
        let style = p.style.as_ref();
        let style_id = style.and_then(|s| s.style_id.as_deref()).unwrap_or("");
        let field_instructions = p
            .source_xml
            .as_deref()
            .map(paragraph_field_instructions)
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
                    let child_id = indexed_path(&id, [("/child/", index)]);
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
                    let details = if field.source_preview.is_some() {
                        json!({"type":"key_value_details", "kind":"form_field", "field":FormFieldSemanticDetails(field)})
                    } else {
                        json!({"type":"key_value_details", "kind":"form_field", "field":field})
                    };
                    children.push(self.block(
                        child_id,
                        BlockType::KeyValue,
                        value,
                        details,
                        Vec::new(),
                        Some(id),
                    ));
                }
                ParagraphChildNode::Image(image) => {
                    let child_id = indexed_path(&id, [("/child/", index)]);
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
                        .map(|nodes| self.story_nodes(nodes, Some(image_id)))
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
                    if let Some(part_name) = &image.chart_part_name {
                        details["chartPartName"] = json!(part_name);
                    }
                    if let Some(paint_bounds) = image.paint_bounds.as_ref() {
                        details
                            .as_object_mut()
                            .unwrap()
                            .insert("paintBounds".into(), json!(paint_bounds));
                    }
                    if let Some(url) = image_url(image) {
                        if let Some((rendered, presentation)) = presented_image_url(image, &url) {
                            details["sourceImageUrl"] = Value::String(url);
                            details["imageUrl"] = Value::String(rendered);
                            details["imagePresentation"] = json!(presentation);
                            details["contentType"] = json!("image/svg+xml");
                        } else {
                            details["imageUrl"] = Value::String(url);
                        }
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
        if let (Some(review), Some(xml)) = (&mut self.review, &p.source_xml) {
            review.paragraph(xml, &block);
        }
        if self.include_words {
            block.words = Some(self.words(id, &block.content));
        }
        block
    }

    fn table(&mut self, table: &TableNode, fallback: &str, parent: Option<&str>) -> DocumentBlock {
        let id = table.block_id.as_deref().unwrap_or(fallback);
        if let (Some(review), Some(xml)) = (&mut self.review, &table.source_xml) {
            let source = SourceRef {
                document_id: self.document_id.clone(),
                node_id: id.to_owned(),
                part_name: self.part_name.clone(),
                story: self.story.clone(),
                start: None,
                end: None,
                offset_encoding: "utf-16".into(),
            };
            review.table(xml, &source, table);
        }
        let mut children = Vec::new();
        let mut row_text = String::new();
        let mut column_count = 0;
        for (ri, row) in table.rows.iter().enumerate() {
            let row_id = indexed_path(id, [("/row/", ri)]);
            let is_header = row
                .style
                .as_ref()
                .and_then(|s| s.is_header)
                .unwrap_or(false);
            let mut cells = Vec::with_capacity(row.cells.len());
            let mut column_index = row.style.as_ref().and_then(|s| s.grid_before).unwrap_or(0);
            for (ci, cell) in row.cells.iter().enumerate() {
                let cell_id = indexed_path(&row_id, [("/cell/", ci)]);
                let content = cell
                    .nodes
                    .iter()
                    .enumerate()
                    .map(|(ni, node)| match node {
                        TableCellContentNode::Paragraph(p) => {
                            self.paragraph(p, &indexed_path(&cell_id, [("/", ni)]), Some(&cell_id))
                        }
                        TableCellContentNode::Table(t) => {
                            self.table(t, &indexed_path(&cell_id, [("/", ni)]), Some(&cell_id))
                        }
                    })
                    .collect::<Vec<_>>();
                let text = joined_block_content(&content, "\n");
                cells.push(self.block(
                    cell_id,
                    BlockType::TableCell,
                    text,
                    TableCellDetails {
                        r#type: "table_cell_details".into(),
                        row_index: ri,
                        column_index,
                        cell_index: ci,
                        column_span: cell.style.as_ref().and_then(|s| s.grid_span).unwrap_or(1),
                        row_span: cell.style.as_ref().and_then(|s| s.row_span).unwrap_or(1),
                        is_header,
                        style: cell.style.clone(),
                    },
                    content,
                    Some(if is_header { &row_id } else { id }),
                ));
                column_index += cell
                    .style
                    .as_ref()
                    .and_then(|s| s.grid_span)
                    .unwrap_or(1)
                    .max(1);
            }
            column_count = column_count.max(column_index);
            let text = joined_block_content(&cells, "\t");
            if ri > 0 {
                row_text.push('\n');
            }
            row_text.push_str(&text);
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
            row_text,
            json!({"type":"table_details", "rowCount":table.rows.len(), "columnCount":column_count}),
            children,
            parent,
        )
    }
}

fn block_has_visible_text(block: &DocumentBlock) -> bool {
    block.content.chars().any(|c| {
        !c.is_whitespace() && !matches!(c, '\u{200b}' | '\u{feff}' | '\u{00ad}')
    })
}

fn without_empty_blocks(
    mut blocks: Vec<DocumentBlock>,
    parent: Option<&str>,
    anchors: &HashSet<&str>,
) -> Vec<DocumentBlock> {
    let mut needs_flattening = false;
    blocks.retain_mut(|block| {
        block.children = without_empty_blocks(std::mem::take(&mut block.children), Some(&block.id), anchors);
        if block.parent_block_id.as_deref() != parent {
            block.parent_block_id = parent.map(str::to_string);
        }
        if anchors.contains(block.id.as_str()) || block_has_visible_text(block) || matches!(block.r#type,
            BlockType::Figure | BlockType::Formula | BlockType::Barcode
                | BlockType::Watermark | BlockType::KeyValue)
        {
            return true;
        }
        if block.children.is_empty() {
            return false;
        }
        needs_flattening |= matches!(block.r#type, BlockType::Text);
        true
    });
    if !needs_flattening {
        if blocks.capacity() > blocks.len().saturating_mul(4).max(64) {
            blocks.shrink_to_fit();
        }
        return blocks;
    }
    let mut retained = Vec::with_capacity(blocks.len());
    for mut block in blocks {
        if matches!(block.r#type, BlockType::Text) && !block_has_visible_text(&block) && !anchors.contains(block.id.as_str()) {
            for child in &mut block.children {
                if child.parent_block_id.as_deref() != parent {
                    child.parent_block_id = parent.map(str::to_string);
                }
            }
            retained.extend(block.children);
        } else {
            retained.push(block);
        }
    }
    retained
}

pub fn extract_document_blocks(model: &DocModel) -> StructuredDocument {
    extract_document_blocks_with_options(model, ExtractDocumentBlocksOptions::default())
}

pub fn extract_document_blocks_with_options(
    model: &DocModel,
    options: ExtractDocumentBlocksOptions,
) -> StructuredDocument {
    extract(model, options, false).document
}

/// Extract the current document and the tracked edits present in its Word source.
/// Source references use the same identities and UTF-16 coordinates as the blocks.
pub fn extract_document_blocks_with_revisions(
    model: &DocModel,
    options: ExtractDocumentBlocksOptions,
) -> ReviewedDocument {
    extract(model, options, true)
}

fn extract(
    model: &DocModel,
    options: ExtractDocumentBlocksOptions,
    include_revisions: bool,
) -> ReviewedDocument {
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
        review: include_revisions.then(RevisionCollector::default),
    };
    let mut blocks = extractor.story_nodes(&model.nodes, None);
    if let (Some(review), Some(section), Some(source)) = (
        &mut extractor.review,
        model.metadata.section_properties_xml.as_deref(),
        blocks.last().and_then(|b| b.source_refs.first()),
    ) {
        // A terminal section can also be the last paragraph's section break.
        let in_paragraph = matches!(model.nodes.last(), Some(DocNode::Paragraph(p))
            if p.source_xml.as_deref().is_some_and(|xml| xml.contains(section)));
        if !in_paragraph {
            review.final_section(section, source);
        }
    }
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
                blocks.extend(extractor.story_nodes(nodes, None));
            }
        }
    }
    extractor.part_name = source_part(model, "comments");
    extractor.story = "comment".into();
    for comment in model.metadata.comments.iter().flatten() {
        if let Some(nodes) = &comment.nodes {
            blocks.extend(extractor.story_nodes(nodes, None));
        }
    }
    let revisions = extractor.review.map(|review| review.records).unwrap_or_default();
    let anchors = revisions
        .iter()
        .flat_map(|revision| revision.source_refs.iter().map(|source| source.node_id.as_str()))
        .collect();
    let blocks = without_empty_blocks(blocks, None, &anchors);
    let document = StructuredDocument {
        schema_version: 1,
        parser_version: env!("CARGO_PKG_VERSION").into(),
        document_id,
        blocks,
        warnings: model.metadata.warnings.clone(),
        geometry_status: "requires_layout".into(),
    };
    ReviewedDocument { document, revisions }
}

#[cfg(test)]
mod image_presentation_tests {
    use super::*;

    #[test]
    fn embedded_crops_snap_to_pixels_without_changing_the_source() {
        let mut image: ImageRunNode = serde_json::from_value(json!({
            "type":"image", "widthPx":431.7, "heightPx":264.25,
            "crop":{"leftFraction":0.17321,"topFraction":0.16321,
                    "rightFraction":0.10987,"bottomFraction":0.05132},
            "cssOpacity":0.37654,
            "src":"data:image/png;base64,AQID"
        }))
        .unwrap();
        let raw = image_url(&image).unwrap();
        let (url, region) = presented_image_url(&image, &raw).unwrap();
        assert_eq!((region.left, region.top), (104.0 / 603.0, 55.0 / 336.0));
        let expected = crate::parse::svg_data_uri(
            r#"<image x="-104" y="-55" width="603" height="336" preserveAspectRatio="none" opacity="0.37654""#,
        );
        assert!(url.contains(expected.split_once(',').unwrap().1));
        assert_eq!(image_url(&image).unwrap(), raw);
        assert!(presented_image_url(&image, "https://invalid.test/image.png").is_none());
        assert!(presented_image_url(&image, "data:text/html,invalid").is_none());

        image.css_opacity = None;
        image.crop.as_mut().unwrap().left_fraction = Some(1.0);
        assert!(presented_image_url(&image, &raw).is_none());
        image.crop = None;
        assert!(presented_image_url(&image, &raw).is_none());
    }
}

#[cfg(test)]
mod typed_table_tests {
    #[test]
    fn table_details_round_trip_through_imported_json() {
        let mut package = crate::package::OoxmlPackage {
            parts: Default::default(),
            binary_assets: Default::default(),
            warnings: vec![],
        };
        let name = "word/document.xml".to_owned();
        package.parts.insert(name.clone(), crate::package::OoxmlPart { name, content: "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:tbl><w:tblGrid><w:gridCol w:w=\"1200\"/><w:gridCol w:w=\"1200\"/></w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:tcPr><w:gridSpan w:val=\"2\"/><w:shd w:fill=\"FFCC00\"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>cell content</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>".into() });
        let model = crate::build_doc_model(&package);
        for include_words in [false, true] {
            let blocks = super::extract_document_blocks_with_options(
                &model,
                super::ExtractDocumentBlocksOptions { include_words },
            );
            let value = serde_json::to_value(&blocks).unwrap();
            let imported: super::StructuredDocument =
                serde_json::from_value(value.clone()).unwrap();
            assert_eq!(blocks, imported);
            assert_eq!(serde_json::to_value(imported).unwrap(), value);
            let details = &value["blocks"][0]["children"][0]["children"][0]["details"];
            assert_eq!(details["columnSpan"], 2);
            assert_eq!(details["isHeader"], true);
            assert_eq!(details["style"]["backgroundColor"], "#FFCC00");
        }
    }
}

#[cfg(test)]
mod field_projection_tests {
    use super::paragraph_field_instructions;

    #[test]
    fn borrowed_instruction_projection_matches_balanced_block_behavior() {
        let cases = [
            "", "<w:p><w:r><w:t>text</w:t></w:r></w:p>",
            "<w:instrText>PAGE</w:instrText>",
            "<W:INSTRText>NUMPAGES</W:INSTRText>",
            "<w:instrText>HYPER&amp;LINK</w:instrText>",
            "<w:instrText><w:instrText>PAGE</w:instrText></w:instrText>",
            "<w:instrText>unfinished", "<w:instrText/>",
            "<w:instrTextExtra>text</w:instrTextExtra>",
            "<w:instrText xml:space=\"preserve\"> PAGE </w:instrText>",
            "<w:instrText>PAGE</w:instrText><w:instrText>NUMPAGES</w:instrText>",
        ];
        for xml in cases {
            let expected: Vec<_> = crate::xml::extract_balanced_tag_blocks(xml, "w:instrText")
                .iter()
                .map(|field| {
                    field.split_once('>')
                        .map(|(_, value)| crate::xml::decode_xml_entities(value.split("</").next().unwrap_or("")))
                        .unwrap_or_default()
                })
                .collect();
            assert_eq!(paragraph_field_instructions(xml), expected);
        }
    }
}

#[cfg(test)]
mod indexed_path_tests {
    use super::indexed_path;

    #[test]
    fn indexed_paths_preserve_integer_and_unicode_spelling() {
        for prefix in ["", "prefix", "文😀"] {
            for index in [0, 1, 9, 10, 99, 100, usize::MAX] {
                assert_eq!(indexed_path(prefix, [("/", index)]), format!("{prefix}/{index}"));
                assert_eq!(indexed_path(prefix, [("/row/", index), ("/cell/", 0), ("/", 10)]), format!("{prefix}/row/{index}/cell/0/10"));
                assert_eq!(indexed_path(prefix, [("/word/", index), ("-", index)]), format!("{prefix}/word/{index}-{index}"));
            }
            assert_eq!(indexed_path(prefix, []), prefix);
        }
    }
}

#[cfg(test)]
mod inplace_block_cleanup_tests {
    #[test]
    fn invisible_containers_flatten_objects_and_repair_only_parent_links() {
        use super::*;
        let extractor = Extractor {
            document_id: "document".into(), part_name: "part".into(),
            story: "body".into(), include_words: false, review: None,
        };
        let figure = extractor.block("figure".into(), BlockType::Figure, String::new(),
            json!({}), Vec::new(), Some("container"));
        let source_refs = figure.source_refs.clone();
        let container = extractor.block("container".into(), BlockType::Text,
            " \u{200b}\u{feff}\u{00ad}".into(), json!({}), vec![figure], Some("stale"));
        let empty = extractor.block("empty".into(), BlockType::Table, String::new(),
            json!({}), Vec::new(), None);
        let text = extractor.block("text".into(), BlockType::Text, "content".into(),
            json!({}), Vec::new(), Some("stale"));
        let result = without_empty_blocks(vec![container, empty, text], Some("parent"), &HashSet::new());
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].id, "figure");
        assert_eq!(result[0].source_refs, source_refs);
        assert_eq!(result[1].content, "content");
        assert!(result.iter().all(|block| block.parent_block_id.as_deref() == Some("parent")));
        let root = without_empty_blocks(result, None, &HashSet::new());
        assert!(root.iter().all(|block| block.parent_block_id.is_none()));
    }
}
