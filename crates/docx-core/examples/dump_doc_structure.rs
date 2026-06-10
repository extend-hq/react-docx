fn main() {
    let path = std::env::args().nth(1).expect("path");
    let bytes = std::fs::read(&path).expect("read");
    let pkg = if path.ends_with(".doc") {
        docx_core::parse_document_bytes(&bytes).expect("parse")
    } else {
        docx_core::parse_docx(&bytes).expect("parse_docx")
    };
    let model = docx_core::build_doc_model(&pkg);
    for (i, node) in model.nodes.iter().enumerate() {
        match node {
            docx_core::DocNode::Paragraph(p) => {
                let text: String = p.children.iter().filter_map(|c| match c {
                    docx_core::ParagraphChildNode::Text(r) => Some(r.text.clone()),
                    _ => None,
                }).collect();
                println!("{i:3} P {:?}", &text.chars().take(60).collect::<String>());
            }
            docx_core::DocNode::Table(t) => {
                println!("{i:3} T rows={} cols(first)={}", t.rows.len(),
                    t.rows.first().map(|r| r.cells.len()).unwrap_or(0));
            }
        }
    }
}
