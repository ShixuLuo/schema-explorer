pub mod postgres;

use crate::{
    domain::{ModelState, Schema},
    domain::{Operation, preview_batch},
};
use serde::Serialize;

/// A dialect receives a validated transition, including both schema versions.
/// It owns SQL syntax and script boundaries; the planner owns operation semantics.
pub trait SqlDialect {
    fn render(
        &self,
        before: &Schema,
        after: &Schema,
        operation: &Operation,
    ) -> Result<Vec<String>, String>;
    fn script(&self, statements: Vec<String>) -> String;
}

#[derive(Debug, Serialize)]
pub struct MigrationSql {
    pub changes: String,
    pub baseline: String,
    pub current: String,
}

fn empty(schema: Schema) -> ModelState {
    ModelState {
        version_id: "sql".into(),
        data: schema
            .tables
            .iter()
            .map(|t| (t.id.clone(), vec![]))
            .collect(),
        schema,
    }
}

fn render_steps(
    base: &Schema,
    operations: &[Operation],
    dialect: &impl SqlDialect,
) -> Result<(Schema, String), String> {
    let mut state = empty(base.clone());
    state.validate()?;
    let mut statements = vec![];
    for operation in operations {
        let next = preview_batch(&state, std::slice::from_ref(operation)).map_err(|e| e.message)?;
        statements.extend(dialect.render(&state.schema, &next.candidate.schema, operation)?);
        state = next.candidate;
    }
    Ok((state.schema, dialect.script(statements)))
}

pub fn create_schema(schema: &Schema, dialect: &impl SqlDialect) -> Result<String, String> {
    let mut operations = vec![];
    for table in &schema.tables {
        let mut bare = table.clone();
        bare.primary_key.clear();
        operations.push(Operation::CreateTable { table: bare });
    }
    for table in &schema.tables {
        if !table.primary_key.is_empty() {
            operations.push(Operation::AddPrimaryKey {
                table_id: table.id.clone(),
                column_ids: table.primary_key.clone(),
            });
        }
    }
    for fk in &schema.foreign_keys {
        operations.push(Operation::AddForeignKey {
            table_id: fk.source_table.clone(),
            foreign_key: fk.clone(),
        });
    }
    let base = Schema {
        tables: vec![],
        foreign_keys: vec![],
    };
    let (actual, sql) = render_steps(&base, &operations, dialect)?;
    if actual != *schema {
        return Err("The schema is not in canonical form.".into());
    }
    Ok(sql)
}

pub fn generate(
    base: &Schema,
    operations: &[Operation],
    expected: &Schema,
    dialect: &impl SqlDialect,
) -> Result<MigrationSql, String> {
    if operations.len() > 256 {
        return Err("Export at most 256 committed operations.".into());
    }
    let (actual, changes) = render_steps(base, operations, dialect)?;
    if actual != *expected {
        return Err("Migration history does not match the current model.".into());
    }
    Ok(MigrationSql {
        changes,
        baseline: create_schema(base, dialect)?,
        current: create_schema(expected, dialect)?,
    })
}
