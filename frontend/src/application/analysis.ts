import type { Table, Column, Relation, CellValue } from "../model/schema.ts";
import type { WorkspaceStore } from "./ports.ts";
import { LIMITS } from "./limits.ts";
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const singular = (s: string) =>
  normalize(s).replace(/ies$/, "y").replace(/s$/, "");
async function scanRows(
  store: WorkspaceStore,
  table: Table,
  visit: (row: CellValue[]) => void,
) {
  for await (const batch of store.rows(table))
    for (const row of batch.rows) visit(row);
}
export async function findRelations(
  store: WorkspaceStore,
  tables: Table[],
  existing: Relation[],
  progress: (message: string) => void,
) {
  const result: Relation[] = [];
  let checkedPairs = 0;
  let limited = false;
  const planned: {
    source: Table;
    sc: Column;
    target: Table;
    tc: Column;
    priority: number;
  }[] = [];
  for (const target of tables)
    for (const tc of target.columns) {
      if (
        target.rowCount < 2 ||
        tc.emptyCount ||
        (tc.nullCount ?? 0) > 0 ||
        tc.distinctCount !== target.rowCount
      )
        continue;
      for (const source of tables)
        if (source.id !== target.id)
          for (const sc of source.columns) {
            const sn = normalize(sc.name),
              tn = normalize(tc.name),
              tableName = singular(target.name);
            const plausible =
              (sn === tn && tn !== "id") ||
              sn === tableName + tn ||
              (tn === "id" && sn === tableName + "id");
            if (
              (sc.dataType ?? "text") !== (tc.dataType ?? "text") ||
              !plausible ||
              !source.rowCount ||
              source.rowCount === sc.emptyCount
            )
              continue;
            if (
              existing.some(
                (r) =>
                  r.source.columnId === sc.id && r.target.columnId === tc.id,
              )
            )
              continue;
            const pair = {
              source,
              sc,
              target,
              tc,
              priority: sn === tableName + tn ? 2 : 1,
            };
            if (planned.length < LIMITS.relationPairs) planned.push(pair);
            else {
              limited = true;
              const lowest = planned.reduce(
                (index, item, i) =>
                  item.priority < planned[index].priority ? i : index,
                0,
              );
              if (pair.priority > planned[lowest].priority)
                planned[lowest] = pair;
            }
          }
    }
  planned.sort((a, b) => b.priority - a.priority);
  for (const { source, sc, target, tc } of planned) {
    checkedPairs++;
    progress(`Checking relationships · ${checkedPairs} of ${planned.length}`);
    const keys = new Set<string>();
    await scanRows(store, target, (row) => {
      if (row[tc.index]) keys.add(row[tc.index]!);
    });
    let checked = 0,
      matched = 0;
    await scanRows(store, source, (row) => {
      const v = row[sc.index];
      if (v) {
        checked++;
        if (keys.has(v)) matched++;
      }
    });
    if (checked && checked === matched) {
      const reverse = result.some(
        (r) => r.source.columnId === tc.id && r.target.columnId === sc.id,
      );
      if (!reverse && result.length < LIMITS.visibleRelations)
        result.push({
          id: `link:${sc.id}:${tc.id}`,
          source: { tableId: source.id, columnId: sc.id },
          target: { tableId: target.id, columnId: tc.id },
          checked,
          matched,
          sourceDistinct: sc.distinctCount,
          cardinality: sc.distinctCount === checked ? "1:1" : "N:1",
        });
    }
  }
  return {
    candidates: result,
    analysis: {
      checkedPairs,
      limited: limited || result.length >= LIMITS.visibleRelations,
    },
  };
}
