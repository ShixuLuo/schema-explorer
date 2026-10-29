import test from "node:test";
import assert from "node:assert/strict";
import { EditSession, type EditActions } from "../application/editor.ts";
import { translateCommand } from "../model/database-commands.ts";
import type { Operation, SchemaSpec } from "../model/operations.ts";
import type { Table } from "../model/schema.ts";
import { AiPendingPreview } from "./ai-pending-preview.ts";
const schema: SchemaSpec = {
  tables: [
    {
      id: "t",
      name: "Customer",
      primaryKey: ["id"],
      columns: [
        {
          id: "id",
          name: "id",
          dataType: "text",
          nullable: false,
          storage: "identity",
        },
        {
          id: "email",
          name: "email_address",
          dataType: "text",
          nullable: true,
        },
        { id: "note", name: "note", dataType: "text", nullable: true },
      ],
    },
  ],
  foreign_keys: [],
};
const table = (s: SchemaSpec): Table[] =>
  s.tables.map((t) => ({
    ...t,
    caseId: "c",
    fileName: "",
    bytes: 0,
    rowCount: 0,
    columns: t.columns.map((c, index) => ({ ...c, index })),
  }));
test("temporary native preview shows accepted plus pending, reject preserves accepted session and publishes nothing", async () => {
  const published: Operation[][] = [],
    prepared: Operation[][] = [];
  const actions: EditActions = {
    async prepare(caseId, operations) {
      prepared.push(structuredClone(operations));
      const next = operations.reduce(
        (s, o) => translateCommand(s, o).after,
        schema,
      );
      return {
        caseId,
        before: {
          useCase: { id: "c", revision: 0, relationships: [], equations: [] },
          tables: table(schema),
        },
        operations,
        tables: table(next),
        relationships: next.foreign_keys,
        changedData: [],
        steps: [],
      };
    },
    async apply(p) {
      published.push(p.operations);
    },
    async discard() {},
    async readRows() {
      return [];
    },
  };
  const accepted = new EditSession("c", actions, () => {}),
    first: Operation = {
      op: "rename_column",
      table_id: "t",
      column_id: "email",
      new_name: "email",
      method: null,
    },
    pending: Operation = {
      op: "rename_column",
      table_id: "t",
      column_id: "note",
      new_name: "description",
      method: null,
    };
  const current = await accepted.append([first]);
  const temporary = new AiPendingPreview();
  const preview = await temporary.show(
    "pending",
    "base",
    current,
    [pending],
    () => new EditSession("c", actions, () => {}),
    "Rename note",
  );
  assert.equal(
    preview?.comparison.after.tables[0].columns[2].name,
    "description",
  );
  assert.equal(current.comparison.after.tables[0].columns[2].name, "note");
  assert.equal(published.length, 0);
  assert.equal(prepared.at(-1)?.length, 2);
  assert.deepEqual(temporary.pendingOperations("pending", "base"), [pending]);
  temporary.clear();
  assert.equal(temporary.pendingOperations("pending", "base"), null);
  await accepted.commit();
  assert.deepEqual(published, [[first]]);
});
test("accept uses pending operations only, never appends accepted prefix twice", async () => {
  const calls: Operation[][] = [];
  const actions: EditActions = {
    async prepare(caseId, operations) {
      calls.push(structuredClone(operations));
      const next = operations.reduce(
        (s, o) => translateCommand(s, o).after,
        schema,
      );
      return {
        caseId,
        before: {
          useCase: { id: "c", revision: 0, relationships: [] },
          tables: table(schema),
        },
        operations,
        tables: table(next),
        relationships: [],
        changedData: [],
        steps: [],
      };
    },
    async apply() {},
    async discard() {},
    async readRows() {
      return [];
    },
  };
  const real = new EditSession("c", actions, () => {}),
    first: Operation = {
      op: "rename_column",
      table_id: "t",
      column_id: "email",
      new_name: "email",
      method: null,
    },
    second: Operation = {
      op: "rename_column",
      table_id: "t",
      column_id: "note",
      new_name: "description",
      method: null,
    };
  const current = await real.append([first]),
    temporary = new AiPendingPreview();
  await temporary.show(
    "__all_pending__",
    "base",
    current,
    [second],
    () => new EditSession("c", actions, () => {}),
    "Rename note",
    { next: [second] },
  );
  const accepted = temporary.pendingOperations("next", "base")!;
  temporary.clear();
  await real.append(accepted);
  assert.deepEqual(calls.at(-1), [first, second]);
});
