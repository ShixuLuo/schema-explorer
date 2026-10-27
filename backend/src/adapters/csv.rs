use crate::domain::{Cell, Column, DataType, ModelState, Row, Schema, Table};
use std::collections::{BTreeMap, BTreeSet};

pub struct CsvInput<'a> {
    pub table_name: &'a str,
    pub contents: &'a str,
}

/// Explicit adapter policy: UTF-8 CSV with headers; all imported cells are Text.
/// Empty strings stay empty; no trimming, NULL inference, keys or relationships.
pub fn import_csv(inputs: &[CsvInput<'_>], version_id: &str) -> Result<ModelState, String> {
    if inputs.is_empty() {
        return Err("At least one CSV input is required".into());
    }
    let mut tables = Vec::new();
    let mut data = BTreeMap::new();
    for (table_idx, input) in inputs.iter().enumerate() {
        let id = format!("table_{table_idx}");
        let mut reader = csv::ReaderBuilder::new().from_reader(input.contents.as_bytes());
        let headers = reader.headers().map_err(|e| e.to_string())?.clone();
        let mut seen = BTreeSet::new();
        if headers.is_empty() || headers.iter().any(|h| h.is_empty() || !seen.insert(h)) {
            return Err("CSV headers must be nonempty and unique; supply an explicit header mapping otherwise".into());
        }
        let columns: Vec<_> = headers
            .iter()
            .enumerate()
            .map(|(i, name)| Column {
                id: format!("column_{table_idx}_{i}"),
                name: name.into(),
                data_type: DataType::Text,
                nullable: false,
            })
            .collect();
        let mut rows = Vec::new();
        for (row_idx, record) in reader.records().enumerate() {
            let record = record.map_err(|e| e.to_string())?;
            let cells = columns
                .iter()
                .zip(record.iter())
                .map(|(col, value)| (col.id.clone(), Cell::Text(value.into())))
                .collect();
            rows.push(Row {
                id: format!("row_{table_idx}_{row_idx}"),
                cells,
            });
        }
        data.insert(id.clone(), rows);
        tables.push(Table {
            id,
            name: input.table_name.into(),
            columns,
            primary_key: vec![],
        });
    }
    let state = ModelState {
        version_id: version_id.into(),
        schema: Schema {
            tables,
            foreign_keys: vec![],
        },
        data,
    };
    state.validate()?;
    Ok(state)
}
