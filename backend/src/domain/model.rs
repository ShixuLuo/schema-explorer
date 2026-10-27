use super::value::{Cell, DataType};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelState {
    pub version_id: String,
    pub schema: Schema,
    pub data: BTreeMap<String, Vec<Row>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Schema {
    pub tables: Vec<Table>,
    #[serde(default)]
    pub foreign_keys: Vec<ForeignKey>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ForeignKey {
    pub id: String,
    pub source_table: String,
    pub source_columns: Vec<String>,
    pub target_table: String,
    pub target_columns: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Table {
    pub id: String,
    pub name: String,
    pub columns: Vec<Column>,
    #[serde(default)]
    pub primary_key: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Column {
    pub id: String,
    pub name: String,
    pub data_type: DataType,
    pub nullable: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Row {
    pub id: String,
    pub cells: BTreeMap<String, Cell>,
}

impl ModelState {
    pub fn validate(&self) -> Result<(), String> {
        if self.version_id.is_empty() {
            return Err("version_id is required".into());
        }
        self.schema.validate()?;
        let table_ids: BTreeSet<_> = self.schema.tables.iter().map(|t| t.id.as_str()).collect();
        for table in &self.schema.tables {
            let rows = self
                .data
                .get(&table.id)
                .ok_or_else(|| format!("Missing data for table {}", table.id))?;
            let mut row_ids = BTreeSet::new();
            for row in rows {
                if row.id.is_empty() || !row_ids.insert(row.id.as_str()) {
                    return Err(format!("Invalid or duplicate row ID in {}", table.id));
                }
                if row.cells.len() != table.columns.len() {
                    return Err(format!("Row {} does not match its schema", row.id));
                }
                for col in &table.columns {
                    let cell = row
                        .cells
                        .get(&col.id)
                        .ok_or_else(|| format!("Row {} is missing {}", row.id, col.id))?;
                    let valid = cell.is_valid_for(col.data_type, col.nullable);
                    if !valid {
                        return Err(format!(
                            "Row {}, column {} has an invalid value",
                            row.id, col.id
                        ));
                    }
                }
            }
        }
        if self.data.keys().any(|id| !table_ids.contains(id.as_str())) {
            return Err("Data references a table absent from Schema".into());
        }
        Ok(())
    }
}

impl Schema {
    pub fn validate(&self) -> Result<(), String> {
        let schema = self;
        let mut table_ids = BTreeSet::new();
        let mut column_ids = BTreeSet::new();
        for table in &schema.tables {
            if table.id.is_empty() || !table_ids.insert(&table.id) {
                return Err("Table IDs must be nonempty and unique".into());
            }
            for column in &table.columns {
                if column.id.is_empty() || !column_ids.insert(&column.id) {
                    return Err("Column IDs must be nonempty and globally unique".into());
                }
            }
        }
        let mut ids = BTreeSet::new();
        for table in &schema.tables {
            let columns: BTreeSet<_> = table.columns.iter().map(|c| &c.id).collect();
            let key: BTreeSet<_> = table.primary_key.iter().collect();
            if key.len() != table.primary_key.len() || !key.is_subset(&columns) {
                return Err(format!("Invalid primary key in {}", table.name));
            }
            if table
                .columns
                .iter()
                .any(|c| table.primary_key.contains(&c.id) && c.nullable)
            {
                return Err("Primary-key fields must be non-nullable.".into());
            }
        }
        if schema.foreign_keys.len() > 32 {
            return Err("At most 32 foreign keys are supported.".into());
        }
        for fk in &schema.foreign_keys {
            if fk.id.is_empty() || fk.id.len() > 128 || !ids.insert(&fk.id) {
                return Err("Foreign key IDs must be unique and at most 128 bytes.".into());
            }
            let source = schema
                .tables
                .iter()
                .find(|t| t.id == fk.source_table)
                .ok_or("A foreign key source table is missing.")?;
            let target = schema
                .tables
                .iter()
                .find(|t| t.id == fk.target_table)
                .ok_or("A foreign key target table is missing.")?;
            if fk.source_columns.is_empty()
                || fk.source_columns.len() != fk.target_columns.len()
                || fk.target_columns != target.primary_key
                || target.primary_key.is_empty()
                || fk.source_columns.iter().collect::<BTreeSet<_>>().len()
                    != fk.source_columns.len()
            {
                return Err(format!(
                    "The foreign key to {} must reference its complete primary key, in order.",
                    target.name
                ));
            }
            for (s, t) in fk.source_columns.iter().zip(&fk.target_columns) {
                let sc = source
                    .columns
                    .iter()
                    .find(|c| c.id == *s)
                    .ok_or("A foreign key source field is missing.")?;
                let tc = target
                    .columns
                    .iter()
                    .find(|c| c.id == *t)
                    .ok_or("A foreign key target field is missing.")?;
                if sc.data_type != tc.data_type {
                    return Err("Foreign key field types must match.".into());
                }
            }
        }
        Ok(())
    }
}
