pub mod model;
pub mod package;
pub mod parse;
pub mod serialize;
pub mod xml;
pub mod zip;

pub use model::*;
pub use package::*;
pub use parse::build_doc_model;
pub use serialize::{model_to_document_xml, serialize_doc_model, serialize_docx};
pub use zip::{create_minimal_docx_package, package_to_bytes, parse_docx};
