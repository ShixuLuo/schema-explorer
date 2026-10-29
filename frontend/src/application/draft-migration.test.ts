import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../adapters/memory-store.ts";
import { createUseCase } from "./workspaces.ts";
import { runDraftMigration, applyDraftMigration } from "./draft-migration.ts";
import { schemaSpec } from "../model/wire.ts";
import type { Table } from "../model/schema.ts";
import type { SchemaSpec } from "../model/operations.ts";
import type { LiveRow } from "./cql-live.ts";
async function fixture() {
  const store = createMemoryStore(), useCase = await createUseCase(store);
  const table: Table = { id: "source", name: "Source", columns: [{ id: "key", name: "code", dataType: "text", nullable: false, index: 0 }], primaryKey: ["key"], caseId: useCase.id, fileName: "source", bytes: 0, rowCount: 0 };
  const writer = store.stage(table); await writer.append([["business-key"]]);
  const saved = await writer.finish(table);
  await store.commit(useCase.id, 0, { kind: "checkpoint", state: { tables: [saved], relationships: [] }, operations: [], description: "source" });
  return { store, caseId: useCase.id, source: schemaSpec([saved], []), saved };
}
function mock(source: SchemaSpec, target: SchemaSpec, rows: Record<string, LiveRow[]>, corrupt = false) {
  let binding: unknown;
  return async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input);
    if (init?.body) {
      const body = JSON.parse(String(init.body)); assert.equal(body.kind, "query");
      assert.deepEqual(body.source, source); assert.deepEqual(body.target, target);
      assert.equal(body.data.tables.source[0].key, "business-key");
      binding = { revision: body.revision, targetSchemaHash: body.targetSchemaHash, sourceDataDigest: body.sourceDataDigest };
      return Response.json({ runId: "tiny", bindings: binding, status: "succeeded", programHash: "a".repeat(64), manifest: { source: { nativeSchemaSpec: source }, target: { nativeSchemaSpec: target } }, tables: target.tables.map(t => ({ tableId: t.id, rowCount: rows[t.id].length })) });
    }
    const id = decodeURIComponent(path.split("/tables/")[1].split("?")[0]), table = target.tables.find(t => t.id === id)!;
    return Response.json({ runId: "tiny", tableId: id, bindings: binding, offset: corrupt ? 1 : 0, total: rows[id].length, columns: table.columns, foreignKeys: target.foreign_keys.filter(f => f.source_table === id), rows: rows[id] });
  };
}
const target: SchemaSpec = { tables: [
  { id: "target", name: "Target", columns: [{ id: "code", name: "code", dataType: "text", nullable: false }], primaryKey: ["code"] },
  { id: "generated", name: "Generated", columns: [{ id: "id", name: "id", dataType: "integer", nullable: false, generated: "identity" }], primaryKey: ["id"] },
  { id: "empty", name: "Empty", columns: [{ id: "emptyid", name: "id", dataType: "text", nullable: false }], primaryKey: ["emptyid"] },
], foreign_keys: [] };
const rows = { target: [{ id: "carrier", values: { code: "business-key" }, foreignKeys: {} }], generated: [{ id: "g", values: {}, foreignKeys: {} }], empty: [] };
test("query run leaves source unchanged; Apply preserves target IDs and source history without SQL", async t => {
  const f = await fixture(), before = await f.store.load(f.caseId);
  t.mock.method(globalThis, "fetch", mock(f.source, target, rows));
  const prepared = await runDraftMigration(f.store, f.caseId, 1, f.source, target, [], () => {}, new AbortController().signal);
  const untouched = await f.store.load(f.caseId);
  assert.deepEqual(untouched.tables, before.tables);
  assert.deepEqual(untouched.useCase.history, before.useCase.history);
  assert.equal(untouched.useCase.revision, before.useCase.revision);
  await applyDraftMigration(f.store, prepared);
  const after = await f.store.load(f.caseId);
  assert.deepEqual(after.tables.map(t => t.id), ["target", "generated", "empty"]);
  assert.deepEqual(await f.store.readRows(after.tables[0], 0), [["business-key"]]);
  assert.deepEqual(await f.store.readRows(after.tables[1], 0), [["1"]]);
  assert.deepEqual(await f.store.readRows(after.tables[2], 0), []);
  assert.deepEqual(await f.store.readRows(f.saved, 0), [["business-key"]]);
  assert.equal(after.useCase.history.checkpoints.length, 2);
  assert.equal(after.useCase.history.checkpoints[1].operations, undefined);
  assert.equal(after.useCase.history.checkpoints[1].provenance?.kind, "cql-result-import");
});
test("stale source, tampered results and broken pagination fail without publishing", async t => {
  const f = await fixture(); t.mock.method(globalThis, "fetch", mock(f.source, target, rows));
  const prepared = await runDraftMigration(f.store, f.caseId, 1, f.source, target, [], () => {}, new AbortController().signal);
  const changed = structuredClone(prepared); changed.rows.target[0].values.code = "changed";
  await assert.rejects(applyDraftMigration(f.store, changed), /changed/);
  await f.store.commit(f.caseId, 1, { kind: "checkpoint", state: { tables: [f.saved], relationships: [] }, operations: [], description: "concurrent" });
  await assert.rejects(applyDraftMigration(f.store, prepared), /Source changed/);
  t.mock.method(globalThis, "fetch", mock(f.source, target, rows, true));
  await assert.rejects(runDraftMigration(f.store, f.caseId, 2, f.source, target, [], () => {}, new AbortController().signal), /result page/);
  assert.equal((await f.store.load(f.caseId)).useCase.revision, 2);
});
test("dangling references fail before staging or commit", async t => {
  const f = await fixture(), fkTarget = structuredClone(target);
  fkTarget.tables[1].columns.push({ id: "ref", name: "ref", dataType: "text", nullable: false });
  fkTarget.foreign_keys.push({ id: "fk", source_table: "generated", source_columns: ["ref"], target_table: "target", target_columns: ["code"] });
  const broken = structuredClone(rows); broken.generated[0].foreignKeys = { fk: "missing" } as never;
  t.mock.method(globalThis, "fetch", mock(f.source, fkTarget, broken));
  const prepared = await runDraftMigration(f.store, f.caseId, 1, f.source, fkTarget, [], () => {}, new AbortController().signal);
  await assert.rejects(applyDraftMigration(f.store, prepared), /Dangling/);
  assert.equal((await f.store.load(f.caseId)).useCase.revision, 1);
});
test("failed atomic publication aborts and discards new data", async t => {
  const f = await fixture(); t.mock.method(globalThis, "fetch", mock(f.source, target, rows));
  const prepared = await runDraftMigration(f.store, f.caseId, 1, f.source, target, [], () => {}, new AbortController().signal);
  const discard = t.mock.method(f.store, "discard"), commit = t.mock.method(f.store, "commit", async () => { throw Error("commit conflict"); });
  await assert.rejects(applyDraftMigration(f.store, prepared), /commit conflict/);
  assert.equal(commit.mock.callCount(), 1);
  assert.equal(discard.mock.callCount(), 1);
  assert.equal(discard.mock.calls[0].arguments[0].length, 3);
  assert.equal((await f.store.load(f.caseId)).useCase.revision, 1);
  assert.deepEqual(await f.store.readRows(f.saved, 0), [["business-key"]]);
});
