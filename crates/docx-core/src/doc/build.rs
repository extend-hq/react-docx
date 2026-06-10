//! Document builder: walks the CP space of each subdocument (main text,
//! headers/footers, footnotes, endnotes), reconstructs paragraphs, runs,
//! fields and tables from the piece table + FKP formatting layers, and
//! synthesizes a complete in-memory OOXML package.

use std::collections::{HashMap, HashSet};

use crate::package::{OoxmlPackage, OoxmlPart};

use super::chp::Chp;
use super::fib::fcidx;
use super::fkp;
use super::fmt::escape_xml;
use super::fonts::FontTable;
use super::images::{extract_image, InlineImage};
use super::lists::ListTables;
use super::pap::Pap;
use super::sep::Sep;
use super::stsh::StyleSheet;
use super::tap::Tap;
use super::DocFile;

const W_NS: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WP_NS: &str =
    "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A_NS: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC_NS: &str = "http://schemas.openxmlformats.org/drawingml/2006/picture";

const REL_TYPE_HEADER: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header";
const REL_TYPE_FOOTER: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer";
const REL_TYPE_IMAGE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const REL_TYPE_STYLES: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles";
const REL_TYPE_NUMBERING: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering";
const REL_TYPE_SETTINGS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings";
const REL_TYPE_FOOTNOTES: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes";
const REL_TYPE_ENDNOTES: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes";

#[derive(Default)]
struct RelSet {
    rels: Vec<(String, String, String)>, // (id, type, target)
}

impl RelSet {
    fn add(&mut self, rel_type: &str, target: &str) -> String {
        let id = format!("rId{}", self.rels.len() + 1);
        self.rels
            .push((id.clone(), rel_type.to_string(), target.to_string()));
        id
    }

    fn to_xml(&self) -> String {
        let mut xml = String::from(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#,
        );
        for (id, rel_type, target) in &self.rels {
            xml.push_str(&format!(
                r#"<Relationship Id="{id}" Type="{rel_type}" Target="{}"/>"#,
                escape_xml(target)
            ));
        }
        xml.push_str("</Relationships>");
        xml
    }
}

#[derive(Debug, Clone)]
struct CharRun {
    cp_start: u32,
    cp_end: u32,
    grpprl: Vec<u8>,
}

/// One reconstructed paragraph, ready for table grouping and emission.
struct ParaOut {
    pap: Pap,
    runs_xml: String,
    /// rPr of the paragraph mark itself — governs the line height of empty
    /// paragraphs.
    mark_rpr: String,
    mark_char: u16,
    effective_itap: u32,
    is_row_end_level: u32, // 0 = not a row end; otherwise the table depth it terminates
    cp_end: u32,
    sect_index: Option<usize>, // set when this paragraph ends section N (not the last)
}

/// Walk-state shared across runs of one story (fields span runs and
/// paragraphs).
#[derive(Default, Clone, Copy, PartialEq)]
enum FieldState {
    #[default]
    None,
    Instruction,
    Result,
}

enum NoteContext {
    /// Main document: 0x02 resolves through the reference PLCs.
    Body,
    /// Inside a footnote/endnote: 0x02 is the note's own number mark.
    Footnote,
    Endnote,
}

pub struct DocBuilder<'a> {
    doc: &'a DocFile,
    styles: StyleSheet,
    fonts: FontTable,
    lists: ListTables,
    char_runs: Vec<CharRun>,
    papx_bins: Vec<(u32, u32, u32)>,
    papx_pages: HashMap<u32, Vec<fkp::PapxRun>>,
    sections: Vec<(u32, Sep)>, // (exclusive cp end, properties)
    section_ends: HashSet<u32>,
    footnote_refs: Vec<u32>,
    endnote_refs: Vec<u32>,
    footnote_ranges: Vec<(u32, u32)>,
    endnote_ranges: Vec<(u32, u32)>,
    f_facing_pages: bool,
    default_tab: u16,
    // Outputs accumulated during emission.
    parts: HashMap<String, String>,
    media: HashMap<String, Vec<u8>>,
    media_extensions: HashSet<&'static str>,
    image_count: usize,
    header_count: usize,
    footer_count: usize,
}

pub fn parse_doc(bytes: &[u8]) -> Result<OoxmlPackage, String> {
    let doc = DocFile::open(bytes)?;
    let mut builder = DocBuilder::new(&doc);
    builder.build()
}

impl<'a> DocBuilder<'a> {
    fn new(doc: &'a DocFile) -> DocBuilder<'a> {
        let styles = doc
            .fib
            .table_slice(&doc.table, fcidx::STSHF)
            .map(StyleSheet::parse)
            .unwrap_or_else(StyleSheet::empty);
        let fonts = doc
            .fib
            .table_slice(&doc.table, fcidx::STTBF_FFN)
            .map(FontTable::parse)
            .unwrap_or_else(FontTable::empty);
        let lists = ListTables::parse(
            doc.fib.table_slice(&doc.table, fcidx::PLF_LST),
            doc.fib.table_slice(&doc.table, fcidx::PLF_LFO),
        );

        let mut builder = DocBuilder {
            doc,
            styles,
            fonts,
            lists,
            char_runs: Vec::new(),
            papx_bins: Vec::new(),
            papx_pages: HashMap::new(),
            sections: Vec::new(),
            section_ends: HashSet::new(),
            footnote_refs: Vec::new(),
            endnote_refs: Vec::new(),
            footnote_ranges: Vec::new(),
            endnote_ranges: Vec::new(),
            f_facing_pages: false,
            default_tab: 720,
            parts: HashMap::new(),
            media: HashMap::new(),
            media_extensions: HashSet::new(),
            image_count: 0,
            header_count: 0,
            footer_count: 0,
        };
        builder.load_char_runs();
        builder.load_papx_bins();
        builder.load_sections();
        builder.load_notes();
        builder.load_dop();
        builder
    }

    // ----- table/property loading -----

    fn load_char_runs(&mut self) {
        let Some(plc) = self.doc.fib.table_slice(&self.doc.table, fcidx::PLCF_BTE_CHPX) else {
            return;
        };
        let bins = fkp::parse_bin_table(plc);
        let mut fkp_cache: HashMap<u32, Vec<fkp::ChpxRun>> = HashMap::new();

        for piece in &self.doc.pieces.pieces {
            let char_width = if piece.compressed { 1u32 } else { 2u32 };
            let piece_fc_start = piece.fc;
            let piece_fc_end = piece.fc + (piece.cp_end - piece.cp_start) * char_width;
            let prm_grpprl = self.prm_grpprl(piece.prm);

            for (bin_fc_start, bin_fc_end, page) in &bins {
                if *bin_fc_end <= piece_fc_start || *bin_fc_start >= piece_fc_end {
                    continue;
                }
                let runs = fkp_cache
                    .entry(*page)
                    .or_insert_with(|| fkp::parse_chpx_fkp(&self.doc.word, *page));
                for run in runs.iter() {
                    let fc_start = run.fc_start.max(piece_fc_start);
                    let fc_end = run.fc_end.min(piece_fc_end);
                    if fc_start >= fc_end {
                        continue;
                    }
                    let cp_start = piece.cp_start + (fc_start - piece_fc_start) / char_width;
                    let cp_end = piece.cp_start + (fc_end - piece_fc_start).div_ceil(char_width);
                    let mut grpprl = run.grpprl.clone();
                    if let Some(extra) = &prm_grpprl {
                        grpprl.extend_from_slice(extra);
                    }
                    self.char_runs.push(CharRun {
                        cp_start,
                        cp_end,
                        grpprl,
                    });
                }
            }
        }
        self.char_runs.sort_by_key(|run| run.cp_start);
    }

    fn prm_grpprl(&self, prm: u16) -> Option<Vec<u8>> {
        if prm == 0 {
            return None;
        }
        if prm & 1 == 1 {
            let index = (prm >> 1) as usize;
            return self.doc.pieces.grpprls.get(index).cloned();
        }
        None // compact single-sprm PRM form: not decoded
    }

    fn load_papx_bins(&mut self) {
        if let Some(plc) = self.doc.fib.table_slice(&self.doc.table, fcidx::PLCF_BTE_PAPX) {
            self.papx_bins = fkp::parse_bin_table(plc);
        }
    }

    fn papx_for_fc(&mut self, fc: u32) -> Option<fkp::PapxRun> {
        let page = self
            .papx_bins
            .iter()
            .find(|(start, end, _)| fc >= *start && fc < *end)
            .map(|(_, _, page)| *page)
            .or_else(|| self.papx_bins.last().map(|(_, _, page)| *page))?;
        let runs = self
            .papx_pages
            .entry(page)
            .or_insert_with(|| fkp::parse_papx_fkp(&self.doc.word, page));
        runs.iter()
            .find(|run| fc >= run.fc_start && fc < run.fc_end)
            .or_else(|| runs.last())
            .cloned()
    }

    /// Expands sprmPHugePapx (0x6646): paragraph grpprls too large for an FKP
    /// (typically wide table rows) live as a length-prefixed grpprl in the
    /// Data stream.
    fn resolve_huge_papx(&self, grpprl: &[u8]) -> Vec<u8> {
        let Some(huge) = super::sprm::iterate(grpprl).find(|sprm| sprm.opcode == 0x6646) else {
            return grpprl.to_vec();
        };
        let offset = huge.u32_operand() as usize;
        let Some(cb) = self
            .doc
            .data
            .get(offset..offset + 2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]) as usize)
        else {
            return grpprl.to_vec();
        };
        let Some(huge_grpprl) = self.doc.data.get(offset + 2..offset + 2 + cb) else {
            return grpprl.to_vec();
        };
        let mut combined = grpprl.to_vec();
        combined.extend_from_slice(huge_grpprl);
        combined
    }

    fn load_sections(&mut self) {
        let Some(plc) = self.doc.fib.table_slice(&self.doc.table, fcidx::PLCF_SED) else {
            self.sections.push((self.doc.fib.ccp.text, Sep::default()));
            return;
        };
        const SED_SIZE: usize = 12;
        if plc.len() < 4 + SED_SIZE {
            self.sections.push((self.doc.fib.ccp.text, Sep::default()));
            return;
        }
        let count = (plc.len() - 4) / (4 + SED_SIZE);
        let read_u32 = |offset: usize| {
            plc.get(offset..offset + 4)
                .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .unwrap_or(0)
        };
        for index in 0..count {
            let cp_end = read_u32((index + 1) * 4);
            let sed_offset = (count + 1) * 4 + index * SED_SIZE;
            let fc_sepx = read_u32(sed_offset + 2);
            let mut sep = Sep::default();
            if fc_sepx != 0xFFFF_FFFF {
                let base = fc_sepx as usize;
                if let Some(cb) = self
                    .doc
                    .word
                    .get(base..base + 2)
                    .map(|b| u16::from_le_bytes([b[0], b[1]]) as usize)
                {
                    if let Some(grpprl) = self.doc.word.get(base + 2..base + 2 + cb) {
                        sep.apply_sepx(grpprl);
                    }
                }
            }
            self.sections.push((cp_end, sep));
        }
        for (cp_end, _) in &self.sections {
            self.section_ends.insert(*cp_end);
        }
    }

    fn load_notes(&mut self) {
        // Reference PLCs: CPs in the main document plus 2 bytes of data each.
        let parse_ref_plc = |plc: Option<&[u8]>, data_size: usize| -> Vec<u32> {
            let Some(plc) = plc else { return Vec::new() };
            if plc.len() < 4 {
                return Vec::new();
            }
            let count = (plc.len() - 4) / (4 + data_size);
            (0..count)
                .filter_map(|index| {
                    plc.get(index * 4..index * 4 + 4)
                        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                })
                .collect()
        };
        // Text PLCs: CP-only, relative to the note subdocument.
        let parse_txt_plc = |plc: Option<&[u8]>| -> Vec<u32> {
            let Some(plc) = plc else { return Vec::new() };
            plc.chunks_exact(4)
                .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .collect()
        };

        self.footnote_refs = parse_ref_plc(
            self.doc.fib.table_slice(&self.doc.table, fcidx::PLCFFND_REF),
            2,
        );
        self.endnote_refs = parse_ref_plc(
            self.doc.fib.table_slice(&self.doc.table, fcidx::PLCFEND_REF),
            2,
        );

        let ftn_base = self.doc.fib.ccp.ftn_start();
        let ftn_cps = parse_txt_plc(self.doc.fib.table_slice(&self.doc.table, fcidx::PLCFFND_TXT));
        for window in ftn_cps.windows(2).take(self.footnote_refs.len()) {
            self.footnote_ranges
                .push((ftn_base + window[0], ftn_base + window[1]));
        }
        let edn_base = self.doc.fib.ccp.edn_start();
        let edn_cps = parse_txt_plc(self.doc.fib.table_slice(&self.doc.table, fcidx::PLCFEND_TXT));
        for window in edn_cps.windows(2).take(self.endnote_refs.len()) {
            self.endnote_ranges
                .push((edn_base + window[0], edn_base + window[1]));
        }
    }

    fn load_dop(&mut self) {
        if let Some(dop) = self.doc.fib.table_slice(&self.doc.table, fcidx::DOP) {
            if let Some(&flags) = dop.first() {
                self.f_facing_pages = flags & 0x01 != 0;
            }
            if let Some(tab) = dop
                .get(8..10)
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
            {
                if (36..=2880).contains(&tab) {
                    self.default_tab = tab;
                }
            }
        }
    }

    // ----- paragraph construction -----

    /// Splits `[cp_start, cp_end)` into paragraphs at paragraph marks (0x0D),
    /// cell/row marks (0x07) and section marks (0x0C at a section boundary).
    fn build_paragraphs(&mut self, cp_start: u32, cp_end: u32, context: &NoteContext) -> Vec<ParaOut> {
        let text = self.doc.text(cp_start, cp_end);
        let mut paragraphs = Vec::new();
        let mut para_start = cp_start;
        for (index, &unit) in text.iter().enumerate() {
            let cp = cp_start + index as u32;
            let is_end = unit == 0x0D
                || unit == 0x07
                || (unit == 0x0C && self.section_ends.contains(&(cp + 1)));
            if is_end {
                paragraphs.push(self.build_paragraph(para_start, cp + 1, unit, context));
                para_start = cp + 1;
            }
        }
        if para_start < cp_end {
            paragraphs.push(self.build_paragraph(para_start, cp_end, 0x0D, context));
        }
        paragraphs
    }

    fn build_paragraph(
        &mut self,
        cp_start: u32,
        cp_end: u32,
        mark_char: u16,
        context: &NoteContext,
    ) -> ParaOut {
        // Paragraph properties live at the paragraph mark's FC.
        let mark_cp = cp_end.saturating_sub(1);
        let mut pap = Pap::default();
        if let Some(fc) = self.doc.pieces.cp_to_fc(mark_cp) {
            if let Some(papx) = self.papx_for_fc(fc) {
                pap.istd = papx.istd;
                pap.apply_papx(&self.resolve_huge_papx(&papx.grpprl));
            }
        }
        if let Some(piece) = self.doc.pieces.piece_for(mark_cp) {
            if let Some(extra) = self.prm_grpprl(piece.prm) {
                pap.apply_papx(&extra);
            }
        }

        let effective_itap = if pap.itap == 0 && pap.f_in_table {
            1
        } else {
            pap.itap
        };
        let is_row_end_level = if pap.f_ttp {
            1
        } else if pap.f_inner_ttp {
            effective_itap.max(2)
        } else {
            0
        };

        let runs_xml = self.build_runs(cp_start, mark_cp, pap.istd, context);

        // Paragraph-mark formatting (empty-paragraph strut height).
        let mark_rpr = {
            let grpprl = self
                .char_runs
                .iter()
                .find(|run| mark_cp >= run.cp_start && mark_cp < run.cp_end)
                .map(|run| run.grpprl.clone())
                .unwrap_or_default();
            let char_istd = super::sprm::iterate(&grpprl)
                .find(|sprm| sprm.opcode == 0x4A30)
                .map(|sprm| sprm.u16_operand());
            let base_toggles = self.styles.run_toggle_base(pap.istd, char_istd);
            let mut chp = Chp::default();
            chp.apply_chpx(&grpprl, &base_toggles);
            chp.to_rpr_xml(
                &|istd| self.styles.style_id(istd),
                &|ftc| self.fonts.name(ftc),
            )
        };

        ParaOut {
            pap,
            runs_xml,
            mark_rpr,
            mark_char,
            effective_itap,
            is_row_end_level,
            cp_end,
            sect_index: None,
        }
    }

    /// Emits the runs of `[cp_start, cp_end)` (paragraph content without its
    /// mark), splitting at character-run boundaries and special characters.
    fn build_runs(
        &mut self,
        cp_start: u32,
        cp_end: u32,
        para_istd: u16,
        context: &NoteContext,
    ) -> String {
        let mut xml = String::new();
        if cp_start >= cp_end {
            return xml;
        }
        let mut field_state = FieldState::None;

        // Collect runs intersecting the range; fall back to one unformatted run.
        let mut intervals: Vec<(u32, u32, Vec<u8>)> = self
            .char_runs
            .iter()
            .filter(|run| run.cp_end > cp_start && run.cp_start < cp_end)
            .map(|run| {
                (
                    run.cp_start.max(cp_start),
                    run.cp_end.min(cp_end),
                    run.grpprl.clone(),
                )
            })
            .collect();
        if intervals.is_empty() {
            intervals.push((cp_start, cp_end, Vec::new()));
        }
        intervals.sort_by_key(|(start, _, _)| *start);
        // Fill any gaps so every CP is covered.
        let mut covered = cp_start;
        let mut complete: Vec<(u32, u32, Vec<u8>)> = Vec::new();
        for (start, end, grpprl) in intervals {
            if start > covered {
                complete.push((covered, start, Vec::new()));
            }
            let clamped_start = start.max(covered);
            if clamped_start < end {
                complete.push((clamped_start, end, grpprl));
                covered = end;
            }
        }
        if covered < cp_end {
            complete.push((covered, cp_end, Vec::new()));
        }

        for (start, end, grpprl) in complete {
            let char_istd = super::sprm::iterate(&grpprl)
                .find(|sprm| sprm.opcode == 0x4A30)
                .map(|sprm| sprm.u16_operand());
            let base_toggles = self.styles.run_toggle_base(para_istd, char_istd);
            let mut chp = Chp::default();
            chp.apply_chpx(&grpprl, &base_toggles);
            let rpr = chp.to_rpr_xml(
                &|istd| self.styles.style_id(istd),
                &|ftc| self.fonts.name(ftc),
            );
            self.emit_run_content(&mut xml, start, end, &chp, &rpr, &mut field_state, context);
        }
        xml
    }

    #[allow(clippy::too_many_arguments)]
    fn emit_run_content(
        &mut self,
        xml: &mut String,
        cp_start: u32,
        cp_end: u32,
        chp: &Chp,
        rpr: &str,
        field_state: &mut FieldState,
        context: &NoteContext,
    ) {
        let text = self.doc.text(cp_start, cp_end);
        let mut buffer = String::new();

        let flush =
            |buffer: &mut String, xml: &mut String, state: FieldState, rpr: &str| {
                if buffer.is_empty() {
                    return;
                }
                let escaped = escape_xml(buffer);
                let body = if state == FieldState::Instruction {
                    format!(r#"<w:instrText xml:space="preserve">{escaped}</w:instrText>"#)
                } else {
                    format!(r#"<w:t xml:space="preserve">{escaped}</w:t>"#)
                };
                xml.push_str(&format!("<w:r>{rpr}{body}</w:r>"));
                buffer.clear();
            };
        let single = |xml: &mut String, rpr: &str, inner: &str| {
            xml.push_str(&format!("<w:r>{rpr}{inner}</w:r>"));
        };

        for (index, &unit) in text.iter().enumerate() {
            let cp = cp_start + index as u32;
            match unit {
                0x09 => {
                    flush(&mut buffer, xml, *field_state, rpr);
                    single(xml, rpr, "<w:tab/>");
                }
                0x0B => {
                    flush(&mut buffer, xml, *field_state, rpr);
                    single(xml, rpr, "<w:br/>");
                }
                0x0C => {
                    flush(&mut buffer, xml, *field_state, rpr);
                    single(xml, rpr, r#"<w:br w:type="page"/>"#);
                }
                0x0E => {
                    flush(&mut buffer, xml, *field_state, rpr);
                    single(xml, rpr, r#"<w:br w:type="column"/>"#);
                }
                0x13 => {
                    flush(&mut buffer, xml, *field_state, rpr);
                    single(xml, rpr, r#"<w:fldChar w:fldCharType="begin"/>"#);
                    *field_state = FieldState::Instruction;
                }
                0x14 => {
                    flush(&mut buffer, xml, *field_state, rpr);
                    single(xml, rpr, r#"<w:fldChar w:fldCharType="separate"/>"#);
                    *field_state = FieldState::Result;
                }
                0x15 => {
                    flush(&mut buffer, xml, *field_state, rpr);
                    single(xml, rpr, r#"<w:fldChar w:fldCharType="end"/>"#);
                    *field_state = FieldState::None;
                }
                0x1E => buffer.push('\u{2011}'),
                0x1F => buffer.push('\u{00AD}'),
                0x01 if chp.f_spec => {
                    flush(&mut buffer, xml, *field_state, rpr);
                    if !chp.f_obj && !chp.f_ole2 {
                        if let Some(location) = chp.pic_location {
                            if let Some(image) = extract_image(&self.doc.data, location) {
                                let drawing = self.register_image(image);
                                single(xml, rpr, &drawing);
                            }
                        }
                    }
                }
                0x02 if chp.f_spec => {
                    flush(&mut buffer, xml, *field_state, rpr);
                    match context {
                        NoteContext::Body => {
                            if let Some(position) =
                                self.footnote_refs.iter().position(|&ref_cp| ref_cp == cp)
                            {
                                single(
                                    xml,
                                    rpr,
                                    &format!(r#"<w:footnoteReference w:id="{}"/>"#, position + 1),
                                );
                            } else if let Some(position) =
                                self.endnote_refs.iter().position(|&ref_cp| ref_cp == cp)
                            {
                                single(
                                    xml,
                                    rpr,
                                    &format!(r#"<w:endnoteReference w:id="{}"/>"#, position + 1),
                                );
                            }
                        }
                        NoteContext::Footnote => single(xml, rpr, "<w:footnoteRef/>"),
                        NoteContext::Endnote => single(xml, rpr, "<w:endnoteRef/>"),
                    }
                }
                0x28 if chp.f_spec => {
                    flush(&mut buffer, xml, *field_state, rpr);
                    if let Some((ftc, xchar)) = chp.symbol {
                        let font = self
                            .fonts
                            .name(ftc)
                            .unwrap_or_else(|| "Symbol".to_string());
                        single(
                            xml,
                            rpr,
                            &format!(
                                r#"<w:sym w:font="{}" w:char="{xchar:04X}"/>"#,
                                escape_xml(&font)
                            ),
                        );
                    }
                }
                0x00..=0x1F => {} // other control chars: dropped
                _ => buffer.push_str(&String::from_utf16_lossy(&[unit])),
            }
        }
        flush(&mut buffer, xml, *field_state, rpr);
    }

    fn register_image(&mut self, image: InlineImage) -> String {
        self.image_count += 1;
        let index = self.image_count;
        let file_name = format!("media/image{index}.{}", image.extension);
        let part_name = format!("word/{file_name}");
        self.media.insert(part_name, image.bytes.clone());
        self.media_extensions.insert(image.extension);

        // The rel id is fixed up by the caller part's RelSet via placeholder
        // replacement when parts are finalized.
        let placeholder = format!("__IMG_REL_{index}__");
        format!(
            r#"<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{index}" name="Picture {index}"/><a:graphic xmlns:a="{A_NS}"><a:graphicData uri="{PIC_NS}"><pic:pic xmlns:pic="{PIC_NS}"><pic:nvPicPr><pic:cNvPr id="{index}" name="Picture {index}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="{placeholder}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>"#,
            cx = image.width_emu.max(1),
            cy = image.height_emu.max(1),
        )
    }

    /// Replaces image rel placeholders in `xml` with real rel ids registered
    /// in `rels` (targets are relative to word/).
    fn finalize_image_rels(&self, xml: String, rels: &mut RelSet) -> String {
        let mut result = xml;
        for index in 1..=self.image_count {
            let placeholder = format!("__IMG_REL_{index}__");
            if result.contains(&placeholder) {
                // Recover the media file extension for this index.
                let target = self
                    .media
                    .keys()
                    .find(|name| {
                        name.starts_with(&format!("word/media/image{index}."))
                    })
                    .map(|name| name.trim_start_matches("word/").to_string())
                    .unwrap_or_else(|| format!("media/image{index}.png"));
                let rel_id = rels.add(REL_TYPE_IMAGE, &target);
                result = result.replace(&placeholder, &rel_id);
            }
        }
        result
    }

    // ----- block assembly (paragraphs + tables) -----

    fn assemble_blocks(&self, paragraphs: &[ParaOut]) -> String {
        let mut xml = String::new();
        let mut index = 0;
        while index < paragraphs.len() {
            let para = &paragraphs[index];
            if para.effective_itap >= 1 {
                let (table_xml, consumed, pending_sections) =
                    self.assemble_table(&paragraphs[index..], 1);
                xml.push_str(&table_xml);
                for sect_index in pending_sections {
                    xml.push_str(&format!(
                        "<w:p><w:pPr>{}</w:pPr></w:p>",
                        self.sect_pr_xml(sect_index)
                    ));
                }
                index += consumed;
            } else {
                xml.push_str(&self.paragraph_xml(para));
                index += 1;
            }
        }
        xml
    }

    fn paragraph_xml(&self, para: &ParaOut) -> String {
        let mut ppr_inner = para.pap.to_ppr_inner_xml(&|istd| self.styles.style_id(istd));
        ppr_inner.push_str(&para.mark_rpr);
        if let Some(sect_index) = para.sect_index {
            ppr_inner.push_str(&self.sect_pr_xml(sect_index));
        }
        if ppr_inner.is_empty() {
            format!("<w:p>{}</w:p>", para.runs_xml)
        } else {
            format!("<w:p><w:pPr>{ppr_inner}</w:pPr>{}</w:p>", para.runs_xml)
        }
    }

    /// Builds one table at `level` from the head of `paragraphs`. Returns the
    /// XML, paragraph count consumed and any section indices that ended inside.
    fn assemble_table(
        &self,
        paragraphs: &[ParaOut],
        level: u32,
    ) -> (String, usize, Vec<usize>) {
        struct Row<'p> {
            cells: Vec<Vec<&'p ParaOut>>,
            tap: Tap,
        }
        let mut rows: Vec<Row<'_>> = Vec::new();
        let mut pending_sections = Vec::new();
        let mut index = 0;

        'rows: while index < paragraphs.len() && paragraphs[index].effective_itap >= level {
            let mut cells: Vec<Vec<&ParaOut>> = Vec::new();
            let mut current: Vec<&ParaOut> = Vec::new();
            loop {
                if index >= paragraphs.len() {
                    if !current.is_empty() {
                        cells.push(std::mem::take(&mut current));
                    }
                    if !cells.is_empty() {
                        rows.push(Row {
                            cells,
                            tap: Tap::default(),
                        });
                    }
                    break 'rows;
                }
                let para = &paragraphs[index];
                if para.effective_itap < level {
                    if !current.is_empty() {
                        cells.push(std::mem::take(&mut current));
                    }
                    if !cells.is_empty() {
                        rows.push(Row {
                            cells,
                            tap: Tap::default(),
                        });
                    }
                    break 'rows;
                }
                if let Some(sect_index) = para.sect_index {
                    pending_sections.push(sect_index);
                }
                if para.is_row_end_level != 0 && para.is_row_end_level == level {
                    let tap = Tap::from_grpprl(&para.pap.table_grpprl);
                    if !current.is_empty() {
                        cells.push(std::mem::take(&mut current));
                    }
                    index += 1;
                    rows.push(Row { cells, tap });
                    break;
                }
                current.push(para);
                index += 1;
                if para.effective_itap == level && para.mark_char == 0x07 && para.is_row_end_level == 0
                {
                    cells.push(std::mem::take(&mut current));
                }
            }
        }

        if rows.is_empty() {
            // Defensive: avoid infinite loops on malformed structure.
            return (String::new(), 1.max(index), pending_sections);
        }

        // Unified grid across rows.
        let mut boundaries: Vec<i32> = Vec::new();
        for row in &rows {
            for cell in &row.tap.cells {
                boundaries.push(cell.boundary_left);
                boundaries.push(cell.boundary_right);
            }
        }
        boundaries.sort_unstable();
        boundaries.dedup();

        let first_tap = &rows[0].tap;
        let mut xml = String::from("<w:tbl>");
        xml.push_str("<w:tblPr>");
        let jc = match first_tap.jc {
            1 => Some("center"),
            2 => Some("right"),
            _ => None,
        };
        xml.push_str(r#"<w:tblW w:w="0" w:type="auto"/>"#);
        if let Some(jc) = jc {
            xml.push_str(&format!(r#"<w:jc w:val="{jc}"/>"#));
        }
        let ind = first_tap.row_left_edge() + first_tap.dxa_gap_half as i32;
        if ind != 0 {
            xml.push_str(&format!(r#"<w:tblInd w:w="{ind}" w:type="dxa"/>"#));
        }
        let border_tags = ["w:top", "w:left", "w:bottom", "w:right", "w:insideH", "w:insideV"];
        if first_tap.table_borders.iter().any(Option::is_some) {
            xml.push_str("<w:tblBorders>");
            for (tag, border) in border_tags.iter().zip(first_tap.table_borders.iter()) {
                if let Some(border) = border {
                    xml.push_str(&border.to_xml(tag));
                }
            }
            xml.push_str("</w:tblBorders>");
        }
        let gap = first_tap.dxa_gap_half.max(0);
        xml.push_str(&format!(
            r#"<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="{gap}" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="{gap}" w:type="dxa"/></w:tblCellMar>"#
        ));
        xml.push_str(r#"<w:tblLayout w:type="fixed"/>"#);
        xml.push_str("</w:tblPr>");

        if boundaries.len() >= 2 {
            xml.push_str("<w:tblGrid>");
            for window in boundaries.windows(2) {
                xml.push_str(&format!(r#"<w:gridCol w:w="{}"/>"#, window[1] - window[0]));
            }
            xml.push_str("</w:tblGrid>");
        }

        for row in &rows {
            xml.push_str("<w:tr>");
            let mut tr_pr = String::new();
            if row.tap.dya_row_height != 0 {
                let (value, rule) = if row.tap.dya_row_height < 0 {
                    (-(row.tap.dya_row_height as i32), "exact")
                } else {
                    (row.tap.dya_row_height as i32, "atLeast")
                };
                tr_pr.push_str(&format!(
                    r#"<w:trHeight w:val="{value}" w:hRule="{rule}"/>"#
                ));
            }
            if row.tap.f_cant_split {
                tr_pr.push_str("<w:cantSplit/>");
            }
            if row.tap.f_table_header {
                tr_pr.push_str("<w:tblHeader/>");
            }
            if !tr_pr.is_empty() {
                xml.push_str(&format!("<w:trPr>{tr_pr}</w:trPr>"));
            }

            let cell_count = row.tap.cells.len().max(row.cells.len());
            let mut cell_index = 0usize;
            while cell_index < cell_count {
                let tc = row.tap.cells.get(cell_index);
                // Horizontally merged continuation cells fold into the first.
                if tc.map(|tc| tc.f_merged && !tc.f_first_merged).unwrap_or(false) {
                    cell_index += 1;
                    continue;
                }
                let mut span_right = tc.map(|tc| tc.boundary_right).unwrap_or(0);
                let mut merged_end = cell_index + 1;
                if tc.map(|tc| tc.f_first_merged).unwrap_or(false) {
                    while merged_end < row.tap.cells.len() && row.tap.cells[merged_end].f_merged {
                        span_right = row.tap.cells[merged_end].boundary_right;
                        merged_end += 1;
                    }
                }

                xml.push_str("<w:tc>");
                let mut tc_pr = String::new();
                if let Some(tc) = tc {
                    let width = span_right - tc.boundary_left;
                    tc_pr.push_str(&format!(
                        r#"<w:tcW w:w="{}" w:type="dxa"/>"#,
                        width.max(0)
                    ));
                    let grid_span = boundaries
                        .iter()
                        .filter(|b| **b > tc.boundary_left && **b < span_right)
                        .count()
                        + 1;
                    if grid_span > 1 {
                        xml_push_grid_span(&mut tc_pr, grid_span);
                    }
                    if tc.f_vert_restart {
                        tc_pr.push_str(r#"<w:vMerge w:val="restart"/>"#);
                    } else if tc.f_vert_merge {
                        tc_pr.push_str("<w:vMerge/>");
                    }
                    let cell_borders: Vec<(&str, &Option<super::fmt::Border>)> = vec![
                        ("w:top", &tc.brc_top),
                        ("w:left", &tc.brc_left),
                        ("w:bottom", &tc.brc_bottom),
                        ("w:right", &tc.brc_right),
                    ];
                    if cell_borders.iter().any(|(_, border)| border.is_some()) {
                        tc_pr.push_str("<w:tcBorders>");
                        for (tag, border) in cell_borders {
                            if let Some(border) = border {
                                tc_pr.push_str(&border.to_xml(tag));
                            }
                        }
                        tc_pr.push_str("</w:tcBorders>");
                    }
                    if let Some(shd) = &tc.shd {
                        if shd.is_visible() {
                            tc_pr.push_str(&shd.to_xml());
                        }
                    }
                    if tc.f_vertical {
                        tc_pr.push_str(&format!(
                            r#"<w:textDirection w:val="{}"/>"#,
                            if tc.f_backward { "btLr" } else { "tbRl" }
                        ));
                    }
                    match tc.vert_align {
                        1 => tc_pr.push_str(r#"<w:vAlign w:val="center"/>"#),
                        2 => tc_pr.push_str(r#"<w:vAlign w:val="bottom"/>"#),
                        _ => {}
                    }
                }
                if !tc_pr.is_empty() {
                    xml.push_str(&format!("<w:tcPr>{tc_pr}</w:tcPr>"));
                }

                let content: String = match row.cells.get(cell_index) {
                    Some(cell_paras) if !cell_paras.is_empty() => {
                        let owned: Vec<&ParaOut> = cell_paras.to_vec();
                        self.assemble_cell(&owned)
                    }
                    _ => "<w:p/>".to_string(),
                };
                xml.push_str(&content);
                xml.push_str("</w:tc>");
                cell_index = merged_end.max(cell_index + 1);
            }
            xml.push_str("</w:tr>");
        }
        xml.push_str("</w:tbl>");
        (xml, index, pending_sections)
    }

    fn assemble_cell(&self, cell_paras: &[&ParaOut]) -> String {
        let mut xml = String::new();
        let mut index = 0;
        while index < cell_paras.len() {
            let para = cell_paras[index];
            let level = para.effective_itap;
            if level >= 2 {
                // Nested table content: hand the contiguous deeper block to
                // assemble_table at the deeper level.
                let start = index;
                while index < cell_paras.len() && cell_paras[index].effective_itap >= 2 {
                    index += 1;
                }
                let owned: Vec<ParaOut> = cell_paras[start..index]
                    .iter()
                    .map(|para| ParaOut {
                        pap: para.pap.clone(),
                        runs_xml: para.runs_xml.clone(),
                        mark_rpr: para.mark_rpr.clone(),
                        mark_char: para.mark_char,
                        effective_itap: para.effective_itap - 1,
                        is_row_end_level: para.is_row_end_level.saturating_sub(1),
                        cp_end: para.cp_end,
                        sect_index: para.sect_index,
                    })
                    .collect();
                let (table_xml, _, _) = self.assemble_table(&owned, 1);
                xml.push_str(&table_xml);
            } else {
                xml.push_str(&self.paragraph_xml(para));
                index += 1;
            }
        }
        if xml.is_empty() {
            xml.push_str("<w:p/>");
        }
        xml
    }

    // ----- sections / headers / footers -----

    fn sect_pr_xml(&self, sect_index: usize) -> String {
        let sep = self
            .sections
            .get(sect_index)
            .map(|(_, sep)| sep.clone())
            .unwrap_or_default();
        let mut inner = String::new();
        // Header/footer references come first (Word's element order).
        inner.push_str(
            self.parts
                .get(&format!("__sect_refs_{sect_index}"))
                .map(String::as_str)
                .unwrap_or(""),
        );
        inner.push_str(&sep.to_sect_pr_inner_xml());
        format!("<w:sectPr>{inner}</w:sectPr>")
    }

    /// Builds header/footer parts for every section and stashes the reference
    /// XML (per section) for sect_pr_xml. Returns rels to add to document.rels.
    fn build_headers_footers(&mut self) -> Vec<(String, String)> {
        let mut rels_to_add: Vec<(String, String)> = Vec::new();
        let Some(plc) = self.doc.fib.table_slice(&self.doc.table, fcidx::PLCF_HDD) else {
            return rels_to_add;
        };
        if self.doc.fib.ccp.hdd == 0 {
            return rels_to_add;
        }
        let cps: Vec<u32> = plc
            .chunks_exact(4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect();
        if cps.len() < 2 {
            return rels_to_add;
        }
        let hdd_base = self.doc.fib.ccp.hdd_start();
        let story_count = cps.len() - 1;

        // Stories 0-5 are footnote/endnote separators; per-section groups of 6
        // follow: even hdr, odd hdr, even ftr, odd ftr, first hdr, first ftr.
        const STORY_KINDS: [(usize, &str, bool); 6] = [
            (0, "even", true),
            (1, "default", true),
            (2, "even", false),
            (3, "default", false),
            (4, "first", true),
            (5, "first", false),
        ];

        // Carry-forward for "same as previous" (empty story) sections.
        let mut previous_refs: [Option<(String, String, bool)>; 6] = Default::default();

        for sect_index in 0..self.sections.len() {
            let mut refs_xml = String::new();
            for (kind_index, ref_type, is_header) in STORY_KINDS {
                let story_index = 6 + sect_index * 6 + kind_index;
                let story_present = story_index + 1 < story_count + 1
                    && story_index + 1 < cps.len()
                    && cps[story_index + 1] > cps[story_index];

                let entry: Option<(String, String, bool)> = if story_present {
                    let cp_start = hdd_base + cps[story_index];
                    let cp_end = hdd_base + cps[story_index + 1];
                    let part_name = if is_header {
                        self.header_count += 1;
                        format!("word/header{}.xml", self.header_count)
                    } else {
                        self.footer_count += 1;
                        format!("word/footer{}.xml", self.footer_count)
                    };
                    let paragraphs =
                        self.build_paragraphs(cp_start, cp_end, &NoteContext::Body);
                    let body = self.assemble_blocks(&paragraphs);
                    let root_tag = if is_header { "w:hdr" } else { "w:ftr" };
                    let mut part_rels = RelSet::default();
                    let body = self.finalize_image_rels(body, &mut part_rels);
                    let part_xml = format!(
                        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><{root_tag} xmlns:w="{W_NS}" xmlns:r="{R_NS}" xmlns:wp="{WP_NS}">{body}</{root_tag}>"#
                    );
                    self.parts.insert(part_name.clone(), part_xml);
                    if !part_rels.rels.is_empty() {
                        let rel_part = format!(
                            "word/_rels/{}.rels",
                            part_name.trim_start_matches("word/")
                        );
                        self.parts.insert(rel_part, part_rels.to_xml());
                    }
                    Some((part_name, ref_type.to_string(), is_header))
                } else {
                    previous_refs[kind_index].clone()
                };

                if let Some((part_name, ref_type, is_header)) = &entry {
                    let target = part_name.trim_start_matches("word/");
                    let rel_id = format!(
                        "rIdHdrFtr{}_{}",
                        sect_index,
                        kind_index
                    );
                    rels_to_add.push((
                        rel_id.clone(),
                        format!(
                            r#"<Relationship Id="{rel_id}" Type="{}" Target="{target}"/>"#,
                            if *is_header { REL_TYPE_HEADER } else { REL_TYPE_FOOTER }
                        ),
                    ));
                    let tag = if *is_header {
                        "w:headerReference"
                    } else {
                        "w:footerReference"
                    };
                    refs_xml.push_str(&format!(
                        r#"<{tag} w:type="{ref_type}" r:id="{rel_id}"/>"#
                    ));
                }
                previous_refs[kind_index] = entry;
            }
            self.parts
                .insert(format!("__sect_refs_{sect_index}"), refs_xml);
        }
        rels_to_add
    }

    // ----- notes -----

    fn build_notes_part(
        &mut self,
        ranges: &[(u32, u32)],
        root: &str,
        note_tag: &str,
        ref_tag: &str,
        context: NoteContext,
    ) -> Option<String> {
        if ranges.is_empty() {
            return None;
        }
        let mut xml = format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><{root} xmlns:w="{W_NS}" xmlns:r="{R_NS}" xmlns:wp="{WP_NS}">"#
        );
        xml.push_str(&format!(
            r#"<{note_tag} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></{note_tag}><{note_tag} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></{note_tag}>"#
        ));
        let owned_ranges = ranges.to_vec();
        for (index, (cp_start, cp_end)) in owned_ranges.into_iter().enumerate() {
            let paragraphs = self.build_paragraphs(cp_start, cp_end, &context);
            let body = self.assemble_blocks(&paragraphs);
            xml.push_str(&format!(
                r#"<{note_tag} w:id="{}">{body}</{note_tag}>"#,
                index + 1
            ));
        }
        let _ = ref_tag;
        xml.push_str(&format!("</{root}>"));
        Some(xml)
    }

    // ----- top-level assembly -----

    fn build(&mut self) -> Result<OoxmlPackage, String> {
        let ccp_text = self.doc.fib.ccp.text;

        // Header/footer parts must exist before sectPr emission.
        let header_rels = self.build_headers_footers();

        // Main document paragraphs with section attribution.
        let mut paragraphs = self.build_paragraphs(0, ccp_text, &NoteContext::Body);
        let section_count = self.sections.len();
        for para in paragraphs.iter_mut() {
            if let Some(position) = self
                .sections
                .iter()
                .position(|(cp_end, _)| *cp_end == para.cp_end)
            {
                if position + 1 < section_count {
                    para.sect_index = Some(position);
                }
            }
        }
        let body_blocks = self.assemble_blocks(&paragraphs);
        let final_sect = self.sect_pr_xml(section_count.saturating_sub(1));

        let mut document_rels = RelSet::default();
        let body_blocks = self.finalize_image_rels(body_blocks, &mut document_rels);

        let document_xml = format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="{W_NS}" xmlns:r="{R_NS}" xmlns:wp="{WP_NS}" xmlns:a="{A_NS}" xmlns:pic="{PIC_NS}"><w:body>{body_blocks}{final_sect}</w:body></w:document>"#
        );

        // Notes parts.
        let footnote_ranges = self.footnote_ranges.clone();
        let footnotes_xml = self.build_notes_part(
            &footnote_ranges,
            "w:footnotes",
            "w:footnote",
            "w:footnoteRef",
            NoteContext::Footnote,
        );
        let endnote_ranges = self.endnote_ranges.clone();
        let endnotes_xml = self.build_notes_part(
            &endnote_ranges,
            "w:endnotes",
            "w:endnote",
            "w:endnoteRef",
            NoteContext::Endnote,
        );

        // Fixed rels.
        document_rels.add(REL_TYPE_STYLES, "styles.xml");
        document_rels.add(REL_TYPE_SETTINGS, "settings.xml");
        let numbering_xml = self.lists.to_numbering_xml(&self.fonts);
        if numbering_xml.is_some() {
            document_rels.add(REL_TYPE_NUMBERING, "numbering.xml");
        }
        if footnotes_xml.is_some() {
            document_rels.add(REL_TYPE_FOOTNOTES, "footnotes.xml");
        }
        if endnotes_xml.is_some() {
            document_rels.add(REL_TYPE_ENDNOTES, "endnotes.xml");
        }
        let mut document_rels_xml = document_rels.to_xml();
        // Header/footer rels carry pre-assigned ids; splice them in.
        if !header_rels.is_empty() {
            let mut spliced = String::new();
            for (_, rel_xml) in &header_rels {
                spliced.push_str(rel_xml);
            }
            document_rels_xml =
                document_rels_xml.replace("</Relationships>", &format!("{spliced}</Relationships>"));
        }

        let settings_xml = format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="{W_NS}">{}<w:defaultTabStop w:val="{}"/></w:settings>"#,
            if self.f_facing_pages {
                "<w:evenAndOddHeaders/>"
            } else {
                ""
            },
            self.default_tab
        );

        let styles_xml = self.styles.to_styles_xml(&self.fonts, 20);

        // [Content_Types].xml
        let mut content_types = String::from(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>"#,
        );
        for extension in &self.media_extensions {
            let mime = match *extension {
                "png" => "image/png",
                "jpeg" => "image/jpeg",
                "bmp" => "image/bmp",
                "tiff" => "image/tiff",
                _ => continue,
            };
            content_types.push_str(&format!(
                r#"<Default Extension="{extension}" ContentType="{mime}"/>"#
            ));
        }
        let mut add_override = |part: &str, content_type: &str| {
            content_types.push_str(&format!(
                r#"<Override PartName="/{part}" ContentType="{content_type}"/>"#
            ));
        };
        add_override(
            "word/document.xml",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        );
        add_override(
            "word/styles.xml",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
        );
        add_override(
            "word/settings.xml",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml",
        );
        if numbering_xml.is_some() {
            add_override(
                "word/numbering.xml",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml",
            );
        }
        if footnotes_xml.is_some() {
            add_override(
                "word/footnotes.xml",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml",
            );
        }
        if endnotes_xml.is_some() {
            add_override(
                "word/endnotes.xml",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml",
            );
        }
        for index in 1..=self.header_count {
            add_override(
                &format!("word/header{index}.xml"),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml",
            );
        }
        for index in 1..=self.footer_count {
            add_override(
                &format!("word/footer{index}.xml"),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml",
            );
        }
        content_types.push_str("</Types>");

        let root_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;

        // Assemble the package.
        let mut parts = HashMap::new();
        let mut insert = |name: &str, content: String| {
            parts.insert(
                name.to_string(),
                OoxmlPart {
                    name: name.to_string(),
                    content,
                },
            );
        };
        insert("[Content_Types].xml", content_types);
        insert("_rels/.rels", root_rels.to_string());
        insert("word/document.xml", document_xml);
        insert("word/_rels/document.xml.rels", document_rels_xml);
        insert("word/styles.xml", styles_xml);
        insert("word/settings.xml", settings_xml);
        if let Some(numbering) = numbering_xml {
            insert("word/numbering.xml", numbering);
        }
        if let Some(footnotes) = footnotes_xml {
            insert("word/footnotes.xml", footnotes);
        }
        if let Some(endnotes) = endnotes_xml {
            insert("word/endnotes.xml", endnotes);
        }
        for (name, content) in self.parts.drain() {
            if name.starts_with("__sect_refs_") {
                continue;
            }
            parts.insert(
                name.clone(),
                OoxmlPart {
                    name,
                    content,
                },
            );
        }

        Ok(OoxmlPackage {
            parts,
            binary_assets: self.media.drain().collect(),
        })
    }
}

fn xml_push_grid_span(tc_pr: &mut String, grid_span: usize) {
    tc_pr.push_str(&format!(r#"<w:gridSpan w:val="{grid_span}"/>"#));
}
