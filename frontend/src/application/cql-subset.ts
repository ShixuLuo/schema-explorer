import { schemaSpec } from "../model/wire.ts";
import { materializeLive, type LiveRow } from "./cql-live.ts";
import type { DataType } from "../model/schema.ts";
import type { WorkspaceStore } from "./ports.ts";
import type { Column, ForeignKeySpec, Table } from "../model/schema.ts";
export type Contract = {
  metadata?: { title?: string; description?: string; recipeId?: string };
  entities: Record<
    string,
    {
      stored_attributes: Record<string, string>;
      refs: Record<string, string>;
      primary_key:
        | { kind: "generated"; name: string; type: "Int" }
        | { kind: "columns"; columns: string[] };
    }
  >;
};
export type Result = Record<string, Record<string, unknown>[]>;
export type FrozenBinding = {
  tables: Table[];
  relationships: ForeignKeySpec[];
  entities: Record<string, string>;
  attributes: Record<string, Record<string, string>>;
};
const nativeTypes: Record<string, DataType> = {
  String: "text",
  Int: "integer",
  Real: "real",
  Bool: "boolean",
};
export function freezeBinding(
  contract: Contract,
  caseId: string,
): FrozenBinding {
  const entities = Object.keys(contract.entities);
  const tableIds = Object.fromEntries(
    entities.map((n) => [n, crypto.randomUUID()]),
  );
  const attributes: FrozenBinding["attributes"] = {};
  const relationships: ForeignKeySpec[] = [];
  const tables = entities.map((name) => {
    const e = contract.entities[name];
    if (!e) throw Error("Missing target contract");
    const policy = e.primary_key;
    if (!policy) throw Error("Missing primary key policy " + name);
    if (policy.kind === "generated" && policy.type !== "Int")
      throw Error("Generated primary key requires Int");
    if (
      policy.kind === "columns" &&
      (!policy.columns.length ||
        new Set(policy.columns).size !== policy.columns.length ||
        policy.columns.some((key) => !Object.hasOwn(e.stored_attributes, key)))
    )
      throw Error("Invalid business primary key policy " + name);
    const columns: Column[] =
      policy.kind === "generated"
        ? [
            {
              id: crypto.randomUUID(),
              name: policy.name,
              index: 0,
              dataType: "integer",
              nullable: false,
              generated: "identity",
              storage: "identity",
            },
          ]
        : [];
    attributes[name] = {};
    for (const [key, sort] of Object.entries(e.stored_attributes)) {
      if (!nativeTypes[sort]) throw Error("Unsupported native type " + sort);
      const id = crypto.randomUUID();
      attributes[name][key] = id;
      columns.push({
        id,
        name: key,
        index: columns.length,
        dataType: nativeTypes[sort],
        nullable: false,
        ...(policy.kind === "columns" && policy.columns.includes(key)
          ? { storage: "identity" as const }
          : {}),
      });
    }

    return {
      id: tableIds[name],
      caseId,
      name,
      columns,
      primaryKey:
        policy.kind === "generated"
          ? [columns[0].id]
          : policy.columns.map((key) => attributes[name][key]),
      fileName: "CQL " + name,
      bytes: 0,
      rowCount: 0,
    };
  });
  for (const [name, e] of Object.entries(contract.entities))
    for (const [key, targetName] of Object.entries(e.refs)) {
      const source = tables.find((t) => t.id === tableIds[name])!,
        target = tables.find((t) => t.id === tableIds[targetName]);
      if (!target) throw Error("Reference outside target");
      const sourceColumns = target.primaryKey.map((targetId, i) => {
        const targetCol = target.columns.find((c) => c.id === targetId)!;
        const id = crypto.randomUUID();
        source.columns.push({
          id,
          name: target.primaryKey.length === 1 ? key : key + "_" + (i + 1),
          index: source.columns.length,
          dataType: targetCol.dataType,
          nullable: false,
          storage: "reference",
        });
        return id;
      });
      attributes[name][key] = sourceColumns[0];
      relationships.push({
        id: crypto.randomUUID(),
        name: key,
        source_table: source.id,
        source_columns: sourceColumns,
        target_table: target.id,
        target_columns: [...target.primaryKey],
      });
    }
  // Allocate native IDs exactly once when preview is prepared; apply consumes them.
  const plan = structuredClone({
    tables,
    relationships,
    entities: tableIds,
    attributes,
  });
  const freeze = (value: object) => {
    Object.freeze(value);
    for (const child of Object.values(value))
      if (child && typeof child === "object") freeze(child);
  };
  freeze(plan);
  return plan;
}
export function materializeSubset(
  contract: Contract,
  result: Result,
  binding: FrozenBinding,
) {
  const rows: Record<string, LiveRow[]> = {};
  for (const table of binding.tables) {
    const name = Object.keys(contract.entities).find(
      (n) => binding.entities[n] === table.id,
    );
    if (!name || !Array.isArray(result[name]))
      throw Error("Missing/unbound result table");
    rows[table.id] = result[name].map((row) => {
      if (typeof row.id !== "string") throw Error("Missing CQL identity");
      const values: LiveRow["values"] = {},
        foreignKeys: LiveRow["foreignKeys"] = {};
      for (const [key, id] of Object.entries(binding.attributes[name])) {
        const fk = binding.relationships.find(
          (f) => f.source_table === table.id && f.source_columns.includes(id),
        );
        const value = row[key];
        if (fk) {
          if (typeof value !== "string") throw Error("Dangling CQL reference");
          foreignKeys[fk.id] = value;
          continue;
        }
        const sort = contract.entities[name].stored_attributes[key];
        if (sort === "String") {
          if (typeof value !== "string") throw Error("Expected String");
          values[id] = value;
        } else if (sort === "Real") {
          const exact = row.exact_decimal_values as
            Record<string, unknown> | undefined;
          if (typeof exact?.[key] !== "string")
            throw Error("Missing exact decimal " + name + "." + key);
          values[id] = exact[key] as string;
        } else if (sort === "Bool") {
          if (typeof value !== "boolean") throw Error("Expected Bool");
          values[id] = value;
        } else if (sort === "Int") {
          if (typeof value === "string") values[id] = value;
          else if (typeof value === "number" && Number.isSafeInteger(value))
            values[id] = String(value);
          else throw Error("Expected exact Int");
        } else throw Error("Unsupported scalar");
      }
      return { id: row.id, values, foreignKeys };
    });
  }
  const target = schemaSpec(binding.tables, binding.relationships, []);
  return materializeLive(
    { target, rows },
    binding.tables,
    binding.relationships,
  );
}
export async function applySubset(
  store: WorkspaceStore,
  caseId: string,
  revision: number,
  contract: Contract,
  result: Result,
  binding: FrozenBinding,
) {
  const current = await store.load(caseId);
  if (current.useCase.revision !== revision)
    throw Error(
      "The target changed in another session; prepare the result again.",
    );
  if (
    JSON.stringify(
      schemaSpec(
        current.tables,
        current.useCase.relationships,
        current.useCase.equations ?? [],
      ),
    ) !== JSON.stringify(schemaSpec(binding.tables, binding.relationships, []))
  )
    throw Error("Target schema changed since binding was captured.");
  const targetHash = await sha256(
    JSON.stringify(schemaSpec(binding.tables, binding.relationships, [])),
  );
  const resultDigest = await sha256(JSON.stringify(result));
  const staged: Table[] = [];
  const writers = [];
  try {
    for (const { table, rows } of materializeSubset(
      contract,
      result,
      binding,
    )) {
      const existing = current.tables.find((t) => t.id === table.id)!;
      const w = store.stage(existing);
      writers.push(w);
      await w.append(rows);
      staged.push(await w.finish(existing));
    }
    await store.commit(caseId, revision, {
      kind: "checkpoint",
      state: {
        tables: staged,
        relationships: binding.relationships,
        equations: [],
      },
      description: "CQL result import: " + binding.tables.length + " tables",
      provenance: {
        kind: "cql-result-import",
        scope: "complete target replacement",
        resultId: "verified-result-fixture",
        binding,
        contract,
        targetHash,
        resultDigest,
        equations: "none imported; external contract only",
      },
    });
  } catch (error) {
    await Promise.allSettled(writers.map((w) => w.abort()));
    await store.discard(staged);
    throw error;
  }
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
