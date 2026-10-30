use flate2::{write::GzEncoder, Compression};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    fs,
    hint::black_box,
    io::{BufWriter, Write},
    sync::Arc,
    time::Instant,
};

enum Parsed {
    Core(docx_core::DocModel, docx_core::StructuredDocument),
}
fn parse(_: &str, bytes: &Arc<[u8]>, _: &str) -> Result<(Parsed, [f64; 3]), String> {
    let start = Instant::now();
    let package = docx_core::parse_document_bytes(bytes)?;
    let package_ms = start.elapsed().as_secs_f64() * 1000.0;
    let start = Instant::now();
    let model = docx_core::build_doc_model(&package);
    let model_ms = start.elapsed().as_secs_f64() * 1000.0;
    let start = Instant::now();
    let blocks = docx_core::extract_document_blocks(&model);
    let blocks_ms = start.elapsed().as_secs_f64() * 1000.0;
    Ok((
        Parsed::Core(model, blocks),
        [package_ms, model_ms, blocks_ms],
    ))
}

fn write_json<T: Serialize>(path: &str, data: &T) -> Result<(), String> {
    let file = fs::File::create(path).map_err(|e| e.to_string())?;
    let mut writer = GzEncoder::new(BufWriter::new(file), Compression::fast());
    serde_json::to_writer(&mut writer, data).map_err(|e| e.to_string())?;
    writer
        .finish()
        .map_err(|e| e.to_string())?
        .flush()
        .map_err(|e| e.to_string())
}

fn run(args: &[String]) -> Result<Value, String> {
    let engine = &args[1];
    let bytes: Arc<[u8]> = fs::read(&args[2]).map_err(|e| e.to_string())?.into();
    let format = &args[3];
    let output = &args[4];
    let repeats: usize = args.get(5).and_then(|s| s.parse().ok()).unwrap_or(5);
    let (warm, warm_ms) = parse(engine, &bytes, format)?;
    if output != "-" {
        let Parsed::Core(model, blocks) = &warm;
        write_json(&format!("{output}.json.gz"), model)?;
        write_json(&format!("{output}.blocks.json.gz"), blocks)?;
    }
    drop(warm);
    let loops = ((20.0 / warm_ms.iter().sum::<f64>().max(0.01)).ceil() as usize).clamp(1, 20);
    let mut samples = Vec::new();
    for _ in 0..repeats {
        let mut elapsed = [0.0; 3];
        for _ in 0..loops {
            let (model, timings) = parse(engine, &bytes, format)?;
            black_box(&model);
            elapsed[0] += timings[0];
            elapsed[1] += timings[1];
            elapsed[2] += timings[2];
            drop(model);
        }
        samples.push(json!({"package_ms":elapsed[0]/loops as f64,"model_ms":elapsed[1]/loops as f64,"projection_ms":elapsed[2]/loops as f64,"total_ms":elapsed.iter().sum::<f64>()/loops as f64}));
    }
    Ok(
        json!({"status":"ok","engine":engine,"input_bytes":bytes.len(),"warm_ms":warm_ms,"loops":loops,"samples":samples,"compact_output":false}),
    )
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 5 {
        eprintln!("usage: parser-benchmark ENGINE INPUT FORMAT OUTPUT_PREFIX [REPEATS]");
        std::process::exit(2);
    }
    std::panic::set_hook(Box::new(|_| {}));
    let result = std::thread::Builder::new()
        .stack_size(64 * 1024 * 1024)
        .spawn(move || std::panic::catch_unwind(|| run(&args)))
        .unwrap()
        .join();
    let result = match result {
        Ok(Ok(Ok(v))) => v,
        Ok(Ok(Err(e))) => json!({"status":"error","error":e}),
        _ => json!({"status":"panic"}),
    };
    println!("{}", result);
}
