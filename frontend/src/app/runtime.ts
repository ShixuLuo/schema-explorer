export { readCsvHeaders } from "../adapters/csv.ts";
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
