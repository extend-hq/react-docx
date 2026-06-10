//! Character properties (CHP): accumulated from style defaults plus CHPX sprm
//! deltas, then emitted as OOXML `<w:rPr>` direct formatting.

use super::fmt::{
    colorref_to_hex, escape_xml, ico_to_hex, ico_to_highlight, kul_to_val, Shading,
};
use super::sprm::{self, Sprm};

pub const TOGGLE_COUNT: usize = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Toggle {
    Bold = 0,
    Italic = 1,
    Strike = 2,
    Outline = 3,
    Shadow = 4,
    SmallCaps = 5,
    Caps = 6,
    Vanish = 7,
    Emboss = 8,
    Imprint = 9,
}

fn toggle_for_opcode(opcode: u16) -> Option<Toggle> {
    Some(match opcode {
        0x0835 => Toggle::Bold,
        0x0836 => Toggle::Italic,
        0x0837 => Toggle::Strike,
        0x0838 => Toggle::Outline,
        0x0839 => Toggle::Shadow,
        0x083A => Toggle::SmallCaps,
        0x083B => Toggle::Caps,
        0x083C => Toggle::Vanish,
        0x0858 => Toggle::Emboss,
        0x0854 => Toggle::Imprint,
        _ => return None,
    })
}

/// Per-toggle tri-state used while resolving style chains: None = the chain
/// never mentions the property.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ToggleSet {
    pub values: [Option<bool>; TOGGLE_COUNT],
}

impl ToggleSet {
    pub fn get(&self, toggle: Toggle) -> Option<bool> {
        self.values[toggle as usize]
    }

    pub fn set(&mut self, toggle: Toggle, value: Option<bool>) {
        self.values[toggle as usize] = value;
    }

    /// Applies the toggle sprms of a style-chain grpprl on top of this set.
    pub fn apply_style_grpprl(&mut self, grpprl: &[u8]) {
        for sprm in sprm::iterate(grpprl) {
            if let Some(toggle) = toggle_for_opcode(sprm.opcode) {
                let current = self.get(toggle).unwrap_or(false);
                match sprm.byte() {
                    0 => self.set(toggle, Some(false)),
                    1 => self.set(toggle, Some(true)),
                    0x80 => {}
                    0x81 => self.set(toggle, Some(!current)),
                    _ => {}
                }
            }
        }
    }

    /// Overlays `other` (e.g. a character style) on top of this set.
    pub fn overlay(&self, other: &ToggleSet) -> ToggleSet {
        let mut merged = *self;
        for index in 0..TOGGLE_COUNT {
            if other.values[index].is_some() {
                merged.values[index] = other.values[index];
            }
        }
        merged
    }
}

/// Character properties as OOXML-ready deltas; `None` everywhere means
/// "inherit from the referenced styles".
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Chp {
    pub istd: Option<u16>,
    pub toggles: [Option<bool>; TOGGLE_COUNT],
    pub dstrike: Option<bool>,
    pub kul: Option<u8>,
    pub ico: Option<u8>,
    pub cv: Option<[u8; 4]>,
    pub hps: Option<u16>,
    pub hps_pos: Option<i16>,
    pub iss: Option<u8>,
    pub ftc_ascii: Option<u16>,
    pub ftc_fe: Option<u16>,
    pub ftc_other: Option<u16>,
    pub kern: Option<u16>,
    pub dxa_space: Option<i16>,
    pub char_scale: Option<u16>,
    pub highlight: Option<u8>,
    pub shd: Option<Shading>,
    pub f_spec: bool,
    pub f_obj: bool,
    pub f_ole2: bool,
    pub f_data: bool,
    pub pic_location: Option<u32>,
    pub symbol: Option<(u16, u16)>,
}

impl Chp {
    /// Applies a CHPX grpprl. `base_toggles` carries the values the style sheet
    /// produces for this run (paragraph style overlaid with any character
    /// style), needed for the 0x81 "invert style value" toggle operand.
    pub fn apply_chpx(&mut self, grpprl: &[u8], base_toggles: &ToggleSet) {
        for sprm in sprm::iterate(grpprl) {
            self.apply_sprm(&sprm, base_toggles);
        }
    }

    pub fn apply_sprm(&mut self, sprm: &Sprm<'_>, base_toggles: &ToggleSet) {
        if let Some(toggle) = toggle_for_opcode(sprm.opcode) {
            let style_value = base_toggles.get(toggle).unwrap_or(false);
            match sprm.byte() {
                0 => self.toggles[toggle as usize] = Some(false),
                1 => self.toggles[toggle as usize] = Some(true),
                0x80 => self.toggles[toggle as usize] = None,
                0x81 => self.toggles[toggle as usize] = Some(!style_value),
                _ => {}
            }
            return;
        }
        match sprm.opcode {
            0x4A30 => self.istd = Some(sprm.u16_operand()),
            0x2A53 => self.dstrike = Some(sprm.byte() == 1),
            0x2A3E => self.kul = Some(sprm.byte()),
            0x2A42 => self.ico = Some(sprm.byte()),
            0x6870 => {
                let mut cv = [0u8; 4];
                cv.copy_from_slice(sprm.operand.get(..4).unwrap_or(&[0, 0, 0, 0xFF]));
                self.cv = Some(cv);
            }
            0x4A43 => self.hps = Some(sprm.u16_operand()),
            0x4845 => self.hps_pos = Some(sprm.i16_operand()),
            0x2A48 => self.iss = Some(sprm.byte()),
            0x4A4F => self.ftc_ascii = Some(sprm.u16_operand()),
            0x4A50 => self.ftc_fe = Some(sprm.u16_operand()),
            0x4A51 => self.ftc_other = Some(sprm.u16_operand()),
            0x484B => self.kern = Some(sprm.u16_operand()),
            0x8840 => self.dxa_space = Some(sprm.i16_operand()),
            0x852A => self.char_scale = Some(sprm.u16_operand()),
            0x2A0C => self.highlight = Some(sprm.byte()),
            0x4866 => self.shd = super::fmt::parse_shd80(sprm.u16_operand()),
            0xCA71 => self.shd = super::fmt::parse_shd_operand(sprm.operand),
            0x0855 => self.f_spec = sprm.byte() == 1,
            0x0856 => self.f_obj = sprm.byte() == 1,
            0x080A => self.f_ole2 = sprm.byte() == 1,
            0x0806 => self.f_data = sprm.byte() == 1,
            0x6A03 => self.pic_location = Some(sprm.u32_operand()),
            0x6A09 => {
                if sprm.operand.len() >= 4 {
                    let ftc = u16::from_le_bytes([sprm.operand[0], sprm.operand[1]]);
                    let xchar = u16::from_le_bytes([sprm.operand[2], sprm.operand[3]]);
                    self.symbol = Some((ftc, xchar));
                }
            }
            _ => {}
        }
    }

    fn toggle_xml(&self, toggle: Toggle, tag: &str, out: &mut String) {
        match self.toggles[toggle as usize] {
            Some(true) => out.push_str(&format!("<{tag}/>")),
            Some(false) => out.push_str(&format!(r#"<{tag} w:val="0"/>"#)),
            None => {}
        }
    }

    /// Emits the `<w:rPr>` element for this run's direct formatting, or an
    /// empty string when there is nothing to emit. `style_id` resolves a
    /// character-style istd to its OOXML styleId; `font_name` resolves an ftc
    /// index into the font table.
    pub fn to_rpr_xml(
        &self,
        style_id: &impl Fn(u16) -> Option<String>,
        font_name: &impl Fn(u16) -> Option<String>,
    ) -> String {
        let mut inner = String::new();

        if let Some(istd) = self.istd {
            // istd 10 is "Default Paragraph Font" — the implicit default.
            if istd != 10 {
                if let Some(id) = style_id(istd) {
                    inner.push_str(&format!(r#"<w:rStyle w:val="{}"/>"#, escape_xml(&id)));
                }
            }
        }

        let ascii = self.ftc_ascii.and_then(font_name);
        let east_asia = self.ftc_fe.and_then(font_name);
        let other = self.ftc_other.and_then(font_name);
        if ascii.is_some() || east_asia.is_some() || other.is_some() {
            let mut fonts = String::from("<w:rFonts");
            if let Some(name) = &ascii {
                fonts.push_str(&format!(
                    r#" w:ascii="{0}" w:hAnsi="{0}""#,
                    escape_xml(name)
                ));
            }
            if let Some(name) = &east_asia {
                fonts.push_str(&format!(r#" w:eastAsia="{}""#, escape_xml(name)));
            }
            if let Some(name) = &other {
                fonts.push_str(&format!(r#" w:cs="{}""#, escape_xml(name)));
            }
            fonts.push_str("/>");
            inner.push_str(&fonts);
        }

        self.toggle_xml(Toggle::Bold, "w:b", &mut inner);
        self.toggle_xml(Toggle::Italic, "w:i", &mut inner);
        self.toggle_xml(Toggle::Caps, "w:caps", &mut inner);
        self.toggle_xml(Toggle::SmallCaps, "w:smallCaps", &mut inner);
        self.toggle_xml(Toggle::Strike, "w:strike", &mut inner);
        if let Some(dstrike) = self.dstrike {
            inner.push_str(if dstrike {
                "<w:dstrike/>"
            } else {
                r#"<w:dstrike w:val="0"/>"#
            });
        }
        self.toggle_xml(Toggle::Outline, "w:outline", &mut inner);
        self.toggle_xml(Toggle::Shadow, "w:shadow", &mut inner);
        self.toggle_xml(Toggle::Emboss, "w:emboss", &mut inner);
        self.toggle_xml(Toggle::Imprint, "w:imprint", &mut inner);
        self.toggle_xml(Toggle::Vanish, "w:vanish", &mut inner);

        let color = self
            .cv
            .and_then(|cv| colorref_to_hex(&cv))
            .or_else(|| self.ico.and_then(|ico| ico_to_hex(ico).map(str::to_string)));
        if let Some(hex) = color {
            inner.push_str(&format!(r#"<w:color w:val="{hex}"/>"#));
        } else if self.cv.is_some() || self.ico == Some(0) {
            inner.push_str(r#"<w:color w:val="auto"/>"#);
        }

        if let Some(dxa) = self.dxa_space {
            inner.push_str(&format!(r#"<w:spacing w:val="{dxa}"/>"#));
        }
        if let Some(scale) = self.char_scale {
            inner.push_str(&format!(r#"<w:w w:val="{scale}"/>"#));
        }
        if let Some(kern) = self.kern {
            inner.push_str(&format!(r#"<w:kern w:val="{kern}"/>"#));
        }
        if let Some(pos) = self.hps_pos {
            inner.push_str(&format!(r#"<w:position w:val="{pos}"/>"#));
        }
        if let Some(hps) = self.hps {
            inner.push_str(&format!(
                r#"<w:sz w:val="{hps}"/><w:szCs w:val="{hps}"/>"#
            ));
        }
        if let Some(ico) = self.highlight {
            if let Some(name) = ico_to_highlight(ico) {
                inner.push_str(&format!(r#"<w:highlight w:val="{name}"/>"#));
            }
        }
        if let Some(kul) = self.kul {
            inner.push_str(&format!(r#"<w:u w:val="{}"/>"#, kul_to_val(kul)));
        }
        if let Some(shd) = &self.shd {
            inner.push_str(&shd.to_xml());
        }
        if let Some(iss) = self.iss {
            let val = match iss {
                1 => "superscript",
                2 => "subscript",
                _ => "baseline",
            };
            inner.push_str(&format!(r#"<w:vertAlign w:val="{val}"/>"#));
        }

        if inner.is_empty() {
            String::new()
        } else {
            format!("<w:rPr>{inner}</w:rPr>")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applies_basic_formatting_sprms() {
        // bold on, size 24 half-points, red color via cv.
        let grpprl: Vec<u8> = vec![
            0x35, 0x08, 0x01, //
            0x43, 0x4A, 0x18, 0x00, //
            0x70, 0x68, 0xFF, 0x00, 0x00, 0x00,
        ];
        let mut chp = Chp::default();
        chp.apply_chpx(&grpprl, &ToggleSet::default());
        assert_eq!(chp.toggles[Toggle::Bold as usize], Some(true));
        assert_eq!(chp.hps, Some(24));

        let rpr = chp.to_rpr_xml(&|_| None, &|_| None);
        assert!(rpr.contains("<w:b/>"));
        assert!(rpr.contains(r#"<w:sz w:val="24"/>"#));
        assert!(rpr.contains(r#"<w:color w:val="FF0000"/>"#));
    }

    #[test]
    fn toggle_invert_uses_style_value() {
        let grpprl: Vec<u8> = vec![0x35, 0x08, 0x81]; // bold = invert style
        let mut base = ToggleSet::default();
        base.set(Toggle::Bold, Some(true));
        let mut chp = Chp::default();
        chp.apply_chpx(&grpprl, &base);
        assert_eq!(chp.toggles[Toggle::Bold as usize], Some(false));
    }

    #[test]
    fn toggle_as_style_emits_nothing() {
        let grpprl: Vec<u8> = vec![0x35, 0x08, 0x80];
        let mut chp = Chp::default();
        chp.apply_chpx(&grpprl, &ToggleSet::default());
        assert_eq!(chp.toggles[Toggle::Bold as usize], None);
        assert_eq!(chp.to_rpr_xml(&|_| None, &|_| None), "");
    }
}
