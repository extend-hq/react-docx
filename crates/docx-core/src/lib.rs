pub mod doc;
pub mod emf;
pub mod model;
pub mod package;
pub mod parse;
pub mod serialize;
pub mod xml;
pub mod zip;

pub use doc::{is_doc_format, parse_doc};
pub use model::*;
pub use package::*;
pub use parse::build_doc_model;
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
