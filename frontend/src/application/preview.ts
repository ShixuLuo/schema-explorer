import { pendingAttribute } from "../model/attribute-template.ts";
import type { ModelComparison } from "../model/comparison.ts";
import type { DatabaseChange } from "../model/database-commands.ts";
import {
  migrationOptions,
  selectedMigration,
} from "../model/migration-options.ts";
import type { Migration } from "../model/migration.ts";
import type { Operation, TableSpec } from "../model/operations.ts";
import type { Equation } from "../model/presentation.ts";
import type { ForeignKeySpec, Table } from "../model/schema.ts";
import type { EditBase } from "./ports.ts";
export type PreparedEdit = {
  caseId: string;
  dataValidation?: "unverified";
  plan?: PlanGroup[];
  steps: ActionStep[];
  changedData: string[];
  pendingParameters?: { index: number; message: string }[];
  before: EditBase;
  operations: Operation[];
  tables: Table[];
  relationships: ForeignKeySpec[];
  equations?: Equation[];
};
export type EditSummary = Pick<
  PreparedEdit,
  | "steps"
  | "changedData"
  | "operations"
  | "dataValidation"
  | "plan"
  | "pendingParameters"
> & { createdTables: TableSpec[]; comparison: ModelComparison };

export type PlanGroup = { start: number; count: number; label?: string };
export const inferPlanGroups = (operations: Operation[]): PlanGroup[] =>
  operations.map((_, start) => ({ start, count: 1 }));
const migrationKinds = (
  migration: Migration,
): Exclude<Migration["kind"], "compose">[] =>
  migration.kind === "compose"
    ? migration.steps.flatMap(migrationKinds)
    : [migration.kind];
export type ActionStep = ReturnType<typeof prepareAction>;
// Transport only checked planning facts. UI grouping and text stay in schema/.
export function prepareAction(
  change: DatabaseChange,
  operation: Operation,
  operationIndex: number,
) {
  return {
    operationIndex,
    schema: change.before,
    title: change.description,
    migration: migrationKinds(change.abstract.migration),
    options: migrationOptions(change.before, operation),
    selected: selectedMigration(operation),
    pending: pendingAttribute(operation),
  };
}
