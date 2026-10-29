import { translateCommand } from "../model/database-commands.ts";
import {
  attributeId,
  databasePresentation,
  referenceId,
  typeId,
} from "../model/database-presentation.ts";
import type { Operation, SchemaSpec } from "../model/operations.ts";
import type { Equation, Path } from "../model/presentation.ts";
import { endpoint } from "../model/presentation.ts";
import {
  fieldArrowOperations,
  defaultArrowChoice,
  type ReferenceKeyChoice,
} from "./foreign-key-plan.ts";
export function replaceArrowOperations(
  original: SchemaSpec,
  arrowId: string,
  sourceId: string,
  targetId: string,
  name: string,
  choice?: ReferenceKeyChoice,
  uuid: () => string = () => crypto.randomUUID(),
) {
  choice ??= defaultArrowChoice(original,sourceId,targetId,arrowId);
  const equations = original.equations ?? [],
    old = databasePresentation(original).arrows.find((a) => a.id === arrowId);
  if (!old) throw new Error("This arrow no longer exists.");
  const ref = original.foreign_keys.find((f) => referenceId(f.id) === arrowId),
    owner = original.tables.find((t) => t.id === old.source)!,
    column = owner.columns.find((c) => attributeId(c.id) === arrowId);
  let schema = original,
    replacementId = arrowId;
  const operations: Operation[] = [];
  const apply = (op: Operation) => {
    schema = translateCommand(schema, op).after;
    operations.push(op);
  };
  const sameSource = sourceId === old.source,
    isType = targetId.startsWith("type:"),
    retainColumn=!!column&&sameSource&&!isType&&(choice.sourceColumns??[]).includes(column.id);
  if (ref) {
    if (
      sameSource &&
      targetId === old.target &&
      JSON.stringify(choice.targetColumns ?? []) ===
        JSON.stringify(ref.target_columns) &&
      JSON.stringify(choice.sourceColumns ?? ref.source_columns) ===
        JSON.stringify(ref.source_columns)
    ) {
      return {
        operations:
          name !== old.label
            ? [
                {
                  op: "rename_arrow",
                  table_id: sourceId,
                  arrow_id: ref.id,
                  new_name: name,
                  method: null,
                } as Operation,
              ]
            : [],
        removedRelations: [],
      };
    }
    apply({
      op: "drop_foreign_key",
      table_id: ref.source_table,
      foreign_key_id: ref.id,
    });
  } else if (column) {
    if (sameSource && isType && typeId(column.dataType) === targetId) {
      if (name !== column.name)
        apply({
          op: "rename_column",
          table_id: sourceId,
          column_id: column.id,
          new_name: name,
        });
    } else if(!retainColumn)
      apply({ op: "drop_column", table_id: owner.id, column_id: column.id });
  }
  const source = schema.tables.find((t) => t.id === sourceId);
  if (!source) throw new Error("Choose a source entity.");
  if (isType) {
    const existing = source.columns.find((c) => c.name === name),
      type = targetId.slice(5) as import("../model/schema.ts").DataType;
    if (existing) {
      if ((existing.dataType ?? "text") !== type)
        throw new Error(
          "That source field has a different type. Choose a new name or the matching type.",
        );
      replacementId = attributeId(existing.id);
    } else {
      const created = fieldArrowOperations(
        schema,
        sourceId,
        targetId,
        name,
        choice,
        uuid,
      );
      created.forEach(apply);
      const added = created.find(
        (op) => op.op === "add_column" || op.op === "add_attribute",
      );
      if (added?.op === "add_column" || added?.op === "add_attribute")
        replacementId = attributeId(added.column.id);
    }
  } else {
    const created = fieldArrowOperations(
        schema,
        sourceId,
        targetId,
        name,
        choice,
        uuid,
      ),
      next = created.find(
        (op) => op.op === "add_foreign_key" || op.op === "add_reference",
      );
    if (next?.op === "add_foreign_key" || next?.op === "add_reference") {
      if (ref && sameSource && targetId === old.target)
        next.foreign_key.id = ref.id;
      replacementId = referenceId(next.foreign_key.id);
    }
    if(retainColumn&&column)for(const operation of created)if(operation.op==='add_foreign_key')operation.storage_columns=[...new Set([...(operation.storage_columns??[]),column.id])];
    created.forEach(apply);
  }
  const after = databasePresentation(schema),
    removedRelations: Equation[] = [];
  const oldRemoved = !after.arrows.some((a) => a.id === arrowId);
  const rewrite = (path: Path): Path => ({
    source: oldRemoved && path.arrows[0] === arrowId ? sourceId : path.source,
    arrows: path.arrows.map((id) =>
      oldRemoved && id === arrowId ? replacementId : id,
    ),
  });
  for (const e of equations) {
    if (schema.equations?.some((n) => n.id === e.id)) continue;
    const updated = { ...e, left: rewrite(e.left), right: rewrite(e.right) };
    try {
      if (
        updated.left.source !== updated.right.source ||
        endpoint(after, updated.left) !== endpoint(after, updated.right)
      )
        throw new Error("Not parallel");
      apply({
        op: "add_equation",
        table_id: updated.left.source,
        equation: updated,
      });
    } catch {
      removedRelations.push(e);
    }
  }
  return { operations, removedRelations };
}
