import type { SchemaSpec } from "../model/operations.ts";
import { databasePresentation } from "../model/database-presentation.ts";
import { translateCommand } from "../model/database-commands.ts";
import {
  humanCommandOperations,
  BUSINESS_KEY_TYPES,
  visibleHumanArrow,
  type HumanCommand,
} from "../application/human-commands.ts";
export const AI_CAPABILITY_VERSION = "human-modeling/v4";
export type AiEditorAction = HumanCommand;
const str = { type: "string" }, strings = { type: "array", items: str };
const path = {
  type: "object",
  properties: { source: str, arrows: strings },
  required: ["source", "arrows"],
  additionalProperties: false,
};
const variant = (kind: string, args: Record<string, unknown>) => ({
  type: "object",
  properties: { kind: { type: "string", enum: [kind] }, ...args },
  required: ["kind", ...Object.keys(args)],
  additionalProperties: false,
});
export const AI_ACTION_JSON_SCHEMA = {
  anyOf: [
    variant("edit_arrow", {
      arrowId: str,
      sourceId: str,
      targetId: str,
      name: str,
    }),
    variant("create_arrow", {
      sourceId: str,
      targetId: str,
      name: str,
    }),
    variant("create_object", {
      name: str,
      keyName: str,
      key: {
        anyOf: [
          { type: "object", properties: { mode: { type: "string", enum: ["generated"] } }, required: ["mode"], additionalProperties: false },
          { type: "object", properties: { mode: { type: "string", enum: ["business"] }, dataType: { type: "string", enum: BUSINESS_KEY_TYPES } }, required: ["mode", "dataType"], additionalProperties: false },
        ],
      },
    }),
    variant("rename_object", { objectId: str, name: str }),
    variant("delete_object", { objectId: str }),
    variant("rename_primary_key", { objectId: str, columnId: str, name: str }),
    variant("rename_arrow", { arrowId: str, name: str }),
    variant("delete_arrow", { arrowId: str }),
    variant("add_equation", { left: path, right: path }),
    variant("edit_equation", { equationId: str, left: path, right: path }),
    variant("drop_equation", { equationId: str }),
  ],
};
export const AI_CAPABILITY_CATALOGUE = [
  {
    kind: "edit_arrow",
    humanControl: "Edit existing arrow name/source/target",
    implementation:
      "humanCommandOperations → replaceArrowOperations → App.append → EditSession",
    meaning:
      "Provide only arrowId, sourceId, targetId and name. Entity targets use their primary key automatically. A compatible same-source scalar becomes the reference carrier without losing its stable ID or values; existing references to the same target retain their binding. Storage/key choices are internal, never model arguments. Matching records belongs to the migration parameters step; do not promise that schema editing itself migrates data.",
  },
  {
    kind: "create_arrow",
    humanControl: "Add arrow on canvas",
    implementation: "humanCommandOperations → fieldArrowOperations",
    meaning:
      "Provide existing sourceId, targetId and name only. Entity targets use their primary key automatically, or a native internal identity if absent. New reference carriers are allocated by the shared human command. No choice, sourceColumns or targetColumns arguments. Matching records is handled later by migration parameters.",
  },
  {
    kind: "create_object",
    humanControl: "Add object",
    implementation: "createObjectOperations (also used by ObjectCreator)",
    meaning:
      "Provide name, keyName, and key. Use key={mode:'generated'} for an automatically generated integer key, or key={mode:'business',dataType:'text'|'integer'} for a named single-column business key whose non-null unique values must be supplied by the data during migration. Default to generated when no business identity is established. Preserve identifier spelling and leading zeros when choosing a type. Client allocates schema IDs through the same builder as the human form. Any later action using this new object must wait until the next round after acceptance.",
  },
  {
    kind: "rename_object",
    humanControl: "Rename entity",
    implementation: "renameObjectOperations",
  },
  {
    kind: "delete_object",
    humanControl: "Delete entity",
    implementation: "deleteObjectOperations",
    meaning:
      "Existing entity ID only; native preview, data checks and migration choice remain required.",
  },
  {
    kind: "rename_primary_key",
    humanControl: "Rename primary-key label",
    implementation: "renamePrimaryKeyOperations",
    meaning:
      "Only a declared primary-key column ID. This renames its label and cannot change type, storage role or key membership.",
  },
  {
    kind: "rename_arrow",
    humanControl: "Rename arrow label",
    implementation: "renameArrowOperations",
    meaning:
      "Same human coupling between a reference name and its single carrier label.",
  },
  {
    kind: "delete_arrow",
    humanControl: "Delete visible arrow",
    implementation: "deleteArrowOperations",
    meaning:
      "Hidden identity/reference storage attributes are not independently editable business arrows.",
  },
  {
    kind: "add_equation",
    humanControl: "Add relation between paths",
    implementation: "equationOperations",
    meaning:
      "Use only existing visible presentation paths with the same source and endpoint. Client allocates the equation ID. New arrows cannot be referenced in this round.",
  },
  {
    kind: "edit_equation",
    humanControl: "Edit existing relation paths",
    implementation: "equationOperations",
    meaning: "Existing equation ID; native drop+add preserves that ID.",
  },
  {
    kind: "drop_equation",
    humanControl: "Delete relation",
    implementation: "dropEquationOperations",
    meaning: "Existing explicit user-equation ID only.",
  },
];
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Unsupported action arguments.");
  return value as Record<string, unknown>;
}
function shape(value: unknown, keys: string[]) {
  const o = record(value);
  if (
    Object.keys(o).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(o, k))
  )
    throw Error("Unsupported action arguments.");
  return o;
}
function text(value: unknown, empty = false) {
  if (
    typeof value !== "string" ||
    (!empty && !value.trim()) ||
    value.length > 512
  )
    throw Error("Invalid action text.");
}
function list(value: unknown) {
  if (!Array.isArray(value) || value.length > 100)
    throw Error("Invalid action choices.");
  for (const v of value) text(v);
}
export function validateAiAction(
  value: unknown,
  schema: SchemaSpec,
): AiEditorAction {
  const o = record(value),
    kind = o.kind;
  const args: Record<string, string[]> = {
    edit_arrow: ["arrowId", "sourceId", "targetId", "name"],
    create_arrow: ["sourceId", "targetId", "name"],
    create_object: ["name", "keyName", "key"],
    rename_object: ["objectId", "name"],
    delete_object: ["objectId"],
    rename_primary_key: ["objectId", "columnId", "name"],
    rename_arrow: ["arrowId", "name"],
    delete_arrow: ["arrowId"],
    add_equation: ["left", "right"],
    edit_equation: ["equationId", "left", "right"],
    drop_equation: ["equationId"],
  };
  if (typeof kind !== "string" || !Object.hasOwn(args, kind))
    throw Error("Unsupported human editor action.");
  shape(o, ["kind", ...args[kind]]);
  for (const k of args[kind])
    if (!["choice", "left", "right", "key"].includes(k)) text(o[k], k === "keyName");
  if (kind === "create_object") {
    const key = record(o.key);
    if (key.mode === "generated") shape(key, ["mode"]);
    else if (key.mode === "business") {
      shape(key, ["mode", "dataType"]);
      if (!BUSINESS_KEY_TYPES.some(type=>type===key.dataType))
        throw Error("Choose a supported business key type.");
      text(o.keyName);
    } else throw Error("Choose generated or business key values.");
  }
  for (const k of ["left", "right"])
    if (o[k]) {
      const p = shape(o[k], ["source", "arrows"]);
      text(p.source);
      list(p.arrows);
      if ((p.arrows as unknown[]).length > 24)
        throw Error("Select at most 24 arrows.");
    }
  const action = o as unknown as AiEditorAction,
    presentation = databasePresentation(schema);
  if (
    ["edit_arrow", "rename_arrow", "delete_arrow"].includes(kind) &&
    !visibleHumanArrow(schema, o.arrowId as string)
  )
    throw Error("This arrow is no longer available.");
  if (
    ["rename_object", "delete_object", "rename_primary_key"].includes(kind) &&
    !schema.tables.some((t) => t.id === o.objectId)
  )
    throw Error("Choose an existing object.");
  if (
    kind === "rename_primary_key" &&
    !schema.tables
      .find((t) => t.id === o.objectId)
      ?.primaryKey.includes(o.columnId as string)
  )
    throw Error("Choose a declared primary key.");
  if (
    ["edit_arrow", "create_arrow"].includes(kind) &&
    (!schema.tables.some((t) => t.id === o.sourceId) ||
      !presentation.objects.some((t) => t.id === o.targetId))
  )
    throw Error("Choose an existing source and target.");
  if (["add_equation", "edit_equation"].includes(kind))
    for (const key of ["left", "right"]) {
      const p = o[key] as { source: string; arrows: string[] };
      if (
        !schema.tables.some((t) => t.id === p.source) ||
        p.arrows.some((id) => !presentation.arrows.some((a) => a.id === id))
      )
        throw Error("Choose existing visible paths.");
    }
  const taken = new Set([
    ...schema.tables.flatMap((t) => [t.id, ...t.columns.map((c) => c.id)]),
    ...schema.foreign_keys.map((f) => f.id),
    ...(schema.equations ?? []).map((e) => e.id),
  ]);
  let n = 0;
  const uuid = () => {
    let id: string;
    do {
      id = `__ai_validation_${++n}`;
    } while (taken.has(id));
    taken.add(id);
    return id;
  };
  let candidate = schema;
  for (const op of humanCommandOperations(schema, action, uuid))
    candidate = translateCommand(candidate, op).after;
  return action;
}
export function humanActionOperations(
  action: AiEditorAction,
  schema: SchemaSpec,
  uuid?: () => string,
) {
  validateAiAction(action, schema);
  return humanCommandOperations(schema, action, uuid);
}

export function validateAiActionGroups<
  T extends { id: string; dependsOn: string[]; actions: AiEditorAction[] },
>(groups: T[], schema: SchemaSpec): T[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  if (byId.size !== groups.length) throw Error("Duplicate suggestion group.");
  const visiting = new Set<string>(),
    seen = new Set<string>(),
    ordered: T[] = [];
  const visit = (id: string) => {
    if (visiting.has(id)) throw Error("Cyclic suggestion dependency.");
    if (seen.has(id)) return;
    const group = byId.get(id);
    if (!group) throw Error("Unresolved suggestion dependency.");
    visiting.add(id);
    for (const dep of group.dependsOn) visit(dep);
    visiting.delete(id);
    seen.add(id);
    ordered.push(group);
  };
  for (const group of groups) visit(group.id);
  let candidate = schema,
    n = 0;
  const taken = new Set([
      ...schema.tables.flatMap((t) => [t.id, ...t.columns.map((c) => c.id)]),
      ...schema.foreign_keys.map((f) => f.id),
      ...(schema.equations ?? []).map((e) => e.id),
    ]),
    uuid = () => {
      let id: string;
      do {
        id = `__ai_sequence_${++n}`;
      } while (taken.has(id));
      taken.add(id);
      return id;
    };
  for (const group of ordered)
    for (const action of group.actions) {
      try {
        validateAiAction(action, schema);
        validateAiAction(action, candidate);
        for (const operation of humanCommandOperations(candidate, action, uuid))
          candidate = translateCommand(candidate, operation).after;
      } catch (error) {
        throw Error(`Suggestion ${group.id.slice(0,80)} (${action.kind}): ${error instanceof Error ? error.message : String(error)}`, {cause:error});
      }
    }
  return ordered;
}
