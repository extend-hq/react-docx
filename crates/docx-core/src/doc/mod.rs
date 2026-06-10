//! Legacy Word 97-2003 binary `.doc` parser ([MS-DOC]).
//!
//! Parses the binary format and synthesizes an in-memory [`OoxmlPackage`]
//! (document.xml, styles.xml, numbering.xml, headers/footers, settings, rels,
//! media assets) so the existing DOCX model-building pipeline is reused
//! unchanged downstream.

pub mod build;
pub mod cfb;
pub mod fonts;
pub mod images;
pub mod lists;
pub mod stsh;
pub mod chp;
pub mod fib;
pub mod fkp;
pub mod fmt;
pub mod pap;
pub mod pieces;
pub mod sep;
pub mod sprm;
pub mod tap;

pub use build::parse_doc;
pub use cfb::is_cfb as is_doc_format;

use cfb::CompoundFile;
use fib::Fib;
use pieces::PieceTable;

/// The opened streams and core tables of a .doc file.
pub struct DocFile {
    pub word: Vec<u8>,
    pub table: Vec<u8>,
    pub data: Vec<u8>,
    pub fib: Fib,
    pub pieces: PieceTable,
}

impl DocFile {
    pub fn open(bytes: &[u8]) -> Result<DocFile, String> {
        let compound = CompoundFile::parse(bytes)?;
        let word = compound
            .stream("WordDocument")
            .ok_or_else(|| "Invalid .doc: missing WordDocument stream".to_string())?
            .to_vec();
        let fib = Fib::parse(&word)?;
        let table = compound
            .stream(fib.table_stream_name())
            .or_else(|| {
                // Tolerate files where only the other table stream exists.
                compound.stream("1Table").or_else(|| compound.stream("0Table"))
            })
            .ok_or_else(|| "Invalid .doc: missing Table stream".to_string())?
            .to_vec();
        let data = compound.stream("Data").map(|s| s.to_vec()).unwrap_or_default();

        let clx = fib
            .table_slice(&table, fib::fcidx::CLX)
            .ok_or_else(|| "Invalid .doc: missing piece table (Clx)".to_string())?;
        let pieces = PieceTable::parse(clx)?;

        Ok(DocFile {
            word,
            table,
            data,
            fib,
            pieces,
        })
    }

    /// UTF-16 code units for `[cp_start, cp_end)`, one unit per CP.
    pub fn text(&self, cp_start: u32, cp_end: u32) -> Vec<u16> {
        self.pieces.text(&self.word, cp_start, cp_end)
    }
}
