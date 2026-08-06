//! Textbox-story mapping for binary Word documents.
//!
//! Word stores textbox text in separate main/header stories. `PlcftxbxTxt`
//! identifies the text ranges while `PlcfSpa` identifies the drawing anchors;
//! the two structures join through `FTXBXS.lid == SPA.lid`.

use std::collections::{HashMap, VecDeque};

use super::fib::fcidx;
use super::DocFile;

const SPA_SIZE: usize = 26;
const FTXBXS_SIZE: usize = 22;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum TextBoxStory {
    Main,
    Header,
}

impl TextBoxStory {
    fn label(self) -> &'static str {
        match self {
            Self::Main => "main",
            Self::Header => "header",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct TextBoxSpec {
    pub shape_id: u32,
    /// Absolute CP in the relevant anchor story (main text or header text).
    pub anchor_cp: u32,
    /// Absolute CP range in the textbox story.
    pub text_cp_start: u32,
    pub text_cp_end: u32,
    pub left_twips: i32,
    pub top_twips: i32,
    pub width_twips: u32,
    pub height_twips: u32,
    pub horizontal_relative: u8,
    pub vertical_relative: u8,
    pub wrap: u8,
    pub wrap_side: u8,
    pub behind_text: bool,
}

#[derive(Default)]
pub(super) struct ParsedTextBoxes {
    pub specs: Vec<TextBoxSpec>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Copy, Debug)]
struct Spa {
    shape_id: u32,
    anchor_cp: u32,
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
    horizontal_relative: u8,
    vertical_relative: u8,
    wrap: u8,
    wrap_side: u8,
    behind_text: bool,
}

fn read_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    let value = bytes.get(offset..offset.checked_add(2)?)?;
    Some(u16::from_le_bytes([value[0], value[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    let value = bytes.get(offset..offset.checked_add(4)?)?;
    Some(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}

fn read_i32(bytes: &[u8], offset: usize) -> Option<i32> {
    read_u32(bytes, offset).map(|value| value as i32)
}

fn plc_count(bytes: &[u8], data_size: usize) -> Option<usize> {
    let payload = bytes.len().checked_sub(4)?;
    let record_width = 4usize.checked_add(data_size)?;
    (payload % record_width == 0).then_some(payload / record_width)
}

fn parse_spas(bytes: &[u8], anchor_base: u32, anchor_len: u32) -> Result<Vec<Spa>, String> {
    let count = plc_count(bytes, SPA_SIZE)
        .ok_or_else(|| format!("invalid PlcfSpa length {}", bytes.len()))?;
    let records_offset = (count + 1)
        .checked_mul(4)
        .ok_or_else(|| "PlcfSpa record offset overflow".to_string())?;
    let mut spas = Vec::with_capacity(count);
    let mut previous_cp = 0u32;

    for index in 0..count {
        let relative_cp = read_u32(bytes, index * 4)
            .ok_or_else(|| "truncated PlcfSpa CP array".to_string())?;
        if index > 0 && relative_cp < previous_cp {
            return Err("descending PlcfSpa CP entries".to_string());
        }
        previous_cp = relative_cp;
        if relative_cp >= anchor_len {
            continue;
        }
        let offset = records_offset
            .checked_add(index * SPA_SIZE)
            .ok_or_else(|| "PlcfSpa record offset overflow".to_string())?;
        let flags = read_u16(bytes, offset + 20)
            .ok_or_else(|| "truncated SPA record".to_string())?;
        spas.push(Spa {
            shape_id: read_u32(bytes, offset)
                .ok_or_else(|| "truncated SPA shape identifier".to_string())?,
            anchor_cp: anchor_base.saturating_add(relative_cp),
            left: read_i32(bytes, offset + 4)
                .ok_or_else(|| "truncated SPA rectangle".to_string())?,
            top: read_i32(bytes, offset + 8)
                .ok_or_else(|| "truncated SPA rectangle".to_string())?,
            right: read_i32(bytes, offset + 12)
                .ok_or_else(|| "truncated SPA rectangle".to_string())?,
            bottom: read_i32(bytes, offset + 16)
                .ok_or_else(|| "truncated SPA rectangle".to_string())?,
            horizontal_relative: ((flags >> 1) & 0x03) as u8,
            vertical_relative: ((flags >> 3) & 0x03) as u8,
            wrap: ((flags >> 5) & 0x0F) as u8,
            wrap_side: ((flags >> 9) & 0x0F) as u8,
            behind_text: flags & (1 << 14) != 0,
        });
    }
    Ok(spas)
}

/// True when a range has text Word would display. Field instructions are not
/// visible; only field results and ordinary text count. This avoids turning
/// OLE/chart field stories into empty synthetic text boxes.
fn contains_visible_text(doc: &DocFile, cp_start: u32, cp_end: u32) -> bool {
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum FieldPhase {
        Outside,
        Instruction,
        Result,
    }

    let mut phase = FieldPhase::Outside;
    for unit in doc.text(cp_start, cp_end) {
        match unit {
            0x13 => phase = FieldPhase::Instruction,
            0x14 if phase == FieldPhase::Instruction => phase = FieldPhase::Result,
            0x15 => phase = FieldPhase::Outside,
            _ if phase == FieldPhase::Instruction => {}
            0x20 | 0x09 | 0x0A | 0x0D | 0x00..=0x08 | 0x0B..=0x1F => {}
            _ => return true,
        }
    }
    false
}

pub(super) fn parse_text_boxes(doc: &DocFile, story: TextBoxStory) -> ParsedTextBoxes {
    let mut parsed = ParsedTextBoxes::default();
    let ccp = doc.fib.ccp;
    let (story_len, story_base, txbx_index, spa_index, anchor_base, anchor_len) = match story {
        TextBoxStory::Main => (
            ccp.txbx,
            ccp.txbx_start(),
            fcidx::PLCF_TXBX_TXT,
            fcidx::PLCF_SPA_MOM,
            0,
            ccp.text,
        ),
        TextBoxStory::Header => (
            ccp.hdr_txbx,
            ccp.hdr_txbx_start(),
            fcidx::PLCF_HDR_TXBX_TXT,
            fcidx::PLCF_SPA_HDR,
            ccp.hdd_start(),
            ccp.hdd,
        ),
    };
    if story_len == 0 {
        return parsed;
    }

    let Some(txbx_plc) = doc.fib.table_slice(&doc.table, txbx_index) else {
        parsed.warnings.push(format!(
            "Legacy DOC {} textbox story has {story_len} characters but no PlcftxbxTxt",
            story.label()
        ));
        return parsed;
    };
    let Some(spa_plc) = doc.fib.table_slice(&doc.table, spa_index) else {
        parsed.warnings.push(format!(
            "Legacy DOC {} textbox story has {story_len} characters but no PlcfSpa anchors",
            story.label()
        ));
        return parsed;
    };

    let spas = match parse_spas(spa_plc, anchor_base, anchor_len) {
        Ok(spas) => spas,
        Err(error) => {
            parsed.warnings.push(format!(
                "Legacy DOC {} textbox anchors were skipped: {error}",
                story.label()
            ));
            return parsed;
        }
    };
    let mut spas_by_id: HashMap<u32, VecDeque<Spa>> = HashMap::new();
    for spa in spas {
        spas_by_id
            .entry(spa.shape_id)
            .or_default()
            .push_back(spa);
    }

    let Some(record_count) = plc_count(txbx_plc, FTXBXS_SIZE) else {
        parsed.warnings.push(format!(
            "Legacy DOC {} textbox ranges were skipped: invalid PlcftxbxTxt length {}",
            story.label(),
            txbx_plc.len()
        ));
        return parsed;
    };
    if record_count < 2 {
        parsed.warnings.push(format!(
            "Legacy DOC {} textbox ranges were skipped: PlcftxbxTxt has no usable records",
            story.label()
        ));
        return parsed;
    }

    let records_offset = (record_count + 1) * 4;
    let mut previous_cp = 0u32;
    // Per MS-DOC, the final FTXBXS entry is a reusable sentinel and MUST be
    // ignored. It commonly points beyond the declared textbox story.
    for index in 0..record_count.saturating_sub(1) {
        let Some(relative_start) = read_u32(txbx_plc, index * 4) else {
            break;
        };
        let Some(relative_end) = read_u32(txbx_plc, (index + 1) * 4) else {
            break;
        };
        if (index > 0 && relative_start < previous_cp) || relative_end < relative_start {
            parsed.warnings.push(format!(
                "Legacy DOC {} textbox range {index} has descending CP entries and was skipped",
                story.label()
            ));
            previous_cp = relative_end;
            continue;
        }
        previous_cp = relative_end;
        let offset = records_offset + index * FTXBXS_SIZE;
        let c_txbx = read_u32(txbx_plc, offset).unwrap_or(1);
        let reusable = read_u16(txbx_plc, offset + 8).unwrap_or(0) != 0;
        let Some(shape_id) = read_u32(txbx_plc, offset + 14) else {
            parsed.warnings.push(format!(
                "Legacy DOC {} textbox range {index} has a truncated FTXBXS record",
                story.label()
            ));
            continue;
        };
        if reusable || relative_start >= story_len {
            continue;
        }
        let relative_end = relative_end.min(story_len);
        if relative_start >= relative_end {
            continue;
        }
        let text_cp_start = story_base.saturating_add(relative_start);
        let text_cp_end = story_base.saturating_add(relative_end);
        if !contains_visible_text(doc, text_cp_start, text_cp_end) {
            continue;
        }

        let Some(spa) = spas_by_id
            .get_mut(&shape_id)
            .and_then(|matches| matches.pop_front())
        else {
            parsed.warnings.push(format!(
                "Legacy DOC {} textbox shape {shape_id} has visible text but no matching anchor",
                story.label()
            ));
            continue;
        };

        let width = i64::from(spa.right) - i64::from(spa.left);
        let height = i64::from(spa.bottom) - i64::from(spa.top);
        if width <= 0 || height <= 0 {
            parsed.warnings.push(format!(
                "Legacy DOC {} textbox shape {shape_id} has invalid bounds and was skipped",
                story.label()
            ));
            continue;
        }
        if c_txbx > 1 {
            parsed.warnings.push(format!(
                "Legacy DOC linked textbox chain for shape {shape_id} was imported into its first frame"
            ));
        }
        if spa.horizontal_relative > 2 {
            parsed.warnings.push(format!(
                "Legacy DOC textbox shape {shape_id} has an unknown horizontal anchor; page-relative positioning was used"
            ));
        }
        if spa.vertical_relative > 2 {
            parsed.warnings.push(format!(
                "Legacy DOC textbox shape {shape_id} has an unknown vertical anchor; page-relative positioning was used"
            ));
        }
        if spa.wrap > 5 {
            parsed.warnings.push(format!(
                "Legacy DOC textbox shape {shape_id} has an unknown wrap mode; square wrapping was used"
            ));
        }
        if !matches!(spa.wrap, 1 | 3) && spa.wrap_side > 3 {
            parsed.warnings.push(format!(
                "Legacy DOC textbox shape {shape_id} has an unknown wrap side; both-side wrapping was used"
            ));
        }
        parsed.specs.push(TextBoxSpec {
            shape_id,
            anchor_cp: spa.anchor_cp,
            text_cp_start,
            text_cp_end,
            left_twips: spa.left,
            top_twips: spa.top,
            width_twips: width.min(u32::MAX as i64) as u32,
            height_twips: height.min(u32::MAX as i64) as u32,
            horizontal_relative: spa.horizontal_relative,
            vertical_relative: spa.vertical_relative,
            wrap: spa.wrap,
            wrap_side: spa.wrap_side,
            behind_text: spa.behind_text,
        });
    }

    parsed.specs.sort_by_key(|spec| (spec.anchor_cp, spec.shape_id));
    parsed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_generic_plc_lengths() {
        assert_eq!(plc_count(&vec![0; (2 + 1) * 4 + 2 * SPA_SIZE], SPA_SIZE), Some(2));
        assert_eq!(plc_count(&vec![0; 5], SPA_SIZE), None);
    }

    #[test]
    fn parses_signed_geometry_and_anchor_flags() {
        let mut plc = vec![0u8; 8 + SPA_SIZE];
        plc[0..4].copy_from_slice(&3u32.to_le_bytes());
        plc[4..8].copy_from_slice(&4u32.to_le_bytes());
        plc[8..12].copy_from_slice(&2051u32.to_le_bytes());
        plc[12..16].copy_from_slice(&(-1203i32).to_le_bytes());
        plc[16..20].copy_from_slice(&(-900i32).to_le_bytes());
        plc[20..24].copy_from_slice(&9957i32.to_le_bytes());
        plc[24..28].copy_from_slice(&13860i32.to_le_bytes());
        let flags = (2u16 << 1) | (2u16 << 3) | (3u16 << 5) | (2u16 << 9) | (1u16 << 14);
        plc[28..30].copy_from_slice(&flags.to_le_bytes());

        let spas = parse_spas(&plc, 10, 20).expect("valid PlcfSpa");
        assert_eq!(spas.len(), 1);
        let spa = spas[0];
        assert_eq!(spa.shape_id, 2051);
        assert_eq!(spa.anchor_cp, 13);
        assert_eq!((spa.left, spa.top, spa.right, spa.bottom), (-1203, -900, 9957, 13860));
        assert_eq!(spa.horizontal_relative, 2);
        assert_eq!(spa.vertical_relative, 2);
        assert_eq!(spa.wrap, 3);
        assert_eq!(spa.wrap_side, 2);
        assert!(spa.behind_text);
    }

    #[test]
    fn rejects_descending_anchor_positions() {
        let mut plc = vec![0u8; 12 + 2 * SPA_SIZE];
        plc[0..4].copy_from_slice(&5u32.to_le_bytes());
        plc[4..8].copy_from_slice(&4u32.to_le_bytes());
        plc[8..12].copy_from_slice(&6u32.to_le_bytes());
        assert_eq!(
            parse_spas(&plc, 0, 10).unwrap_err(),
            "descending PlcfSpa CP entries"
        );
    }
}
