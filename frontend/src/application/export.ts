import type { ModelEngine, WorkspaceStore } from "./ports.ts";
import { schemaSpec } from "../model/wire.ts";

export async function exportSql(
  store: WorkspaceStore,
  engine: ModelEngine,
  caseId: string,
) {
  const snapshot = await store.snapshot(caseId),
    { useCase, tables } = snapshot;
  const current = schemaSpec(tables, useCase.relationships);
  const history = useCase.migration ?? { base: current, operations: [] };
  const sql = await engine.sql(history.base, history.operations, current);
  const latest = await store.readCase(caseId);
  if (!latest || (latest.revision ?? 0) !== (useCase.revision ?? 0))
    throw new Error("The model changed during export. Open SQL export again.");
  return sql;
}
