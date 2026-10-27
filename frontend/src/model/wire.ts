import type { Column, Relation, Table } from "./schema.ts";
import { relationColumns } from "./schema.ts";
import type { ColumnSpec, ForeignKeySpec, SchemaSpec } from "./operations.ts";

export const columnSpec = (column: Column): ColumnSpec => ({
  id: column.id,
  name: column.name,
  data_type: column.dataType ?? "text",
  nullable: column.nullable ?? false,
});
export const foreignKeySpec = (r: Relation): ForeignKeySpec => ({
  id: r.id,
  source_table: r.source.tableId,
  source_columns: relationColumns(r, "source"),
  target_table: r.target.tableId,
  target_columns: relationColumns(r, "target"),
});
export function schemaSpec(
  tables: Table[],
  relationships: Relation[],
): SchemaSpec {
  return {
    tables: tables.map((t) => ({
      id: t.id,
      name: t.name,
      columns: t.columns.map(columnSpec),
      primary_key: t.primaryKey ?? [],
    })),
    foreign_keys: relationships.filter((r) => r.enforced).map(foreignKeySpec),
  };
}
export function schemaRelations(
  schema: SchemaSpec,
  tables: Table[],
  previous: Relation[],
): Relation[] {
  return schema.foreign_keys.map((fk) => {
    const source = tables.find((t) => t.id === fk.source_table)!;
    const old = previous.find((r) => r.id === fk.id);
    return {
      ...old,
      id: fk.id,
      source: {
        tableId: fk.source_table,
        columnId: fk.source_columns[0],
        columnIds: fk.source_columns,
      },
      target: {
        tableId: fk.target_table,
        columnId: fk.target_columns[0],
        columnIds: fk.target_columns,
      },
      checked: source.rowCount,
      matched: source.rowCount,
      sourceDistinct: old?.sourceDistinct ?? 0,
      cardinality: old?.cardinality ?? "N:1",
      enforced: true,
    };
  });
}
