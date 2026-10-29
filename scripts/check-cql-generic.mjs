import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { createIndexedDbStore } from "../frontend/src/adapters/indexeddb-store.ts";
import { createUseCase } from "../frontend/src/application/workspaces.ts";
import {
  freezeBinding,
  materializeSubset,
  applySubset,
} from "../frontend/src/application/cql-subset.ts";
import { schemaSpec } from "../frontend/src/model/wire.ts";
globalThis.IDBKeyRange = IDBKeyRange;
const { contract, result } = JSON.parse(
  await fs.readFile(
    new URL("../test-fixtures/cql/books-fixture.json", import.meta.url),
  ),
);
const store = createIndexedDbStore({
  factory: new IDBFactory(),
  name: "generic-key-fixture",
});
const c = await createUseCase(store);
const binding = freezeBinding(contract, c.id);
assert.equal(binding.tables.length, 2);
const fk = binding.relationships[0];
assert.equal(fk.source_columns.length, 2);
assert.deepEqual(fk.target_columns, binding.tables[0].primaryKey);
assert.deepEqual(
  binding.tables[1].columns.map((c) => c.dataType),
  ["integer", "text", "text", "text"],
);
const materialized = materializeSubset(contract, result, binding);
assert.deepEqual(materialized[1].rows, [
  ["1", "Notes", "US", "0012"],
  ["2", "Methods", "GB", "0012"],
]);
await store.commit(c.id, 0, {
  kind: "checkpoint",
  state: {
    tables: binding.tables,
    relationships: binding.relationships,
    equations: [],
  },
  operations: [],
  description: "Generic prepared target",
});
await applySubset(store, c.id, 1, contract, result, binding);
const loaded = await store.load(c.id);
assert.deepEqual(
  schemaSpec(loaded.tables, loaded.useCase.relationships),
  schemaSpec(binding.tables, binding.relationships),
);
for (const t of loaded.tables) {
  const rows = [];
  for await (const batch of store.rows(t)) rows.push(...batch.rows);
  assert.deepEqual(rows, materialized.find((m) => m.table.id === t.id).rows);
}
const bad = structuredClone(result);
bad.Author[1].Country = "GB";
assert.throws(
  () => materializeSubset(contract, bad, binding),
  /Duplicate native key/,
);
store.close();
console.log(
  "PASS generic Books/Authors config → same factory → composite text key/FK materializer → native store, exact 0012, duplicate key rejection.",
);
