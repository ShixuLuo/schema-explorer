import assert from "node:assert/strict";
import test from "node:test";
import type { EditSummary } from "../application/preview.ts";
import { prepareAction } from "../application/preview.ts";
import { compareModels, type ModelView } from "../model/comparison.ts";
import { planCommands } from "../model/database-commands.ts";
import type { Operation } from "../model/operations.ts";
import { schemaSpec } from "../model/wire.ts";
import { planSteps } from "../schema/migration-plan.ts";
const column = (id: string) => ({
  id,
  name: id,
  index: 0,
  dataType: "text" as const,
  nullable: false,
  emptyCount: 0,
  distinctCount: 0,
  integerFailures: 0,
  formatChanges: 0,
});
const before: ModelView = {
  tables: [
    { id: "A", name: "A", rowCount: 0, columns: [column("code")] },
    {
      id: "B",
      name: "B",
      rowCount: 0,
      columns: [column("id")],
      primaryKey: ["id"],
    },
  ],
  relationships: [],
};
const summary = (
  operations: Operation[],
  plan?: EditSummary["plan"],
): EditSummary => ({
  operations,
  changedData: [],
  plan,
  steps: planCommands(
    schemaSpec(before.tables, before.relationships),
    operations,
  ).map((c, i) => prepareAction(c, operations[i], i)),
  comparison: compareModels(before, before),
  createdTables: [],
});
test("removal and rename report the actual delta; isolated object reports uppercase Pi/Sigma choices", () => {
  assert.equal(
    planSteps(summary([{ op: "drop_table", table_id: "A" }]))[0].migration,
    "Δ",
  );
  assert.equal(
    planSteps(
      summary([{ op: "drop_column", table_id: "A", column_id: "code" }]),
    )[0].migration,
    "Δ",
  );
  assert.equal(
    planSteps(
      summary([{ op: "rename_table", table_id: "A", new_name: "AA" }]),
    )[0].migration,
    "Δ",
  );
  const p = planSteps(
    summary([
      {
        op: "create_table",
        table: { id: "C", name: "C", columns: [], primaryKey: [] },
        method: "pi",
      },
    ]),
  )[0];
  assert.equal(p.migration, "Π · Unit");
  assert.ok(p.options.find((o) => o.method === "pi")?.enabled);
});
test("explicit reference lookup is not mislabeled as a Kan extension; replacement exposes delta followed by lookup", () => {
  const ref: Operation = {
    op: "add_foreign_key",
    table_id: "A",
    foreign_key: {
      id: "f",
      source_table: "A",
      source_columns: ["code"],
      target_table: "B",
      target_columns: ["id"],
    },
  };
  assert.equal(planSteps(summary([ref]))[0].migration, "Key lookup");

  const result = planSteps(
    summary(
      [
        ref,
        { op: "drop_foreign_key", table_id: "A", foreign_key_id: "f" },
        ref,
      ],
      [
        { start: 0, count: 1 },
        { start: 1, count: 2, label: "Edit arrow" },
      ],
    ),
  );
  assert.equal(result[1].migration, "Δ → Key lookup");
});
