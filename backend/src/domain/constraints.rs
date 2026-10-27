use super::{Cell, ModelState, Schema};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Keys,
    References,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Batch {
    pub phase: Phase,
    pub table_id: String,
    pub start: usize,
    pub rows: Vec<BTreeMap<String, Cell>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ScanRequest {
    pub phase: Phase,
    pub table_id: String,
    pub column_ids: Vec<String>,
    pub row_count: usize,
}

// A validator owns its indexes and coverage. The adapters only feed bounded
// projections; uniqueness and reference semantics stay entirely in this module.
pub struct Checker {
    schema: Schema,
    counts: BTreeMap<String, usize>,
    keys: BTreeMap<String, BTreeSet<Vec<Cell>>>,
    coverage: BTreeMap<(u8, String), usize>,
    key_bytes: usize,
    references_started: bool,
}
impl Checker {
    pub fn new(schema: Schema, counts: BTreeMap<String, usize>) -> Result<Self, String> {
        schema.validate()?;
        if schema.tables.iter().any(|t| t.columns.len() > 100)
            || schema.tables.iter().map(|t| t.columns.len()).sum::<usize>() > 400
        {
            return Err("Too many fields in validation schema.".into());
        }
        if schema.tables.len() > 24
            || counts.len() != schema.tables.len()
            || schema
                .tables
                .iter()
                .any(|t| counts.get(&t.id).is_none_or(|n| *n > 50_000))
        {
            return Err("Invalid validation row counts.".into());
        }
        Ok(Self {
            keys: schema
                .tables
                .iter()
                .filter(|t| !t.primary_key.is_empty())
                .map(|t| (t.id.clone(), BTreeSet::new()))
                .collect(),
            schema,
            counts,
            coverage: BTreeMap::new(),
            key_bytes: 0,
            references_started: false,
        })
    }
    pub fn scans(&self) -> Vec<ScanRequest> {
        let mut result = vec![];
        for table in &self.schema.tables {
            if !table.primary_key.is_empty() {
                result.push(ScanRequest {
                    phase: Phase::Keys,
                    table_id: table.id.clone(),
                    column_ids: table.primary_key.clone(),
                    row_count: self.counts[&table.id],
                });
            }
        }
        for table in &self.schema.tables {
            let columns: BTreeSet<_> = self
                .schema
                .foreign_keys
                .iter()
                .filter(|fk| fk.source_table == table.id)
                .flat_map(|fk| fk.source_columns.iter().cloned())
                .collect();
            if !columns.is_empty() {
                result.push(ScanRequest {
                    phase: Phase::References,
                    table_id: table.id.clone(),
                    column_ids: columns.into_iter().collect(),
                    row_count: self.counts[&table.id],
                });
            }
        }
        result
    }
    fn tuple(
        &self,
        table_id: &str,
        columns: &[String],
        row: &BTreeMap<String, Cell>,
    ) -> Result<Vec<Cell>, String> {
        let table = self
            .schema
            .tables
            .iter()
            .find(|t| t.id == table_id)
            .ok_or("Unknown validation table.")?;
        columns
            .iter()
            .map(|id| {
                let value = row.get(id).ok_or("A validation field is missing.")?;
                let column = table
                    .columns
                    .iter()
                    .find(|c| c.id == *id)
                    .ok_or("Unknown validation field.")?;
                let valid = value.is_valid_for(
                    column.data_type,
                    column.nullable || table.primary_key.contains(id),
                ) && value.content_bytes() <= 8192;
                if !valid {
                    return Err(format!("Invalid value for {}.{}", table.name, column.name));
                }
                Ok(value.clone())
            })
            .collect()
    }
    fn keys_complete(&self) -> bool {
        self.schema
            .tables
            .iter()
            .filter(|t| !t.primary_key.is_empty())
            .all(|t| {
                self.coverage.get(&(0, t.id.clone())).copied().unwrap_or(0) == self.counts[&t.id]
            })
    }
    pub fn push(&mut self, batch: Batch) -> Result<(), String> {
        if batch.rows.len() > 200 {
            return Err("Validate at most 200 rows per batch.".into());
        }
        let phase = if batch.phase == Phase::Keys { 0 } else { 1 };
        let table = self
            .schema
            .tables
            .iter()
            .find(|t| t.id == batch.table_id)
            .ok_or("Unknown validation table.")?
            .clone();
        let covered = self
            .coverage
            .get(&(phase, table.id.clone()))
            .copied()
            .unwrap_or(0);
        if covered != batch.start || covered + batch.rows.len() > self.counts[&table.id] {
            return Err("Validation batches are missing, repeated, or out of order.".into());
        }
        match batch.phase {
            Phase::Keys => {
                if self.references_started || table.primary_key.is_empty() {
                    return Err("Unexpected primary-key validation batch.".into());
                }
                for (i, row) in batch.rows.iter().enumerate() {
                    let tuple = self.tuple(&table.id, &table.primary_key, row)?;
                    if tuple.contains(&Cell::Null) {
                        return Err(format!(
                            "{}: primary key contains NULL at row {}.",
                            table.name,
                            batch.start + i + 1
                        ));
                    }
                    self.key_bytes += tuple
                        .iter()
                        .map(|c| match c {
                            Cell::Null => 0,
                            Cell::Text(s) | Cell::Integer(s) => s.len(),
                        })
                        .sum::<usize>();
                    if self.key_bytes > 40 * 1024 * 1024 {
                        return Err("Primary-key indexes exceed 40 MiB.".into());
                    }
                    if !self.keys.get_mut(&table.id).unwrap().insert(tuple) {
                        return Err(format!(
                            "{}: duplicate primary key at row {}.",
                            table.name,
                            batch.start + i + 1
                        ));
                    }
                }
            }
            Phase::References => {
                if !self.keys_complete() {
                    return Err("Validate all target keys before references.".into());
                }
                self.references_started = true;
                let foreign_keys: Vec<_> = self
                    .schema
                    .foreign_keys
                    .iter()
                    .filter(|fk| fk.source_table == table.id)
                    .collect();
                if foreign_keys.is_empty() {
                    return Err("Unexpected foreign-key validation batch.".into());
                }
                for (i, row) in batch.rows.iter().enumerate() {
                    for fk in &foreign_keys {
                        let tuple = self.tuple(&table.id, &fk.source_columns, row)?;
                        // SQL MATCH SIMPLE: any NULL in the source tuple exempts
                        // that tuple. Empty text is a real value, never NULL.
                        if tuple.contains(&Cell::Null) {
                            continue;
                        }
                        if !self.keys[&fk.target_table].contains(&tuple) {
                            let target = self
                                .schema
                                .tables
                                .iter()
                                .find(|t| t.id == fk.target_table)
                                .unwrap();
                            let fields = |t: &super::model::Table, ids: &[String]| {
                                ids.iter()
                                    .map(|id| {
                                        t.columns
                                            .iter()
                                            .find(|c| c.id == *id)
                                            .unwrap()
                                            .name
                                            .as_str()
                                    })
                                    .collect::<Vec<_>>()
                                    .join(", ")
                            };
                            return Err(format!(
                                "{}.{} has no match in {}.{} at row {}.",
                                table.name,
                                fields(&table, &fk.source_columns),
                                target.name,
                                fields(target, &fk.target_columns),
                                batch.start + i + 1
                            ));
                        }
                    }
                }
            }
        }
        self.coverage
            .insert((phase, table.id), covered + batch.rows.len());
        Ok(())
    }
    pub fn finish(&self) -> Result<(), String> {
        if !self.keys_complete() {
            return Err("Primary-key validation is incomplete.".into());
        }
        for fk in &self.schema.foreign_keys {
            if self
                .coverage
                .get(&(1, fk.source_table.clone()))
                .copied()
                .unwrap_or(0)
                != self.counts[&fk.source_table]
            {
                return Err("Foreign-key validation is incomplete.".into());
            }
        }
        Ok(())
    }
}

pub fn validate(state: &ModelState) -> Result<(), String> {
    let mut checker = Checker::new(
        state.schema.clone(),
        state
            .data
            .iter()
            .map(|(id, rows)| (id.clone(), rows.len()))
            .collect(),
    )?;
    for scan in checker.scans() {
        for (i, rows) in state.data[&scan.table_id].chunks(200).enumerate() {
            checker.push(Batch {
                phase: scan.phase,
                table_id: scan.table_id.clone(),
                start: i * 200,
                rows: rows.iter().map(|r| r.cells.clone()).collect(),
            })?;
        }
    }
    checker.finish()
}
