import { isDataType } from "./scalar.ts";
import {
  attributeId,
  databasePresentation,
  editsFor,
  referenceId,
  storageColumn,
  storagePresentation,
  translateDatabaseCommand,
  type AbstractChange,
} from "./database-presentation.ts";
import { assertMigrationChoice } from "./migration-options.ts";
import type {
  Operation,
  SchemaSpec,
  TableSpec,
  TypedCell,
} from "./operations.ts";

export const objectBinding = (schema: SchemaSpec, id: string) => {
  const table = schema.tables.find((t) => t.id === id);
  if (!table) throw new Error("The selected object no longer exists.");
  return table;
};
export const attributeBinding = (table: TableSpec, id: string) => {
  const column = table.columns.find((c) => c.id === id);
  if (!column)
    throw new Error(`A selected field in ${table.name} no longer exists.`);
  return column;
};
export const identityColumns = (table: TableSpec) =>
  table.primaryKey.length ? table.primaryKey : (table.uniqueKeys?.[0] ?? []);
export const declaredKeys = (table: TableSpec) => [
  ...(table.primaryKey.length ? [table.primaryKey] : []),
  ...(table.uniqueKeys ?? []),
];
export function validateBindings(schema: SchemaSpec) {
  const objectIds = new Set<string>(),
    names = new Set<string>(),
    attributeIds = new Set<string>(),
    arrowIds = new Set<string>();
  for (const object of schema.tables) {
    if (
      !object.id ||
      objectIds.has(object.id) ||
      !object.name.trim() ||
      names.has(object.name)
    )
      throw new Error("Object names and IDs must be unique.");
    objectIds.add(object.id);
    names.add(object.name);
    const fields = new Set<string>();
    for (const attribute of object.columns) {
      if (
        !attribute.id ||
        attributeIds.has(attribute.id) ||
        !attribute.name.trim() ||
        fields.has(attribute.name)
      )
        throw new Error("Field names and IDs must be unique.");
      if (!isDataType(attribute.dataType))
        throw new Error("Unknown scalar field type.");
      if (
        attribute.generated &&
        (attribute.generated !== "identity" ||
          attribute.dataType !== "integer" ||
          attribute.nullable)
      )
        throw new Error(
          "Internal identities must be non-null integer columns.",
        );
      attributeIds.add(attribute.id);
      fields.add(attribute.name);
    }
    if (new Set(object.primaryKey).size !== object.primaryKey.length)
      throw new Error("An identity field cannot appear twice.");
    for (const key of object.uniqueKeys ?? []) {
      if (!key.length || new Set(key).size !== key.length)
        throw new Error("A unique key needs distinct fields.");
      for (const id of key)
        if (attributeBinding(object, id).nullable)
          throw new Error("Referenced unique keys must be non-nullable.");
    }
    for (const id of object.primaryKey)
      if (
        attributeBinding(object, id).nullable ||
        !["text", "integer"].includes(attributeBinding(object, id).dataType)
      )
        throw new Error("Identity fields must be non-null Text or Integer.");
  }
  for (const arrow of schema.foreign_keys) {
    if (!arrow.id || arrowIds.has(arrow.id))
      throw new Error("Arrow IDs must be unique.");
    arrowIds.add(arrow.id);
    const source = objectBinding(schema, arrow.source_table),
      target = objectBinding(schema, arrow.target_table);
    if (
      !arrow.source_columns.length ||
      arrow.source_columns.length !== arrow.target_columns.length ||
      new Set(arrow.source_columns).size !== arrow.source_columns.length ||
      !declaredKeys(target).some(
        (key) => JSON.stringify(key) === JSON.stringify(arrow.target_columns),
      )
    )
      throw new Error(
        "An arrow must reference a complete declared primary or unique key, in order.",
      );
    arrow.source_columns.forEach((id, i) => {
      if (
        attributeBinding(source, id).dataType !==
        attributeBinding(target, arrow.target_columns[i]).dataType
      )
        throw new Error("Arrow field types must match.");
    });
  }
  databasePresentation(schema);
}
export type DatabaseChange = {
  before: SchemaSpec;
  after: SchemaSpec;
  abstract: AbstractChange;
  storageEdits: import("./presentation.ts").ElementaryEdit[];
  values: Record<string, TypedCell>;
  tableId: string;
  description: string;
  population?: Extract<Operation, { op: "populate_reference" }>;
};
export function translateCommand(
  before: SchemaSpec,
  operation: Operation,
): DatabaseChange {
  if (
    (operation.op === "add_foreign_key" ||
      operation.op === "add_reference" ||
      operation.op === "add_equation") &&
    operation.method
  )
    assertMigrationChoice(before, operation, operation.method);
  const schema = structuredClone(before),
    values: Record<string, TypedCell> = {};
  let tableId = "",
    description = "";
  let population: DatabaseChange["population"];
  const op = operation;
  const forget = (arrows: string[], object?: string) => {
    schema.equations = (schema.equations ?? []).filter(
      (e) =>
        e.left.source !== object &&
        ![...e.left.arrows, ...e.right.arrows].some((id) =>
          arrows.includes(id),
        ),
    );
  };
  if (
    op.op === "create_table" ||
    op.op === "copy_table" ||
    op.op === "combine_tables"
  ) {
    const target = structuredClone(op.table);
    tableId = target.id;
    if (op.op !== "create_table" && target.primaryKey.length)
      throw new Error("Set the identity as a separate change.");
    if (op.op === "create_table") {
      if (
        op.method === "pi" &&
        target.columns.some((c) => c.generated !== "identity")
      )
        throw new Error(
          "Π for a new isolated object requires no attributes; add attributes with explicit values afterward.",
        );
      description = `Add object ${target.name}`;
    } else {
      const inputs =
        op.op === "copy_table"
          ? [{ table_id: op.table_id, column_ids: op.column_ids }]
          : op.inputs;
      if (
        !target.columns.length ||
        inputs.length < (op.op === "copy_table" ? 1 : 2)
      )
        throw new Error("Choose sources and map at least one field.");
      for (const input of inputs) {
        const source = objectBinding(schema, input.table_id);
        if (input.column_ids.length !== target.columns.length)
          throw new Error("Every output field needs a source mapping.");
        input.column_ids.forEach((id, i) => {
          const a = attributeBinding(source, id),
            b = target.columns[i];
          if (a.dataType !== b.dataType)
            throw new Error("Mapped fields must have the same type.");
          if (a.nullable && !b.nullable)
            throw new Error("Nullable sources need nullable outputs.");
        });
      }
      description = `${op.op === "copy_table" ? "Copy into" : "Combine into"} ${target.name} · ${op.op === "copy_table" ? "Δ" : op.method === "sigma" ? "Σ" : "Π"}`;
    }
    schema.tables.push(target);
  } else {
    const object = objectBinding(schema, op.table_id);
    tableId = object.id;
    switch (op.op) {
      case "ensure_identity":
        if (object.primaryKey.length)
          throw new Error(
            "This entity already has an explicit identity binding.",
          );
        object.columns.push({
          id: op.column_id,
          name: op.column_name,
          dataType: "integer",
          nullable: false,
          generated: "identity",
        });
        object.primaryKey = [op.column_id];
        description = `Create internal identity for ${object.name}`;
        break;
      case "populate_reference": {
        const target = objectBinding(schema, op.target_table);
        if (
          !op.source_columns.length ||
          op.source_columns.length !== op.target_columns.length ||
          !declaredKeys(target).some(
            (key) => JSON.stringify(key) === JSON.stringify(op.target_columns),
          )
        )
          throw new Error("Reference population must use the target identity.");
        if (op.match_source.length !== op.match_target.length)
          throw new Error("Match each source field to a target field.");
        for (const [i, id] of op.source_columns.entries())
          if (
            attributeBinding(object, id).dataType !==
            attributeBinding(target, op.target_columns[i]).dataType
          )
            throw new Error("Reference carrier types must match.");
        for (const [i, id] of op.match_source.entries())
          if (
            attributeBinding(object, id).dataType !==
            attributeBinding(target, op.match_target[i]).dataType
          )
            throw new Error("Reference lookup types must match.");
        population = structuredClone(op);
        description = `Bind ${object.name} records to ${target.name}`;
        break;
      }
      case "rename_table":
        description = `Rename ${object.name} → ${op.new_name}`;
        object.name = op.new_name;
        break;
      case "drop_table":
        forget(
          [
            ...object.columns.map((c) => attributeId(c.id)),
            ...schema.foreign_keys
              .filter(
                (a) =>
                  a.source_table === object.id || a.target_table === object.id,
              )
              .map((a) => referenceId(a.id)),
          ],
          object.id,
        );
        const incoming = schema.foreign_keys.filter(
          (a) => a.target_table === object.id && a.source_table !== object.id,
        );
        schema.foreign_keys = schema.foreign_keys.filter(
          (a) => a.source_table !== object.id && a.target_table !== object.id,
        );
        for (const ref of incoming) {
          const owner = objectBinding(schema, ref.source_table),
            removed = owner.columns.filter(
              (c) =>
                c.storage === "reference" &&
                ref.source_columns.includes(c.id) &&
                !schema.foreign_keys.some(
                  (a) =>
                    a.source_columns.includes(c.id) ||
                    a.target_columns.includes(c.id),
                ) &&
                !declaredKeys(owner).some((k) => k.includes(c.id)),
            );
          forget(removed.map((c) => attributeId(c.id)));
          owner.columns = owner.columns.filter((c) => !removed.includes(c));
        }
        description = `Drop object ${object.name}`;
        schema.tables = schema.tables.filter((t) => t.id !== object.id);
        break;
      case "rename_column": {
        const a = attributeBinding(object, op.column_id);
        description = `Rename ${object.name}.${a.name} → ${op.new_name}`;
        a.name = op.new_name;
        break;
      }
      case "add_attribute": {
        const p = op.parameters;
        if (p.template === "constant" && p.value) {
          if (
            (p.value.type === "null" && !op.column.nullable) ||
            (p.value.type !== "null" && p.value.type !== op.column.dataType)
          )
            throw new Error("The value must match the attribute type.");
        }
        if (p.template === "copy" && p.source_column) {
          const source = attributeBinding(object, p.source_column);
          if (source.dataType !== op.column.dataType)
            throw new Error("Choose a source attribute of the same type.");
          if (source.nullable && !op.column.nullable)
            throw new Error("A nullable source needs a nullable attribute.");
        }
        object.columns.push(structuredClone(op.column));
        description = `Add attribute ${object.name}.${op.column.name}`;
        break;
      }
      case "add_column":
        if (
          (op.value.type === "null" && !op.column.nullable) ||
          (op.value.type !== "null" && op.value.type !== op.column.dataType)
        )
          throw new Error("The value must match the attribute type.");
        object.columns.push(structuredClone(op.column));
        if (storageColumn(op.column))
          values[attributeId(op.column.id)] = op.value;
        description = `Add ${object.name}.${op.column.name}`;
        break;
      case "drop_column": {
        const a = attributeBinding(object, op.column_id);
        if (declaredKeys(object).some((key) => key.includes(a.id)))
          throw new Error(
            "This field identifies records through a primary or unique key; remove its identity binding first.",
          );
        const references = schema.foreign_keys.filter(
          (f) =>
            f.source_columns.includes(a.id) || f.target_columns.includes(a.id),
        );
        forget([
          attributeId(a.id),
          ...references.map((f) => referenceId(f.id)),
        ]);
        schema.foreign_keys = schema.foreign_keys.filter(
          (f) => !references.includes(f),
        );
        object.columns = object.columns.filter((c) => c.id !== a.id);
        description = `Delete ${object.name}.${a.name}`;
        break;
      }
      case "add_unique_key": {
        if (!op.column_ids.length)
          throw new Error("Choose fields for the unique key.");
        const key = [...op.column_ids];
        if (
          !declaredKeys(object).some(
            (existing) => JSON.stringify(existing) === JSON.stringify(key),
          )
        )
          object.uniqueKeys = [...(object.uniqueKeys ?? []), key];
        key.forEach((id) => (attributeBinding(object, id).nullable = false));
        description = `Declare unique key on ${object.name}`;
        break;
      }
      case "add_primary_key":
        if (object.primaryKey.length)
          throw new Error("Remove the existing primary key first.");
        if (!op.column_ids.length) throw new Error("Choose identity fields.");
        object.primaryKey = [...op.column_ids];
        object.primaryKey.forEach((id) => {
          attributeBinding(object, id).nullable = false;
        });
        description = `Set primary key on ${object.name}`;
        break;
      case "drop_primary_key":
        if (!object.primaryKey.length)
          throw new Error("This object has no primary key.");
        if (schema.foreign_keys.some((a) => a.target_table === object.id))
          throw new Error("Remove arrows referencing this primary key first.");
        object.primaryKey = [];
        description = `Remove primary key from ${object.name}`;
        break;
      case "add_reference":
        object.columns.push(
          ...structuredClone(op.columns).map((c) => ({
            ...c,
            storage: "reference" as const,
          })),
        );
      // fall through: the physical carrier and reference are one schema action.
      case "add_foreign_key":
        if (op.foreign_key.source_table !== object.id)
          throw new Error("Arrow source does not match the object.");
        if (op.op === "add_foreign_key")
          for (const id of op.storage_columns ?? []) {
            if (!op.foreign_key.source_columns.includes(id))
              throw new Error(
                "A carrier field must belong to this reference binding.",
              );
            attributeBinding(object, id).storage = "reference";
          }
        schema.foreign_keys.push(structuredClone(op.foreign_key));
        op.foreign_key.source_columns.forEach((id) => {
          attributeBinding(object, id).nullable = false;
        });
        description = `Add arrow ${op.foreign_key.name ?? object.name}`;
        break;
      case "drop_foreign_key": {
        const arrow = schema.foreign_keys.find(
          (a) => a.id === op.foreign_key_id && a.source_table === object.id,
        );
        if (!arrow) throw new Error("The arrow no longer exists.");
        forget([referenceId(arrow.id)]);
        schema.foreign_keys = schema.foreign_keys.filter(
          (a) => a.id !== arrow.id,
        );
        const carriers = object.columns.filter(
          (c) =>
            c.storage === "reference" &&
            arrow.source_columns.includes(c.id) &&
            !schema.foreign_keys.some(
              (f) =>
                f.source_columns.includes(c.id) ||
                f.target_columns.includes(c.id),
            ) &&
            !declaredKeys(object).some((k) => k.includes(c.id)),
        );
        forget(carriers.map((c) => attributeId(c.id)));
        object.columns = object.columns.filter((c) => !carriers.includes(c));
        description = `Drop arrow ${arrow.name ?? object.name}`;
        break;
      }
      case "rename_arrow": {
        const arrow = schema.foreign_keys.find(
          (a) => a.id === op.arrow_id && a.source_table === object.id,
        );
        if (!arrow) throw new Error("The arrow no longer exists.");
        description = `Rename arrow → ${op.new_name}`;
        arrow.name = op.new_name;
        break;
      }
      case "add_equation": {
        if (op.equation.left.source !== object.id)
          throw new Error("Equation source does not match the object.");
        schema.equations = [
          ...(schema.equations ?? []),
          structuredClone(op.equation),
        ];
        description = `Add path equation on ${object.name}`;
        // Total references are the SQL interpretation of generating arrows.
        for (const id of [
          ...op.equation.left.arrows,
          ...op.equation.right.arrows,
        ]) {
          const arrow = schema.foreign_keys.find(
            (a) => referenceId(a.id) === id,
          );
          if (arrow)
            arrow.source_columns.forEach((c) => {
              attributeBinding(
                objectBinding(schema, arrow.source_table),
                c,
              ).nullable = false;
            });
        }
        break;
      }
      case "drop_equation":
        if (!schema.equations?.some((e) => e.id === op.equation_id))
          throw new Error("The equation no longer exists.");
        schema.equations = schema.equations.filter(
          (e) => e.id !== op.equation_id,
        );
        description = `Drop path equation on ${object.name}`;
        break;
    }
  }
  validateBindings(schema);
  return {
    before,
    after: schema,
    storageEdits: editsFor(
      storagePresentation(before),
      storagePresentation(schema),
    ),
    abstract: translateDatabaseCommand(before, schema, operation),
    values,
    tableId,
    description,
    ...(population ? { population } : {}),
  };
}

export function planCommands(
  base: SchemaSpec,
  operations: Operation[],
): DatabaseChange[] {
  let schema = base;
  return operations.map((operation) => {
    const change = translateCommand(schema, operation);
    schema = change.after;
    return change;
  });
}
