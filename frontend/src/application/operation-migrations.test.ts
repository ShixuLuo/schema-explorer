import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  compilePlan,
  schemaStatements,
  sqlScript,
} from "../adapters/postgres-compiler.ts";
import { migrationOptions } from "../model/migration-options.ts";
import type { Operation, SchemaSpec, ColumnSpec } from "../model/operations.ts";
const col = (id: string, name = id, generated = false): ColumnSpec => ({
  id,
  name,
  dataType: "integer",
  nullable: false,
  ...(generated ? { generated: "identity" as const } : {}),
});
const base: SchemaSpec = {
  tables: [
    { id: "A", name: "A", columns: [col("value")], primaryKey: [] },
    {
      id: "B",
      name: "B",
      columns: [col("bid", "id", true)],
      primaryKey: ["bid"],
    },
  ],
  foreign_keys: [],
};
const newArrow = (method: "sigma" | "pi"): Operation => ({
  op: "add_reference",
  table_id: "A",
  columns: [col("target")],
  foreign_key: {
    id: "f",
    name: "target",
    source_table: "A",
    source_columns: ["target"],
    target_table: "B",
    target_columns: ["bid"],
  },
  method,
});
async function dbFor(
  schema: SchemaSpec,
  setup: string,
  run: (db: PGlite) => Promise<void>,
) {
  const db = new PGlite();
  try {
    await db.exec(schemaStatements(schema).join("\n"));
    await db.exec(setup);
    await run(db);
  } finally {
    await db.close();
  }
}
for (const method of ["sigma", "pi"] as const)
  test(`new arrow ${method}: SQL creates the correct finite extension`, async () => {
    await dbFor(
      base,
      'INSERT INTO "A" VALUES(10),(20); INSERT INTO "B" DEFAULT VALUES; INSERT INTO "B" DEFAULT VALUES;',
      async (db) => {
        const plan = compilePlan(base, [newArrow(method)]);
        assert.equal(plan.steps[0].abstract.migration.kind, method);
        await db.exec(sqlScript(plan.steps[0].statements));
        const a = (
            await db.query<{ value: number; target: number }>(
              'SELECT value,target FROM "A" ORDER BY value,target',
            )
          ).rows,
          b = (await db.query('SELECT * FROM "B"')).rows;
        if (method === "sigma") {
          assert.equal(a.length, 2);
          assert.equal(b.length, 4);
          assert.deepEqual(
            a.map((r) => r.target),
            [3, 4],
          );
        } else {
          assert.equal(a.length, 4);
          assert.equal(b.length, 2);
          assert.deepEqual(
            a.map((r) => [r.value, r.target]),
            [
              [10, 1],
              [10, 2],
              [20, 1],
              [20, 2],
            ],
          );
        }
      },
    );
  });
const keyed: SchemaSpec = {
  tables: [
    {
      id: "A",
      name: "A",
      columns: [col("aid", "id"), col("ref")],
      primaryKey: ["aid"],
    },
    { id: "B", name: "B", columns: [col("bid", "id")], primaryKey: ["bid"] },
    { id: "X", name: "X", columns: [col("parent")], primaryKey: [] },
  ],
  foreign_keys: [
    {
      id: "parent",
      source_table: "X",
      source_columns: ["parent"],
      target_table: "A",
      target_columns: ["aid"],
    },
  ],
};
const keyedArrow = (method: "sigma" | "pi"): Operation => ({
  op: "add_foreign_key",
  table_id: "A",
  foreign_key: {
    id: "f",
    source_table: "A",
    source_columns: ["ref"],
    target_table: "B",
    target_columns: ["bid"],
  },
  method,
});
test("key-bound Sigma completes missing target keys; Pi restricts transitively, without disabling final constraints", async () => {
  for (const method of ["sigma", "pi"] as const)
    await dbFor(
      keyed,
      'INSERT INTO "A" VALUES(1,100),(2,200); INSERT INTO "B" VALUES(100); INSERT INTO "X" VALUES(1),(2);',
      async (db) => {
        const plan = compilePlan(keyed, [keyedArrow(method)]);
        await db.exec(sqlScript(plan.steps[0].statements));
        assert.equal(
          (await db.query('SELECT * FROM "A"')).rows.length,
          method === "sigma" ? 2 : 1,
        );
        assert.equal(
          (await db.query('SELECT * FROM "X"')).rows.length,
          method === "sigma" ? 2 : 1,
        );
        assert.equal(
          (await db.query('SELECT * FROM "B"')).rows.length,
          method === "sigma" ? 2 : 1,
        );
        await assert.rejects(db.exec('INSERT INTO "X" VALUES(999);'));
      },
    );
});
test("Pi for a path equation removes violations and incoming dependencies, then enforces the new equation", async () => {
  const schema: SchemaSpec = {
    tables: [
      {
        id: "A",
        name: "A",
        columns: [col("aid", "id"), col("left"), col("right")],
        primaryKey: ["aid"],
      },
      { id: "X", name: "X", columns: [col("parent")], primaryKey: [] },
    ],
    foreign_keys: [keyed.foreign_keys[0]],
  };
  const op: Operation = {
    op: "add_equation",
    table_id: "A",
    method: "pi",
    equation: {
      id: "e",
      left: { source: "A", arrows: ["attribute:left"] },
      right: { source: "A", arrows: ["attribute:right"] },
    },
  };
  await dbFor(
    schema,
    'INSERT INTO "A" VALUES(1,10,10),(2,20,30);INSERT INTO "X" VALUES(1),(2);',
    async (db) => {
      const plan = compilePlan(schema, [op]);
      assert.equal(plan.steps[0].abstract.migration.kind, "pi");
      await db.exec(sqlScript(plan.steps[0].statements));
      assert.deepEqual((await db.query('SELECT id FROM "A"')).rows, [
        { id: 1 },
      ]);
      assert.deepEqual((await db.query('SELECT parent FROM "X"')).rows, [
        { parent: 1 },
      ]);
      await assert.rejects(
        db.exec('UPDATE "A" SET "right"=11;'),
        /Path equation/,
      );
    },
  );
});
test("fixed scalar addition is a Delta constant-term mapping, not a fake Sigma", async () => {
  const op: Operation = {
    op: "add_column",
    table_id: "A",
    column: { ...col("new"), nullable: true },
    value: { type: "null" },
  };
  const plan = compilePlan(base, [op]),
    migration = plan.steps[0].abstract.migration;
  assert.equal(migration.kind, "delta");
  if (migration.kind === "delta")
    assert.deepEqual(migration.mapping.arrows["attribute:new"].constant, {
      sort: "type:integer",
      value: null,
    });
  assert.deepEqual(
    migrationOptions(base, op)
      .filter((o) => o.enabled)
      .map((o) => o.method),
    ["delta"],
  );
  await dbFor(base, 'INSERT INTO "A" VALUES(10);', async (db) => {
    await db.exec(sqlScript(plan.steps[0].statements));
    assert.deepEqual((await db.query('SELECT value,"new" FROM "A"')).rows, [
      { value: 10, new: null },
    ]);
  });
});
test("unsupported migrations are rejected before SQL generation and cannot be forced", () => {
  const constrained = structuredClone(base);
  constrained.tables[0].primaryKey = ["value"];
  assert.equal(
    migrationOptions(constrained, newArrow("pi")).find(
      (o) => o.method === "pi",
    )!.enabled,
    false,
  );
  assert.throws(
    () => compilePlan(constrained, [newArrow("pi")]),
    /Π is unavailable/,
  );
  const relation: Operation = {
    op: "add_equation",
    table_id: "A",
    method: "sigma",
    equation: {
      id: "e",
      left: { source: "A", arrows: ["attribute:value"] },
      right: { source: "A", arrows: ["attribute:value"] },
    },
  };
  assert.equal(
    compilePlan(base, [relation]).steps[0].abstract.migration.kind,
    "sigma",
  );
});
test("Sigma completion advances internal identity allocation for a later free Sigma", async () => {
  const schema = structuredClone(keyed);
  schema.tables[1].columns[0].generated = "identity";
  await dbFor(
    schema,
    'INSERT INTO "A" VALUES(1,100),(2,200);INSERT INTO "B" VALUES(100);',
    async (db) => {
      const free: Operation = {
        op: "add_reference",
        table_id: "A",
        columns: [col("other")],
        foreign_key: {
          id: "g",
          source_table: "A",
          source_columns: ["other"],
          target_table: "B",
          target_columns: ["bid"],
        },
        method: "sigma",
      };
      const plan = compilePlan(schema, [keyedArrow("sigma"), free]);
      await db.exec(sqlScript(plan.steps.flatMap((s) => s.statements)));
      assert.deepEqual(
        (await db.query('SELECT other FROM "A" ORDER BY id')).rows,
        [{ other: 201 }, { other: 202 }],
      );
    },
  );
});
