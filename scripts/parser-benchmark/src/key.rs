use std::fmt::{self, Display};

use serde::ser::{Impossible, Serializer};
use serde::Serialize;

type Error = serde_json::Error;

pub fn to_key<T: ?Sized + Serialize>(value: &T) -> Result<String, Error> {
    value.serialize(KeySerializer)
}

fn invalid<T>() -> Result<T, Error> {
    Err(<Error as serde::ser::Error>::custom("key must be a string"))
}

struct KeySerializer;

impl Serializer for KeySerializer {
    type Ok = String;
    type Error = Error;
    type SerializeSeq = Impossible<String, Error>;
    type SerializeTuple = Impossible<String, Error>;
    type SerializeTupleStruct = Impossible<String, Error>;
    type SerializeTupleVariant = Impossible<String, Error>;
    type SerializeMap = Impossible<String, Error>;
    type SerializeStruct = Impossible<String, Error>;
    type SerializeStructVariant = Impossible<String, Error>;

    fn serialize_bool(self, value: bool) -> Result<String, Error> {
        Ok(value.to_string())
    }
    fn serialize_i8(self, value: i8) -> Result<String, Error> {
        Ok(value.to_string())
    }
    fn serialize_i16(self, value: i16) -> Result<String, Error> {
        Ok(value.to_string())
    }
    fn serialize_i32(self, value: i32) -> Result<String, Error> {
        Ok(value.to_string())
    }
    fn serialize_i64(self, value: i64) -> Result<String, Error> {
        Ok(value.to_string())
    }
    fn serialize_i128(self, value: i128) -> Result<String, Error> {
        Ok(value.to_string())
    }
    fn serialize_u8(self, value: u8) -> Result<String, Error> {
        Ok(value.to_string())
    }
    fn serialize_u16(self, value: u16) -> Result<String, Error> {
        Ok(value.to_string())
    }
    fn serialize_u32(self, value: u32) -> Result<String, Error> {
        Ok(value.to_string())
    }
    fn serialize_u64(self, value: u64) -> Result<String, Error> {
        Ok(value.to_string())
    }
    fn serialize_u128(self, value: u128) -> Result<String, Error> {
        Ok(value.to_string())
    }

    fn serialize_f32(self, value: f32) -> Result<String, Error> {
        if !value.is_finite() {
            return Err(<Error as serde::ser::Error>::custom(
                "float key must be finite (got NaN or +/-inf)",
            ));
        }
        serde_json::to_string(&value)
    }

    fn serialize_f64(self, value: f64) -> Result<String, Error> {
        if !value.is_finite() {
            return Err(<Error as serde::ser::Error>::custom(
                "float key must be finite (got NaN or +/-inf)",
            ));
        }
        serde_json::to_string(&value)
    }

    fn serialize_char(self, value: char) -> Result<String, Error> {
        Ok(value.to_string())
    }
    fn serialize_str(self, value: &str) -> Result<String, Error> {
        Ok(value.to_owned())
    }
    fn serialize_bytes(self, _value: &[u8]) -> Result<String, Error> {
        invalid()
    }
    fn serialize_none(self) -> Result<String, Error> {
        invalid()
    }

    fn serialize_some<T: ?Sized + Serialize>(self, value: &T) -> Result<String, Error> {
        value.serialize(self)
    }

    fn serialize_unit(self) -> Result<String, Error> {
        invalid()
    }
    fn serialize_unit_struct(self, _name: &'static str) -> Result<String, Error> {
        invalid()
    }

    fn serialize_unit_variant(
        self,
        _name: &'static str,
        _variant_index: u32,
        variant: &'static str,
    ) -> Result<String, Error> {
        Ok(variant.to_owned())
    }

    fn serialize_newtype_struct<T: ?Sized + Serialize>(
        self,
        _name: &'static str,
        value: &T,
    ) -> Result<String, Error> {
        value.serialize(self)
    }

    fn serialize_newtype_variant<T: ?Sized + Serialize>(
        self,
        _name: &'static str,
        _variant_index: u32,
        _variant: &'static str,
        _value: &T,
    ) -> Result<String, Error> {
        invalid()
    }

    fn serialize_seq(self, _len: Option<usize>) -> Result<Self::SerializeSeq, Error> {
        invalid()
    }
    fn serialize_tuple(self, _len: usize) -> Result<Self::SerializeTuple, Error> {
        invalid()
    }

    fn serialize_tuple_struct(
        self,
        _name: &'static str,
        _len: usize,
    ) -> Result<Self::SerializeTupleStruct, Error> {
        invalid()
    }

    fn serialize_tuple_variant(
        self,
        _name: &'static str,
        _variant_index: u32,
        _variant: &'static str,
        _len: usize,
    ) -> Result<Self::SerializeTupleVariant, Error> {
        invalid()
    }

    fn serialize_map(self, _len: Option<usize>) -> Result<Self::SerializeMap, Error> {
        invalid()
    }

    fn serialize_struct(
        self,
        _name: &'static str,
        _len: usize,
    ) -> Result<Self::SerializeStruct, Error> {
        invalid()
    }

    fn serialize_struct_variant(
        self,
        _name: &'static str,
        _variant_index: u32,
        _variant: &'static str,
        _len: usize,
    ) -> Result<Self::SerializeStructVariant, Error> {
        invalid()
    }

    fn collect_str<T: ?Sized + Display>(self, value: &T) -> Result<String, Error> {
        let mut result = String::new();
        fmt::write(&mut result, format_args!("{value}"))
            .map_err(<Error as serde::ser::Error>::custom)?;
        Ok(result)
    }

    fn is_human_readable(&self) -> bool {
        true
    }
}
