import assert from "node:assert/strict";
import { schemaSpec } from "../frontend/src/model/wire.ts";
import { materializeLive } from "../frontend/src/application/cql-live.ts";
const col = (id, dataType = "text", extra = {}) => ({
  id,
  name: id,
  dataType,
  nullable: false,
  ...extra,
});
const table = (id, columns, primaryKey, uniqueKeys = []) => ({
  id,
  name: id,
  columns: columns.map((c, index) => ({ ...c, index })),
  primaryKey,
  uniqueKeys,
  caseId: "c",
  fileName: id,
  bytes: 0,
  rowCount: 0,
});
const a = table(
  "a",
  [col("pk"), col("large", "integer"), col("part")],
  ["pk"],
  [["large", "part"]],
);
const b = table(
  "b",
  [
    col("id", "integer", { generated: "identity" }),
    col("refLarge", "integer"),
    col("refPart"),
  ],
  ["id"],
);
const fk = {
  id: "fk",
  source_table: "b",
  source_columns: ["refLarge", "refPart"],
  target_table: "a",
  target_columns: ["large", "part"],
};
const tables = [a, b],
  relationships = [fk];
const target = schemaSpec(tables, relationships);
const result = {
  target,
  rows: {
    a: [
      {
        id: "carrier97",
        values: { pk: "0012", large: "9223372036854775807", part: "x|y" },
        foreignKeys: {},
      },
    ],
    b: [{ id: "anything", values: {}, foreignKeys: { fk: "carrier97" } }],
  },
};
const run = (r) => materializeLive(r, tables, relationships);
assert.deepEqual(
  run(result).map((x) => x.rows),
  [
    [["0012", "9223372036854775807", "x|y"]],
    [["1", "9223372036854775807", "x|y"]],
  ],
);
const bad = (mutate) => {
  const r = structuredClone(result);
  mutate(r);
  return r;
};
assert.throws(() => run(bad((r) => delete r.rows.a[0].values.pk)), /Missing/);
assert.throws(
  () => run(bad((r) => (r.rows.a[0].values.pk = null))),
  /Required|Null|null/,
);
assert.throws(
  () => run(bad((r) => r.rows.a.push({ ...r.rows.a[0], id: "other" }))),
  /Duplicate native key/,
);
assert.throws(
  () => run(bad((r) => (r.rows.a[0].values.large = 9223372036854776000))),
  /invalid/,
);
assert.throws(
  () => run(bad((r) => (r.rows.b[0].foreignKeys.fk = "missing"))),
  /Dangling/,
);
assert.throws(
  () => run(bad((r) => (r.rows.b[0].values.refPart = "conflict"))),
  /Conflicting/,
);
// The exact ordered composite primary key is also a supported FK target.
const composite = structuredClone(result);
const compositeTables = structuredClone(tables);
compositeTables[0].primaryKey = ["large", "part"];
composite.target.tables[0].primaryKey = ["large", "part"];
assert.equal(
  materializeLive(composite, compositeTables, relationships)[1].rows[0][1],
  "9223372036854775807",
);
const cycleTables = [table("cycle", [col("key")], ["key"])];
const cycleFk = {
  id: "self",
  source_table: "cycle",
  source_columns: ["key"],
  target_table: "cycle",
  target_columns: ["key"],
};
const cycleTarget = schemaSpec(cycleTables, [cycleFk]);
assert.throws(
  () =>
    materializeLive(
      {
        target: cycleTarget,
        rows: { cycle: [{ id: "c", values: {}, foreignKeys: { self: "c" } }] },
      },
      cycleTables,
      [cycleFk],
    ),
  /Unresolvable/,
);
console.log(
  "PASS business Text lexeme, exact Int64, generated identity, ordered composite unique/PK references, missing/null/duplicate/dangling/conflict and unresolved cycle rejection.",
);
