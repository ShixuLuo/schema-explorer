import { ReadableFailure } from "../model/failure.ts";
import type { SchemaSpec, ForeignKeySpec } from "../model/operations.ts";
import { objectBinding, attributeBinding } from "../model/database-commands.ts";
import { freePiShape, internalKey } from "../model/free-arrow-shape.ts";
import {
  ident,
  literal,
  sqlName,
  syncIdentitySequences,
  type SqlResult,
} from "./sql-syntax.ts";
const nextId = (schema: SchemaSpec, id: string) => {
  const t = objectBinding(schema, id),
    key = attributeBinding(t, internalKey(schema, id)!);
  return `nextval(pg_get_serial_sequence(${literal({ type: "text", value: ident(t.name) })},${literal({ type: "text", value: key.name })}))`;
};
export function freeSigmaSql(schema: SchemaSpec, f: ForeignKeySpec): SqlResult {
  const statements: string[] = [],
    nodes: {
      id: string;
      name: string;
      children: { fk: ForeignKeySpec; name: string }[];
    }[] = [];
  let n = 0;
  const make = (id: string): string => {
    const name = sqlName("sigma_term", `${f.id}:${n++}`),
      children = schema.foreign_keys
        .filter((a) => a.source_table === id && a.id !== f.id)
        .map((a) => ({ fk: a, name: make(a.target_table) }));
    nodes.push({ id, name, children });
    statements.push(
      `CREATE TEMP TABLE ${name} ON COMMIT DROP AS SELECT ctid AS origin,${nextId(schema, id)} AS value FROM ${ident(objectBinding(schema, f.source_table).name)};`,
    );
    return name;
  };
  const root = make(f.target_table);
  for (const node of nodes) {
    const t = objectBinding(schema, node.id),
      joins = node.children.map(
        (c, i) => `JOIN ${c.name} AS c${i} ON c${i}.origin=r.origin`,
      );
    statements.push(
      `INSERT INTO ${ident(t.name)} (${t.columns.map((c) => ident(c.name)).join(",")}) SELECT ${t.columns
        .map((c) => {
          if (c.generated)
            return c.id === internalKey(schema, t.id)
              ? "r.value"
              : nextId(schema, t.id);
          const i = node.children.findIndex((x) =>
            x.fk.source_columns.includes(c.id),
          );
          if (i < 0) throw new Error("Unbound reference storage column.");
          return `c${i}.value`;
        })
        .join(",")} FROM ${node.name} AS r ${joins.join(" ")};`,
    );
  }
  const source = objectBinding(schema, f.source_table);
  statements.push(
    `UPDATE ${ident(source.name)} AS s SET ${ident(attributeBinding(source, f.source_columns[0]).name)}=r.value FROM ${root} AS r WHERE s.ctid=r.origin;`,
  );
  for (const node of nodes) statements.push(`DROP TABLE ${node.name};`);
  return {
    statements: [
      ...syncIdentitySequences(
        schema.tables.filter((t) => nodes.some((n) => n.id === t.id)),
      ),
      ...statements,
    ],
    changedData: [f.source_table, ...new Set(nodes.map((n) => n.id))],
  };
}
export function freePiSql(schema: SchemaSpec, f: ForeignKeySpec): SqlResult {
  const before = {
      ...schema,
      foreign_keys: schema.foreign_keys.filter((a) => a.id !== f.id),
    },
    shape = freePiShape(before, f);
  if (shape.issue) throw new ReadableFailure(shape.issue);
  const old = (id: string) => sqlName("pi_old", `${f.id}:${id}`),
    copies = (id: string) => sqlName("pi_copies", `${f.id}:${id}`);
  let prefix = "__pi_";
  while (
    schema.tables.some((t) => t.columns.some((c) => c.name.startsWith(prefix)))
  )
    prefix += "_";
  const oid = ident(`${prefix}row`),
    fresh = ident(`${prefix}identity`),
    variable = (i: number) => ident(`${prefix}choice_${i}`),
    statements: string[] = [];
  const affected = [...shape.paths]
    .filter(([, p]) => p.length)
    .map(([id]) => objectBinding(schema, id));
  for (const t of schema.tables)
    statements.push(
      `CREATE TEMP TABLE ${old(t.id)} ON COMMIT DROP AS SELECT row_number() OVER()::bigint AS ${oid},r.* FROM ${ident(t.name)} AS r;`,
    );
  for (const t of affected) {
    const paths = shape.paths.get(t.id)!;
    statements.push(
      `CREATE TEMP TABLE ${copies(t.id)} ON COMMIT DROP AS SELECT r.*,${paths.map((_, i) => `b${i}.${oid} AS ${variable(i)}`).join(",")}${internalKey(schema, t.id) ? `,${nextId(schema, t.id)} AS ${fresh}` : ""} FROM ${old(t.id)} AS r ${paths.map((_, i) => `CROSS JOIN ${old(f.target_table)} AS b${i}`).join(" ")};`,
    );
  }
  for (const t of affected) statements.push(`DELETE FROM ${ident(t.name)};`);
  for (const t of affected) {
    const paths = shape.paths.get(t.id)!,
      joins: string[] = [],
      values = new Map<string, string>();
    if (internalKey(schema, t.id))
      values.set(internalKey(schema, t.id)!, `r.${fresh}`);
    for (const [i, a] of schema.foreign_keys
      .filter((a) => a.source_table === t.id)
      .entries()) {
      const target = objectBinding(schema, a.target_table),
        childPaths = shape.paths.get(target.id);
      if (a.id === f.id) {
        const at = paths.findIndex((p) => p.length === 0);
        joins.push(
          `JOIN ${old(target.id)} AS b${i} ON b${i}.${oid}=r.${variable(at)}`,
        );
        a.source_columns.forEach((id, j) =>
          values.set(
            id,
            `b${i}.${ident(attributeBinding(target, a.target_columns[j]).name)}`,
          ),
        );
      } else if (childPaths?.length) {
        joins.push(
          `JOIN ${old(target.id)} AS o${i} ON ${a.source_columns.map((id, j) => `r.${ident(attributeBinding(t, id).name)}=o${i}.${ident(attributeBinding(target, a.target_columns[j]).name)}`).join(" AND ")}`,
          `JOIN ${copies(target.id)} AS c${i} ON c${i}.${oid}=o${i}.${oid} AND ${childPaths
            .map((p, j) => {
              const at = shape.indices
                .get(t.id)
                ?.get(JSON.stringify([a.id, ...p]));
              if (at === undefined) throw new Error("Incomplete Pi path cone.");
              return `c${i}.${variable(j)}=r.${variable(at)}`;
            })
            .join(" AND ")}`,
        );
        a.source_columns.forEach((id, j) =>
          values.set(
            id,
            a.target_columns[j] === internalKey(schema, target.id)
              ? `c${i}.${fresh}`
              : `c${i}.${ident(attributeBinding(target, a.target_columns[j]).name)}`,
          ),
        );
      }
    }
    statements.push(
      `INSERT INTO ${ident(t.name)} (${t.columns.map((c) => ident(c.name)).join(",")}) SELECT ${t.columns.map((c) => values.get(c.id) ?? `r.${ident(c.name)}`).join(",")} FROM ${copies(t.id)} AS r ${joins.join("\n")};`,
    );
  }
  for (const t of affected) statements.push(`DROP TABLE ${copies(t.id)};`);
  for (const t of schema.tables) statements.push(`DROP TABLE ${old(t.id)};`);
  return {
    statements: [...syncIdentitySequences(affected), ...statements],
    changedData: affected.map((t) => t.id),
    expansions: affected.map((t) => ({
      tableId: t.id,
      choicesTableId: f.target_table,
      paths: shape.paths.get(t.id)!.length,
      width: t.columns.length,
    })),
  };
}
