export type DataType = "text" | "integer" | "real" | "boolean";
export type CellValue = string | null;
export type ColumnSpec = {
  id: string;
  name: string;
  dataType: DataType;
  nullable: boolean;
  generated?: "identity";
  storage?: "reference" | "identity";
};
export type Column = Omit<ColumnSpec, "dataType" | "nullable"> &
  Partial<Pick<ColumnSpec, "dataType" | "nullable">> & { index: number };
export type TableSpec = {
  id: string;
  name: string;
  columns: ColumnSpec[];
  primaryKey: string[];
  uniqueKeys?: string[][];
};
export type Table = Omit<TableSpec, "columns" | "primaryKey"> & {
  columns: Column[];
  primaryKey?: string[];
  caseId: string;
  fileName: string;
  bytes: number;
  rowCount: number;
  dataStatus?: "unverified";
  dataId?: string;
  dataBytes?: number;
};
// One physical reference shape is shared by the model, SQL and both views.
export type ForeignKeySpec = {
  id: string;
  name?: string;
  source_table: string;
  source_columns: string[];
  target_table: string;
  target_columns: string[];
};
