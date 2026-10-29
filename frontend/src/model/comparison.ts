import type { Equation } from "./presentation.ts";
import type { ForeignKeySpec, Table } from "./schema.ts";

// A comparison contains displayable model state, never storage references or
// records. Its meaning is independent of canvas layout and colour choices.
export type ViewTable = Pick<
  Table,
  | "id"
  | "name"
  | "rowCount"
  | "columns"
  | "primaryKey"
  | "uniqueKeys"
  | "dataStatus"
>;
export type ModelView = {
  tables: ViewTable[];
  relationships: ForeignKeySpec[];
  equations?: Equation[];
};
export type ChangeKind = "added" | "removed" | "changed";
export type ModelChange = { kind: ChangeKind; previousName?: string };
export type ComparisonMode = "before" | "changes" | "after";
export type ModelComparison = {
  before: ModelView;
  after: ModelView;
  changes: {
    tables: Record<string, ModelChange>;
    columns: Record<string, ModelChange>;
    relationships: Record<string, ModelChange>;
    equations?: Record<string, ModelChange>;
  };
};
const equal = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

export function modelView(
  tables: ViewTable[],
  relationships: ForeignKeySpec[],
  equations: Equation[] = [],
): ModelView {
  return {
    tables: tables.map((t) => ({
      id: t.id,
      name: t.name,
      rowCount: t.rowCount,
      ...(t.dataStatus ? { dataStatus: t.dataStatus } : {}),
      primaryKey: [...(t.primaryKey ?? [])],
      ...(t.uniqueKeys?.length
        ? { uniqueKeys: structuredClone(t.uniqueKeys) }
        : {}),
      columns: t.columns.map((c) => ({ ...c })),
    })),
    relationships: structuredClone(relationships),
    equations: structuredClone(equations),
  };
}
export function compareModels(
  before: ModelView,
  after: ModelView,
): ModelComparison {
  before = modelView(before.tables, before.relationships, before.equations);
  after = modelView(after.tables, after.relationships, after.equations);
  const changes: ModelComparison["changes"] = {
    tables: {},
    columns: {},
    relationships: {},
    equations: {},
  };
  for (const id of new Set(
    [...before.tables, ...after.tables].map((t) => t.id),
  )) {
    const old = before.tables.find((t) => t.id === id),
      next = after.tables.find((t) => t.id === id);
    if (!old || !next) {
      const kind = next ? "added" : "removed",
        table = (next ?? old)!;
      changes.tables[id] = { kind };
      for (const c of table.columns) changes.columns[c.id] = { kind };
      continue;
    }
    const oldKey = old.primaryKey ?? [],
      nextKey = next.primaryKey ?? [],
      keyChanged = !equal(oldKey, nextKey);
    for (const columnId of new Set(
      [...old.columns, ...next.columns].map((c) => c.id),
    )) {
      const a = old.columns.find((c) => c.id === columnId),
        b = next.columns.find((c) => c.id === columnId);
      if (!a || !b) {
        changes.columns[columnId] = { kind: b ? "added" : "removed" };
        continue;
      }
      if (
        a.name !== b.name ||
        (a.dataType ?? "text") !== (b.dataType ?? "text") ||
        (a.nullable ?? false) !== (b.nullable ?? false) ||
        (keyChanged &&
          (oldKey.includes(columnId) || nextKey.includes(columnId)))
      ) {
        changes.columns[columnId] = {
          kind: "changed",
          ...(a.name !== b.name ? { previousName: a.name } : {}),
        };
      }
    }
    if (
      old.name !== next.name ||
      old.rowCount !== next.rowCount ||
      keyChanged ||
      JSON.stringify(old.uniqueKeys ?? []) !==
        JSON.stringify(next.uniqueKeys ?? []) ||
      [...old.columns, ...next.columns].some((c) => changes.columns[c.id])
    )
      changes.tables[id] = {
        kind: "changed",
        ...(old.name !== next.name ? { previousName: old.name } : {}),
      };
  }
  for (const id of new Set(
    [...(before.equations ?? []), ...(after.equations ?? [])].map((e) => e.id),
  )) {
    const a = before.equations?.find((e) => e.id === id),
      b = after.equations?.find((e) => e.id === id);
    if (!a || !b) changes.equations![id] = { kind: b ? "added" : "removed" };
    else if (JSON.stringify(a) !== JSON.stringify(b))
      changes.equations![id] = { kind: "changed" };
  }
  for (const id of new Set(
    [...before.relationships, ...after.relationships].map((r) => r.id),
  )) {
    const a = before.relationships.find((r) => r.id === id),
      b = after.relationships.find((r) => r.id === id);
    if (!a || !b) {
      changes.relationships[id] = { kind: b ? "added" : "removed" };
      continue;
    }
    if (
      a.name !== b.name ||
      a.source_table !== b.source_table ||
      a.target_table !== b.target_table ||
      !equal(a.source_columns, b.source_columns) ||
      !equal(a.target_columns, b.target_columns)
    )
      changes.relationships[id] = { kind: "changed" };
  }
  return { before, after, changes };
}

// Changes keeps removed entities in context and uses the new definition for
// matching IDs. Before/After remain exact snapshots of their respective models.
export function comparisonView(
  comparison: ModelComparison,
  mode: ComparisonMode,
): ModelView {
  if (mode !== "changes") return comparison[mode];
  const { before, after } = comparison;
  const tables = before.tables.map((old) => {
    const next = after.tables.find((t) => t.id === old.id);
    if (!next) return old;
    const columns = old.columns.map(
      (c) => next.columns.find((n) => n.id === c.id) ?? c,
    );
    columns.push(
      ...next.columns.filter((c) => !old.columns.some((o) => o.id === c.id)),
    );
    return { ...next, columns };
  });
  tables.push(
    ...after.tables.filter((t) => !before.tables.some((b) => b.id === t.id)),
  );
  return {
    tables,
    relationships: [
      ...after.relationships,
      ...before.relationships.filter(
        (r) => !after.relationships.some((a) => a.id === r.id),
      ),
    ],
    equations: [
      ...(after.equations ?? []),
      ...(before.equations ?? []).filter(
        (e) => !after.equations?.some((n) => n.id === e.id),
      ),
    ],
  };
}
