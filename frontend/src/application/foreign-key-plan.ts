import { isDataType } from "../model/scalar.ts";
import { translateCommand } from "../model/database-commands.ts";
import { assertMigrationChoice } from "../model/migration-options.ts";
import type { Operation, SchemaSpec } from "../model/operations.ts";
export type ReferenceKeyChoice = {
  targetColumns?: string[];
  declareUnique?: boolean;
  sourceColumns?: string[];
  method?: "sigma" | "pi";
};
export function defaultArrowChoice(schema:SchemaSpec,sourceId:string,targetId:string,arrowId?:string):ReferenceKeyChoice {
  const target=schema.tables.find(t=>t.id===targetId);
  if(!target)return {};
  const reference=arrowId?.startsWith('reference:')?schema.foreign_keys.find(f=>'reference:'+f.id===arrowId):undefined;
  if(reference&&reference.source_table===sourceId&&reference.target_table===targetId)return {targetColumns:[...reference.target_columns],sourceColumns:[...reference.source_columns]};
  const source=schema.tables.find(t=>t.id===sourceId),column=source?.columns.find(c=>'attribute:'+c.id===arrowId);
  const keys=target.primaryKey??[],key=keys.length===1?target.columns.find(c=>c.id===keys[0]):undefined;
  const retain=column&&key&&!column.generated&&!column.storage&&(column.dataType??'text')===(key.dataType??'text');
  return {targetColumns:[...keys],sourceColumns:retain?[column.id]:[]};
}
export function fieldArrowOperations(
  schema: SchemaSpec,
  sourceId: string,
  targetId: string,
  name: string,
  choice?: ReferenceKeyChoice,
  uuid: () => string = () => crypto.randomUUID(),
): Operation[] {
  choice ??= defaultArrowChoice(schema,sourceId,targetId);
  name = name.trim();
  if (!name) throw new Error("Name the source field.");
  const source = schema.tables.find((t) => t.id === sourceId),
    target = schema.tables.find((t) => t.id === targetId);
  if (!source) throw new Error("Choose a source entity.");
  if (targetId.startsWith("type:") && isDataType(targetId.slice(5)))
    return [
      {
        op: "add_attribute",
        table_id: sourceId,
        column: {
          id: uuid(),
          name,
          dataType: targetId.slice(5) as import("../model/schema.ts").DataType,
          nullable: true,
        },
        parameters: { template: "extension" },
      },
    ];
  if (!source || !target) throw new Error("Choose source and target entities.");
  const declared = [
      ...(target.primaryKey?.length ? [target.primaryKey] : []),
      ...(target.uniqueKeys ?? []),
    ],
    operations: Operation[] = [];
  if (!choice.targetColumns)
    throw new Error("Choose the target key or internal identity explicitly.");
  let keys = choice.targetColumns,
    keyFields = keys.map((id) => target.columns.find((c) => c.id === id));
  if (keys.length) {
    if (new Set(keys).size !== keys.length || keyFields.some((c) => !c))
      throw new Error("Choose valid target key fields.");
    if (!declared.some((k) => JSON.stringify(k) === JSON.stringify(keys))) {
      if (!choice.declareUnique)
        throw new Error("The target field must be declared as a unique key.");
      operations.push({
        op: "add_unique_key",
        table_id: target.id,
        column_ids: keys,
      });
    }
  } else {
    const taken = new Set([
      ...target.columns.map((c) => c.name),
      ...(sourceId === targetId ? [name] : []),
    ]);
    let columnName = "_row_id",
      i = 2;
    while (taken.has(columnName)) columnName = `_row_id_${i++}`;
    const id = uuid();
    operations.push({
      op: "ensure_identity",
      table_id: target.id,
      column_id: id,
      column_name: columnName,
    });
    keys = [id];
    keyFields = [
      {
        id,
        name: columnName,
        dataType: "integer",
        generated: "identity",
        nullable: false,
      },
    ];
  }
  const sourceNames =
    keys.length > 1 ? keyFields.map((c) => `${name}_${c!.name}`) : [name];
  const used = new Set<string>(),
    newFields: string[] = [];
  const sourceColumns = keyFields.map((key, i) => {
    const chosen = choice.sourceColumns?.[i];
    const existing =
      chosen && chosen !== "__new__"
        ? source.columns.find((c) => c.id === chosen)
        : undefined;
    if (chosen && chosen !== "__new__" && !existing)
      throw new Error("A chosen source field no longer exists.");
    if (existing) {
      if ((existing.dataType ?? "text") !== (key!.dataType ?? "text"))
        throw new Error(
          `${source.name}.${existing.name} and ${target.name}.${key!.name} must have the same type.`,
        );
      if (used.has(existing.id))
        throw new Error("Use each source key component only once.");
      used.add(existing.id);
      return existing.id;
    }
    const id = uuid();
    newFields.push(id);
    used.add(id);
    operations.push({
      op: "add_column",
      table_id: source.id,
      column: {
        id,
        name: sourceNames[i],
        dataType: key!.dataType ?? "text",
        nullable: true,
        storage: "reference",
      },
      value: { type: "null" },
    });
    return id;
  });
  {
    const carriers = operations.filter(
      (op): op is Extract<Operation, { op: "add_column" }> =>
        op.op === "add_column" && newFields.includes(op.column.id),
    );
    const prerequisites = operations.filter(
      (op) => !carriers.includes(op as (typeof carriers)[number]),
    );
    let before = schema;
    for (const op of prerequisites) before = translateCommand(before, op).after;
    const fk = {
      id: uuid(),
      name,
      source_table: source.id,
      source_columns: sourceColumns,
      target_table: target.id,
      target_columns: keys,
    };
    const operation: Extract<
      Operation,
      { op: "add_foreign_key" | "add_reference" }
    > = carriers.length
      ? {
          op: "add_reference",
          table_id: source.id,
          columns: carriers.map((op) => ({ ...op.column, nullable: false })),
          foreign_key: fk,
          method: choice.method ?? null,
        }
      : { op: "add_foreign_key", table_id: source.id, foreign_key: fk };
    if (carriers.length && carriers.length !== sourceColumns.length)
      throw new Error(
        "Choose either existing source fields or new fields for every key component.",
      );
    if (choice.method) assertMigrationChoice(before, operation, choice.method);
    operation.method = choice.method ?? null;
    return [...prerequisites, operation];
  }
}
