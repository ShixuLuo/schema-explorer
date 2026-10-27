use super::{Cell, Column, DataType, ForeignKey, ModelState, Table, strict_integer};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum Operation {
    CreateTable {
        table: Table,
    },
    AddPrimaryKey {
        table_id: String,
        column_ids: Vec<String>,
    },
    DropPrimaryKey {
        table_id: String,
    },
    AddForeignKey {
        table_id: String,
        foreign_key: ForeignKey,
    },
    DropForeignKey {
        table_id: String,
        foreign_key_id: String,
    },
    DropTable {
        table_id: String,
    },
    RenameTable {
        table_id: String,
        new_name: String,
    },
    RenameColumn {
        table_id: String,
        column_id: String,
        new_name: String,
    },
    AddColumn {
        table_id: String,
        column: Column,
        value: Cell,
    },
    DropColumn {
        table_id: String,
        column_id: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PlanError {
    pub code: String,
    pub step_index: Option<usize>,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StepReport {
    pub step_index: usize,
    pub op: String,
    pub table_id: String,
    pub column_id: Option<String>,
    pub description: String,
    pub rows_checked: usize,
    pub cells_added: usize,
    pub cells_removed: usize,
    pub rows_removed: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Preview {
    pub base_version_id: String,
    pub candidate: ModelState,
    pub reports: Vec<StepReport>,
}

#[derive(Clone, Debug, Serialize)]
pub struct OperationDefinition {
    pub op: &'static str,
    pub parameters: &'static [&'static str],
    pub description: &'static str,
}

/// Internal operation catalog. UI and future tool adapters use the same enum
/// and evaluator; only implemented primitives are listed here.
pub fn definitions() -> Vec<OperationDefinition> {
    vec![
        OperationDefinition {
            op: "create_table",
            parameters: &["table"],
            description: "Create an empty table with explicit fields and types.",
        },
        OperationDefinition {
            op: "add_primary_key",
            parameters: &["table_id", "column_ids"],
            description: "Declare a primary key after full uniqueness and NULL validation.",
        },
        OperationDefinition {
            op: "drop_primary_key",
            parameters: &["table_id"],
            description: "Remove a primary key when no foreign key depends on it.",
        },
        OperationDefinition {
            op: "add_foreign_key",
            parameters: &["table_id", "foreign_key"],
            description: "Declare a foreign key referencing a complete primary key; full data validation is required.",
        },
        OperationDefinition {
            op: "drop_foreign_key",
            parameters: &["table_id", "foreign_key_id"],
            description: "Remove a foreign key without deleting records.",
        },
        OperationDefinition {
            op: "drop_table",
            parameters: &["table_id"],
            description: "Remove a table and its records. The caller must explicitly handle diagram dependencies and preserve an Undo state.",
        },
        OperationDefinition {
            op: "rename_table",
            parameters: &["table_id", "new_name"],
            description: "Rename a table without changing IDs or values; names must be unique.",
        },
        OperationDefinition {
            op: "rename_column",
            parameters: &["table_id", "column_id", "new_name"],
            description: "Rename a column without changing its ID or values.",
        },
        OperationDefinition {
            op: "add_column",
            parameters: &["table_id", "column", "value"],
            description: "Add a text or signed-integer column using an explicit constant or nullable NULL. Row functions are not implemented.",
        },
        OperationDefinition {
            op: "drop_column",
            parameters: &["table_id", "column_id"],
            description: "Remove a column and its values; report the number of removed cells.",
        },
    ]
}

fn error(code: &str, step: Option<usize>, message: impl Into<String>) -> PlanError {
    PlanError {
        code: code.into(),
        step_index: step,
        message: message.into(),
    }
}

fn validate_name(name: &str, step: usize) -> Result<(), PlanError> {
    if name.trim().is_empty() || name.len() > 256 {
        return Err(error(
            "invalid_name",
            Some(step),
            "Names must contain non-whitespace text and be at most 256 UTF-8 bytes.",
        ));
    }
    Ok(())
}

fn constant(column: &Column, value: &Cell, step: usize) -> Result<Cell, PlanError> {
    match value {
        Cell::Null if column.nullable => Ok(Cell::Null),
        Cell::Null => Err(error(
            "invalid_value",
            Some(step),
            "NULL requires a nullable column.",
        )),
        Cell::Text(s) if column.data_type == DataType::Text && s.len() <= 8192 => Ok(value.clone()),
        Cell::Integer(s) if column.data_type == DataType::Integer => strict_integer(s)
            .map(|n| Cell::Integer(n.to_string()))
            .map_err(|message| error("invalid_value", Some(step), message)),
        _ => Err(error(
            "invalid_value",
            Some(step),
            "The constant must match its column type and fit the 8 KiB cell limit.",
        )),
    }
}

fn check_batch_bounds(state: &ModelState) -> Result<(), PlanError> {
    let rows: usize = state.data.values().map(Vec::len).sum();
    let bytes: usize = state
        .data
        .values()
        .flatten()
        .flat_map(|row| row.cells.values())
        .map(Cell::content_bytes)
        .sum();
    let metadata_invalid = state.version_id.len() > 128
        || state.schema.tables.len() > 24
        || state
            .schema
            .tables
            .iter()
            .map(|table| table.columns.len())
            .sum::<usize>()
            > 400
        || state.schema.tables.iter().any(|table| {
            table.id.len() > 128
                || table.name.len() > 256
                || table.columns.len() > 100
                || table
                    .columns
                    .iter()
                    .any(|column| column.id.len() > 128 || column.name.len() > 256)
        });
    let records_invalid = state.data.values().flatten().any(|row| {
        row.id.len() > 128
            || row.cells.values().any(|value| value.content_bytes() > 8192)
            || row.cells.values().map(Cell::content_bytes).sum::<usize>() > 256 * 1024
    });
    if rows > 200 || bytes > 2 * 1024 * 1024 || metadata_invalid || records_invalid {
        return Err(error(
            "resource_limit",
            None,
            "Evaluate at most 200 rows and 2 MiB of cell data per batch; metadata and cell limits also apply.",
        ));
    }
    Ok(())
}

/// Evaluates a bounded batch on a private copy. The browser adapter supplies
/// bounded row batches, aggregates reports, and publishes only a complete plan.
/// This pure function never writes storage or mutates the caller's state.
pub fn preview(state: &ModelState, plan: &[Operation]) -> Result<Preview, PlanError> {
    evaluate(state, plan, false)
}

/// Bounded adapters must validate the complete candidate with Checker before publication.
pub fn preview_batch(state: &ModelState, plan: &[Operation]) -> Result<Preview, PlanError> {
    evaluate(state, plan, true)
}

fn evaluate(state: &ModelState, plan: &[Operation], batch: bool) -> Result<Preview, PlanError> {
    check_batch_bounds(state)?;
    state
        .validate()
        .map_err(|message| error("invalid_state", None, message))?;
    if !batch {
        super::constraints::validate(state)
            .map_err(|message| error("constraint_violation", None, message))?;
    }
    if plan.is_empty() || plan.len() > 32 {
        return Err(error(
            "invalid_plan",
            None,
            "A plan must contain between 1 and 32 operations.",
        ));
    }
    let mut candidate = state.clone();
    let mut reports = Vec::new();
    for (step, operation) in plan.iter().enumerate() {
        if let Operation::CreateTable { table } = operation {
            validate_name(&table.name, step)?;
            if table.id.is_empty()
                || table.id.len() > 128
                || candidate
                    .schema
                    .tables
                    .iter()
                    .any(|t| t.id == table.id || t.name == table.name)
            {
                return Err(error(
                    "name_conflict",
                    Some(step),
                    "The new table needs a unique name and ID.",
                ));
            }
            if !table.primary_key.is_empty() {
                return Err(error(
                    "invalid_plan",
                    Some(step),
                    "Use AddPrimaryKey to declare a key after creating the table.",
                ));
            }
            for col in &table.columns {
                validate_name(&col.name, step)?;
            }
            if table
                .columns
                .iter()
                .map(|c| &c.name)
                .collect::<std::collections::BTreeSet<_>>()
                .len()
                != table.columns.len()
            {
                return Err(error(
                    "name_conflict",
                    Some(step),
                    "Field names must be unique within the new table.",
                ));
            }
            candidate.schema.tables.push(table.clone());
            candidate.data.insert(table.id.clone(), vec![]);
            candidate
                .validate()
                .map_err(|message| error("invalid_state", Some(step), message))?;
            check_batch_bounds(&candidate)?;
            reports.push(StepReport {
                step_index: step,
                op: "create_table".into(),
                table_id: table.id.clone(),
                column_id: None,
                description: format!("Create table {}", table.name),
                rows_checked: 0,
                cells_added: 0,
                cells_removed: 0,
                rows_removed: 0,
            });
            continue;
        }
        let table_id = match operation {
            Operation::CreateTable { .. } => unreachable!(),
            Operation::AddPrimaryKey { table_id, .. }
            | Operation::DropPrimaryKey { table_id }
            | Operation::AddForeignKey { table_id, .. }
            | Operation::DropForeignKey { table_id, .. }
            | Operation::DropTable { table_id }
            | Operation::RenameTable { table_id, .. }
            | Operation::RenameColumn { table_id, .. }
            | Operation::AddColumn { table_id, .. }
            | Operation::DropColumn { table_id, .. } => table_id,
        };
        let table_index = candidate
            .schema
            .tables
            .iter()
            .position(|table| table.id == *table_id)
            .ok_or_else(|| {
                error(
                    "unknown_target",
                    Some(step),
                    "The selected table no longer exists.",
                )
            })?;
        let mut report = StepReport {
            step_index: step,
            op: String::new(),
            table_id: table_id.clone(),
            column_id: None,
            description: String::new(),
            rows_checked: 0,
            cells_added: 0,
            cells_removed: 0,
            rows_removed: 0,
        };
        match operation {
            Operation::CreateTable { .. } => unreachable!(),
            Operation::AddPrimaryKey { column_ids, .. } => {
                let table = &mut candidate.schema.tables[table_index];
                if !table.primary_key.is_empty() {
                    return Err(error(
                        "constraint_dependency",
                        Some(step),
                        "Remove the existing primary key first.",
                    ));
                }
                if column_ids.is_empty() {
                    return Err(error(
                        "invalid_key",
                        Some(step),
                        "Select at least one primary-key field.",
                    ));
                }
                table.primary_key = column_ids.clone();
                for column in &mut table.columns {
                    if column_ids.contains(&column.id) {
                        column.nullable = false;
                    }
                }
                report.op = "add_primary_key".into();
                report.description = format!(
                    "Set primary key {} ({})",
                    table.name,
                    column_ids
                        .iter()
                        .filter_map(|id| table.columns.iter().find(|c| c.id == *id))
                        .map(|c| c.name.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                );
            }
            Operation::DropPrimaryKey { .. } => {
                if candidate
                    .schema
                    .foreign_keys
                    .iter()
                    .any(|fk| fk.target_table == *table_id)
                {
                    return Err(error(
                        "constraint_dependency",
                        Some(step),
                        "Remove foreign keys referencing this primary key first.",
                    ));
                }
                let table = &mut candidate.schema.tables[table_index];
                if table.primary_key.is_empty() {
                    return Err(error(
                        "unknown_target",
                        Some(step),
                        "This table has no primary key.",
                    ));
                }
                table.primary_key.clear();
                report.op = "drop_primary_key".into();
                report.description = format!("Remove primary key from {}", table.name);
            }
            Operation::AddForeignKey { foreign_key, .. } => {
                if foreign_key.source_table != *table_id {
                    return Err(error(
                        "invalid_key",
                        Some(step),
                        "Foreign key source does not match its table.",
                    ));
                }
                if candidate.schema.foreign_keys.iter().any(|fk| {
                    fk.source_table == foreign_key.source_table
                        && fk.source_columns == foreign_key.source_columns
                        && fk.target_table == foreign_key.target_table
                        && fk.target_columns == foreign_key.target_columns
                }) {
                    return Err(error(
                        "name_conflict",
                        Some(step),
                        "This foreign key already exists.",
                    ));
                }
                candidate.schema.foreign_keys.push(foreign_key.clone());
                report.op = "add_foreign_key".into();
                let source = &candidate.schema.tables[table_index];
                let target = candidate
                    .schema
                    .tables
                    .iter()
                    .find(|t| t.id == foreign_key.target_table)
                    .ok_or_else(|| {
                        error(
                            "unknown_target",
                            Some(step),
                            "The target table no longer exists.",
                        )
                    })?;
                let field_names = |table: &Table, ids: &[String]| {
                    ids.iter()
                        .filter_map(|id| table.columns.iter().find(|c| c.id == *id))
                        .map(|c| c.name.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                };
                report.description = format!(
                    "Add foreign key {} ({}) → {} ({})",
                    source.name,
                    field_names(source, &foreign_key.source_columns),
                    target.name,
                    field_names(target, &foreign_key.target_columns)
                );
            }
            Operation::DropForeignKey { foreign_key_id, .. } => {
                let i = candidate
                    .schema
                    .foreign_keys
                    .iter()
                    .position(|fk| fk.id == *foreign_key_id && fk.source_table == *table_id)
                    .ok_or_else(|| {
                        error(
                            "unknown_target",
                            Some(step),
                            "This foreign key no longer exists.",
                        )
                    })?;
                candidate.schema.foreign_keys.remove(i);
                report.op = "drop_foreign_key".into();
                report.description = format!(
                    "Remove foreign key from {}",
                    candidate.schema.tables[table_index].name
                );
            }
            Operation::DropTable { .. } => {
                if candidate
                    .schema
                    .foreign_keys
                    .iter()
                    .any(|fk| fk.source_table == *table_id || fk.target_table == *table_id)
                {
                    return Err(error(
                        "constraint_dependency",
                        Some(step),
                        "Remove connected foreign keys before removing this table.",
                    ));
                }
                let table = candidate.schema.tables.remove(table_index);
                let rows = candidate
                    .data
                    .remove(table_id)
                    .expect("validated table data");
                report.op = "drop_table".into();
                report.rows_removed = rows.len();
                report.cells_removed = rows.len().saturating_mul(table.columns.len());
                report.description = format!("Remove table {}", table.name);
            }
            Operation::RenameTable { new_name, .. } => {
                validate_name(new_name, step)?;
                if candidate
                    .schema
                    .tables
                    .iter()
                    .enumerate()
                    .any(|(i, table)| i != table_index && table.name == *new_name)
                {
                    return Err(error(
                        "name_conflict",
                        Some(step),
                        "Another table already uses this name.",
                    ));
                }
                let table = &mut candidate.schema.tables[table_index];
                report.op = "rename_table".into();
                report.description = format!("Rename table {} to {}", table.name, new_name);
                table.name = new_name.clone();
            }
            Operation::RenameColumn {
                column_id,
                new_name,
                ..
            } => {
                validate_name(new_name, step)?;
                let table = &mut candidate.schema.tables[table_index];
                let index = table
                    .columns
                    .iter()
                    .position(|column| column.id == *column_id)
                    .ok_or_else(|| {
                        error(
                            "unknown_target",
                            Some(step),
                            "The selected field no longer exists.",
                        )
                    })?;
                if table
                    .columns
                    .iter()
                    .enumerate()
                    .any(|(i, column)| i != index && column.name == *new_name)
                {
                    return Err(error(
                        "name_conflict",
                        Some(step),
                        "Another field in this table already uses this name.",
                    ));
                }
                report.op = "rename_column".into();
                report.column_id = Some(column_id.clone());
                report.description = format!(
                    "Rename {}.{} to {}",
                    table.name, table.columns[index].name, new_name
                );
                table.columns[index].name = new_name.clone();
            }
            Operation::AddColumn { column, value, .. } => {
                validate_name(&column.name, step)?;
                if column.id.is_empty()
                    || column.id.len() > 128
                    || candidate
                        .schema
                        .tables
                        .iter()
                        .flat_map(|table| &table.columns)
                        .any(|existing| existing.id == column.id)
                {
                    return Err(error(
                        "id_conflict",
                        Some(step),
                        "The new field needs a unique ID of at most 128 UTF-8 bytes.",
                    ));
                }
                if candidate.schema.tables[table_index]
                    .columns
                    .iter()
                    .any(|existing| existing.name == column.name)
                {
                    return Err(error(
                        "name_conflict",
                        Some(step),
                        "Another field in this table already uses this name.",
                    ));
                }
                let value = constant(column, value, step)?;
                if candidate.schema.tables[table_index].columns.len() >= 100
                    || candidate
                        .schema
                        .tables
                        .iter()
                        .map(|table| table.columns.len())
                        .sum::<usize>()
                        >= 400
                {
                    return Err(error(
                        "resource_limit",
                        Some(step),
                        "A table supports at most 100 fields and a model at most 400 fields.",
                    ));
                }
                let existing_bytes: usize = candidate
                    .data
                    .values()
                    .flatten()
                    .flat_map(|row| row.cells.values())
                    .map(Cell::content_bytes)
                    .sum();
                let target_rows = &candidate.data[table_id];
                if existing_bytes
                    .saturating_add(target_rows.len().saturating_mul(value.content_bytes()))
                    > 2 * 1024 * 1024
                    || target_rows.iter().any(|row| {
                        row.cells
                            .values()
                            .map(Cell::content_bytes)
                            .sum::<usize>()
                            .saturating_add(value.content_bytes())
                            > 256 * 1024
                    })
                {
                    return Err(error(
                        "resource_limit",
                        Some(step),
                        "The output batch would exceed the data limit; evaluate fewer rows per batch.",
                    ));
                }
                let rows = candidate
                    .data
                    .get_mut(table_id)
                    .expect("validated table data");
                for row in rows.iter_mut() {
                    row.cells.insert(column.id.clone(), value.clone());
                }
                report.op = "add_column".into();
                report.column_id = Some(column.id.clone());
                report.rows_checked = rows.len();
                report.cells_added = rows.len();
                report.description = format!(
                    "Add field {} to {}",
                    column.name, candidate.schema.tables[table_index].name
                );
                candidate.schema.tables[table_index]
                    .columns
                    .push(column.clone());
            }
            Operation::DropColumn { column_id, .. } => {
                if candidate.schema.tables[table_index]
                    .primary_key
                    .contains(column_id)
                    || candidate.schema.foreign_keys.iter().any(|fk| {
                        fk.source_columns.contains(column_id)
                            || fk.target_columns.contains(column_id)
                    })
                {
                    return Err(error(
                        "constraint_dependency",
                        Some(step),
                        "Remove the primary or foreign key using this field first.",
                    ));
                }
                let table = &mut candidate.schema.tables[table_index];
                let index = table
                    .columns
                    .iter()
                    .position(|column| column.id == *column_id)
                    .ok_or_else(|| {
                        error(
                            "unknown_target",
                            Some(step),
                            "The selected field no longer exists.",
                        )
                    })?;
                let column = table.columns.remove(index);
                let rows = candidate
                    .data
                    .get_mut(table_id)
                    .expect("validated table data");
                for row in rows.iter_mut() {
                    row.cells.remove(column_id);
                }
                report.op = "drop_column".into();
                report.column_id = Some(column_id.clone());
                report.rows_checked = rows.len();
                report.cells_removed = rows.len();
                report.description = format!("Delete field {} from {}", column.name, table.name);
            }
        }
        candidate
            .schema
            .validate()
            .map_err(|message| error("invalid_key", Some(step), message))?;
        if !batch {
            super::constraints::validate(&candidate)
                .map_err(|message| error("constraint_violation", Some(step), message))?;
        }
        reports.push(report);
    }
    candidate
        .validate()
        .map_err(|message| error("invalid_result", None, message))?;
    Ok(Preview {
        base_version_id: state.version_id.clone(),
        candidate,
        reports,
    })
}
