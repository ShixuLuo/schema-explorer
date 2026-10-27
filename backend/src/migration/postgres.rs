use super::SqlDialect;
use crate::{
    domain::Operation,
    domain::{Cell, DataType, Schema},
};

pub struct Postgres;
fn ident(value: &str) -> Result<String, String> {
    if value.is_empty() || value.len() > 63 || value.contains('\0') {
        return Err(format!(
            "PostgreSQL identifiers must be 1–63 UTF-8 bytes without NUL: {value:?}"
        ));
    }
    Ok(format!("\"{}\"", value.replace('"', "\"\"")))
}
fn constraint(prefix: &str, id: &str) -> String {
    let hash = id.bytes().fold(0xcbf29ce484222325_u64, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x100000001b3)
    });
    format!("\"{prefix}_{hash:016x}\"")
}
fn kind(value: DataType) -> &'static str {
    match value {
        DataType::Text => "TEXT",
        DataType::Integer => "BIGINT",
    }
}
fn literal(value: &Cell) -> Result<String, String> {
    match value {
        Cell::Null => Ok("NULL".into()),
        Cell::Integer(s) => Ok(crate::domain::strict_integer(s)?.to_string()),
        Cell::Text(s) if s.contains('\0') => Err("PostgreSQL text cannot contain NUL.".into()),
        Cell::Text(s) => Ok(format!(
            "E'{}'",
            s.replace('\\', "\\\\").replace('\'', "''")
        )),
    }
}
fn names(schema: &Schema, table_id: &str, columns: &[String]) -> Result<String, String> {
    let table = schema
        .tables
        .iter()
        .find(|t| t.id == table_id)
        .ok_or("Unknown table in migration.")?;
    columns
        .iter()
        .map(|id| {
            ident(
                &table
                    .columns
                    .iter()
                    .find(|c| c.id == *id)
                    .ok_or("Unknown field in migration.")?
                    .name,
            )
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|v| v.join(", "))
}
impl SqlDialect for Postgres {
    fn render(
        &self,
        schema: &Schema,
        _after: &Schema,
        operation: &Operation,
    ) -> Result<Vec<String>, String> {
        if let Operation::CreateTable { table } = operation {
            let columns = table
                .columns
                .iter()
                .map(|c| {
                    Ok(format!(
                        "  {} {}{}",
                        ident(&c.name)?,
                        kind(c.data_type),
                        if c.nullable { "" } else { " NOT NULL" }
                    ))
                })
                .collect::<Result<Vec<_>, String>>()?;
            return Ok(vec![format!(
                "CREATE TABLE {} (\n{}\n);",
                ident(&table.name)?,
                columns.join(",\n")
            )]);
        }
        let id = match operation {
            Operation::CreateTable { .. } => unreachable!(),
            Operation::DropTable { table_id }
            | Operation::RenameTable { table_id, .. }
            | Operation::RenameColumn { table_id, .. }
            | Operation::AddColumn { table_id, .. }
            | Operation::DropColumn { table_id, .. }
            | Operation::AddPrimaryKey { table_id, .. }
            | Operation::DropPrimaryKey { table_id }
            | Operation::AddForeignKey { table_id, .. }
            | Operation::DropForeignKey { table_id, .. } => table_id,
        };
        let table = schema
            .tables
            .iter()
            .find(|t| t.id == *id)
            .ok_or("Unknown table in migration.")?;
        let t = ident(&table.name)?;
        Ok(match operation {
            Operation::CreateTable { .. } => unreachable!(),
            Operation::DropTable { .. } => vec![format!("DROP TABLE {t};")],
            Operation::RenameTable { new_name, .. } => {
                vec![format!("ALTER TABLE {t} RENAME TO {};", ident(new_name)?)]
            }
            Operation::RenameColumn {
                column_id,
                new_name,
                ..
            } => vec![format!(
                "ALTER TABLE {t} RENAME COLUMN {} TO {};",
                names(schema, id, std::slice::from_ref(column_id))?,
                ident(new_name)?
            )],
            Operation::DropColumn { column_id, .. } => vec![format!(
                "ALTER TABLE {t} DROP COLUMN {};",
                names(schema, id, std::slice::from_ref(column_id))?
            )],
            Operation::AddColumn { column, value, .. } => {
                let c = ident(&column.name)?;
                let mut result = vec![format!(
                    "ALTER TABLE {t} ADD COLUMN {c} {};",
                    kind(column.data_type)
                )];
                if *value != Cell::Null {
                    result.push(format!("UPDATE {t} SET {c} = {};", literal(value)?));
                }
                if !column.nullable {
                    result.push(format!("ALTER TABLE {t} ALTER COLUMN {c} SET NOT NULL;"));
                }
                result
            }
            Operation::AddPrimaryKey { column_ids, .. } => vec![format!(
                "ALTER TABLE {t} ADD CONSTRAINT {} PRIMARY KEY ({});",
                constraint("pk", id),
                names(schema, id, column_ids)?
            )],
            Operation::DropPrimaryKey { .. } => vec![format!(
                "ALTER TABLE {t} DROP CONSTRAINT {};",
                constraint("pk", id)
            )],
            Operation::AddForeignKey {
                foreign_key: fk, ..
            } => {
                let target = schema
                    .tables
                    .iter()
                    .find(|t| t.id == fk.target_table)
                    .ok_or("Unknown target table.")?;
                vec![format!(
                    "ALTER TABLE {t}\n  ADD CONSTRAINT {}\n  FOREIGN KEY ({})\n  REFERENCES {} ({})\n  MATCH SIMPLE\n  ON UPDATE NO ACTION ON DELETE NO ACTION;",
                    constraint("fk", &fk.id),
                    names(schema, id, &fk.source_columns)?,
                    ident(&target.name)?,
                    names(schema, &fk.target_table, &fk.target_columns)?
                )]
            }
            Operation::DropForeignKey { foreign_key_id, .. } => vec![format!(
                "ALTER TABLE {t} DROP CONSTRAINT {};",
                constraint("fk", foreign_key_id)
            )],
        })
    }
    fn script(&self, statements: Vec<String>) -> String {
        format!(
            "-- Generated by Schema Explorer.\nBEGIN;\n\n{}\n\nCOMMIT;\n",
            statements.join("\n\n")
        )
    }
}
