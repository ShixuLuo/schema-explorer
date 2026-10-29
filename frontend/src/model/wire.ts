import type { ColumnSpec, SchemaSpec } from "./operations.ts";
import type { Equation } from "./presentation.ts";
import type { Column, ForeignKeySpec, Table } from "./schema.ts";

export const columnSpec = (column: Column): ColumnSpec => ({
  id: column.id,
  name: column.name,
  dataType: column.dataType ?? "text",
  nullable: column.nullable ?? false,
  ...(column.storage ? { storage: column.storage } : {}),
  ...(column.generated ? { generated: column.generated } : {}),
});
export function schemaSpec(
  tables: Pick<
    Table,
    "id" | "name" | "columns" | "primaryKey" | "uniqueKeys"
  >[],
  relationships: ForeignKeySpec[],
  equations: Equation[] = [],
): SchemaSpec {
  return {
    tables: tables.map((t) => ({
      id: t.id,
      name: t.name,
      columns: t.columns.map(columnSpec),
      primaryKey: t.primaryKey ?? [],
      ...(t.uniqueKeys?.length
        ? { uniqueKeys: structuredClone(t.uniqueKeys) }
        : {}),
    })),
    foreign_keys: structuredClone(relationships),
    ...(equations.length ? { equations: structuredClone(equations) } : {}),
  };
}
