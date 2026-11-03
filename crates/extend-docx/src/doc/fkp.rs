//! Formatted disk pages ([MS-DOC] 2.9.74-2.9.79): 512-byte pages holding
//! character (CHPX) and paragraph (PAPX) property deltas keyed by FC ranges,
//! located through the PlcfBteChpx / PlcfBtePapx bin tables.

const FKP_SIZE: usize = 512;

/// One FC interval of a CHPX FKP with its grpprl (empty = inherit from style).
#[derive(Debug, Clone)]
pub struct ChpxRun {
    pub fc_start: u32,
    pub fc_end: u32,
    pub grpprl: Vec<u8>,
}

/// One paragraph interval of a PAPX FKP.
#[derive(Debug, Clone)]
pub struct PapxRun {
    pub fc_start: u32,
    pub fc_end: u32,
    pub istd: u16,
    pub grpprl: Vec<u8>,
}

fn read_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    bytes
        .get(offset..offset + 4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

/// Parses a bin table (PlcfBteChpx/PlcfBtePapx): FC boundaries plus the FKP
/// page number for each interval. Returns (fc_start, fc_end, page_number).
pub fn parse_bin_table(plc: &[u8]) -> Vec<(u32, u32, u32)> {
    if plc.len() < 4 || !(plc.len() - 4).is_multiple_of(8) {
        return Vec::new();
    }
    let count = (plc.len() - 4) / 8;
    let mut entries = Vec::with_capacity(count);
    for index in 0..count {
        let Some(fc_start) = read_u32(plc, index * 4) else { break };
        let Some(fc_end) = read_u32(plc, (index + 1) * 4) else { break };
        let Some(page) = read_u32(plc, (count + 1) * 4 + index * 4) else { break };
        entries.push((fc_start, fc_end, page));
    }
    entries
}

fn fkp_page(word_stream: &[u8], page_number: u32) -> Option<&[u8]> {
    let start = page_number as usize * FKP_SIZE;
    word_stream.get(start..start + FKP_SIZE)
}

/// Parses every CHPX run in the FKP page `page_number`.
pub fn parse_chpx_fkp(word_stream: &[u8], page_number: u32) -> Vec<ChpxRun> {
    let Some(page) = fkp_page(word_stream, page_number) else {
        return Vec::new();
    };
    let crun = page[FKP_SIZE - 1] as usize;
    if crun == 0 || (crun + 1) * 4 + crun > FKP_SIZE - 1 {
        return Vec::new();
    }
    let mut runs = Vec::with_capacity(crun);
    for index in 0..crun {
        let Some(fc_start) = read_u32(page, index * 4) else { break };
        let Some(fc_end) = read_u32(page, (index + 1) * 4) else { break };
        let offset_byte = page[(crun + 1) * 4 + index] as usize;
        let grpprl = if offset_byte == 0 {
            Vec::new()
        } else {
            let chpx_offset = offset_byte * 2;
            let cb = page.get(chpx_offset).copied().unwrap_or(0) as usize;
            page.get(chpx_offset + 1..chpx_offset + 1 + cb)
                .map(|slice| slice.to_vec())
                .unwrap_or_default()
        };
        runs.push(ChpxRun {
            fc_start,
            fc_end,
            grpprl,
        });
    }
    runs
}

/// Parses every PAPX run in the FKP page `page_number`. Each run is one
/// paragraph; the grpprl carries paragraph and table sprms, prefixed in the
/// file by the paragraph's style index (istd).
pub fn parse_papx_fkp(word_stream: &[u8], page_number: u32) -> Vec<PapxRun> {
    const BX_SIZE: usize = 13;
    let Some(page) = fkp_page(word_stream, page_number) else {
        return Vec::new();
    };
    let crun = page[FKP_SIZE - 1] as usize;
    if crun == 0 || (crun + 1) * 4 + crun * BX_SIZE > FKP_SIZE - 1 {
        return Vec::new();
    }
    let mut runs = Vec::with_capacity(crun);
    for index in 0..crun {
        let Some(fc_start) = read_u32(page, index * 4) else { break };
        let Some(fc_end) = read_u32(page, (index + 1) * 4) else { break };
        let bx_offset = (crun + 1) * 4 + index * BX_SIZE;
        let offset_byte = page[bx_offset] as usize;
        let (istd, grpprl) = if offset_byte == 0 {
            (0u16, Vec::new())
        } else {
            parse_papx_in_fkp(page, offset_byte * 2)
        };
        runs.push(PapxRun {
            fc_start,
            fc_end,
            istd,
            grpprl,
        });
    }
    runs
}

/// PapxInFkp ([MS-DOC] 2.9.175): cb byte (with a 0 escape to a second byte for
/// large grpprls), then GrpPrlAndIstd = istd (u16) + paragraph/table sprms.
fn parse_papx_in_fkp(page: &[u8], offset: usize) -> (u16, Vec<u8>) {
    let Some(&cb) = page.get(offset) else {
        return (0, Vec::new());
    };
    let (payload_start, payload_len) = if cb == 0 {
        let Some(&cb2) = page.get(offset + 1) else {
            return (0, Vec::new());
        };
        (offset + 2, cb2 as usize * 2)
    } else {
        (offset + 1, cb as usize * 2 - 1)
    };
    let Some(payload) = page.get(payload_start..payload_start + payload_len) else {
        return (0, Vec::new());
    };
    if payload.len() < 2 {
        return (0, Vec::new());
    }
    let istd = u16::from_le_bytes([payload[0], payload[1]]);
    (istd, payload[2..].to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_chpx_fkp_page() {
        let mut page = vec![0u8; FKP_SIZE];
        // 2 runs: fc 100..110 with grpprl, 110..120 default.
        page[FKP_SIZE - 1] = 2;
        page[0..4].copy_from_slice(&100u32.to_le_bytes());
        page[4..8].copy_from_slice(&110u32.to_le_bytes());
        page[8..12].copy_from_slice(&120u32.to_le_bytes());
        // run offsets (word offsets): run 0 -> chpx at byte 100, run 1 -> 0.
        page[12] = 50;
        page[13] = 0;
        page[100] = 3; // cb
        page[101..104].copy_from_slice(&[0x35, 0x08, 0x01]); // sprmCFBold on

        let mut stream = vec![0u8; FKP_SIZE * 2];
        stream[FKP_SIZE..].copy_from_slice(&page);
        let runs = parse_chpx_fkp(&stream, 1);
        assert_eq!(runs.len(), 2);
        assert_eq!(runs[0].fc_start, 100);
        assert_eq!(runs[0].grpprl, vec![0x35, 0x08, 0x01]);
        assert!(runs[1].grpprl.is_empty());
    }

    #[test]
    fn parses_papx_fkp_page() {
        let mut page = vec![0u8; FKP_SIZE];
        page[FKP_SIZE - 1] = 1;
        page[0..4].copy_from_slice(&200u32.to_le_bytes());
        page[4..8].copy_from_slice(&230u32.to_le_bytes());
        let bx_offset = 8;
        page[bx_offset] = 60; // word offset -> byte 120
        // PapxInFkp at 120: cb=3 -> payload 5 bytes = istd(2) + 3-byte sprm.
        page[120] = 3;
        page[121..123].copy_from_slice(&1u16.to_le_bytes()); // istd 1
        page[123..126].copy_from_slice(&[0x05, 0x24, 0x01]); // sprmPFKeep on

        let mut stream = vec![0u8; FKP_SIZE * 2];
        stream[FKP_SIZE..].copy_from_slice(&page);
        let runs = parse_papx_fkp(&stream, 1);
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].istd, 1);
        assert_eq!(runs[0].grpprl, vec![0x05, 0x24, 0x01]);
    }

    #[test]
    fn parses_papx_large_grpprl_escape() {
        let mut page = vec![0u8; FKP_SIZE];
        page[FKP_SIZE - 1] = 1;
        page[0..4].copy_from_slice(&10u32.to_le_bytes());
        page[4..8].copy_from_slice(&20u32.to_le_bytes());
        page[8] = 60;
        // cb=0 escape: second byte cb2=3 -> payload 6 bytes.
        page[120] = 0;
        page[121] = 3;
        page[122..124].copy_from_slice(&5u16.to_le_bytes());
        page[124..128].copy_from_slice(&[0x03, 0x24, 0x01, 0x00]);

        let mut stream = vec![0u8; FKP_SIZE * 2];
        stream[FKP_SIZE..].copy_from_slice(&page);
        let runs = parse_papx_fkp(&stream, 1);
        assert_eq!(runs[0].istd, 5);
        assert_eq!(runs[0].grpprl.len(), 4);
    }
}
