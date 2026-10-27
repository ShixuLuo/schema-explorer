use schema_explorer::{
    adapters::csv::{CsvInput, import_csv},
    domain::{Cell, ForeignKey, Schema, Table},
    domain::{ConstraintChecker as Checker, ValidationBatch as Batch, ValidationPhase as Phase},
    domain::{Operation, preview},
    migration::{generate, postgres::Postgres},
};
use std::collections::BTreeMap;
fn model() -> schema_explorer::domain::ModelState {
    import_csv(
        &[
            CsvInput {
                table_name: "parents",
                contents: "id,name\np1,One\np2,Two\n",
            },
            CsvInput {
                table_name: "children",
                contents: "id,parent_id\nc1,p1\nc2,p2\n",
            },
        ],
        "base",
    )
    .unwrap()
}
fn pk(table: usize, column: usize) -> Operation {
    Operation::AddPrimaryKey {
        table_id: format!("table_{table}"),
        column_ids: vec![format!("column_{table}_{column}")],
    }
}
fn fk() -> ForeignKey {
    ForeignKey {
        id: "relationship".into(),
        source_table: "table_1".into(),
        source_columns: vec!["column_1_1".into()],
        target_table: "table_0".into(),
        target_columns: vec!["column_0_0".into()],
    }
}
fn add_fk() -> Operation {
    Operation::AddForeignKey {
        table_id: "table_1".into(),
        foreign_key: fk(),
    }
}
#[test]
fn creates_real_empty_tables_and_composes_subsequent_edits() {
    let m = model();
    let new = Table {
        id: "new".into(),
        name: "new table".into(),
        columns: vec![],
        primary_key: vec![],
    };
    let p = preview(
        &m,
        &[
            Operation::CreateTable { table: new },
            Operation::RenameTable {
                table_id: "new".into(),
                new_name: "renamed".into(),
            },
        ],
    )
    .unwrap();
    assert_eq!(p.candidate.schema.tables.len(), 3);
    assert!(p.candidate.data["new"].is_empty());
    assert_eq!(m.schema.tables.len(), 2);
}
#[test]
fn keys_and_references_are_constraints_and_survive_rename() {
    let m = model();
    let p = preview(
        &m,
        &[
            pk(0, 0),
            add_fk(),
            Operation::RenameColumn {
                table_id: "table_0".into(),
                column_id: "column_0_0".into(),
                new_name: "key".into(),
            },
        ],
    )
    .unwrap();
    assert_eq!(p.candidate.schema.foreign_keys[0], fk());
    assert!(
        preview(
            &p.candidate,
            &[Operation::DropPrimaryKey {
                table_id: "table_0".into()
            }]
        )
        .is_err()
    );
    assert!(
        preview(
            &p.candidate,
            &[Operation::DropColumn {
                table_id: "table_1".into(),
                column_id: "column_1_1".into()
            }]
        )
        .is_err()
    );
    assert!(
        preview(
            &p.candidate,
            &[Operation::DropTable {
                table_id: "table_0".into()
            }]
        )
        .is_err()
    );
    let removed = preview(
        &p.candidate,
        &[
            Operation::DropForeignKey {
                table_id: "table_1".into(),
                foreign_key_id: "relationship".into(),
            },
            Operation::DropPrimaryKey {
                table_id: "table_0".into(),
            },
        ],
    )
    .unwrap();
    assert!(removed.candidate.schema.foreign_keys.is_empty());
}
#[test]
fn refuses_duplicate_null_and_orphan_values_without_mutation() {
    let mut m = model();
    m.data.get_mut("table_0").unwrap()[1]
        .cells
        .insert("column_0_0".into(), Cell::Text("p1".into()));
    assert!(
        preview(&m, &[pk(0, 0)])
            .unwrap_err()
            .message
            .contains("duplicate")
    );
    assert!(m.schema.tables[0].primary_key.is_empty());
    m.schema.tables[0].columns[0].nullable = true;
    m.data.get_mut("table_0").unwrap()[1]
        .cells
        .insert("column_0_0".into(), Cell::Null);
    assert!(preview(&m, &[pk(0, 0)]).is_err());
    let mut m = model();
    m.data.get_mut("table_1").unwrap()[1]
        .cells
        .insert("column_1_1".into(), Cell::Text("orphan".into()));
    let err = preview(&m, &[pk(0, 0), add_fk()]).unwrap_err();
    assert!(err.message.contains("row 2"));
    assert!(m.schema.foreign_keys.is_empty());
}
#[test]
fn composite_keys_and_match_simple_nulls_have_explicit_semantics() {
    let mut m = model();
    m.schema.tables[1].columns[1].nullable = true;
    m.data.get_mut("table_1").unwrap()[0]
        .cells
        .insert("column_1_1".into(), Cell::Null);
    preview(&m, &[pk(0, 0), add_fk()]).unwrap();
    m.data.get_mut("table_1").unwrap()[0]
        .cells
        .insert("column_1_1".into(), Cell::Text("".into()));
    assert!(preview(&m, &[pk(0, 0), add_fk()]).is_err());
    let m = model();
    let composite = Operation::AddPrimaryKey {
        table_id: "table_0".into(),
        column_ids: vec!["column_0_0".into(), "column_0_1".into()],
    };
    let p = preview(&m, &[composite]).unwrap();
    assert_eq!(p.candidate.schema.tables[0].primary_key.len(), 2);
    assert!(preview(&p.candidate, &[add_fk()]).is_err());
    let mut keyed = p.candidate;
    for (i, row) in keyed
        .data
        .get_mut("table_1")
        .unwrap()
        .iter_mut()
        .enumerate()
    {
        row.cells
            .insert("column_1_0".into(), Cell::Text(format!("p{}", i + 1)));
        row.cells.insert(
            "column_1_1".into(),
            Cell::Text(if i == 0 { "One" } else { "Two" }.into()),
        );
    }
    let mut key = fk();
    key.source_columns = vec!["column_1_0".into(), "column_1_1".into()];
    key.target_columns.push("column_0_1".into());
    preview(
        &keyed,
        &[Operation::AddForeignKey {
            table_id: "table_1".into(),
            foreign_key: key,
        }],
    )
    .unwrap();
}
#[test]
fn streaming_validation_detects_cross_batch_duplicates_and_missing_coverage() {
    let m = preview(&model(), &[pk(0, 0)]).unwrap().candidate;
    let mut c = Checker::new(
        m.schema.clone(),
        m.data.iter().map(|(id, r)| (id.clone(), r.len())).collect(),
    )
    .unwrap();
    let row = BTreeMap::from([("column_0_0".into(), Cell::Text("same".into()))]);
    c.push(Batch {
        phase: Phase::Keys,
        table_id: "table_0".into(),
        start: 0,
        rows: vec![row.clone()],
    })
    .unwrap();
    assert!(c.finish().is_err());
    assert!(
        c.push(Batch {
            phase: Phase::Keys,
            table_id: "table_0".into(),
            start: 1,
            rows: vec![row]
        })
        .unwrap_err()
        .contains("duplicate")
    );
}
#[test]
fn generator_replays_committed_operations_with_correct_names_and_dependencies() {
    let m = model();
    let ops = vec![
        pk(0, 0),
        add_fk(),
        Operation::RenameTable {
            table_id: "table_0".into(),
            new_name: "select".into(),
        },
        Operation::RenameColumn {
            table_id: "table_0".into(),
            column_id: "column_0_0".into(),
            new_name: "a\"b".into(),
        },
    ];
    let target = preview(&m, &ops).unwrap().candidate;
    let result = generate(&m.schema, &ops, &target.schema, &Postgres).unwrap();
    assert!(result.changes.contains("REFERENCES \"parents\""));
    assert!(
        result
            .changes
            .contains("ALTER TABLE \"select\" RENAME COLUMN \"id\" TO \"a\"\"b\"")
    );
    assert!(
        result
            .current
            .contains("REFERENCES \"select\" (\"a\"\"b\")")
    );
    assert!(generate(&m.schema, &[], &target.schema, &Postgres).is_err());
}
#[test]
fn generator_handles_empty_models_and_rejects_postgres_identifier_truncation() {
    let empty = Schema {
        tables: vec![],
        foreign_keys: vec![],
    };
    assert!(
        generate(&empty, &[], &empty, &Postgres)
            .unwrap()
            .current
            .contains("COMMIT")
    );
    let mut m = model();
    m.schema.tables[0].name = "x".repeat(64);
    assert!(
        generate(&m.schema, &[], &m.schema, &Postgres)
            .unwrap_err()
            .contains("63")
    );
}

#[test]
fn sql_generation_preserves_imported_identifier_whitespace() {
    let mut m = model();
    m.schema.tables[0].columns[0].name = " id ".into();
    let sql = generate(&m.schema, &[], &m.schema, &Postgres).unwrap();
    assert!(sql.current.contains("\" id \" TEXT"));
}

#[test]
fn a_second_dialect_reuses_the_planner_and_owns_script_boundaries() {
    struct TraceDialect;
    impl schema_explorer::migration::SqlDialect for TraceDialect {
        fn render(
            &self,
            before: &Schema,
            after: &Schema,
            _operation: &Operation,
        ) -> Result<Vec<String>, String> {
            Ok(vec![format!(
                "{} -> {}",
                before
                    .tables
                    .iter()
                    .map(|t| t.name.as_str())
                    .collect::<Vec<_>>()
                    .join(","),
                after
                    .tables
                    .iter()
                    .map(|t| t.name.as_str())
                    .collect::<Vec<_>>()
                    .join(",")
            )])
        }
        fn script(&self, statements: Vec<String>) -> String {
            format!("TRACE[{}]", statements.join(";"))
        }
    }
    let m = model();
    let operations = vec![Operation::RenameTable {
        table_id: "table_0".into(),
        new_name: "renamed".into(),
    }];
    let target = preview(&m, &operations).unwrap().candidate;
    let result = generate(&m.schema, &operations, &target.schema, &TraceDialect).unwrap();
    assert_eq!(
        result.changes,
        "TRACE[parents,children -> renamed,children]"
    );
    assert!(result.current.starts_with("TRACE["));
    assert!(!result.current.contains("BEGIN"));
    assert_eq!(m.schema.tables[0].name, "parents");
}
