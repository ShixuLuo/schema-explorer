import type { FailureInfo } from "./failure.ts";
import type { SchemaSpec, ForeignKeySpec } from "./operations.ts";
export function internalKey(schema: SchemaSpec, id: string) {
  const t = schema.tables.find((t) => t.id === id)!;
  return t.primaryKey.length === 1 &&
    t.columns.find((c) => c.id === t.primaryKey[0])?.generated === "identity"
    ? t.primaryKey[0]
    : undefined;
}
export function freeSigmaIssue(
  schema: SchemaSpec,
  f: ForeignKeySpec,
): FailureInfo | undefined {
  const visiting = new Set<string>(),
    seen = new Set<string>();
  const walk = (id: string): FailureInfo | undefined => {
    if (id === f.source_table || visiting.has(id))
      return {
        kind: "unsupported",
        message: "Σ along a cycle can require infinitely many fresh records.",
      };
    if (seen.has(id)) return;
    visiting.add(id);
    const t = schema.tables.find((t) => t.id === id)!;
    if (
      !internalKey(schema, id) ||
      t.columns.some((c) => !c.generated && c.storage !== "reference")
    )
      return {
        kind: "typeside",
        message: `Σ needs symbolic values for business attributes or keys on ${t.name}; the current SQL typeside cannot represent them.`,
      };
    const out = schema.foreign_keys.filter((a) => a.source_table === id);
    if (
      t.columns.some(
        (c) =>
          c.storage === "reference" &&
          out.filter((a) => a.source_columns.includes(c.id)).length !== 1,
      )
    )
      return {
        kind: "binding",
        message: `Σ needs one independent storage carrier per arrow on ${t.name}.`,
      };
    for (const a of out) {
      if (
        a.target_columns.length !== 1 ||
        a.target_columns[0] !== internalKey(schema, a.target_table)
      )
        return {
          kind: "binding",
          message: "Σ chase requires internal identity targets.",
        };
      const error = walk(a.target_table);
      if (error) return error;
    }
    visiting.delete(id);
    seen.add(id);
  };
  if (
    f.target_columns.length !== 1 ||
    f.target_columns[0] !== internalKey(schema, f.target_table)
  )
    return {
      kind: "binding",
      message: "This Σ template requires a generated Integer target identity.",
    };
  const error = walk(f.target_table);
  if (error) return error;
  const terms = new Map<string, number>();
  const size = (id: string): number => {
    if (terms.has(id)) return terms.get(id)!;
    const n =
      1 +
      schema.foreign_keys
        .filter((a) => a.source_table === id)
        .reduce((n, a) => n + size(a.target_table), 0);
    terms.set(id, n);
    return n;
  };
  if (size(f.target_table) > 256)
    return {
      kind: "compiler-limit",
      message:
        "This finite Σ chase exceeds 256 term templates; it is not supported by the local compiler.",
    };
}
export type FreePiShape = {
  paths: Map<string, string[][]>;
  indices: Map<string, Map<string, number>>;
  issue?: FailureInfo;
};
export function freePiShape(
  schema: SchemaSpec,
  f: ForeignKeySpec,
): FreePiShape {
  const paths = new Map<string, string[][]>(),
    active = new Set<string>();
  let issue: FailureInfo | undefined;
  // Only cycles on paths leading to the new arrow matter.
  const ancestors = new Set([f.source_table]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const a of schema.foreign_keys)
      if (ancestors.has(a.target_table) && !ancestors.has(a.source_table)) {
        ancestors.add(a.source_table);
        changed = true;
      }
  }
  const relevant = {
    ...schema,
    foreign_keys: schema.foreign_keys.filter(
      (a) => ancestors.has(a.source_table) && ancestors.has(a.target_table),
    ),
  };
  const visit = (id: string): string[][] => {
    if (paths.has(id)) return paths.get(id)!;
    if (active.has(id)) {
      issue = {
        kind: "unsupported",
        message:
          "Π through cycles requires a potentially unbounded space of paths.",
      };
      return [];
    }
    active.add(id);
    const result: string[][] = id === f.source_table ? [[]] : [];
    for (const a of relevant.foreign_keys.filter((a) => a.source_table === id))
      for (const p of visit(a.target_table)) {
        if (result.length >= 4096) {
          issue = {
            kind: "compiler-limit",
            message:
              "This finite path space exceeds the SQL template compilation limit.",
          };
          break;
        }
        result.push([a.id, ...p]);
      }
    active.delete(id);
    paths.set(id, result);
    return result;
  };
  for (const id of ancestors) visit(id);
  if (ancestors.has(f.target_table))
    issue = {
      kind: "unsupported",
      message:
        "This new arrow creates a cycle; a finite Π template is not available.",
    };
  for (const id of ancestors) {
    const t = schema.tables.find((t) => t.id === id)!;
    if (
      t.uniqueKeys?.length ||
      t.primaryKey.some(
        (c) => t.columns.find((x) => x.id === c)?.generated !== "identity",
      )
    )
      issue = {
        kind: "binding",
        message: `Π duplicates ${t.name} records. This template requires generated Integer identities and no additional business unique keys.`,
      };
  }

  if (
    schema.foreign_keys.some(
      (a) =>
        ancestors.has(a.target_table) &&
        a.source_columns.some(
          (id) =>
            schema.tables
              .find((t) => t.id === a.source_table)!
              .columns.find((c) => c.id === id)?.storage !== "reference",
        ),
    )
  )
    issue = {
      kind: "binding",
      message:
        "Π must rewrite incoming references; their columns must be separate storage carriers, not business attributes.",
    };
  const indices = new Map<string, Map<string, number>>();
  // A finite DAG has finitely many paths. Quotient those paths by every
  // declared relation in context before forming the right-Kan cones.
  for (const [id, all] of paths) {
    const lookup = new Map(all.map((p, i) => [JSON.stringify(p), i])),
      parent = all.map((_, i) => i);
    const find = (i: number): number =>
      parent[i] === i ? i : (parent[i] = find(parent[i]));
    for (const [i, p] of all.entries()) {
      let current = id;
      for (let at = 0; at <= p.length; at++) {
        for (const e of schema.equations ?? []) {
          if (e.left.source !== current) continue;
          for (const [from, to] of [
            [e.left, e.right],
            [e.right, e.left],
          ]) {
            if (
              [...from.arrows, ...to.arrows].some(
                (a) => !a.startsWith("reference:"),
              )
            )
              continue;
            const left = from.arrows.map((a) => a.slice(10)),
              right = to.arrows.map((a) => a.slice(10));
            if (!left.every((a, j) => p[at + j] === a)) continue;
            const other = lookup.get(
              JSON.stringify([
                ...p.slice(0, at),
                ...right,
                ...p.slice(at + left.length),
              ]),
            );
            if (other !== undefined) parent[find(other)] = find(i);
          }
        }
        if (at < p.length)
          current = schema.foreign_keys.find(
            (a) => a.id === p[at],
          )!.target_table;
      }
    }
    const reps = [...new Set(all.map((_, i) => find(i)))];
    indices.set(
      id,
      new Map(all.map((p, i) => [JSON.stringify(p), reps.indexOf(find(i))])),
    );
    paths.set(
      id,
      reps.map((i) => all[i]),
    );
  }
  if ([...paths.values()].some((p) => p.length > 32))
    issue = {
      kind: "compiler-limit",
      message:
        "This Π cone has more than 32 independent path choices; it exceeds the local SQL template limit.",
    };
  return { paths, indices, issue };
}
