import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryStore } from "../adapters/memory-store.ts";
import { createUseCase } from "./workspaces.ts";
import { prepareEdit } from "./edit.ts";
import type { ModelEngine } from "./ports.ts";
import type { Table } from "../model/schema.ts";

async function fixture() {
  const store = createMemoryStore();
  const useCase = await createUseCase(store);
  const table: Table = {
    id: "records",
    caseId: useCase.id,
    name: "Records",
    fileName: "",
    bytes: 0,
    rowCount: 0,
    columns: [
      {
        id: "key",
        name: "id",
        index: 0,
        dataType: "text",
        nullable: false,
        storage: "identity",
      },
      {
        id: "label",
        name: "label",
        index: 1,
        dataType: "text",
        nullable: false,
      },
    ],
    primaryKey: ["key"],
  };
  const writer = store.stage(table);
  await writer.append([["0012", "Alpha"]]);
  const saved = await writer.finish(table);
  await store.commit(useCase.id, 0, {
    kind: "checkpoint",
    operations: [],
    description: "Imported data",
    state: { tables: [saved], relationships: [], equations: [] },
  });
  const engine = {
    sql: async () => {
      throw Error("Legacy SQL must not run during a structural draft");
    },
    evaluate: async () => {
      throw Error("Data must not run before the migration wizard");
    },
  } as ModelEngine;
  return { store, caseId: useCase.id, engine };
}

test("structural edit keeps data and history intact and never compiles the legacy migration", async () => {
  const { store, caseId, engine } = await fixture();
  const before = await store.snapshot(caseId);
  const preview = await prepareEdit(
    store,
    engine,
    caseId,
    [
      {
        op: "rename_column",
        table_id: "records",
        column_id: "label",
        new_name: "description",
        method: "delta",
      },
    ],
    () => {},
    undefined,
    true,
  );
  assert.equal(preview.tables[0].columns[1].name, "description");
  assert.equal(preview.dataValidation, "unverified");
  assert.equal(preview.pendingParameters, undefined);
  assert.deepEqual(preview.steps, []);
  assert.deepEqual(await store.snapshot(caseId), before);
  assert.deepEqual(await store.readRows(before.tables[0], 0), [
    ["0012", "Alpha"],
  ]);
  await store.close();
});

test("structure still validates bindings without requiring Sigma/Delta/Pi", async () => {
  const { store, caseId, engine } = await fixture();
  const created = await prepareEdit(
    store,
    engine,
    caseId,
    [
      {
        op: "create_table",
        table: {
          id: "next",
          name: "Next",
          columns: [
            {
              id: "next-key",
              name: "_id",
              dataType: "integer",
              nullable: false,
              generated: "identity",
            },
          ],
          primaryKey: ["next-key"],
        },
        method: null,
      },
    ],
    () => {},
    undefined,
    true,
  );
  assert.equal(created.pendingParameters, undefined);
  assert.equal(created.tables.length, 2);
  await assert.rejects(
    prepareEdit(
      store,
      engine,
      caseId,
      [
        {
          op: "rename_column",
          table_id: "records",
          column_id: "label",
          new_name: "id",
          method: "delta",
        },
      ],
      () => {},
      undefined,
      true,
    ),
    /unique/,
  );
  await store.close();
});
