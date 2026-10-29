import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { createMemoryStore } from "../adapters/memory-store.ts";
import { createPostgresEngine } from "../adapters/postgres-engine.ts";
import {
  compilePlan,
  schemaStatements,
  sqlScript,
} from "../adapters/postgres-compiler.ts";
import { createUseCase } from "./workspaces.ts";
import { EditSession, createEditActions } from "./editor.ts";
import { exportSql } from "./export.ts";
import { databasePresentation } from "../model/database-presentation.ts";
import {
  restoreWorkspace,
  type WorkspaceRecord,
} from "../model/restore-workspace.ts";
import { categoryProjection } from "../diagram/category-graph.ts";
import type { TableSpec, Operation, SchemaSpec } from "../model/operations.ts";
import type { Table } from "../model/schema.ts";
const entity = (id: string, keyName = "_id"): TableSpec => ({
  id,
  name: id,
  columns: [
    {
      id: id + "key",
      name: keyName,
      dataType: "integer",
      nullable: false,
      generated: "identity",
    },
  ],
  primaryKey: [id + "key"],
});
test("an isolated object is created with its named identity for both Sigma and Pi", async () => {
  for (const method of ["sigma", "pi"] as const) {
    const store = createMemoryStore(),
      useCase = await createUseCase(store),
      engine = createPostgresEngine();
    const editor = new EditSession(
      useCase.id,
      createEditActions(store, engine),
      () => {},
    );
    try {
      const table = entity("Employee", method === "pi" ? "employee_id" : "_id");
      const summary = await editor.append([{ op: "create_table", table }]);
      assert.equal(summary.pendingParameters?.length, 1);
      await editor.chooseMethod(0, method);
      await editor.commit();
      const saved = await store.load(useCase.id),
        actual = saved.tables[0];
      assert.deepEqual(actual.primaryKey, table.primaryKey);
      assert.equal(actual.columns[0].name, table.columns[0].name);
      assert.deepEqual(
        await store.readRows(actual, 0),
        method === "pi" ? [["1"]] : [],
      );
      const schema = { tables: [table], foreign_keys: [] };
      const p = databasePresentation(schema);
      assert.deepEqual(p.arrows, []);
      assert.deepEqual(
        categoryProjection(p).objects.map((o) => o.id),
        ["Employee"],
      );
      const exported = await exportSql(store, engine, useCase.id, {
        from: null,
        to: saved.useCase.history.editing!,
      });
      const db = new PGlite();
      try {
        await db.exec(exported.migration!);
        assert.equal(
          (await db.query('SELECT * FROM "Employee"')).rows.length,
          method === "pi" ? 1 : 0,
        );
        await assert.rejects(
          db.exec(
            `INSERT INTO "Employee"("${table.columns[0].name}") VALUES (NULL);`,
          ),
          /not-null constraint/,
        );
      } finally {
        await db.close();
      }
    } finally {
      await store.close();
    }
  }
});
test("renaming an identity preserves its values, foreign-key targets, history and exported SQL", async () => {
  const store = createMemoryStore(),
    engine = createPostgresEngine(),
    useCase = await createUseCase(store);
  const employee = entity("Employee", "employee_id"),
    order = entity("Orders", "order_id");
  order.columns.push({
    id: "employeeRef",
    name: "employee_ref",
    dataType: "integer",
    nullable: false,
    storage: "reference",
  });
  const fk = {
    id: "employee",
    name: "employee",
    source_table: "Orders",
    source_columns: ["employeeRef"],
    target_table: "Employee",
    target_columns: ["Employeekey"],
  };
  const base: SchemaSpec = { tables: [employee, order], foreign_keys: [fk] },
    tables: Table[] = [];
  try {
    for (const spec of base.tables) {
      const t: Table = {
        ...spec,
        columns: spec.columns.map((c, index) => ({ ...c, index })),
        caseId: useCase.id,
        fileName: "",
        bytes: 0,
        rowCount: 0,
      };
      const writer = store.stage(t);
      await writer.append(
        spec.id === "Employee" ? [["11"], ["22"]] : [["1", "22"]],
      );
      tables.push(await writer.finish(t));
    }
    await store.commit(useCase.id, 0, {
      kind: "checkpoint",
      description: "Seed",
      operations: [],
      state: { tables, relationships: [fk] },
    });
    const before = await store.snapshot(useCase.id),
      from = before.useCase.history.editing!;
    await store.updateTags(useCase.id, {
      kind: "add",
      checkpointId: from,
      tag: "Live",
    });
    const op: Operation = {
      op: "rename_column",
      table_id: "Employee",
      column_id: "Employeekey",
      new_name: "person_id",
      method: "delta",
    };
    const editor = new EditSession(
      useCase.id,
      createEditActions(store, engine),
      () => {},
    );
    await editor.append([op]);
    await editor.commit();
    const after = await store.load(useCase.id),
      key = after.tables[0];
    assert.equal(key.columns[0].name, "person_id");
    assert.equal(key.dataId, tables[0].dataId);
    assert.deepEqual(await store.readRows(key, 0), [["11"], ["22"]]);
    assert.deepEqual(after.useCase.relationships, [fk]);
    assert.deepEqual(after.useCase.history.checkpoints[0].tags, ["Live"]);
    assert.equal(before.tables[0].columns[0].name, "employee_id");
    const script = await exportSql(store, engine, useCase.id, {
      from,
      to: after.useCase.history.editing!,
    });
    assert.match(
      script.migration!,
      /RENAME COLUMN "employee_id" TO "person_id"/,
    );
    const db = new PGlite();
    try {
      await db.exec(schemaStatements(base).join("\n"));
      await db.exec(
        'INSERT INTO "Employee" VALUES(11),(22); INSERT INTO "Orders" VALUES(1,22);',
      );
      await db.exec(script.migration!);
      assert.deepEqual(
        (
          await db.query(
            'SELECT person_id FROM "Employee" JOIN "Orders" ON employee_ref=person_id',
          )
        ).rows,
        [{ person_id: 22 }],
      );
    } finally {
      await db.close();
    }
  } finally {
    await store.close();
  }
});
test("imported identity columns stay physical bindings and are not business attribute generators", () => {
  const table: TableSpec = {
    id: "Employee",
    name: "Employee",
    columns: [
      {
        id: "key",
        name: "staff_code",
        dataType: "text",
        nullable: false,
        storage: "identity",
      },
      { id: "name", name: "name", dataType: "text", nullable: false },
    ],
    primaryKey: ["key"],
  };
  const p = databasePresentation({ tables: [table], foreign_keys: [] });
  assert.deepEqual(
    p.arrows.map((a) => a.id),
    ["attribute:name"],
  );
  const program = compilePlan({ tables: [], foreign_keys: [] }, [
    { op: "create_table", table, method: "sigma" },
  ]);
  assert.match(
    sqlScript(program.steps.flatMap((s) => s.statements)),
    /PRIMARY KEY \("staff_code"\)/,
  );
});
test("v5 workspace upgrade preserves checkpoints and does not invent identities for old saved tables", () => {
  const old = {
    id: "old",
    name: "Old",
    modelVersion: 5,
    createdAt: 1,
    updatedAt: 2,
    revision: 3,
    tableIds: [],
    positions: {},
    relationships: [],
    history: { editing: null, checkpoints: [] },
  } as WorkspaceRecord;
  const current = restoreWorkspace(old);
  assert.equal(current.modelVersion, 6);
  assert.deepEqual(current.history, (old as { history: unknown }).history);
  assert.equal(current.revision, 3);
  assert.equal(old.modelVersion, 5);
});
