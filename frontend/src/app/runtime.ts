import { createIndexedDbStore } from "../adapters/indexeddb-store.ts";
import { createRustHttpEngine } from "../adapters/rust-http.ts";
import {
  createUseCase,
  openUseCase,
  undoEdit,
} from "../application/workspaces.ts";
import {
  createEditActions,
  EditSession,
  type EditActions,
} from "../application/editor.ts";
import { exportSql } from "../application/export.ts";
import { runDataTask } from "./worker-client.ts";
import type { Progress } from "../application/ports.ts";

// The composition root is the only place that chooses browser adapters.
const store = createIndexedDbStore(),
  engine = createRustHttpEngine();
const direct = createEditActions(store, engine);
const actions: EditActions = {
  ...direct,
  async prepare(caseId, operations, progress, signal) {
    const result = await runDataTask(
      { kind: "prepare_edit", caseId, operations },
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
  open: (id: string) => openUseCase(store, id),
  patch: store.patchInfo,
  deleteEmpty: store.deleteEmpty,
  undo: (id: string) => undoEdit(store, id),
  readRows: store.readRows,
};
export const createEditorSession = (caseId: string, progress: Progress) =>
  new EditSession(caseId, actions, progress);
export const loadSql = (caseId: string) => exportSql(store, engine, caseId);
