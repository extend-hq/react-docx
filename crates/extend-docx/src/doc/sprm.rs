//! Sprm ([MS-DOC] 2.2.5.1): single property modifiers. Formatting in the
//! binary format is stored as grpprls — byte arrays of sprms, each a 16-bit
//! opcode followed by an operand whose size is encoded in the opcode's `spra`
//! bits.

/// Property category (`sgc` bits of the opcode).
pub const SGC_PAR: u8 = 1;
pub const SGC_CHR: u8 = 2;
pub const SGC_PIC: u8 = 3;
pub const SGC_SEC: u8 = 4;
pub const SGC_TAB: u8 = 5;

#[derive(Debug, Clone, Copy)]
pub struct Sprm<'a> {
    pub opcode: u16,
    pub operand: &'a [u8],
}

impl<'a> Sprm<'a> {
    pub fn sgc(&self) -> u8 {
        ((self.opcode >> 10) & 0x7) as u8
    }

    pub fn byte(&self) -> u8 {
        self.operand.first().copied().unwrap_or(0)
    }

    pub fn bool_operand(&self) -> Option<bool> {
        match self.byte() {
            0 => Some(false),
            1 => Some(true),
            _ => None, // 0x80/0x81 toggle semantics handled by the caller
        }
    }

    pub fn u16_operand(&self) -> u16 {
        self.operand
            .get(..2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
            .unwrap_or(0)
    }

    pub fn i16_operand(&self) -> i16 {
        self.u16_operand() as i16
    }

    pub fn u32_operand(&self) -> u32 {
        self.operand
            .get(..4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .unwrap_or(0)
    }
}

/// Iterates over the sprms of a grpprl, tolerating truncated trailing data.
pub struct SprmIter<'a> {
    grpprl: &'a [u8],
    pos: usize,
}

pub fn iterate(grpprl: &[u8]) -> SprmIter<'_> {
    SprmIter { grpprl, pos: 0 }
}

impl<'a> Iterator for SprmIter<'a> {
    type Item = Sprm<'a>;

    fn next(&mut self) -> Option<Sprm<'a>> {
        if self.pos + 2 > self.grpprl.len() {
            return None;
        }
        let opcode = u16::from_le_bytes([self.grpprl[self.pos], self.grpprl[self.pos + 1]]);
        let spra = (opcode >> 13) & 0x7;
        let mut operand_start = self.pos + 2;
        let operand_len = match spra {
            0 | 1 => 1,
            2 | 4 | 5 => 2,
            3 => 4,
            7 => 3,
            6 => {
                // Variable size: one cb byte, except sprmTDefTable/sprmTDefTable10
                // where cb is a u16 equal to the remaining size + 1.
                if opcode == 0xD608 || opcode == 0xD606 {
                    if operand_start + 2 > self.grpprl.len() {
                        return None;
                    }
                    let cb = u16::from_le_bytes([
                        self.grpprl[operand_start],
                        self.grpprl[operand_start + 1],
                    ]) as usize;
                    operand_start += 2;
                    cb.saturating_sub(1)
                } else {
                    if operand_start + 1 > self.grpprl.len() {
                        return None;
                    }
                    let cb = self.grpprl[operand_start] as usize;
                    operand_start += 1;
                    if opcode == 0xC615 && cb == 255 {
                        // sprmPChgTabs with cb == 255 has an internally-described
                        // size we do not decode; stop parsing this grpprl.
                        return None;
                    }
                    cb
                }
            }
            _ => unreachable!(),
        };
        let operand_end = operand_start + operand_len;
        if operand_end > self.grpprl.len() {
            return None;
        }
        let sprm = Sprm {
            opcode,
            operand: &self.grpprl[operand_start..operand_end],
        };
        self.pos = operand_end;
        Some(sprm)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iterates_fixed_and_variable_operands() {
        // sprmCFBold (0x0835, spra=0, 1 byte) = 1
        // sprmCHps (0x4A43, spra=2, 2 bytes) = 24 half-points
        // sprmPDyaLine (0x6412, spra=3, 4 bytes)
        let grpprl: Vec<u8> = vec![
            0x35, 0x08, 0x01, //
            0x43, 0x4A, 0x18, 0x00, //
            0x12, 0x64, 0xF0, 0x00, 0x01, 0x00,
        ];
        let sprms: Vec<_> = iterate(&grpprl).collect();
        assert_eq!(sprms.len(), 3);
        assert_eq!(sprms[0].opcode, 0x0835);
        assert_eq!(sprms[0].byte(), 1);
        assert_eq!(sprms[1].opcode, 0x4A43);
        assert_eq!(sprms[1].u16_operand(), 24);
        assert_eq!(sprms[2].opcode, 0x6412);
        assert_eq!(sprms[2].sgc(), SGC_PAR);
    }

    #[test]
    fn handles_tdef_table_u16_size() {
        // sprmTDefTable 0xD608 with cb = 8 -> operand is 7 bytes.
        let mut grpprl: Vec<u8> = vec![0x08, 0xD6];
        grpprl.extend_from_slice(&8u16.to_le_bytes());
        grpprl.extend_from_slice(&[1, 2, 3, 4, 5, 6, 7]);
        grpprl.extend_from_slice(&[0x35, 0x08, 0x01]); // trailing sprmCFBold
        let sprms: Vec<_> = iterate(&grpprl).collect();
        assert_eq!(sprms.len(), 2);
        assert_eq!(sprms[0].opcode, 0xD608);
        assert_eq!(sprms[0].operand.len(), 7);
        assert_eq!(sprms[1].opcode, 0x0835);
    }

    #[test]
    fn stops_on_truncated_grpprl() {
        let grpprl: Vec<u8> = vec![0x43, 0x4A, 0x18]; // sprmCHps missing a byte
        assert_eq!(iterate(&grpprl).count(), 0);
    }
}
