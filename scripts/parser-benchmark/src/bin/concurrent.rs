use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    hint::black_box,
    sync::{Arc, Barrier},
    time::Instant,
};

fn canonicalize(value: &mut Value, document_id: &str) {
    match value {
        Value::Array(values) => values
            .iter_mut()
            .for_each(|value| canonicalize(value, document_id)),
        Value::Object(values) => {
            for (key, value) in values.iter_mut() {
                if matches!(
                    key.as_str(),
                    "documentId" | "id" | "blockId" | "nodeId" | "parentBlockId"
                ) {
                    if let Some(id) = value.as_str() {
                        if !document_id.is_empty() {
                            if id == document_id {
                                *value = Value::String("document".into());
                            } else if let Some(suffix) =
                                id.strip_prefix(&format!("docx:{document_id}/"))
                            {
                                *value = Value::String(format!("docx:document/{suffix}"));
                            }
                        }
                    }
                }
                canonicalize(value, document_id);
            }
            let mut sorted: Vec<_> = std::mem::take(values).into_iter().collect();
            sorted.sort_unstable_by(|a, b| a.0.cmp(&b.0));
            values.extend(sorted);
        }
        _ => {}
    }
}

fn output_digest(model: &extend_docx::DocModel, blocks: &extend_docx::StructuredDocument) -> [u8; 32] {
    let mut model = serde_json::to_value(model).unwrap();
    let mut blocks = serde_json::to_value(blocks).unwrap();
    let id = model["metadata"]["documentId"]
        .as_str()
        .unwrap_or("")
        .to_owned();
    canonicalize(&mut model, &id);
    canonicalize(&mut blocks, &id);
    for key in ["paragraphStyles", "tableStyles"] {
        if let Some(styles) = model["metadata"][key].as_array_mut() {
            styles.sort_by_cached_key(|value| serde_json::to_string(value).unwrap());
        }
    }
    let mut digest = Sha256::new();
    digest.update(serde_json::to_vec(&model).unwrap());
    digest.update(serde_json::to_vec(&blocks).unwrap());
    digest.finalize().into()
}

fn run() {
    let args: Vec<_> = std::env::args().collect();
    let manifest: Value = serde_json::from_slice(&fs::read(&args[1]).unwrap()).unwrap();
    let workers: usize = args[2].parse().unwrap();
    let rounds: usize = args[3].parse().unwrap();
    let inputs: Arc<Vec<Vec<u8>>> = Arc::new(
        manifest["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| fs::read(entry["path"].as_str().unwrap()).unwrap())
            .collect(),
    );
    assert!(workers > 0 && rounds > 0);
    let audit = args.get(4).is_some_and(|arg| arg == "audit");
    let expected = Arc::new(if audit {
        inputs
            .iter()
            .map(|bytes| {
                let package = extend_docx::parse_document_bytes(bytes).unwrap();
                let model = extend_docx::build_doc_model(&package);
                output_digest(&model, &extend_docx::extract_document_blocks(&model))
            })
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    });
    let barrier = Arc::new(Barrier::new(workers + 1));
    let mut threads = Vec::new();
    for worker in 0..workers {
        let inputs = Arc::clone(&inputs);
        let barrier = Arc::clone(&barrier);
        let expected = Arc::clone(&expected);
        threads.push(
            std::thread::Builder::new()
                .stack_size(64 * 1024 * 1024)
                .spawn(move || {
                    barrier.wait();
                    let mut samples = Vec::new();
                    for round in 0..rounds {
                        for index in (worker..inputs.len()).step_by(workers) {
                            let start = Instant::now();
                            let package = extend_docx::parse_document_bytes(&inputs[index]).unwrap();
                            let model = extend_docx::build_doc_model(&package);
                            let blocks = extend_docx::extract_document_blocks(&model);
                            black_box((&package, &model, &blocks));
                            let ms = start.elapsed().as_secs_f64() * 1000.0;
                            if audit {
                                assert_eq!(
                                    output_digest(&model, &blocks),
                                    expected[index],
                                    "concurrent output changed at input {index}"
                                );
                            }
                            samples.push(json!({"input":index,"round":round,"ms":ms}));
                        }
                    }
                    samples
                })
                .unwrap(),
        );
    }
    let start = Instant::now();
    barrier.wait();
    let samples: Vec<_> = threads
        .into_iter()
        .flat_map(|thread| thread.join().unwrap())
        .collect();
    println!(
        "{}",
        json!({"audit":audit,"workers":workers,"rounds":rounds,"inputs":inputs.len(),"wall_ms":start.elapsed().as_secs_f64()*1000.0,"samples":samples})
    );
}

fn main() {
    std::thread::Builder::new()
        .stack_size(64 * 1024 * 1024)
        .spawn(run)
        .unwrap()
        .join()
        .unwrap();
}
