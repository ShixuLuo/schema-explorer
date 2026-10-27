import type { Table } from "../model/schema.ts";
import type { TypedCell } from "../model/operations.ts";
import type { ModelEngine, Progress, WorkspaceStore } from "./ports.ts";
import { schemaSpec } from "../model/wire.ts";
import type { Relation } from "../model/schema.ts";

export async function validateCandidate(
  store: WorkspaceStore,
  engine: ModelEngine,
  tables: Table[],
  relationships: Relation[],
  progress: Progress,
) {
  const counts = Object.fromEntries(tables.map((t) => [t.id, t.rowCount]));
  await engine.validate(
    schemaSpec(tables, relationships),
    counts,
    async function* (tableId, columnIds) {
      const table = tables.find((t) => t.id === tableId);
      if (!table) throw new Error("The validator requested an unknown table.");
      const columns = columnIds.map((id) => {
        const c = table.columns.find((c) => c.id === id);
        if (!c) throw new Error("The validator requested an unknown field.");
        return c;
      });
      for await (const batch of store.rows(table))
        yield {
          start: batch.offset,
          rows: batch.rows.map(
            (row) =>
              Object.fromEntries(
                columns.map((c) => {
                  const value = row[c.index];
                  return [
                    c.id,
                    value === null
                      ? { type: "null" }
                      : { type: c.dataType ?? "text", value },
                  ];
                }),
              ) as Record<string, TypedCell>,
          ),
        };
    },
    progress,
  );
}
