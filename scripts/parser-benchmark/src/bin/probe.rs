use std::{fs, hint::black_box, time::Instant};

fn main() {
    let args: Vec<_> = std::env::args().collect();
    let bytes = fs::read(&args[1]).unwrap();
    let repeats: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(7);
    let handle = std::thread::Builder::new().stack_size(64 * 1024 * 1024).spawn(move || {
        let mut samples = Vec::new();
        for index in 0..=repeats {
            let start = Instant::now();
            let package = docx_core::parse_document_bytes(&bytes).unwrap();
            let package_ms = start.elapsed().as_secs_f64() * 1000.0;
            let start = Instant::now();
            let model = docx_core::build_doc_model(&package);
            let model_ms = start.elapsed().as_secs_f64() * 1000.0;
            let start = Instant::now();
            let blocks = docx_core::extract_document_blocks(&model);
            let blocks_ms = start.elapsed().as_secs_f64() * 1000.0;
            black_box((&package, &model, &blocks));
            if index > 0 {
                samples.push(serde_json::json!({"package_ms":package_ms,"model_ms":model_ms,"blocks_ms":blocks_ms,"total_ms":package_ms+model_ms+blocks_ms}));
            }
        }
        samples
    }).unwrap();
    println!("{}", serde_json::json!({"samples":handle.join().unwrap()}));
}
