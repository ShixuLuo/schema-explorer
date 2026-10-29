import type {
  UseCase,
  CheckpointInfo,
  CheckpointRange,
} from "../model/workspace.ts";
import { checkpointLabel } from "../model/history.ts";
import { compareModels, type ModelComparison } from "../model/comparison.ts";
import type { WorkspaceStore } from "./ports.ts";

export type HistoryInfo = {
  editing: string | null;
  checkpoints: CheckpointInfo[];
};
export type SavedComparison = {
  beforeName: string;
  afterName: string;
  comparison: ModelComparison;
  range?: CheckpointRange;
};
export function historyInfo(useCase: UseCase): HistoryInfo {
  return {
    editing: useCase.history.editing,
    checkpoints: useCase.history.checkpoints.map(
      ({ state: _state, operations, legacyMigration: _legacy, ...info }) => ({
        ...info,
        tags: info.tags ? [...info.tags] : undefined,
        operationCount: info.operationCount ?? operations?.length,
      }),
    ),
  };
}
export async function restoreCheckpoint(
  store: WorkspaceStore,
  caseId: string,
  checkpointId: string,
) {
  const current = await store.readCase(caseId);
  if (!current) throw new Error("This use case no longer exists.");
  await store.commit(caseId, current.revision ?? 0, {
    kind: "restore",
    checkpointId,
  });
}
export async function compareCheckpoint(
  store: WorkspaceStore,
  caseId: string,
  checkpointId: string,
): Promise<SavedComparison> {
  const current = await store.snapshot(caseId),
    history = current.useCase.history;
  const target = history.checkpoints.find((c) => c.id === checkpointId);
  if (!target) throw new Error("This checkpoint no longer exists.");
  return {
    beforeName: checkpointLabel(history.checkpoints, target.id),
    afterName: history.editing
      ? `Editing: ${checkpointLabel(history.checkpoints, history.editing)}`
      : "Editing: empty model",
    ...(history.editing
      ? { range: { from: target.id, to: history.editing } }
      : {}),
    comparison: compareModels(
      {
        tables: target.state.tables,
        relationships: target.state.relationships,
        equations: target.state.equations,
      },
      {
        tables: current.tables,
        relationships: current.useCase.relationships,
        equations: current.useCase.equations,
      },
    ),
  };
}
