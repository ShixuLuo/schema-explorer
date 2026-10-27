use schema_explorer::{
    adapters::csv::{CsvInput, import_csv},
    analysis::context::{ColumnRef, Intent, build_context},
    analysis::profile::profile,
    domain::{Cell, Column, DataType, ModelState},
    domain::{Operation, definitions, preview, strict_integer},
};

fn state(contents: &str) -> ModelState {
    import_csv(
        &[CsvInput {
            table_name: "arbitrary input",
            contents,
        }],
        "v0",
    )
    .unwrap()
}
fn add(kind: DataType, nullable: bool, value: Cell) -> Operation {
    Operation::AddColumn {
        table_id: "table_0".into(),
        column: Column {
            id: "new_column".into(),
            name: "added".into(),
            data_type: kind,
            nullable,
        },
        value,
    }
}

#[test]
fn imports_unknown_business_fields_without_inference_or_cleanup() {
    let model = state("alpha,custom key\n001,  unchanged  \n,0\n");
    assert_eq!(model.schema.tables[0].columns[0].data_type, DataType::Text);
    assert_eq!(
        model.data["table_0"][0].cells["column_0_1"],
        Cell::Text("  unchanged  ".into())
    );
    assert_eq!(
        model.data["table_0"][1].cells["column_0_0"],
        Cell::Text("".into())
    );
}

#[test]
fn supports_different_numbers_of_tables_and_columns() {
    let model = import_csv(
        &[
            CsvInput {
                table_name: "one",
                contents: "a\n1\n",
            },
            CsvInput {
                table_name: "two",
                contents: "x,y,z\n3,4,5\n",
            },
        ],
        "arbitrary-version",
    )
    .unwrap();
    model.validate().unwrap();
    assert_eq!(model.schema.tables.len(), 2);
    assert_eq!(model.schema.tables[1].columns.len(), 3);
}

#[test]
fn ambiguous_headers_and_inconsistent_rows_are_rejected() {
    for csv in ["a,a\n1,2\n", "a,\n1,2\n", "a,b\n1\n", ""] {
        assert!(
            import_csv(
                &[CsvInput {
                    table_name: "x",
                    contents: csv
                }],
                "v0"
            )
            .is_err()
        );
    }
}

#[test]
fn signed_integer_literal_grammar_and_bounds_are_explicit() {
    for value in [
        "0",
        "-0",
        "+001",
        "9223372036854775807",
        "-9223372036854775808",
    ] {
        assert!(strict_integer(value).is_ok());
    }
    for value in [
        "",
        " ",
        " 1",
        "1 ",
        "1.0",
        "1e2",
        "+",
        "--1",
        "9223372036854775808",
    ] {
        assert!(strict_integer(value).is_err());
    }
}

#[test]
fn table_rename_preserves_ids_values_and_original_state() {
    let model = state("a\n001\n002\n");
    let original = model.clone();
    let result = preview(
        &model,
        &[Operation::RenameTable {
            table_id: "table_0".into(),
            new_name: "renamed".into(),
        }],
    )
    .unwrap();
    assert_eq!(model, original);
    assert_eq!(result.candidate.schema.tables[0].id, "table_0");
    assert_eq!(result.candidate.schema.tables[0].name, "renamed");
    assert_eq!(result.candidate.data, model.data);
}

#[test]
fn field_rename_keeps_stable_identity_and_data() {
    let model = state("a,b\n001,other\n");
    let result = preview(
        &model,
        &[Operation::RenameColumn {
            table_id: "table_0".into(),
            column_id: "column_0_0".into(),
            new_name: "new_name".into(),
        }],
    )
    .unwrap();
    assert_eq!(
        result.candidate.schema.tables[0].columns[0].id,
        "column_0_0"
    );
    assert_eq!(
        result.candidate.schema.tables[0].columns[0].name,
        "new_name"
    );
    assert_eq!(result.candidate.data, model.data);
}

#[test]
fn duplicate_table_and_column_names_are_rejected() {
    let model = import_csv(
        &[
            CsvInput {
                table_name: "one",
                contents: "a,b\n1,2\n",
            },
            CsvInput {
                table_name: "two",
                contents: "x\n3\n",
            },
        ],
        "v0",
    )
    .unwrap();
    assert_eq!(
        preview(
            &model,
            &[Operation::RenameTable {
                table_id: "table_0".into(),
                new_name: "two".into()
            }]
        )
        .unwrap_err()
        .code,
        "name_conflict"
    );
    assert_eq!(
        preview(
            &model,
            &[Operation::RenameColumn {
                table_id: "table_0".into(),
                column_id: "column_0_0".into(),
                new_name: "b".into()
            }]
        )
        .unwrap_err()
        .code,
        "name_conflict"
    );
}

#[test]
fn invalid_names_are_not_silently_repaired() {
    let model = state("a\n1\n");
    for name in [String::new(), " ".into(), "x".repeat(257)] {
        assert_eq!(
            preview(
                &model,
                &[Operation::RenameTable {
                    table_id: "table_0".into(),
                    new_name: name
                }]
            )
            .unwrap_err()
            .code,
            "invalid_name"
        );
    }
}

#[test]
fn adding_a_text_constant_changes_every_row_and_keeps_old_values() {
    let model = state("a\n001\n002\n");
    let result = preview(
        &model,
        &[add(
            DataType::Text,
            false,
            Cell::Text("literal value".into()),
        )],
    )
    .unwrap();
    assert_eq!(result.reports[0].cells_added, 2);
    for (before, after) in model.data["table_0"]
        .iter()
        .zip(&result.candidate.data["table_0"])
    {
        assert_eq!(before.id, after.id);
        assert_eq!(before.cells["column_0_0"], after.cells["column_0_0"]);
        assert_eq!(
            after.cells["new_column"],
            Cell::Text("literal value".into())
        );
    }
}

#[test]
fn integer_constants_are_canonical_and_json_precision_safe() {
    let model = state("a\n1\n");
    let result = preview(
        &model,
        &[add(DataType::Integer, false, Cell::Integer("+0001".into()))],
    )
    .unwrap();
    assert_eq!(
        result.candidate.data["table_0"][0].cells["new_column"],
        Cell::Integer("1".into())
    );
    let large = preview(
        &model,
        &[add(
            DataType::Integer,
            false,
            Cell::Integer("9223372036854775807".into()),
        )],
    )
    .unwrap();
    let json = serde_json::to_string(&large.candidate).unwrap();
    assert!(json.contains(r#""value":"9223372036854775807""#));
    assert_eq!(
        serde_json::from_str::<ModelState>(&json).unwrap(),
        large.candidate
    );
}

#[test]
fn null_is_explicit_and_requires_a_nullable_column() {
    let model = state("a\n1\n2\n");
    let result = preview(&model, &[add(DataType::Integer, true, Cell::Null)]).unwrap();
    assert_eq!(
        result.candidate.data["table_0"][0].cells["new_column"],
        Cell::Null
    );
    assert!(preview(&model, &[add(DataType::Integer, false, Cell::Null)]).is_err());
}

#[test]
fn incompatible_or_out_of_range_constants_are_rejected() {
    let model = state("a\n1\n");
    for operation in [
        add(DataType::Integer, false, Cell::Text("1".into())),
        add(
            DataType::Integer,
            false,
            Cell::Integer("9223372036854775808".into()),
        ),
        add(DataType::Text, false, Cell::Text("x".repeat(8193))),
    ] {
        assert_eq!(
            preview(&model, &[operation]).unwrap_err().code,
            "invalid_value"
        );
    }
}

#[test]
fn duplicate_field_ids_are_rejected() {
    let model = state("a\n1\n");
    let mut operation = add(DataType::Text, false, Cell::Text("x".into()));
    if let Operation::AddColumn { column, .. } = &mut operation {
        column.id = "column_0_0".into();
    }
    assert_eq!(
        preview(&model, &[operation]).unwrap_err().code,
        "id_conflict"
    );
    let mut oversized = add(DataType::Text, false, Cell::Text("x".into()));
    if let Operation::AddColumn { column, .. } = &mut oversized {
        column.id = "x".repeat(129);
    }
    assert_eq!(
        preview(&model, &[oversized]).unwrap_err().code,
        "id_conflict"
    );
}

#[test]
fn dropping_a_field_preserves_other_cells_and_reports_the_removed_count() {
    let model = state("a,b\n001,kept\n002,also kept\n");
    let result = preview(
        &model,
        &[Operation::DropColumn {
            table_id: "table_0".into(),
            column_id: "column_0_0".into(),
        }],
    )
    .unwrap();
    assert_eq!(result.reports[0].cells_removed, 2);
    assert_eq!(
        result.candidate.schema.tables[0].columns[0].id,
        "column_0_1"
    );
    for (before, after) in model.data["table_0"]
        .iter()
        .zip(&result.candidate.data["table_0"])
    {
        assert_eq!(before.id, after.id);
        assert_eq!(before.cells["column_0_1"], after.cells["column_0_1"]);
    }
}

#[test]
fn dropping_the_last_field_retains_record_multiplicity() {
    let model = state("a\nx\nx\n");
    let result = preview(
        &model,
        &[Operation::DropColumn {
            table_id: "table_0".into(),
            column_id: "column_0_0".into(),
        }],
    )
    .unwrap();
    assert!(result.candidate.schema.tables[0].columns.is_empty());
    assert_eq!(result.candidate.data["table_0"].len(), 2);
    assert!(
        result.candidate.data["table_0"]
            .iter()
            .all(|row| row.cells.is_empty())
    );
}

#[test]
fn operation_composition_uses_stable_ids_and_previous_step_outputs() {
    let model = state("a,b\n001,kept\n002,kept\n");
    let result = preview(
        &model,
        &[
            add(DataType::Text, false, Cell::Text("new".into())),
            Operation::RenameColumn {
                table_id: "table_0".into(),
                column_id: "new_column".into(),
                new_name: "renamed_new".into(),
            },
            Operation::DropColumn {
                table_id: "table_0".into(),
                column_id: "column_0_0".into(),
            },
        ],
    )
    .unwrap();
    assert_eq!(result.reports.len(), 3);
    assert_eq!(
        result.candidate.schema.tables[0].columns[1].name,
        "renamed_new"
    );
    assert_eq!(
        result.candidate.data["table_0"][0].cells["new_column"],
        Cell::Text("new".into())
    );
    assert!(model.data["table_0"][0].cells.contains_key("column_0_0"));
}

#[test]
fn failure_after_a_valid_step_does_not_change_the_input() {
    let model = state("a\n1\n");
    let original = model.clone();
    let failure = preview(
        &model,
        &[
            Operation::RenameTable {
                table_id: "table_0".into(),
                new_name: "renamed".into(),
            },
            Operation::DropColumn {
                table_id: "table_0".into(),
                column_id: "missing".into(),
            },
        ],
    )
    .unwrap_err();
    assert_eq!(failure.step_index, Some(1));
    assert_eq!(model, original);
}

#[test]
fn only_implemented_primitives_are_advertised() {
    let names: Vec<_> = definitions()
        .iter()
        .map(|definition| definition.op)
        .collect();
    assert_eq!(
        names,
        [
            "create_table",
            "add_primary_key",
            "drop_primary_key",
            "add_foreign_key",
            "drop_foreign_key",
            "drop_table",
            "rename_table",
            "rename_column",
            "add_column",
            "drop_column"
        ]
    );
    assert!(
        serde_json::from_str::<Operation>(
            r#"{"op":"change_type","table_id":"a","column_id":"b","target_type":"integer"}"#
        )
        .is_err()
    );
    assert!(
        serde_json::from_str::<Operation>(r#"{"op":"arbitrary_sql","sql":"drop table x"}"#)
            .is_err()
    );
}

#[test]
fn malformed_stored_data_is_rejected_before_transforming() {
    let mut model = state("a\n1\n");
    model.data.get_mut("table_0").unwrap()[0].cells.clear();
    assert_eq!(
        preview(
            &model,
            &[Operation::RenameTable {
                table_id: "table_0".into(),
                new_name: "other".into()
            }]
        )
        .unwrap_err()
        .code,
        "invalid_state"
    );
}

#[test]
fn profile_checks_full_columns_without_sending_raw_values() {
    let model = state("a,b\n1,private-raw-value\nunknown,another-private-value\n");
    let context = build_context(&model, Intent::default(), 16_384).unwrap();
    let encoded = serde_json::to_string(&context).unwrap();
    assert!(!encoded.contains("private-raw-value"));
    assert_eq!(context.columns[0].evidence.row_count, 2);
    assert_eq!(
        context.columns[0]
            .evidence
            .integer_evidence
            .as_ref()
            .unwrap()
            .failures,
        1
    );
}

#[test]
fn context_budget_is_exact_and_selection_is_prioritized() {
    let headers: Vec<_> = (0..40)
        .map(|i| format!("field_{i}_{}", "wide".repeat(10)))
        .collect();
    let model = state(&format!(
        "{}\n{}\n",
        headers.join(","),
        vec!["1"; 40].join(",")
    ));
    let intent = Intent {
        instruction: Some("Consider the selected column".into()),
        selection: vec![ColumnRef {
            table_id: "table_0".into(),
            column_id: "column_0_39".into(),
        }],
    };
    let context = build_context(&model, intent, 3_000).unwrap();
    assert!(serde_json::to_vec(&context).unwrap().len() <= 3_000);
    assert!(context.coverage.omitted_columns > 0);
    assert_eq!(context.columns[0].column.id, "column_0_39");
}

#[test]
fn empty_columns_are_not_evidence_for_integer_suggestions() {
    assert!(!profile(&state("a\n")).unwrap()[0].can_cast_to_integer());
}

#[test]
fn oversized_batches_are_rejected_before_copying_or_expanding_data() {
    let model = state(&format!("a\n{}", "x\n".repeat(201)));
    assert_eq!(
        preview(
            &model,
            &[Operation::RenameTable {
                table_id: "table_0".into(),
                new_name: "renamed".into()
            }]
        )
        .unwrap_err()
        .code,
        "resource_limit"
    );
}

#[test]
fn output_expansion_is_bounded_for_every_step() {
    let model = state(&format!("a\n{}", "x\n".repeat(200)));
    let first = add(DataType::Text, false, Cell::Text("x".repeat(8192)));
    let mut second = add(DataType::Text, false, Cell::Text("y".repeat(8192)));
    if let Operation::AddColumn { column, .. } = &mut second {
        column.id = "second".into();
        column.name = "second".into();
    }
    let failure = preview(&model, &[first, second]).unwrap_err();
    assert_eq!(failure.code, "resource_limit");
    assert_eq!(failure.step_index, Some(1));
    assert_eq!(model.schema.tables[0].columns.len(), 1);
}

#[test]
fn table_removal_drops_only_the_selected_schema_and_records() {
    let model = import_csv(
        &[
            CsvInput {
                table_name: "one",
                contents: "a\n001\n002\n",
            },
            CsvInput {
                table_name: "two",
                contents: "b\nkept\n",
            },
        ],
        "v0",
    )
    .unwrap();
    let original = model.clone();
    let result = preview(
        &model,
        &[Operation::DropTable {
            table_id: "table_0".into(),
        }],
    )
    .unwrap();
    assert_eq!(result.candidate.schema.tables.len(), 1);
    assert_eq!(result.candidate.schema.tables[0].id, "table_1");
    assert!(!result.candidate.data.contains_key("table_0"));
    assert_eq!(result.candidate.data["table_1"], model.data["table_1"]);
    assert_eq!(result.reports[0].rows_removed, 2);
    assert_eq!(result.reports[0].cells_removed, 2);
    assert_eq!(model, original);
}

#[test]
fn removing_the_last_table_produces_a_valid_empty_model() {
    let result = preview(
        &state("a\n001\n"),
        &[Operation::DropTable {
            table_id: "table_0".into(),
        }],
    )
    .unwrap();
    assert!(result.candidate.schema.tables.is_empty());
    assert!(result.candidate.data.is_empty());
    result.candidate.validate().unwrap();
}

#[test]
fn subsequent_operations_cannot_use_a_removed_table() {
    let model = state("a\n1\n");
    let original = model.clone();
    let failure = preview(
        &model,
        &[
            Operation::DropTable {
                table_id: "table_0".into(),
            },
            Operation::RenameTable {
                table_id: "table_0".into(),
                new_name: "missing".into(),
            },
        ],
    )
    .unwrap_err();
    assert_eq!(failure.step_index, Some(1));
    assert_eq!(model, original);
}
