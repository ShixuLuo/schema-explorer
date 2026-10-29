import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SchemaSpec } from "../model/operations.ts";
import type {
  WorkspaceSnapshot,
  WorkspaceStore,
} from "../application/ports.ts";
import type { CellValue } from "../model/schema.ts";
import { translateCommand } from "../model/database-commands.ts";
import { databasePresentation } from "../model/database-presentation.ts";
import {
  demoSuggestions,
  demoExample,
  type DemoFixture,
} from "./ai-demo-provider.ts";
import { prepareAiContext } from "../ai/ai-context.ts";
import { pendingPreviewPlan } from "../ai/ai-default-preview.ts";
const alternative: DemoFixture = {
  name: "Asset / Usage",
  inputs: [
    {
      fileName: "Asset.csv",
      primaryKey: "asset_id",
      csv: "asset_id,asset_label\n1,Valve\n2,Pump\n",
    },
    {
      fileName: "Usage.csv",
      primaryKey: "usage_id",
      csv: "usage_id,asset_key,amount_text\n10,1,17\n11,2,\n12,999,5\n",
    },
  ],
  recommendations: [
    {
      kind: "rename_attribute",
      id: "label",
      tableName: "Asset",
      columnName: "asset_label",
      name: "label",
    },
    {
      kind: "link_attribute",
      id: "asset-link",
      tableName: "Usage",
      columnName: "asset_key",
      targetTableName: "Asset",
      name: "asset",
    },
  ],
};
const schema: SchemaSpec = {
  tables: [
    {
      id: "a",
      name: "Asset",
      primaryKey: ["aid"],
      columns: [
        {
          id: "aid",
          name: "asset_id",
          dataType: "integer",
          nullable: false,
          storage: "identity",
        },
        { id: "label", name: "asset_label", dataType: "text", nullable: true },
      ],
    },
    {
      id: "u",
      name: "Usage",
      primaryKey: ["uid"],
      columns: [
        {
          id: "uid",
          name: "usage_id",
          dataType: "integer",
          nullable: false,
          storage: "identity",
        },
        { id: "key", name: "asset_key", dataType: "integer", nullable: true },
        { id: "amount", name: "amount_text", dataType: "text", nullable: true },
      ],
    },
  ],
  foreign_keys: [],
  equations: [],
};
test("a second concrete domain uses the same abstract demo provider, profile and native preview path", async () => {
  const groups = demoSuggestions(
    { schema, iteration: 1, hasPriorSuggestions: false },
    alternative,
  );
  assert.equal(groups.length, 2);
  assert.equal(groups[0].title, "Rename asset_label → label");
  assert.equal(groups[1].title, "Link Usage → Asset");
  const rows: Record<string, CellValue[][]> = {
    a: [
      ["1", "Valve"],
      ["2", "Pump"],
    ],
    u: [
      ["10", "1", "17"],
      ["11", "2", null],
      ["12", "999", "5"],
    ],
  };
  const tables = schema.tables.map((t) => ({
    ...t,
    caseId: "case",
    fileName: "",
    bytes: 0,
    rowCount: rows[t.id].length,
    columns: t.columns.map((c, index) => ({ ...c, index })),
  }));
  const snapshot = {
    tables,
    useCase: { id: "case", revision: 1, relationships: [], equations: [] },
  } as unknown as WorkspaceSnapshot;
  const store: Pick<WorkspaceStore, "rows"> = {
    async *rows(t) {
      yield { offset: 0, rows: rows[t.id] };
    },
  };
  const context = await prepareAiContext(snapshot, store);
  assert.equal(context.profiles[0].scannedRows, 2);
  assert.equal(context.profiles[1].scannedRows, 3);
  assert.equal(
    context.profiles[1].columns.find((c) => c.columnId === "amount")?.nullCount,
    1,
  );
  assert.equal(
    context.profiles[1].columns.find((c) => c.columnId === "key")
      ?.distinctCount,
    3,
  );
  const plan = pendingPreviewPlan(
    { round: 1, suggestions: groups.map((g) => ({ ...g, status: "pending" })) },
    schema,
  );
  assert.equal(plan.groupIds.length, 2);
  const after = plan.operations.reduce(
    (s, o) => translateCommand(s, o).after,
    schema,
  );
  assert.equal(after.tables[0].columns[1].name, "label");
  assert.equal(after.foreign_keys[0].target_table, "a");
  assert.ok(after.tables[1].columns.some((c) => c.storage === "reference"));
  assert.ok(
    !databasePresentation(after).arrows.some((a) => a.id === "attribute:key"),
  );
  assert.equal(schema.tables[0].columns[1].name, "asset_label");
  assert.equal(schema.foreign_keys.length, 0);
  const example = demoExample(alternative);
  assert.equal(example.name, alternative.name);
  assert.equal(await example.files[0].file.text(), alternative.inputs[0].csv);
});
test("core orchestration contains no fixture business names and only dynamically imports behind development flags", () => {
  for (const file of ["../app/App.tsx", "../app/runtime.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /Customer|Order|email_address|customer_id|total_cents|example\.test/,
    );
    assert.match(source, /import\.meta\.env\.DEV/);
    assert.match(
      source,
      /await import\(['"]\.\.\/dev-fixtures\/ai-demo-provider\.ts['"]\)/,
    );
    assert.doesNotMatch(source, /^import .*dev-fixtures/m);
  }
});
