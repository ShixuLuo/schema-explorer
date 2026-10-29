import { compareModels } from "../model/comparison.ts";
import { translateCommand } from "../model/database-commands.ts";
import {
  assertMigrationChoice,
  type MigrationMethod,
} from "../model/migration-options.ts";
import type { Operation } from "../model/operations.ts";
import { recordedOperation } from "../model/operations.ts";
import type { Table } from "../model/schema.ts";
import { schemaSpec } from "../model/wire.ts";
import { prepareEdit } from "./edit.ts";
import type {
  EditBase,
  ModelEngine,
  Progress,
  WorkspaceStore,
} from "./ports.ts";
import type { EditSummary, PreparedEdit } from "./preview.ts";
import { inferPlanGroups, type PlanGroup } from "./preview.ts";
import { applyEdit } from "./workspaces.ts";

export type EditActions = {
  prepare(
    caseId: string,
    operations: Operation[],
    progress: Progress,
    signal: AbortSignal,
    base?: EditBase,
    schemaOnly?: boolean,
  ): Promise<PreparedEdit>;
  apply(preview: PreparedEdit): Promise<void>;
  discard(preview: PreparedEdit): Promise<void>;
  readRows(
    table: Table,
    offset: number,
    limit?: number,
  ): ReturnType<WorkspaceStore["readRows"]>;
};
export function createEditActions(
  store: WorkspaceStore,
  engine: ModelEngine,
): EditActions {
  return {
    async prepare(caseId, operations, progress, signal, base, schemaOnly) {
      signal.throwIfAborted();
      const result = await prepareEdit(
        store,
        engine,
        caseId,
        operations,
        progress,
        base,
        schemaOnly,
      );
      if (signal.aborted) {
        await store.discard(result.tables);
        signal.throwIfAborted();
      }
      return result;
    },
    apply: (preview) => applyEdit(store, preview),
    discard: (preview) => store.discard(preview.tables),
    readRows: store.readRows,
  };
}
export class EditSession {
  private candidate: PreparedEdit | null = null;
  private abort: AbortController | null = null;
  private working = false;
  private caseId: string;
  private actions: EditActions;
  private progress: Progress;
  constructor(caseId: string, actions: EditActions, progress: Progress) {
    this.caseId = caseId;
    this.actions = actions;
    this.progress = progress;
  }
  static resume(
    previous: EditSession,
    actions: EditActions,
    progress: Progress,
  ) {
    if (previous.working) throw new Error("Wait for the current preview.");
    if (Object.getPrototypeOf(previous) === EditSession.prototype) {
      previous.actions = actions;
      previous.progress = progress;
      return previous;
    }
    const next = new EditSession(previous.caseId, actions, progress);
    next.candidate = previous.candidate;
    if (next.candidate)
      next.candidate.operations =
        next.candidate.operations.map(recordedOperation);
    previous.candidate = null;
    previous.abort?.abort();
    return next;
  }
  async append(operations: Operation[], schemaOnly = false, label?: string) {
    operations = operations.map((op) =>
      [
        "create_table",
        "add_reference",
        "add_foreign_key",
        "add_equation",
        "rename_table",
        "rename_column",
        "rename_arrow",
      ].includes(op.op) && !("method" in op)
        ? ({ ...op, method: null } as Operation)
        : op,
    );
    const previous = this.candidate?.operations ?? [];
    const plan = [
      ...(this.candidate?.plan ?? inferPlanGroups(previous)),
      {
        start: previous.length,
        count: operations.length,
        ...(label ? { label } : {}),
      },
    ];
    return this.replace(
      [...previous, ...operations],
      schemaOnly || this.candidate?.dataValidation === "unverified",
      plan,
    );
  }
  async chooseMethod(
    index: number,
    method: MigrationMethod,
    schemaOnly = false,
  ) {
    const operations = structuredClone(this.candidate?.operations ?? []),
      operation = operations[index];
    if (
      operation?.op !== "combine_tables" &&
      operation?.op !== "add_reference" &&
      operation?.op !== "add_foreign_key" &&
      operation?.op !== "add_equation" &&
      operation?.op !== "rename_table" &&
      operation?.op !== "rename_column" &&
      operation?.op !== "rename_arrow" &&
      !(
        operation?.op === "create_table" &&
        operation.table.columns.every((c) => c.generated === "identity")
      )
    )
      throw new Error("This operation has no alternative migration method.");
    if (!this.candidate) throw new Error("There is no active draft.");
    let schema = schemaSpec(
      this.candidate.before.tables,
      this.candidate.before.useCase.relationships,
      this.candidate.before.useCase.equations,
    );
    for (const prior of operations.slice(0, index))
      schema = translateCommand(schema, prior).after;
    assertMigrationChoice(schema, operation, method);
    if (
      method === "delta" &&
      !["rename_table", "rename_column", "rename_arrow"].includes(operation.op)
    )
      throw new Error("Configure the mapping parameters for this migration.");
    operation.method = method as never;
    return this.replace(
      operations,
      schemaOnly || this.candidate?.dataValidation === "unverified",
    );
  }
  async configureAttribute(
    index: number,
    parameters: import("../model/operations.ts").MigrationParameters,
    schemaOnly = false,
  ) {
    if (!this.candidate) throw new Error("There is no active draft.");
    const operations = structuredClone(this.candidate.operations),
      op = operations[index];
    if (parameters.template === "path") {
      if (op?.op !== "add_reference")
        throw new Error("This action has no arrow-path parameter.");
      operations[index] = {
        ...op,
        method: "delta",
        image: structuredClone(parameters.path),
      };
      return this.replace(
        operations,
        schemaOnly || this.candidate.dataValidation === "unverified",
      );
    }
    if (op?.op !== "add_attribute" && op?.op !== "add_column")
      throw new Error("This action has no attribute parameters.");
    operations[index] = {
      op: "add_attribute",
      table_id: op.table_id,
      column: { ...op.column, nullable: true },
      parameters: structuredClone(parameters),
    };
    return this.replace(
      operations,
      schemaOnly || this.candidate.dataValidation === "unverified",
    );
  }
  private async replace(
    operations: Operation[],
    schemaOnly = this.candidate?.dataValidation === "unverified",
    plan: PlanGroup[] = this.candidate?.plan ?? inferPlanGroups(operations),
  ): Promise<EditSummary> {
    if (this.working) throw new Error("Wait for the current preview.");
    this.working = true;
    const previous = this.candidate,
      abort = new AbortController();
    this.abort = abort;
    try {
      const preview = await this.actions.prepare(
        this.caseId,
        structuredClone(operations),
        this.progress,
        abort.signal,
        previous?.before,
        schemaOnly,
      );
      if (abort.signal.aborted) {
        await this.actions.discard(preview);
        abort.signal.throwIfAborted();
      }
      preview.plan = structuredClone(plan);
      this.candidate = preview;
      if (previous) await this.actions.discard(previous);
      const beforeIds = new Set(preview.before.tables.map((t) => t.id));
      return {
        steps: preview.steps,
        changedData: preview.changedData,
        comparison: compareModels(
          {
            tables: preview.before.tables,
            relationships: preview.before.useCase.relationships,
            equations: preview.before.useCase.equations,
          },
          {
            tables: preview.tables,
            relationships: preview.relationships,
            equations: preview.equations,
          },
        ),
        ...(preview.pendingParameters?.length
          ? { pendingParameters: structuredClone(preview.pendingParameters) }
          : {}),
        plan: structuredClone(plan),
        ...(preview.dataValidation
          ? { dataValidation: preview.dataValidation }
          : {}),
        operations: structuredClone(preview.operations),
        createdTables: schemaSpec(
          preview.tables,
          preview.relationships,
        ).tables.filter((t) => !beforeIds.has(t.id)),
      };
    } finally {
      this.abort = null;
      this.working = false;
    }
  }
  async readRows(
    tableId: string,
    offset: number,
    limit?: number,
    side: "before" | "after" = "after",
  ) {
    if (this.candidate?.pendingParameters?.length)
      throw new Error("Complete the action parameters to preview data.");
    const tables =
      side === "before"
        ? this.candidate?.before.tables
        : this.candidate?.tables;
    const table = tables?.find((t) => t.id === tableId);
    if (!table) return [];
    return this.actions.readRows(table, offset, limit);
  }
  async commit() {
    if (this.working) throw new Error("Wait for the current preview.");
    if (!this.candidate)
      throw new Error("There are no draft changes to commit.");
    if (this.candidate.pendingParameters?.length)
      throw new Error("Complete the action parameters before committing.");
    this.working = true;
    try {
      await this.actions.apply(this.candidate);
      this.candidate = null;
    } finally {
      this.working = false;
    }
  }
  async rollback() {
    if (this.working) throw new Error("Wait for the current preview.");
    const candidate = this.candidate;
    this.candidate = null;
    if (candidate) await this.actions.discard(candidate);
  }
  dispose() {
    this.abort?.abort();
    const candidate = this.candidate;
    this.candidate = null;
    if (candidate) void this.actions.discard(candidate);
  }
}
