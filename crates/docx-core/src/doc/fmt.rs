//! Shared primitives for mapping binary formatting structures (colors, borders,
//! shading) onto their OOXML equivalents, plus XML string helpers.

pub fn escape_xml(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(ch),
        }
    }
    out
}

/// Classic 17-entry Word color palette (ico values 1-16; 0 = auto).
const ICO_PALETTE: [&str; 17] = [
    "auto", "000000", "0000FF", "00FFFF", "00FF00", "FF00FF", "FF0000", "FFFF00", "FFFFFF",
    "000080", "008080", "008000", "800080", "800000", "808000", "808080", "C0C0C0",
];

pub fn ico_to_hex(ico: u8) -> Option<&'static str> {
    match ico as usize {
        0 => None,
        index if index < ICO_PALETTE.len() => Some(ICO_PALETTE[index]),
        _ => None,
    }
}

pub fn ico_to_highlight(ico: u8) -> Option<&'static str> {
    Some(match ico {
        1 => "black",
        2 => "blue",
        3 => "cyan",
        4 => "green",
        5 => "magenta",
        6 => "red",
        7 => "yellow",
        8 => "white",
        9 => "darkBlue",
        10 => "darkCyan",
        11 => "darkGreen",
        12 => "darkMagenta",
        13 => "darkRed",
        14 => "darkYellow",
        15 => "darkGray",
        16 => "lightGray",
        _ => return None,
    })
}

/// COLORREF ([MS-DOC] 2.9.39): bytes R, G, B, fAuto. Returns hex or None for auto.
pub fn colorref_to_hex(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 4 || bytes[3] == 0xFF {
        return None;
    }
    Some(format!("{:02X}{:02X}{:02X}", bytes[0], bytes[1], bytes[2]))
}

fn brc_type_to_val(brc_type: u8) -> Option<&'static str> {
    Some(match brc_type {
        0 | 255 => return None,
        1 => "single",
        2 => "thick",
        3 => "double",
        5 => "single", // hairline
        6 => "dotted",
        7 => "dashed",
        8 => "dotDash",
        9 => "dotDotDash",
        10 => "triple",
        11 => "thinThickSmallGap",
        12 => "thickThinSmallGap",
        13 => "thinThickThinSmallGap",
        14 => "thinThickMediumGap",
        15 => "thickThinMediumGap",
        16 => "thinThickThinMediumGap",
        17 => "thinThickLargeGap",
        18 => "thickThinLargeGap",
        19 => "thinThickThinLargeGap",
        20 => "wave",
        21 => "doubleWave",
        22 => "dashSmallGap",
        23 => "dashDotStroked",
        24 => "threeDEmboss",
        25 => "threeDEngrave",
        26 => "outset",
        27 => "inset",
        _ => "single",
    })
}

/// A border ready for OOXML emission.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Border {
    pub val: &'static str,
    /// Eighths of a point (same unit as the binary dptLineWidth and OOXML w:sz).
    pub sz: u8,
    pub color: Option<String>,
    pub space: u8,
    pub shadow: bool,
}

impl Border {
    pub fn to_xml(&self, tag: &str) -> String {
        let mut xml = format!(r#"<{tag} w:val="{}" w:sz="{}" w:space="{}""#, self.val, self.sz, self.space);
        xml.push_str(&format!(
            r#" w:color="{}""#,
            self.color.as_deref().unwrap_or("auto")
        ));
        if self.shadow {
            xml.push_str(r#" w:shadow="1""#);
        }
        xml.push_str("/>");
        xml
    }
}

/// BRC80 ([MS-DOC] 2.9.16): dptLineWidth, brcType, ico, dptSpace:5 fShadow:1 ...
pub fn parse_brc80(bytes: &[u8]) -> Option<Border> {
    if bytes.len() < 4 {
        return None;
    }
    // 0xFFFFFFFF means "nil" (inherit / not specified).
    if bytes[..4] == [0xFF, 0xFF, 0xFF, 0xFF] {
        return None;
    }
    let val = brc_type_to_val(bytes[1])?;
    Some(Border {
        val,
        sz: bytes[0],
        color: ico_to_hex(bytes[2]).map(|hex| hex.to_string()),
        space: bytes[3] & 0x1F,
        shadow: bytes[3] & 0x20 != 0,
    })
}

/// Brc ([MS-DOC] 2.9.17, Word 2000+): cv COLORREF, dptLineWidth, brcType,
/// dptSpace:5 fShadow:1 fFrame:1.
pub fn parse_brc97(bytes: &[u8]) -> Option<Border> {
    if bytes.len() < 8 {
        return None;
    }
    let val = brc_type_to_val(bytes[5])?;
    Some(Border {
        val,
        sz: bytes[4],
        color: colorref_to_hex(&bytes[..4]),
        space: bytes[6] & 0x1F,
        shadow: bytes[6] & 0x20 != 0,
    })
}

fn ipat_to_val(ipat: u16) -> &'static str {
    match ipat {
        0 => "clear",
        1 => "solid",
        2 => "pct5",
        3 => "pct10",
        4 => "pct20",
        5 => "pct25",
        6 => "pct30",
        7 => "pct40",
        8 => "pct50",
        9 => "pct60",
        10 => "pct70",
        11 => "pct75",
        12 => "pct80",
        13 => "pct90",
        14 => "horzStripe",
        15 => "vertStripe",
        16 => "reverseDiagStripe",
        17 => "diagStripe",
        18 => "horzCross",
        19 => "diagCross",
        35 => "pct10",
        _ => "clear",
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Shading {
    pub val: &'static str,
    pub color: Option<String>,
    pub fill: Option<String>,
}

impl Shading {
    pub fn to_xml(&self) -> String {
        format!(
            r#"<w:shd w:val="{}" w:color="{}" w:fill="{}"/>"#,
            self.val,
            self.color.as_deref().unwrap_or("auto"),
            self.fill.as_deref().unwrap_or("auto"),
        )
    }

    pub fn is_visible(&self) -> bool {
        self.val != "clear" || self.fill.is_some()
    }
}

/// Shd80 ([MS-DOC] 2.9.245): icoFore:5 icoBack:5 ipat:6.
pub fn parse_shd80(value: u16) -> Option<Shading> {
    if value == 0xFFFF {
        return None; // ShdNil
    }
    let ico_fore = (value & 0x1F) as u8;
    let ico_back = ((value >> 5) & 0x1F) as u8;
    let ipat = value >> 10;
    Some(Shading {
        val: ipat_to_val(ipat),
        color: ico_to_hex(ico_fore).map(|hex| hex.to_string()),
        fill: ico_to_hex(ico_back).map(|hex| hex.to_string()),
    })
}

/// SHDOperand ([MS-DOC] 2.9.249): cvFore COLORREF, cvBack COLORREF, ipat u16.
pub fn parse_shd_operand(bytes: &[u8]) -> Option<Shading> {
    if bytes.len() < 10 {
        return None;
    }
    let ipat = u16::from_le_bytes([bytes[8], bytes[9]]);
    Some(Shading {
        val: ipat_to_val(ipat),
        color: colorref_to_hex(&bytes[..4]),
        fill: colorref_to_hex(&bytes[4..8]),
    })
}

/// Underline kind (kul) to w:u value.
pub fn kul_to_val(kul: u8) -> &'static str {
    match kul {
        0 => "none",
        1 => "single",
        2 => "words",
        3 => "double",
        4 => "dotted",
        6 => "thick",
        7 => "dash",
        9 => "dotDash",
        10 => "dotDotDash",
        11 => "wave",
        20 => "dottedHeavy",
        23 => "dashedHeavy",
        25 => "dashDotHeavy",
        26 => "dashDotDotHeavy",
        27 => "wavyHeavy",
        39 => "dashLong",
        43 => "wavyDouble",
        55 => "dashLongHeavy",
        _ => "single",
    }
}

/// Page-number format (nfc) to w:pgNumType w:fmt value.
pub fn nfc_to_num_fmt(nfc: u8) -> &'static str {
    match nfc {
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
        47 => "chosung",
        _ => "decimal",
    }
}
