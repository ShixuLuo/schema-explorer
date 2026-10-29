import {
  attributeBinding,
  identityColumns,
  objectBinding,
} from "../model/database-commands.ts";
import {
  attributeId,
  referenceId,
  storagePresentation,
} from "../model/database-presentation.ts";
import type { SchemaSpec } from "../model/operations.ts";
import { endpoint, type Path, samePath } from "../model/presentation.ts";
import { bodyLiteral, ident, literal, sqlName } from "./sql-syntax.ts";

export function projectPath(
  schema: SchemaSpec,
  path: Path,
  root: string,
  prefix: string,
) {
  endpoint(storagePresentation(schema), path);
  if (path.constant)
    return {
      joins: [] as string[],
      missing: [] as string[],
      objects: [{ id: path.source, alias: root }],
      values: [
        literal(
          path.constant.value === null
            ? { type: "null" }
            : {
                type:
                  path.constant.sort === "type:integer" ? "integer" : "text",
                value: path.constant.value,
              },
        ),
      ],
    };
  let object = objectBinding(schema, path.source),
    alias = root;
  const joins: string[] = [],
    missing: string[] = [],
    objects = [{ id: object.id, alias }];
  for (const [index, id] of path.arrows.entries()) {
    const attribute = object.columns.find((c) => attributeId(c.id) === id);
    if (attribute)
      return {
        joins,
        missing,
        objects,
        values: [`${alias}.${ident(attribute.name)}`],
      };
    const arrow = schema.foreign_keys.find(
      (a) => referenceId(a.id) === id && a.source_table === object.id,
    );
    if (!arrow) throw new Error("This path has no database binding.");
    const target = objectBinding(schema, arrow.target_table),
      next = `${prefix}${index}`;
    joins.push(
      `LEFT JOIN ${ident(target.name)} AS ${next} ON ${arrow.source_columns.map((id, i) => `${alias}.${ident(attributeBinding(object, id).name)} = ${next}.${ident(attributeBinding(target, arrow.target_columns[i]).name)}`).join(" AND ")}`,
    );
    missing.push(
      `${next}.${ident(attributeBinding(target, arrow.target_columns[0]).name)} IS NULL`,
    );
    object = target;
    alias = next;
    objects.push({ id: object.id, alias });
  }
  if (!identityColumns(object).length)
    throw new Error(
      `Declare an identity key on ${object.name} to interpret its identity path.`,
    );
  return {
    joins,
    missing,
    objects,
    values: identityColumns(object).map(
      (id) => `${alias}.${ident(attributeBinding(object, id).name)}`,
    ),
  };
}
export type EquationSql = { create: string[]; drop: string[] };
export function equationTemplates(
  schema: SchemaSpec,
): Map<string, EquationSql> {
  const result = new Map<string, EquationSql>();
  for (const equation of schema.equations ?? []) {
    if (samePath(equation.left, equation.right)) {
      result.set(equation.id, { create: [], drop: [] });
      continue;
    }
    const source = objectBinding(schema, equation.left.source),
      left = projectPath(schema, equation.left, "r", "l"),
      right = projectPath(schema, equation.right, "r", "q");
    const joins = [...left.joins, ...right.joins].join("\n");
    const mismatch = [
      ...left.missing,
      ...right.missing,
      `ROW(${left.values.join(", ")}) IS DISTINCT FROM ROW(${right.values.join(", ")})`,
    ].join(" OR ");
    const query = (from: string, scope = "") =>
      `SELECT 1 FROM ${from} AS r\n${joins}\nWHERE (${mismatch})${scope ? `\n  AND (${scope})` : ""}`;
    const assertion = (check: string) =>
      `IF EXISTS (\n${check}\n) THEN\n  RAISE EXCEPTION ${literal({ type: "text", value: `Path equation on ${source.name} is violated` })};\nEND IF;`;
    const create = [
        `DO ${bodyLiteral(`BEGIN\n${assertion(query(ident(source.name)))}\nEND;`)};`,
      ],
      drop: string[] = [];
    const aliases = [
      ...new Map(
        [...left.objects, ...right.objects].map((o) => [o.alias, o]),
      ).values(),
    ];
    for (const id of new Set(aliases.map((o) => o.id))) {
      const table = objectBinding(schema, id),
        bound = aliases.filter((a) => a.id === id);
      for (const event of ["INSERT", "UPDATE", "DELETE"] as const) {
        // With no source identity, its new transition rows are sufficient.
        // Every intermediate object already has an identity through its arrow binding.
        if (!identityColumns(table).length && event === "DELETE") continue;
        const name = sqlName("eq", `${equation.id}:${id}:${event}`);
        let check: string, references: string;
        if (!identityColumns(table).length) {
          if (id !== source.id)
            throw new Error("An intermediate path object needs a primary key.");
          check = query("changed_rows");
          references = "NEW TABLE AS changed_rows";
        } else {
          const keys = identityColumns(table).map((id) =>
            ident(attributeBinding(table, id).name),
          );
          const changed =
            event === "UPDATE"
              ? `(SELECT ${keys.join(", ")} FROM old_rows UNION SELECT ${keys.join(", ")} FROM new_rows)`
              : "changed_rows";
          const scope = bound
            .map(
              (a) =>
                `EXISTS (SELECT 1 FROM ${changed} AS changed WHERE ROW(${keys.map((k) => `${a.alias}.${k}`).join(", ")}) IS NOT DISTINCT FROM ROW(${keys.map((k) => `changed.${k}`).join(", ")}))`,
            )
            .join(" OR ");
          check = query(ident(source.name), scope);
          references =
            event === "UPDATE"
              ? "OLD TABLE AS old_rows NEW TABLE AS new_rows"
              : `${event === "INSERT" ? "NEW" : "OLD"} TABLE AS changed_rows`;
        }
        create.push(
          `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS ${bodyLiteral(`BEGIN\n${assertion(check)}\nRETURN NULL;\nEND;`)};`,
        );
        create.push(
          `CREATE TRIGGER ${name} AFTER ${event} ON ${ident(table.name)}\nREFERENCING ${references}\nFOR EACH STATEMENT EXECUTE FUNCTION ${name}();`,
        );
        drop.push(
          `DROP TRIGGER ${name} ON ${ident(table.name)};`,
          `DROP FUNCTION ${name}();`,
        );
      }
    }
    result.set(equation.id, { create, drop });
  }
  return result;
}
