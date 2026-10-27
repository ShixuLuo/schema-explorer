import type { DataType } from "./schema.ts";

// Wire representation of the Rust Operation enum. No migration rules live here.
export type TypedCell =
  { type: "null" } | { type: "text" | "integer"; value: string };
export type ColumnSpec = {
  id: string;
  name: string;
  data_type: DataType;
  nullable: boolean;
};
export type ForeignKeySpec = {
  id: string;
  source_table: string;
  source_columns: string[];
  target_table: string;
  target_columns: string[];
};
export type TableSpec = {
  id: string;
  name: string;
  columns: ColumnSpec[];
  primary_key: string[];
};
export type SchemaSpec = {
  tables: TableSpec[];
  foreign_keys: ForeignKeySpec[];
};
export type MigrationHistory = { base: SchemaSpec; operations: Operation[] };
export type Operation =
  | { op: "create_table"; table: TableSpec }
  | { op: "add_primary_key"; table_id: string; column_ids: string[] }
  | { op: "drop_primary_key"; table_id: string }
  | { op: "add_foreign_key"; table_id: string; foreign_key: ForeignKeySpec }
  | { op: "drop_foreign_key"; table_id: string; foreign_key_id: string }
  | { op: "drop_table"; table_id: string }
  | { op: "rename_table"; table_id: string; new_name: string }
  | {
      op: "rename_column";
      table_id: string;
      column_id: string;
      new_name: string;
    }
  | { op: "add_column"; table_id: string; column: ColumnSpec; value: TypedCell }
  | { op: "drop_column"; table_id: string; column_id: string };
export type StepReport = {
  step_index: number;
  op: Operation["op"];
  table_id: string;
  column_id: string | null;
  description: string;
  rows_checked: number;
  cells_added: number;
  cells_removed: number;
  rows_removed: number;
};

export type RustRow = { id: string; cells: Record<string, TypedCell> };
export type RustState = {
  version_id: string;
  schema: SchemaSpec;
  data: Record<string, RustRow[]>;
};
export type RustEvaluation = { candidate: RustState; reports: StepReport[] };
export type SqlBundle = { changes: string; baseline: string; current: string };
export type ScanRequest = {
  phase: "keys" | "references";
  table_id: string;
  column_ids: string[];
  row_count: number;
};
