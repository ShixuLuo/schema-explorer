import type { CellValue, Column, Table } from "./schema.ts";

export const isInteger = (s: string) =>
  /^[+-]?[0-9]+$/.test(s) &&
  (() => {
    try {
      const n = BigInt(s);
      return n >= -9223372036854775808n && n <= 9223372036854775807n;
    } catch {
      return false;
    }
  })();
export const typeHintId = (column: Column) => `type:${column.id}`;
export const canBeInteger = (table: Table, column: Column) =>
  (column.dataType ?? "text") === "text" &&
  table.rowCount > (column.nullCount ?? 0) &&
  column.integerFailures === 0;

// Evidence for display and recommendations, not an authority for migration.
// Rust checks every actual operation and declared constraint.
export class ColumnProfiler {
  private columns: Column[];
  private distinct: Set<string>[];
  constructor(columns: Column[]) {
    this.columns = columns;
    this.distinct = columns.map(() => new Set());
    for (const c of columns) {
      c.emptyCount = 0;
      c.distinctCount = 0;
      c.nullCount = 0;
      c.integerFailures = 0;
      c.formatChanges = 0;
    }
  }
  add(row: CellValue[]) {
    row.forEach((value, i) => {
      const c = this.columns[i];
      if (value === null) {
        c.nullCount = (c.nullCount ?? 0) + 1;
        return;
      }
      if (value.length) this.distinct[i].add(value);
      else c.emptyCount++;
      if (!isInteger(value)) c.integerFailures++;
      else if (BigInt(value).toString() !== value) c.formatChanges++;
    });
  }
  finish() {
    this.columns.forEach((c, i) => {
      c.distinctCount = this.distinct[i].size;
    });
  }
}
