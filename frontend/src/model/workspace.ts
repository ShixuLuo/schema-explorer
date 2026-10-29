import type { MigrationHistory, Operation } from "./operations.ts";
import type { Equation } from "./presentation.ts";
import type { ForeignKeySpec, Table } from "./schema.ts";
export type Point = { x: number; y: number };
export type Viewport = { x: number; y: number; zoom: number };
export type UseCase = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  tableIds: string[];
  positions: Record<string, Point>;
  viewport?: Viewport;
  relationships: ForeignKeySpec[];
  equations?: Equation[];
  revision?: number;
  modelVersion: 6;
  undo?: EditingUndo;
  history: History;
};
export type EditingUndo = {
  checkpointId: string | null;
  description: string;
  positions?: Record<string, Point>;
  viewport?: Viewport;
};
export type SavedWorkspace = { tables: Table[] } & Pick<
  UseCase,
  "relationships" | "equations" | "positions" | "viewport"
>;
export type CheckpointInfo = {
  id: string;
  name: string;
  createdAt: number;
  // undefined is retained only for historical states with unrecorded ancestry.
  parentId?: string | null;
  operationCount?: number;
  tags?: string[];
};
export type CqlProvenance = {
  kind: "cql-result-import";
  scope: string;
  resultId: string;
  binding: unknown;
  contract?: unknown;
  targetHash?: string;
  resultDigest?: string;
  sourceDigest?: string;
  manifest?: unknown;
  programHash?: unknown;
  equations: "none imported; external contract only";
};
export type Checkpoint = CheckpointInfo & {
  provenance?: CqlProvenance;
  state: SavedWorkspace;
  operations?: Operation[];
  // Preserved audit data from the old flat log; new commits do not create it.
  legacyMigration?: MigrationHistory;
};
export type CheckpointRange = { from: string | null; to: string };
export type History = { checkpoints: Checkpoint[]; editing: string | null };

export function retainedTables(value: UseCase): Table[] {
  return value.history.checkpoints.flatMap((c) => c.state.tables);
}

export type CaseInfo = Pick<
  UseCase,
  "id" | "name" | "createdAt" | "updatedAt" | "tableIds"
>;
export function caseInfo(value: CaseInfo): CaseInfo {
  return {
    id: value.id,
    name: value.name,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    tableIds: [...value.tableIds],
  };
}
