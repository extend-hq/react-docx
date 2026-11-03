fn main() {
    let path = std::env::args().nth(1).expect("path");
    let bytes = std::fs::read(&path).expect("read");
    let pkg = if path.ends_with(".doc") {
        extend_docx::parse_document_bytes(&bytes).expect("parse")
    } else {
        extend_docx::parse_docx(&bytes).expect("parse_docx")
    };
    let model = extend_docx::build_doc_model(&pkg);
    print!("{}", text(&model));
}
fn text(model: &extend_docx::DocModel) -> String {
    let mut out = String::new();
    for node in &model.nodes { walk(node, &mut out); }
    out
}
fn walk(node: &extend_docx::DocNode, out: &mut String) {
    match node {
        extend_docx::DocNode::Paragraph(p) => {
            for c in &p.children {
                if let extend_docx::ParagraphChildNode::Text(r) = c { out.push_str(&r.text); }
            }
            out.push('\n');
        }
        extend_docx::DocNode::Table(t) => {
            for row in &t.rows { for cell in &row.cells { for n in &cell.nodes {
                match n {
                    extend_docx::TableCellContentNode::Paragraph(p) => {
                        for c in &p.children { if let extend_docx::ParagraphChildNode::Text(r) = c { out.push_str(&r.text); } }
                        out.push('\n');
                    }
                    extend_docx::TableCellContentNode::Table(t2) => walk(&extend_docx::DocNode::Table(*t2.clone()), out),
                }
            } } }
        }
    }
}
