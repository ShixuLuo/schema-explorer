import type { Operation, SchemaSpec } from "../model/operations.ts";
import type { Path } from "../model/presentation.ts";
import {
  attributeId,
  databasePresentation,
  referenceId,
} from "../model/database-presentation.ts";
import {
  fieldArrowOperations,
  type ReferenceKeyChoice,
} from "./foreign-key-plan.ts";
import { replaceArrowOperations } from "./replace-arrow.ts";
export type HumanCommand = (
  | {
      kind: "edit_arrow";
      arrowId: string;
      sourceId: string;
      targetId: string;
      name: string;
      choice?: ReferenceKeyChoice;
    }
  | {
      kind: "create_arrow";
      sourceId: string;
      targetId: string;
      name: string;
      choice?: ReferenceKeyChoice;
    }
  | { kind: "create_object"; name: string; keyName: string }
  | { kind: "rename_object"; objectId: string; name: string }
  | { kind: "delete_object"; objectId: string }
  | {
      kind: "rename_primary_key";
      objectId: string;
      columnId: string;
      name: string;
    }
  | { kind: "rename_arrow"; arrowId: string; name: string }
  | { kind: "delete_arrow"; arrowId: string }
  | { kind: "add_equation"; left: Path; right: Path }
  | { kind: "edit_equation"; equationId: string; left: Path; right: Path }
  | { kind: "drop_equation"; equationId: string }
) & { arrowId?: string };
export function createObjectOperations(
  name: string,
  keyName: string,
  uuid: () => string = () => crypto.randomUUID(),
): Operation[] {
  const keyId = uuid();
  return [
    {
      op: "create_table",
      table: {
        id: uuid(),
        name: name.trim(),
        columns: [
          {
            id: keyId,
            name: keyName.trim() || "_id",
            dataType: "integer",
            nullable: false,
            generated: "identity",
          },
        ],
        primaryKey: [keyId],
      },
    },
  ];
}
export const renameObjectOperations = (
  objectId: string,
  name: string,
): Operation[] => [{ op: "rename_table", table_id: objectId, new_name: name }];
export const deleteObjectOperations = (objectId: string): Operation[] => [
  { op: "drop_table", table_id: objectId },
];
export const renamePrimaryKeyOperations = (
  objectId: string,
  columnId: string,
  name: string,
): Operation[] => [
  {
    op: "rename_column",
    table_id: objectId,
    column_id: columnId,
    new_name: name,
  },
];
export function renameArrowOperations(
  schema: SchemaSpec,
  arrowId: string,
  name: string,
): Operation[] {
  const reference = schema.foreign_keys.find(
    (f) => referenceId(f.id) === arrowId,
  );
  if (reference) {
    const ids = reference.source_columns;
    return [
      ...(ids.length === 1
        ? [
            {
              op: "rename_column" as const,
              table_id: reference.source_table,
              column_id: ids[0],
              new_name: name,
            },
          ]
        : []),
      {
        op: "rename_arrow",
        table_id: reference.source_table,
        arrow_id: reference.id,
        new_name: name,
      },
    ];
  }
  const owner = schema.tables.find((t) =>
      t.columns.some((c) => attributeId(c.id) === arrowId),
    ),
    field = owner?.columns.find((c) => attributeId(c.id) === arrowId);
  if (!owner || !field) throw Error("This arrow no longer exists.");
  return [
    {
      op: "rename_column",
      table_id: owner.id,
      column_id: field.id,
      new_name: name,
    },
    ...schema.foreign_keys
      .filter(
        (r) =>
          r.source_table === owner.id &&
          r.source_columns.length === 1 &&
          r.source_columns[0] === field.id,
      )
      .map((r) => ({
        op: "rename_arrow" as const,
        table_id: owner.id,
        arrow_id: r.id,
        new_name: name,
      })),
  ];
}
export function deleteArrowOperations(
  schema: SchemaSpec,
  arrowId: string,
): Operation[] {
  const reference = schema.foreign_keys.find(
    (f) => referenceId(f.id) === arrowId,
  );
  if (reference)
    return [
      {
        op: "drop_foreign_key",
        table_id: reference.source_table,
        foreign_key_id: reference.id,
      },
    ];
  const owner = schema.tables.find((t) =>
      t.columns.some((c) => attributeId(c.id) === arrowId),
    ),
    field = owner?.columns.find((c) => attributeId(c.id) === arrowId);
  if (!owner || !field) throw Error("This arrow no longer exists.");
  return [{ op: "drop_column", table_id: owner.id, column_id: field.id }];
}
export function dropEquationOperations(
  schema: SchemaSpec,
  equationId: string,
): Operation[] {
  const equation = schema.equations?.find((e) => e.id === equationId);
  if (!equation) throw Error("This relation no longer exists.");
  return [
    {
      op: "drop_equation",
      table_id: equation.left.source,
      equation_id: equation.id,
    },
  ];
}
export function equationOperations(
  schema: SchemaSpec,
  left: Path,
  right: Path,
  equationId?: string,
  uuid: () => string = () => crypto.randomUUID(),
): Operation[] {
  return [
    ...(equationId ? dropEquationOperations(schema, equationId) : []),
    {
      op: "add_equation",
      method: null,
      table_id: left.source,
      equation: {
        id: equationId ?? uuid(),
        left: structuredClone(left),
        right: structuredClone(right),
      },
    },
  ];
}
export function humanCommandOperations(
  schema: SchemaSpec,
  command: HumanCommand,
  uuid: () => string = () => crypto.randomUUID(),
): Operation[] {
  switch (command.kind) {
    case "create_object":
      return createObjectOperations(command.name, command.keyName, uuid);
    case "rename_object":
      return renameObjectOperations(command.objectId, command.name);
    case "delete_object":
      return deleteObjectOperations(command.objectId);
    case "rename_primary_key":
      return renamePrimaryKeyOperations(
        command.objectId,
        command.columnId,
        command.name,
      );
    case "create_arrow":
      return fieldArrowOperations(
        schema,
        command.sourceId,
        command.targetId,
        command.name,
        command.choice,
        uuid,
      );
    case "edit_arrow":
      return replaceArrowOperations(
        schema,
        command.arrowId,
        command.sourceId,
        command.targetId,
        command.name,
        command.choice,
        uuid,
      ).operations;
    case "rename_arrow":
      return renameArrowOperations(schema, command.arrowId, command.name);
    case "delete_arrow":
      return deleteArrowOperations(schema, command.arrowId);
    case "add_equation":
      return equationOperations(
        schema,
        command.left,
        command.right,
        undefined,
        uuid,
      );
    case "edit_equation":
      return equationOperations(
        schema,
        command.left,
        command.right,
        command.equationId,
        uuid,
      );
    case "drop_equation":
      return dropEquationOperations(schema, command.equationId);
  }
}
export function visibleHumanArrow(schema: SchemaSpec, arrowId: string) {
  return databasePresentation(schema).arrows.some((a) => a.id === arrowId);
}

// UI labels describe dispatched intent, never model-provided prose.
export function humanCommandLabel(
  schema: SchemaSpec,
  command: HumanCommand,
): string {
  const objectName = (id: string) =>
    schema.tables.find((t) => t.id === id)?.name ?? "object";
  const arrow = command.arrowId
    ? databasePresentation(schema).arrows.find((a) => a.id === command.arrowId)
    : undefined;
  switch (command.kind) {
    case "create_object":
      return `Create ${command.name}`;
    case "rename_object":
      return `Rename ${objectName(command.objectId)} → ${command.name}`;
    case "delete_object":
      return `Delete ${objectName(command.objectId)}`;
    case "rename_primary_key":
      return `Rename ${schema.tables.find((t) => t.id === command.objectId)?.columns.find((c) => c.id === command.columnId)?.name ?? "key"} → ${command.name}`;
    case "create_arrow":
      return `Add ${command.name}`;
    case "edit_arrow":
      return arrow &&
        arrow.source === command.sourceId &&
        arrow.target === command.targetId
        ? `Rename ${arrow.label} → ${command.name}`
        : command.targetId.startsWith("type:")
          ? `Change ${arrow?.label ?? "arrow"} → ${databasePresentation(schema).objects.find((object) => object.id === command.targetId)?.label ?? command.targetId.slice(5)}`
          : `Link ${objectName(command.sourceId)} → ${objectName(command.targetId)}`;
    case "rename_arrow":
      return `Rename ${arrow?.label ?? "arrow"} → ${command.name}`;
    case "delete_arrow":
      return `Delete ${arrow?.label ?? "arrow"}`;
    case "add_equation":
      return `Add relation on ${objectName(command.left.source)}`;
    case "edit_equation":
      return "Edit relation";
    case "drop_equation":
      return "Delete relation";
  }
}
export function humanCommandGroupLabel(
  schema: SchemaSpec,
  commands: HumanCommand[],
): string {
  if (!commands.length) return "Review change";
  const labels = commands.map((c) => humanCommandLabel(schema, c));
  if (labels.length < 3) return labels.join(" · ");
  const verbs = [...new Set(labels.map((label) => label.split(" ")[0]))];
  return `${commands.length} changes · ${verbs.join(" / ")}`;
}

export function humanSourceChoices<
  C extends {
    id: string;
    generated?: string;
    storage?: string;
    dataType?: string;
  },
>(
  source: { columns: C[] } | undefined,
  type: string,
  retainedIds: string[] = [],
): C[] {
  return (
    source?.columns.filter(
      (c) =>
        ((!c.generated && !c.storage) || retainedIds.includes(c.id)) &&
        (c.dataType ?? "text") === type,
    ) ?? []
  );
}
export function humanTargetKeyChoices(
  target: {
    primaryKey?: string[];
    uniqueKeys?: string[][];
    columns: { id: string }[];
  },
  retainedKey?: string[],
): string[][] {
  const choices = target.primaryKey?.length
    ? [
        target.primaryKey,
        ...(target.uniqueKeys ?? []),
        ...(retainedKey ? [retainedKey] : []),
      ]
    : [[], ...(target.uniqueKeys ?? []), ...target.columns.map((c) => [c.id])];
  return [
    ...new Map(choices.map((key) => [JSON.stringify(key), key])).values(),
  ];
}
