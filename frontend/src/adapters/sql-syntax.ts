import type { TypedCell, ColumnSpec, TableSpec } from "../model/operations.ts";
export function ident(value: string) {
  if (
    !value.trim() ||
    value.includes("\0") ||
    new TextEncoder().encode(value).length > 63
  )
    throw new Error(
      "PostgreSQL names must contain 1–63 UTF-8 bytes and no NUL.",
    );
  return `"${value.replaceAll('"', '""')}"`;
}
export function literal(cell: TypedCell): string {
  if (cell.type === "null") return "NULL";
  if (cell.type === "integer") {
    if (!/^[+-]?[0-9]+$/.test(cell.value))
      throw new Error("Expected a signed integer.");
    const n = BigInt(cell.value);
    if (n < -9223372036854775808n || n > 9223372036854775807n)
      throw new Error("Integer is outside the signed 64-bit range.");
    return n.toString();
  }
  if (cell.value.includes("\0"))
    throw new Error("PostgreSQL text cannot contain NUL.");
  return `E'${cell.value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}
export const sqlType = (column: ColumnSpec) =>
  column.dataType === "integer" ? "BIGINT" : "TEXT";
export function sqlName(prefix: string, id: string) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(id))
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return ident(`${prefix}_${hash.toString(16).padStart(16, "0")}`);
}
export function bodyLiteral(body: string) {
  let delimiter = "$se$";
  while (body.includes(delimiter)) delimiter = delimiter.slice(0, -1) + "_$";
  return `${delimiter}\n${body}\n${delimiter}`;
}

// Compilation returns every table it writes and any finite expansion bound.
// Preview consumes this result instead of reconstructing effects from UI commands.
export type SqlResult = {
  statements: string[];
  changedData: string[];
  expansions?: {
    tableId: string;
    choicesTableId: string;
    paths: number;
    width: number;
  }[];
};
export function syncIdentitySequences(tables: TableSpec[]): string[] {
  return tables.flatMap((table) =>
    table.columns
      .filter((c) => c.generated === "identity")
      .map(
        (column) =>
          `DO ${bodyLiteral(`DECLARE sequence_id regclass := pg_get_serial_sequence(${literal({ type: "text", value: ident(table.name) })},${literal({ type: "text", value: column.name })}); highest bigint; previous bigint; called boolean;
BEGIN
EXECUTE format('SELECT last_value, is_called FROM %s', sequence_id) INTO previous, called;
SELECT max(${ident(column.name)}) INTO highest FROM ${ident(table.name)};
IF highest > previous OR (highest = previous AND NOT called) THEN
PERFORM setval(sequence_id, highest, true);
END IF;
END;`)};`,
      ),
  );
}
