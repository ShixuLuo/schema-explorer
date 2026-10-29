import type { SchemaSpec } from "../model/operations.ts";
export type Term = {
  tag: "raw_term";
  annotation: null;
  head: string;
  arguments: Term[];
};
export type Binding = { variable: string; entity: string };
export type AssignmentValue = {
  bindings?: (Binding | { targetVariable: string; term: Term })[];
  term?: Term;
  equations?: { left: Term; right: Term }[];
};
export type Assignment = { holeId: string; value: AssignmentValue };
export type Hole = {
  holeId: string;
  kind: string;
  filled: boolean;
  expectedType?: string;
};
export type Plan = {
  aiPending?: boolean;
  status: string;
  holes?: Hole[];
  assignments?: Assignment[];
  diagnostics?: { code?: string; message: string }[];
  program?: string;
  programSha256?: string;
  manifest?: {
    source?: { nativeSchemaSpec?: SchemaSpec };
    target?: { nativeSchemaSpec?: SchemaSpec };
  };
};
export async function migrationRequest(
  action: "draft" | "validate",
  source: SchemaSpec,
  target: SchemaSpec,
  assignments: Assignment[],
  signal?: AbortSignal,
): Promise<Plan> {
  const response = await fetch(`/api/cql/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, target, assignments }),
    signal,
  });
  const body = await response.json();
  if (!response.ok || body.ok === false)
    throw new Error(
      body.error?.message ??
        body.error ??
        body.message ??
        "Migration service request failed",
    );
  return body.result ?? body;
}
export const variableTerm = (head: string): Term => ({
  tag: "raw_term",
  annotation: null,
  head,
  arguments: [],
});
export function pathOptions(
  source: SchemaSpec,
  bindings: Binding[],
  scalar: boolean,
) {
  const options: {
    label: string;
    term: Term;
    entity?: string;
    dataType?: string;
  }[] = [];
  function walk(entity: string, term: Term, label: string, depth: number) {
    if (!scalar) options.push({ label, term, entity });
    const table = source.tables.find((t) => t.id === entity);
    if (scalar)
      for (const col of table?.columns ?? [])
        if (col.storage !== "reference" && !col.generated)
          options.push({
            label: `${label}.${col.name}`,
            dataType: col.dataType,
            term: { ...variableTerm(col.id), arguments: [term] },
          });
    if (depth < 2)
      for (const fk of source.foreign_keys.filter(
        (f) => f.source_table === entity,
      ))
        walk(
          fk.target_table,
          { ...variableTerm(fk.id), arguments: [term] },
          `${label}.${fk.name ?? source.tables.find((t) => t.id === fk.target_table)?.name ?? "reference"}`,
          depth + 1,
        );
  }
  for (const b of bindings)
    walk(b.entity, variableTerm(b.variable), b.variable, 0);
  return options;
}

export const scalarType = (type: string) =>
  (
    ({
      text: "Text",
      integer: "Integer",
      real: "exactReal",
      boolean: "Bool",
    }) as Record<string, string>
  )[type];
export function nextVariable(bindings: Binding[]): string {
  let index = 1;
  while (bindings.some((b) => b.variable === `x${index}`)) index++;
  return `x${index}`;
}
export function updateAssignment(
  assignments: Assignment[],
  target: SchemaSpec,
  holeId: string,
  value: AssignmentValue,
): Assignment[] {
  const table = target.tables.find((t) => `${t.id}.from` === holeId);
  const stale = new Set<string>([holeId]);
  if (table) {
    stale.add(`${table.id}.where`);
    for (const c of table.columns) stale.add(`${table.id}.attribute.${c.id}`);
    for (const fk of target.foreign_keys)
      if (fk.source_table === table.id || fk.target_table === table.id)
        stale.add(`${fk.source_table}.foreignKey.${fk.id}`);
  }
  return [
    ...assignments.filter((a) => !stale.has(a.holeId)),
    { holeId, value },
  ];
}
export function stableDefaults(
  source: SchemaSpec,
  target: SchemaSpec,
): Assignment[] {
  const result: Assignment[] = [];
  const variable = variableTerm("x1");
  for (const table of target.tables) {
    const before = source.tables.find((t) => t.id === table.id);
    if (!before) continue;
    result.push({
      holeId: `${table.id}.from`,
      value: { bindings: [{ variable: "x1", entity: before.id }] },
    });
    for (const col of table.columns) {
      const old = before.columns.find((c) => c.id === col.id);
      if (
        old &&
        !col.generated &&
        col.storage !== "reference" &&
        !old.generated &&
        old.storage !== "reference" &&
        old.dataType === col.dataType
      )
        result.push({
          holeId: `${table.id}.attribute.${col.id}`,
          value: { term: { ...variableTerm(old.id), arguments: [variable] } },
        });
    }
    for (const fk of target.foreign_keys.filter(
      (f) => f.source_table === table.id,
    )) {
      const old = source.foreign_keys.find(
        (f) =>
          f.id === fk.id &&
          f.source_table === fk.source_table &&
          f.target_table === fk.target_table,
      );
      const same = (a: string[], b: string[]) =>
        JSON.stringify(a) === JSON.stringify(b);
      const destination = target.tables.find((t) => t.id === fk.target_table);
      const oldDestination = source.tables.find(
        (t) => t.id === fk.target_table,
      );
      if (
        !old ||
        !destination ||
        !oldDestination ||
        !same(old.source_columns, fk.source_columns) ||
        !same(old.target_columns, fk.target_columns)
      )
        continue;
      const compatible = (a: SchemaSpec["tables"][number], b: SchemaSpec["tables"][number], ids: string[]): boolean =>
        ids.every((id) => {
          const x = a.columns.find((c) => c.id === id),
            y = b.columns.find((c) => c.id === id);
          return x && y && x.dataType === y.dataType;
        });
      if (
        !compatible(before, table, fk.source_columns) ||
        !compatible(oldDestination, destination, fk.target_columns)
      )
        continue;
      result.push({
        holeId: `${table.id}.foreignKey.${fk.id}`,
        value: {
          bindings: [
            {
              targetVariable: "x1",
              term: { ...variableTerm(fk.id), arguments: [variable] },
            },
          ],
        },
      });
    }
  }
  return result;
}
