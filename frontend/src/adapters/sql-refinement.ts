import type { DatabaseChange } from "../model/database-commands.ts";
import { attributeBinding, objectBinding } from "../model/database-commands.ts";
import { referenceId } from "../model/database-presentation.ts";
import { samePath } from "../model/presentation.ts";
import { freePiSql, freeSigmaSql } from "./sql-free-arrow.ts";
import { quotientSql } from "./sql-quotient.ts";

import type { ForeignKeySpec, SchemaSpec } from "../model/operations.ts";
import { equationTemplates, projectPath } from "./sql-paths.ts";
import {
  bodyLiteral,
  ident,
  sqlName,
  sqlType,
  syncIdentitySequences,
  type SqlResult,
} from "./sql-syntax.ts";
const match = (schema: SchemaSpec, f: ForeignKeySpec) =>
  f.source_columns
    .map(
      (id, i) =>
        `s.${ident(attributeBinding(objectBinding(schema, f.source_table), id).name)} = t.${ident(attributeBinding(objectBinding(schema, f.target_table), f.target_columns[i]).name)}`,
    )
    .join(" AND ");
const missing = (schema: SchemaSpec, f: ForeignKeySpec) =>
  `NOT EXISTS (SELECT 1 FROM ${ident(objectBinding(schema, f.target_table).name)} AS t WHERE ${match(schema, f)})`;
function restriction(schema: SchemaSpec) {
  const queries: string[] = [];
  for (const f of schema.foreign_keys)
    queries.push(
      `DELETE FROM ${ident(objectBinding(schema, f.source_table).name)} AS s WHERE ${missing(schema, f)};`,
    );
  for (const e of schema.equations ?? []) {
    if (samePath(e.left, e.right)) continue;
    const source = objectBinding(schema, e.left.source),
      left = projectPath(schema, e.left, "r", "l"),
      right = projectPath(schema, e.right, "r", "q");
    const mismatch = [
      ...left.missing,
      ...right.missing,
      `ROW(${left.values.join(", ")}) IS DISTINCT FROM ROW(${right.values.join(", ")})`,
    ].join(" OR ");
    queries.push(
      `DELETE FROM ${ident(source.name)} WHERE ctid IN (SELECT r.ctid FROM ${ident(source.name)} AS r ${[...left.joins, ...right.joins].join("\n")} WHERE ${mismatch});`,
    );
  }
  return `DO ${bodyLiteral(`DECLARE removed_count bigint; step_count bigint; BEGIN\nLOOP\nremoved_count := 0;\n${queries.map((q) => `${q}\nGET DIAGNOSTICS step_count = ROW_COUNT;\nremoved_count := removed_count + step_count;`).join("\n")}\nEXIT WHEN removed_count = 0;\nEND LOOP;\nEND;`)};`;
}
export function refinementSql(
  change: DatabaseChange,
  createReferences: (schema: SchemaSpec) => string[],
): SqlResult | undefined {
  const {
    before,
    after,
    abstract: { migration },
  } = change;
  if (
    migration.kind !== "sigma" &&
    migration.kind !== "pi" &&
    migration.kind !== "delta"
  )
    return;
  const method = migration.kind;
  const f = after.foreign_keys.find(
    (f) => !before.foreign_keys.some((old) => old.id === f.id),
  );
  const equation = (after.equations ?? []).find(
    (e) => !(before.equations ?? []).some((old) => old.id === e.id),
  );
  if (!f && !equation) return;
  const columns = f
    ? objectBinding(after, f.source_table).columns.filter(
        (c) =>
          !objectBinding(before, f.source_table).columns.some(
            (old) => old.id === c.id,
          ),
      )
    : [];
  let changedData: string[] = [],
    expansions: SqlResult["expansions"];
  const statements = [...equationTemplates(before).values()].flatMap(
    (e) => e.drop,
  );
  statements.push(
    ...before.foreign_keys.map(
      (f) =>
        `ALTER TABLE ${ident(objectBinding(before, f.source_table).name)} DROP CONSTRAINT ${sqlName("fk", f.id)};`,
    ),
  );
  if (equation && method === "sigma") {
    statements.push(...quotientSql(after, equation.id));
    changedData = after.tables.map((t) => t.id);
  } else if (f && columns.length) {
    const source = objectBinding(after, f.source_table),
      target = objectBinding(after, f.target_table);
    statements.push(
      ...columns.map(
        (c) =>
          `ALTER TABLE ${ident(source.name)} ADD COLUMN ${ident(c.name)} ${sqlType(c)};`,
      ),
    );
    if (method === "delta") {
      const image = migration.mapping.arrows[referenceId(f.id)];
      if (!image) throw new Error("Choose a path for Δ.");
      changedData = [source.id];
      const path = projectPath(before, image, "s", "mapped_"),
        last = path.objects.at(-1)!;
      if (last.id !== f.target_table)
        throw new Error("The selected path must end at the arrow target.");
      statements.push(
        `UPDATE ${ident(source.name)} AS dest SET (${f.source_columns.map((id) => ident(attributeBinding(source, id).name)).join(",")}) = (SELECT ${f.target_columns.map((id) => `${last.alias}.${ident(attributeBinding(target, id).name)}`).join(",")} FROM ${ident(source.name)} AS s ${path.joins.join(" ")} WHERE s.ctid=dest.ctid);`,
      );
    } else {
      const result =
        method === "pi" ? freePiSql(after, f) : freeSigmaSql(after, f);
      statements.push(...result.statements);
      changedData = result.changedData;
      expansions = result.expansions;
    }
    if (method === "sigma" && after.equations?.length) {
      statements.push(...quotientSql(after, f.id));
      changedData = after.tables.map((t) => t.id);
    }
  } else if (method === "pi") {
    statements.push(restriction(after));
    changedData = after.tables.map((t) => t.id);
  } else if (f) {
    const source = objectBinding(after, f.source_table),
      target = objectBinding(after, f.target_table);
    changedData = [target.id];
    statements.push(...syncIdentitySequences([target]));
    const columns = f.target_columns.map((id) =>
        ident(attributeBinding(target, id).name),
      ),
      values = f.source_columns.map(
        (id) => `s.${ident(attributeBinding(source, id).name)}`,
      );
    statements.push(
      `INSERT INTO ${ident(target.name)} (${columns.join(", ")}) SELECT DISTINCT ${values.join(", ")} FROM ${ident(source.name)} AS s WHERE ${missing(after, f)} AND ${values.map((v) => `${v} IS NOT NULL`).join(" AND ")};`,
    );
  }
  if (f && !columns.length && method === "sigma")
    statements.push(
      ...syncIdentitySequences([objectBinding(after, f.target_table)]),
    );
  for (const table of after.tables) {
    const old = objectBinding(before, table.id);
    for (const column of table.columns)
      if (
        !column.nullable &&
        (!old.columns.some((c) => c.id === column.id) ||
          old.columns.find((c) => c.id === column.id)?.nullable)
      )
        statements.push(
          `ALTER TABLE ${ident(table.name)} ALTER COLUMN ${ident(column.name)} SET NOT NULL;`,
        );
  }
  statements.push(
    ...createReferences(after),
    ...[...equationTemplates(after).values()].flatMap((e) => e.create),
  );
  return { statements, changedData, ...(expansions ? { expansions } : {}) };
}
