import type { UseCase } from "../model/workspace.ts";
import type { Table, Relation } from "../model/schema.ts";
import { schemaSpec } from "../model/wire.ts";
import type {
  WorkspaceStore,
  WorkspaceSnapshot,
  ModelUpdate,
} from "./ports.ts";
import type { PreparedEdit } from "./preview.ts";

export async function createUseCase(store: WorkspaceStore): Promise<UseCase> {
  const now = Date.now();
  const time = new Date(now - new Date(now).getTimezoneOffset() * 60_000)
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
    candidates: [],
    dismissed: [],
    analysis: { checkedPairs: 0, limited: false },
    revision: 0,
    modelVersion: 2,
  };
  await store.addCase(useCase);
  return useCase;
}
export async function openUseCase(
  store: WorkspaceStore,
  id: string,
): Promise<WorkspaceSnapshot> {
  await store.patchInfo(id, {});
  return store.snapshot(id);
}
function historyLimit(count: number) {
  if (count > 256)
    throw new Error("Migration history is limited to 256 operations.");
}

// History and Undo are application policies, not storage implementation details.
export async function applyEdit(store: WorkspaceStore, preview: PreparedEdit) {
  const before = preview.before;
  const migration = before.useCase.migration ?? {
    base: schemaSpec(before.tables, before.useCase.relationships),
    operations: [],
  };
  historyLimit(migration.operations.length + preview.operations.length);
  const update: ModelUpdate = {
    tables: preview.tables,
    relationships: preview.relationships,
    candidates: preview.candidates,
    analysis: preview.analysis,
    migration: {
      ...migration,
      operations: [...migration.operations, ...preview.operations],
    },
    undo: {
      tables: before.tables,
      relationships: before.useCase.relationships,
      candidates: before.useCase.candidates,
      analysis: before.useCase.analysis,
      migration: before.useCase.migration,
      description: preview.reports.map((r) => r.description).join("; "),
    },
  };
  await store.commit(preview.caseId, before.useCase.revision ?? 0, update);
}
export async function undoEdit(store: WorkspaceStore, id: string) {
  const { useCase } = await store.snapshot(id),
    snapshot = useCase.undo;
  if (!snapshot) throw new Error("There is no edit to undo.");
  await store.commit(id, useCase.revision ?? 0, {
    tables: snapshot.tables,
    relationships: snapshot.relationships ?? [],
    candidates: snapshot.candidates,
    analysis: snapshot.analysis,
    migration: snapshot.migration,
    undo: undefined,
  });
}
export async function publishImport(
  store: WorkspaceStore,
  before: WorkspaceSnapshot,
  added: Table[],
  candidates: Relation[],
  analysis: UseCase["analysis"],
) {
  const migration = before.useCase.migration;
  const operations = added.map((t) => ({
    op: "create_table" as const,
    table: schemaSpec([t], []).tables[0],
  }));
  if (migration) historyLimit(migration.operations.length + operations.length);
  await store.commit(before.useCase.id, before.useCase.revision ?? 0, {
    tables: [...before.tables, ...added],
    relationships: before.useCase.relationships,
    candidates,
    analysis,
    migration: migration
      ? { ...migration, operations: [...migration.operations, ...operations] }
      : undefined,
    undo: undefined,
  });
}
