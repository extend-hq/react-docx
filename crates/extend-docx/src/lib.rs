//! Native and WebAssembly-compatible Word document parsing, modeling, and serialization.

pub mod chart;
pub mod doc;
pub mod emf;
pub mod model;
pub mod package;
pub mod parse;
pub mod revisions;
pub mod serialize;
pub mod source_graph;
pub mod structured;
pub mod table_grid;
mod wmf;
pub mod xml;
mod xml_index;
pub mod zip;

pub use chart::{extract_chart_data, ChartCategory, ChartData, ChartPoint, ChartSeries};
pub use doc::{is_doc_format, parse_doc};
pub use model::*;
pub use package::*;
pub use parse::build_doc_model;
pub use revisions::{
    DocumentRevision, ReviewedDocument, RevisionKind, RevisionProperties, RevisionScope,
    WordProperty,
};
pub use source_graph::{document_source_graph, DocumentSourceGraph};
pub use structured::{
    extract_document_blocks, extract_document_blocks_with_options,
    extract_document_blocks_with_revisions, BlockDetails, BlockType, DocumentBlock, DocumentWord,
    ExtractDocumentBlocksOptions, ParagraphDetails, ParagraphInline, SourceRef, StructuredDocument,
    TableCellDetails,
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

/// Parse Word bytes and return current blocks together with their tracked revisions.
pub fn parse_document_blocks_with_revisions(
    bytes: &[u8],
    options: ExtractDocumentBlocksOptions,
) -> Result<ReviewedDocument, String> {
    let package = parse_document_bytes(bytes)?;
    Ok(extract_document_blocks_with_revisions(
        &build_doc_model(&package),
        options,
    ))
}

pub use serialize::{
    can_preserve_image_paint_source, model_to_document_xml, serialize_doc_model, serialize_docx,
    try_serialize_doc_model, validate_image_paint_bounds,
};
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
