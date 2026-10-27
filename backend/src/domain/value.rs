use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DataType {
    Text,
    Integer,
}

// Integers cross JSON boundaries as decimal strings, avoiding JavaScript's
// numeric precision limit. The domain still validates the signed 64-bit range.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(
    tag = "type",
    content = "value",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum Cell {
    Null,
    Text(String),
    Integer(String),
}

pub fn strict_integer(s: &str) -> Result<i64, &'static str> {
    let digits = s
        .strip_prefix('+')
        .or_else(|| s.strip_prefix('-'))
        .unwrap_or(s);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return Err("Expected an ASCII decimal integer without whitespace");
    }
    s.parse()
        .map_err(|_| "Integer is outside the signed 64-bit range")
}

impl Cell {
    pub fn is_valid_for(&self, data_type: DataType, nullable: bool) -> bool {
        match self {
            Self::Null => nullable,
            Self::Text(_) => data_type == DataType::Text,
            Self::Integer(s) => {
                data_type == DataType::Integer
                    && strict_integer(s).is_ok_and(|n| n.to_string() == *s)
            }
        }
    }
    pub fn content_bytes(&self) -> usize {
        match self {
            Self::Null => 0,
            Self::Text(s) | Self::Integer(s) => s.len(),
        }
    }
}
