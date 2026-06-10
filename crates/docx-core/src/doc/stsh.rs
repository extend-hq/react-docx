//! Stylesheet (STSH, [MS-DOC] 2.9.271): STSHI header plus an array of STD
//! style definitions whose formatting lives in UPX grpprls. Emitted as a
//! synthesized word/styles.xml so the existing OOXML style-resolution code
//! (basedOn chains, defaults) is reused as-is.

use std::collections::HashSet;

use super::chp::{Chp, ToggleSet};
use super::fmt::escape_xml;
use super::fonts::FontTable;
use super::pap::Pap;

const ISTD_NIL: u16 = 0x0FFF;
pub const STK_PARAGRAPH: u8 = 1;
pub const STK_CHARACTER: u8 = 2;

#[derive(Debug, Clone)]
pub struct StyleDef {
    pub istd: u16,
    pub sti: u16,
    pub stk: u8,
    pub istd_base: u16,
    pub istd_next: u16,
    pub name: String,
    pub style_id: String,
    pub papx: Vec<u8>,
    pub chpx: Vec<u8>,
    pub resolved_toggles: ToggleSet,
}

pub struct StyleSheet {
    pub styles: Vec<Option<StyleDef>>,
    /// Default fonts (ftc ascii / FE / other) for the document, from STSHI.
    pub ftc_standard: [Option<u16>; 3],
}

fn read_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    bytes
        .get(offset..offset + 2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
}

fn style_id_from_name(name: &str, used: &HashSet<String>) -> String {
    let mut id = String::new();
    let mut capitalize = true;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            if capitalize {
                id.extend(ch.to_uppercase());
                capitalize = false;
            } else {
                id.push(ch);
            }
        } else {
            capitalize = true;
        }
    }
    if id.is_empty() {
        id = "Style".to_string();
    }
    let mut candidate = id.clone();
    let mut counter = 1;
    while used.contains(&candidate) {
        counter += 1;
        candidate = format!("{id}{counter}");
    }
    candidate
}

impl StyleSheet {
    pub fn empty() -> StyleSheet {
        StyleSheet {
            styles: Vec::new(),
            ftc_standard: [None, None, None],
        }
    }

    pub fn parse(stsh: &[u8]) -> StyleSheet {
        let Some(cb_stshi) = read_u16(stsh, 0) else {
            return StyleSheet::empty();
        };
        let cb_stshi = cb_stshi as usize;
        let stshi = &stsh[2..(2 + cb_stshi).min(stsh.len())];
        let cstd = read_u16(stshi, 0).unwrap_or(0) as usize;
        let cb_std_base = read_u16(stshi, 2).unwrap_or(10) as usize;
        let ftc_standard = [
            read_u16(stshi, 12),
            read_u16(stshi, 14),
            read_u16(stshi, 16),
        ];

        let mut styles: Vec<Option<StyleDef>> = Vec::with_capacity(cstd);
        let mut used_ids: HashSet<String> = HashSet::new();
        let mut pos = 2 + cb_stshi;

        for istd in 0..cstd {
            let Some(cb_std) = read_u16(stsh, pos) else {
                break;
            };
            let cb_std = cb_std as usize;
            let record_start = pos + 2;
            pos = record_start + cb_std;
            if cb_std % 2 == 1 {
                pos += 1;
            }
            if cb_std == 0 {
                styles.push(None);
                continue;
            }
            let Some(record) = stsh.get(record_start..record_start + cb_std) else {
                styles.push(None);
                continue;
            };
            if let Some(mut def) = parse_std(record, cb_std_base, istd as u16) {
                def.style_id = style_id_from_name(&def.name, &used_ids);
                used_ids.insert(def.style_id.clone());
                styles.push(Some(def));
            } else {
                styles.push(None);
            }
        }

        let mut sheet = StyleSheet {
            styles,
            ftc_standard,
        };
        sheet.resolve_toggles();
        sheet
    }

    fn resolve_toggles(&mut self) {
        let count = self.styles.len();
        let mut resolved: Vec<Option<ToggleSet>> = vec![None; count];
        for istd in 0..count {
            self.resolve_toggles_for(istd, &mut resolved, 0);
        }
        for (istd, toggles) in resolved.into_iter().enumerate() {
            if let (Some(style), Some(toggles)) = (self.styles[istd].as_mut(), toggles) {
                style.resolved_toggles = toggles;
            }
        }
    }

    fn resolve_toggles_for(
        &self,
        istd: usize,
        resolved: &mut Vec<Option<ToggleSet>>,
        depth: usize,
    ) -> ToggleSet {
        if depth > 16 {
            return ToggleSet::default();
        }
        if let Some(Some(toggles)) = resolved.get(istd) {
            return *toggles;
        }
        let Some(Some(style)) = self.styles.get(istd) else {
            return ToggleSet::default();
        };
        let mut toggles = if style.istd_base != ISTD_NIL && (style.istd_base as usize) < self.styles.len()
        {
            self.resolve_toggles_for(style.istd_base as usize, resolved, depth + 1)
        } else {
            ToggleSet::default()
        };
        toggles.apply_style_grpprl(&style.chpx);
        resolved[istd] = Some(toggles);
        toggles
    }

    pub fn style(&self, istd: u16) -> Option<&StyleDef> {
        self.styles.get(istd as usize).and_then(|slot| slot.as_ref())
    }

    pub fn style_id(&self, istd: u16) -> Option<String> {
        self.style(istd).map(|style| style.style_id.clone())
    }

    pub fn toggles(&self, istd: u16) -> ToggleSet {
        self.style(istd)
            .map(|style| style.resolved_toggles)
            .unwrap_or_default()
    }

    /// Effective toggle base for a run: paragraph style overlaid with the
    /// character style named in the run's CHPX (if any).
    pub fn run_toggle_base(&self, para_istd: u16, char_istd: Option<u16>) -> ToggleSet {
        let para = self.toggles(para_istd);
        match char_istd {
            Some(istd) => para.overlay(&self.toggles(istd)),
            None => para,
        }
    }

    /// Synthesizes word/styles.xml.
    pub fn to_styles_xml(&self, fonts: &FontTable, default_hps: u16) -> String {
        let mut xml = String::from(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">"#,
        );

        // Document defaults: standard fonts from STSHI, Word's 10pt baseline.
        xml.push_str("<w:docDefaults><w:rPrDefault><w:rPr>");
        if let Some(ftc) = self.ftc_standard[0] {
            if let Some(name) = fonts.name(ftc) {
                let escaped = escape_xml(&name);
                let east_asia = self.ftc_standard[1]
                    .and_then(|ftc| fonts.name(ftc))
                    .map(|name| escape_xml(&name))
                    .unwrap_or_else(|| escaped.clone());
                let other = self.ftc_standard[2]
                    .and_then(|ftc| fonts.name(ftc))
                    .map(|name| escape_xml(&name))
                    .unwrap_or_else(|| escaped.clone());
                xml.push_str(&format!(
                    r#"<w:rFonts w:ascii="{escaped}" w:hAnsi="{escaped}" w:eastAsia="{east_asia}" w:cs="{other}"/>"#
                ));
            }
        }
        xml.push_str(&format!(
            r#"<w:sz w:val="{default_hps}"/><w:szCs w:val="{default_hps}"/>"#
        ));
        xml.push_str("</w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>");

        for style in self.styles.iter().flatten() {
            if style.stk != STK_PARAGRAPH && style.stk != STK_CHARACTER {
                continue; // table/numbering styles are not emitted
            }
            let style_type = if style.stk == STK_PARAGRAPH {
                "paragraph"
            } else {
                "character"
            };
            let is_default = style.sti == 0 || style.sti == 65;
            xml.push_str(&format!(
                r#"<w:style w:type="{style_type}" w:styleId="{}"{}>"#,
                escape_xml(&style.style_id),
                if is_default { r#" w:default="1""# } else { "" }
            ));
            xml.push_str(&format!(r#"<w:name w:val="{}"/>"#, escape_xml(&style.name)));
            if style.istd_base != ISTD_NIL {
                if let Some(base_id) = self.style_id(style.istd_base) {
                    xml.push_str(&format!(r#"<w:basedOn w:val="{}"/>"#, escape_xml(&base_id)));
                }
            }
            if style.istd_next != style.istd && style.istd_next != ISTD_NIL {
                if let Some(next_id) = self.style_id(style.istd_next) {
                    xml.push_str(&format!(r#"<w:next w:val="{}"/>"#, escape_xml(&next_id)));
                }
            }

            if style.stk == STK_PARAGRAPH && !style.papx.is_empty() {
                let mut pap = Pap::default();
                pap.apply_papx(&style.papx);
                let ppr_inner = pap.to_ppr_inner_xml(&|_| None);
                if !ppr_inner.is_empty() {
                    xml.push_str(&format!("<w:pPr>{ppr_inner}</w:pPr>"));
                }
            }
            if !style.chpx.is_empty() {
                let base = if style.istd_base != ISTD_NIL {
                    self.toggles(style.istd_base)
                } else {
                    ToggleSet::default()
                };
                let mut chp = Chp::default();
                chp.apply_chpx(&style.chpx, &base);
                let rpr = chp.to_rpr_xml(&|_| None, &|ftc| fonts.name(ftc));
                xml.push_str(&rpr);
            }
            xml.push_str("</w:style>");
        }

        xml.push_str("</w:styles>");
        xml
    }
}

/// Parses one STD record. `cb_std_base` is STSHI.cbSTDBaseInFile (10 for
/// Word 97, 18 when StdfPost2000 is present).
fn parse_std(record: &[u8], cb_std_base: usize, istd: u16) -> Option<StyleDef> {
    let word0 = read_u16(record, 0)?;
    let word1 = read_u16(record, 2)?;
    let word2 = read_u16(record, 4)?;
    let sti = word0 & 0x0FFF;
    let stk = (word1 & 0x000F) as u8;
    let istd_base = word1 >> 4;
    let cupx = (word2 & 0x000F) as usize;
    let istd_next = word2 >> 4;

    // Xstz name directly after the fixed STDF part.
    let name_offset = cb_std_base;
    let cch = read_u16(record, name_offset)? as usize;
    let mut name = String::new();
    for index in 0..cch {
        let unit = read_u16(record, name_offset + 2 + index * 2)?;
        name.push_str(&String::from_utf16_lossy(&[unit]));
    }

    // grupx starts after the name's null terminator, 2-byte aligned relative
    // to the start of the STD.
    let mut pos = name_offset + 2 + cch * 2 + 2;
    if pos % 2 == 1 {
        pos += 1;
    }

    let mut papx = Vec::new();
    let mut chpx = Vec::new();
    for upx_index in 0..cupx {
        let cb_upx = read_u16(record, pos)? as usize;
        let payload_start = pos + 2;
        let payload = record.get(payload_start..payload_start + cb_upx)?;
        if stk == STK_PARAGRAPH && upx_index == 0 {
            // upxPapx: istd (u16) then paragraph sprms.
            if payload.len() >= 2 {
                papx = payload[2..].to_vec();
            }
        } else {
            // The (only/last) chpx UPX.
            if chpx.is_empty() {
                chpx = payload.to_vec();
            }
        }
        pos = payload_start + cb_upx;
        if pos % 2 == 1 {
            pos += 1;
        }
    }

    Some(StyleDef {
        istd,
        sti,
        stk,
        istd_base,
        istd_next,
        name,
        style_id: String::new(),
        papx,
        chpx,
        resolved_toggles: ToggleSet::default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_std(
        sti: u16,
        stk: u8,
        istd_base: u16,
        istd_next: u16,
        name: &str,
        papx: &[u8],
        chpx: &[u8],
    ) -> Vec<u8> {
        let mut record = Vec::new();
        record.extend_from_slice(&sti.to_le_bytes());
        record.extend_from_slice(&((istd_base << 4) | stk as u16).to_le_bytes());
        let cupx: u16 = if stk == STK_PARAGRAPH { 2 } else { 1 };
        record.extend_from_slice(&((istd_next << 4) | cupx).to_le_bytes());
        record.extend_from_slice(&0u16.to_le_bytes()); // bchUpe
        record.extend_from_slice(&0u16.to_le_bytes()); // grfstd
        let units: Vec<u16> = name.encode_utf16().collect();
        record.extend_from_slice(&(units.len() as u16).to_le_bytes());
        for unit in &units {
            record.extend_from_slice(&unit.to_le_bytes());
        }
        record.extend_from_slice(&0u16.to_le_bytes());
        if record.len() % 2 == 1 {
            record.push(0);
        }
        if stk == STK_PARAGRAPH {
            let cb = (papx.len() + 2) as u16;
            record.extend_from_slice(&cb.to_le_bytes());
            record.extend_from_slice(&0u16.to_le_bytes()); // istd inside upxPapx
            record.extend_from_slice(papx);
            if record.len() % 2 == 1 {
                record.push(0);
            }
        }
        record.extend_from_slice(&(chpx.len() as u16).to_le_bytes());
        record.extend_from_slice(chpx);
        if record.len() % 2 == 1 {
            record.push(0);
        }
        record
    }

    fn build_stsh(stds: &[Vec<u8>]) -> Vec<u8> {
        let mut stshi = Vec::new();
        stshi.extend_from_slice(&(stds.len() as u16).to_le_bytes());
        stshi.extend_from_slice(&10u16.to_le_bytes()); // cbSTDBaseInFile
        stshi.extend_from_slice(&[0u8; 8]); // flags, stiMax, istdMax, nVer
        stshi.extend_from_slice(&0u16.to_le_bytes()); // ftc ascii
        stshi.extend_from_slice(&0u16.to_le_bytes());
        stshi.extend_from_slice(&0u16.to_le_bytes());

        let mut stsh = Vec::new();
        stsh.extend_from_slice(&(stshi.len() as u16).to_le_bytes());
        stsh.extend_from_slice(&stshi);
        for std_record in stds {
            stsh.extend_from_slice(&(std_record.len() as u16).to_le_bytes());
            stsh.extend_from_slice(std_record);
            if std_record.len() % 2 == 1 {
                stsh.push(0);
            }
        }
        stsh
    }

    #[test]
    fn parses_styles_and_resolves_toggles() {
        // Normal (istd 0), then a bold "Strong Para" based on Normal (istd 1),
        // then a style based on it that inverts bold (istd 2).
        let bold_on: Vec<u8> = vec![0x35, 0x08, 0x01];
        let bold_invert: Vec<u8> = vec![0x35, 0x08, 0x81];
        let stds = vec![
            build_std(0, STK_PARAGRAPH, ISTD_NIL, 0, "Normal", &[], &[]),
            build_std(20, STK_PARAGRAPH, 0, 1, "Strong Para", &[], &bold_on),
            build_std(21, STK_PARAGRAPH, 1, 2, "Unbold Para", &[], &bold_invert),
        ];
        let sheet = StyleSheet::parse(&build_stsh(&stds));

        assert_eq!(sheet.style_id(0).as_deref(), Some("Normal"));
        assert_eq!(sheet.style_id(1).as_deref(), Some("StrongPara"));
        assert_eq!(
            sheet.toggles(1).get(super::super::chp::Toggle::Bold),
            Some(true)
        );
        assert_eq!(
            sheet.toggles(2).get(super::super::chp::Toggle::Bold),
            Some(false)
        );

        let xml = sheet.to_styles_xml(&FontTable::empty(), 20);
        assert!(xml.contains(r#"<w:style w:type="paragraph" w:styleId="Normal" w:default="1">"#));
        assert!(xml.contains(r#"<w:basedOn w:val="Normal"/>"#));
        assert!(xml.contains("<w:b/>"));
    }

    #[test]
    fn skips_empty_slots() {
        let stds = vec![
            build_std(0, STK_PARAGRAPH, ISTD_NIL, 0, "Normal", &[], &[]),
            Vec::new(),
            build_std(65, STK_CHARACTER, ISTD_NIL, 2, "Default Paragraph Font", &[], &[]),
        ];
        // Manually splice an empty (cbStd == 0) slot.
        let mut stsh = build_stsh(&[stds[0].clone()]);
        // Fix cstd to 3.
        stsh[2] = 3;
        stsh.extend_from_slice(&0u16.to_le_bytes());
        let record = &stds[2];
        stsh.extend_from_slice(&(record.len() as u16).to_le_bytes());
        stsh.extend_from_slice(record);

        let sheet = StyleSheet::parse(&stsh);
        assert!(sheet.style(1).is_none());
        assert_eq!(sheet.style_id(2).as_deref(), Some("DefaultParagraphFont"));
    }
}
