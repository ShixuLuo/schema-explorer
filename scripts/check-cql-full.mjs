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
import { exportSql } from "../frontend/src/application/export.ts";
import { validScalar } from "../frontend/src/model/scalar.ts";
import { literal, sqlType } from "../frontend/src/adapters/sql-syntax.ts";
import { storagePresentation } from "../frontend/src/model/database-presentation.ts";
import { schemaSpec } from "../frontend/src/model/wire.ts";
import { validatePresentation } from "../frontend/src/model/presentation.ts";
globalThis.IDBKeyRange = IDBKeyRange;
const contract = JSON.parse(
  await fs.readFile(
    new URL("../frontend/public/cql-experiment/target.json", import.meta.url),
  ),
);
const result = JSON.parse(
  await fs.readFile(
    new URL("../test-fixtures/cql/result.json", import.meta.url),
  ),
);
for (const v of [
  "1.00",
  "-0.00000000000000000000000000000000001",
  "9007199254740993.12345678901234567890",
  "1e-1000",
]) {
  assert(validScalar("real", v));
  assert.equal(literal({ type: "real", value: v }), v + "::NUMERIC");
}
for (const v of ["NaN", "Infinity", "1;DROP TABLE x", "0x10", "", " 1"])
  assert(!validScalar("real", v));
for (const v of ["true", "false"]) assert(validScalar("boolean", v));
for (const v of ["1", "0", "True", "TRUE", ""])
  assert(!validScalar("boolean", v));
assert(validScalar("integer", "9223372036854775807"));
assert(!validScalar("integer", "9223372036854775808"));
assert.equal(
  literal({ type: "integer", value: "9223372036854775807" }),
  "9223372036854775807",
);
assert.equal(literal({ type: "boolean", value: "false" }), "FALSE");
assert.equal(sqlType({ dataType: "real" }), "NUMERIC");
assert.equal(sqlType({ dataType: "boolean" }), "BOOLEAN");
const factory = new IDBFactory();
const make = () =>
  createIndexedDbStore({ factory, name: "isolated-full-check" });
let store = make();
const c = await createUseCase(store);
const prepared = freezeBinding(contract, c.id);
await store.commit(c.id, 0, {
  kind: "checkpoint",
  state: {
    tables: prepared.tables,
    relationships: prepared.relationships,
    equations: [],
  },
  operations: [],
  description: "prepared target",
});
const initial = (await store.readCase(c.id)).history.editing;
const binding = prepared,
  materialized = materializeSubset(contract, result, binding);
assert.deepEqual(
  materialized.map((t) => t.rows.length),
  [500, 821, 1178, 182, 49],
);
assert(Object.isFrozen(binding));
validatePresentation(
  storagePresentation(schemaSpec(binding.tables, binding.relationships)),
);
let cells = 0,
  refs = 0;
for (const { table, rows } of materialized) {
  const entity = table.name;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    cells += row.length;
    const pk = table.columns.find((c) => c.id === table.primaryKey[0]);
    assert.equal(
      row[table.columns.indexOf(pk)],
      entity === "Coupon" ? String(i + 1) : String(result[entity][i][pk.name]),
    );
    assert.equal(pk.storage, "identity");
    assert.equal(pk.generated, entity === "Coupon" ? "identity" : undefined);
    for (const [key, target] of Object.entries(
      contract.entities[entity].refs,
    )) {
      refs++;
      const index = table.columns.findIndex((c) => c.name === key),
        j = result[target].findIndex((r) => r.id === result[entity][i][key]);
      assert(j >= 0);
      const targetTable = materialized.find(
        (t) => t.table.name === target,
      ).table;
      const targetPk = targetTable.columns.find(
        (c) => c.id === targetTable.primaryKey[0],
      );
      assert.equal(
        row[index],
        targetPk.generated
          ? String(j + 1)
          : String(result[target][j][targetPk.name]),
      );
      assert.equal(table.columns[index].dataType, targetPk.dataType);
    }
    for (const [key, sort] of Object.entries(
      contract.entities[entity].stored_attributes,
    )) {
      const index = table.columns.findIndex((c) => c.name === key);
      assert.equal(
        row[index],
        sort === "Real"
          ? result[entity][i].exact_decimal_values[key]
          : String(result[entity][i][key]),
      );
      assert.equal(
        table.columns[index].dataType,
        { String: "text", Int: "integer", Real: "real", Bool: "boolean" }[sort],
      );
    }
  }
}
assert.equal(cells, 55872);
assert.equal(refs, 6679);
for (const entity of ["Ticket", "Market", "Airport", "State"]) {
  const t = binding.tables.find((t) => t.name === entity);
  assert(!t.columns.some((c) => c.name === "_id"));
}
const state = materialized.find((x) => x.table.name === "State");
assert(
  state.rows.some(
    (r) => r[state.table.columns.findIndex((c) => c.name === "Fips")] === "01",
  ),
);
await applySubset(store, c.id, 1, contract, result, binding);
store.close();
store = make();
const loaded = await store.load(c.id);
assert.equal(loaded.tables.length, 5);
assert.deepEqual(
  schemaSpec(loaded.tables, loaded.useCase.relationships),
  schemaSpec(binding.tables, binding.relationships),
);
for (const t of loaded.tables) {
  const rows = [];
  for await (const batch of store.rows(t)) rows.push(...batch.rows);
  assert.deepEqual(rows, materialized.find((x) => x.table.id === t.id).rows);
}
const cp = loaded.useCase.history.checkpoints.at(-1);
assert.equal(cp.operations, undefined);
assert.deepEqual(cp.provenance.contract, contract);
assert.equal(cp.provenance.kind, "cql-result-import");
let called = false;
const sql = await exportSql(
  store,
  {
    sql: async () => {
      called = true;
      throw Error("must not compile");
    },
  },
  c.id,
  { from: initial, to: cp.id },
);
assert.equal(called, false);
assert.equal(sql.migration, null);
assert.match(sql.reason, /CQL/);
await assert.rejects(
  applySubset(store, c.id, 1, contract, result, binding),
  /another session/,
);
assert.equal((await store.readCase(c.id)).history.editing, cp.id);
let bad = structuredClone(result);
bad.Airport[0].State = "missing";
assert.throws(() => materializeSubset(contract, bad, binding), /Dangling/);
bad = structuredClone(result);
delete bad.Ticket[0].exact_decimal_values;
assert.throws(() => materializeSubset(contract, bad, binding), /exact decimal/);
bad = structuredClone(result);
bad.Ticket[0].RoundTrip = 1;
assert.throws(() => materializeSubset(contract, bad, binding), /Bool/);
bad = structuredClone(result);
bad.State[0].Fips = bad.State[1].Fips;
assert.throws(
  () => materializeSubset(contract, bad, binding),
  /Duplicate native key/,
);
bad = structuredClone(result);
bad.State[0].Fips = null;
assert.throws(() => materializeSubset(contract, bad, binding), /String/);
await store.commit(c.id, 2, { kind: "restore", checkpointId: initial });
assert.equal((await store.load(c.id)).tables.length, 5);
assert((await store.load(c.id)).tables.every((t) => t.rowCount === 0));
await store.commit(c.id, 3, { kind: "restore", checkpointId: cp.id });
assert.equal((await store.load(c.id)).tables.length, 5);
store.close();
console.log(
  `PASS full five tables, 2730 rows, ${cells} exact cells, ${refs} native FK rewrites, native presentation, decimal/Bool/int64 boundaries, stage/commit/reopen, retained contract, provenance, SQL guard, stale/dangling/type rejection, restore both ways`,
);
