export type DataType = "text" | "integer";
export type CellValue = string | null;
export type Column = {
  id: string;
  name: string;
  index: number;
  emptyCount: number;
  distinctCount: number;
  integerFailures: number;
  formatChanges: number;
  dataType?: DataType;
  nullable?: boolean;
  nullCount?: number;
};
export type Table = {
  id: string;
  caseId: string;
  name: string;
  fileName: string;
  bytes: number;
  rowCount: number;
  columns: Column[];
  primaryKey?: string[];
  dataId?: string;
  dataBytes?: number;
};
export type Endpoint = {
  tableId: string;
  columnId: string;
  columnIds?: string[];
};
export type Relation = {
  id: string;
  source: Endpoint;
  target: Endpoint;
  matched: number;
  checked: number;
  sourceDistinct: number;
  cardinality: "1:1" | "N:1";
  enforced?: boolean;
};

export const relationColumns = (
  relation: Relation,
  side: "source" | "target",
) => relation[side].columnIds ?? [relation[side].columnId];
