fn main() {
    let path = std::env::args().nth(1).expect("path");
    let bytes = std::fs::read(&path).expect("read");
    let pkg = if path.ends_with(".doc") {
        docx_core::parse_document_bytes(&bytes).expect("parse")
    } else {
        docx_core::parse_docx(&bytes).expect("parse_docx")
    };
    let model = docx_core::build_doc_model(&pkg);
    println!("parts: {}", pkg.parts.len());
    println!("binary assets: {:?}", pkg.binary_assets.keys().collect::<Vec<_>>());
    println!("headers: {}", model.metadata.header_sections.len());
    println!("footers: {}", model.metadata.footer_sections.len());
    println!("numbering: {}", model.metadata.numbering_definitions.is_some());
    println!("footnotes: {:?}", model.metadata.footnotes.as_ref().map(|n| n.len()));
    for h in &model.metadata.header_sections {
        println!("  header {} type={:?} nodes={}", h.part_name, h.reference_type, h.nodes.len());
    }
    println!("warnings: {:?}", &model.metadata.warnings);
}
