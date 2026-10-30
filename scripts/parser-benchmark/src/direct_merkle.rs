use std::{collections::BTreeMap, fmt, sync::OnceLock};

use serde::{
    de::{self, Visitor},
    ser::{self, Serialize, Serializer as _},
};
use sha2::{Digest, Sha256};

#[path = "key.rs"]
mod key;

type Hash = [u8; 32];
type Result<T> = std::result::Result<T, serde_json::Error>;

#[derive(Clone, Copy)]
enum Path {
    Root,
    Metadata,
    Unordered,
    Other,
}

impl Path {
    fn child(self, key: &str) -> Self {
        match (self, key) {
            (Self::Root, "metadata") => Self::Metadata,
            (Self::Metadata, "paragraphStyles" | "tableStyles") => Self::Unordered,
            _ => Self::Other,
        }
    }
}

#[derive(Default)]
struct Counts {
    depth: usize,
    null: u64,
    boolean: u64,
    number: u64,
    string: u64,
    start_array: u64,
    end_array: u64,
    start_map: u64,
    end_map: u64,
    map_key: u64,
}

impl Counts {
    fn enter(&mut self) -> Result<()> {
        self.depth += 1;
        if self.depth >= 128 {
            return Err(ser::Error::custom("recursion limit exceeded"));
        }
        Ok(())
    }
    fn into_map(self) -> BTreeMap<&'static str, u64> {
        [
            ("null", self.null),
            ("boolean", self.boolean),
            ("number", self.number),
            ("string", self.string),
            ("start_array", self.start_array),
            ("end_array", self.end_array),
            ("start_map", self.start_map),
            ("end_map", self.end_map),
            ("map_key", self.map_key),
        ]
        .into_iter()
        .filter(|(_, count)| *count != 0)
        .collect()
    }
}

fn scalar(kind: &[u8], bytes: &[u8]) -> Hash {
    let mut hash = Sha256::new();
    hash.update(kind);
    hash.update(bytes);
    hash.finalize().into()
}

fn byte_hashes() -> &'static [Hash; 256] {
    static HASHES: OnceLock<[Hash; 256]> = OnceLock::new();
    HASHES
        .get_or_init(|| std::array::from_fn(|byte| scalar(b"integer", byte.to_string().as_bytes())))
}

struct Encoder<'a> {
    path: Path,
    counts: &'a mut Counts,
}

enum Number {
    Null,
    Signed(i64),
    Unsigned(u64),
    Float(f64),
}

impl<'de> de::Deserialize<'de> for Number {
    fn deserialize<D: de::Deserializer<'de>>(decoder: D) -> std::result::Result<Self, D::Error> {
        struct NumberVisitor;
        impl Visitor<'_> for NumberVisitor {
            type Value = Number;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a number or null")
            }
            fn visit_unit<E: de::Error>(self) -> std::result::Result<Number, E> {
                Ok(Number::Null)
            }
            fn visit_i64<E: de::Error>(self, value: i64) -> std::result::Result<Number, E> {
                Ok(Number::Signed(value))
            }
            fn visit_u64<E: de::Error>(self, value: u64) -> std::result::Result<Number, E> {
                Ok(Number::Unsigned(value))
            }
            fn visit_f64<E: de::Error>(self, value: f64) -> std::result::Result<Number, E> {
                Ok(Number::Float(value))
            }
        }
        decoder.deserialize_any(NumberVisitor)
    }
}

impl Encoder<'_> {
    fn signed(self, value: i64) -> Result<Hash> {
        if value >= 0 {
            return self.unsigned(value as u64);
        }
        self.counts.number += 1;
        Ok(scalar(b"integer", value.to_string().as_bytes()))
    }
    fn unsigned(self, value: u64) -> Result<Hash> {
        self.counts.number += 1;
        Ok(if value < 256 {
            byte_hashes()[value as usize]
        } else {
            scalar(b"integer", value.to_string().as_bytes())
        })
    }
    fn number<T: Serialize>(self, value: T) -> Result<Hash> {
        match serde_json::from_str::<Number>(&serde_json::to_string(&value)?)? {
            Number::Null => self.serialize_unit(),
            Number::Signed(value) => self.signed(value),
            Number::Unsigned(value) => self.unsigned(value),
            Number::Float(value) => {
                self.counts.number += 1;
                Ok(scalar(b"float", &value.to_bits().to_le_bytes()))
            }
        }
    }
}

struct Sequence<'a> {
    counts: &'a mut Counts,
    hash: Sha256,
    unordered: bool,
    values: Vec<Hash>,
}

impl<'a> Sequence<'a> {
    fn new(encoder: Encoder<'a>) -> Result<Self> {
        encoder.counts.enter()?;
        encoder.counts.start_array += 1;
        let mut hash = Sha256::new();
        hash.update(b"array");
        Ok(Self {
            counts: encoder.counts,
            hash,
            unordered: matches!(encoder.path, Path::Unordered),
            values: Vec::new(),
        })
    }
    fn push<T: ?Sized + Serialize>(&mut self, value: &T) -> Result<()> {
        let hash = value.serialize(Encoder {
            path: Path::Other,
            counts: self.counts,
        })?;
        if self.unordered {
            self.values.push(hash);
        } else {
            self.hash.update(hash);
        }
        Ok(())
    }
    fn finish(mut self) -> Result<Hash> {
        if self.unordered {
            self.values.sort_unstable();
            for value in self.values {
                self.hash.update(value);
            }
        }
        self.counts.depth -= 1;
        self.counts.end_array += 1;
        Ok(self.hash.finalize().into())
    }
}

struct Object<'a> {
    path: Path,
    counts: &'a mut Counts,
    values: Vec<(String, Hash)>,
    key: Option<String>,
}

fn object_hash(mut values: Vec<(String, Hash)>) -> Hash {
    values.sort_unstable();
    let mut hash = Sha256::new();
    hash.update(b"map");
    for (key, value) in values {
        hash.update((key.len() as u64).to_le_bytes());
        hash.update(key.as_bytes());
        hash.update(value);
    }
    hash.finalize().into()
}

impl<'a> Object<'a> {
    fn new(encoder: Encoder<'a>, len: Option<usize>) -> Result<Self> {
        encoder.counts.enter()?;
        encoder.counts.start_map += 1;
        Ok(Self {
            path: encoder.path,
            counts: encoder.counts,
            values: Vec::with_capacity(len.unwrap_or(0)),
            key: None,
        })
    }
    fn field<T: ?Sized + Serialize>(&mut self, key: String, value: &T) -> Result<()> {
        self.counts.map_key += 1;
        let hash = value.serialize(Encoder {
            path: self.path.child(&key),
            counts: self.counts,
        })?;
        self.values.push((key, hash));
        Ok(())
    }
    fn finish(self) -> Result<Hash> {
        if self.key.is_some() {
            return Err(ser::Error::custom("map key has no value"));
        }
        self.counts.depth -= 1;
        self.counts.end_map += 1;
        Ok(object_hash(self.values))
    }
}

struct TupleVariant<'a> {
    variant: &'static str,
    inner: Sequence<'a>,
}
struct StructVariant<'a> {
    variant: &'static str,
    inner: Object<'a>,
}

impl<'a> ser::Serializer for Encoder<'a> {
    type Ok = Hash;
    type Error = serde_json::Error;
    type SerializeSeq = Sequence<'a>;
    type SerializeTuple = Sequence<'a>;
    type SerializeTupleStruct = Sequence<'a>;
    type SerializeTupleVariant = TupleVariant<'a>;
    type SerializeMap = Object<'a>;
    type SerializeStruct = Object<'a>;
    type SerializeStructVariant = StructVariant<'a>;

    fn serialize_bool(self, value: bool) -> Result<Hash> {
        self.counts.boolean += 1;
        Ok(scalar(b"bool", &[u8::from(value)]))
    }
    fn serialize_i8(self, value: i8) -> Result<Hash> {
        self.signed(value.into())
    }
    fn serialize_i16(self, value: i16) -> Result<Hash> {
        self.signed(value.into())
    }
    fn serialize_i32(self, value: i32) -> Result<Hash> {
        self.signed(value.into())
    }
    fn serialize_i64(self, value: i64) -> Result<Hash> {
        self.signed(value)
    }
    fn serialize_i128(self, value: i128) -> Result<Hash> {
        self.number(value)
    }
    fn serialize_u8(self, value: u8) -> Result<Hash> {
        self.unsigned(value.into())
    }
    fn serialize_u16(self, value: u16) -> Result<Hash> {
        self.unsigned(value.into())
    }
    fn serialize_u32(self, value: u32) -> Result<Hash> {
        self.unsigned(value.into())
    }
    fn serialize_u64(self, value: u64) -> Result<Hash> {
        self.unsigned(value)
    }
    fn serialize_u128(self, value: u128) -> Result<Hash> {
        self.number(value)
    }
    fn serialize_f32(self, value: f32) -> Result<Hash> {
        self.number(value)
    }
    fn serialize_f64(self, value: f64) -> Result<Hash> {
        self.number(value)
    }
    fn serialize_char(self, value: char) -> Result<Hash> {
        self.serialize_str(value.encode_utf8(&mut [0; 4]))
    }
    fn serialize_str(self, value: &str) -> Result<Hash> {
        self.counts.string += 1;
        Ok(scalar(b"string", value.as_bytes()))
    }
    fn serialize_bytes(self, value: &[u8]) -> Result<Hash> {
        let mut sequence = Sequence::new(self)?;
        sequence.counts.number += value.len() as u64;
        if sequence.unordered {
            let mut frequency = [0usize; 256];
            for byte in value {
                frequency[*byte as usize] += 1;
            }
            let mut order: Vec<_> = frequency
                .into_iter()
                .enumerate()
                .filter(|(_, n)| *n != 0)
                .collect();
            order.sort_unstable_by_key(|(byte, _)| byte_hashes()[*byte]);
            for (byte, count) in order {
                for _ in 0..count {
                    sequence.hash.update(byte_hashes()[byte]);
                }
            }
        } else {
            for byte in value {
                sequence.hash.update(byte_hashes()[*byte as usize]);
            }
        }
        sequence.finish()
    }
    fn serialize_none(self) -> Result<Hash> {
        self.serialize_unit()
    }
    fn serialize_some<T: ?Sized + Serialize>(self, value: &T) -> Result<Hash> {
        value.serialize(self)
    }
    fn serialize_unit(self) -> Result<Hash> {
        self.counts.null += 1;
        Ok(scalar(b"null", &[]))
    }
    fn serialize_unit_struct(self, _: &'static str) -> Result<Hash> {
        self.serialize_unit()
    }
    fn serialize_unit_variant(
        self,
        _: &'static str,
        _: u32,
        variant: &'static str,
    ) -> Result<Hash> {
        self.serialize_str(variant)
    }
    fn serialize_newtype_struct<T: ?Sized + Serialize>(
        self,
        _: &'static str,
        value: &T,
    ) -> Result<Hash> {
        value.serialize(self)
    }
    fn serialize_newtype_variant<T: ?Sized + Serialize>(
        self,
        _: &'static str,
        _: u32,
        variant: &'static str,
        value: &T,
    ) -> Result<Hash> {
        let mut object = Object::new(self, Some(1))?;
        object.field(variant.into(), value)?;
        object.finish()
    }
    fn serialize_seq(self, _: Option<usize>) -> Result<Sequence<'a>> {
        Sequence::new(self)
    }
    fn serialize_tuple(self, _: usize) -> Result<Sequence<'a>> {
        Sequence::new(self)
    }
    fn serialize_tuple_struct(self, _: &'static str, _: usize) -> Result<Sequence<'a>> {
        Sequence::new(self)
    }
    fn serialize_tuple_variant(
        self,
        _: &'static str,
        _: u32,
        variant: &'static str,
        _: usize,
    ) -> Result<TupleVariant<'a>> {
        self.counts.enter()?;
        self.counts.start_map += 1;
        self.counts.map_key += 1;
        let inner = Sequence::new(Encoder {
            path: self.path.child(variant),
            counts: self.counts,
        })?;
        Ok(TupleVariant { variant, inner })
    }
    fn serialize_map(self, len: Option<usize>) -> Result<Object<'a>> {
        Object::new(self, len)
    }
    fn serialize_struct(self, _: &'static str, len: usize) -> Result<Object<'a>> {
        self.serialize_map(Some(len))
    }
    fn serialize_struct_variant(
        self,
        _: &'static str,
        _: u32,
        variant: &'static str,
        len: usize,
    ) -> Result<StructVariant<'a>> {
        self.counts.enter()?;
        self.counts.start_map += 1;
        self.counts.map_key += 1;
        let inner = Object::new(
            Encoder {
                path: self.path.child(variant),
                counts: self.counts,
            },
            Some(len),
        )?;
        Ok(StructVariant { variant, inner })
    }
    fn collect_str<T: ?Sized + fmt::Display>(self, value: &T) -> Result<Hash> {
        let mut text = String::new();
        fmt::write(&mut text, format_args!("{value}")).map_err(ser::Error::custom)?;
        self.serialize_str(&text)
    }
}

impl ser::SerializeSeq for Sequence<'_> {
    type Ok = Hash;
    type Error = serde_json::Error;
    fn serialize_element<T: ?Sized + Serialize>(&mut self, value: &T) -> Result<()> {
        self.push(value)
    }
    fn end(self) -> Result<Hash> {
        self.finish()
    }
}
impl ser::SerializeTuple for Sequence<'_> {
    type Ok = Hash;
    type Error = serde_json::Error;
    fn serialize_element<T: ?Sized + Serialize>(&mut self, value: &T) -> Result<()> {
        self.push(value)
    }
    fn end(self) -> Result<Hash> {
        self.finish()
    }
}
impl ser::SerializeTupleStruct for Sequence<'_> {
    type Ok = Hash;
    type Error = serde_json::Error;
    fn serialize_field<T: ?Sized + Serialize>(&mut self, value: &T) -> Result<()> {
        self.push(value)
    }
    fn end(self) -> Result<Hash> {
        self.finish()
    }
}
impl ser::SerializeTupleVariant for TupleVariant<'_> {
    type Ok = Hash;
    type Error = serde_json::Error;
    fn serialize_field<T: ?Sized + Serialize>(&mut self, value: &T) -> Result<()> {
        self.inner.push(value)
    }
    fn end(self) -> Result<Hash> {
        self.inner.counts.depth -= 1;
        self.inner.counts.end_map += 1;
        Ok(object_hash(vec![(
            self.variant.into(),
            self.inner.finish()?,
        )]))
    }
}
impl ser::SerializeMap for Object<'_> {
    type Ok = Hash;
    type Error = serde_json::Error;
    fn serialize_key<T: ?Sized + Serialize>(&mut self, value: &T) -> Result<()> {
        if self.key.is_some() {
            return Err(ser::Error::custom("map key has no value"));
        }
        self.key = Some(key::to_key(value)?);
        Ok(())
    }
    fn serialize_value<T: ?Sized + Serialize>(&mut self, value: &T) -> Result<()> {
        let key = self
            .key
            .take()
            .ok_or_else(|| <serde_json::Error as ser::Error>::custom("map value has no key"))?;
        self.field(key, value)
    }
    fn end(self) -> Result<Hash> {
        self.finish()
    }
}
impl ser::SerializeStruct for Object<'_> {
    type Ok = Hash;
    type Error = serde_json::Error;
    fn serialize_field<T: ?Sized + Serialize>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<()> {
        self.field(key.into(), value)
    }
    fn end(self) -> Result<Hash> {
        self.finish()
    }
}
impl ser::SerializeStructVariant for StructVariant<'_> {
    type Ok = Hash;
    type Error = serde_json::Error;
    fn serialize_field<T: ?Sized + Serialize>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<()> {
        self.inner.field(key.into(), value)
    }
    fn end(self) -> Result<Hash> {
        self.inner.counts.depth -= 1;
        self.inner.counts.end_map += 1;
        Ok(object_hash(vec![(
            self.variant.into(),
            self.inner.finish()?,
        )]))
    }
}

pub fn digest<T: ?Sized + Serialize>(value: &T) -> Result<serde_json::Value> {
    let mut counts = Counts::default();
    let hash = value.serialize(Encoder {
        path: Path::Root,
        counts: &mut counts,
    })?;
    let sha256 = hash
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(
        serde_json::json!({"sha256":sha256,"events":counts.into_map(),"algorithm":"native-merkle-v1"}),
    )
}
