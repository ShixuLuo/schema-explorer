import { ReadableFailure } from "../model/failure.ts";
import type { Operation, SchemaSpec, TableSpec } from "../model/operations.ts";
import { sqlName } from "./sql-syntax.ts";
type PgError = {
  code?: string;
  message?: string;
  detail?: string;
  table?: string;
  column?: string;
  constraint?: string;
};
type Context = {
  before: SchemaSpec;
  after: SchemaSpec;
  operation?: Operation;
  tableId?: string;
};
const nameOf = (schema: SchemaSpec, id: string) =>
  schema.tables.find((t) => t.id === id);
const fields = (table: TableSpec | undefined, ids: string[]) =>
  `${table?.name ?? "table"}.${ids.length === 1 ? (table?.columns.find((c) => c.id === ids[0])?.name ?? "field") : `(${ids.map((id) => table?.columns.find((c) => c.id === id)?.name ?? "field").join(", ")})`}`;
const valueFrom = (detail: string | undefined) => {
  const value = detail?.match(
    /Key \([\s\S]*?\)=\(([\s\S]*)\) (?:is not present|already exists|is still referenced|is duplicated)/,
  )?.[1];
  return value === undefined
    ? undefined
    : value.length > 120
      ? value.slice(0, 117) + "…"
      : value;
};
const sameName = (actual: string | undefined, quoted: string) =>
  actual === quoted.slice(1, -1);
export function explainPostgresFailure(
  error: unknown,
  context: Context,
  index?: number,
): ReadableFailure {
  const e = error as PgError,
    { after, before, operation: op } = context,
    raw = [
      index === undefined ? "" : `Step ${index + 1}:`,
      e.message ?? String(error),
      e.detail ?? "",
    ]
      .filter(Boolean)
      .join(" ");
  const failure = (message: string, hint?: string) =>
    new ReadableFailure({
      message,
      kind: "data",
      hint,
      details: raw,
      precheckFailed:
        ["23503", "23505", "23502", "22P02", "22003"].includes(e.code ?? "") ||
        (e.code === "P0001" &&
          !!(
            e.message?.includes("Path equation") ||
            e.message?.includes("must match exactly one") ||
            e.message?.includes("business attribute")
          )),
    });
  const value = valueFrom(e.detail),
    display = value === undefined ? undefined : `“${value}”`;
  const fk =
    [...after.foreign_keys, ...before.foreign_keys].find((f) =>
      sameName(e.constraint, sqlName("fk", f.id)),
    ) ?? (op?.op === "add_foreign_key" ? op.foreign_key : undefined);
  if (e.code === "23503" && fk) {
    const source =
        nameOf(after, fk.source_table) ?? nameOf(before, fk.source_table),
      target =
        nameOf(after, fk.target_table) ?? nameOf(before, fk.target_table),
      from = fields(source, fk.source_columns),
      to = fields(target, fk.target_columns);
    if (e.detail?.includes("is still referenced"))
      return failure(
        `Cannot change ${to}${display ? ` = ${display}` : ""}: ${from} still references it.`,
        `Update or remove the referencing records first.`,
      );
    let hint =
      "Choose the correct target field, or correct the source values so they match the target keys.";
    const sourceName = source?.columns.find(
      (c) => c.id === fk.source_columns[0],
    )?.name;
    if (
      fk.source_columns.length === 1 &&
      sourceName &&
      /(^|_)id$/i.test(sourceName) &&
      target?.primaryKey.length === 1 &&
      source?.columns.find((c) => c.id === fk.source_columns[0])?.dataType ===
        target.columns.find((c) => c.id === target.primaryKey[0])?.dataType &&
      JSON.stringify(target.primaryKey) !== JSON.stringify(fk.target_columns)
    )
      hint = `If ${sourceName} contains record IDs, choose ${fields(target, target.primaryKey)} as the target field. Otherwise, correct the source values.`;
    return failure(
      display
        ? `${from} contains ${display}, but ${to} has no matching value.`
        : `Some values in ${from} do not exist in ${to}.`,
      hint,
    );
  }
  if (e.code === "23505") {
    let table =
        after.tables.find((t) => t.name === e.table) ??
        after.tables.find((t) => t.id === context.tableId),
      keys: string[] | undefined;
    if (op?.op === "add_unique_key" || op?.op === "add_primary_key") {
      table = nameOf(after, op.table_id);
      keys = op.column_ids;
    }
    if (table && !keys) {
      if (sameName(e.constraint, sqlName("pk", table.id)))
        keys = table.primaryKey;
      else
        keys = table.uniqueKeys?.find((k) =>
          sameName(e.constraint, sqlName("uk", `${table!.id}:${k.join("|")}`)),
        );
    }
    return failure(
      `${keys ? fields(table, keys) : (table?.name ?? "The selected key")} contains duplicate values${display ? `, including ${display}` : ""}.`,
      "Use a field that identifies one record, or remove the duplicate values before making it a key.",
    );
  }
  if (e.code === "23502") {
    const parsed = e.message?.match(/column "([^"]+)" of relation "([^"]+)"/);
    const table =
      after.tables.find((t) => t.name === (e.table ?? parsed?.[2])) ??
      after.tables.find((t) => t.id === context.tableId);
    const column = e.column ?? parsed?.[1];
    const label = column
      ? `${table?.name ?? e.table ?? "table"}.${column}`
      : (table?.name ?? "The selected field");
    return failure(
      `${label} has empty (NULL) values.`,
      op?.op === "add_foreign_key"
        ? "Every source record needs a valid target key. Fill in the empty values or choose another source field."
        : "Fill in the empty values or choose a different key field.",
    );
  }
  if (e.code === "P0001" && e.message?.includes("Path equation"))
    return failure(
      "The selected paths return different results for some records.",
      "Check the selected arrows or correct the data before adding this relation.",
    );
  if (e.code === "P0001" && e.message?.includes("must match exactly one"))
    return failure(
      "Some source records have no matching target, or match more than one target.",
      "Choose fields that identify exactly one target record and correct any missing values.",
    );
  if (e.code === "P0001" && e.message?.includes("business attribute"))
    return failure(
      e.message,
      "Choose a relation consistent with the fixed business values.",
    );
  if (e.code === "22P02" || e.code === "22003")
    return failure(
      "A value does not fit the selected field type.",
      "Check the values and field types. Integer fields require whole numbers within the supported range.",
    );
  return failure(
    e.code
      ? "This change could not be applied to the current data."
      : (e.message ?? "Could not complete this change."),
    e.code
      ? "Check the selected fields and values. Technical details are available below."
      : undefined,
  );
}
