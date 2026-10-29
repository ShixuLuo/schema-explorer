import type { ModelEngine, WorkspaceStore } from "./ports.ts";
import type { CheckpointRange } from "../model/workspace.ts";
import {
  checkpointLabel,
  checkpointPath,
  defaultCheckpointRange,
} from "../model/history.ts";
import { schemaSpec } from "../model/wire.ts";

export type SelectedSql = {
  range: CheckpointRange;
  fromLabel: string;
  toLabel: string;
  migration: string | null;
  reason?: string;
};
const comment = (label: string) => label.replace(/[\r\n]/g, " ");
export async function exportSql(
  store: WorkspaceStore,
  engine: Pick<ModelEngine, "sql">,
  caseId: string,
  selection?: CheckpointRange,
): Promise<SelectedSql> {
  const { useCase } = await store.snapshot(caseId);
  const checkpoints = useCase.history.checkpoints;
  const range =
    selection ?? defaultCheckpointRange(checkpoints, useCase.history.editing);
  if (!range) throw new Error("Commit a change before exporting SQL.");
  const from =
    range.from === null ? null : checkpoints.find((c) => c.id === range.from);
  const to = checkpoints.find((c) => c.id === range.to);
  if ((range.from !== null && !from) || !to)
    throw new Error("The selected checkpoint no longer exists.");
  const base = from
    ? schemaSpec(
        from.state.tables,
        from.state.relationships,
        from.state.equations,
      )
    : { tables: [], foreign_keys: [] };
  const target = schemaSpec(
    to.state.tables,
    to.state.relationships,
    to.state.equations,
  );
  const path = checkpointPath(checkpoints, range);
  const recorded = path?.every((c) => c.operations !== undefined);
  let migration: string | null = null,
    reason: string | undefined;
  if (path && recorded) {
    const bundle = await engine.sql(
      base,
      path.flatMap((c) => c.operations!),
      target,
    );
    migration = bundle.changes;
  } else {
    reason = "No recorded forward migration connects these checkpoints.";
  }
  const latest = await store.readCase(caseId);
  if (!latest || (latest.revision ?? 0) !== (useCase.revision ?? 0))
    throw new Error("History changed during export. Open SQL export again.");
  const status = { editingId: latest.history.editing };
  const fromLabel = checkpointLabel(
      latest.history.checkpoints,
      range.from,
      status,
    ),
    toLabel = checkpointLabel(latest.history.checkpoints, range.to, status);
  return {
    range,
    fromLabel,
    toLabel,
    migration:
      migration !== null
        ? `-- From: ${comment(fromLabel)}\n-- To: ${comment(toLabel)}\n${to.state.tables.some((t) => t.dataStatus === "unverified") ? "-- Schema-only checkpoint: sample data has not been migrated or validated.\n-- Runtime data checks and constraints remain enabled. Failure aborts the transaction.\n" : ""}${migration}`
        : null,
    reason,
  };
}
