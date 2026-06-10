//! Paragraph properties (PAP): style index plus PAPX sprm deltas, emitted as
//! OOXML `<w:pPr>` direct formatting. Table-related flags (fInTable, fTtp,
//! itap) drive table reconstruction in the document builder.

use super::fmt::{parse_brc80, parse_brc97, Border, Shading};
use super::sprm::{self, Sprm, SGC_TAB};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TabStop {
    pub dxa: i16,
    pub jc: u8,
    pub leader: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LineSpacing {
    pub dya_line: i16,
    pub f_mult: bool,
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct Pap {
    pub istd: u16,
    pub jc: Option<u8>,
    pub dxa_left: Option<i16>,
    pub dxa_right: Option<i16>,
    pub dxa_left1: Option<i16>,
    pub dya_before: Option<u16>,
    pub dya_after: Option<u16>,
    pub before_auto: Option<bool>,
    pub after_auto: Option<bool>,
    pub lspd: Option<LineSpacing>,
    pub contextual_spacing: Option<bool>,
    pub f_keep: Option<bool>,
    pub f_keep_follow: Option<bool>,
    pub f_page_break_before: Option<bool>,
    pub f_widow_control: Option<bool>,
    pub ilvl: Option<u8>,
    pub ilfo: Option<u16>,
    pub outline_lvl: Option<u8>,
    pub f_bidi: Option<bool>,
    pub brc_top: Option<Border>,
    pub brc_left: Option<Border>,
    pub brc_bottom: Option<Border>,
    pub brc_right: Option<Border>,
    pub brc_between: Option<Border>,
    pub shd: Option<Shading>,
    pub tabs_deleted: Vec<i16>,
    pub tabs_added: Vec<TabStop>,
    // Table structure flags.
    pub f_in_table: bool,
    pub f_ttp: bool,
    pub itap: u32,
    pub f_inner_table_cell: bool,
    pub f_inner_ttp: bool,
    /// Table sprms found in this paragraph's grpprl (row-end paragraphs carry
    /// the row's TAP definition).
    pub table_grpprl: Vec<u8>,
}

impl Pap {
    pub fn apply_papx(&mut self, grpprl: &[u8]) {
        for sprm in sprm::iterate(grpprl) {
            if sprm.sgc() == SGC_TAB {
                // Collect table sprms verbatim for TAP parsing.
                self.table_grpprl.extend_from_slice(&sprm_bytes(&sprm));
                continue;
            }
            self.apply_sprm(&sprm);
        }
    }

    fn apply_sprm(&mut self, sprm: &Sprm<'_>) {
        match sprm.opcode {
            0x4600 => self.istd = sprm.u16_operand(),
            0x2403 | 0x2461 => self.jc = Some(sprm.byte()),
            0x2405 => self.f_keep = sprm.bool_operand(),
            0x2406 => self.f_keep_follow = sprm.bool_operand(),
            0x2407 => self.f_page_break_before = sprm.bool_operand(),
            0x2431 => self.f_widow_control = sprm.bool_operand(),
            0x260A => self.ilvl = Some(sprm.byte()),
            0x460B => self.ilfo = Some(sprm.u16_operand()),
            0x840F | 0x845E => self.dxa_left = Some(sprm.i16_operand()),
            0x840E | 0x845D => self.dxa_right = Some(sprm.i16_operand()),
            0x8411 | 0x8460 => self.dxa_left1 = Some(sprm.i16_operand()),
            0x6412 => {
                if sprm.operand.len() >= 4 {
                    self.lspd = Some(LineSpacing {
                        dya_line: i16::from_le_bytes([sprm.operand[0], sprm.operand[1]]),
                        f_mult: i16::from_le_bytes([sprm.operand[2], sprm.operand[3]]) != 0,
                    });
                }
            }
            0xA413 => self.dya_before = Some(sprm.u16_operand()),
            0xA414 => self.dya_after = Some(sprm.u16_operand()),
            0x245B => self.before_auto = sprm.bool_operand(),
            0x245C => self.after_auto = sprm.bool_operand(),
            0x246D => self.contextual_spacing = sprm.bool_operand(),
            0x2640 => self.outline_lvl = Some(sprm.byte()),
            0x2441 => self.f_bidi = sprm.bool_operand(),
            0x2416 => self.f_in_table = sprm.byte() == 1,
            0x2417 => self.f_ttp = sprm.byte() == 1,
            0x6649 => self.itap = sprm.u32_operand(),
            0x244B => self.f_inner_table_cell = sprm.byte() == 1,
            0x244C => self.f_inner_ttp = sprm.byte() == 1,
            0x6424 => self.brc_top = parse_brc80(sprm.operand),
            0x6425 => self.brc_left = parse_brc80(sprm.operand),
            0x6426 => self.brc_bottom = parse_brc80(sprm.operand),
            0x6427 => self.brc_right = parse_brc80(sprm.operand),
            0x6428 => self.brc_between = parse_brc80(sprm.operand),
            0xC64E => self.brc_top = parse_brc97(sprm.operand),
            0xC64F => self.brc_left = parse_brc97(sprm.operand),
            0xC650 => self.brc_bottom = parse_brc97(sprm.operand),
            0xC651 => self.brc_right = parse_brc97(sprm.operand),
            0xC652 => self.brc_between = parse_brc97(sprm.operand),
            0x442D => self.shd = super::fmt::parse_shd80(sprm.u16_operand()),
            0xC64D => self.shd = super::fmt::parse_shd_operand(sprm.operand),
            0xC60D | 0xC615 => self.apply_tab_operand(sprm.operand, sprm.opcode == 0xC615),
            _ => {}
        }
    }

    /// PChgTabsPapx / PChgTabs operand: deletions then additions.
    fn apply_tab_operand(&mut self, operand: &[u8], has_close_array: bool) {
        let mut pos = 0usize;
        let Some(&del_count) = operand.first() else {
            return;
        };
        pos += 1;
        for index in 0..del_count as usize {
            let offset = pos + index * 2;
            if offset + 2 > operand.len() {
                return;
            }
            self.tabs_deleted
                .push(i16::from_le_bytes([operand[offset], operand[offset + 1]]));
        }
        pos += del_count as usize * 2;
        if has_close_array {
            pos += del_count as usize * 2; // rgdxaClose, tolerance windows — ignored
        }
        let Some(&add_count) = operand.get(pos) else {
            return;
        };
        pos += 1;
        let dxa_base = pos;
        let tbd_base = pos + add_count as usize * 2;
        for index in 0..add_count as usize {
            let dxa_offset = dxa_base + index * 2;
            let tbd_offset = tbd_base + index;
            if dxa_offset + 2 > operand.len() || tbd_offset >= operand.len() {
                return;
            }
            let tbd = operand[tbd_offset];
            self.tabs_added.push(TabStop {
                dxa: i16::from_le_bytes([operand[dxa_offset], operand[dxa_offset + 1]]),
                jc: tbd & 0x07,
                leader: (tbd >> 3) & 0x07,
            });
        }
    }

    /// Emits the inner content of `<w:pPr>` (without numPr/sectPr, which the
    /// document builder appends contextually). Returns "" when empty.
    pub fn to_ppr_inner_xml(&self, style_id: &impl Fn(u16) -> Option<String>) -> String {
        let mut inner = String::new();

        if self.istd != 0 {
            if let Some(id) = style_id(self.istd) {
                inner.push_str(&format!(
                    r#"<w:pStyle w:val="{}"/>"#,
                    super::fmt::escape_xml(&id)
                ));
            }
        }
        if let Some(keep) = self.f_keep {
            inner.push_str(if keep {
                "<w:keepLines/>"
            } else {
                r#"<w:keepLines w:val="0"/>"#
            });
        }
        if let Some(keep_next) = self.f_keep_follow {
            inner.push_str(if keep_next {
                "<w:keepNext/>"
            } else {
                r#"<w:keepNext w:val="0"/>"#
            });
        }
        if let Some(page_break) = self.f_page_break_before {
            inner.push_str(if page_break {
                "<w:pageBreakBefore/>"
            } else {
                r#"<w:pageBreakBefore w:val="0"/>"#
            });
        }
        if let Some(widow) = self.f_widow_control {
            inner.push_str(if widow {
                "<w:widowControl/>"
            } else {
                r#"<w:widowControl w:val="0"/>"#
            });
        }

        if let Some(numbering) = self.num_pr_xml() {
            inner.push_str(&numbering);
        }

        let borders: Vec<(&str, &Option<Border>)> = vec![
            ("w:top", &self.brc_top),
            ("w:left", &self.brc_left),
            ("w:bottom", &self.brc_bottom),
            ("w:right", &self.brc_right),
            ("w:between", &self.brc_between),
        ];
        if borders.iter().any(|(_, border)| border.is_some()) {
            inner.push_str("<w:pBdr>");
            for (tag, border) in borders {
                if let Some(border) = border {
                    inner.push_str(&border.to_xml(tag));
                }
            }
            inner.push_str("</w:pBdr>");
        }

        if let Some(shd) = &self.shd {
            inner.push_str(&shd.to_xml());
        }

        if !self.tabs_deleted.is_empty() || !self.tabs_added.is_empty() {
            inner.push_str("<w:tabs>");
            for dxa in &self.tabs_deleted {
                inner.push_str(&format!(r#"<w:tab w:val="clear" w:pos="{dxa}"/>"#));
            }
            for tab in &self.tabs_added {
                let val = match tab.jc {
                    1 => "center",
                    2 => "right",
                    3 => "decimal",
                    4 => "bar",
                    _ => "left",
                };
                let leader = match tab.leader {
                    1 => Some("dot"),
                    2 => Some("hyphen"),
                    3 => Some("underscore"),
                    4 => Some("heavy"),
                    5 => Some("middleDot"),
                    _ => None,
                };
                let mut tab_xml = format!(r#"<w:tab w:val="{val}" w:pos="{}""#, tab.dxa);
                if let Some(leader) = leader {
                    tab_xml.push_str(&format!(r#" w:leader="{leader}""#));
                }
                tab_xml.push_str("/>");
                inner.push_str(&tab_xml);
            }
            inner.push_str("</w:tabs>");
        }

        let has_spacing = self.dya_before.is_some()
            || self.dya_after.is_some()
            || self.lspd.is_some()
            || self.before_auto.is_some()
            || self.after_auto.is_some();
        if has_spacing {
            let mut spacing = String::from("<w:spacing");
            if let Some(before) = self.dya_before {
                spacing.push_str(&format!(r#" w:before="{before}""#));
            }
            if self.before_auto == Some(true) {
                spacing.push_str(r#" w:beforeAutospacing="1""#);
            }
            if let Some(after) = self.dya_after {
                spacing.push_str(&format!(r#" w:after="{after}""#));
            }
            if self.after_auto == Some(true) {
                spacing.push_str(r#" w:afterAutospacing="1""#);
            }
            if let Some(lspd) = self.lspd {
                let (line, rule) = if lspd.f_mult {
                    (lspd.dya_line as i32, "auto")
                } else if lspd.dya_line >= 0 {
                    (lspd.dya_line as i32, "atLeast")
                } else {
                    (-(lspd.dya_line as i32), "exact")
                };
                spacing.push_str(&format!(r#" w:line="{line}" w:lineRule="{rule}""#));
            }
            spacing.push_str("/>");
            inner.push_str(&spacing);
        }

        if self.contextual_spacing == Some(true) {
            inner.push_str("<w:contextualSpacing/>");
        }

        if self.dxa_left.is_some() || self.dxa_right.is_some() || self.dxa_left1.is_some() {
            let mut ind = String::from("<w:ind");
            if let Some(left) = self.dxa_left {
                ind.push_str(&format!(r#" w:left="{left}""#));
            }
            if let Some(right) = self.dxa_right {
                ind.push_str(&format!(r#" w:right="{right}""#));
            }
            if let Some(first) = self.dxa_left1 {
                if first >= 0 {
                    ind.push_str(&format!(r#" w:firstLine="{first}""#));
                } else {
                    ind.push_str(&format!(r#" w:hanging="{}""#, -(first as i32)));
                }
            }
            ind.push_str("/>");
            inner.push_str(&ind);
        }

        if let Some(jc) = self.jc {
            let val = match jc {
                1 => "center",
                2 => "right",
                3 => "both",
                4 => "distribute",
                _ => "left",
            };
            inner.push_str(&format!(r#"<w:jc w:val="{val}"/>"#));
        }

        if let Some(level) = self.outline_lvl {
            if level < 9 {
                inner.push_str(&format!(r#"<w:outlineLvl w:val="{level}"/>"#));
            }
        }
        if self.f_bidi == Some(true) {
            inner.push_str("<w:bidi/>");
        }

        inner
    }

    /// The w:numPr element when list formatting applies. ilfo 0 means "no
    /// list"; some writers use it to cancel inherited list membership.
    pub fn num_pr_xml(&self) -> Option<String> {
        let ilfo = self.ilfo?;
        if ilfo == 0 || ilfo == 0xF801 {
            return Some(r#"<w:numPr><w:numId w:val="0"/></w:numPr>"#.to_string());
        }
        let ilvl = self.ilvl.unwrap_or(0);
        Some(format!(
            r#"<w:numPr><w:ilvl w:val="{ilvl}"/><w:numId w:val="{ilfo}"/></w:numPr>"#
        ))
    }
}

fn sprm_bytes(sprm: &Sprm<'_>) -> Vec<u8> {
    let mut bytes = sprm.opcode.to_le_bytes().to_vec();
    let spra = (sprm.opcode >> 13) & 0x7;
    if spra == 6 {
        if sprm.opcode == 0xD608 || sprm.opcode == 0xD606 {
            bytes.extend_from_slice(&((sprm.operand.len() + 1) as u16).to_le_bytes());
        } else {
            bytes.push(sprm.operand.len() as u8);
        }
    }
    bytes.extend_from_slice(sprm.operand);
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applies_indent_and_justification() {
        let grpprl: Vec<u8> = vec![
            0x03, 0x24, 0x01, // jc center
            0x0F, 0x84, 0xD0, 0x02, // dxaLeft 720
            0x11, 0x84, 0x30, 0xFE, // dxaLeft1 -464 (hanging)
        ];
        let mut pap = Pap::default();
        pap.apply_papx(&grpprl);
        let xml = pap.to_ppr_inner_xml(&|_| None);
        assert!(xml.contains(r#"<w:jc w:val="center"/>"#));
        assert!(xml.contains(r#"w:left="720""#));
        assert!(xml.contains(r#"w:hanging="464""#));
    }

    #[test]
    fn separates_table_sprms() {
        let grpprl: Vec<u8> = vec![
            0x16, 0x24, 0x01, // fInTable
            0x17, 0x24, 0x01, // fTtp
            0x07, 0x94, 0x40, 0x01, // sprmTDyaRowHeight 320 (sgc=5)
        ];
        let mut pap = Pap::default();
        pap.apply_papx(&grpprl);
        assert!(pap.f_in_table);
        assert!(pap.f_ttp);
        assert_eq!(pap.table_grpprl, vec![0x07, 0x94, 0x40, 0x01]);
    }

    #[test]
    fn line_spacing_rules() {
        let mut pap = Pap::default();
        pap.lspd = Some(LineSpacing {
            dya_line: 480,
            f_mult: true,
        });
        let xml = pap.to_ppr_inner_xml(&|_| None);
        assert!(xml.contains(r#"w:line="480" w:lineRule="auto""#));

        let mut exact = Pap::default();
        exact.lspd = Some(LineSpacing {
            dya_line: -240,
            f_mult: false,
        });
        let xml = exact.to_ppr_inner_xml(&|_| None);
        assert!(xml.contains(r#"w:line="240" w:lineRule="exact""#));
    }
}
