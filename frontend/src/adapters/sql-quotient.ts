import type { DataType } from "../model/schema.ts";
import { quotientIssue } from "../model/migration-options.ts";
import { ReadableFailure } from "../model/failure.ts";
import type { SchemaSpec } from "../model/operations.ts";
import type { Path } from "../model/presentation.ts";
import {
  attributeId,
  referenceId,
  storageColumn,
} from "../model/database-presentation.ts";
import { objectBinding, attributeBinding } from "../model/database-commands.ts";
import { ident, literal, sqlName, bodyLiteral } from "./sql-syntax.ts";

// Finite congruence closure. SQL snapshots retain every original record until
// equalities, arrow compatibility and all fixed scalar values have been checked.
export function quotientSql(schema: SchemaSpec, token: string): string[] {
  const issue = quotientIssue(schema);
  if (issue) throw new ReadableFailure(issue);
  const old = (id: string) => sqlName("q_rows", `${token}:${id}`),
    map = (id: string) => sqlName("q_map", `${token}:${id}`),
    pairs = (id: string) => sqlName("q_pairs", `${token}:${id}`),
    edges = (id: string) => sqlName("q_edges", `${token}:${id}`);
  let oidName = "__quotient_row";
  while (schema.tables.some((t) => t.columns.some((c) => c.name === oidName)))
    oidName += "_";
  const oid = ident(oidName),
    statements: string[] = [];
  for (const table of schema.tables)
    statements.push(
      `CREATE TEMP TABLE ${old(table.id)} ON COMMIT DROP AS SELECT row_number() OVER ()::bigint AS ${oid}, r.* FROM ${ident(table.name)} AS r;`,
      `CREATE TEMP TABLE ${map(table.id)} (id bigint PRIMARY KEY, rep bigint NOT NULL) ON COMMIT DROP;`,
      `INSERT INTO ${map(table.id)} SELECT ${oid},${oid} FROM ${old(table.id)};`,
      `CREATE TEMP TABLE ${pairs(table.id)} (a bigint, b bigint, PRIMARY KEY(a,b)) ON COMMIT DROP;`,
    );
  for (const f of schema.foreign_keys) {
    const s = objectBinding(schema, f.source_table),
      t = objectBinding(schema, f.target_table);
    statements.push(
      `CREATE TEMP TABLE ${edges(f.id)} ON COMMIT DROP AS SELECT s.${oid} AS src,t.${oid} AS dst FROM ${old(s.id)} AS s JOIN ${old(t.id)} AS t ON ${f.source_columns.map((id, i) => `s.${ident(attributeBinding(s, id).name)}=t.${ident(attributeBinding(t, f.target_columns[i]).name)}`).join(" AND ")};`,
    );
  }
  const path = (p: Path, prefix: string) => {
    let table = objectBinding(schema, p.source),
      alias = "r";
    const joins: string[] = [];
    for (const [i, id] of p.arrows.entries()) {
      const c = table.columns.find((c) => attributeId(c.id) === id);
      if (c)
        return {
          joins,
          value: `${alias}.${ident(c.name)}`,
          table,
          type: "scalar",
        };
      const f = schema.foreign_keys.find(
        (f) => referenceId(f.id) === id && f.source_table === table.id,
      );
      if (!f) throw new Error("A relation path has no SQL binding.");
      const e = `${prefix}e${i}`,
        next = `${prefix}r${i}`;
      joins.push(
        `JOIN ${edges(f.id)} AS ${e} ON ${e}.src=${alias}.${oid}`,
        `JOIN ${old(f.target_table)} AS ${next} ON ${next}.${oid}=${e}.dst`,
      );
      table = objectBinding(schema, f.target_table);
      alias = next;
    }
    if (p.constant)
      return {
        joins,
        value: literal(
          p.constant.value === null
            ? { type: "null" }
            : {
                type: p.constant.sort.slice(5) as DataType,
                value: p.constant.value,
              },
        ),
        table,
        type: "scalar",
      };
    return { joins, value: `${alias}.${oid}`, table, type: "entity" };
  };
  for (const equation of schema.equations ?? []) {
    const l = path(equation.left, "l"),
      r = path(equation.right, "q"),
      from = `FROM ${old(equation.left.source)} AS r ${[...l.joins, ...r.joins].join("\n")}`;
    if (l.type === "scalar")
      statements.push(
        `DO ${bodyLiteral(`BEGIN IF EXISTS(SELECT 1 ${from} WHERE ${l.value} IS DISTINCT FROM ${r.value}) THEN RAISE EXCEPTION 'Σ cannot identify unequal business attribute values.'; END IF; END;`)};`,
      );
    else
      statements.push(
        `INSERT INTO ${pairs(l.table.id)} SELECT LEAST(${l.value},${r.value}),GREATEST(${l.value},${r.value}) ${from} WHERE ${l.value}<>${r.value} ON CONFLICT DO NOTHING;`,
      );
  }
  const closure: string[] = [];
  for (const table of schema.tables)
    closure.push(
      `UPDATE ${map(table.id)} AS m SET rep=candidate.rep FROM (SELECT n.id,min(other.rep) AS rep FROM (SELECT a AS id,b AS neighbor FROM ${pairs(table.id)} UNION ALL SELECT b,a FROM ${pairs(table.id)}) AS n JOIN ${map(table.id)} AS other ON other.id=n.neighbor GROUP BY n.id) AS candidate WHERE m.id=candidate.id AND candidate.rep<m.rep;`,
      `GET DIAGNOSTICS step_count=ROW_COUNT; changed_count:=changed_count+step_count;`,
    );
  for (const f of schema.foreign_keys)
    closure.push(
      `INSERT INTO ${pairs(f.target_table)} SELECT DISTINCT LEAST(a.dst,b.dst),GREATEST(a.dst,b.dst) FROM ${edges(f.id)} AS a JOIN ${map(f.source_table)} AS x ON x.id=a.src JOIN ${map(f.source_table)} AS y ON y.rep=x.rep JOIN ${edges(f.id)} AS b ON b.src=y.id WHERE a.dst<>b.dst ON CONFLICT DO NOTHING;`,
      `GET DIAGNOSTICS step_count=ROW_COUNT; changed_count:=changed_count+step_count;`,
    );
  statements.push(
    `DO ${bodyLiteral(`DECLARE changed_count bigint;step_count bigint;BEGIN LOOP changed_count:=0;${closure.join("\n")} EXIT WHEN changed_count=0; END LOOP;END;`)};`,
  );
  for (const table of schema.tables) {
    const attrs = table.columns.filter((c) => !storageColumn(c));
    if (!attrs.length) continue;
    const values = (a: string) =>
      `ROW(${attrs.map((c) => `${a}.${ident(c.name)}`).join(",")})`;
    statements.push(
      `DO ${bodyLiteral(`BEGIN IF EXISTS(SELECT 1 FROM ${old(table.id)} AS a JOIN ${map(table.id)} AS m ON m.id=a.${oid} JOIN ${old(table.id)} AS b ON b.${oid}=m.rep WHERE ${values("a")} IS DISTINCT FROM ${values("b")}) THEN RAISE EXCEPTION ${literal({ type: "text", value: `Σ cannot merge ${table.name} records with different business attribute values.` })};END IF;END;`)};`,
    );
  }
  // Remove rows after all checks, then rebuild representatives and their arrows.
  for (const table of schema.tables)
    statements.push(`DELETE FROM ${ident(table.name)};`);
  for (const table of schema.tables) {
    const joins = [
        `JOIN ${map(table.id)} AS own ON own.id=r.${oid} AND own.rep=own.id`,
      ],
      replacements = new Map<string, string>();
    for (const [i, f] of schema.foreign_keys
      .filter((f) => f.source_table === table.id)
      .entries()) {
      const target = objectBinding(schema, f.target_table);
      joins.push(
        `JOIN ${edges(f.id)} AS e${i} ON e${i}.src=r.${oid}`,
        `JOIN ${map(target.id)} AS m${i} ON m${i}.id=e${i}.dst`,
        `JOIN ${old(target.id)} AS t${i} ON t${i}.${oid}=m${i}.rep`,
      );
      f.source_columns.forEach((id, j) => {
        const expr = `t${i}.${ident(attributeBinding(target, f.target_columns[j]).name)}`;
        replacements.set(id, expr);
      });
    }
    const from = `FROM ${old(table.id)} AS r ${joins.join("\n")}`;
    for (const c of table.columns.filter(
      (c) => !storageColumn(c) && replacements.has(c.id),
    ))
      statements.push(
        `DO ${bodyLiteral(`BEGIN IF EXISTS(SELECT 1 ${from} WHERE r.${ident(c.name)} IS DISTINCT FROM ${replacements.get(c.id)}) THEN RAISE EXCEPTION ${literal({ type: "text", value: `Σ would change business attribute ${table.name}.${c.name}; use a separate storage carrier for this arrow.` })};END IF;END;`)};`,
      );
    if (table.columns.length)
      statements.push(
        `INSERT INTO ${ident(table.name)} (${table.columns.map((c) => ident(c.name)).join(",")}) SELECT ${table.columns.map((c) => replacements.get(c.id) ?? `r.${ident(c.name)}`).join(",")} ${from};`,
      );
    else
      statements.push(
        `DO ${bodyLiteral(`DECLARE row_record record; BEGIN FOR row_record IN SELECT 1 ${from} LOOP INSERT INTO ${ident(table.name)} DEFAULT VALUES;END LOOP;END;`)};`,
      );
  }
  for (const f of schema.foreign_keys)
    statements.push(`DROP TABLE ${edges(f.id)};`);
  for (const table of schema.tables)
    statements.push(
      `DROP TABLE ${pairs(table.id)},${map(table.id)},${old(table.id)};`,
    );
  return statements;
}
