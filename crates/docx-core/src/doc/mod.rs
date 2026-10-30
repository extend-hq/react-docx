//! Legacy Word 97-2003 binary `.doc` parser ([MS-DOC]).
//!
//! Parses the binary format and synthesizes an in-memory [`OoxmlPackage`]
//! (document.xml, styles.xml, numbering.xml, headers/footers, settings, rels,
//! media assets) so the existing DOCX model-building pipeline is reused
//! unchanged downstream.

pub mod build;
pub mod cfb;
pub mod chp;
pub mod fib;
pub mod fkp;
pub mod fmt;
pub mod fonts;
pub mod images;
pub mod lists;
pub mod pap;
pub mod pieces;
pub mod sep;
pub mod sprm;
pub mod stsh;
pub mod tap;
mod textboxes;

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
                compound
                    .stream("1Table")
                    .or_else(|| compound.stream("0Table"))
            })
            .ok_or_else(|| "Invalid .doc: missing Table stream".to_string())?
            .to_vec();
        let data = compound
            .stream("Data")
            .map(|s| s.to_vec())
            .unwrap_or_default();

        let clx = fib
            .table_slice(&table, fib::fcidx::CLX)
            .ok_or_else(|| "Invalid .doc: missing piece table (Clx)".to_string())?;
        let pieces = PieceTable::parse(clx)?;
        let declared_cp_max = fib
            .ccp
            .checked_total()
            .ok_or_else(|| "Invalid .doc: FIB story character counts overflow".to_string())?;
        if declared_cp_max > pieces.cp_max() {
            return Err(format!(
                "Invalid .doc: FIB stories end at CP {declared_cp_max}, beyond piece table CP {}",
                pieces.cp_max()
            ));
        }

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{build_doc_model, DocNode, ParagraphChildNode};

    fn document_bytes(text: &str, compressed: bool) -> Vec<u8> {
        let units: Vec<u16> = text.encode_utf16().collect();
        let mut word = vec![0u8; 512];
        word[0..2].copy_from_slice(&0xa5ecu16.to_le_bytes());
        word[2..4].copy_from_slice(&0x00c1u16.to_le_bytes());
        word[10..12].copy_from_slice(&0x0204u16.to_le_bytes());
        word[32..34].copy_from_slice(&14u16.to_le_bytes());
        word[62..64].copy_from_slice(&22u16.to_le_bytes());
        word[76..80].copy_from_slice(&(units.len() as u32).to_le_bytes());
        word[152..154].copy_from_slice(&34u16.to_le_bytes());
        word[422..426].copy_from_slice(&21u32.to_le_bytes());
        for unit in &units {
            if compressed {
                assert!(*unit <= 0x7f);
                word.push(*unit as u8);
            } else {
                word.extend(unit.to_le_bytes());
            }
        }
        let mut table = vec![0u8; 21];
        table[0] = 2;
        table[1..5].copy_from_slice(&16u32.to_le_bytes());
        table[9..13].copy_from_slice(&(units.len() as u32).to_le_bytes());
        let offset = if compressed { 0x40000400u32 } else { 512u32 };
        table[15..19].copy_from_slice(&offset.to_le_bytes());
        cfb::tests::build_cfb(&[("WordDocument", &word), ("1Table", &table)])
    }

    #[test]
    fn parses_generated_binary_text_through_model_pipeline() {
        for (text, compressed) in [
            ("Plain text\rSecond line\r", true),
            ("Caf\u{e9} \u{201c}text\u{201d}\rSecond line\r", false),
        ] {
            let bytes = document_bytes(text, compressed);
            let doc = DocFile::open(&bytes).expect("open generated document");
            assert_eq!(
                String::from_utf16_lossy(&doc.text(0, doc.fib.ccp.text)),
                text
            );
            let package = parse_doc(&bytes).expect("parse generated document");
            let model = build_doc_model(&package);
            let paragraphs: Vec<String> = model
                .nodes
                .iter()
                .filter_map(|node| {
                    let DocNode::Paragraph(paragraph) = node else {
                        return None;
                    };
                    Some(
                        paragraph
                            .children
                            .iter()
                            .filter_map(|child| {
                                if let ParagraphChildNode::Text(run) = child {
                                    Some(run.text.as_str())
                                } else {
                                    None
                                }
                            })
                            .collect(),
                    )
                })
                .collect();
            assert_eq!(
                paragraphs,
                text.trim_end_matches('\r').split('\r').collect::<Vec<_>>()
            );
        }
    }
}
