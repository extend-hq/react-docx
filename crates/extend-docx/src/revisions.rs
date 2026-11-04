use std::collections::BTreeMap;

use quick_xml::{events::Event, Reader};
use serde::{Deserialize, Serialize};

use crate::{
    parse::{parse_run_text, run_text_xml},
    xml::{
        decode_xml_entities, direct_child_tag, extract_balanced_tag_slices,
        extract_direct_child_tag_ranges, get_attribute_ref, tag_token_end,
    },
    DocumentBlock, SourceRef, StructuredDocument, TableNode,
};

/// The current block projection and the tracked changes recorded in the same source.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ReviewedDocument {
    #[serde(flatten)]
    pub document: StructuredDocument,
    pub revisions: Vec<DocumentRevision>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RevisionKind {
    Insertion,
    Deletion,
    MoveFrom,
    MoveTo,
    Formatting,
    CellMerge,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RevisionScope {
    Text,
    ParagraphMark,
    Paragraph,
    Section,
    Table,
    TableGrid,
    TableRow,
    TableCell,
}

/// Direct Word properties, including nested properties and their qualified attributes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WordProperty {
    pub name: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub attributes: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<WordProperty>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RevisionProperties {
    pub before: Vec<WordProperty>,
    pub after: Vec<WordProperty>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRevision {
    /// Unique within this document, including when different parts reuse a Word ID.
    pub id: String,
    pub kind: RevisionKind,
    pub scope: RevisionScope,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub move_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub properties: Option<RevisionProperties>,
    /// Half-open UTF-16 ranges in current paragraph text. A deletion has equal endpoints.
    /// Structural targets and text which cannot be aligned safely have no endpoints.
    pub source_refs: Vec<SourceRef>,
}

fn children(xml: &str) -> impl Iterator<Item = (String, &str)> {
    extract_direct_child_tag_ranges(xml)
        .into_iter()
        .map(|r| (r.tag_name, &xml[r.start..r.end]))
}

fn attribute(xml: &str, name: &str) -> Option<String> {
    let tag = &xml[..tag_token_end(xml, 0)?];
    get_attribute_ref(tag, name).map(decode_xml_entities)
}

fn revision_kind(name: &str) -> Option<RevisionKind> {
    Some(match name {
        "w:ins" | "w:cellIns" => RevisionKind::Insertion,
        "w:del" | "w:cellDel" => RevisionKind::Deletion,
        "w:moveFrom" => RevisionKind::MoveFrom,
        "w:moveTo" => RevisionKind::MoveTo,
        "w:cellMerge" => RevisionKind::CellMerge,
        "w:rPrChange" | "w:pPrChange" | "w:sectPrChange" | "w:tblPrChange" | "w:tblGridChange"
        | "w:tblPrExChange" | "w:trPrChange" | "w:tcPrChange" => RevisionKind::Formatting,
        _ => return None,
    })
}

fn property(name: String, xml: &str) -> WordProperty {
    let mut reader = Reader::from_str(xml);
    let mut attributes = BTreeMap::new();
    if let Ok(Event::Start(tag) | Event::Empty(tag)) = reader.read_event() {
        for attr in tag.attributes().flatten() {
            let key = attr.key.as_ref();
            if !key.starts_with("xmlns") {
                attributes.insert(key.to_owned(), decode_xml_entities(&attr.value));
            }
        }
    }
    WordProperty {
        name,
        attributes,
        children: properties(xml),
    }
}

fn properties(xml: &str) -> Vec<WordProperty> {
    children(xml)
        .filter(|(name, _)| revision_kind(name).is_none())
        .map(|(name, xml)| property(name, xml))
        .collect()
}

#[derive(Default)]
pub(crate) struct RevisionCollector {
    pub records: Vec<DocumentRevision>,
    // The two move ranges have distinct Word IDs and share a move name.
    pub(crate) moves: Vec<(RevisionKind, String, String)>,
}

impl RevisionCollector {
    fn record(
        &mut self,
        xml: &str,
        kind: RevisionKind,
        scope: RevisionScope,
        refs: &[SourceRef],
    ) -> usize {
        let index = self.records.len();
        let move_name = self
            .moves
            .iter()
            .rev()
            .find(|(side, _, _)| *side == kind)
            .map(|(_, _, name)| name.clone());
        self.records.push(DocumentRevision {
            id: format!("docx:{}/revision/{index}", refs[0].document_id),
            source_id: attribute(xml, "w:id"),
            author: attribute(xml, "w:author"),
            date: attribute(xml, "w:date"),
            kind,
            scope,
            move_name,
            text: None,
            properties: None,
            source_refs: refs.to_vec(),
        });
        index
    }

    fn property_changes(&mut self, xml: &str, scope: RevisionScope, refs: &[SourceRef]) {
        for (name, change) in children(xml) {
            let Some(kind) = revision_kind(&name) else {
                continue;
            };
            let index = self.record(change, kind, scope, refs);
            if kind == RevisionKind::Formatting {
                let before = children(change)
                    .next()
                    .map(|(_, previous)| properties(previous))
                    .unwrap_or_default();
                self.records[index].properties = Some(RevisionProperties {
                    before,
                    after: properties(xml),
                });
            } else if kind == RevisionKind::CellMerge {
                let merge = |key| {
                    attribute(change, key)
                        .map(|value| WordProperty {
                            name: "w:vMerge".into(),
                            attributes: BTreeMap::from([("w:val".into(), value)]),
                            children: Vec::new(),
                        })
                        .into_iter()
                        .collect()
                };
                self.records[index].properties = Some(RevisionProperties {
                    before: merge("w:vMergeOrig"),
                    after: merge("w:vMerge"),
                });
            }
        }
    }

    pub fn paragraph(&mut self, xml: &str, block: &DocumentBlock) {
        if !has_markup(xml) {
            return;
        }
        let first = self.records.len();
        let mut p = ParagraphReview {
            collector: self,
            source: &block.source_refs[0],
            visible: String::new(),
            quoted: String::new(),
            offset: 0,
        };
        p.visit(xml, false);
        let aligned = p.visible == block.content;
        let end = block.content.encode_utf16().count();
        for revision in &mut p.collector.records[first..] {
            let target = &mut revision.source_refs[0];
            if revision.scope == RevisionScope::ParagraphMark {
                target.start = Some(end);
                target.end = Some(end);
            } else if !aligned {
                target.start = None;
                target.end = None;
            }
        }
    }

    pub fn final_section(&mut self, xml: &str, source: &SourceRef) {
        if xml.contains("w:sectPrChange") {
            self.property_changes(xml, RevisionScope::Section, std::slice::from_ref(source));
        }
    }

    pub fn table(&mut self, xml: &str, source: &SourceRef, table: &TableNode) {
        if !has_markup(xml) {
            return;
        }
        let targets = std::slice::from_ref(source);
        for (name, scope) in [
            ("w:tblPr", RevisionScope::Table),
            ("w:tblGrid", RevisionScope::TableGrid),
        ] {
            if let Some(props) = direct_child_tag(xml, name) {
                self.property_changes(props, scope, targets);
            }
        }
        for (ri, (row_xml, row)) in extract_balanced_tag_slices(xml, "w:tr")
            .into_iter()
            .zip(&table.rows)
            .enumerate()
        {
            let cells: Vec<_> = (0..row.cells.len())
                .map(|ci| SourceRef {
                    node_id: format!("{}/row/{ri}/cell/{ci}", source.node_id),
                    ..source.clone()
                })
                .collect();
            let row_targets = if cells.is_empty() {
                targets
            } else {
                cells.as_slice()
            };
            for tag in ["w:trPr", "w:tblPrEx"] {
                if let Some(props) = direct_child_tag(row_xml, tag) {
                    self.property_changes(props, RevisionScope::TableRow, row_targets);
                }
            }
            for (cell_xml, cell) in extract_balanced_tag_slices(row_xml, "w:tc")
                .into_iter()
                .zip(&cells)
            {
                if let Some(props) = direct_child_tag(cell_xml, "w:tcPr") {
                    self.property_changes(
                        props,
                        RevisionScope::TableCell,
                        std::slice::from_ref(cell),
                    );
                }
            }
        }
    }
}

fn has_markup(xml: &str) -> bool {
    [
        "<w:ins",
        "<w:del",
        "<w:move",
        "Change",
        "<w:cellIns",
        "<w:cellDel",
        "<w:cellMerge",
    ]
    .iter()
    .any(|marker| xml.contains(marker))
}

struct ParagraphReview<'a> {
    collector: &'a mut RevisionCollector,
    source: &'a SourceRef,
    visible: String,
    quoted: String,
    offset: usize,
}

impl ParagraphReview<'_> {
    fn visit(&mut self, xml: &str, removed: bool) {
        for (name, child) in children(xml) {
            match name.as_str() {
                "w:r" => self.run(child, removed),
                "w:ins" | "w:del" | "w:moveFrom" | "w:moveTo" => {
                    let kind = revision_kind(&name).unwrap();
                    let index = self.collector.record(
                        child,
                        kind,
                        RevisionScope::Text,
                        std::slice::from_ref(self.source),
                    );
                    let start = self.offset;
                    let hidden =
                        removed || matches!(kind, RevisionKind::Deletion | RevisionKind::MoveFrom);
                    let begin = if hidden {
                        self.quoted.len()
                    } else {
                        self.visible.len()
                    };
                    self.visit(child, hidden);
                    let revision = &mut self.collector.records[index];
                    revision.text = Some(
                        (if hidden { &self.quoted } else { &self.visible })[begin..].to_owned(),
                    );
                    revision.source_refs[0].start = Some(start);
                    revision.source_refs[0].end = Some(self.offset);
                }
                "w:moveFromRangeStart"
                | "w:moveToRangeStart"
                | "w:moveFromRangeEnd"
                | "w:moveToRangeEnd" => {
                    let side = if name.starts_with("w:moveFrom") {
                        RevisionKind::MoveFrom
                    } else {
                        RevisionKind::MoveTo
                    };
                    if let Some(id) = attribute(child, "w:id") {
                        if name.ends_with("Start") {
                            if let Some(label) = attribute(child, "w:name") {
                                self.collector.moves.push((side, id, label));
                            }
                        } else {
                            self.collector
                                .moves
                                .retain(|(s, key, _)| *s != side || *key != id);
                        }
                    }
                }
                "w:pPr" => {
                    let refs = std::slice::from_ref(self.source);
                    self.collector
                        .property_changes(child, RevisionScope::Paragraph, refs);
                    if let Some(mark) = direct_child_tag(child, "w:rPr") {
                        self.collector
                            .property_changes(mark, RevisionScope::ParagraphMark, refs);
                    }
                    if let Some(section) = direct_child_tag(child, "w:sectPr") {
                        self.collector
                            .property_changes(section, RevisionScope::Section, refs);
                    }
                }
                "w:hyperlink" | "w:sdt" | "w:sdtContent" | "w:smartTag" | "w:customXml"
                | "w:fldSimple" | "w:dir" | "w:bdo" => self.visit(child, removed),
                "mc:AlternateContent" => {
                    if let Some(active) = direct_child_tag(child, "mc:Choice")
                        .or_else(|| direct_child_tag(child, "mc:Fallback"))
                    {
                        self.visit(active, removed);
                    }
                }
                _ => {}
            }
        }
    }

    fn run(&mut self, xml: &str, removed: bool) {
        let active = run_text_xml(xml);
        let text = if removed && active.contains("w:delText") {
            parse_run_text(
                &active
                    .replace("<w:delText", "<w:t")
                    .replace("</w:delText>", "</w:t>"),
            )
        } else {
            parse_run_text(&active)
        };
        let start = self.offset;
        self.quoted.push_str(&text);
        if !removed {
            self.visible.push_str(&text);
            self.offset += text.encode_utf16().count();
        }
        if let Some(props) = direct_child_tag(xml, "w:rPr") {
            let target = SourceRef {
                start: Some(start),
                end: Some(self.offset),
                ..self.source.clone()
            };
            self.collector
                .property_changes(props, RevisionScope::Text, &[target]);
        }
    }
}
