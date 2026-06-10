use std::fs;

fn main() {
    let dir = std::env::args().nth(1).expect("dir");
    let mut ok = 0usize;
    let mut failed: Vec<(String, String)> = Vec::new();
    let mut empty: Vec<String> = Vec::new();
    let mut entries: Vec<_> = fs::read_dir(&dir)
        .expect("read dir")
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().map(|ext| ext == "doc").unwrap_or(false))
        .collect();
    entries.sort();
    for path in entries {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) => {
                failed.push((name, format!("io: {error}")));
                continue;
            }
        };
        let result = std::panic::catch_unwind(|| {
            let pkg = docx_core::parse_document_bytes(&bytes)?;
            let model = docx_core::build_doc_model(&pkg);
            let mut text_len = 0usize;
            let mut tables = 0usize;
            for node in &model.nodes {
                match node {
                    docx_core::DocNode::Table(_) => tables += 1,
                    docx_core::DocNode::Paragraph(p) => {
                        for c in &p.children {
                            if let docx_core::ParagraphChildNode::Text(r) = c {
                                text_len += r.text.len();
                            }
                        }
                    }
                }
            }
            Ok::<(usize, usize, usize), String>((model.nodes.len(), text_len, tables))
        });
        match result {
            Ok(Ok((nodes, text_len, tables))) => {
                ok += 1;
                if text_len == 0 && tables == 0 {
                    empty.push(name.clone());
                }
                println!("OK {name}: nodes={nodes} text={text_len} tables={tables}");
            }
            Ok(Err(error)) => failed.push((name, error)),
            Err(_) => failed.push((name, "PANIC".to_string())),
        }
    }
    println!("\n=== {ok} ok, {} failed, {} empty ===", failed.len(), empty.len());
    for (name, error) in &failed {
        println!("FAIL {name}: {error}");
    }
    for name in &empty {
        println!("EMPTY {name}");
    }
}
