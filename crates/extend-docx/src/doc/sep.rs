//! Section properties (SEP): parsed from SEPX grpprls located via PlcfSed,
//! emitted as OOXML `<w:sectPr>`. Page size/margins and the document grid
//! (sprmSClm / sprmSDyaLinePitch) are the layout-fidelity-critical fields.

use super::fmt::nfc_to_num_fmt;
use super::sprm::{self, Sprm};

#[derive(Debug, Clone)]
pub struct Sep {
    pub bkc: u8,
    pub f_title_page: bool,
    pub ccol_m1: u16,
    pub dxa_columns: u16,
    pub f_evenly_spaced: bool,
    pub col_widths: Vec<(u8, u16)>,
    pub nfc_pgn: Option<u8>,
    pub f_pgn_restart: bool,
    pub pgn_start: u16,
    pub xa_page: u32,
    pub ya_page: u32,
    pub orientation_landscape: bool,
    pub dxa_left: u32,
    pub dxa_right: u32,
    pub dya_top: i32,
    pub dya_bottom: i32,
    pub dza_gutter: u32,
    pub dya_hdr_top: u32,
    pub dya_hdr_bottom: u32,
    pub clm: u16,
    pub dya_line_pitch: u16,
    pub dxt_char_space: u32,
}

impl Default for Sep {
    fn default() -> Sep {
        // Word's defaults for a US Letter section.
        Sep {
            bkc: 2,
            f_title_page: false,
            ccol_m1: 0,
            dxa_columns: 708,
            f_evenly_spaced: true,
            col_widths: Vec::new(),
            nfc_pgn: None,
            f_pgn_restart: false,
            pgn_start: 1,
            xa_page: 12240,
            ya_page: 15840,
            orientation_landscape: false,
            dxa_left: 1800,
            dxa_right: 1800,
            dya_top: 1440,
            dya_bottom: 1440,
            dza_gutter: 0,
            dya_hdr_top: 720,
            dya_hdr_bottom: 720,
            clm: 0,
            dya_line_pitch: 0,
            dxt_char_space: 0,
        }
    }
}

impl Sep {
    pub fn apply_sepx(&mut self, grpprl: &[u8]) {
        for sprm in sprm::iterate(grpprl) {
            self.apply_sprm(&sprm);
        }
    }

    fn apply_sprm(&mut self, sprm: &Sprm<'_>) {
        match sprm.opcode {
            0x3009 => self.bkc = sprm.byte(),
            0x300A => self.f_title_page = sprm.byte() == 1,
            0x500B => self.ccol_m1 = sprm.u16_operand(),
            0x900C => self.dxa_columns = sprm.u16_operand(),
            0x3005 => self.f_evenly_spaced = sprm.byte() == 1,
            0xF203 => {
                if sprm.operand.len() >= 3 {
                    self.col_widths.push((
                        sprm.operand[0],
                        u16::from_le_bytes([sprm.operand[1], sprm.operand[2]]),
                    ));
                }
            }
            0x300E => self.nfc_pgn = Some(sprm.byte()),
            0x3011 => self.f_pgn_restart = sprm.byte() == 1,
            0x501C => self.pgn_start = sprm.u16_operand(),
            0xB01F => self.xa_page = sprm.u16_operand() as u32,
            0xB020 => self.ya_page = sprm.u16_operand() as u32,
            0x301D => self.orientation_landscape = sprm.byte() == 2,
            0xB021 => self.dxa_left = sprm.u16_operand() as u32,
            0xB022 => self.dxa_right = sprm.u16_operand() as u32,
            0x9023 => self.dya_top = sprm.i16_operand() as i32,
            0x9024 => self.dya_bottom = sprm.i16_operand() as i32,
            0xB025 => self.dza_gutter = sprm.u16_operand() as u32,
            0xB017 => self.dya_hdr_top = sprm.u16_operand() as u32,
            0xB018 => self.dya_hdr_bottom = sprm.u16_operand() as u32,
            0x5032 => self.clm = sprm.u16_operand(),
            0x9031 => self.dya_line_pitch = sprm.u16_operand(),
            0x7030 => self.dxt_char_space = sprm.u32_operand(),
            _ => {}
        }
    }

    /// Emits the inner content of `<w:sectPr>`; header/footer references and
    /// footnote settings are appended by the document builder.
    pub fn to_sect_pr_inner_xml(&self) -> String {
        let mut inner = String::new();

        let break_type = match self.bkc {
            0 => Some("continuous"),
            1 => Some("nextColumn"),
            3 => Some("evenPage"),
            4 => Some("oddPage"),
            _ => None, // 2 = nextPage, the default
        };
        if let Some(val) = break_type {
            inner.push_str(&format!(r#"<w:type w:val="{val}"/>"#));
        }

        inner.push_str(&format!(
            r#"<w:pgSz w:w="{}" w:h="{}"{}/>"#,
            self.xa_page,
            self.ya_page,
            if self.orientation_landscape {
                r#" w:orient="landscape""#
            } else {
                ""
            }
        ));
        inner.push_str(&format!(
            r#"<w:pgMar w:top="{}" w:right="{}" w:bottom="{}" w:left="{}" w:header="{}" w:footer="{}" w:gutter="{}"/>"#,
            self.dya_top,
            self.dxa_right,
            self.dya_bottom,
            self.dxa_left,
            self.dya_hdr_top,
            self.dya_hdr_bottom,
            self.dza_gutter
        ));

        if self.nfc_pgn.is_some() || self.f_pgn_restart {
            let mut pgn = String::from("<w:pgNumType");
            if let Some(nfc) = self.nfc_pgn {
                pgn.push_str(&format!(r#" w:fmt="{}""#, nfc_to_num_fmt(nfc)));
            }
            if self.f_pgn_restart {
                pgn.push_str(&format!(r#" w:start="{}""#, self.pgn_start));
            }
            pgn.push_str("/>");
            inner.push_str(&pgn);
        }

        if self.ccol_m1 > 0 {
            let mut cols = format!(
                r#"<w:cols w:num="{}" w:space="{}""#,
                self.ccol_m1 + 1,
                self.dxa_columns
            );
            if !self.f_evenly_spaced && !self.col_widths.is_empty() {
                cols.push_str(r#" w:equalWidth="0">"#);
                for (_, width) in &self.col_widths {
                    cols.push_str(&format!(
                        r#"<w:col w:w="{width}" w:space="{}"/>"#,
                        self.dxa_columns
                    ));
                }
                cols.push_str("</w:cols>");
            } else {
                cols.push_str("/>");
            }
            inner.push_str(&cols);
        }

        if self.f_title_page {
            inner.push_str("<w:titlePg/>");
        }

        if self.clm != 0 || self.dya_line_pitch != 0 {
            let grid_type = match self.clm {
                1 => "linesAndChars",
                2 => "lines",
                3 => "snapToChars",
                _ => "default",
            };
            let mut grid = format!(r#"<w:docGrid w:type="{grid_type}""#);
            if self.dya_line_pitch != 0 {
                grid.push_str(&format!(r#" w:linePitch="{}""#, self.dya_line_pitch));
            }
            if self.dxt_char_space != 0 {
                grid.push_str(&format!(r#" w:charSpace="{}""#, self.dxt_char_space));
            }
            grid.push_str("/>");
            inner.push_str(&grid);
        }

        inner
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emits_page_size_and_grid() {
        let grpprl: Vec<u8> = vec![
            0x1F, 0xB0, 0xB0, 0x29, // xaPage 10672? -> 0x29B0 = 10672
            0x20, 0xB0, 0x84, 0x3D, // yaPage 0x3D84 = 15748
            0x32, 0x50, 0x01, 0x00, // clm = 1
            0x31, 0x90, 0x6F, 0x01, // linePitch 367
        ];
        let mut sep = Sep::default();
        sep.apply_sepx(&grpprl);
        let xml = sep.to_sect_pr_inner_xml();
        assert!(xml.contains(r#"<w:pgSz w:w="10672" w:h="15748"/>"#));
        assert!(xml.contains(r#"<w:docGrid w:type="linesAndChars" w:linePitch="367"/>"#));
    }

    #[test]
    fn continuous_break_and_columns() {
        let grpprl: Vec<u8> = vec![
            0x09, 0x30, 0x00, // bkc continuous
            0x0B, 0x50, 0x01, 0x00, // 2 columns
        ];
        let mut sep = Sep::default();
        sep.apply_sepx(&grpprl);
        let xml = sep.to_sect_pr_inner_xml();
        assert!(xml.contains(r#"<w:type w:val="continuous"/>"#));
        assert!(xml.contains(r#"<w:cols w:num="2" w:space="708"/>"#));
    }
}
