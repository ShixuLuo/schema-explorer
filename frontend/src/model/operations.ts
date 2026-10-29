import type { Equation, Path } from "./presentation.ts";
import type { ColumnSpec, ForeignKeySpec, TableSpec } from "./schema.ts";
export type { ColumnSpec, ForeignKeySpec, TableSpec } from "./schema.ts";

// The recorded elementary operations used by preview, history and SQL export.
export type TypedCell =
  | { type: "null" }
  | { type: "text" | "integer" | "real" | "boolean"; value: string };
export type AttributeParameters =
  | { template: "extension"; method?: "sigma" | "pi" | null }
  | { template: "constant"; value?: TypedCell }
  | { template: "copy"; source_column?: string };
export type MigrationParameters =
  AttributeParameters | { template: "path"; path: Path };
export type SchemaSpec = {
  tables: TableSpec[];
  foreign_keys: ForeignKeySpec[];
  equations?: Equation[];
};
export type MigrationHistory = { base: SchemaSpec; operations: Operation[] };
export type Operation =
  | { op: "create_table"; table: TableSpec; method?: "sigma" | "pi" | null }
  | {
      op: "ensure_identity";
      table_id: string;
      column_id: string;
      column_name: string;
    }
  | {
      op: "populate_reference";
      table_id: string;
      target_table: string;
      source_columns: string[];
      target_columns: string[];
      match_source: string[];
      match_target: string[];
    }
  | { op: "add_unique_key"; table_id: string; column_ids: string[] }
  | { op: "add_primary_key"; table_id: string; column_ids: string[] }
  | { op: "drop_primary_key"; table_id: string }
  | {
      op: "add_foreign_key";
      table_id: string;
      foreign_key: ForeignKeySpec;
      // Declares existing carrier fields when replaying an explicit storage binding.
      storage_columns?: string[];
      method?: "sigma" | "pi" | null;
    }
  | {
      op: "add_reference";
      image?: Path;
      table_id: string;
      columns: ColumnSpec[];
      foreign_key: ForeignKeySpec;
      method?: "sigma" | "delta" | "pi" | null;
    }
  | { op: "drop_foreign_key"; table_id: string; foreign_key_id: string }
  | {
      op: "rename_arrow";
      table_id: string;
      arrow_id: string;
      new_name: string;
      method?: "sigma" | "delta" | "pi" | null;
    }
  | {
      op: "add_equation";
      table_id: string;
      equation: Equation;
      method?: "sigma" | "pi" | null;
    }
  | { op: "drop_equation"; table_id: string; equation_id: string }
  | { op: "drop_table"; table_id: string }
  | {
      op: "rename_table";
      table_id: string;
      new_name: string;
      method?: "sigma" | "delta" | "pi" | null;
    }
  | {
      op: "rename_column";
      method?: "sigma" | "delta" | "pi" | null;
      table_id: string;
      column_id: string;
      new_name: string;
    }
  | {
      op: "add_attribute";
      table_id: string;
      column: ColumnSpec;
      parameters: AttributeParameters;
    }
  | { op: "add_column"; table_id: string; column: ColumnSpec; value: TypedCell }
  | { op: "drop_column"; table_id: string; column_id: string }
  | {
      op: "copy_table";
      table_id: string;
      column_ids: string[];
      table: TableSpec;
    }
  | {
      op: "combine_tables";
      inputs: { table_id: string; column_ids: string[] }[];
      table: TableSpec;
      method: "sigma" | "pi";
    };
export type SqlBundle = { changes: string };

// Historical SQL-facing field names are decoded at loading boundaries only.
export function recordedOperation(value: unknown): Operation {
  const convert = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(convert);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(
      Object.entries(item).map(([key, value]) => [
        (
          {
            data_type: "dataType",
            primary_key: "primaryKey",
            unique_keys: "uniqueKeys",
          } as Record<string, string>
        )[key] ?? key,
        convert(value),
      ]),
    );
  };
  const operation = convert(value) as Operation;
  if (operation.op === "add_foreign_key") {
    const { lookup, ...reference } = operation.foreign_key as ForeignKeySpec & {
      lookup?: unknown;
    };
    return {
      ...operation,
      foreign_key: reference,
      ...(lookup ? { storage_columns: [...reference.source_columns] } : {}),
    };
  }
  return operation;
}
