#[path = "../direct_merkle.rs"]
mod direct_merkle;

use sha2::{Digest, Sha256};

fn run(path: &str) -> Result<serde_json::Value, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let input_sha256 = format!("{:x}", Sha256::digest(&bytes));
    let package = docx_core::parse_document_bytes(&bytes)?;
    let model = docx_core::build_doc_model(&package);
    let blocks = docx_core::extract_document_blocks(&model);
    let model_digest = direct_merkle::digest(&model).map_err(|e| e.to_string())?;
    let blocks_digest = direct_merkle::digest(&blocks).map_err(|e| e.to_string())?;
    Ok(
        serde_json::json!({"status":"ok","input_sha256":input_sha256,"model":model_digest,"blocks":blocks_digest}),
    )
}

fn main() {
    let path = std::env::args().nth(1).expect("missing input");
    std::panic::set_hook(Box::new(|_| {}));
    let result = std::thread::Builder::new()
        .stack_size(64 * 1024 * 1024)
        .spawn(move || std::panic::catch_unwind(|| run(&path)))
        .unwrap()
        .join();
    let result = match result {
        Ok(Ok(Ok(value))) => value,
        Ok(Ok(Err(error))) => serde_json::json!({"status":"error","error":error}),
        _ => serde_json::json!({"status":"panic"}),
    };
    println!("{result}");
}
