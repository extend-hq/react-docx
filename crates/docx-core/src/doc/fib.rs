//! File Information Block ([MS-DOC] 2.5.1) — the versioned header at offset 0
//! of the WordDocument stream. All other structures are located through its
//! (fc, lcb) pointer pairs into the Table stream.

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, String> {
    bytes
        .get(offset..offset + 2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .ok_or_else(|| "FIB: unexpected end of WordDocument stream".to_string())
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, String> {
    bytes
        .get(offset..offset + 4)
        .map(|chunk| u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .ok_or_else(|| "FIB: unexpected end of WordDocument stream".to_string())
}

/// Indices into [`Fib::rg_fc_lcb`] for the FibRgFcLcb97 pointer pairs we consume.
pub mod fcidx {
    pub const STSHF: usize = 1;
    pub const PLCFFND_REF: usize = 2;
    pub const PLCFFND_TXT: usize = 3;
    pub const PLCF_SED: usize = 6;
    pub const PLCF_HDD: usize = 11;
    pub const PLCF_BTE_CHPX: usize = 12;
    pub const PLCF_BTE_PAPX: usize = 13;
    pub const STTBF_FFN: usize = 15;
    pub const PLCF_FLD_MOM: usize = 16;
    pub const DOP: usize = 31;
    pub const CLX: usize = 33;
    pub const PLCFEND_REF: usize = 46;
    pub const PLCFEND_TXT: usize = 47;
    pub const PLF_LST: usize = 73;
    pub const PLF_LFO: usize = 74;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct CcpCounts {
    pub text: u32,
    pub ftn: u32,
    pub hdd: u32,
    pub mcr: u32,
    pub atn: u32,
    pub edn: u32,
    pub txbx: u32,
    pub hdr_txbx: u32,
}

impl CcpCounts {
    pub fn total(&self) -> u32 {
        self.text + self.ftn + self.hdd + self.mcr + self.atn + self.edn + self.txbx + self.hdr_txbx
    }

    /// CP at which the footnote subdocument starts.
    pub fn ftn_start(&self) -> u32 {
        self.text
    }

    /// CP at which the header/footer subdocument starts.
    pub fn hdd_start(&self) -> u32 {
        self.text + self.ftn
    }

    /// CP at which the endnote subdocument starts.
    pub fn edn_start(&self) -> u32 {
        self.text + self.ftn + self.hdd + self.mcr + self.atn
    }
}

#[derive(Debug)]
pub struct Fib {
    pub n_fib: u16,
    pub f_complex: bool,
    pub f_which_tbl_stm: bool,
    pub ccp: CcpCounts,
    rg_fc_lcb: Vec<(u32, u32)>,
}

impl Fib {
    pub fn parse(word_stream: &[u8]) -> Result<Fib, String> {
        let w_ident = read_u16(word_stream, 0)?;
        if w_ident != 0xA5EC {
            return Err(format!(
                "Not a Word binary document (wIdent 0x{w_ident:04X}, expected 0xA5EC)"
            ));
        }
        let n_fib = read_u16(word_stream, 2)?;
        if n_fib < 0x00C1 {
            return Err(format!(
                "Unsupported legacy Word version (nFib 0x{n_fib:04X}); only Word 97-2003 binary files are supported"
            ));
        }

        let flags = read_u16(word_stream, 0x0A)?;
        let f_complex = flags & 0x0004 != 0;
        let f_encrypted = flags & 0x0100 != 0;
        let f_which_tbl_stm = flags & 0x0200 != 0;
        let f_obfuscated = flags & 0x8000 != 0;
        if f_encrypted {
            return Err(if f_obfuscated {
                "Encrypted .doc files (XOR obfuscation) are not supported".to_string()
            } else {
                "Encrypted .doc files are not supported".to_string()
            });
        }

        let csw = read_u16(word_stream, 0x20)? as usize;
        let rg_lw_offset = 0x22 + csw * 2 + 2;
        let cslw = read_u16(word_stream, 0x22 + csw * 2)? as usize;
        let lw = |index: usize| read_u32(word_stream, rg_lw_offset + index * 4);
        let ccp = CcpCounts {
            text: lw(3)?,
            ftn: lw(4)?,
            hdd: lw(5)?,
            mcr: lw(6)?,
            atn: lw(7)?,
            edn: lw(8)?,
            txbx: lw(9)?,
            hdr_txbx: lw(10)?,
        };

        let cb_rg_fc_lcb_offset = rg_lw_offset + cslw * 4;
        let pair_count = read_u16(word_stream, cb_rg_fc_lcb_offset)? as usize;
        let pairs_offset = cb_rg_fc_lcb_offset + 2;
        let mut rg_fc_lcb = Vec::with_capacity(pair_count);
        for index in 0..pair_count {
            let fc = read_u32(word_stream, pairs_offset + index * 8)?;
            let lcb = read_u32(word_stream, pairs_offset + index * 8 + 4)?;
            rg_fc_lcb.push((fc, lcb));
        }

        Ok(Fib {
            n_fib,
            f_complex,
            f_which_tbl_stm,
            ccp,
            rg_fc_lcb,
        })
    }

    /// Returns the Table-stream slice referenced by pointer pair `index`,
    /// or None when absent/empty.
    pub fn table_slice<'a>(&self, table_stream: &'a [u8], index: usize) -> Option<&'a [u8]> {
        let (fc, lcb) = *self.rg_fc_lcb.get(index)?;
        if lcb == 0 {
            return None;
        }
        table_stream.get(fc as usize..(fc as usize).checked_add(lcb as usize)?)
    }

    pub fn fc_lcb(&self, index: usize) -> Option<(u32, u32)> {
        self.rg_fc_lcb.get(index).copied()
    }

    pub fn table_stream_name(&self) -> &'static str {
        if self.f_which_tbl_stm {
            "1Table"
        } else {
            "0Table"
        }
    }
}
