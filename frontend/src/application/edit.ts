import type { CellValue, Column, Relation, Table } from "../model/schema.ts";
import type {
  Operation,
  StepReport,
  TypedCell,
  TableSpec,
  RustState,
} from "../model/operations.ts";
import type {
  WorkspaceStore,
  ModelEngine,
  Progress,
  RowWriter,
} from "./ports.ts";
import type { PreparedEdit, EditSample } from "./preview.ts";
import { schemaSpec, schemaRelations } from "../model/wire.ts";
import { ColumnProfiler } from "../model/profile.ts";
import { LIMITS } from "./limits.ts";
import { findRelations } from "./analysis.ts";
import { validateCandidate } from "./engine-input.ts";
const encoder = new TextEncoder();
const literalBytes = (value: TypedCell) =>
  value.type === "null"
    ? 0
    : encoder.encode(
        value.type === "integer" ? BigInt(value.value).toString() : value.value,
      ).length;
const typed = (value: CellValue, column: Column): TypedCell =>
  value === null
    ? { type: "null" }
    : { type: column.dataType ?? "text", value };
const untyped = (value: TypedCell): CellValue =>
  value.type === "null" ? null : value.value;
const excerpt = (value: CellValue | undefined) =>
  typeof value === "string" && value.length > 100
    ? value.slice(0, 100) + "…"
    : value;

function stateFor(
  tables: Table[],
  relationships: Relation[],
  revision: number,
  table?: Table,
  rows: CellValue[][] = [],
  offset = 0,
): RustState {
  const state: RustState = {
    version_id: String(revision),
    schema: schemaSpec(tables, relationships),
    data: Object.fromEntries(tables.map((table) => [table.id, []])),
  };
  if (table)
    state.data[table.id] = rows.map((row, index) => {
      if (row.length !== table.columns.length)
        throw new Error("A stored record does not match its table schema.");
      return {
        id: `${table.id}:row:${offset + index}`,
        cells: Object.fromEntries(
          table.columns.map((column) => [
            column.id,
            typed(row[column.index], column),
          ]),
        ),
      };
    });
  return state;
}

function metadata(
  schema: TableSpec[],
  before: Table[],
  caseId: string,
): Table[] {
  return schema.map((table) => {
    const original =
      before.find((previous) => previous.id === table.id) ??
      ({
        id: table.id,
        caseId,
        name: table.name,
        fileName: "",
        bytes: 0,
        rowCount: 0,
        dataBytes: 0,
        columns: [],
      } as Table);
    return {
      ...original,
      name: table.name,
      primaryKey: table.primary_key,
      columns: table.columns.map((column, index) => {
        const previous = original.columns.find(
          (value) => value.id === column.id,
        );
        return {
          emptyCount: 0,
          distinctCount: 0,
          integerFailures: 0,
          formatChanges: 0,
          nullCount: 0,
          ...previous,
          id: column.id,
          name: column.name,
          index,
          dataType: column.data_type,
          nullable: column.nullable,
        };
      }),
    };
  });
}

function checkLimits(tables: Table[]) {
  if (tables.length > 24)
    throw new Error("A use case supports up to 24 tables.");
  if (tables.reduce((n, table) => n + table.columns.length, 0) > 400)
    throw new Error("This edit would exceed 400 fields per use case.");
  for (const table of tables) {
    if (
      table.columns.length > LIMITS.columns ||
      table.columns.length * table.rowCount > LIMITS.cells
    )
      throw new Error(
        "This edit would exceed 100 fields or 200,000 cells per table.",
      );
  }
}

export async function prepareEdit(
  store: WorkspaceStore,
  engine: ModelEngine,
  caseId: string,
  operations: Operation[],
  progress: Progress,
): Promise<PreparedEdit> {
  const writers: RowWriter[] = [];
  try {
    const snapshot = await store.snapshot(caseId),
      useCase = snapshot.useCase,
      before = snapshot.tables,
      revision = useCase.revision ?? 0;
    progress("Checking edit…");
    const schemaPreview = await engine.evaluateBatch(
      stateFor(before, useCase.relationships, revision),
      operations,
    );
    const tables = metadata(
      schemaPreview.candidate.schema.tables,
      before,
      caseId,
    );
    const relationships = schemaRelations(
      schemaPreview.candidate.schema,
      tables,
      [...useCase.relationships, ...useCase.candidates],
    );
    checkLimits(tables);
    const columnIds = new Set(
      tables.flatMap((t) => t.columns.map((c) => c.id)),
    );
    const removedRelationships = useCase.relationships.filter(
      (r) => !relationships.some((next) => next.id === r.id),
    );
    const reports = schemaPreview.reports.map((r) => ({
      ...r,
      rows_checked: 0,
      cells_added: 0,
      cells_removed: 0,
      rows_removed: 0,
    }));
    const samples: EditSample[] = [];
    for (const op of operations) {
      if (op.op !== "add_column" && op.op !== "drop_column") continue;
      const id = op.op === "add_column" ? op.column.id : op.column_id;
      if (!samples.some((s) => s.columnId === id))
        samples.push({
          tableId: op.table_id,
          columnId: id,
          beforeName: before
            .find((t) => t.id === op.table_id)
            ?.columns.find((c) => c.id === id)?.name,
          afterName: tables
            .find((t) => t.id === op.table_id)
            ?.columns.find((c) => c.id === id)?.name,
          rows: [],
        });
    }
    const dataTables = new Set(
      operations
        .filter((op) => op.op === "add_column" || op.op === "drop_column")
        .map((op) => op.table_id),
    );
    const aggregate = (batch: StepReport[]) => {
      for (const r of batch) {
        const total = reports[r.step_index];
        total.rows_checked += r.rows_checked;
        total.cells_added += r.cells_added;
        total.cells_removed += r.cells_removed;
        total.rows_removed += r.rows_removed;
      }
    };
    for (const report of reports)
      if (report.op === "drop_table" && !dataTables.has(report.table_id)) {
        const t = before.find((t) => t.id === report.table_id);
        report.rows_removed = t?.rowCount ?? 0;
        report.cells_removed = (t?.rowCount ?? 0) * (t?.columns.length ?? 0);
      }
    const minimumAddedBytes = operations.reduce(
      (n, op) =>
        op.op === "add_column" && columnIds.has(op.column.id)
          ? n +
            literalBytes(op.value) *
              (before.find((t) => t.id === op.table_id)?.rowCount ?? 0)
          : n,
      0,
    );
    if (minimumAddedBytes > LIMITS.caseBytes)
      throw new Error(
        "The new values alone would exceed the 40 MiB use-case data limit.",
      );
    for (const tableId of dataTables) {
      const source = before.find((t) => t.id === tableId),
        target = tables.find((t) => t.id === tableId);
      if (!source) continue;
      const addedBytes = operations.reduce(
        (n, op) =>
          op.op === "add_column" && op.table_id === tableId
            ? n + literalBytes(op.value)
            : n,
        0,
      );
      const batchSize = Math.max(
        1,
        Math.min(
          LIMITS.evaluationRows,
          Math.floor(LIMITS.evaluationBytes / Math.max(1, addedBytes)),
        ),
      );
      const writer = target ? store.stage(target) : null;
      if (writer) writers.push(writer);
      const profiler = target ? new ColumnProfiler(target.columns) : null;
      let dataBytes = 0,
        checkedRows = 0;
      for await (const batch of store.rows(source)) {
        for (let start = 0; start < batch.rows.length; start += batchSize) {
          const rows = batch.rows.slice(start, start + batchSize),
            offset = batch.offset + start;
          const result = await engine.evaluateBatch(
            stateFor(
              before,
              useCase.relationships,
              revision,
              source,
              rows,
              offset,
            ),
            operations,
          );
          aggregate(result.reports);
          if (target && writer && profiler) {
            const migrated = result.candidate.data[tableId].map((record) =>
              target.columns.map((c) => untyped(record.cells[c.id])),
            );
            for (const [index, row] of migrated.entries()) {
              profiler.add(row);
              dataBytes += row.reduce(
                (n, v) => n + (v === null ? 0 : encoder.encode(v).length),
                0,
              );
              const size = tables.reduce(
                (n, t) =>
                  n + (t.id === tableId ? dataBytes : (t.dataBytes ?? t.bytes)),
                0,
              );
              if (size > LIMITS.caseBytes)
                throw new Error(
                  "This edit would exceed the 40 MiB use-case data limit.",
                );
              for (const sample of samples.filter(
                (s) => s.tableId === tableId && s.rows.length < 5,
              )) {
                const oldIndex = source.columns.findIndex(
                    (c) => c.id === sample.columnId,
                  ),
                  newIndex = target.columns.findIndex(
                    (c) => c.id === sample.columnId,
                  );
                sample.rows.push({
                  number: offset + index + 1,
                  before:
                    oldIndex < 0 ? undefined : excerpt(rows[index][oldIndex]),
                  after: newIndex < 0 ? undefined : excerpt(row[newIndex]),
                });
              }
            }
            await writer.append(migrated);
          }
          checkedRows += rows.length;
          progress(
            `Checking ${source.name} · ${checkedRows.toLocaleString()} rows`,
          );
        }
      }
      if (target && writer && profiler) {
        profiler.finish();
        tables[tables.indexOf(target)] = await writer.finish(target);
      }
    }
    await validateCandidate(store, engine, tables, relationships, progress);
    for (const report of reports)
      if (["add_primary_key", "add_foreign_key"].includes(report.op))
        report.rows_checked =
          tables.find((t) => t.id === report.table_id)?.rowCount ?? 0;
    const { candidates, analysis } = await findRelations(
      store,
      tables,
      relationships,
      progress,
    );
    return {
      caseId,
      before: snapshot,
      operations,
      tables,
      relationships,
      removedRelationships,
      reports,
      candidates,
      analysis,
      samples,
    };
  } catch (error) {
    await Promise.allSettled(writers.map((writer) => writer.abort()));
    throw error;
  }
}
