import {
  inferPlanGroups,
  type ActionStep,
  type PlanGroup,
} from "../application/preview.ts";
import { storageColumn } from "../model/database-presentation.ts";
import { MIGRATION_SYMBOLS } from "../model/migration-options.ts";
import type { Operation } from "../model/operations.ts";
function describeAction(step: ActionStep, operation: Operation) {
  const { options, selected, pending } = step;
  let migration = step.migration
    .flatMap((kind) =>
      kind === "pending"
        ? []
        : kind === "interpret"
          ? ["Explicit assignment"]
          : kind === "check"
            ? ["Constraint check"]
            : [MIGRATION_SYMBOLS[kind]],
    )
    .join(" → ");
  let explanation =
    options.find((o) => o.method === selected)?.reason ??
    "Keep the remaining records and values.";
  if (
    operation.op === "create_table" &&
    operation.table.columns.every((c) => c.generated === "identity")
  )
    migration =
      selected === "pi" ? "Π · Unit" : selected === "sigma" ? "Σ · Empty" : "";
  if (operation.op === "add_foreign_key" && !selected) {
    migration = "Key lookup";
    explanation =
      "Use the supplied source key values to identify exactly one target record.";
  }
  if (operation.op === "populate_reference")
    explanation =
      "Apply the explicitly recorded correspondence; every source must match exactly one target. No persistent matching rule is added.";
  if (operation.op === "add_unique_key" || operation.op === "add_primary_key")
    explanation = "Require unique, non-empty key values.";
  if (operation.op === "ensure_identity")
    explanation = "Assign independent internal record identities.";
  if (pending) explanation = pending;
  return { ...step, operation, migration, explanation };
}
// Group display uses prepared steps. It never rebuilds schemas or mappings.
// Every configurable substep remains visible, even inside a compound gesture.
export function planSteps(summary: {
  steps: ActionStep[];
  plan?: PlanGroup[];
  operations: Operation[];
}) {
  const groups = summary.plan ?? inferPlanGroups(summary.operations);
  const described = summary.steps.map((step) =>
    describeAction(step, summary.operations[step.operationIndex]),
  );
  return groups
    .flatMap((group) => {
      const steps = described.slice(group.start, group.start + group.count);
      const visible = steps.filter(
        (step) =>
          !step.operation.op.startsWith("drop_") &&
          step.options.some((o) => o.enabled) &&
          !(
            step.operation.op === "add_column" &&
            storageColumn(step.operation.column)
          ),
      );
      const selected = visible.length ? visible : [steps.at(-1)!];
      return selected.map((step, i) => {
        const preceding = steps.filter(
          (s) =>
            s.operationIndex < step.operationIndex && !selected.includes(s),
        );
        const prefix = preceding
          .map((s) => s.migration)
          .filter(Boolean)
          .filter((s, i, a) => i === 0 || a[i - 1] !== s);
        return {
          ...step,
          ...group,
          start: step.operationIndex,
          title: i === 0 ? (group.label ?? step.title) : step.title,
          migration: [...prefix, step.migration].filter(Boolean).join(" → "),
          explanation: [
            ...preceding.map((s) => s.explanation),
            step.explanation,
          ].join(" "),
        };
      });
    })
    .map((step, index) => ({ ...step, index }));
}
