use docx_core::{
    build_doc_model, model_to_document_xml, package_to_bytes, parse_docx, serialize_doc_model,
    DocModel, OoxmlPackage,
};
use js_sys::{Object, Reflect};
use serde_json::Value;
use wasm_bindgen::prelude::*;

fn doc_model_from_json(json_str: &str) -> Result<DocModel, JsValue> {
    serde_json::from_str(json_str)
        .map_err(|error| JsValue::from_str(&format!("Invalid DocModel JSON: {error}")))
}

fn value_to_doc_model(value: &JsValue) -> Result<DocModel, JsValue> {
    if let Some(json_str) = value.as_string() {
        return doc_model_from_json(&json_str);
    }

    let json = js_sys::JSON::stringify(value)
        .map_err(|error| JsValue::from_str(&format!("Failed to stringify model: {error:?}")))?;
    let json_str = json
        .as_string()
        .ok_or_else(|| JsValue::from_str("Model JSON must be a string"))?;
    doc_model_from_json(&json_str)
}

fn value_to_ooxml_package(value: &JsValue) -> Result<OoxmlPackage, JsValue> {
    let json = js_sys::JSON::stringify(value)
        .map_err(|error| JsValue::from_str(&format!("Failed to stringify package: {error:?}")))?;
    let json_str = json
        .as_string()
        .ok_or_else(|| JsValue::from_str("Package JSON must be a string"))?;
    let mut parsed: Value = serde_json::from_str(&json_str)
        .map_err(|error| JsValue::from_str(&format!("Invalid OoxmlPackage JSON: {error}")))?;

    if let Some(assets) = parsed.get_mut("binaryAssets").and_then(Value::as_object_mut) {
        let keys: Vec<String> = assets.keys().cloned().collect();
        for key in keys {
            if let Some(value) = assets.remove(&key) {
                if let Some(array) = value.as_array() {
                    let bytes: Vec<u8> = array
                        .iter()
                        .filter_map(|entry| entry.as_u64().map(|n| n as u8))
                        .collect();
                    assets.insert(key, Value::Array(bytes.into_iter().map(Value::from).collect()));
                }
            }
        }
    }

    serde_json::from_value(parsed)
        .map_err(|error| JsValue::from_str(&format!("Invalid OoxmlPackage JSON: {error}")))
}

fn js_value_from_serde<T: serde::Serialize>(value: &T) -> Result<JsValue, JsValue> {
    let json = serde_json::to_string(value)
        .map_err(|error| JsValue::from_str(&format!("Serialization failed: {error}")))?;
    js_sys::JSON::parse(&json)
        .map_err(|error| JsValue::from_str(&format!("JSON parse failed: {error:?}")))
}

fn package_to_js_simple(pkg: &OoxmlPackage) -> Result<JsValue, JsValue> {
    let json = serde_json::to_string(pkg)
        .map_err(|error| JsValue::from_str(&format!("Package serialization failed: {error}")))?;
    let mut parsed: Value = serde_json::from_str(&json)
        .map_err(|error| JsValue::from_str(&format!("Package JSON invalid: {error}")))?;

    if let Some(parts) = parsed.get_mut("parts").and_then(Value::as_object_mut) {
        for (name, part) in parts.iter_mut() {
            if let Some(part_obj) = part.as_object_mut() {
                part_obj.insert("name".to_string(), Value::String(name.clone()));
            }
        }
    }

    let json = serde_json::to_string(&parsed)
        .map_err(|error| JsValue::from_str(&format!("Package re-serialization failed: {error}")))?;
    js_sys::JSON::parse(&json)
        .map_err(|error| JsValue::from_str(&format!("JSON parse failed: {error:?}")))
}

#[wasm_bindgen]
pub fn parse_docx_wasm(bytes: &[u8]) -> Result<JsValue, JsValue> {
    let pkg = parse_docx(bytes).map_err(|error| JsValue::from_str(&error))?;
    package_to_js_simple(&pkg)
}

#[wasm_bindgen]
pub fn build_doc_model_from_package(package: &JsValue) -> Result<String, JsValue> {
    let pkg = value_to_ooxml_package(package)?;
    let model = build_doc_model(&pkg);
    serde_json::to_string(&model)
        .map_err(|error| JsValue::from_str(&format!("Model serialization failed: {error}")))
}

#[wasm_bindgen]
pub fn build_doc_model_from_bytes(bytes: &[u8]) -> Result<String, JsValue> {
    let pkg = parse_docx(bytes).map_err(|error| JsValue::from_str(&error))?;
    let model = build_doc_model(&pkg);
    let payload = serde_json::json!({
        "package": pkg,
        "model": model,
    });
    serde_json::to_string(&payload)
        .map_err(|error| JsValue::from_str(&format!("Build payload serialization failed: {error}")))
}

#[wasm_bindgen]
pub fn serialize_docx_wasm(model: &JsValue, base_package: Option<JsValue>) -> Result<Vec<u8>, JsValue> {
    let doc_model = value_to_doc_model(model)?;
    let base = match base_package {
        Some(value) => Some(value_to_ooxml_package(&value)?),
        None => None,
    };
    package_to_bytes(&serialize_doc_model(&doc_model, base.as_ref()))
        .map_err(|error| JsValue::from_str(&error))
}

#[wasm_bindgen]
pub fn serialize_docx_from_json_wasm(
    model_json: &str,
    base_package: Option<JsValue>,
) -> Result<Vec<u8>, JsValue> {
    let doc_model = doc_model_from_json(model_json)?;
    let base = match base_package {
        Some(value) => Some(value_to_ooxml_package(&value)?),
        None => None,
    };
    package_to_bytes(&serialize_doc_model(&doc_model, base.as_ref()))
        .map_err(|error| JsValue::from_str(&error))
}

#[wasm_bindgen]
pub fn model_to_document_xml_wasm(
    model: &JsValue,
    base_package: Option<JsValue>,
) -> Result<String, JsValue> {
    let doc_model = value_to_doc_model(model)?;
    let base = match base_package {
        Some(value) => Some(value_to_ooxml_package(&value)?),
        None => None,
    };
    Ok(model_to_document_xml(&doc_model, base.as_ref()))
}

#[wasm_bindgen]
pub fn model_to_document_xml_from_json_wasm(
    model_json: &str,
    base_package: Option<JsValue>,
) -> Result<String, JsValue> {
    let doc_model = doc_model_from_json(model_json)?;
    let base = match base_package {
        Some(value) => Some(value_to_ooxml_package(&value)?),
        None => None,
    };
    Ok(model_to_document_xml(&doc_model, base.as_ref()))
}

#[wasm_bindgen]
pub fn package_to_array_buffer_wasm(package: &JsValue) -> Result<Vec<u8>, JsValue> {
    let pkg = value_to_ooxml_package(package)?;
    package_to_bytes(&pkg).map_err(|error| JsValue::from_str(&error))
}
