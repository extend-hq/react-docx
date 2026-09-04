use std::collections::HashMap;

use docx_core::{
    build_doc_model, model_to_document_xml, package_to_bytes, parse_document_bytes,
    serialize_doc_model, DocModel, OoxmlPackage, OoxmlPart,
};
use js_sys::{Array, Object, Reflect};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn performance_now() -> f64;
}

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

fn js_bytes_to_vec(value: &JsValue, key: &str) -> Result<Vec<u8>, JsValue> {
    if let Some(bytes) = value.dyn_ref::<js_sys::Uint8Array>() {
        return Ok(bytes.to_vec());
    }
    if let Some(buffer) = value.dyn_ref::<js_sys::ArrayBuffer>() {
        return Ok(js_sys::Uint8Array::new(buffer).to_vec());
    }
    // Legacy packages produced before the Uint8Array transport carry number[].
    if js_sys::Array::is_array(value) {
        return Ok(js_sys::Uint8Array::new(value).to_vec());
    }
    Err(JsValue::from_str(&format!(
        "Binary asset {key:?} must be a Uint8Array, ArrayBuffer, or number[]"
    )))
}

/// Binary assets cross the boundary structurally; only `parts` (XML text) goes
/// through JSON, where JSON.parse/stringify outperforms per-property reflection.
fn value_to_ooxml_package(value: &JsValue) -> Result<OoxmlPackage, JsValue> {
    if !value.is_object() || js_sys::Array::is_array(value) {
        return Err(JsValue::from_str("Package must be an object"));
    }

    let parts_value = Reflect::get(value, &JsValue::from_str("parts"))
        .map_err(|error| JsValue::from_str(&format!("Failed to read package parts: {error:?}")))?;
    if parts_value.is_undefined() || parts_value.is_null() {
        return Err(JsValue::from_str("Invalid OoxmlPackage: missing field `parts`"));
    }
    let parts_json = js_sys::JSON::stringify(&parts_value)
        .map_err(|error| JsValue::from_str(&format!("Failed to stringify parts: {error:?}")))?;
    let parts_json_str = parts_json
        .as_string()
        .ok_or_else(|| JsValue::from_str("Package parts must be JSON-serializable"))?;
    let parts: HashMap<String, OoxmlPart> = serde_json::from_str(&parts_json_str)
        .map_err(|error| JsValue::from_str(&format!("Invalid OoxmlPackage parts: {error}")))?;

    let assets_value = Reflect::get(value, &JsValue::from_str("binaryAssets"))
        .map_err(|error| JsValue::from_str(&format!("Failed to read binaryAssets: {error:?}")))?;
    if assets_value.is_undefined() || assets_value.is_null() {
        return Err(JsValue::from_str(
            "Invalid OoxmlPackage: missing field `binaryAssets`",
        ));
    }
    // typeof-based check, not instanceof: binaryAssets may be a
    // prototype-less dictionary or come from another realm.
    if !assets_value.is_object() {
        return Err(JsValue::from_str("binaryAssets must be an object"));
    }
    let mut binary_assets = HashMap::new();
    for key in Object::keys(assets_value.unchecked_ref::<Object>()).iter() {
        let name = key
            .as_string()
            .ok_or_else(|| JsValue::from_str("binaryAssets keys must be strings"))?;
        let entry = Reflect::get(&assets_value, &key).map_err(|error| {
            JsValue::from_str(&format!("Failed to read binary asset {name:?}: {error:?}"))
        })?;
        binary_assets.insert(name.clone(), js_bytes_to_vec(&entry, &name)?);
    }

    let warnings_value = Reflect::get(value, &JsValue::from_str("warnings"))
        .map_err(|error| JsValue::from_str(&format!("Failed to read warnings: {error:?}")))?;
    let mut warnings = Vec::new();
    if !warnings_value.is_undefined() && !warnings_value.is_null() {
        if !Array::is_array(&warnings_value) {
            return Err(JsValue::from_str("warnings must be a string array"));
        }
        for warning in Array::from(&warnings_value).iter() {
            let warning = warning
                .as_string()
                .ok_or_else(|| JsValue::from_str("warnings must contain only strings"))?;
            warnings.push(warning);
        }
    }

    Ok(OoxmlPackage {
        parts,
        binary_assets,
        warnings,
    })
}

fn package_to_js(pkg: &OoxmlPackage) -> Result<JsValue, JsValue> {
    // Part names mirror the map keys; emit the key as the part name so the two
    // can never disagree on the JS side.
    let mut parts_map = serde_json::Map::with_capacity(pkg.parts.len());
    for (key, part) in &pkg.parts {
        parts_map.insert(
            key.clone(),
            serde_json::json!({ "name": key, "content": part.content }),
        );
    }
    let parts_json = serde_json::to_string(&serde_json::Value::Object(parts_map))
        .map_err(|error| JsValue::from_str(&format!("Parts serialization failed: {error}")))?;
    let parts_js = js_sys::JSON::parse(&parts_json)
        .map_err(|error| JsValue::from_str(&format!("Parts JSON parse failed: {error:?}")))?;

    // Null-prototype object: asset names come verbatim from zip entry names,
    // and [[Set]] on a normal object would hit the Object.prototype __proto__
    // accessor for an entry named "__proto__" instead of storing the asset.
    let assets: Object = Object::create(JsValue::NULL.unchecked_ref());
    for (key, bytes) in &pkg.binary_assets {
        let array = js_sys::Uint8Array::from(bytes.as_slice());
        Reflect::set(&assets, &JsValue::from_str(key), &array.into()).map_err(|error| {
            JsValue::from_str(&format!("Failed to set binary asset {key:?}: {error:?}"))
        })?;
    }

    let result = Object::new();
    Reflect::set(&result, &JsValue::from_str("parts"), &parts_js)
        .map_err(|error| JsValue::from_str(&format!("Failed to set parts: {error:?}")))?;
    Reflect::set(&result, &JsValue::from_str("binaryAssets"), &assets)
        .map_err(|error| JsValue::from_str(&format!("Failed to set binaryAssets: {error:?}")))?;
    if !pkg.warnings.is_empty() {
        let warnings = Array::new();
        for warning in &pkg.warnings {
            warnings.push(&JsValue::from_str(warning));
        }
        Reflect::set(&result, &JsValue::from_str("warnings"), &warnings)
            .map_err(|error| JsValue::from_str(&format!("Failed to set warnings: {error:?}")))?;
    }
    Ok(result.into())
}

#[wasm_bindgen]
pub fn parse_docx_wasm(bytes: &[u8]) -> Result<JsValue, JsValue> {
    let pkg = parse_document_bytes(bytes).map_err(|error| JsValue::from_str(&error))?;
    package_to_js(&pkg)
}

#[wasm_bindgen]
pub fn build_doc_model_from_package(package: &JsValue) -> Result<String, JsValue> {
    let pkg = value_to_ooxml_package(package)?;
    let model = build_doc_model(&pkg);
    serde_json::to_string(&model)
        .map_err(|error| JsValue::from_str(&format!("Model serialization failed: {error}")))
}

#[wasm_bindgen]
pub fn build_doc_model_from_bytes(bytes: &[u8]) -> Result<JsValue, JsValue> {
    let started_at = performance_now();
    let pkg = parse_document_bytes(bytes).map_err(|error| JsValue::from_str(&error))?;
    let parsed_at = performance_now();
    let model = build_doc_model(&pkg);
    let model_json = serde_json::to_string(&model)
        .map_err(|error| JsValue::from_str(&format!("Model serialization failed: {error}")))?;
    let model_js = js_sys::JSON::parse(&model_json)
        .map_err(|error| JsValue::from_str(&format!("Model JSON parse failed: {error:?}")))?;
    let built_at = performance_now();

    let result = Object::new();
    Reflect::set(&result, &JsValue::from_str("package"), &package_to_js(&pkg)?)
        .map_err(|error| JsValue::from_str(&format!("Failed to set package: {error:?}")))?;
    Reflect::set(&result, &JsValue::from_str("model"), &model_js)
        .map_err(|error| JsValue::from_str(&format!("Failed to set model: {error:?}")))?;
    let timings = Object::new();
    Reflect::set(
        &timings,
        &JsValue::from_str("parseMs"),
        &JsValue::from_f64(parsed_at - started_at + performance_now() - built_at),
    )?;
    Reflect::set(
        &timings,
        &JsValue::from_str("buildModelMs"),
        &JsValue::from_f64(built_at - parsed_at),
    )?;
    Reflect::set(&result, &JsValue::from_str("timings"), &timings)?;
    Ok(result.into())
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
