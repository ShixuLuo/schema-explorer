import {
  ReadableFailure,
  type FailureInfo,
  type FailureKind,
} from "./failure.ts";
import { freePiShape, freeSigmaIssue } from "./free-arrow-shape.ts";
import type { Operation, SchemaSpec } from "./operations.ts";
export type MigrationMethod = "sigma" | "delta" | "pi";
export const MIGRATION_SYMBOLS = { sigma: "Σ", delta: "Δ", pi: "Π" } as const;
export type MigrationOption = {
  method: MigrationMethod;
  enabled: boolean;
  failure?: FailureKind;
  reason: string;
  configuration?: "attribute-value" | "reference-path";
};
export function quotientIssue(schema: SchemaSpec): FailureInfo | undefined {
  for (const table of schema.tables) {
    const carriers = schema.foreign_keys
      .filter((f) => f.source_table === table.id)
      .flatMap((f) => f.source_columns);
    if (new Set(carriers).size !== carriers.length)
      return {
        kind: "binding",
        message: "Σ quotient needs independent storage columns for each arrow.",
      };
  }
}
export function migrationOptions(
  schema: SchemaSpec,
  op: Operation,
): MigrationOption[] {
  const supported: Partial<Record<MigrationMethod, string>> = {},
    reasons: Partial<Record<MigrationMethod, string>> = {},
    failures: Partial<Record<MigrationMethod, FailureKind>> = {};
  switch (op.op) {
    case "create_table":
      supported.sigma = "Create an empty object.";
      if (op.table.columns.every((c) => c.generated === "identity"))
        supported.pi = "Create one record with no attributes.";
      else
        reasons.pi =
          "Π with scalar attributes needs a finite, explicitly enumerated value domain.";
      break;
    case "combine_tables":
      supported.sigma = "Collect the mapped records.";
      supported.pi = "Keep combinations agreeing on the mapped fields.";
      break;
    case "add_reference": {
      const f = op.foreign_key;
      const sigmaIssue =
          freeSigmaIssue(schema, f) ??
          (schema.equations?.length ? quotientIssue(schema) : undefined),
        piIssue = freePiShape(schema, f).issue;
      if (sigmaIssue) {
        reasons.sigma = sigmaIssue.message;
        failures.sigma = sigmaIssue.kind;
      } else
        supported.sigma =
          "Create fresh target records and complete their outgoing arrows; preserve existing records.";
      if (piIssue) {
        reasons.pi = piIssue.message;
        failures.pi = piIssue.kind;
      } else
        supported.pi =
          "Build all target choices for each source path, copy affected records, and rewrite incoming references.";
      const reachable = new Set([f.source_table]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const a of schema.foreign_keys)
          if (reachable.has(a.source_table) && !reachable.has(a.target_table)) {
            reachable.add(a.target_table);
            changed = true;
          }
      }
      if (reachable.has(f.target_table))
        supported.delta =
          "Use an explicitly chosen existing path for the new arrow; keep all records and business values.";
      else
        reasons.delta =
          "There is no existing path from the source to the target to use as this arrow’s image.";
      break;
    }
    case "add_foreign_key": {
      const fk = op.foreign_key,
        target = schema.tables.find((t) => t.id === fk.target_table);
      supported.pi =
        "Keep the largest subset of existing records whose references are total. Remove unmatched rows and records that depend on them.";
      const unknown =
        target?.columns.filter(
          (c) =>
            !fk.target_columns.includes(c.id) && c.generated !== "identity",
        ) ?? [];
      if (unknown.length)
        reasons.sigma = `Σ needs fresh values for ${target?.name}.${unknown.map((c) => c.name).join(", ")}. This concrete SQL typeside cannot represent labelled unknowns.`;
      else if (
        schema.foreign_keys.some((f) => f.source_table === fk.target_table) ||
        schema.equations?.some((e) => e.left.source === fk.target_table)
      )
        reasons.sigma =
          "Σ completion through existing outgoing arrows or equations is not supported by the finite SQL template.";
      else
        supported.sigma =
          "Complete missing target keys from the supplied source values, then enforce the total reference.";
      reasons.delta =
        "Δ needs an existing path for the new arrow; this action supplies target-key values instead.";
      break;
    }
    case "add_equation": {
      supported.pi =
        "Keep the largest subinstance where both paths agree, including closure under all arrows.";
      supported.sigma =
        "Merge records required equal by the relation, close under every arrow, and rewrite references. Unequal business attributes cause a clear failure.";
      const issue = quotientIssue(schema);
      if (issue) {
        delete supported.sigma;
        reasons.sigma = issue.message;
        failures.sigma = issue.kind;
      }
      reasons.delta =
        "Adding a relation uses the forward schema mapping; Δ runs in the opposite direction.";
      break;
    }
    case "add_attribute": {
      const p = op.parameters;
      if (p.template === "extension") {
        reasons.sigma =
          "Σ introduces a labelled unknown for each existing record. Symbolic scalar values are not implemented; a fixed value must be configured separately.";
        reasons.pi =
          "Π requires the complete scalar domain. Text and Integer have no finite enumerated domain in this model; a sample list is not the same migration.";
        supported.delta =
          "Set a fixed value or copy an existing attribute. Configuration is required.";
      } else {
        supported.delta =
          p.template === "constant"
            ? p.value
              ? `Set every existing record to ${p.value.type === "null" ? "NULL" : JSON.stringify(p.value.value)}; keep all records.`
              : "Supply a fixed value for the new attribute; keep all records."
            : `Copy ${schema.tables.find((t) => t.id === op.table_id)?.columns.find((c) => c.id === p.source_column)?.name ?? "the selected attribute"} into the new attribute; keep all records.`;
        reasons.sigma = reasons.pi = "An explicit value mapping uses Δ.";
      }
      break;
    }
    case "add_column":
      supported.delta = `Pull back the fixed ${op.value.type === "null" ? "NULL" : JSON.stringify(op.value.value)} term into the new attribute; preserve all existing rows.`;
      reasons.sigma =
        "A free new scalar value is a labelled unknown, not SQL NULL.";
      reasons.pi =
        "Enumerating every Text or Integer value cannot be represented as a bounded SQL table.";
      break;
    case "copy_table":
      supported.delta = "Pull back the source records and selected fields.";
      break;
    case "drop_table":
    case "drop_column":
    case "drop_foreign_key":
    case "drop_equation":
      supported.delta =
        "Restrict or relabel the schema while retaining the remaining data.";
      break;
    case "rename_table":
    case "rename_column":
    case "rename_arrow":
      supported.sigma =
        supported.delta =
        supported.pi =
          "Relabel the object or arrow through an isomorphism; keep every record and value.";
      break;
    default:
      reasons.delta =
        "This is an internal storage-binding step, not a standalone category migration.";
  }
  return (["sigma", "delta", "pi"] as const).map((method) => ({
    method,
    enabled: !!supported[method],
    ...(!supported[method]
      ? {
          failure:
            failures[method] ??
            ((method === "delta"
              ? "mapping"
              : op.op === "add_attribute" ||
                  op.op === "add_column" ||
                  op.op === "create_table"
                ? "typeside"
                : "unsupported") as FailureKind),
        }
      : {}),
    ...((op.op === "add_attribute" || op.op === "add_column") &&
    method === "delta" &&
    supported[method]
      ? { configuration: "attribute-value" as const }
      : {}),
    ...(op.op === "add_reference" && method === "delta" && supported[method]
      ? { configuration: "reference-path" as const }
      : {}),
    reason:
      supported[method] ??
      reasons[method] ??
      "This method does not have the required mapping direction for this action.",
  }));
}
export function selectedMigration(op: Operation): MigrationMethod | undefined {
  if (op.op === "add_attribute")
    return op.parameters.template === "extension"
      ? (op.parameters.method ?? undefined)
      : "delta";
  if (op.op === "create_table")
    return op.method === null ? undefined : (op.method ?? "sigma");
  if (
    op.op === "rename_table" ||
    op.op === "rename_column" ||
    op.op === "rename_arrow"
  )
    return op.method === null ? undefined : (op.method ?? "delta");
  if (op.op === "combine_tables" || op.op === "add_reference")
    return op.method ?? undefined;
  if (op.op === "add_foreign_key" || op.op === "add_equation")
    return op.method ?? undefined;
  if (
    [
      "copy_table",
      "add_column",
      "drop_table",
      "drop_column",
      "drop_foreign_key",
      "drop_equation",
    ].includes(op.op)
  )
    return "delta";
}
export function assertMigrationChoice(
  schema: SchemaSpec,
  op: Operation,
  method: MigrationMethod,
) {
  const option = migrationOptions(schema, op).find((o) => o.method === method)!;
  if (!option.enabled)
    throw new ReadableFailure({
      kind: option.failure,
      message: `${MIGRATION_SYMBOLS[method]} is unavailable: ${option.reason}`,
    });
}
