// Database commands are macros over the independent presentation calculus.
// Names and columns are bindings; no records are read while translating.
import {
  type Migration,
  composeMigrations,
  migrationEndpoints,
} from "./migration.ts";
import type { Operation, SchemaSpec, TableSpec } from "./operations.ts";
import {
  type ElementaryEdit,
  type Path,
  type Presentation,
  applyEdits,
  checkedMapping,
  identityMapping,
  samePresentation,
  validatePresentation,
} from "./presentation.ts";
import { SQL_TYPESIDE } from "./typeside.ts";

export const attributeId = (id: string) => `attribute:${id}`;
export const referenceId = (id: string) => `reference:${id}`;
export const typeId = (type: string) => `type:${type}`;
export function bindingEquations(schema: SchemaSpec) {
  return schema.foreign_keys.flatMap((fk) => [
    ...fk.source_columns.map((id, i) => ({
      id: `binding:${fk.id}:key:${i}`,
      origin: "binding" as const,
      left: { source: fk.source_table, arrows: [attributeId(id)] },
      right: {
        source: fk.source_table,
        arrows: [referenceId(fk.id), attributeId(fk.target_columns[i])],
      },
    })),
  ]);
}
export function storagePresentation(schema: SchemaSpec): Presentation {
  const presentation: Presentation = {
    typeside: structuredClone(SQL_TYPESIDE),
    objects: [
      { id: typeId("text"), label: "Text", kind: "type" },
      { id: typeId("integer"), label: "Integer", kind: "type" },
      ...schema.tables.map((t) => ({
        id: t.id,
        label: t.name,
        kind: "entity" as const,
      })),
    ],
    arrows: [
      ...schema.tables.flatMap((t) =>
        t.columns.map((c) => ({
          id: attributeId(c.id),
          label: c.name,
          source: t.id,
          target: typeId(c.dataType),
        })),
      ),
      ...schema.foreign_keys.map((fk) => ({
        id: referenceId(fk.id),
        label:
          fk.name ??
          fk.source_columns
            .map(
              (id) =>
                schema.tables
                  .find((t) => t.id === fk.source_table)
                  ?.columns.find((c) => c.id === id)?.name ?? id,
            )
            .join(", "),
        source: fk.source_table,
        target: fk.target_table,
      })),
    ],
    equations: [
      ...structuredClone(schema.equations ?? []),
      ...bindingEquations(schema),
    ],
  };
  validatePresentation(presentation);
  return presentation;
}
// SQL identities and generated reference carriers encode records and arrows;
// they are not independent business attributes in the schema category.
export const storageColumn = (column: import("./operations.ts").ColumnSpec) =>
  !!column.generated || !!column.storage;
export function databasePresentation(schema: SchemaSpec): Presentation {
  const physical = storagePresentation(schema);
  const hidden = new Set(
    schema.tables.flatMap((t) =>
      t.columns.filter(storageColumn).map((c) => attributeId(c.id)),
    ),
  );
  const arrows = physical.arrows.filter((a) => !hidden.has(a.id));
  const equations = physical.equations.filter(
    (e) =>
      e.origin !== "binding" ||
      ![...e.left.arrows, ...e.right.arrows].some((id) => hidden.has(id)),
  );
  const presentation = { ...physical, arrows, equations };
  validatePresentation(presentation);
  return presentation;
}
export function editsFor(
  source: Presentation,
  target: Presentation,
): ElementaryEdit[] {
  const edits: ElementaryEdit[] = [];
  for (const e of source.equations)
    if (!target.equations.some((n) => JSON.stringify(n) === JSON.stringify(e)))
      edits.push({ kind: "drop_equation", id: e.id });
  for (const a of source.arrows)
    if (!target.arrows.some((n) => n.id === a.id))
      edits.push({ kind: "drop_arrow", id: a.id });
  for (const o of source.objects)
    if (!target.objects.some((n) => n.id === o.id))
      edits.push({ kind: "drop_object", id: o.id });
  for (const o of target.objects)
    if (!source.objects.some((n) => n.id === o.id))
      edits.push({ kind: "add_object", object: o });
  for (const a of target.arrows)
    if (!source.arrows.some((n) => n.id === a.id))
      edits.push({ kind: "add_arrow", arrow: a });
  for (const [kind, values, previous] of [
    ["object", target.objects, source.objects],
    ["arrow", target.arrows, source.arrows],
  ] as const) {
    for (const value of values)
      if (previous.some((p) => p.id === value.id && p.label !== value.label))
        edits.push({
          kind: "rename",
          target: kind,
          id: value.id,
          label: value.label,
        });
  }
  for (const e of target.equations)
    if (!source.equations.some((n) => JSON.stringify(n) === JSON.stringify(e)))
      edits.push({ kind: "add_equation", equation: e });
  return edits;
}
const identityParts = (p: Presentation) => ({
  objects: Object.fromEntries(p.objects.map((o) => [o.id, o.id])),
  arrows: Object.fromEntries(
    p.arrows.map((a) => [a.id, { source: a.source, arrows: [a.id] } as Path]),
  ),
});
export type AbstractChange = {
  source: Presentation;
  target: Presentation;
  edits: ElementaryEdit[];
  migration: Migration;
};

export function translateDatabaseCommand(
  before: SchemaSpec,
  after: SchemaSpec,
  command: Operation,
): AbstractChange {
  const source = databasePresentation(before),
    expected = databasePresentation(after),
    edits = editsFor(source, expected);
  const target = applyEdits(source, edits);
  if (!samePresentation(target, expected))
    throw new Error(
      "The database macro does not realize its presentation edits.",
    );
  let migration: Migration;
  if ("method" in command && command.method === null) {
    migration = {
      kind: "pending",
      source,
      target,
      parameters: ["migration choice"],
    };
  } else if (
    ["rename_table", "rename_column", "rename_arrow"].includes(command.op) &&
    "method" in command &&
    command.method &&
    command.method !== "delta"
  ) {
    migration = {
      kind: command.method,
      mapping: identityMapping(source, target),
    };
  } else if (command.op === "add_reference" && command.method === "delta") {
    if (!command.image)
      migration = {
        kind: "pending",
        source,
        target,
        parameters: ["arrow image"],
      };
    else {
      const parts = identityParts(target);
      parts.arrows[referenceId(command.foreign_key.id)] = command.image;
      migration = {
        kind: "delta",
        mapping: checkedMapping({ source: target, target: source, ...parts }),
      };
    }
  } else if (command.op === "copy_table") {
    const parts = identityParts(source);
    parts.objects[command.table.id] = command.table_id;
    command.table.columns.forEach((column, i) => {
      parts.arrows[attributeId(column.id)] = {
        source: command.table_id,
        arrows: [attributeId(command.column_ids[i])],
      };
    });
    migration = {
      kind: "delta",
      mapping: checkedMapping({ source: target, target: source, ...parts }),
    };
  } else if (command.op === "combine_tables") {
    const auxiliary = structuredClone(source),
      delta = identityParts(source),
      push = identityParts(source);
    command.inputs.forEach((input, i) => {
      const id = `${command.table.id}:input:${i}`;
      auxiliary.objects.push({ id, label: `Input ${i + 1}`, kind: "entity" });
      delta.objects[id] = input.table_id;
      push.objects[id] = command.table.id;
      command.table.columns.forEach((column, j) => {
        const arrow = `${id}:attribute:${j}`;
        auxiliary.arrows.push({
          id: arrow,
          label: column.name,
          source: id,
          target: typeId(column.dataType),
        });
        delta.arrows[arrow] = {
          source: input.table_id,
          arrows: [attributeId(input.column_ids[j])],
        };
        push.arrows[arrow] = {
          source: command.table.id,
          arrows: [attributeId(column.id)],
        };
      });
    });
    migration = composeMigrations([
      {
        kind: "delta",
        mapping: checkedMapping({
          source: auxiliary,
          target: source,
          ...delta,
        }),
      },
      {
        kind: command.method,
        mapping: checkedMapping({ source: auxiliary, target, ...push }),
      },
    ]);
  } else if (command.op === "create_table") {
    migration = {
      kind: command.method ?? "sigma",
      mapping: identityMapping(source, target),
    };
  } else if (
    [
      "drop_table",
      "drop_column",
      "drop_foreign_key",
      "drop_equation",
      "rename_table",
      "rename_column",
      "rename_arrow",
    ].includes(command.op)
  ) {
    migration = { kind: "delta", mapping: identityMapping(target, source) };
  } else if (command.op === "add_attribute") {
    const p = command.parameters;
    if (
      (p.template === "constant" && p.value) ||
      (p.template === "copy" && p.source_column)
    ) {
      const parts = identityParts(target);
      parts.arrows[attributeId(command.column.id)] =
        p.template === "copy"
          ? {
              source: command.table_id,
              arrows: [attributeId(p.source_column!)],
            }
          : {
              source: command.table_id,
              arrows: [],
              constant: {
                sort: typeId(command.column.dataType),
                value: p.value!.type === "null" ? null : p.value!.value,
              },
            };
      migration = {
        kind: "delta",
        mapping: checkedMapping({ source: target, target: source, ...parts }),
      };
    } else {
      // This is an unbound template, not a default data migration.
      migration = {
        kind: "pending",
        source,
        target,
        parameters: ["attribute migration"],
      };
    }
  } else if (command.op === "add_column" && storageColumn(command.column)) {
    migration = {
      kind: "interpret",
      source,
      target,
      parameters: ["storage initializer"],
    };
  } else if (command.op === "add_column") {
    const parts = identityParts(target);
    parts.arrows[attributeId(command.column.id)] = {
      source: command.table_id,
      arrows: [],
      constant: {
        sort: typeId(command.column.dataType),
        value: command.value.type === "null" ? null : command.value.value,
      },
    };
    migration = {
      kind: "delta",
      mapping: checkedMapping({ source: target, target: source, ...parts }),
    };
  } else if (
    (command.op === "add_foreign_key" ||
      command.op === "add_reference" ||
      command.op === "add_equation") &&
    command.method
  ) {
    migration = {
      kind: command.method,
      mapping: identityMapping(source, target),
    };
  } else if (command.op === "add_equation") {
    // Restrict to instances satisfying the new relation; on that domain the
    // quotient's two adjoints preserve the instance up to isomorphism.
    migration = {
      kind: "check",
      source,
      target,
      equations: [
        { left: command.equation.left, right: command.equation.right },
      ],
    };
  } else {
    // Values and SQL key bindings are supplied interpretations, not a claim
    // that an arbitrary constraint or constant is a bare Kan extension.
    migration = { kind: "interpret", source, target, parameters: [command.op] };
  }
  const [input, output] = migrationEndpoints(migration);
  if (!samePresentation(input, source) || !samePresentation(output, target))
    throw new Error("The macro's migration has different endpoints.");
  return { source, target, edits, migration };
}

// Normal form consumed by the SQL templates. It is obtained from functor
// images, independently of the UI command that constructed those functors.
export type RowProjection = { object: string; attributes: Path[] };
export function projectionSources(
  change: AbstractChange,
  output: TableSpec,
): { kind: "delta" | "sigma" | "pi"; sources: RowProjection[] } | null {
  const expression = change.migration;
  if (
    expression.kind === "delta" &&
    !change.source.objects.some((o) => o.id === output.id)
  ) {
    const mapping = expression.mapping;
    return {
      kind: "delta",
      sources: [
        {
          object: mapping.objects[output.id],
          attributes: output.columns.map(
            (c) => mapping.arrows[attributeId(c.id)],
          ),
        },
      ],
    };
  }
  if (expression.kind !== "compose" || expression.steps.length !== 2)
    return null;
  const [pull, push] = expression.steps;
  if (pull.kind !== "delta" || (push.kind !== "sigma" && push.kind !== "pi"))
    return null;
  const sources = push.mapping.source.objects
    .filter(
      (o) => o.kind === "entity" && push.mapping.objects[o.id] === output.id,
    )
    .map((object) => {
      const attributes = output.columns.map((column) => {
        const arrow = push.mapping.source.arrows.find(
          (a) =>
            a.source === object.id &&
            push.mapping.arrows[a.id]?.arrows.length === 1 &&
            push.mapping.arrows[a.id].arrows[0] === attributeId(column.id),
        );
        if (!arrow)
          throw new Error(
            "This mapping has no aligned SQL attribute template.",
          );
        return pull.mapping.arrows[arrow.id];
      });
      return { object: pull.mapping.objects[object.id], attributes };
    });
  return { kind: push.kind, sources };
}
