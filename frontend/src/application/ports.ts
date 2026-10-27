import type { CellValue, Table } from "../model/schema.ts";
import type { UseCase } from "../model/workspace.ts";
import type {
  Operation,
  RustState,
  RustEvaluation,
  SchemaSpec,
  TypedCell,
  SqlBundle,
} from "../model/operations.ts";

export type WorkspaceSnapshot = { useCase: UseCase; tables: Table[] };
export type CaseInfoPatch = Partial<
  Pick<UseCase, "name" | "positions" | "viewport" | "dismissed">
>;
export type ModelUpdate = Pick<
  UseCase,
  "relationships" | "candidates" | "analysis" | "migration" | "undo"
> & { tables: Table[] };
export type RowBatch = { offset: number; rows: CellValue[][] };
export type RowWriter = {
  append(rows: CellValue[][]): Promise<void>;
  finish(metadata: Table): Promise<Table>;
  abort(): Promise<void>;
};

// This is the storage capability the application needs. No transaction,
// chunk keys, object stores, or mutable data slots cross this boundary.
export interface WorkspaceStore {
  listCases(): Promise<UseCase[]>;
  addCase(useCase: UseCase): Promise<void>;
  readCase(id: string): Promise<UseCase | undefined>;
  snapshot(id: string): Promise<WorkspaceSnapshot>;
  patchInfo(id: string, patch: CaseInfoPatch): Promise<UseCase>;
  deleteEmpty(id: string): Promise<void>;
  rows(table: Table): AsyncIterable<RowBatch>;
  readRows(
    table: Table,
    offset: number,
    limit?: number,
  ): Promise<CellValue[][]>;
  stage(table: Table): RowWriter;
  commit(
    id: string,
    expectedRevision: number,
    update: ModelUpdate,
  ): Promise<void>;
  discard(tables: Table[]): Promise<void>;
  close(): Promise<void>;
}

export type Progress = (message: string) => void;
export type ProjectionSource = (
  tableId: string,
  columnIds: string[],
) => AsyncIterable<{ start: number; rows: Record<string, TypedCell>[] }>;
export interface ModelEngine {
  evaluateBatch(
    state: RustState,
    operations: Operation[],
  ): Promise<RustEvaluation>;
  validate(
    schema: SchemaSpec,
    counts: Record<string, number>,
    source: ProjectionSource,
    progress: Progress,
  ): Promise<void>;
  sql(
    base: SchemaSpec,
    operations: Operation[],
    current: SchemaSpec,
  ): Promise<SqlBundle>;
}
export type CsvReader = (
  file: File,
  caseId: string,
  id: string,
  store: WorkspaceStore,
  progress: Progress,
) => Promise<Table>;
