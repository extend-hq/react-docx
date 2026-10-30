pub mod doc;
pub mod emf;
pub mod model;
pub mod package;
pub mod parse;
pub mod serialize;
pub mod source_graph;
pub mod structured;
pub mod table_grid;
pub mod xml;
mod xml_index;
pub mod zip;

pub use doc::{is_doc_format, parse_doc};
pub use model::*;
pub use package::*;
pub use parse::build_doc_model;
pub use source_graph::{document_source_graph, DocumentSourceGraph};
pub use structured::{
    extract_document_blocks, extract_document_blocks_with_options, BlockDetails, BlockType,
    DocumentBlock, DocumentWord, ExtractDocumentBlocksOptions, ParagraphDetails, ParagraphInline,
    SourceRef, StructuredDocument,
};

pub fn parse_document_blocks(bytes: &[u8]) -> Result<StructuredDocument, String> {
    parse_document_blocks_with_options(bytes, ExtractDocumentBlocksOptions::default())
}

pub fn parse_document_blocks_with_options(
    bytes: &[u8],
    options: ExtractDocumentBlocksOptions,
) -> Result<StructuredDocument, String> {
    let package = parse_document_bytes(bytes)?;
    Ok(extract_document_blocks_with_options(
        &build_doc_model(&package),
        options,
    ))
}
pub use serialize::{model_to_document_xml, serialize_doc_model, serialize_docx};
pub use zip::{create_minimal_docx_package, package_to_bytes, parse_docx};

/// Parses either a DOCX (OOXML zip) or a legacy Word 97-2003 binary `.doc`
/// file, detected by magic bytes, into the same in-memory package shape.
pub fn parse_document_bytes(bytes: &[u8]) -> Result<OoxmlPackage, String> {
    if is_doc_format(bytes) {
        parse_doc(bytes)
    } else {
        parse_docx(bytes)
    }
}
