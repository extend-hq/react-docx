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

pub fn preserved_features(package: &OoxmlPackage) -> Vec<PreservedFeature> {
    let mut features = std::collections::BTreeMap::<(String, String, String), usize>::new();
    for part in package.parts.values() {
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
        let Ok(doc) = roxmltree::Document::parse(&part.content) else {
            continue;
        };
        for node in doc.descendants().filter(|n| n.is_element()) {
            let ns = node.tag_name().namespace().unwrap_or("");
            let local = node.tag_name().name();
            let word =
                ns.ends_with("wordprocessingml/2006/main") || ns.ends_with("wordprocessingml/main");
            let feature = if word
                && matches!(
                    local,
                    "altChunk" | "subDoc" | "object" | "control" | "movie" | "sound"
                ) {
                Some((local, "preserved_only"))
            } else if ns.contains("drawingml") && ns.contains("diagram") && local == "dataModel" {
                Some(("diagram", "preserved_only"))
            } else if ns.ends_with("/math") && local == "oMath" {
                Some(("equation", "approximate_rendering"))
            } else {
                None
            };
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
