import assert from "node:assert/strict";
import test from "node:test";
import { liveCheckpointId } from "./history.ts";
import { restoreWorkspace, type WorkspaceRecord } from "./restore-workspace.ts";
import type { Table } from "./schema.ts";
import { retainedTables, type SavedWorkspace } from "./workspace.ts";
const table = (dataId: string): Table => ({
  id: "records",
  caseId: "legacy",
  name: "records",
  fileName: "records.csv",
  bytes: 3,
  rowCount: 1,
  dataBytes: 3,
  dataId,
  primaryKey: [],
  columns: [
    {
      id: "raw",
      name: "raw",
      index: 0,
      dataType: "text",
      nullable: false,
    },
  ],
});
const state = (dataId: string): SavedWorkspace => ({
  tables: [table(dataId)],
  relationships: [],

  positions: { records: { x: 1, y: 2 } },
});
function fixture(): WorkspaceRecord {
  const a = state("a"),
    b = state("b"),
    c = state("c"),
    d = state("d");
  const log = { base: { tables: [], foreign_keys: [] }, operations: [] };
  return {
    id: "legacy",
    name: "Legacy",
    modelVersion: 2,
    createdAt: 1,
    updatedAt: 9,
    revision: 4,
    tableIds: ["records"],
    positions: { records: { x: 90, y: 91 } },
    relationships: [],

    migration: log,
    undo: {
      tables: a.tables,
      relationships: [],

      description: "Before",
      historyHead: "a",
    },
    exploration: {
      active: { id: "main", name: "Main", createdAt: 1, headId: "b" },
      liveId: "a",
      checkpoints: [
        {
          id: "a",
          name: "Imported",
          createdAt: 2,
          parentId: null,
          state: a,
          operations: [],
          branchId: "main",
          branchName: "Main",
        },
        {
          id: "b",
          name: "Changed",
          createdAt: 3,
          parentId: "a",
          state: { ...b, migration: log },
          operations: [],
          branchId: "main",
          branchName: "Main",
        },
      ],
      branches: [
        {
          id: "saved",
          name: "Normalize",
          createdAt: 3,
          headId: "b",
          checkpointId: "a",
          state: c,
          undo: {
            tables: d.tables,
            relationships: [],

            description: "Old values",
          },
        },
        { id: "reserved", name: "Live", createdAt: 4, headId: "a", state: a },
      ],
    },
  };
}
test("migration preserves IDs, parents, current data, saved states and every Undo data reference", () => {
  const raw = fixture(),
    before = structuredClone(raw),
    current = [table("b")];
  const migrated = restoreWorkspace(raw, current);
  assert.equal(migrated.modelVersion, 6);
  assert.equal(migrated.revision, 4);
  assert.equal(migrated.history.editing, "b");
  assert.equal(migrated.undo!.checkpointId, "a");
  assert.equal(migrated.history.checkpoints[0].id, "a");
  assert.equal(migrated.history.checkpoints[1].parentId, "a");
  assert.deepEqual(migrated.positions, { records: { x: 90, y: 91 } });
  assert.deepEqual(
    new Set(retainedTables(migrated).map((t) => t.dataId)),
    new Set(["a", "b", "c", "d"]),
  );
  const saved = migrated.history.checkpoints.find((c) =>
    c.tags?.includes("Normalize"),
  )!;
  assert.equal(saved.state.tables[0].dataId, "c");
  assert.equal(saved.parentId, undefined);
  assert.equal(saved.operations, undefined);
  assert.equal(liveCheckpointId(migrated.history.checkpoints), "a");
  assert.ok(
    migrated.history.checkpoints[0].tags!.includes("Saved exploration: Live"),
  );
  assert.ok(
    !migrated.history.checkpoints.some((c) => c.tags?.includes("Main")),
  );
  assert.ok(!("exploration" in migrated));
  assert.ok(!("migration" in migrated));
  assert.ok(
    migrated.history.checkpoints.every(
      (c) =>
        !("branchName" in c) && !("branchId" in c) && !("migration" in c.state),
    ),
  );
  assert.deepEqual(migrated.history.checkpoints[1].legacyMigration, {
    base: { tables: [], foreign_keys: [] },
    operations: [],
  });
  assert.deepEqual(raw, before);
  assert.deepEqual(restoreWorkspace(raw, current), migrated);
  assert.deepEqual(restoreWorkspace(migrated), migrated);
});
test("versions before checkpoint tracking retain current and Undo values as recoverable snapshots", () => {
  const raw: WorkspaceRecord = {
    id: "legacy",
    name: "Old",
    modelVersion: 2,
    createdAt: 1,
    updatedAt: 4,
    tableIds: ["records"],
    positions: {},
    relationships: [],

    undo: {
      tables: [table("previous")],
      relationships: [],

      description: "Old data",
    },
  };
  const migrated = restoreWorkspace(raw, [table("current")]);
  assert.ok(migrated.history.editing);
  assert.equal(migrated.history.checkpoints.length, 2);
  assert.deepEqual(
    new Set(retainedTables(migrated).map((t) => t.dataId)),
    new Set(["current", "previous"]),
  );
  assert.ok(
    migrated.history.checkpoints.every(
      (c) => c.parentId === undefined && c.operations === undefined,
    ),
  );
});
test("migration rejects missing metadata and future formats instead of dropping data", () => {
  const raw = fixture();
  assert.throws(() => restoreWorkspace(raw), /metadata is required/);
  assert.throws(
    () => restoreWorkspace({ ...raw, modelVersion: 7 } as WorkspaceRecord),
    /newer version/,
  );
  const current = restoreWorkspace(raw, [table("b")]);
  assert.throws(
    () =>
      restoreWorkspace({
        ...current,
        history: { ...current.history, editing: "missing" },
      }),
    /history is unavailable/,
  );
});

test("saved camera differences do not create extra model versions", () => {
  const raw = fixture();
  if (!("exploration" in raw) || !raw.exploration)
    throw new Error("Legacy fixture required");
  const base = raw.exploration.checkpoints[1];
  raw.exploration.branches.push({
    id: "view",
    name: "View only",
    createdAt: 5,
    headId: "b",
    state: {
      ...base.state,
      positions: { records: { x: 500, y: 600 } },
      viewport: { x: 20, y: 30, zoom: 0.5 },
    },
  });
  const migrated = restoreWorkspace(raw, [table("b")]);
  assert.equal(migrated.history.checkpoints.length, 4);
  assert.ok(migrated.history.checkpoints[1].tags!.includes("View only"));
  assert.deepEqual(migrated.history.checkpoints[1].state.positions, {
    records: { x: 1, y: 2 },
  });
  assert.deepEqual(migrated.positions, { records: { x: 90, y: 91 } });
});

test("v3 records advance only their write protocol while preserving version identities", () => {
  const canonical = restoreWorkspace(fixture(), [table("b")]);
  const previous = {
    ...structuredClone(canonical),
    modelVersion: 3,
  } as WorkspaceRecord;
  const upgraded = restoreWorkspace(previous, [table("b")]);
  assert.equal(upgraded.modelVersion, 6);
  assert.deepEqual(upgraded.history, canonical.history);
  assert.deepEqual(upgraded.undo, canonical.undo);
  assert.equal(upgraded.revision, canonical.revision);
  assert.deepEqual(retainedTables(upgraded), retainedTables(canonical));
  assert.equal(previous.modelVersion, 3);
});
