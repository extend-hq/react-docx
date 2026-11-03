//! Piece table ([MS-DOC] 2.8.35 Clx / 2.8.36 PlcPcd): maps the logical
//! character-position (CP) space onto WordDocument-stream byte offsets (FCs).
//! Pieces are either 8-bit (Windows-1252) or 16-bit (UTF-16LE); both kinds can
//! coexist in one document, and fast-saved files store text non-contiguously,
//! so all text access must go through this table.

#[derive(Debug, Clone, Copy)]
pub struct Piece {
    pub cp_start: u32,
    pub cp_end: u32,
    /// Byte offset of the piece's first character in the WordDocument stream.
    pub fc: u32,
    pub compressed: bool,
    pub prm: u16,
}

#[derive(Debug)]
pub struct PieceTable {
    pub pieces: Vec<Piece>,
    /// Property-modifier grpprls hoisted from the Clx Prc entries; referenced
    /// by Pcd.prm in fast-saved documents.
    pub grpprls: Vec<Vec<u8>>,
}

/// Windows-1252 high range (0x80-0x9F); the rest of the codepage is identical
/// to Latin-1.
const CP1252_HIGH: [u16; 32] = [
    0x20AC, 0x0081, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160,
    0x2039, 0x0152, 0x008D, 0x017D, 0x008F, 0x0090, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022,
    0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x009D, 0x017E, 0x0178,
];

pub fn cp1252_to_utf16(byte: u8) -> u16 {
    if (0x80..0xA0).contains(&byte) {
        CP1252_HIGH[(byte - 0x80) as usize]
    } else {
        byte as u16
    }
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, String> {
    bytes
        .get(offset..offset + 2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .ok_or_else(|| "Clx: unexpected end of data".to_string())
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, String> {
    bytes
        .get(offset..offset + 4)
        .map(|chunk| u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .ok_or_else(|| "Clx: unexpected end of data".to_string())
}

impl PieceTable {
    /// Parses a Clx: zero or more Prc entries (0x01) followed by one Pcdt (0x02).
    pub fn parse(clx: &[u8]) -> Result<PieceTable, String> {
        let mut grpprls = Vec::new();
        let mut pos = 0usize;
        while pos < clx.len() {
            match clx[pos] {
                0x01 => {
                    let cb = read_u16(clx, pos + 1)? as usize;
                    let grpprl = clx
                        .get(pos + 3..pos + 3 + cb)
                        .ok_or_else(|| "Clx: Prc grpprl out of bounds".to_string())?;
                    grpprls.push(grpprl.to_vec());
                    pos += 3 + cb;
                }
                0x02 => {
                    let lcb = read_u32(clx, pos + 1)? as usize;
                    let plc = clx
                        .get(pos + 5..pos + 5 + lcb)
                        .ok_or_else(|| "Clx: PlcPcd out of bounds".to_string())?;
                    let pieces = parse_plc_pcd(plc)?;
                    return Ok(PieceTable { pieces, grpprls });
                }
                tag => return Err(format!("Clx: unexpected tag 0x{tag:02X}")),
            }
        }
        Err("Clx: missing Pcdt (piece table)".to_string())
    }

    pub fn cp_max(&self) -> u32 {
        self.pieces.last().map(|piece| piece.cp_end).unwrap_or(0)
    }

    fn piece_index_for(&self, cp: u32) -> Option<usize> {
        // Pieces are sorted by cp_start; binary search the containing piece.
        let mut low = 0usize;
        let mut high = self.pieces.len();
        while low < high {
            let mid = (low + high) / 2;
            let piece = &self.pieces[mid];
            if cp < piece.cp_start {
                high = mid;
            } else if cp >= piece.cp_end {
                low = mid + 1;
            } else {
                return Some(mid);
            }
        }
        None
    }

    pub fn piece_for(&self, cp: u32) -> Option<&Piece> {
        self.piece_index_for(cp).map(|index| &self.pieces[index])
    }

    /// Byte offset in the WordDocument stream of the character at `cp`.
    pub fn cp_to_fc(&self, cp: u32) -> Option<u32> {
        let piece = self.piece_for(cp)?;
        let delta = cp - piece.cp_start;
        Some(if piece.compressed {
            piece.fc + delta
        } else {
            piece.fc + delta * 2
        })
    }

    /// Extracts text for `[cp_start, cp_end)` as UTF-16 code units, exactly one
    /// unit per CP so callers can index by CP. Out-of-range or unmapped CPs
    /// yield U+FFFD.
    pub fn text(&self, word_stream: &[u8], cp_start: u32, cp_end: u32) -> Vec<u16> {
        let mut out = Vec::with_capacity((cp_end.saturating_sub(cp_start)) as usize);
        let mut cp = cp_start;
        while cp < cp_end {
            let Some(piece) = self.piece_for(cp) else {
                out.push(0xFFFD);
                cp += 1;
                continue;
            };
            let take_end = piece.cp_end.min(cp_end);
            let delta = (cp - piece.cp_start) as usize;
            let count = (take_end - cp) as usize;
            if piece.compressed {
                let start = piece.fc as usize + delta;
                for index in 0..count {
                    out.push(
                        word_stream
                            .get(start + index)
                            .map(|byte| cp1252_to_utf16(*byte))
                            .unwrap_or(0xFFFD),
                    );
                }
            } else {
                let start = piece.fc as usize + delta * 2;
                for index in 0..count {
                    out.push(
                        word_stream
                            .get(start + index * 2..start + index * 2 + 2)
                            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                            .unwrap_or(0xFFFD),
                    );
                }
            }
            cp = take_end;
        }
        out
    }
}

fn parse_plc_pcd(plc: &[u8]) -> Result<Vec<Piece>, String> {
    if plc.len() < 4 || !(plc.len() - 4).is_multiple_of(12) {
        return Err(format!("PlcPcd: invalid length {}", plc.len()));
    }
    let count = (plc.len() - 4) / 12;
    let mut pieces = Vec::with_capacity(count);
    for index in 0..count {
        let cp_start = read_u32(plc, index * 4)?;
        let cp_end = read_u32(plc, (index + 1) * 4)?;
        let pcd_offset = (count + 1) * 4 + index * 8;
        let raw_fc = read_u32(plc, pcd_offset + 2)?;
        let prm = read_u16(plc, pcd_offset + 6)?;
        let compressed = raw_fc & 0x4000_0000 != 0;
        let fc_value = raw_fc & 0x3FFF_FFFF;
        let fc = if compressed { fc_value / 2 } else { fc_value };
        if cp_end < cp_start {
            return Err("PlcPcd: descending CP entries".to_string());
        }
        pieces.push(Piece {
            cp_start,
            cp_end,
            fc,
            compressed,
            prm,
        });
    }
    Ok(pieces)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_plc_pcd(entries: &[(u32, u32, u32, u16)]) -> Vec<u8> {
        // entries: (cp_start, cp_end, raw_fc, prm); consecutive entries must share boundaries
        let mut clx = vec![0x02u8];
        let lcb = (entries.len() * 12 + 4) as u32;
        clx.extend_from_slice(&lcb.to_le_bytes());
        for entry in entries {
            clx.extend_from_slice(&entry.0.to_le_bytes());
        }
        clx.extend_from_slice(&entries.last().unwrap().1.to_le_bytes());
        for entry in entries {
            clx.extend_from_slice(&0u16.to_le_bytes());
            clx.extend_from_slice(&entry.2.to_le_bytes());
            clx.extend_from_slice(&entry.3.to_le_bytes());
        }
        clx
    }

    #[test]
    fn parses_mixed_encoding_pieces() {
        // Stream: 8-bit "Hi\x93" at byte 0 (fc raw = 0x40000000 | 0), then
        // UTF-16 "Wörld" at byte 4.
        let mut stream = Vec::new();
        stream.extend_from_slice(b"Hi\x93\x00");
        for unit in "W\u{F6}rld".encode_utf16() {
            stream.extend_from_slice(&unit.to_le_bytes());
        }

        let clx = build_plc_pcd(&[(0, 3, 0x4000_0000, 0), (3, 8, 4, 0)]);
        let table = PieceTable::parse(&clx).expect("parse clx");
        assert_eq!(table.cp_max(), 8);

        let text = String::from_utf16_lossy(&table.text(&stream, 0, 8));
        assert_eq!(text, "Hi\u{201C}W\u{F6}rld");

        // cp 1 is in the compressed piece: fc = 0/2 + 1.
        assert_eq!(table.cp_to_fc(1), Some(1));
        // cp 4 is the second UTF-16 char: fc = 4 + 2.
        assert_eq!(table.cp_to_fc(4), Some(6));
    }

    #[test]
    fn parses_prc_entries_before_pcdt() {
        let mut clx = vec![0x01u8];
        clx.extend_from_slice(&2u16.to_le_bytes());
        clx.extend_from_slice(&[0xAA, 0xBB]);
        let pcdt = build_plc_pcd(&[(0, 1, 0x4000_0000, 0x0003)]);
        clx.extend_from_slice(&pcdt);

        let table = PieceTable::parse(&clx).expect("parse clx");
        assert_eq!(table.grpprls.len(), 1);
        assert_eq!(table.grpprls[0], vec![0xAA, 0xBB]);
        assert_eq!(table.pieces[0].prm, 0x0003);
    }
}
