use std::{fs, hint::black_box, io::{BufWriter, Cursor, Write}, sync::Arc, time::Instant};
use flate2::{write::GzEncoder, Compression};
use serde::Serialize;
use serde_json::{json, Value};
mod compact;

enum Parsed {
    Core(docx_core::DocModel, docx_core::StructuredDocument),
    Rs(docx_rs::Docx),
    Oxide(office_oxide::ir::DocumentIR),
    Undoc(undoc::Document),
}

fn parse(engine: &str, bytes: &Arc<[u8]>, format: &str) -> Result<(Parsed, [f64; 2]), String> {
    let start = Instant::now();
    match engine {
        "docx-core" => {
            let package = docx_core::parse_document_bytes(bytes)?;
            let model = docx_core::build_doc_model(&package);
            let parse_ms = start.elapsed().as_secs_f64() * 1000.0;
            let projection_start = Instant::now();
            let blocks = docx_core::extract_document_blocks(&model);
            let project_ms = projection_start.elapsed().as_secs_f64() * 1000.0;
            Ok((Parsed::Core(model, blocks), [parse_ms, project_ms]))
        }
        "docx-rs" => {
            if format != "docx" { return Err("unsupported_format: legacy DOC".into()); }
            let doc = docx_rs::read_docx_with_options(bytes, docx_rs::ReadDocxOptions::default().with_image_previews(false))
                .map_err(|e| e.to_string())?;
            Ok((Parsed::Rs(doc), [start.elapsed().as_secs_f64() * 1000.0, 0.0]))
        }
        "office_oxide" => {
            let format = if format == "doc" { office_oxide::format::DocumentFormat::Doc } else { office_oxide::format::DocumentFormat::Docx };
            let doc = office_oxide::Document::from_reader(Cursor::new(Arc::clone(bytes)), format).map_err(|e| e.to_string())?;
            let parse_ms = start.elapsed().as_secs_f64() * 1000.0;
            let projection_start = Instant::now();
            let ir = doc.to_ir();
            let project_ms = projection_start.elapsed().as_secs_f64() * 1000.0;
            Ok((Parsed::Oxide(ir), [parse_ms, project_ms]))
        }
        "undoc" => {
            let doc = undoc::parse_bytes(bytes).map_err(|e| e.to_string())?;
            Ok((Parsed::Undoc(doc), [start.elapsed().as_secs_f64() * 1000.0, 0.0]))
        }
        _ => Err("unknown engine".into()),
    }
}

fn write_json<T: Serialize>(path: &str, data: &T) -> Result<(), String> {
    let file = fs::File::create(path).map_err(|e| e.to_string())?;
    let mut writer = GzEncoder::new(BufWriter::new(file), Compression::fast());
    serde_json::to_writer(&mut writer, data).map_err(|e| e.to_string())?;
    writer.finish().map_err(|e| e.to_string())?.flush().map_err(|e| e.to_string())
}

fn run(args: &[String]) -> Result<Value, String> {
    let engine = &args[1];
    let bytes: Arc<[u8]> = fs::read(&args[2]).map_err(|e| e.to_string())?.into();
    let format = &args[3];
    let output = &args[4];
    let repeats: usize = args.get(5).and_then(|s| s.parse().ok()).unwrap_or(5);
    let (warm, warm_ms) = parse(engine, &bytes, format)?;
    let compact_output = args.get(6).is_some_and(|arg| arg == "compact");
    if output != "-" { match &warm {
        Parsed::Core(model, blocks) => {
            if compact_output {
                write_json(&format!("{output}.json.gz"), &compact::model(model))?;
            } else {
                write_json(&format!("{output}.json.gz"), model)?;
            }
            if compact_output {
                write_json(&format!("{output}.blocks.json.gz"), &compact::blocks(blocks))?;
            } else {
                write_json(&format!("{output}.blocks.json.gz"), blocks)?;
            }
        }
        Parsed::Rs(doc) => write_json(&format!("{output}.json.gz"), doc)?,
        Parsed::Oxide(doc) => write_json(&format!("{output}.json.gz"), doc)?,
        Parsed::Undoc(doc) => write_json(&format!("{output}.json.gz"), doc)?,
    } }
    drop(warm);
    let loops = ((20.0 / warm_ms.iter().sum::<f64>().max(0.01)).ceil() as usize).clamp(1, 20);
    let mut samples = Vec::new();
    for _ in 0..repeats {
        let mut elapsed = [0.0, 0.0];
        for _ in 0..loops {
            let (model, timings) = parse(engine, &bytes, format)?;
            black_box(&model);
            elapsed[0] += timings[0];
            elapsed[1] += timings[1];
            drop(model);
        }
        samples.push(json!({"parse_ms":elapsed[0]/loops as f64,"projection_ms":elapsed[1]/loops as f64,"total_ms":elapsed.iter().sum::<f64>()/loops as f64}));
    }
    Ok(json!({"status":"ok","engine":engine,"input_bytes":bytes.len(),"warm_ms":warm_ms,"loops":loops,"samples":samples,"compact_output":compact_output}))
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 5 { eprintln!("usage: parser-benchmark ENGINE INPUT FORMAT OUTPUT_PREFIX [REPEATS]"); std::process::exit(2); }
    std::panic::set_hook(Box::new(|_| {}));
    let result = std::thread::Builder::new().stack_size(64 * 1024 * 1024).spawn(move || {
        std::panic::catch_unwind(|| run(&args))
    }).unwrap().join();
    let result = match result {
        Ok(Ok(Ok(v))) => v,
        Ok(Ok(Err(e))) => json!({"status":"error","error":e}),
        _ => json!({"status":"panic"}),
    };
    println!("{}", result);
}
