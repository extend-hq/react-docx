use serde::{Deserialize, Serialize};

use crate::{structured::package_identity, OoxmlPackage};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceAttribute {
    pub namespace: Option<String>,
    pub name: String,
    pub value: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceElement {
    pub id: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    pub byte_start: usize,
    pub byte_end: usize,
    pub attributes: Vec<SourceAttribute>,
    pub children: Vec<SourceElement>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcePart {
    pub name: String,
    pub byte_length: usize,
    pub root: Option<SourceElement>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSourceGraph {
    pub schema_version: u32,
    pub document_id: String,
    pub parts: Vec<SourcePart>,
    pub assets: Vec<SourcePart>,
    pub warnings: Vec<String>,
    pub preserved_features: Vec<PreservedFeature>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreservedFeature {
    pub part_name: String,
    pub feature: String,
    pub occurrences: usize,
    pub support: String,
}

fn preserved_feature_kind(ns: &str, local: &str) -> Option<(&'static str, &'static str)> {
    let word = ns.ends_with("wordprocessingml/2006/main") || ns.ends_with("wordprocessingml/main");
    if word {
        let feature = match local {
            "altChunk" => Some("altChunk"),
            "subDoc" => Some("subDoc"),
            "object" => Some("object"),
            "control" => Some("control"),
            "movie" => Some("movie"),
            "sound" => Some("sound"),
            _ => None,
        };
        if let Some(feature) = feature {
            return Some((feature, "preserved_only"));
        }
    }
    if ns.contains("drawingml") && ns.contains("diagram") && local == "dataModel" {
        Some(("diagram", "preserved_only"))
    } else if ns.ends_with("/math") && local == "oMath" {
        Some(("equation", "approximate_rendering"))
    } else {
        None
    }
}

pub fn preserved_features(package: &OoxmlPackage) -> Vec<PreservedFeature> {
    let mut features = std::collections::BTreeMap::<(String, String, String), usize>::new();
    for part in package.parts.values() {
        if crate::xml_index::contains_local_names(&part.content, &[
            "altChunk", "subDoc", "object", "control", "movie", "sound", "dataModel", "oMath",
        ]) == Some(false) {
            continue;
        }
        if ![
            "altChunk",
            "subDoc",
            "object",
            "control",
            "movie",
            "sound",
            "dataModel",
            "oMath",
        ]
        .iter()
        .any(|name| part.content.contains(name))
        {
            continue;
        }
        if crate::xml_index::feature_names(&part.content, &[
            "altChunk", "subDoc", "object", "control", "movie", "sound", "dataModel", "oMath",
        ], |namespace, local| {
            if let Some((feature, support)) = preserved_feature_kind(namespace, local) {
                *features.entry((part.name.clone(), feature.into(), support.into())).or_default() += 1;
            }
        }).is_some() {
            continue;
        }
        let Ok(doc) = roxmltree::Document::parse(&part.content) else {
            continue;
        };
        for node in doc.descendants().filter(|n| n.is_element()) {
            let ns = node.tag_name().namespace().unwrap_or("");
            let local = node.tag_name().name();
            let feature = preserved_feature_kind(ns, local);
            if let Some((feature, support)) = feature {
                *features
                    .entry((part.name.clone(), feature.into(), support.into()))
                    .or_default() += 1;
            }
        }
    }
    features
        .into_iter()
        .map(
            |((part_name, feature, support), occurrences)| PreservedFeature {
                part_name,
                feature,
                support,
                occurrences,
            },
        )
        .collect()
}

pub fn document_source_graph(package: &OoxmlPackage) -> DocumentSourceGraph {
    fn element(node: roxmltree::Node<'_, '_>, id: String) -> SourceElement {
        let range = node.range();
        SourceElement {
            id: id.clone(),
            kind: if node.is_root() {
                "document"
            } else if node.is_element() {
                "element"
            } else if node.is_text() {
                "text"
            } else if node.is_comment() {
                "comment"
            } else {
                "processing_instruction"
            }
            .into(),
            namespace: node.tag_name().namespace().map(str::to_string),
            name: if node.is_element() {
                Some(node.tag_name().name().to_string())
            } else {
                node.pi().map(|pi| pi.target.to_string())
            },
            text: if node.is_element() || node.is_root() {
                None
            } else if let Some(pi) = node.pi() {
                pi.value.map(str::to_string)
            } else {
                node.text().map(str::to_string)
            },
            byte_start: range.start,
            byte_end: range.end,
            attributes: node
                .attributes()
                .map(|attribute| SourceAttribute {
                    namespace: attribute.namespace().map(str::to_string),
                    name: attribute.name().to_string(),
                    value: attribute.value().to_string(),
                })
                .collect(),
            children: node
                .children()
                .enumerate()
                .map(|(index, child)| element(child, format!("{id}/{index}")))
                .collect(),
        }
    }
    let document_id = package_identity(package);
    let mut parts = package
        .parts
        .values()
        .map(|part| {
            let parsed = roxmltree::Document::parse(&part.content);
            SourcePart {
                name: part.name.clone(),
                byte_length: part.content.len(),
                root: parsed
                    .as_ref()
                    .ok()
                    .map(|doc| element(doc.root(), format!("{document_id}/{}/0", part.name))),
                error: parsed.err().map(|e| e.to_string()),
            }
        })
        .collect::<Vec<_>>();
    let mut assets = package
        .binary_assets
        .iter()
        .map(|(name, bytes)| SourcePart {
            name: name.clone(),
            byte_length: bytes.len(),
            root: None,
            error: None,
        })
        .collect::<Vec<_>>();
    parts.sort_by(|a, b| a.name.cmp(&b.name));
    assets.sort_by(|a, b| a.name.cmp(&b.name));
    DocumentSourceGraph {
        schema_version: 1,
        document_id,
        parts,
        assets,
        warnings: package.warnings.clone(),
        preserved_features: preserved_features(package),
    }
}

#[cfg(test)]
mod indexed_feature_tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn indexed_counts_match_dom_for_valid_and_malformed_markup() {
        let headers = [
            "<w:root xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\" xmlns:x=\"urn:other\">",
            "<w:root xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\" xmlns:x=\"\">",
            "<w:root xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\">",
            "<?xml version=\"1.0\"?><w:root xmlns:w=\"http://purl.oclc.org/ooxml/wordprocessingml/main\" xmlns:m=\"http://purl.oclc.org/ooxml/officeDocument/math\">",
        ];
        let bodies = [
            "<w:object/><w:p x:xmlns=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><object/></w:p>",
            "<w:object/><w:p x:value=\"a\" value=\"b\"/>",
            "<w:object/><m:oMath/><w:object/><m:OMATH/>",
            "<w:object w:value=\"&#9;&#10;&#13;\"/>",
            "<w:object w:value=\"content &amp; detail\"/>",
            "<w:object w:1invalid=\"value\"/>",
            "<w:object/><w:1invalid/>",
            "<w:object/><w:p>\u{0001}</w:p>",
            "<w:object/><w:p>\u{fffe}</w:p>",
            "<w:object/><w:p>&#65;</w:p>",
            "<w:object/><w:p>&#X41;</w:p>",
            "<w:object/><w:p>&#+65;</w:p>",
            "<w:object/><w:p>]]></w:p>",
            "<w:object/><?xml version=\"1.0\"?>",
            "<w:object/><w:p xmlns:w=\"urn:other\"><w:object/></w:p>",
            "<w:object/><w:p w:value=\"a\" w:value=\"b\"/>",
            "<w:object/><w:p><w:t>content &unknown;</w:t></w:p>",
            "<w:object/><w:p><w:t>content</w:p>",
        ];
        let mut fast = 0;
        for header in headers {
            for body in bodies {
                let xml = format!("{header}{body}</w:root>");
                let part = crate::package::OoxmlPart { name: "part.xml".into(), content: xml };
                let package = OoxmlPackage {
                    parts: HashMap::from([(part.name.clone(), part)]),
                    binary_assets: HashMap::new(), warnings: Vec::new(),
                };
                let expected = preserved_features(&package);
                let part = package.parts.values().next().unwrap();
                let mut prepared = HashMap::new();
                if let Some(index) = crate::xml_index::Index::canonical(&part.content)
                    .or_else(|| crate::xml_index::Index::canonical_normalized(&part.content)) {
                    prepared.insert(part.name.clone(), index);
                }
                let _indexes = crate::xml_index::scope(
                    package.parts.values().map(|part| (part.name.as_str(), part.content.as_str())), prepared,
                );
                if crate::xml_index::feature_names(&part.content, &["object", "oMath"], |_, _| {}).is_some() {
                    fast += 1;
                    assert!(roxmltree::Document::parse(&part.content).is_ok());
                }
                assert_eq!(serde_json::to_value(preserved_features(&package)).unwrap(),
                    serde_json::to_value(expected).unwrap());
            }
        }
        assert!(fast >= 6);
    }
}

#[cfg(test)]
mod hoisted_feature_tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn hoisted_counts_preserve_invalid_text_and_depth_fallbacks() {
        let mut accelerated = 0;
        for depth in [0, 1, 16, 62, 63, 64, 65] {
            for body in [
                "<w:object/><m:oMath/><m:OMATH/>",
                "<w:object/><w:t>\u{0001}</w:t>",
                "<w:object/><w:t>\u{fffe}</w:t>",
                "<w:object/><w:t>é\u{10000}&amp;</w:t>",
                "<w:object w:value=\"&#9;&#10;&#13;\"/>",
                "<w:object w:value=\"\u{0001}\"/>",
            ] {
                let xml = format!(
                    "<w:root xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\">{}{body}{}</w:root>",
                    "<w:p>".repeat(depth), "</w:p>".repeat(depth),
                );
                let Some((content, index)) = crate::xml_index::Index::canonical_hoisted(&xml) else { continue; };
                let part = crate::package::OoxmlPart { name: "part.xml".into(), content };
                let package = OoxmlPackage {
                    parts: HashMap::from([(part.name.clone(), part)]),
                    binary_assets: HashMap::new(), warnings: Vec::new(),
                };
                let expected = preserved_features(&package);
                let part = package.parts.values().next().unwrap();
                let _indexes = crate::xml_index::scope(
                    package.parts.values().map(|part| (part.name.as_str(), part.content.as_str())),
                    HashMap::from([(part.name.clone(), index)]),
                );
                if crate::xml_index::feature_names(&part.content, &["object", "oMath"], |_, _| {}).is_some() {
                    accelerated += 1;
                    assert!(roxmltree::Document::parse(&part.content).is_ok());
                }
                assert_eq!(serde_json::to_value(preserved_features(&package)).unwrap(),
                    serde_json::to_value(expected).unwrap());
            }
        }
        assert!(accelerated >= 6);
    }
}
