use docx_core::{build_doc_model, parse_docx};
use std::{env, fs, path::PathBuf};

#[test]
#[ignore = "requires DOCX_TEST_CORPUS pointing to a local document directory"]
fn parses_local_document_corpus() {
    let directory = PathBuf::from(env::var_os("DOCX_TEST_CORPUS").expect("set DOCX_TEST_CORPUS"));
    let mut paths: Vec<_> = fs::read_dir(directory)
        .expect("read corpus directory")
        .map(|entry| entry.expect("read corpus entry").path())
        .filter(|path| {
            path.extension()
                .and_then(|value| value.to_str())
                .is_some_and(|value| {
                    value.eq_ignore_ascii_case("doc") || value.eq_ignore_ascii_case("docx")
                })
        })
        .collect();
    paths.sort();
    assert!(!paths.is_empty(), "corpus must contain documents");
    for path in paths {
        let bytes = fs::read(&path).expect("read corpus input");
        let package = parse_docx(&bytes).unwrap_or_else(|error| panic!("{path:?}: {error}"));
        let model = build_doc_model(&package);
        serde_json::to_vec(&model).expect("serialize parsed model");
    }
}
