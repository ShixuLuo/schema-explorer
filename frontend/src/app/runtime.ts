export { readCsvHeaders } from "../adapters/csv.ts";
import { schemaSpec } from "../model/wire.ts";
import { createIndexedDbStore } from "../adapters/indexeddb-store.ts";
import {
  createUseCase,
  undoEdit,
  applyEdit,
} from "../application/workspaces.ts";
import { sqlBundle } from "../adapters/postgres-compiler.ts";
import type { ModelEngine } from "../application/ports.ts";
import { EditSession, type EditActions } from "../application/editor.ts";
import {
  restoreCheckpoint,
  compareCheckpoint,
} from "../application/history.ts";
import { exportSql } from "../application/export.ts";
import { runDataTask } from "./worker-client.ts";
import type { CheckpointRange } from "../model/workspace.ts";
import type { Progress } from "../application/ports.ts";

// The composition root is the only place that chooses browser adapters.
const store = createIndexedDbStore();
const sqlCompiler: Pick<ModelEngine, "sql"> = {
  sql: async (base, operations, current) =>
    sqlBundle(base, operations, current),
};
const actions: EditActions = {
  apply: (preview) => applyEdit(store, preview),
  discard: (preview) => store.discard(preview.tables),
  readRows: store.readRows,
  async prepare(caseId, operations, progress, signal, base, schemaOnly) {
    const result = await runDataTask(
      { kind: "prepare_edit", caseId, operations, base, schemaOnly },
      progress,
      signal,
    );
    if (result.kind !== "edit_preview")
      throw new Error("The edit did not produce a preview.");
    return result.preview;
  },
};
export const workspace = {
  list: () => store.listCases(),
  create: () => createUseCase(store),
  open: store.load,
  patch: store.patchInfo,
  deleteEmpty: store.deleteEmpty,
  undo: (id: string) => undoEdit(store, id),
  readRows: store.readRows,
};
export const createEditorSession = (
  caseId: string,
  progress: Progress,
  previous?: EditSession | null,
) =>
  previous
    ? EditSession.resume(previous, actions, progress)
    : new EditSession(caseId, actions, progress);
export const loadSql = (caseId: string, range: CheckpointRange) =>
  exportSql(store, sqlCompiler, caseId, range);

export const history = {
  addTag: (id: string, checkpointId: string, tag: string) =>
    store.updateTags(id, { kind: "add", checkpointId, tag }),
  removeTag: (id: string, checkpointId: string, tag: string) =>
    store.updateTags(id, { kind: "remove", checkpointId, tag }),
  restore: (id: string, checkpointId: string) =>
    restoreCheckpoint(store, id, checkpointId),
  compare: (id: string, checkpointId: string) =>
    compareCheckpoint(store, id, checkpointId),
};

// Experiment only: a new case on this origin; never replaces an existing model.
export async function createTutorialSample() {
  const useCase = await createUseCase(store);
  const staged: import("../model/schema.ts").Table[] = [];
  const writers: import("../application/ports.ts").RowWriter[] = [];
  const customer = crypto.randomUUID(),
    order = crypto.randomUUID();
  const customerId = crypto.randomUUID(),
    customerName = crypto.randomUUID();
  const orderId = crypto.randomUUID(),
    orderCustomer = crypto.randomUUID(),
    total = crypto.randomUUID();
  const definitions = [
    {
      id: customer,
      name: "Customer",
      columns: [
        {
          id: customerId,
          name: "id",
          dataType: "integer" as const,
          nullable: false,
          index: 0,
        },
        {
          id: customerName,
          name: "name",
          dataType: "text" as const,
          nullable: false,
          index: 1,
        },
      ],
      primaryKey: [customerId],
      rows: [
        ["1", "Ada"],
        ["2", "Lin"],
      ],
    },
    {
      id: order,
      name: "Order",
      columns: [
        {
          id: orderId,
          name: "id",
          dataType: "integer" as const,
          nullable: false,
          index: 0,
        },
        {
          id: orderCustomer,
          name: "customer_id",
          dataType: "integer" as const,
          nullable: false,
          index: 1,
        },
        {
          id: total,
          name: "total_cents",
          dataType: "integer" as const,
          nullable: false,
          index: 2,
        },
      ],
      primaryKey: [orderId],
      rows: [["101", "1", "2599"]],
    },
  ];
  try {
    for (const { rows, ...definition } of definitions) {
      const table = {
        ...definition,
        caseId: useCase.id,
        fileName: "",
        bytes: 0,
        rowCount: 0,
      };
      const writer = store.stage(table);
      writers.push(writer);
      await writer.append(rows);
      staged.push(await writer.finish(table));
    }
    const foreignKey = {
      id: crypto.randomUUID(),
      name: "customer",
      source_table: order,
      source_columns: [orderCustomer],
      target_table: customer,
      target_columns: [customerId],
    };
    const specs = schemaSpec(staged, [foreignKey]);
    await store.commit(useCase.id, 0, {
      kind: "checkpoint",
      description: "Tutorial sample",
      state: { tables: staged, relationships: [foreignKey], equations: [] },
      operations: [
        ...specs.tables.map((table) => ({
          op: "create_table" as const,
          table,
        })),
        { op: "add_foreign_key", table_id: order, foreign_key: foreignKey },
      ],
    });
    await store.patchInfo(useCase.id, { name: "Bookshop · Tutorial" });
    return useCase.id;
  } catch (error) {
    await Promise.allSettled(writers.map((writer) => writer.abort()));
    await store.discard(staged);
    await store.deleteEmpty(useCase.id);
    throw error;
  }
}
