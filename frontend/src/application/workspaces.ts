import type { Table } from "../model/schema.ts";
import { schemaSpec } from "../model/wire.ts";
import type { UseCase } from "../model/workspace.ts";
import type { WorkspaceSnapshot, WorkspaceStore } from "./ports.ts";
import type { PreparedEdit } from "./preview.ts";
export async function createUseCase(store: WorkspaceStore): Promise<UseCase> {
  const now = Date.now(),
    time = new Date(now - new Date(now).getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
  const useCase: UseCase = {
    id: crypto.randomUUID(),
    name: `newusecase ${time}`,
    createdAt: now,
    updatedAt: now,
    tableIds: [],
    positions: {},
    relationships: [],
    equations: [],
    revision: 0,
    modelVersion: 6,
    history: { checkpoints: [], editing: null },
  };
  await store.addCase(useCase);
  return useCase;
}
export async function applyEdit(store: WorkspaceStore, preview: PreparedEdit) {
  if (preview.pendingParameters?.length)
    throw new Error("Complete the action parameters before committing.");
  await store.commit(preview.caseId, preview.before.useCase.revision ?? 0, {
    kind: "checkpoint",
    state: {
      tables: preview.tables,
      relationships: preview.relationships,
      equations: preview.equations ?? [],
    },
    operations: preview.operations,
    description: `${preview.dataValidation === "unverified" ? "Schema only: " : ""}${preview.steps[0].title}${preview.operations.length > 1 ? ` +${preview.operations.length - 1}` : ""}`,
  });
}
export async function undoEdit(store: WorkspaceStore, id: string) {
  const current = await store.readCase(id);
  if (!current) throw new Error("This use case no longer exists.");
  await store.commit(id, current.revision ?? 0, { kind: "undo" });
}
export async function publishImport(
  store: WorkspaceStore,
  before: WorkspaceSnapshot,
  added: Table[],
) {
  await store.commit(before.useCase.id, before.useCase.revision ?? 0, {
    kind: "checkpoint",
    state: {
      tables: [...before.tables, ...added],
      relationships: before.useCase.relationships,
      equations: before.useCase.equations ?? [],
    },
    operations: added.map((t) => ({
      op: "create_table",
      table: schemaSpec([t], []).tables[0],
    })),
    description: `Import ${added.length} ${added.length === 1 ? "table" : "tables"}`,
    undoable: false,
  });
}
