use crate::domain::{Cell, DataType, ModelState, strict_integer};
use serde::Serialize;
use std::collections::BTreeSet;

#[derive(Clone, Debug, Serialize)]
pub struct IntegerEvidence {
    pub checked_non_null: usize,
    pub failures: usize,
    pub presentation_changes: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct ColumnProfile {
    pub table_id: String,
    pub column_id: String,
    pub row_count: usize,
    pub null_count: usize,
    pub distinct_non_null: usize,
    pub integer_evidence: Option<IntegerEvidence>,
}

impl ColumnProfile {
    pub fn can_cast_to_integer(&self) -> bool {
        self.integer_evidence
            .as_ref()
            .is_some_and(|e| e.checked_non_null > 0 && e.failures == 0)
    }
}

/// Evidence covers the complete supplied snapshot, not a sample. A successful
/// parse does not establish business meaning (identifiers can be numeric text).
pub fn profile(state: &ModelState) -> Result<Vec<ColumnProfile>, String> {
    state.validate()?;
    let mut result = Vec::new();
    for table in &state.schema.tables {
        let rows = &state.data[&table.id];
        for column in &table.columns {
            let mut distinct = BTreeSet::new();
            let mut null_count = 0;
            let mut integer_evidence =
                (column.data_type == DataType::Text).then_some(IntegerEvidence {
                    checked_non_null: 0,
                    failures: 0,
                    presentation_changes: 0,
                });
            for row in rows {
                let value = &row.cells[&column.id];
                if matches!(value, Cell::Null) {
                    null_count += 1;
                    continue;
                }
                distinct.insert(value);
                if let (Some(e), Cell::Text(text)) = (&mut integer_evidence, value) {
                    e.checked_non_null += 1;
                    match strict_integer(text) {
                        Ok(n) if n.to_string() != *text => e.presentation_changes += 1,
                        Ok(_) => {}
                        Err(_) => e.failures += 1,
                    }
                }
            }
            result.push(ColumnProfile {
                table_id: table.id.clone(),
                column_id: column.id.clone(),
                row_count: rows.len(),
                null_count,
                distinct_non_null: distinct.len(),
                integer_evidence,
            });
        }
    }
    Ok(result)
}
