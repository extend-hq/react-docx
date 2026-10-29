use std::{collections::BTreeMap, fmt, fs::File, io::BufReader};

use flate2::read::GzDecoder;
use serde::de::{DeserializeSeed, MapAccess, SeqAccess, Visitor};
use sha2::{Digest, Sha256};

#[derive(Clone, Copy)]
enum Path {
    Root,
    Metadata,
    Unordered,
    Other,
}

struct Seed<'a> {
    path: Path,
    counts: &'a mut BTreeMap<&'static str, u64>,
}

fn scalar(kind: &[u8], bytes: &[u8]) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(kind);
    hash.update(bytes);
    hash.finalize().into()
}

impl<'de> DeserializeSeed<'de> for Seed<'_> {
    type Value = [u8; 32];
    fn deserialize<D: serde::Deserializer<'de>>(
        self,
        deserializer: D,
    ) -> Result<Self::Value, D::Error> {
        deserializer.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for Seed<'_> {
    type Value = [u8; 32];
    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a JSON value")
    }
    fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
        *self.counts.entry("null").or_default() += 1;
        Ok(scalar(b"null", &[]))
    }
    fn visit_bool<E: serde::de::Error>(self, value: bool) -> Result<Self::Value, E> {
        *self.counts.entry("boolean").or_default() += 1;
        Ok(scalar(b"bool", &[u8::from(value)]))
    }
    fn visit_i64<E: serde::de::Error>(self, value: i64) -> Result<Self::Value, E> {
        *self.counts.entry("number").or_default() += 1;
        Ok(scalar(b"integer", value.to_string().as_bytes()))
    }
    fn visit_u64<E: serde::de::Error>(self, value: u64) -> Result<Self::Value, E> {
        *self.counts.entry("number").or_default() += 1;
        Ok(scalar(b"integer", value.to_string().as_bytes()))
    }
    fn visit_f64<E: serde::de::Error>(self, value: f64) -> Result<Self::Value, E> {
        *self.counts.entry("number").or_default() += 1;
        Ok(scalar(b"float", &value.to_bits().to_le_bytes()))
    }
    fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Self::Value, E> {
        *self.counts.entry("string").or_default() += 1;
        Ok(scalar(b"string", value.as_bytes()))
    }
    fn visit_string<E: serde::de::Error>(self, value: String) -> Result<Self::Value, E> {
        self.visit_str(&value)
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut values: A) -> Result<Self::Value, A::Error> {
        *self.counts.entry("start_array").or_default() += 1;
        let mut hash = Sha256::new();
        hash.update(b"array");
        let unordered = matches!(self.path, Path::Unordered);
        let mut items = Vec::new();
        while let Some(value) = values.next_element_seed(Seed {
            path: Path::Other,
            counts: self.counts,
        })? {
            if unordered {
                items.push(value);
            } else {
                hash.update(value);
            }
        }
        if unordered {
            items.sort_unstable();
            for item in items {
                hash.update(item);
            }
        }
        *self.counts.entry("end_array").or_default() += 1;
        Ok(hash.finalize().into())
    }
    fn visit_map<A: MapAccess<'de>>(self, mut values: A) -> Result<Self::Value, A::Error> {
        *self.counts.entry("start_map").or_default() += 1;
        let mut items = Vec::new();
        while let Some(key) = values.next_key::<String>()? {
            *self.counts.entry("map_key").or_default() += 1;
            let path = match (self.path, key.as_str()) {
                (Path::Root, "metadata") => Path::Metadata,
                (Path::Metadata, "paragraphStyles" | "tableStyles") => Path::Unordered,
                _ => Path::Other,
            };
            let value = values.next_value_seed(Seed {
                path,
                counts: self.counts,
            })?;
            items.push((key, value));
        }
        items.sort_unstable();
        let mut hash = Sha256::new();
        hash.update(b"map");
        for (key, value) in items {
            hash.update((key.len() as u64).to_le_bytes());
            hash.update(key.as_bytes());
            hash.update(value);
        }
        *self.counts.entry("end_map").or_default() += 1;
        Ok(hash.finalize().into())
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let input = BufReader::new(GzDecoder::new(BufReader::new(File::open(
        std::env::args().nth(1).ok_or("missing input")?,
    )?)));
    let mut decoder = serde_json::Deserializer::from_reader(input);
    let mut counts = BTreeMap::new();
    let digest = Seed {
        path: Path::Root,
        counts: &mut counts,
    }
    .deserialize(&mut decoder)?;
    decoder.end()?;
    let sha256 = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    println!(
        "{}",
        serde_json::json!({"sha256": sha256, "events": counts, "algorithm": "native-merkle-v1"})
    );
    Ok(())
}
