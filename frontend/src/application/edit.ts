import { pendingAttributes } from "../model/attribute-template.ts";
import { planCommands } from "../model/database-commands.ts";
import type { Operation, TableSpec } from "../model/operations.ts";
import type { Column, Table } from "../model/schema.ts";
import { schemaSpec } from "../model/wire.ts";
import { LIMITS } from "./limits.ts";
import type {
  EditBase,
  ModelEngine,
  Progress,
  RowWriter,
  WorkspaceStore,
} from "./ports.ts";
import type { PreparedEdit } from "./preview.ts";
import { prepareAction } from "./preview.ts";

function metadata(spec: TableSpec, before: Table[], caseId: string): Table {
  const old = before.find((t) => t.id === spec.id);
  return {
    ...(old ?? {
      id: spec.id,
      caseId,
      name: spec.name,
      fileName: "",
      bytes: 0,
      rowCount: 0,
      columns: [],
    }),
    name: spec.name,
    primaryKey: spec.primaryKey,
    ...(spec.uniqueKeys?.length
      ? { uniqueKeys: structuredClone(spec.uniqueKeys) }
      : old?.uniqueKeys
        ? { uniqueKeys: undefined }
        : {}),
    columns: spec.columns.map((c, index): Column => ({
      ...old?.columns.find((x) => x.id === c.id),
      id: c.id,
      name: c.name,
      index,
      dataType: c.dataType,
      nullable: c.nullable,
      generated: c.generated,
      storage: c.storage,
    })),
  };
}
export async function prepareEdit(
  store: WorkspaceStore,
  engine: ModelEngine,
  caseId: string,
  operations: Operation[],
  progress: Progress,
  base?: EditBase,
  schemaOnly = false,
): Promise<PreparedEdit> {
  if (!operations.length) throw new Error("Add a change first.");
  const snapshot = base ?? (await store.snapshot(caseId));
  const before: EditBase = structuredClone({
    tables: snapshot.tables,
    useCase: {
      id: snapshot.useCase.id,
      revision: snapshot.useCase.revision,
      relationships: snapshot.useCase.relationships,
      equations: snapshot.useCase.equations,
    },
  });
  if (before.useCase.id !== caseId)
    throw new Error("The draft belongs to another use case.");
  const pendingParameters = pendingAttributes(operations);
  if (
    pendingParameters.length ||
    schemaOnly ||
    before.tables.some((t) => t.dataStatus === "unverified")
  ) {
    progress("Checking schema…");
    const input = schemaSpec(
      before.tables,
      before.useCase.relationships,
      before.useCase.equations,
    );
    const changes = planCommands(input, operations),
      schema = changes.at(-1)!.after;
    // Compile the complete migration, retaining all runtime checks. Invalid
    // schema/bindings cannot be overridden merely by skipping sample execution.
    if (!pendingParameters.length) await engine.sql(input, operations, schema);
    const tables = schema.tables.map((spec) => ({
      ...metadata(spec, before.tables, caseId),
      rowCount: 0,
      dataStatus: "unverified" as const,
    }));
    const relationships = schema.foreign_keys;
    return {
      caseId,
      changedData: [],
      steps: changes.map((change, i) =>
        prepareAction(change, operations[i], i),
      ),
      before,
      operations: structuredClone(operations),
      tables,
      relationships,
      equations: schema.equations ?? [],
      ...(pendingParameters.length
        ? { pendingParameters }
        : { dataValidation: "unverified" as const }),
    };
  }
  const staged = new Map<string, Table>(),
    writers: RowWriter[] = [];
  try {
    const result = await engine.evaluate(
      schemaSpec(
        before.tables,
        before.useCase.relationships,
        before.useCase.equations,
      ),
      operations,
      (tableId) => {
        const table = before.tables.find((t) => t.id === tableId);
        if (!table) throw new Error("The source table is missing.");
        return store.rows(table);
      },
      async (spec, batches) => {
        const table = metadata(spec, before.tables, caseId),
          writer = store.stage(table);
        writers.push(writer);
        for await (const batch of batches) {
          await writer.append(batch.rows);
        }
        staged.set(table.id, await writer.finish(table));
      },
      progress,
    );
    const tables = result.schema.tables.map(
      (spec) => staged.get(spec.id) ?? metadata(spec, before.tables, caseId),
    );
    if (
      tables.length > 24 ||
      tables.reduce((n, t) => n + t.columns.length, 0) > 400
    )
      throw new Error("A workspace supports up to 24 tables and 400 fields.");
    if (
      tables.reduce((n, t) => n + (t.dataBytes ?? t.bytes), 0) >
      LIMITS.caseBytes
    )
      throw new Error("The local preview exceeds the workspace data limit.");
    const relationships = result.schema.foreign_keys;
    return {
      caseId,
      changedData: result.changedData,
      steps: result.changes.map((change, i) =>
        prepareAction(change, operations[i], i),
      ),
      before,
      operations: structuredClone(operations),
      tables,
      relationships,
      equations: result.schema.equations ?? [],
    };
  } catch (error) {
    await Promise.allSettled(writers.map((w) => w.abort()));
    await store.discard([...staged.values()]);
    throw error;
  }
}
