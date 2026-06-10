//! List tables ([MS-DOC] 2.9.131 PlfLst / 2.9.130 PlfLfo): list definitions
//! (LSTF + per-level LVL) and list-format overrides (LFO/LFOLVL), emitted as
//! word/numbering.xml. A paragraph's sprmPIlfo is a 1-based LFO index, which
//! maps directly to the synthesized w:numId.

use super::chp::{Chp, ToggleSet};
use super::fmt::escape_xml;
use super::fonts::FontTable;
use super::pap::Pap;
use super::sprm::{self, SGC_CHR, SGC_PAR};

#[derive(Debug, Clone, Default)]
pub struct ListLevel {
    pub start_at: u32,
    pub nfc: u8,
    pub jc: u8,
    pub xst: Vec<u16>,
    pub ixch_follow: u8,
    pub papx: Vec<u8>,
    pub chpx: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct ListData {
    pub lsid: u32,
    pub levels: Vec<ListLevel>,
}

#[derive(Debug, Clone)]
pub struct LfoLevelOverride {
    pub ilvl: u8,
    pub start_at: Option<u32>,
    pub level: Option<ListLevel>,
}

#[derive(Debug, Clone)]
pub struct ListOverride {
    pub lsid: u32,
    pub levels: Vec<LfoLevelOverride>,
}

#[derive(Debug, Default)]
pub struct ListTables {
    pub lists: Vec<ListData>,
    pub lfos: Vec<ListOverride>,
}

fn read_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    bytes
        .get(offset..offset + 2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    bytes
        .get(offset..offset + 4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

/// Parses one LVL structure, returning it plus the new cursor position.
fn parse_lvl(bytes: &[u8], pos: usize) -> Option<(ListLevel, usize)> {
    let start_at = read_u32(bytes, pos)?;
    let nfc = *bytes.get(pos + 4)?;
    let flags = *bytes.get(pos + 5)?;
    let ixch_follow = *bytes.get(pos + 15)?;
    let cb_chpx = *bytes.get(pos + 24)? as usize;
    let cb_papx = *bytes.get(pos + 25)? as usize;
    let mut cursor = pos + 28;

    let mut papx = bytes.get(cursor..cursor + cb_papx)?.to_vec();
    cursor += cb_papx;
    let mut chpx = bytes.get(cursor..cursor + cb_chpx)?.to_vec();
    cursor += cb_chpx;

    // Defensive: the two grpprls are distinguishable by sprm category; swap if
    // a writer ordered them the other way around.
    let looks_like = |grpprl: &[u8], sgc: u8| {
        sprm::iterate(grpprl)
            .next()
            .map(|sprm| sprm.sgc() == sgc)
            .unwrap_or(true)
    };
    if !papx.is_empty()
        && !looks_like(&papx, SGC_PAR)
        && looks_like(&papx, SGC_CHR)
        && (chpx.is_empty() || looks_like(&chpx, SGC_PAR))
    {
        std::mem::swap(&mut papx, &mut chpx);
    }

    let cch = read_u16(bytes, cursor)? as usize;
    cursor += 2;
    let mut xst = Vec::with_capacity(cch);
    for index in 0..cch {
        xst.push(read_u16(bytes, cursor + index * 2)?);
    }
    cursor += cch * 2;

    Some((
        ListLevel {
            start_at,
            nfc,
            jc: flags & 0x03,
            xst,
            ixch_follow,
            papx,
            chpx,
        },
        cursor,
    ))
}

impl ListTables {
    pub fn parse(plf_lst: Option<&[u8]>, plf_lfo: Option<&[u8]>) -> ListTables {
        let mut tables = ListTables::default();
        if let Some(plf_lst) = plf_lst {
            tables.parse_plf_lst(plf_lst);
        }
        if let Some(plf_lfo) = plf_lfo {
            tables.parse_plf_lfo(plf_lfo);
        }
        tables
    }

    fn parse_plf_lst(&mut self, bytes: &[u8]) {
        let Some(count) = read_u16(bytes, 0) else {
            return;
        };
        let count = count as usize;
        const LSTF_SIZE: usize = 28;
        let mut headers = Vec::with_capacity(count);
        for index in 0..count {
            let offset = 2 + index * LSTF_SIZE;
            let Some(lsid) = read_u32(bytes, offset) else {
                return;
            };
            let Some(&flags) = bytes.get(offset + 26) else {
                return;
            };
            headers.push((lsid, flags & 0x01 != 0)); // (lsid, fSimpleList)
        }

        let mut pos = 2 + count * LSTF_SIZE;
        for (lsid, simple) in headers {
            let level_count = if simple { 1 } else { 9 };
            let mut levels = Vec::with_capacity(level_count);
            for _ in 0..level_count {
                match parse_lvl(bytes, pos) {
                    Some((level, next)) => {
                        levels.push(level);
                        pos = next;
                    }
                    None => break,
                }
            }
            self.lists.push(ListData { lsid, levels });
        }
    }

    fn parse_plf_lfo(&mut self, bytes: &[u8]) {
        let Some(count) = read_u32(bytes, 0) else {
            return;
        };
        let count = count as usize;
        const LFO_SIZE: usize = 16;
        let mut headers = Vec::with_capacity(count);
        for index in 0..count {
            let offset = 4 + index * LFO_SIZE;
            let Some(lsid) = read_u32(bytes, offset) else {
                return;
            };
            let Some(&clfolvl) = bytes.get(offset + 12) else {
                return;
            };
            headers.push((lsid, clfolvl as usize));
        }

        let mut pos = 4 + count * LFO_SIZE;
        for (lsid, clfolvl) in headers {
            let mut levels = Vec::with_capacity(clfolvl);
            for _ in 0..clfolvl {
                let Some(start_at) = read_u32(bytes, pos) else {
                    break;
                };
                let Some(flags) = read_u32(bytes, pos + 4) else {
                    break;
                };
                pos += 8;
                let ilvl = (flags & 0x0F) as u8;
                let f_start_at = flags & 0x10 != 0;
                let f_formatting = flags & 0x20 != 0;
                let mut level = None;
                if f_formatting {
                    if let Some((lvl, next)) = parse_lvl(bytes, pos) {
                        level = Some(lvl);
                        pos = next;
                    }
                }
                levels.push(LfoLevelOverride {
                    ilvl,
                    start_at: f_start_at.then_some(start_at),
                    level,
                });
            }
            self.lfos.push(ListOverride { lsid, levels });
        }
    }

    pub fn is_empty(&self) -> bool {
        self.lists.is_empty() && self.lfos.is_empty()
    }

    fn abstract_num_id_for_lsid(&self, lsid: u32) -> Option<usize> {
        self.lists.iter().position(|list| list.lsid == lsid)
    }

    /// Synthesizes word/numbering.xml. Returns None when there are no lists.
    pub fn to_numbering_xml(&self, fonts: &FontTable) -> Option<String> {
        if self.is_empty() {
            return None;
        }
        let mut xml = String::from(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">"#,
        );

        for (index, list) in self.lists.iter().enumerate() {
            xml.push_str(&format!(r#"<w:abstractNum w:abstractNumId="{index}">"#));
            xml.push_str(&format!(
                r#"<w:multiLevelType w:val="{}"/>"#,
                if list.levels.len() == 1 {
                    "singleLevel"
                } else {
                    "hybridMultilevel"
                }
            ));
            for (ilvl, level) in list.levels.iter().enumerate() {
                xml.push_str(&level_xml(ilvl as u8, level, fonts));
            }
            xml.push_str("</w:abstractNum>");
        }

        for (index, lfo) in self.lfos.iter().enumerate() {
            let num_id = index + 1; // sprmPIlfo is 1-based
            let abstract_id = match self.abstract_num_id_for_lsid(lfo.lsid) {
                Some(id) => id,
                None => continue,
            };
            xml.push_str(&format!(r#"<w:num w:numId="{num_id}">"#));
            xml.push_str(&format!(r#"<w:abstractNumId w:val="{abstract_id}"/>"#));
            for level_override in &lfo.levels {
                xml.push_str(&format!(
                    r#"<w:lvlOverride w:ilvl="{}">"#,
                    level_override.ilvl
                ));
                if let Some(start) = level_override.start_at {
                    xml.push_str(&format!(r#"<w:startOverride w:val="{start}"/>"#));
                }
                if let Some(level) = &level_override.level {
                    xml.push_str(&level_xml(level_override.ilvl, level, fonts));
                }
                xml.push_str("</w:lvlOverride>");
            }
            xml.push_str("</w:num>");
        }

        xml.push_str("</w:numbering>");
        Some(xml)
    }
}

fn level_xml(ilvl: u8, level: &ListLevel, fonts: &FontTable) -> String {
    let mut xml = format!(r#"<w:lvl w:ilvl="{ilvl}">"#);
    xml.push_str(&format!(r#"<w:start w:val="{}"/>"#, level.start_at));
    xml.push_str(&format!(
        r#"<w:numFmt w:val="{}"/>"#,
        match level.nfc {
            0 => "decimal",
            1 => "upperRoman",
            2 => "lowerRoman",
            3 => "upperLetter",
            4 => "lowerLetter",
            5 => "ordinal",
            6 => "cardinalText",
            7 => "ordinalText",
            22 => "decimalZero",
            23 => "bullet",
            255 => "none",
            _ => "decimal",
        }
    ));

    if level.ixch_follow != 0 {
        xml.push_str(&format!(
            r#"<w:suff w:val="{}"/>"#,
            if level.ixch_follow == 1 { "space" } else { "nothing" }
        ));
    }

    // Level text: placeholder code units 0x0000-0x0008 become %1-%9.
    let mut text = String::new();
    for &unit in &level.xst {
        if unit <= 0x0008 {
            text.push('%');
            text.push_str(&(unit + 1).to_string());
        } else {
            text.push_str(&String::from_utf16_lossy(&[unit]));
        }
    }
    xml.push_str(&format!(r#"<w:lvlText w:val="{}"/>"#, escape_xml(&text)));
    xml.push_str(&format!(
        r#"<w:lvlJc w:val="{}"/>"#,
        match level.jc {
            1 => "center",
            2 => "right",
            _ => "left",
        }
    ));

    if !level.papx.is_empty() {
        let mut pap = Pap::default();
        pap.apply_papx(&level.papx);
        let inner = pap.to_ppr_inner_xml(&|_| None);
        if !inner.is_empty() {
            xml.push_str(&format!("<w:pPr>{inner}</w:pPr>"));
        }
    }
    if !level.chpx.is_empty() {
        let mut chp = Chp::default();
        chp.apply_chpx(&level.chpx, &ToggleSet::default());
        xml.push_str(&chp.to_rpr_xml(&|_| None, &|ftc| fonts.name(ftc)));
    }

    xml.push_str("</w:lvl>");
    xml
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_lvl(start: u32, nfc: u8, xst: &[u16], papx: &[u8], chpx: &[u8]) -> Vec<u8> {
        let mut lvl = Vec::new();
        lvl.extend_from_slice(&start.to_le_bytes());
        lvl.push(nfc);
        lvl.push(0); // flags
        lvl.extend_from_slice(&[0u8; 9]); // rgbxchNums
        lvl.push(0); // ixchFollow = tab
        lvl.extend_from_slice(&[0u8; 8]); // dxaIndentSav + unused
        lvl.push(chpx.len() as u8);
        lvl.push(papx.len() as u8);
        lvl.extend_from_slice(&[0u8; 2]);
        lvl.extend_from_slice(papx);
        lvl.extend_from_slice(chpx);
        lvl.extend_from_slice(&(xst.len() as u16).to_le_bytes());
        for unit in xst {
            lvl.extend_from_slice(&unit.to_le_bytes());
        }
        lvl
    }

    #[test]
    fn parses_simple_list_and_lfo() {
        // One simple list (lsid 500) with a decimal "%1." level.
        let mut plf_lst = Vec::new();
        plf_lst.extend_from_slice(&1u16.to_le_bytes());
        let mut lstf = vec![0u8; 28];
        lstf[..4].copy_from_slice(&500u32.to_le_bytes());
        lstf[26] = 0x01; // fSimpleList
        plf_lst.extend_from_slice(&lstf);
        let indent: Vec<u8> = vec![0x0F, 0x84, 0xD0, 0x02]; // dxaLeft 720
        plf_lst.extend_from_slice(&build_lvl(1, 0, &[0x0000, '.' as u16], &indent, &[]));

        let mut plf_lfo = Vec::new();
        plf_lfo.extend_from_slice(&1u32.to_le_bytes());
        let mut lfo = vec![0u8; 16];
        lfo[..4].copy_from_slice(&500u32.to_le_bytes());
        plf_lfo.extend_from_slice(&lfo);

        let tables = ListTables::parse(Some(&plf_lst), Some(&plf_lfo));
        assert_eq!(tables.lists.len(), 1);
        assert_eq!(tables.lists[0].levels.len(), 1);
        assert_eq!(tables.lfos.len(), 1);

        let xml = tables.to_numbering_xml(&FontTable::empty()).expect("xml");
        assert!(xml.contains(r#"<w:abstractNum w:abstractNumId="0">"#));
        assert!(xml.contains(r#"<w:lvlText w:val="%1."/>"#));
        assert!(xml.contains(r#"<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>"#));
        assert!(xml.contains(r#"w:left="720""#));
    }
}
