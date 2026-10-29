import type {
  Operation,
  SchemaSpec,
  SqlBundle,
  TableSpec,
} from "../model/operations.ts";
import type { ModelPublication, TagChange } from "../model/publication.ts";
import type { CellValue, Table } from "../model/schema.ts";
import type { CaseInfo, UseCase } from "../model/workspace.ts";

export type WorkspaceSnapshot = { useCase: UseCase; tables: Table[] };
export type EditBase = {
  useCase: Pick<UseCase, "id" | "revision" | "relationships" | "equations">;
  tables: Table[];
};
export type CaseInfoPatch = Partial<
  Pick<UseCase, "name" | "positions" | "viewport">
>;
export type RowBatch = { offset: number; rows: CellValue[][] };
export type RowWriter = {
  append(rows: CellValue[][]): Promise<void>;
  finish(metadata: Table): Promise<Table>;
  abort(): Promise<void>;
};

// This is the storage capability the application needs. No transaction,
// chunk keys, object stores, or mutable data slots cross this boundary.
export interface WorkspaceStore {
  listCases(): Promise<CaseInfo[]>;
  load(id: string): Promise<WorkspaceSnapshot>;
  updateTags(id: string, change: TagChange): Promise<void>;
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
    publication: ModelPublication,
  ): Promise<void>;
  discard(tables: Table[]): Promise<void>;
  close(): Promise<void>;
}

export type Progress = (message: string) => void;
export type DataSource = (tableId: string) => AsyncIterable<RowBatch>;
export type DataSink = (
  table: TableSpec,
  rows: AsyncIterable<RowBatch>,
) => Promise<void>;
export interface ModelEngine {
  evaluate(
    schema: SchemaSpec,
    operations: Operation[],
    source: DataSource,
    sink: DataSink,
    progress: Progress,
  ): Promise<{
    schema: SchemaSpec;
    changedData: string[];
    changes: import("../model/database-commands.ts").DatabaseChange[];
  }>;
  sql(
    base: SchemaSpec,
    operations: Operation[],
    current: SchemaSpec,
  ): Promise<SqlBundle>;
}
export type CsvInput = { file: File; primaryKey?: string };
export type CsvReader = (
  file: File,
  caseId: string,
  id: string,
  store: WorkspaceStore,
  progress: Progress,
  primaryKey?: string,
) => Promise<Table>;
