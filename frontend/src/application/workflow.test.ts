import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { createIndexedDbStore } from "../adapters/indexeddb-store.ts";
import { createMemoryStore } from "../adapters/memory-store.ts";
import { createPostgresEngine } from "../adapters/postgres-engine.ts";
import { liveCheckpointId } from "../model/history.ts";
import type { Operation } from "../model/operations.ts";
import type { WorkspaceRecord } from "../model/restore-workspace.ts";
import type { CellValue, Table } from "../model/schema.ts";
import { schemaSpec } from "../model/wire.ts";
import type { SavedWorkspace, UseCase } from "../model/workspace.ts";
import { prepareEdit } from "./edit.ts";
import { createEditActions, EditSession } from "./editor.ts";
import { exportSql } from "./export.ts";
import {
  compareCheckpoint,
  historyInfo,
  restoreCheckpoint,
} from "./history.ts";
import type { WorkspaceStore } from "./ports.ts";
import {
  applyEdit,
  createUseCase,
  publishImport,
  undoEdit,
} from "./workspaces.ts";

const engine = createPostgresEngine(),
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
      writer = store.stage(table);
    await writer.append(values[i]);
    tables.push(await writer.finish(table));
  }
  await publishImport(store, before, tables);
  return { id: useCase.id, tables };
}
async function currentCheckpoint(store: WorkspaceStore, id: string) {
  const checkpointId = (await store.snapshot(id)).useCase.history.editing;
  assert.ok(checkpointId);
  return checkpointId;
}
const addCheckpointTag = (
  store: WorkspaceStore,
  id: string,
  checkpointId: string,
  tag: string,
) => store.updateTags(id, { kind: "add", checkpointId, tag });
const removeCheckpointTag = (
  store: WorkspaceStore,
  id: string,
  checkpointId: string,
  tag: string,
) => store.updateTags(id, { kind: "remove", checkpointId, tag });
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
  column: { id: "big", name: "big", dataType: "integer", nullable: false },
  value: { type: "integer", value: "9223372036854775807" },
};

for (const [name, factory] of Object.entries(factories)) {
  test(`${name}: export keeps selected versions while refreshing concurrent tag labels`, async (t) => {
    const store = factory();
    t.after(() => store.close());
    const { id } = await seed(store),
      root = await currentCheckpoint(store, id);
    await applyEdit(
      store,
      await prepareEdit(store, engine, id, [extra], progress),
    );
    const target = await currentCheckpoint(store, id);
    await addCheckpointTag(store, id, root, "Live");
    const interleaved = {
      ...engine,
      async sql(...args: Parameters<typeof engine.sql>) {
        const result = await engine.sql(...args);
        await addCheckpointTag(store, id, root, "Export note");
        await addCheckpointTag(store, id, target, "Live");
        return result;
      },
    };
    const sql = await exportSql(store, interleaved, id);
    assert.deepEqual(sql.range, { from: root, to: target });
    assert.ok(sql.fromLabel.includes("Export note"));
    assert.ok(!sql.fromLabel.includes("Live"));
    assert.ok(sql.toLabel.includes("Live"));
    assert.ok(sql.migration!.includes(`-- From: ${sql.fromLabel}`));
    assert.ok(
      sql.migration!.includes(
        'ADD COLUMN "big" BIGINT DEFAULT 9223372036854775807',
      ),
    );
  });
  test(`${name}: tag additions, removals and Live moves preserve a validated multi-step draft`, async (t) => {
    const store = factory();
    t.after(() => store.close());
    const { id } = await seed(store),
      root = await currentCheckpoint(store, id);
    await addCheckpointTag(store, id, root, "Old label");
    await addCheckpointTag(store, id, root, "Live");
    const session = new EditSession(
      id,
      createEditActions(store, engine),
      progress,
    );
    await session.append([extra]);
    const before = await store.snapshot(id);
    await Promise.all([
      addCheckpointTag(store, id, root, "Review"),
      removeCheckpointTag(store, id, root, "Old label"),
    ]);
    await session.append([
      {
        method: "delta",
        op: "rename_column",
        table_id: "records",
        column_id: "big",
        new_name: "score",
      },
    ]);
    await removeCheckpointTag(store, id, root, "Live");
    await addCheckpointTag(store, id, root, "Release 1");
    const tagged = await store.snapshot(id);
    assert.equal(tagged.useCase.revision, before.useCase.revision);
    assert.deepEqual(tagged.tables, before.tables);
    assert.equal(
      tagged.useCase.history.editing,
      before.useCase.history.editing,
    );
    assert.deepEqual(
      new Set(tagged.useCase.history.checkpoints[0].tags),
      new Set(["Review", "Release 1"]),
    );
    await session.commit();
    const after = await store.snapshot(id);
    assert.equal(after.useCase.revision, before.useCase.revision! + 1);
    assert.equal(after.useCase.history.checkpoints.length, 2);
    assert.equal(after.useCase.history.checkpoints[1].parentId, root);
    assert.deepEqual(
      new Set(after.useCase.history.checkpoints[0].tags),
      new Set(["Review", "Release 1"]),
    );
    assert.equal(after.tables[0].columns[3].name, "score");
    assert.equal(
      (await all(store, after.tables[0]))[234][3],
      "9223372036854775807",
    );
    assert.ok(
      !after.useCase.history.checkpoints[0].tags!.includes("Old label"),
    );
    assert.equal(
      liveCheckpointId(after.useCase.history.checkpoints),
      undefined,
    );
    const sql = await exportSql(store, engine, id);
    assert.ok(sql.migration!.includes('RENAME COLUMN "big" TO "score"'));
  });
  test(`${name}: interleaved tags cannot overwrite Commit, restore, Undo or import`, async (t) => {
    const store = factory();
    t.after(() => store.close());
    const { id } = await seed(store),
      root = await currentCheckpoint(store, id);
    await applyEdit(
      store,
      await prepareEdit(store, engine, id, [extra], progress),
    );
    const second = await currentCheckpoint(store, id);
    await addCheckpointTag(store, id, root, "Live");
    const session = new EditSession(
      id,
      createEditActions(store, engine),
      progress,
    );
    await session.append([
      {
        method: "delta",
        op: "rename_table",
        table_id: "records",
        new_name: "entries",
      },
    ]);
    await addCheckpointTag(store, id, second, "Live");
    await Promise.all([
      session.commit(),
      addCheckpointTag(store, id, root, "Review"),
    ]);
    const third = await currentCheckpoint(store, id);
    assert.equal(
      liveCheckpointId((await store.snapshot(id)).useCase.history.checkpoints),
      second,
    );
    assert.equal((await store.snapshot(id)).tables[0].name, "entries");
    assert.ok(
      (await store.snapshot(id)).useCase.history.checkpoints[0].tags!.includes(
        "Review",
      ),
    );
    const interleaved: WorkspaceStore = {
      ...store,
      async commit(caseId, revision, publication) {
        await addCheckpointTag(
          store,
          id,
          root,
          publication.kind === "restore"
            ? "Restoring"
            : publication.kind === "undo"
              ? "Undoing"
              : "Importing",
        );
        await store.commit(caseId, revision, publication);
      },
    };
    await restoreCheckpoint(interleaved, id, root);
    assert.equal((await store.snapshot(id)).tables[0].columns.length, 3);
    await undoEdit(interleaved, id);
    assert.equal((await store.snapshot(id)).useCase.history.editing, third);
    assert.equal((await store.snapshot(id)).tables[0].name, "entries");
    const beforeImport = await store.snapshot(id),
      added = metadata(id, "new_table", ["value"]);
    await publishImport(interleaved, beforeImport, [added]);
    const latest = await store.snapshot(id);
    assert.equal(latest.tables.length, 3);
    assert.deepEqual(
      new Set(latest.useCase.history.checkpoints[0].tags),
      new Set(["Review", "Restoring", "Undoing", "Importing"]),
    );
    await addCheckpointTag(store, id, root, "Live");
    await Promise.all([
      addCheckpointTag(store, id, second, "Live"),
      addCheckpointTag(store, id, root, "Milestone"),
    ]);
    const moved = await store.snapshot(id);
    assert.equal(liveCheckpointId(moved.useCase.history.checkpoints), second);
    assert.ok(moved.useCase.history.checkpoints[0].tags!.includes("Milestone"));
    assert.equal(moved.useCase.history.checkpoints.length, 4);
    assert.deepEqual(moved.tables, latest.tables);
  });
  test(`${name}: Undo to an empty Editing position keeps the first checkpoint recoverable`, async (t) => {
    const store = factory();
    t.after(() => store.close());
    const useCase = await createUseCase(store);
    const operation: Operation = {
      method: "sigma",
      op: "create_table",
      table: {
        id: "empty",
        name: "empty",
        columns: [
          { id: "value", name: "value", dataType: "text", nullable: true },
        ],
        primaryKey: [],
      },
    };
    await applyEdit(
      store,
      await prepareEdit(store, engine, useCase.id, [operation], progress),
    );
    const point = await currentCheckpoint(store, useCase.id),
      saved = await store.snapshot(useCase.id);
    assert.ok(!("tables" in saved.useCase.undo!));
    assert.equal(saved.useCase.undo!.checkpointId, null);
    await undoEdit(store, useCase.id);
    const empty = await store.snapshot(useCase.id);
    assert.equal(empty.tables.length, 0);
    assert.equal(empty.useCase.history.editing, null);
    assert.equal(empty.useCase.history.checkpoints.length, 1);
    await store.deleteEmpty(useCase.id);
    assert.ok(await store.readCase(useCase.id));
    await restoreCheckpoint(store, useCase.id, point);
    const restored = await store.snapshot(useCase.id);
    assert.equal(restored.tables[0].name, "empty");
    assert.deepEqual(await all(store, restored.tables[0]), []);
    await undoEdit(store, useCase.id);
    assert.equal((await store.snapshot(useCase.id)).tables.length, 0);
  });
  test(`${name}: tags label checkpoints without creating routes or moving Editing`, async (t) => {
    const store = factory();
    t.after(() => store.close());
    const { id } = await seed(store),
      base = await currentCheckpoint(store, id);
    await addCheckpointTag(store, id, base, "live");
    await addCheckpointTag(store, id, base, "Milestone");
    const before = await store.snapshot(id);
    assert.equal(before.useCase.history.checkpoints.length, 1);
    assert.equal(before.useCase.history.editing, base);
    const info = historyInfo(before.useCase);
    info.checkpoints[0].tags!.push("display only");
    assert.ok(
      !(await store.snapshot(id)).useCase.history.checkpoints[0].tags!.includes(
        "display only",
      ),
    );
    await applyEdit(
      store,
      await prepareEdit(store, engine, id, [extra], progress),
    );
    const edited = await currentCheckpoint(store, id);
    assert.equal(
      liveCheckpointId((await store.snapshot(id)).useCase.history.checkpoints),
      base,
    );
    const sql = await exportSql(store, engine, id);
    assert.deepEqual(sql.range, { from: base, to: edited });
    assert.ok(!sql.fromLabel.includes("Main"));
    await addCheckpointTag(store, id, edited, "LIVE");
    const labelled = await store.snapshot(id);
    assert.equal(
      liveCheckpointId(labelled.useCase.history.checkpoints),
      edited,
    );
    assert.deepEqual(labelled.useCase.history.checkpoints[0].tags, [
      "Milestone",
    ]);
    await assert.rejects(
      addCheckpointTag(store, id, edited, "Editing"),
      /current position/,
    );
    await assert.rejects(
      addCheckpointTag(store, id, edited, "live"),
      /already has/,
    );
    await removeCheckpointTag(store, id, edited, "Live");
    assert.equal(
      liveCheckpointId((await store.snapshot(id)).useCase.history.checkpoints),
      undefined,
    );
    assert.equal(
      (await store.snapshot(id)).useCase.history.checkpoints.length,
      2,
    );
  });
  test(`${name}: continuing from a checkpoint naturally forks one history and exports exact paths`, async (t) => {
    const store = factory();
    t.after(() => store.close());
    const { id } = await seed(store),
      a = await currentCheckpoint(store, id);
    const session = new EditSession(
      id,
      createEditActions(store, engine),
      progress,
    );
    await session.append([extra]);
    await session.append([
      {
        method: "delta",
        op: "rename_column",
        table_id: "records",
        column_id: "big",
        new_name: "score",
      },
    ]);
    assert.equal(
      (await store.snapshot(id)).useCase.history.checkpoints.length,
      1,
    );
    await session.commit();
    const b = await currentCheckpoint(store, id),
      savedB = await store.snapshot(id);
    assert.equal(savedB.useCase.history.checkpoints[1].parentId, a);
    assert.equal(savedB.useCase.history.checkpoints[1].operations!.length, 2);
    assert.ok(!("legacyMigration" in savedB.useCase.history.checkpoints[1]));
    await restoreCheckpoint(store, id, a);
    assert.equal((await store.snapshot(id)).tables[0].columns.length, 3);
    await applyEdit(
      store,
      await prepareEdit(store, engine, id, [pk, fk], progress),
    );
    const c = await currentCheckpoint(store, id),
      savedC = await store.snapshot(id);
    assert.deepEqual(
      savedC.useCase.history.checkpoints.map((p) => p.parentId),
      [null, a, a],
    );
    assert.deepEqual((await all(store, savedB.tables[0]))[234], [
      "R234",
      "K4",
      "235",
      "9223372036854775807",
    ]);
    const unchanged = await store.snapshot(id);
    const comparison = await compareCheckpoint(store, id, b);
    assert.equal(comparison.comparison.before.tables[0].columns.length, 4);
    assert.equal(comparison.comparison.after.tables[0].columns.length, 3);
    assert.ok(!("dataId" in comparison.comparison.before.tables[0]));
    assert.deepEqual(comparison.range, { from: b, to: c });
    assert.deepEqual(await store.snapshot(id), unchanged);
    const sqlB = await exportSql(store, engine, id, { from: a, to: b });
    const sqlC = await exportSql(store, engine, id, { from: a, to: c });
    assert.ok(sqlB.migration!.includes('RENAME COLUMN "big" TO "score"'));
    assert.ok(!sqlB.migration!.includes("FOREIGN KEY"));
    assert.ok(sqlC.migration!.includes("FOREIGN KEY"));
    assert.ok(!sqlC.migration!.includes("score"));
    const cross = await exportSql(store, engine, id, { from: b, to: c });
    assert.equal(cross.migration, null);
    assert.match(cross.reason!, /No recorded forward migration/);
    assert.equal(cross.migration, null);
    assert.equal(
      (await exportSql(store, engine, id, { from: c, to: a })).migration,
      null,
    );
    await restoreCheckpoint(store, id, b);
    assert.deepEqual((await store.snapshot(id)).tables, savedB.tables);
    await undoEdit(store, id);
    assert.equal(await currentCheckpoint(store, id), c);
    assert.deepEqual((await store.snapshot(id)).tables, savedC.tables);
    await restoreCheckpoint(store, id, a);
    await applyEdit(
      store,
      await prepareEdit(
        store,
        engine,
        id,
        [
          {
            method: "delta",
            op: "rename_table",
            table_id: "records",
            new_name: "another_design",
          },
        ],
        progress,
      ),
    );
    const latest = await store.snapshot(id);
    assert.equal(latest.useCase.history.checkpoints.at(-1)!.parentId, a);
    assert.equal(latest.useCase.history.checkpoints.length, 4);
    assert.ok(!("exploration" in latest.useCase));
    assert.ok(!("migration" in latest.useCase));
    assert.ok(
      latest.useCase.history.checkpoints.every(
        (p) => !("branchId" in p) && !("branchName" in p),
      ),
    );
    await undoEdit(store, id);
    assert.equal(await currentCheckpoint(store, id), a);
    await session.append([extra]);
    await session.rollback();
    assert.equal(
      (await store.snapshot(id)).useCase.history.checkpoints.length,
      4,
    );
  });
  test(`${name}: restore and Undo preserve exact values, constraints and layout after reclamation`, async (t) => {
    const store = factory();
    t.after(() => store.close());
    const { id } = await seed(store);
    await store.patchInfo(id, {
      positions: { records: { x: 12, y: 34 } },
      viewport: { x: 20, y: 30, zoom: 0.7 },
    });
    await applyEdit(
      store,
      await prepareEdit(store, engine, id, [pk, fk, extra], progress),
    );
    const base = await store.snapshot(id),
      point = await currentCheckpoint(store, id);
    await applyEdit(
      store,
      await prepareEdit(
        store,
        engine,
        id,
        [
          { op: "drop_foreign_key", table_id: "records", foreign_key_id: "fk" },
          { op: "drop_table", table_id: "lookup" },
          { op: "drop_column", table_id: "records", column_id: "records:2" },
        ],
        progress,
      ),
    );
    await applyEdit(
      store,
      await prepareEdit(
        store,
        engine,
        id,
        [
          {
            method: "delta",
            op: "rename_table",
            table_id: "records",
            new_name: "entries",
          },
        ],
        progress,
      ),
    );
    await store.patchInfo(id, {
      positions: { records: { x: 999, y: 999 } },
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    const changed = await store.snapshot(id);
    await store.discard(base.tables);
    assert.equal((await all(store, base.tables[0]))[0][2], "001");
    await restoreCheckpoint(store, id, point);
    const restored = await store.snapshot(id);
    assert.deepEqual(restored.tables, base.tables);
    for (const field of ["relationships", "positions", "viewport"] as const)
      assert.deepEqual(restored.useCase[field], base.useCase[field]);
    assert.equal(
      (await all(store, restored.tables[0]))[234][3],
      "9223372036854775807",
    );
    await undoEdit(store, id);
    const undone = await store.snapshot(id);
    assert.deepEqual(undone.tables, changed.tables);
    assert.deepEqual(undone.useCase.positions, changed.useCase.positions);
    assert.equal(
      undone.useCase.history.editing,
      changed.useCase.history.editing,
    );
    assert.equal(undone.useCase.history.checkpoints.length, 4);
  });
  test(`${name}: navigation invalidates stale drafts and failed actions leave history unchanged`, async (t) => {
    const store = factory();
    t.after(() => store.close());
    const { id } = await seed(store),
      point = await currentCheckpoint(store, id);
    const session = new EditSession(
      id,
      createEditActions(store, engine),
      progress,
    );
    await session.append([extra]);
    await restoreCheckpoint(store, id, point);
    await assert.rejects(session.commit(), /model changed/);
    await session.rollback();
    const before = await store.snapshot(id);
    await assert.rejects(
      restoreCheckpoint(store, id, "missing"),
      /no longer exists/,
    );
    await assert.rejects(
      compareCheckpoint(store, id, "missing"),
      /no longer exists/,
    );
    await assert.rejects(
      addCheckpointTag(store, id, "missing", "Live"),
      /no longer exists/,
    );
    assert.deepEqual(await store.snapshot(id), before);
    assert.equal((await all(store, before.tables[0]))[0][2], "001");
  });
  test(`${name}: legacy parked states and Undo rows survive migration and cleanup`, async (t) => {
    const store = factory();
    t.after(() => store.close());
    const id = crypto.randomUUID(),
      make = async (variant: "original" | "saved" | "undo") => {
        const source = metadata(id, "records", ["id", "lookup_id", "raw"]);
        if (variant === "saved")
          source.columns.push({
            id: "big",
            name: "big",
            index: 3,
            dataType: "integer",
            nullable: false,
          });
        const rows = Array.from({ length: 235 }, (_, i) => [
          `R${i}`,
          `K${i % 10}`,
          variant === "undo" ? `U${i}` : String(i + 1).padStart(3, "0"),
          ...(variant === "saved" ? ["9223372036854775807"] : []),
        ]);
        const writer = store.stage(source);
        await writer.append(rows);
        return writer.finish(source);
      };
    const original = await make("original"),
      saved = await make("saved"),
      previous = await make("undo");
    const state = (table: Table): SavedWorkspace => ({
      tables: [table],
      relationships: [],

      positions: { records: { x: 12, y: 34 } },
    });
    const log = { base: schemaSpec([original], []), operations: [extra] };
    const legacy: WorkspaceRecord = {
      id,
      name: "Legacy",
      createdAt: 1,
      updatedAt: 2,
      tableIds: [],
      positions: {},
      relationships: [],

      revision: 0,
      modelVersion: 2,
      exploration: {
        active: { id: "main", name: "Main", createdAt: 1, headId: null },
        branches: [
          {
            id: "old",
            name: "Alternate design",
            createdAt: 1,
            headId: "original",
            state: { ...state(saved), migration: log },
            undo: {
              tables: [previous],
              relationships: [],

              description: "Previous values",
            },
          },
        ],
        checkpoints: [
          {
            id: "original",
            name: "Imported",
            createdAt: 1,
            parentId: null,
            operations: [
              {
                method: "sigma",
                op: "create_table",
                table: schemaSpec([original], []).tables[0],
              },
            ],
            state: state(original),
            branchId: "main",
            branchName: "Main",
          },
        ],
        liveId: "original",
      },
    };
    await store.addCase(legacy as unknown as UseCase);
    const listing = (await store.listCases()).find((c) => c.id === id)!;
    assert.ok(listing);
    assert.ok(!("history" in listing));
    assert.ok(!("exploration" in listing));
    await assert.rejects(store.snapshot(id), /Load this use case/);
    await assert.rejects(store.readCase(id), /Load this use case/);
    await assert.rejects(store.patchInfo(id, {}), /Load this use case/);
    await assert.rejects(
      addCheckpointTag(store, id, "original", "Review"),
      /Load this use case/,
    );
    // Reclamation must understand old records even before they are rewritten.
    await store.discard([original, saved, previous]);
    assert.equal((await all(store, previous))[0][2], "U0");
    const migrated = await store.load(id);
    await store.deleteEmpty(id);
    assert.ok(await store.readCase(id));
    assert.equal(migrated.useCase.modelVersion, 6);
    assert.equal(migrated.useCase.history.editing, null);
    assert.ok(!("exploration" in migrated.useCase));
    const points = migrated.useCase.history.checkpoints;
    assert.equal(points[0].id, "original");
    assert.equal(liveCheckpointId(points), "original");
    const retained = points.find((p) => p.tags?.includes("Alternate design"))!;
    assert.ok(retained);
    assert.equal(retained.parentId, undefined);
    assert.deepEqual(retained.legacyMigration, log);
    assert.equal(
      (await all(store, retained.state.tables[0]))[234][3],
      "9223372036854775807",
    );
    const undoPoint = points.find(
      (p) => p.state.tables[0]?.dataId === previous.dataId,
    )!;
    assert.ok(undoPoint);
    assert.equal((await all(store, undoPoint.state.tables[0]))[0][2], "U0");
    assert.ok(points.every((p) => !("branchId" in p) && !("branchName" in p)));
    await restoreCheckpoint(store, id, retained.id);
    await applyEdit(
      store,
      await prepareEdit(
        store,
        engine,
        id,
        [
          {
            method: "delta",
            op: "rename_column",
            table_id: "records",
            column_id: "records:2",
            new_name: "code",
          },
        ],
        progress,
      ),
    );
    const after = await store.snapshot(id),
      child = await currentCheckpoint(store, id);
    assert.equal(
      after.useCase.history.checkpoints.at(-1)!.parentId,
      retained.id,
    );
    const sql = await exportSql(store, engine, id, {
      from: retained.id,
      to: child,
    });
    assert.ok(sql.migration!.includes('RENAME COLUMN "raw" TO "code"'));
    await store.discard([original, saved, previous]);
    await restoreCheckpoint(store, id, undoPoint.id);
    assert.equal(
      (await all(store, (await store.snapshot(id)).tables[0]))[0][2],
      "U0",
    );
    await restoreCheckpoint(store, id, "original");
    assert.equal(
      (await all(store, (await store.snapshot(id)).tables[0]))[0][2],
      "001",
    );
  });
  test(`${name}: successive changes share one base, publish once, and Undo together`, async (t) => {
    const store = factory();
    t.after(() => store.close());
    const { id } = await seed(store),
      before = await store.snapshot(id);
    const session = new EditSession(
      id,
      createEditActions(store, engine),
      progress,
    );
    await session.append([extra]);
    await session.append([
      {
        method: "delta",
        op: "rename_column",
        table_id: "records",
        column_id: "big",
        new_name: "score",
      },
    ]);
    const summary = await session.append([pk, { ...fk, method: "pi" }]);
    assert.equal(summary.steps.length, 4);
    assert.equal(summary.comparison.before.tables[0].columns.length, 3);
    assert.equal(summary.comparison.after.tables[0].columns[3].name, "score");
    assert.equal(summary.comparison.after.relationships.length, 1);
    assert.equal(
      (await session.readRows("records", 234))[0][3],
      "9223372036854775807",
    );
    assert.deepEqual(await store.snapshot(id), before);
    await session.commit();
    const after = await store.snapshot(id);
    assert.equal(after.useCase.revision, before.useCase.revision! + 1);
    assert.equal(
      after.useCase.history.checkpoints.at(-1)!.operations!.length,
      4,
    );
    assert.equal(after.tables[0].columns[3].name, "score");
    assert.equal(
      after.useCase.undo?.checkpointId,
      before.useCase.history.editing,
    );
    const sql = await exportSql(store, engine, id);
    assert.ok(sql.migration!.includes('RENAME COLUMN "big" TO "score"'));
    await undoEdit(store, id);
    const restored = await store.snapshot(id);
    assert.deepEqual(restored.tables, before.tables);
    assert.deepEqual(
      restored.useCase.relationships,
      before.useCase.relationships,
    );
    assert.equal(
      restored.useCase.history.editing,
      before.useCase.history.editing,
    );
    assert.equal((await all(store, restored.tables[0]))[234][2], "235");
  });
  test(`${name}: failed append retains the valid draft; destructive rollback preserves committed data`, async (t) => {
    const store = factory();
    t.after(() => store.close());
    const { id } = await seed(store),
      before = await store.snapshot(id);
    const staged: Table[] = [];
    const tracked: WorkspaceStore = {
      ...store,
      stage(table) {
        const writer = store.stage(table);
        return {
          ...writer,
          async finish(metadata) {
            const result = await writer.finish(metadata);
            staged.push(result);
            return result;
          },
        };
      },
    };
    const session = new EditSession(
      id,
      createEditActions(tracked, engine),
      progress,
    );
    await session.append([extra]);
    await assert.rejects(session.append([fk]), /primary.*key/);
    assert.equal(
      (await session.readRows("records", 0))[0][3],
      "9223372036854775807",
    );
    const summary = await session.append([
      { op: "drop_column", table_id: "records", column_id: "records:2" },
      { op: "drop_table", table_id: "lookup" },
    ]);
    assert.equal(summary.steps.length, 3);
    assert.equal(summary.comparison.after.tables.length, 1);
    assert.deepEqual((await session.readRows("records", 0))[0], [
      "R0",
      "K0",
      "9223372036854775807",
    ]);
    await session.rollback();
    assert.deepEqual(await store.snapshot(id), before);
    assert.equal((await all(store, before.tables[0]))[0][2], "001");
    for (const table of staged) await assert.rejects(all(store, table));
    await assert.rejects(session.commit(), /no draft changes/);
  });
  test(`${name}: later changes cannot silently rebase a draft onto another commit`, async (t) => {
    const store = factory();
    t.after(() => store.close());
    const { id } = await seed(store);
    const session = new EditSession(
      id,
      createEditActions(store, engine),
      progress,
    );
    await session.append([extra]);
    await applyEdit(
      store,
      await prepareEdit(
        store,
        engine,
        id,
        [
          {
            method: "delta",
            op: "rename_table",
            table_id: "records",
            new_name: "other_commit",
          },
        ],
        progress,
      ),
    );
    const summary = await session.append([
      {
        method: "delta",
        op: "rename_column",
        table_id: "records",
        column_id: "big",
        new_name: "score",
      },
    ]);
    assert.equal(summary.comparison.before.tables[0].name, "records");
    assert.equal(summary.comparison.after.tables[0].name, "records");
    await assert.rejects(session.commit(), /model changed/);
    assert.equal(
      (await session.readRows("records", 0))[0][3],
      "9223372036854775807",
    );
    assert.equal((await store.snapshot(id)).tables[0].name, "other_commit");
    await session.rollback();
  });
  test(`${name}: same editor migrates every batch, preserves layout, and restores Undo`, async (t) => {
    const store = factory();
    t.after(() => store.close());
    const { id } = await seed(store);
    const session = new EditSession(
      id,
      createEditActions(store, engine),
      progress,
    );
    const summary = await session.append([
      pk,
      { ...fk, method: "pi" },
      extra,
      {
        method: "delta",
        op: "rename_column",
        table_id: "records",
        column_id: "records:2",
        new_name: "code",
      },
    ]);
    assert.equal(summary.steps.length, 4);
    assert.equal(summary.comparison.before.tables[0].columns.length, 3);
    assert.equal(summary.comparison.after.tables[0].columns.length, 4);
    assert.ok(!("dataId" in summary.comparison.after.tables[0]));
    summary.comparison.after.tables[0].name = "view-only change";
    summary.comparison.after.tables[0].columns[0].name = "view-only field";
    assert.ok(!("tables" in summary));
    assert.equal((await store.snapshot(id)).tables[0].columns.length, 3);
    await store.patchInfo(id, {
      name: "kept name",
      positions: { records: { x: 123, y: 456 } },
    });
    await session.commit();
    const saved = await store.snapshot(id),
      table = saved.tables.find((t) => t.id === "records")!;
    assert.equal(table.name, "records");
    assert.equal(table.columns[0].name, "id");
    const rows = await all(store, table);
    assert.equal(rows.length, 235);
    assert.equal(rows[0][2], "001");
    assert.ok(rows.every((row) => row[3] === "9223372036854775807"));
    assert.equal(saved.useCase.name, "kept name");
    assert.deepEqual(saved.useCase.positions.records, { x: 123, y: 456 });
    assert.equal(saved.useCase.relationships.length, 1);
    assert.equal(
      saved.useCase.history.checkpoints.at(-1)!.operations!.length,
      4,
    );
    await undoEdit(store, id);
    const restored = await store.snapshot(id);
    assert.equal(restored.tables[0].columns.length, 3);
    assert.equal(restored.useCase.relationships.length, 0);
    assert.equal(
      restored.useCase.history.editing,
      restored.useCase.history.checkpoints[0].id,
    );
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
      [
        {
          method: "delta",
          op: "rename_table",
          table_id: "records",
          new_name: "entries",
        },
      ],
      progress,
    );
    await applyEdit(store, current);
    await assert.rejects(applyEdit(store, stale), /model changed/);
    await store.discard(stale.tables);
    const snapshot = await store.snapshot(id);
    assert.equal(snapshot.tables[0].name, "entries");
    assert.equal(snapshot.tables[0].columns.length, 3);
    assert.equal(
      snapshot.useCase.history.checkpoints.at(-1)!.operations!.length,
      1,
    );
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
      /duplicate values.*R0/,
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
      /contains.*missing.*no matching value/,
    );
    const after = await store.snapshot(id);
    assert.equal(after.useCase.revision, before.useCase.revision);
    assert.equal(after.useCase.relationships.length, 0);
    assert.equal(
      after.useCase.history.checkpoints.at(-1)!.operations!.length,
      1,
    );
  });
  test(`${name}: failed preview cleans up staged records`, async (t) => {
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
      async evaluate(...args: Parameters<typeof engine.evaluate>) {
        await engine.evaluate(...args);
        throw new Error("preview unavailable");
      },
    };
    await assert.rejects(
      prepareEdit(tracked, unavailable, id, [extra], progress),
      /preview unavailable/,
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
    await publishImport(store, await store.snapshot(useCase.id), [finished]);
    await writer.abort();
    assert.equal((await all(store, finished))[0][0], "001");
    const other = await createUseCase(store);
    await assert.rejects(
      store.commit(other.id, 0, {
        kind: "checkpoint",
        state: {
          tables: [{ ...finished, caseId: other.id }],
          relationships: [],
        },
        operations: [],
        description: "Ownership check",
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
      sql.migration!.includes(
        'ADD COLUMN "big" BIGINT DEFAULT 9223372036854775807',
      ),
    );
    assert.ok(sql.migration!.includes('REFERENCES "lookup" ("id")'));
    assert.ok(sql.migration!.includes("ADD CONSTRAINT"));
    await undoEdit(store, id);
    assert.ok(
      !(await exportSql(store, engine, id)).migration!.includes("ADD COLUMN"),
    );
  });
}

test("IndexedDB: current version, tags and alternate paths survive storage reopening", async (t) => {
  const factory = new IDBFactory(),
    name = `reopen-${crypto.randomUUID()}`;
  let store = createIndexedDbStore({ factory, name });
  t.after(() => store.close());
  const { id } = await seed(store),
    a = await currentCheckpoint(store, id);
  await applyEdit(
    store,
    await prepareEdit(store, engine, id, [extra], progress),
  );
  const b = await currentCheckpoint(store, id);
  await addCheckpointTag(store, id, a, "Live");
  await addCheckpointTag(store, id, b, "Design A");
  await restoreCheckpoint(store, id, a);
  await store.close();
  store = createIndexedDbStore({ factory, name });
  assert.equal((await store.snapshot(id)).useCase.history.editing, a);
  await restoreCheckpoint(store, id, b);
  const reopened = await store.snapshot(id);
  assert.equal(reopened.tables[0].columns.length, 4);
  assert.equal(
    (await all(store, reopened.tables[0]))[234][3],
    "9223372036854775807",
  );
  assert.equal(liveCheckpointId(reopened.useCase.history.checkpoints), a);
  assert.ok(reopened.useCase.history.checkpoints[1].tags!.includes("Design A"));
});

test("IndexedDB: opening a populated v2 record persists the current format without losing checkpoints or rows", async (t) => {
  const factory = new IDBFactory(),
    name = `upgrade-${crypto.randomUUID()}`;
  let store = createIndexedDbStore({ factory, name });
  t.after(() => store.close());
  const { id } = await seed(store),
    original = await store.snapshot(id),
    a = await currentCheckpoint(store, id);
  await applyEdit(
    store,
    await prepareEdit(store, engine, id, [extra], progress),
  );
  const saved = await store.snapshot(id),
    b = await currentCheckpoint(store, id);
  const log = { base: schemaSpec(original.tables, []), operations: [extra] };
  const {
    history: _history,
    modelVersion: _version,
    undo: currentUndo,
    ...workspace
  } = saved.useCase;
  const { checkpointId, ...oldUndo } = currentUndo!;
  const raw: WorkspaceRecord = {
    ...workspace,
    modelVersion: 2,
    migration: log,
    undo: {
      ...oldUndo,
      tables: original.tables,
      relationships: original.useCase.relationships,

      historyHead: checkpointId,
    },
    exploration: {
      active: { id: "main", name: "Main", createdAt: 1, headId: b },
      branches: [],
      liveId: a,
      checkpoints: saved.useCase.history.checkpoints.map((c) => ({
        ...c,
        branchId: "main",
        branchName: "Main",
        state: { ...c.state, ...(c.id === b ? { migration: log } : {}) },
      })),
    },
  };
  await store.close();
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(name, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  let db = await open();
  const write = db.transaction("useCases", "readwrite");
  const written = new Promise<void>((resolve, reject) => {
    write.oncomplete = () => resolve();
    write.onerror = () => reject(write.error);
    write.onabort = () => reject(write.error);
  });
  write.objectStore("useCases").put(raw);
  await written;
  db.close();
  store = createIndexedDbStore({ factory, name });
  const summary = (await store.listCases()).find((item) => item.id === id)!;
  assert.ok(summary);
  assert.ok(!("history" in summary));
  assert.ok(!("exploration" in summary));
  await assert.rejects(store.snapshot(id), /Load this use case/);
  await assert.rejects(store.readCase(id), /Load this use case/);
  await assert.rejects(
    store.patchInfo(id, { name: "Must not write" }),
    /Load this use case/,
  );
  await assert.rejects(
    addCheckpointTag(store, id, a, "Review"),
    /Load this use case/,
  );
  db = await open();
  const unchangedRequest = db
    .transaction("useCases")
    .objectStore("useCases")
    .get(id);
  const unchanged = await new Promise<WorkspaceRecord>((resolve, reject) => {
    unchangedRequest.onsuccess = () => resolve(unchangedRequest.result);
    unchangedRequest.onerror = () => reject(unchangedRequest.error);
  });
  db.close();
  assert.deepEqual(unchanged, raw);
  const migrated = await store.load(id);
  const loadedAgain = await store.load(id);
  assert.deepEqual(loadedAgain.useCase.history, migrated.useCase.history);
  assert.equal(loadedAgain.useCase.revision, saved.useCase.revision);
  assert.deepEqual(loadedAgain.tables, migrated.tables);
  assert.equal(migrated.useCase.modelVersion, 6);
  assert.equal(migrated.useCase.history.editing, b);
  assert.deepEqual(
    migrated.useCase.history.checkpoints.map((c) => c.id),
    [a, b],
  );
  assert.deepEqual(migrated.tables, saved.tables);
  assert.equal(
    (await all(store, migrated.tables[0]))[234][3],
    "9223372036854775807",
  );
  assert.deepEqual(
    migrated.useCase.history.checkpoints[1].legacyMigration,
    log,
  );
  assert.equal(liveCheckpointId(migrated.useCase.history.checkpoints), a);
  db = await open();
  const request = db.transaction("useCases").objectStore("useCases").get(id);
  const persisted = await new Promise<UseCase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  assert.equal(persisted.modelVersion, 6);
  assert.ok(!("exploration" in persisted));
  assert.ok(!("migration" in persisted));
  assert.ok(
    persisted.history.checkpoints.every(
      (c) => !("branchName" in c) && !("branchId" in c),
    ),
  );
  await restoreCheckpoint(store, id, a);
  await applyEdit(
    store,
    await prepareEdit(
      store,
      engine,
      id,
      [
        {
          method: "delta",
          op: "rename_table",
          table_id: "records",
          new_name: "revised",
        },
      ],
      progress,
    ),
  );
  const c = await currentCheckpoint(store, id);
  const sql = await exportSql(store, engine, id, { from: a, to: c });
  assert.ok(sql.migration!.includes('RENAME TO "revised"'));
  assert.ok(!sql.migration!.includes("ADD COLUMN"));
  await store.discard(saved.tables);
  await restoreCheckpoint(store, id, b);
  assert.equal(
    (await all(store, (await store.snapshot(id)).tables[0]))[0][3],
    "9223372036854775807",
  );
});

test("IndexedDB: separate connections preserve tags around Commit and still reject actual model conflicts", async (t) => {
  const factory = new IDBFactory(),
    name = `two-connections-${crypto.randomUUID()}`;
  const first = createIndexedDbStore({ factory, name }),
    second = createIndexedDbStore({ factory, name });
  t.after(async () => {
    await first.close();
    await second.close();
  });
  const { id } = await seed(first),
    root = await currentCheckpoint(first, id);
  await second.load(id);
  const session = new EditSession(
    id,
    createEditActions(first, engine),
    progress,
  );
  await session.append([
    {
      method: "delta",
      op: "rename_table",
      table_id: "records",
      new_name: "published",
    },
  ]);
  const before = await first.snapshot(id);
  await second.load(id); // Opening another window is not a model transition.
  await Promise.all([
    session.commit(),
    addCheckpointTag(second, id, root, "Review"),
    addCheckpointTag(second, id, root, "Live"),
  ]);
  const committed = await first.snapshot(id);
  assert.equal(committed.tables[0].name, "published");
  assert.equal(committed.useCase.revision, before.useCase.revision! + 1);
  assert.equal(committed.useCase.history.checkpoints.length, 2);
  assert.deepEqual(
    new Set(committed.useCase.history.checkpoints[0].tags),
    new Set(["Review", "Live"]),
  );
  await session.append([
    {
      method: "delta",
      op: "rename_table",
      table_id: "records",
      new_name: "stale",
    },
  ]);
  await restoreCheckpoint(second, id, root);
  await addCheckpointTag(second, id, root, "Milestone");
  await assert.rejects(session.commit(), /model changed/);
  await session.rollback();
  const restored = await first.snapshot(id);
  assert.equal(restored.tables[0].name, "records");
  assert.ok(
    restored.useCase.history.checkpoints[0].tags!.includes("Milestone"),
  );
  assert.equal((await all(first, restored.tables[0]))[0][2], "001");
});
