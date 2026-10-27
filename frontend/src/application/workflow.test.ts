import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { createMemoryStore } from "../adapters/memory-store.ts";
import { createIndexedDbStore } from "../adapters/indexeddb-store.ts";
import { createRustHttpEngine } from "../adapters/rust-http.ts";
import { ColumnProfiler } from "../model/profile.ts";
import type { Table, CellValue } from "../model/schema.ts";
import type { Operation } from "../model/operations.ts";
import type { WorkspaceStore } from "./ports.ts";
import {
  createUseCase,
  publishImport,
  applyEdit,
  undoEdit,
} from "./workspaces.ts";
import { prepareEdit } from "./edit.ts";
import { createEditActions, EditSession } from "./editor.ts";
import { exportSql } from "./export.ts";

assert.ok(process.env.SCHEMA_TEST_ORIGIN, "Run through npm run test:workflow.");
const engine = createRustHttpEngine(`${process.env.SCHEMA_TEST_ORIGIN}/api`),
  progress = () => {};
const factories = {
  memory: createMemoryStore,
  indexeddb: () =>
    createIndexedDbStore({
      factory: new IDBFactory(),
      name: `test-${crypto.randomUUID()}`,
    }),
};
function metadata(caseId: string, id: string, names: string[]): Table {
  return {
    id,
    caseId,
    name: id,
    fileName: "",
    bytes: 0,
    rowCount: 0,
    primaryKey: [],
    columns: names.map((name, index) => ({
      id: `${id}:${index}`,
      name,
      index,
      dataType: "text",
      nullable: false,
      emptyCount: 0,
      distinctCount: 0,
      integerFailures: 0,
      formatChanges: 0,
      nullCount: 0,
    })),
  };
}
async function all(store: WorkspaceStore, table: Table) {
  const result: CellValue[][] = [];
  for await (const batch of store.rows(table)) result.push(...batch.rows);
  return result;
}
async function seed(
  store: WorkspaceStore,
  options: { duplicate?: boolean; orphan?: boolean } = {},
) {
  const useCase = await createUseCase(store),
    before = await store.snapshot(useCase.id);
  const sources = [
    metadata(useCase.id, "records", ["id", "lookup_id", "raw"]),
    metadata(useCase.id, "lookup", ["id"]),
  ];
  const values: CellValue[][][] = [
    Array.from({ length: 235 }, (_, i) => [
      options.duplicate && i === 234 ? "R0" : `R${i}`,
      options.orphan && i === 234 ? "missing" : `K${i % 10}`,
      String(i + 1).padStart(3, "0"),
    ]),
    Array.from({ length: 10 }, (_, i) => [`K${i}`]),
  ];
  const tables: Table[] = [];
  for (let i = 0; i < sources.length; i++) {
    const table = sources[i],
      writer = store.stage(table),
      profile = new ColumnProfiler(table.columns);
    for (const row of values[i]) profile.add(row);
    profile.finish();
    await writer.append(values[i]);
    tables.push(await writer.finish(table));
  }
  await publishImport(store, before, tables, [], {
    checkedPairs: 0,
    limited: false,
  });
  return { id: useCase.id, tables };
}
const pk: Operation = {
  op: "add_primary_key",
  table_id: "lookup",
  column_ids: ["lookup:0"],
};
const fk: Operation = {
  op: "add_foreign_key",
  table_id: "records",
  foreign_key: {
    id: "fk",
    source_table: "records",
    source_columns: ["records:1"],
    target_table: "lookup",
    target_columns: ["lookup:0"],
  },
};
const extra: Operation = {
  op: "add_column",
  table_id: "records",
  column: { id: "big", name: "big", data_type: "integer", nullable: false },
  value: { type: "integer", value: "9223372036854775807" },
};

for (const [name, factory] of Object.entries(factories)) {
  test(`${name}: same editor migrates every batch, preserves layout, and restores Undo`, async (t) => {
    const store = factory();
    t.after(() => store.close());
    const { id } = await seed(store);
    const session = new EditSession(
      id,
      createEditActions(store, engine),
      progress,
    );
    const summary = await session.prepare([
      pk,
      fk,
      extra,
      {
        op: "rename_column",
        table_id: "records",
        column_id: "records:2",
        new_name: "code",
      },
    ]);
    assert.equal(summary.reports.length, 4);
    assert.ok(!("tables" in summary));
    assert.equal((await store.snapshot(id)).tables[0].columns.length, 3);
    await store.patchInfo(id, {
      name: "kept name",
      positions: { records: { x: 123, y: 456 } },
    });
    await session.apply();
    const saved = await store.snapshot(id),
      table = saved.tables.find((t) => t.id === "records")!;
    const rows = await all(store, table);
    assert.equal(rows.length, 235);
    assert.equal(rows[0][2], "001");
    assert.ok(rows.every((row) => row[3] === "9223372036854775807"));
    assert.equal(saved.useCase.name, "kept name");
    assert.deepEqual(saved.useCase.positions.records, { x: 123, y: 456 });
    assert.equal(saved.useCase.relationships.length, 1);
    assert.equal(saved.useCase.migration?.operations.length, 4);
    await undoEdit(store, id);
    const restored = await store.snapshot(id);
    assert.equal(restored.tables[0].columns.length, 3);
    assert.equal(restored.useCase.relationships.length, 0);
    assert.equal(restored.useCase.migration, undefined);
    assert.equal((await all(store, restored.tables[0]))[0][2], "001");
  });
  test(`${name}: discard releases draft data and cannot delete published data`, async (t) => {
    const store = factory();
    t.after(() => store.close());
    const { id } = await seed(store);
    const preview = await prepareEdit(store, engine, id, [extra], progress),
      draft = preview.tables.find((t) => t.id === "records")!;
    assert.equal((await all(store, draft)).length, 235);
    await store.discard(preview.tables);
    await assert.rejects(all(store, draft));
    const before = await store.snapshot(id);
    assert.equal((await all(store, before.tables[0])).length, 235);
    const next = await prepareEdit(store, engine, id, [extra], progress);
    await applyEdit(store, next);
    await store.discard(next.tables);
    assert.equal(
      (await all(store, (await store.snapshot(id)).tables[0]))[0][3],
      "9223372036854775807",
    );
  });
  test(`${name}: stale prepared changes cannot overwrite a newer model`, async (t) => {
    const store = factory();
    t.after(() => store.close());
    const { id } = await seed(store);
    const stale = await prepareEdit(store, engine, id, [extra], progress);
    const current = await prepareEdit(
      store,
      engine,
      id,
      [{ op: "rename_table", table_id: "records", new_name: "entries" }],
      progress,
    );
    await applyEdit(store, current);
    await assert.rejects(applyEdit(store, stale), /model changed/);
    await store.discard(stale.tables);
    const snapshot = await store.snapshot(id);
    assert.equal(snapshot.tables[0].name, "entries");
    assert.equal(snapshot.tables[0].columns.length, 3);
    assert.equal(snapshot.useCase.migration?.operations.length, 1);
  });
  test(`${name}: full validation detects duplicate keys across reader batches`, async (t) => {
    const store = factory();
    t.after(() => store.close());
    const { id } = await seed(store, { duplicate: true }),
      before = await store.snapshot(id);
    await assert.rejects(
      prepareEdit(
        store,
        engine,
        id,
        [
          {
            op: "add_primary_key",
            table_id: "records",
            column_ids: ["records:0"],
          },
        ],
        progress,
      ),
      /duplicate primary key at row 235/,
    );
    const after = await store.snapshot(id);
    assert.equal(after.useCase.revision, before.useCase.revision);
    assert.deepEqual(after.tables[0].primaryKey, []);
  });
  test(`${name}: foreign-key failure preserves the previously committed state`, async (t) => {
    const store = factory();
    t.after(() => store.close());
    const { id } = await seed(store, { orphan: true });
    await applyEdit(
      store,
      await prepareEdit(store, engine, id, [pk], progress),
    );
    const before = await store.snapshot(id);
    await assert.rejects(
      prepareEdit(store, engine, id, [fk], progress),
      /row 235/,
    );
    const after = await store.snapshot(id);
    assert.equal(after.useCase.revision, before.useCase.revision);
    assert.equal(after.useCase.relationships.length, 0);
    assert.equal(after.useCase.migration?.operations.length, 1);
  });
  test(`${name}: failed validation cleans up a finished draft`, async (t) => {
    const store = factory();
    t.after(() => store.close());
    const { id } = await seed(store),
      drafts: Table[] = [];
    const tracked: WorkspaceStore = {
      ...store,
      stage(table) {
        const writer = store.stage(table);
        return {
          ...writer,
          async finish(metadata) {
            const result = await writer.finish(metadata);
            drafts.push(result);
            return result;
          },
        };
      },
    };
    const unavailable = {
      ...engine,
      async validate() {
        throw new Error("validation unavailable");
      },
    };
    await assert.rejects(
      prepareEdit(tracked, unavailable, id, [extra], progress),
      /validation unavailable/,
    );
    assert.equal(drafts.length, 1);
    await assert.rejects(all(store, drafts[0]));
    assert.equal((await store.snapshot(id)).tables[0].columns.length, 3);
  });
  test(`${name}: sealed writers and ownership keep data references safe`, async (t) => {
    const store = factory();
    t.after(() => store.close());
    const useCase = await createUseCase(store),
      table = metadata(useCase.id, "owned", ["value"]),
      writer = store.stage(table),
      input: CellValue[][] = [["001"]];
    await writer.append(input);
    input[0][0] = "changed";
    const finished = await writer.finish(table);
    await assert.rejects(writer.append([["x"]]), /closed/);
    assert.equal((await all(store, finished))[0][0], "001");
    await publishImport(
      store,
      await store.snapshot(useCase.id),
      [finished],
      [],
      { checkedPairs: 0, limited: false },
    );
    await writer.abort();
    assert.equal((await all(store, finished))[0][0], "001");
    const other = await createUseCase(store);
    await assert.rejects(
      store.commit(other.id, 0, {
        tables: [{ ...finished, caseId: other.id }],
        relationships: [],
        candidates: [],
        analysis: { checkedPairs: 0, limited: false },
      }),
      /another use case/,
    );
    assert.equal((await store.snapshot(other.id)).tables.length, 0);
    assert.equal((await all(store, finished))[0][0], "001");
  });
  test(`${name}: SQL export uses the same history and authoritative engine`, async (t) => {
    const store = factory();
    t.after(() => store.close());
    const { id } = await seed(store);
    await applyEdit(
      store,
      await prepareEdit(store, engine, id, [pk, fk, extra], progress),
    );
    const sql = await exportSql(store, engine, id);
    assert.ok(
      sql.changes.includes('UPDATE "records" SET "big" = 9223372036854775807'),
    );
    assert.ok(sql.current.includes('REFERENCES "lookup" ("id")'));
    assert.ok(!sql.baseline.includes("FOREIGN KEY"));
    await undoEdit(store, id);
    assert.ok(
      !(await exportSql(store, engine, id)).changes.includes("ADD COLUMN"),
    );
  });
}
