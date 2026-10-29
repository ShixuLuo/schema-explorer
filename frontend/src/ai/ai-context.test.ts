import test from "node:test";
import assert from "node:assert/strict";
import type {
  WorkspaceSnapshot,
  WorkspaceStore,
} from "../application/ports.ts";
import type { CellValue } from "../model/schema.ts";
import { prepareAiContext } from "./ai-context.ts";
const table = (
  id: string,
  columns: { id: string; name: string; dataType: "text" | "integer" }[],
  count: number,
) => ({
  id,
  name: id,
  caseId: "c",
  fileName: "",
  bytes: 0,
  rowCount: count,
  primaryKey: [columns[0].id],
  columns: columns.map((c, index) => ({ ...c, nullable: true, index })),
});
const fixture = () =>
  ({
    tables: [
      table(
        "p",
        [
          { id: "pid", name: "id", dataType: "integer" },
          { id: "email", name: "email", dataType: "text" },
        ],
        2,
      ),
      table(
        "c",
        [
          { id: "cid", name: "id", dataType: "integer" },
          { id: "parent", name: "parent_id", dataType: "integer" },
          { id: "amount", name: "amount", dataType: "integer" },
        ],
        4,
      ),
    ],
    useCase: {
      id: "c",
      revision: 1,
      relationships: [
        {
          id: "fk",
          source_table: "c",
          source_columns: ["parent"],
          target_table: "p",
          target_columns: ["pid"],
        },
      ],
      equations: [],
    },
  }) as unknown as WorkspaceSnapshot;
const rows: Record<string, CellValue[][]> = {
  p: [
    ["1", "private@example.com"],
    ["2", "hidden@example.com"],
  ],
  c: [
    ["10", "1", "5"],
    ["11", null, "oops"],
    ["12", "999", "9"],
    ["12", "1", "4"],
  ],
};
const store: Pick<WorkspaceStore, "rows"> = {
  async *rows(t) {
    yield { offset: 0, rows: rows[t.id] };
  },
};
test("local profile computes nulls, duplicate keys, integer failures and FK coverage", async () => {
  const context = await prepareAiContext(fixture(), store);
  const c = context.profiles.find((p) => p.tableId === "c")!;
  assert.equal(c.precision, "exact");
  assert.equal(c.columns[1].nullCount, 1);
  assert.equal(c.columns[2].typeFailures, 1);
  assert.equal(c.keys[0].duplicateRows, 1);
  assert.deepEqual(context.relationships[0], {
    id: "fk",
    scannedRows: 4,
    nonNullRows: 3,
    matchedRows: 2,
    unmatchedRows: 1,
    precision: "exact",
  });
});
test("linked sample excludes private values and pairs masked carriers with actual parent rows", async () => {
  const context = await prepareAiContext(fixture(), store);
  assert.ok(!JSON.stringify(context).includes("example.com"));
  assert.deepEqual(context.excludedColumnIds, ["email"]);
  const child = context.samples.find(
    (s) => s.tableId === "c" && s.stratum === "common",
  )!;
  const parent = context.samples.find(
    (s) => s.rowToken === child.parentRowTokens[0],
  )!;
  assert.equal(child.values.parent, parent.values.pid);
  assert.ok(context.samples.some((s) => s.orphanReferenceIds.includes("fk")));
  assert.ok(context.samples.some((s) => s.stratum === "missing"));
});
test("bounded scans explicitly report estimates and fingerprints change with rows", async () => {
  const first = await prepareAiContext(fixture(), store, { maxScanRows: 1 });
  assert.ok(first.profiles.every((p) => p.precision === "estimate"));
  assert.equal(first.relationships[0].precision, "estimate");
  const full = await prepareAiContext(fixture(), store);
  assert.notEqual(first.dataFingerprint, full.dataFingerprint);
});
test("cancellation does not produce context", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => prepareAiContext(fixture(), store, { signal: controller.signal }),
    /abort/i,
  );
});
test("accepted draft names and references rebuild context over existing row carriers", async () => {
  const snapshot = fixture();
  const { snapshotSchema } = await import("./ai-proposal.ts");
  const schema = snapshotSchema(snapshot);
  schema.tables[1].columns[2].name = "total";
  schema.tables[1].columns.reverse();
  const context = await prepareAiContext(snapshot, store, { schema });
  const amount = context.profiles[1].columns.find(
    (c) => c.columnId === "amount",
  )!;
  assert.equal(amount.typeFailures, 1);
  assert.equal(context.relationships[0].matchedRows, 2);
});
test("renaming a sensitive source column cannot expose its values", async () => {
  const snapshot = fixture();
  const { snapshotSchema } = await import("./ai-proposal.ts");
  const schema = snapshotSchema(snapshot);
  schema.tables[0].columns[1].name = "identifier";
  const context = await prepareAiContext(snapshot, store, { schema });
  assert.ok(context.excludedColumnIds.includes("email"));
  assert.ok(!JSON.stringify(context).includes("example.com"));
});
