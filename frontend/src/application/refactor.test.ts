import { PGlite } from "@electric-sql/pglite";
import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { createIndexedDbStore } from "../adapters/indexeddb-store.ts";
import { createMemoryStore } from "../adapters/memory-store.ts";
import {
  compilePlan,
  schemaStatements,
  sqlScript,
} from "../adapters/postgres-compiler.ts";
import { createPostgresEngine } from "../adapters/postgres-engine.ts";
import { planCommands } from "../model/database-commands.ts";
import { failureInfo } from "../model/failure.ts";
import { migrationOptions } from "../model/migration-options.ts";
import type { ColumnSpec, Operation, SchemaSpec } from "../model/operations.ts";
import { loadedWorkspace } from "../model/restore-workspace.ts";
import type { CellValue, Table } from "../model/schema.ts";
import { schemaSpec } from "../model/wire.ts";
import { planSteps } from "../schema/migration-plan.ts";
import { prepareEdit } from "./edit.ts";
import { EditSession, createEditActions } from "./editor.ts";
import { exportSql } from "./export.ts";
import { prepareAction } from "./preview.ts";
import { replaceArrowOperations } from "./replace-arrow.ts";
import { applyEdit, createUseCase } from "./workspaces.ts";
const col = (id: string, generated = false, storage = false): ColumnSpec => ({
  id,
  name: id,
  dataType: "integer",
  nullable: false,
  ...(generated ? { generated: "identity" as const } : {}),
  ...(storage ? { storage: "reference" as const } : {}),
});
const base: SchemaSpec = {
  tables: [
    { id: "A", name: "A", columns: [col("value")], primaryKey: [] },
    {
      id: "B",
      name: "B",
      columns: [col("bid", true), col("c", false, true)],
      primaryKey: ["bid"],
    },
    { id: "C", name: "C", columns: [col("cid", true)], primaryKey: ["cid"] },
  ],
  foreign_keys: [
    {
      id: "g",
      source_table: "B",
      source_columns: ["c"],
      target_table: "C",
      target_columns: ["cid"],
    },
  ],
};
const add: Operation = {
  op: "add_reference",
  table_id: "A",
  columns: [col("b")],
  foreign_key: {
    id: "f",
    source_table: "A",
    source_columns: ["b"],
    target_table: "B",
    target_columns: ["bid"],
  },
  method: "sigma",
};
for (const [name, storeFactory] of Object.entries({
  memory: createMemoryStore,
  indexeddb: () =>
    createIndexedDbStore({
      factory: new IDBFactory(),
      name: crypto.randomUUID(),
    }),
})) {
  test(`${name}: downstream Sigma writes survive Commit, reopen and export`, async () => {
    const store = storeFactory(),
      engine = createPostgresEngine(),
      useCase = await createUseCase(store),
      tables: Table[] = [];
    const data: Record<string, CellValue[][]> = {
      A: [["10"], ["20"]],
      B: [["1", "1"]],
      C: [["1"]],
    };
    try {
      for (const spec of base.tables) {
        const table: Table = {
          ...spec,
          caseId: useCase.id,
          fileName: "",
          bytes: 0,
          rowCount: 0,
          columns: spec.columns.map((c, index) => ({ ...c, index })),
        };
        const writer = store.stage(table);
        await writer.append(data[table.id]);
        tables.push(await writer.finish(table));
      }
      await store.commit(useCase.id, 0, {
        kind: "checkpoint",
        description: "Seed",
        operations: [],
        state: { tables, relationships: structuredClone(base.foreign_keys) },
      });
      const start = (await store.snapshot(useCase.id)).useCase.history.editing!;
      const preview = await prepareEdit(
        store,
        engine,
        useCase.id,
        [add],
        () => {},
      );
      assert.ok(preview.changedData.includes("C"));
      assert.deepEqual(Object.keys(preview.before.useCase).sort(), [
        "equations",
        "id",
        "relationships",
        "revision",
      ]);
      assert.equal(preview.tables.find((t) => t.id === "C")!.rowCount, 3);
      await applyEdit(store, preview);
      const reopened = await store.load(useCase.id);
      const b = await store.readRows(
          reopened.tables.find((t) => t.id === "B")!,
          0,
        ),
        c = await store.readRows(
          reopened.tables.find((t) => t.id === "C")!,
          0,
        );
      assert.equal(c.length, 3);
      assert.ok(b.every((row) => c.some((other) => other[0] === row[1])));
      const exported = await exportSql(store, engine, useCase.id, {
        from: start,
        to: reopened.useCase.history.editing!,
      });
      const db = new PGlite();
      try {
        await db.exec(schemaStatements(base).join("\n"));
        await db.exec(
          'INSERT INTO "C"(cid) VALUES(1);INSERT INTO "B"(bid,c) VALUES(1,1);INSERT INTO "A" VALUES(10),(20);',
        );
        await db.exec(exported.migration!);
        assert.equal((await db.query('SELECT * FROM "C"')).rows.length, 3);
        const refs = (
          await db.query<{ c: number }>('SELECT c FROM "B" ORDER BY bid')
        ).rows.map((row) => String(row.c));
        assert.deepEqual(
          refs,
          b.map((row) => row[1]),
        );
      } finally {
        await db.close();
      }
      // The retained base data and checkpoint stay readable after publication.
      assert.deepEqual(await store.readRows(tables[2], 0), [["1"]]);
    } finally {
      await store.close();
    }
  });
}
test("identity allocation never lowers an existing sequence, and exported programs accept different valid datasets", async () => {
  for (const input of [[], [7, 40]]) {
    const db = new PGlite();
    try {
      await db.exec(schemaStatements(base).join("\n"));
      for (const id of input) {
        await db.query('INSERT INTO "C"(cid) VALUES($1)', [id]);
        await db.query('INSERT INTO "B"(bid,c) VALUES($1,$1)', [id]);
      }
      await db.exec(
        `SELECT setval(pg_get_serial_sequence('"B"','bid'),100,true);INSERT INTO "A" VALUES(1);`,
      );
      await db.exec(
        sqlScript(compilePlan(base, [add]).steps.flatMap((s) => s.statements)),
      );
      assert.equal(
        (await db.query<{ b: number }>('SELECT b FROM "A"')).rows[0].b,
        101,
      );
      assert.equal(
        (await db.query('SELECT * FROM "C"')).rows.length,
        input.length + 1,
      );
    } finally {
      await db.close();
    }
  }
});
const viewTables: Table[] = [
  {
    id: "A",
    name: "A",
    caseId: "x",
    fileName: "",
    bytes: 0,
    rowCount: 1,
    columns: ["f", "g", "next"].map((id, index) => ({ ...col(id), index })),
  },
  {
    id: "B",
    name: "B",
    caseId: "x",
    fileName: "",
    bytes: 0,
    rowCount: 1,
    columns: ["id", "code"].map((id, index) => ({ ...col(id), index })),
    primaryKey: ["id"],
    uniqueKeys: [["code"]],
  },
];
const references = ["f", "g"].map((id) => ({
  id,
  name: id,
  source_table: "A",
  source_columns: [id],
  target_table: "B",
  target_columns: ["id"],
}));
const equations = [
  {
    id: "e",
    left: { source: "A", arrows: ["reference:f"] },
    right: { source: "A", arrows: ["reference:g"] },
  },
];
test("changing only a reference source binding produces an edit", () => {
  const result = replaceArrowOperations(
    schemaSpec(viewTables, references, equations),
    "reference:f",
    "A",
    "B",
    "f",
    { targetColumns: ["id"], sourceColumns: ["g"] },
  );
  assert.ok(
    result.operations.some(
      (op) =>
        op.op === "add_foreign_key" && op.foreign_key.source_columns[0] === "g",
    ),
  );
});
test("compound edits expose every pending migration, and a reverse path remains Delta in explanations", async () => {
  const store = createMemoryStore(),
    useCase = await createUseCase(store),
    tables = viewTables.map((t) => ({
      ...t,
      caseId: useCase.id,
      dataStatus: "unverified" as const,
    }));
  await store.commit(useCase.id, 0, {
    kind: "checkpoint",
    description: "Schema",
    operations: [],
    state: { tables, relationships: references, equations },
  });
  const editor = new EditSession(
    useCase.id,
    createEditActions(store, createPostgresEngine()),
    () => {},
  );
  const replaced = replaceArrowOperations(
    schemaSpec(tables, references, equations),
    "reference:f",
    "A",
    "B",
    "f",
    { targetColumns: ["code"], sourceColumns: ["next"], method: "pi" },
  );
  const summary = await editor.append(replaced.operations, true, "Edit arrow");
  for (const pending of summary.pendingParameters ?? [])
    assert.ok(
      planSteps(summary).some((s) => s.operationIndex === pending.index),
    );
  for (const pending of summary.pendingParameters ?? [])
    await editor.chooseMethod(pending.index, "pi", true);
  await editor.commit();
  const schema = schemaSpec(tables, references, equations),
    ops: Operation[] = [
      { op: "drop_foreign_key", table_id: "A", foreign_key_id: "f" },
      {
        op: "add_reference",
        table_id: "A",
        columns: [col("f2")],
        foreign_key: {
          id: "f2",
          source_table: "A",
          source_columns: ["f2"],
          target_table: "B",
          target_columns: ["id"],
        },
        method: "delta",
        image: { source: "A", arrows: ["reference:g"] },
      },
    ];
  const steps = planCommands(schema, ops).map((c, i) =>
    prepareAction(c, ops[i], i),
  );
  const action = planSteps({
    operations: ops,
    steps,
    plan: [{ start: 0, count: 2 }],
  })[0];
  assert.equal(action.selected, "delta");
  assert.ok(!action.migration.includes("Π"));
  assert.match(action.explanation, /existing path/);
});
test("old operation field names remain exportable after loading without changing checkpoint identities or data references", () => {
  const record = {
    id: "x",
    name: "x",
    createdAt: 0,
    updatedAt: 0,
    tableIds: [],
    positions: {},
    relationships: [],
    modelVersion: 6 as const,
    history: {
      editing: "p",
      checkpoints: [
        {
          id: "p",
          name: "p",
          createdAt: 0,
          tags: ["Live"],
          state: { tables: [], relationships: [], positions: {} },
          operations: [
            {
              op: "create_table",
              table: {
                id: "T",
                name: "T",
                columns: [
                  { id: "v", name: "v", data_type: "integer", nullable: false },
                ],
                primary_key: [],
              },
            },
          ],
        },
      ],
    },
  };
  const normalized = loadedWorkspace(record as never);
  const op = normalized.history.checkpoints[0].operations![0];
  assert.equal(normalized.history.editing, "p");
  assert.deepEqual(normalized.history.checkpoints[0].tags, ["Live"]);
  assert.doesNotThrow(() =>
    compilePlan({ tables: [], foreign_keys: [] }, [op]),
  );
  assert.ok(
    "data_type" in record.history.checkpoints[0].operations[0].table.columns[0],
  );
});

test("support decisions and compilation agree on shared quotient carriers and failure kinds", () => {
  const schema = schemaSpec(viewTables, references, equations);
  schema.foreign_keys[1].source_columns = [
    ...schema.foreign_keys[0].source_columns,
  ];
  const operation: Operation = {
    op: "add_equation",
    table_id: "A",
    equation: {
      id: "new-relation",
      left: equations[0].left,
      right: equations[0].right,
    },
    method: "sigma",
  };
  const sigma = migrationOptions(schema, operation).find(
    (o) => o.method === "sigma",
  )!;
  assert.equal(sigma.enabled, false);
  assert.equal(sigma.failure, "binding");
  assert.throws(
    () => compilePlan(schema, [operation]),
    (error) => failureInfo(error).kind === "binding",
  );
  const scalar: Operation = {
    op: "add_attribute",
    table_id: "A",
    column: {
      id: "new-value",
      name: "new-value",
      dataType: "text",
      nullable: false,
    },
    parameters: { template: "extension", method: "sigma" },
  };
  assert.equal(
    migrationOptions(schema, scalar).find((o) => o.method === "sigma")!.failure,
    "typeside",
  );
});
