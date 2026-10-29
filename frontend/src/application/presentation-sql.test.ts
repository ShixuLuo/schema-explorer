import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  compilePlan,
  schemaStatements,
  sqlScript,
  instantiateSql,
} from "../adapters/postgres-compiler.ts";
import { translateCommand } from "../model/database-commands.ts";
import { referenceId } from "../model/database-presentation.ts";
import type { SchemaSpec, Operation, TableSpec } from "../model/operations.ts";

function schema(names = ["a", "b", "c"]): SchemaSpec {
  const table = (id: string, name: string, columns: string[]): TableSpec => ({
    id,
    name,
    primaryKey: [id + "id"],
    columns: columns.map((c) => ({
      id: id + c,
      name: c,
      dataType: "integer",
      nullable: false,
    })),
  });
  return {
    tables: [
      table("A", names[0], ["id", "next", "direct"]),
      table("B", names[1], ["id", "next"]),
      table("C", names[2], ["id"]),
    ],
    foreign_keys: [
      {
        id: "f",
        name: "f",
        source_table: "A",
        source_columns: ["Anext"],
        target_table: "B",
        target_columns: ["Bid"],
      },
      {
        id: "g",
        name: "g",
        source_table: "B",
        source_columns: ["Bnext"],
        target_table: "C",
        target_columns: ["Cid"],
      },
      {
        id: "h",
        name: "h",
        source_table: "A",
        source_columns: ["Adirect"],
        target_table: "C",
        target_columns: ["Cid"],
      },
    ],
  };
}
const equation = {
  id: "commutes",
  left: { source: "A", arrows: [referenceId("h")] },
  right: { source: "A", arrows: [referenceId("f"), referenceId("g")] },
};
test("path-equation SQL validates and enforces source and intermediate updates", async () => {
  const base = schema(),
    op: Operation = { op: "add_equation", table_id: "A", equation },
    plan = compilePlan(base, [op]);
  assert.equal(plan.steps[0].abstract.edits.at(-1)?.kind, "add_equation");
  const db = new PGlite();
  try {
    await db.exec(schemaStatements(base).join("\n"));
    await db.exec(
      "INSERT INTO c VALUES(1),(2); INSERT INTO b VALUES(10,1); INSERT INTO a VALUES(100,10,1);",
    );
    await db.exec(sqlScript(plan.steps.flatMap((s) => s.statements)));
    await assert.rejects(
      db.exec("UPDATE b SET next=2 WHERE id=10"),
      /Path equation/,
    );
    await assert.rejects(
      db.exec("UPDATE a SET direct=2 WHERE id=100"),
      /Path equation/,
    );
    const renamed = compilePlan(plan.schema, [
      { op: "rename_table", table_id: "B", new_name: "renamed" },
    ]);
    await db.exec(sqlScript(renamed.steps.flatMap((s) => s.statements)));
    await assert.rejects(
      db.exec("UPDATE renamed SET next=2 WHERE id=10"),
      /Path equation/,
    );
    const drop = compilePlan(renamed.schema, [
      { op: "drop_equation", table_id: "A", equation_id: equation.id },
      { op: "drop_foreign_key", table_id: "A", foreign_key_id: "h" },
      { op: "drop_column", table_id: "A", column_id: "Adirect" },
    ]);
    await db.exec(sqlScript(drop.steps.flatMap((s) => s.statements)));
    await db.exec("UPDATE renamed SET next=2 WHERE id=10");
    assert.deepEqual((await db.query("SELECT * FROM a")).rows, [
      { id: 100, next: 10 },
    ]);
  } finally {
    await db.close();
  }
});
test("path-equation template rejects an invalid instance rather than repairing data", async () => {
  const base = schema(),
    db = new PGlite();
  try {
    await db.exec(schemaStatements(base).join("\n"));
    await db.exec(
      "INSERT INTO c VALUES(1),(2); INSERT INTO b VALUES(10,1); INSERT INTO a VALUES(100,10,2);",
    );
    const plan = compilePlan(base, [
      { op: "add_equation", table_id: "A", equation },
    ]);
    await assert.rejects(
      db.exec(sqlScript(plan.steps.flatMap((s) => s.statements))),
      /Path equation/,
    );
    await db.exec("ROLLBACK");
    assert.equal(
      (await db.query<{ direct: number }>("SELECT direct FROM a")).rows[0]
        .direct,
      2,
    );
  } finally {
    await db.close();
  }
});
test("the same abstract mapping accepts different database names and data", async () => {
  const simple = (name: string, column: string): SchemaSpec => ({
    tables: [
      {
        id: "S",
        name,
        primaryKey: [],
        columns: [
          { id: "value", name: column, dataType: "text", nullable: false },
        ],
      },
    ],
    foreign_keys: [],
  });
  const output: TableSpec = {
    id: "T",
    name: "result",
    primaryKey: [],
    columns: [{ id: "copy", name: "copy", dataType: "text", nullable: false }],
  };
  const base = simple("first", "value"),
    op: Operation = {
      op: "copy_table",
      table_id: "S",
      column_ids: ["value"],
      table: output,
    };
  const change = translateCommand(base, op);
  for (const [name, column, data] of [
    ["first", "value", "one"],
    ["another source", "another field", "two"],
  ]) {
    const binding = simple(name, column),
      db = new PGlite();
    try {
      await db.exec(schemaStatements(binding).join("\n"));
      await db.query(`INSERT INTO "${name}" VALUES($1)`, [data]);
      await db.exec(
        instantiateSql({
          ...change,
          before: binding,
          after: { tables: [...binding.tables, output], foreign_keys: [] },
        }).statements.join("\n"),
      );
      assert.deepEqual((await db.query("SELECT copy FROM result")).rows, [
        { copy: data },
      ]);
    } finally {
      await db.close();
    }
  }
});

test("deleting a bound field lowers equation and reference dependencies before the column", async () => {
  const base = schema(),
    constrained = compilePlan(base, [
      { op: "add_equation", table_id: "A", equation },
    ]).schema;
  const plan = compilePlan(constrained, [
    { op: "drop_column", table_id: "A", column_id: "Adirect" },
  ]);
  assert.equal(plan.schema.equations?.length, 0);
  assert.ok(!plan.schema.foreign_keys.some((a) => a.id === "h"));
  const db = new PGlite();
  try {
    await db.exec(schemaStatements(base).join("\n"));
    await db.exec(
      "INSERT INTO c VALUES(1); INSERT INTO b VALUES(10,1); INSERT INTO a VALUES(100,10,1);",
    );
    await db.exec(
      sqlScript(
        compilePlan(base, [
          { op: "add_equation", table_id: "A", equation },
        ]).steps.flatMap((s) => s.statements),
      ),
    );
    await db.exec(sqlScript(plan.steps.flatMap((s) => s.statements)));
    assert.deepEqual((await db.query("SELECT * FROM a")).rows, [
      { id: 100, next: 10 },
    ]);
  } finally {
    await db.close();
  }
});
