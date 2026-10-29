import { PGlite } from "@electric-sql/pglite";
import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { createIndexedDbStore } from "../adapters/indexeddb-store.ts";
import { createMemoryStore } from "../adapters/memory-store.ts";
import { schemaStatements } from "../adapters/postgres-compiler.ts";
import { createPostgresEngine } from "../adapters/postgres-engine.ts";
import {
  loadedWorkspace,
  restoreWorkspace,
  storedTables,
  type WorkspaceRecord,
} from "../model/restore-workspace.ts";
import type { ForeignKeySpec, Table } from "../model/schema.ts";
import { schemaSpec } from "../model/wire.ts";
import { EditSession, createEditActions } from "./editor.ts";
import { exportSql } from "./export.ts";
import { createUseCase, publishImport } from "./workspaces.ts";
const table = (id: string, names: string[]): Table => ({
  id,
  caseId: "legacy-composite",
  name: id,
  fileName: "",
  bytes: 0,
  rowCount: 0,
  columns: names.map((name, index) => ({
    id: name,
    name,
    index,
    dataType: "text",
    nullable: false,
  })),
  primaryKey: id === "B" ? names : [],
});
const reference: ForeignKeySpec = {
  id: "belongs",
  name: "belongs",
  source_table: "A",
  source_columns: ["a2", "a1"],
  target_table: "B",
  target_columns: ["b2", "b1"],
};
const legacyReference = {
  id: "belongs",
  name: "belongs",
  source: { tableId: "A", columnId: "a2", columnIds: ["a2", "a1"] },
  target: { tableId: "B", columnId: "b2", columnIds: ["b2", "b1"] },
  enforced: true,
  matched: 37,
  checked: 41,
  sourceDistinct: 35,
  cardinality: "N:1" as const,
  lookup: { source_columns: ["a2", "a1"], target_columns: ["b2", "b1"] },
};
function fixture(tables: Table[]): WorkspaceRecord {
  return {
    id: "legacy-composite",
    name: "Old composite",
    modelVersion: 4,
    createdAt: 10,
    updatedAt: 20,
    revision: 7,
    tableIds: tables.map((t) => t.id),
    positions: { A: { x: 10, y: 20 } },
    relationships: [legacyReference],
    equations: [],
    undo: { checkpointId: "before", description: "Bind composite" },
    history: {
      editing: "bound",
      checkpoints: [
        {
          id: "before",
          name: "Import",
          createdAt: 11,
          parentId: null,
          tags: ["Live"],
          state: { tables, relationships: [], positions: {} },
          operations: tables.map((t) => ({
            op: "create_table",
            table: schemaSpec([t], []).tables[0],
          })),
        },
        {
          id: "bound",
          name: "Bind composite",
          createdAt: 12,
          parentId: "before",
          tags: ["Review"],
          state: {
            tables,
            relationships: [legacyReference],
            positions: { A: { x: 10, y: 20 } },
          },
          operations: [
            {
              op: "add_foreign_key",
              table_id: "A",
              foreign_key: { ...reference, lookup: legacyReference.lookup },
            } as never,
          ],
        },
      ],
    },
  };
}
test("v4 relation decoding preserves ordered composite bindings, checkpoint identity and immutable data references", () => {
  const tables = [
    { ...table("A", ["a1", "a2"]), dataId: "rows-A", rowCount: 2 },
    { ...table("B", ["b2", "b1"]), dataId: "rows-B", rowCount: 2 },
  ];
  const old = fixture(tables),
    saved = structuredClone(old),
    current = restoreWorkspace(old, tables);
  assert.equal(current.modelVersion, 6);
  assert.equal(current.revision, 7);
  assert.equal(current.history.editing, "bound");
  assert.equal(current.undo?.checkpointId, "before");
  assert.deepEqual(current.relationships, [reference]);
  assert.deepEqual(
    current.history.checkpoints.map((c) => [c.id, c.parentId, c.tags]),
    [
      ["before", null, ["Live"]],
      ["bound", "before", ["Review"]],
    ],
  );
  assert.deepEqual(current.history.checkpoints[1].state.relationships, [
    reference,
  ]);
  assert.deepEqual(
    current.history.checkpoints[1].state.tables.map((t) => t.dataId),
    ["rows-A", "rows-B"],
  );
  assert.ok(
    current.history.checkpoints[1].state.tables[0].columns.every(
      (c) => c.storage === "reference",
    ),
  );
  assert.ok(
    current.history.checkpoints[0].state.tables[0].columns.every(
      (c) => c.storage === undefined,
    ),
  );
  assert.deepEqual(
    storedTables(old).map((t) => t.dataId),
    ["rows-A", "rows-B", "rows-A", "rows-B"],
  );
  assert.deepEqual(old, saved);
  assert.deepEqual(restoreWorkspace(current), current);
  assert.throws(() => loadedWorkspace(old), /Load this use case/);
});
test("retired unaccepted suggestions never become live constraints during v4 decoding", () => {
  const old = fixture([table("A", ["a1", "a2"]), table("B", ["b2", "b1"])]);
  old.relationships.push({
    ...legacyReference,
    id: "suggested",
    enforced: false,
  } as never);
  const current = restoreWorkspace(old);
  assert.deepEqual(current.relationships, [reference]);
});
test("IndexedDB upgrade, SQL replay, restore and a new commit preserve old data and tags", async () => {
  const factory = new IDBFactory(),
    name = crypto.randomUUID(),
    store = createIndexedDbStore({ factory, name }),
    tables: Table[] = [];
  const input = {
    A: [
      ["x", "north"],
      ["y", "south"],
    ],
    B: [
      ["north", "x"],
      ["south", "y"],
    ],
  };
  for (const t of [table("A", ["a1", "a2"]), table("B", ["b2", "b1"])]) {
    const writer = store.stage(t);
    await writer.append(input[t.id as keyof typeof input]);
    tables.push(await writer.finish(t));
  }
  const raw = fixture(tables);
  await store.addCase(raw as never);
  const connection = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transaction = connection.transaction("tables", "readwrite");
  for (const t of tables) transaction.objectStore("tables").put(t);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  const engine = createPostgresEngine();
  try {
    const opened = await store.load(raw.id);
    assert.equal(opened.useCase.modelVersion, 6);
    assert.deepEqual(opened.useCase.relationships, [reference]);
    for (const t of opened.tables)
      assert.deepEqual(
        await store.readRows(t, 0),
        input[t.id as keyof typeof input],
      );
    const sql = await exportSql(store, engine, raw.id, {
      from: "before",
      to: "bound",
    });
    const db = new PGlite();
    try {
      await db.exec(schemaStatements(schemaSpec(tables, [])).join("\n"));
      for (const [id, rows] of Object.entries(input))
        for (const row of rows)
          await db.query(`INSERT INTO "${id}" VALUES ($1,$2)`, row);
      await db.exec(sql.migration!);
      assert.equal(
        (
          await db.query(
            'SELECT * FROM "A" JOIN "B" ON "a2"="b2" AND "a1"="b1"',
          )
        ).rows.length,
        2,
      );
      await assert.rejects(
        db.exec("INSERT INTO \"A\" VALUES('missing','north');"),
        /foreign key constraint/,
      );
    } finally {
      await db.close();
    }
    await store.updateTags(raw.id, {
      kind: "add",
      checkpointId: "before",
      tag: "Kept",
    });
    const session = new EditSession(
      raw.id,
      createEditActions(store, engine),
      () => {},
    );
    await session.append([
      {
        op: "rename_arrow",
        table_id: "A",
        arrow_id: "belongs",
        new_name: "parent",
        method: "delta",
      },
    ]);
    await session.commit();
    const reopened = await store.load(raw.id);
    assert.equal(reopened.useCase.relationships[0].name, "parent");
    assert.deepEqual(reopened.useCase.history.checkpoints[0].tags, [
      "Live",
      "Kept",
    ]);
    assert.deepEqual(
      reopened.useCase.history.checkpoints.slice(0, 2).map((c) => c.id),
      ["before", "bound"],
    );
    await store.commit(raw.id, reopened.useCase.revision!, {
      kind: "restore",
      checkpointId: "bound",
    });
    const restored = await store.load(raw.id);
    assert.deepEqual(restored.useCase.relationships, [reference]);
    assert.deepEqual(await store.readRows(restored.tables[0], 0), input.A);
    const read = connection
      .transaction("useCases")
      .objectStore("useCases")
      .get(raw.id);
    const persisted = await new Promise<WorkspaceRecord>((resolve, reject) => {
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
    });
    assert.equal(persisted.modelVersion, 6);
    assert.deepEqual(persisted.relationships, [reference]);
  } finally {
    connection.close();
    await store.close();
  }
});
test("preparing a draft does not read presentation samples; before and after are read on demand", async () => {
  const store = createMemoryStore(),
    useCase = await createUseCase(store),
    t = { ...table("A", ["value"]), caseId: useCase.id };
  try {
    const writer = store.stage(t);
    await writer.append([["Ada"], ["Lin"]]);
    const stored = await writer.finish(t);
    await publishImport(store, await store.snapshot(useCase.id), [stored]);
    const realRead = store.readRows;
    let readCount = 0;
    store.readRows = async (...args) => {
      readCount++;
      return realRead(...args);
    };
    const session = new EditSession(
      useCase.id,
      createEditActions(store, createPostgresEngine()),
      () => {},
    );
    const summary = await session.append([
      {
        op: "add_attribute",
        table_id: "A",
        column: { id: "copy", name: "copy", dataType: "text", nullable: false },
        parameters: { template: "copy", source_column: "value" },
      },
    ]);
    assert.equal(readCount, 0);
    assert.equal("samples" in summary, false);
    assert.equal("reports" in summary, false);
    assert.equal("removedRelationships" in summary, false);
    assert.deepEqual(summary.steps[0].migration, ["delta"]);
    assert.equal("explanation" in summary.steps[0], false);
    assert.deepEqual(await session.readRows("A", 0, 5, "before"), [
      ["Ada"],
      ["Lin"],
    ]);
    assert.deepEqual(await session.readRows("A", 0, 5, "after"), [
      ["Ada", "Ada"],
      ["Lin", "Lin"],
    ]);
    assert.equal(readCount, 2);
    await session.rollback();
    assert.deepEqual(await store.readRows(stored, 0), [["Ada"], ["Lin"]]);
  } finally {
    await store.close();
  }
});
