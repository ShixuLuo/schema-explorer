import { prepareEdit } from "./edit.ts";
import { applyEdit } from "./workspaces.ts";
import { schemaSpec } from "../model/wire.ts";
import type { Operation } from "../model/operations.ts";
import type { ModelEngine, Progress, WorkspaceStore } from "./ports.ts";
import type { EditSummary, PreparedEdit } from "./preview.ts";

export type EditActions = {
  prepare(
    caseId: string,
    operations: Operation[],
    progress: Progress,
    signal: AbortSignal,
  ): Promise<PreparedEdit>;
  apply(preview: PreparedEdit): Promise<void>;
  discard(preview: PreparedEdit): Promise<void>;
};
export function createEditActions(
  store: WorkspaceStore,
  engine: ModelEngine,
): EditActions {
  return {
    async prepare(caseId, operations, progress, signal) {
      signal.throwIfAborted();
      const preview = await prepareEdit(
        store,
        engine,
        caseId,
        operations,
        progress,
      );
      if (signal.aborted) {
        await store.discard(preview.tables);
        signal.throwIfAborted();
      }
      return preview;
    },
    apply: (preview) => applyEdit(store, preview),
    discard: (preview) => store.discard(preview.tables),
  };
}

// A session owns a prepared change's lifetime. UI sees only a display summary;
// the worker, staging references, revision binding and commit remain private.
export class EditSession {
  private candidate: PreparedEdit | null = null;
  private abort: AbortController | null = null;
  private caseId: string;
  private actions: EditActions;
  private progress: Progress;
  constructor(caseId: string, actions: EditActions, progress: Progress) {
    this.caseId = caseId;
    this.actions = actions;
    this.progress = progress;
  }
  async prepare(operations: Operation[]): Promise<EditSummary> {
    await this.discard();
    const abort = new AbortController();
    this.abort = abort;
    try {
      const preview = await this.actions.prepare(
        this.caseId,
        operations,
        this.progress,
        abort.signal,
      );
      this.candidate = preview;
      const created = new Set(
        operations.flatMap((op) =>
          op.op === "create_table" ? [op.table.id] : [],
        ),
      );
      return {
        reports: preview.reports,
        samples: preview.samples,
        removedRelationships: preview.removedRelationships,
        createdTables: schemaSpec(
          preview.tables,
          preview.relationships,
        ).tables.filter((t) => created.has(t.id)),
      };
    } finally {
      this.abort = null;
    }
  }
  async apply() {
    if (!this.candidate)
      throw new Error("Preview this edit before applying it.");
    await this.actions.apply(this.candidate);
    this.candidate = null;
  }
  async discard() {
    const current = this.candidate;
    this.candidate = null;
    if (current) await this.actions.discard(current).catch(() => {});
  }
  dispose() {
    this.abort?.abort();
    void this.discard();
  }
}
