import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryStore } from "../adapters/memory-store.ts";
import {
  compilePlan,
  schemaStatements,
  sqlScript,
} from "../adapters/postgres-compiler.ts";
import { createPostgresEngine } from "../adapters/postgres-engine.ts";
import type { ViewTable } from "../model/comparison.ts";
import { databasePresentation } from "../model/database-presentation.ts";
import type { SchemaSpec, TableSpec } from "../model/operations.ts";
import { recordedOperation } from "../model/operations.ts";
import { checkedMapping, identityMapping } from "../model/presentation.ts";
import { schemaSpec } from "../model/wire.ts";
import { createEditActions, EditSession } from "./editor.ts";
import { createUseCase, publishImport } from "./workspaces.ts";
const c = (
  id: string,
  name: string,
  type: "text" | "integer" = "text",
  nullable = false,
) => ({ id, name, dataType: type, nullable });
const view = (t: TableSpec, n: number): ViewTable => ({
  id: t.id,
  name: t.name,
  rowCount: n,
  primaryKey: t.primaryKey,
  columns: t.columns.map((c, index) => ({
    id: c.id,
    name: c.name,
    index,
    dataType: c.dataType,
    nullable: c.nullable,
    generated: c.generated,
  })),
});
const base = (): SchemaSpec => ({
  tables: [
    {
      id: "E",
      name: "entries",
      columns: [c("eid", "id", "integer"), c("person", "person_code")],
      primaryKey: ["eid"],
    },
    {
      id: "P",
      name: "people",
      columns: [c("code", "code"), c("age", "age", "integer")],
      primaryKey: [],
    },
  ],
  foreign_keys: [],
});
// Literal form of saved operations from the retired matching workflow.
// New UI actions cannot generate these; history replay remains supported.
function legacyOperations(
  schema: SchemaSpec,
): import("../model/operations.ts").Operation[] {
  if (schema.tables[1].primaryKey.length)
    return [
      {
        op: "add_foreign_key",
        table_id: "E",
        foreign_key: {
          id: "legacy-f",
          source_table: "E",
          source_columns: ["person"],
          target_table: "P",
          target_columns: ["code"],
        },
      },
    ];
  return [
    {
      op: "ensure_identity",
      table_id: "P",
      column_id: "legacy-id",
      column_name: "_row_id",
    },
    {
      op: "add_column",
      table_id: "E",
      column: {
        id: "legacy-carrier",
        name: "people_id",
        dataType: "integer",
        nullable: true,
      },
      value: { type: "null" },
    },
    {
      op: "populate_reference",
      table_id: "E",
      target_table: "P",
      source_columns: ["legacy-carrier"],
      target_columns: ["legacy-id"],
      match_source: ["person"],
      match_target: ["code"],
    },
    {
      op: "add_foreign_key",
      table_id: "E",
      foreign_key: {
        id: "legacy-f",
        source_table: "E",
        source_columns: ["legacy-carrier"],
        target_table: "P",
        target_columns: ["legacy-id"],
        lookup: { source_columns: ["person"], target_columns: ["code"] },
      },
    },
  ].map(recordedOperation);
}
async function populated() {
  const db = new PGlite(),
    schema = base();
  await db.exec(schemaStatements(schema).join("\n"));
  await db.exec(
    "INSERT INTO entries VALUES(1,'A'),(2,'B'); INSERT INTO people VALUES('A',30),('B',30);",
  );
  return { db, schema };
}
test("legacy replay preserves established references without reinstating automatic match rules", async () => {
  const { db, schema } = await populated();
  try {
    const operations = legacyOperations(schema),
      plan = compilePlan(schema, operations);
    await db.exec(sqlScript(plan.steps.flatMap((s) => s.statements)));
    assert.deepEqual(
      (
        await db.query(
          "SELECT e.id,p.code,p.age FROM entries e JOIN people p ON e.people_id=p._row_id ORDER BY e.id",
        )
      ).rows,
      [
        { id: 1, code: "A", age: 30 },
        { id: 2, code: "B", age: 30 },
      ],
    );
    assert.notDeepEqual(plan.schema.tables[1].primaryKey, ["age"]);
    await db.exec("INSERT INTO people(code,age) VALUES('C',30)");
    await db.exec("UPDATE entries SET person_code='C' WHERE id=1");
    assert.equal(
      (
        await db.query<{ people_id: number }>(
          "SELECT people_id FROM entries WHERE id=1",
        )
      ).rows[0].people_id,
      1,
    );
    assert.equal(databasePresentation(plan.schema).equations.length, 0);
  } finally {
    await db.close();
  }
});
test("missing or ambiguous lookup values roll back atomically without weakening totality", async () => {
  for (const bad of [
    "UPDATE entries SET person_code='missing' WHERE id=1",
    "INSERT INTO people VALUES('A',44)",
  ]) {
    const { db, schema } = await populated();
    try {
      await db.exec(bad);
      const plan = compilePlan(schema, legacyOperations(schema));
      await assert.rejects(
        db.exec(sqlScript(plan.steps.flatMap((s) => s.statements))),
        /exactly one/,
      );
      await db.exec("ROLLBACK");
      assert.deepEqual(
        (
          await db.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name='people' ORDER BY ordinal_position",
          )
        ).rows,
        [{ column_name: "code" }, { column_name: "age" }],
      );
    } finally {
      await db.close();
    }
  }
});
test("explicit existing primary-key binding reuses source values rather than creating a NULL column", async () => {
  const schema = base();
  schema.tables[1].primaryKey = ["code"];
  const db = new PGlite();
  try {
    await db.exec(schemaStatements(schema).join("\n"));
    await db.exec(
      "INSERT INTO entries VALUES(1,'A'),(2,'B'); INSERT INTO people VALUES('A',30),('B',30)",
    );
    const ops = legacyOperations(schema);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].op, "add_foreign_key");
    await db.exec(
      sqlScript(compilePlan(schema, ops).steps.flatMap((s) => s.statements)),
    );
    await assert.rejects(
      db.exec("INSERT INTO entries VALUES(3,NULL)"),
      /not-null/,
    );
  } finally {
    await db.close();
  }
});
test("fixed scalar typeside is preserved and declares SQL NULL explicitly", () => {
  const schema = base(),
    p = databasePresentation(schema);
  assert.equal(
    p.typeside?.sorts.every((s) => s.nullable),
    true,
  );
  assert.doesNotThrow(() => identityMapping(p));
  const swapped = identityMapping(p);
  swapped.objects["type:text"] = "type:integer";
  swapped.objects["type:integer"] = "type:text";
  assert.throws(
    () => checkedMapping(swapped),
    /identity on the fixed typeside/,
  );
});
test("internal identity and lookup interpretation survive Commit, reopening, and another preview", async () => {
  const store = createMemoryStore(),
    useCase = await createUseCase(store),
    schema = base();
  const before = await store.snapshot(useCase.id),
    tables = [];
  for (const [i, t] of schema.tables.entries()) {
    const metadata = {
      ...view(t, 2),
      caseId: useCase.id,
      fileName: "",
      bytes: 0,
    };
    const writer = store.stage(metadata);
    await writer.append(
      i === 0
        ? [
            ["1", "A"],
            ["2", "B"],
          ]
        : [
            ["A", "30"],
            ["B", "30"],
          ],
    );
    tables.push(await writer.finish(metadata));
  }
  await publishImport(store, before, tables);
  const engine = createPostgresEngine(),
    session = new EditSession(
      useCase.id,
      createEditActions(store, engine),
      () => {},
    );
  try {
    const operations = legacyOperations(schema);
    for (const op of operations) {
      if (op.op === "add_column") op.column.storage = "reference";
      if (op.op === "add_foreign_key") {
        op.method = "pi";
      }
    }
    await session.append(operations);
    await session.commit();
    const reopened = await store.snapshot(useCase.id),
      bound = schemaSpec(
        reopened.tables,
        reopened.useCase.relationships,
        reopened.useCase.equations,
      );
    assert.equal(
      bound.tables[1].columns.find((c) => c.generated === "identity")?.name,
      "_row_id",
    );
    assert.equal("lookup" in bound.foreign_keys[0], false);
    const next = new EditSession(
      useCase.id,
      createEditActions(store, engine),
      () => {},
    );
    try {
      await next.append([
        {
          op: "rename_table",
          table_id: "P",
          new_name: "persons",
          method: "delta",
        },
      ]);
      await next.commit();
    } finally {
      next.dispose();
    }
  } finally {
    session.dispose();
  }
});
