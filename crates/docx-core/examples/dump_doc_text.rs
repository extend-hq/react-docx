fn main() {
    let path = std::env::args().nth(1).expect("path");
    let bytes = std::fs::read(&path).expect("read");
    let pkg = if path.ends_with(".doc") {
        docx_core::parse_document_bytes(&bytes).expect("parse")
    } else {
        docx_core::parse_docx(&bytes).expect("parse_docx")
    };
    let model = docx_core::build_doc_model(&pkg);
    print!("{}", text(&model));
}
fn text(model: &docx_core::DocModel) -> String {
    let mut out = String::new();
    for node in &model.nodes { walk(node, &mut out); }
    out
}
fn walk(node: &docx_core::DocNode, out: &mut String) {
    match node {
        docx_core::DocNode::Paragraph(p) => {
            for c in &p.children {
                if let docx_core::ParagraphChildNode::Text(r) = c { out.push_str(&r.text); }
            }
            out.push('\n');
        }
        docx_core::DocNode::Table(t) => {
            for row in &t.rows { for cell in &row.cells { for n in &cell.nodes {
                match n {
                    docx_core::TableCellContentNode::Paragraph(p) => {
                        for c in &p.children { if let docx_core::ParagraphChildNode::Text(r) = c { out.push_str(&r.text); } }
                        out.push('\n');
                    }
                    docx_core::TableCellContentNode::Table(t2) => walk(&docx_core::DocNode::Table(*t2.clone()), out),
                }
            } } }
        }
    }
}
