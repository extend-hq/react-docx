//! Table properties (TAP): tables have no stored structure in the binary
//! format — each row's geometry lives in table sprms on the row-end
//! paragraph's PAPX (sprmTDefTable defines the cell boundaries and per-cell
//! TC80 formatting). The document builder feeds those grpprls here.

use super::fmt::{parse_brc80, parse_brc97, parse_shd80, parse_shd_operand, Border, Shading};
use super::sprm::{self, Sprm};

#[derive(Debug, Default, Clone)]
pub struct TableCell {
    /// Right boundary of the cell in twips, relative to the row origin.
    pub boundary_left: i32,
    pub boundary_right: i32,
    pub f_first_merged: bool,
    pub f_merged: bool,
    pub f_vert_merge: bool,
    pub f_vert_restart: bool,
    pub f_vertical: bool,
    pub f_backward: bool,
    pub vert_align: u8,
    pub brc_top: Option<Border>,
    pub brc_left: Option<Border>,
    pub brc_bottom: Option<Border>,
    pub brc_right: Option<Border>,
    pub shd: Option<Shading>,
}

#[derive(Debug, Default, Clone)]
pub struct Tap {
    pub jc: u8,
    pub dxa_gap_half: i16,
    pub dya_row_height: i16,
    pub f_cant_split: bool,
    pub f_table_header: bool,
    pub cells: Vec<TableCell>,
    pub table_borders: [Option<Border>; 6], // top, left, bottom, right, insideH, insideV
}

impl Tap {
    pub fn from_grpprl(grpprl: &[u8]) -> Tap {
        let mut tap = Tap::default();
        let mut shd_queue: Vec<Shading> = Vec::new();
        let mut shd_assigned = 0usize;
        for sprm in sprm::iterate(grpprl) {
            tap.apply_sprm(&sprm, &mut shd_queue, &mut shd_assigned);
        }
        // Distribute any cell shadings parsed before/after sprmTDefTable.
        for (index, shading) in shd_queue.into_iter().enumerate() {
            if let Some(cell) = tap.cells.get_mut(index) {
                if cell.shd.is_none() && shading.is_visible() {
                    cell.shd = Some(shading);
                }
            }
        }
        tap
    }

    fn apply_sprm(
        &mut self,
        sprm: &Sprm<'_>,
        shd_queue: &mut Vec<Shading>,
        shd_assigned: &mut usize,
    ) {
        match sprm.opcode {
            0x5400 | 0x548A => self.jc = sprm.byte(),
            0x9602 => self.dxa_gap_half = sprm.i16_operand(),
            0x9407 => self.dya_row_height = sprm.i16_operand(),
            0x3403 => self.f_cant_split = sprm.byte() == 1,
            0x3404 => self.f_table_header = sprm.byte() == 1,
            0xD608 => self.apply_tdef_table(sprm.operand),
            0xD605 => {
                for (index, chunk) in sprm.operand.chunks_exact(4).take(6).enumerate() {
                    self.table_borders[index] = parse_brc80(chunk);
                }
            }
            0xD613 => {
                for (index, chunk) in sprm.operand.chunks_exact(8).take(6).enumerate() {
                    let border = parse_brc97(chunk);
                    if border.is_some() {
                        self.table_borders[index] = border;
                    }
                }
            }
            0xD609 => {
                // sprmTDefTableShd80: SHD80 per cell.
                for chunk in sprm.operand.chunks_exact(2) {
                    if let Some(shading) = parse_shd80(u16::from_le_bytes([chunk[0], chunk[1]])) {
                        shd_queue.push(shading);
                    }
                }
                let _ = shd_assigned;
            }
            0xD612 => {
                // sprmTDefTableShd: SHDOperand per cell.
                for chunk in sprm.operand.chunks_exact(10) {
                    if let Some(shading) = parse_shd_operand(chunk) {
                        shd_queue.push(shading);
                    }
                }
            }
            0xD620 => self.apply_set_brc80(sprm.operand),
            0xD62B => {
                // sprmTVertMerge: itc + merge code (0 none, 1 continue, 3 restart).
                if sprm.operand.len() >= 2 {
                    let itc = sprm.operand[0] as usize;
                    let code = sprm.operand[1];
                    if let Some(cell) = self.cells.get_mut(itc) {
                        cell.f_vert_merge = code & 0x01 != 0;
                        cell.f_vert_restart = code & 0x02 != 0;
                    }
                }
            }
            0xD62C => {
                // sprmTVertAlign: itcFirst, itcLim, vertAlign.
                if sprm.operand.len() >= 3 {
                    let first = sprm.operand[0] as usize;
                    let lim = sprm.operand[1] as usize;
                    for itc in first..lim.min(self.cells.len()) {
                        self.cells[itc].vert_align = sprm.operand[2];
                    }
                }
            }
            0x7627 | 0x7628 => {
                // sprmTSetShd80/sprmTSetShdOdd80: itcFirst, itcLim?, shd — legacy;
                // operand is 4 bytes: itcFirst, itcLim, SHD80.
                if sprm.operand.len() >= 4 {
                    let first = sprm.operand[0] as usize;
                    let lim = sprm.operand[1] as usize;
                    let shading = parse_shd80(u16::from_le_bytes([sprm.operand[2], sprm.operand[3]]));
                    if let Some(shading) = shading {
                        for itc in first..lim.min(self.cells.len()) {
                            self.cells[itc].shd = Some(shading.clone());
                        }
                    }
                }
            }
            _ => {}
        }
    }

    /// sprmTDefTable: itcMac, rgdxaCenter[itcMac+1], rgTc80[..itcMac].
    fn apply_tdef_table(&mut self, operand: &[u8]) {
        let Some(&itc_mac) = operand.first() else {
            return;
        };
        let count = itc_mac as usize;
        let centers_end = 1 + (count + 1) * 2;
        if operand.len() < centers_end || count == 0 {
            return;
        }
        let mut centers = Vec::with_capacity(count + 1);
        for index in 0..=count {
            let offset = 1 + index * 2;
            centers.push(i16::from_le_bytes([operand[offset], operand[offset + 1]]) as i32);
        }

        self.cells = (0..count)
            .map(|index| {
                let mut cell = TableCell {
                    boundary_left: centers[index],
                    boundary_right: centers[index + 1],
                    ..TableCell::default()
                };
                let tc_offset = centers_end + index * 20;
                if let Some(tc) = operand.get(tc_offset..tc_offset + 20) {
                    let rgf = u16::from_le_bytes([tc[0], tc[1]]);
                    cell.f_first_merged = rgf & 0x0001 != 0;
                    cell.f_merged = rgf & 0x0002 != 0;
                    cell.f_vertical = rgf & 0x0004 != 0;
                    cell.f_backward = rgf & 0x0008 != 0;
                    cell.f_vert_merge = rgf & 0x0020 != 0;
                    cell.f_vert_restart = rgf & 0x0040 != 0;
                    cell.vert_align = ((rgf >> 7) & 0x3) as u8;
                    cell.brc_top = parse_brc80(&tc[4..8]);
                    cell.brc_left = parse_brc80(&tc[8..12]);
                    cell.brc_bottom = parse_brc80(&tc[12..16]);
                    cell.brc_right = parse_brc80(&tc[16..20]);
                }
                cell
            })
            .collect();
    }

    /// sprmTSetBrc80: itcFirst, itcLim, grfbrc, BRC80 — applies one border to a
    /// range of cells on the sides selected by grfbrc.
    fn apply_set_brc80(&mut self, operand: &[u8]) {
        if operand.len() < 7 {
            return;
        }
        let first = operand[0] as usize;
        let lim = operand[1] as usize;
        let grfbrc = operand[2];
        let border = parse_brc80(&operand[3..7]);
        for itc in first..lim.min(self.cells.len()) {
            let cell = &mut self.cells[itc];
            if grfbrc & 0x01 != 0 {
                cell.brc_top = border.clone();
            }
            if grfbrc & 0x02 != 0 {
                cell.brc_left = border.clone();
            }
            if grfbrc & 0x04 != 0 {
                cell.brc_bottom = border.clone();
            }
            if grfbrc & 0x08 != 0 {
                cell.brc_right = border.clone();
            }
        }
    }

    pub fn row_left_edge(&self) -> i32 {
        self.cells.first().map(|cell| cell.boundary_left).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tdef_operand(centers: &[i16], tc_flags: &[u16]) -> Vec<u8> {
        let count = centers.len() - 1;
        let mut operand = vec![count as u8];
        for center in centers {
            operand.extend_from_slice(&center.to_le_bytes());
        }
        for index in 0..count {
            let mut tc = [0u8; 20];
            tc[..2].copy_from_slice(&tc_flags.get(index).copied().unwrap_or(0).to_le_bytes());
            operand.extend_from_slice(&tc);
        }
        operand
    }

    #[test]
    fn parses_tdef_table_boundaries() {
        let operand = tdef_operand(&[0, 2400, 4800, 9360], &[0, 0, 0]);
        let mut grpprl: Vec<u8> = vec![0x08, 0xD6];
        grpprl.extend_from_slice(&((operand.len() + 1) as u16).to_le_bytes());
        grpprl.extend_from_slice(&operand);

        let tap = Tap::from_grpprl(&grpprl);
        assert_eq!(tap.cells.len(), 3);
        assert_eq!(tap.cells[0].boundary_left, 0);
        assert_eq!(tap.cells[0].boundary_right, 2400);
        assert_eq!(tap.cells[2].boundary_right, 9360);
    }

    #[test]
    fn parses_vert_merge_flags() {
        let operand = tdef_operand(&[0, 1000, 2000], &[0x0040, 0x0020]);
        let mut grpprl: Vec<u8> = vec![0x08, 0xD6];
        grpprl.extend_from_slice(&((operand.len() + 1) as u16).to_le_bytes());
        grpprl.extend_from_slice(&operand);

        let tap = Tap::from_grpprl(&grpprl);
        assert!(tap.cells[0].f_vert_restart);
        assert!(tap.cells[1].f_vert_merge);
        assert!(!tap.cells[1].f_vert_restart);
    }
}
