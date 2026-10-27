import type { CellValue, Table, Relation } from "../model/schema.ts";
import type { Operation, StepReport, TableSpec } from "../model/operations.ts";
import type { UseCase } from "../model/workspace.ts";
import type { WorkspaceSnapshot } from "./ports.ts";
export type EditSample = {
  tableId: string;
  columnId: string;
  beforeName?: string;
  afterName?: string;
  rows: { number: number; before?: CellValue; after?: CellValue }[];
};
export type PreparedEdit = {
  caseId: string;
  before: WorkspaceSnapshot;
  operations: Operation[];
  tables: Table[];
  relationships: Relation[];
  removedRelationships: Relation[];
  reports: StepReport[];
  candidates: Relation[];
  analysis: UseCase["analysis"];
  samples: EditSample[];
};
export type EditSummary = Pick<
  PreparedEdit,
  "reports" | "samples" | "removedRelationships"
> & { createdTables: TableSpec[] };
