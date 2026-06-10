use std::collections::HashMap;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

mod byte_asset_map {
    use super::*;

    pub fn serialize<S>(map: &HashMap<String, Vec<u8>>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        use serde::ser::SerializeMap;
        let mut ser_map = serializer.serialize_map(Some(map.len()))?;
        for (key, value) in map {
            ser_map.serialize_entry(key, &serde_bytes::Bytes::new(value))?;
        }
        ser_map.end()
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<HashMap<String, Vec<u8>>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = HashMap::<String, serde_bytes::ByteBuf>::deserialize(deserializer)?;
        Ok(raw.into_iter().map(|(key, value)| (key, value.into_vec())).collect())
    }
}

/// Mirrors TypeScript `OoxmlPart`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OoxmlPart {
    pub name: String,
    pub content: String,
}

/// Mirrors TypeScript `OoxmlPackage`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OoxmlPackage {
    pub parts: HashMap<String, OoxmlPart>,
    #[serde(with = "byte_asset_map")]
    pub binary_assets: HashMap<String, Vec<u8>>,
}

pub fn get_part<'a>(pkg: &'a OoxmlPackage, part_name: &str) -> Option<&'a OoxmlPart> {
    pkg.parts.get(part_name)
}

pub fn with_part(pkg: &OoxmlPackage, part: OoxmlPart) -> OoxmlPackage {
    let mut parts = pkg.parts.clone();
    parts.insert(part.name.clone(), part);
    OoxmlPackage {
        parts,
        binary_assets: pkg.binary_assets.clone(),
    }
}
