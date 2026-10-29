import type { WorkspaceStore } from "./ports.ts";
import type { Table, CellValue } from "../model/schema.ts";
import type { SchemaSpec } from "../model/operations.ts";
import { schemaSpec } from "../model/wire.ts";
import { createUseCase } from "./workspaces.ts";
import { validScalar } from "../model/scalar.ts";
import type { FrozenBinding, Contract } from "./cql-subset.ts";
export type RecipeBindings = Record<string, Record<string, string>>;
export type SourceFixture = {
  source: SchemaSpec;
  data: { tables: Record<string, Record<string, string | null>[]> };
  bindings: RecipeBindings;
};
export const canonical = (value: unknown): string =>
  JSON.stringify(sort(value));
function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sort(v)]),
    );
  return value;
}
export async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(value)),
  );
  return [...new Uint8Array(bytes)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export async function prepareSource(
  store: WorkspaceStore,
  fixture: SourceFixture,
) {
  const c = await createUseCase(store);
  await store.patchInfo(c.id, {
    name: "CQL source snapshot (" + fixture.source.tables.length + " tables)",
  });
  const ids = new Map<string, string>();
  for (const t of fixture.source.tables) {
    ids.set(t.id, crypto.randomUUID());
    for (const col of t.columns) ids.set(col.id, crypto.randomUUID());
  }
  for (const fk of fixture.source.foreign_keys)
    ids.set(fk.id, crypto.randomUUID());
  const source: SchemaSpec = {
    tables: fixture.source.tables.map((t) => ({
      ...t,
      id: ids.get(t.id)!,
      columns: t.columns.map((col) => ({ ...col, id: ids.get(col.id)! })),
      primaryKey: t.primaryKey.map((id) => ids.get(id)!),
    })),
    foreign_keys: fixture.source.foreign_keys.map((f) => ({
      ...f,
      id: ids.get(f.id)!,
      source_table: ids.get(f.source_table)!,
      target_table: ids.get(f.target_table)!,
      source_columns: f.source_columns.map((id) => ids.get(id)!),
      target_columns: f.target_columns.map((id) => ids.get(id)!),
    })),
  };
  const tables: Table[] = [];
  const writers = [];
  try {
    for (let i = 0; i < source.tables.length; i++) {
      const t = source.tables[i],
        old = fixture.source.tables[i];
      const table: Table = {
        ...t,
        caseId: c.id,
        columns: t.columns.map((col, index) => ({ ...col, index })),
        fileName: "DB1B sample " + t.name,
        bytes: 0,
        rowCount: 0,
      };
      const w = store.stage(table);
      writers.push(w);
      await w.append(
        fixture.data.tables[old.id].map((row) =>
          old.columns.map((col) => row[col.id]),
        ),
      );
      tables.push(await w.finish(table));
    }
    await store.commit(c.id, 0, {
      kind: "checkpoint",
      state: { tables, relationships: source.foreign_keys, equations: [] },
      operations: [],
      description:
        "Source snapshot: " +
        tables.map((t) => t.name + " " + t.rowCount).join(", "),
    });
  } catch (e) {
    await Promise.allSettled(writers.map((w) => w.abort()));
    await store.discard(tables);
    throw e;
  }
  const bindings = Object.fromEntries(
    Object.entries(fixture.bindings)
      .filter(([k]) => k.startsWith("source"))
      .map(([k, v]) => [
        k,
        Object.fromEntries(
          Object.entries(v).map(([role, id]) => [role, ids.get(id)!]),
        ),
      ]),
  );
  return { caseId: c.id, bindings };
}
export type RunBinding = {
  targetSchemaHash: string;
  revision: number;
  sourceDataDigest: string;
};
export type LiveRow = {
  id: string;
  values: Record<string, CellValue | boolean>;
  foreignKeys: Record<string, string>;
};
export type LiveResult = {
  runId: string;
  binding: RunBinding;
  target: SchemaSpec;
  rows: Record<string, LiveRow[]>;
  manifest: unknown;
  programHash: unknown;
  sourceCaseId: string;
  sourceRevision: number;
};
async function request(path: string, options: RequestInit = {}) {
  const r = await fetch("/api/cql" + path, options);
  const body = await r.json();
  if (!r.ok) throw Error(body.error ?? body.message ?? JSON.stringify(body));
  return body;
}
function sameBinding(a: RunBinding, b: RunBinding) {
  if (canonical(a) !== canonical(b))
    throw Error("Run snapshot binding mismatch.");
}
export async function runRecipe(
  store: WorkspaceStore,
  targetCaseId: string,
  sourceCaseId: string,
  sourceBindings: RecipeBindings,
  binding: FrozenBinding,
  onStatus: (s: string) => void,
  signal: AbortSignal,
  recipeId: string,
): Promise<LiveResult> {
  const current = await store.load(targetCaseId),
    source = await store.load(sourceCaseId);
  const target = schemaSpec(
    current.tables,
    current.useCase.relationships,
    current.useCase.equations ?? [],
  );
  if (
    canonical(target) !==
    canonical(schemaSpec(binding.tables, binding.relationships, []))
  )
    throw Error("Existing target schema no longer matches captured bindings.");
  const data: { tables: Record<string, Record<string, CellValue>[]> } = {
    tables: {},
  };
  for (const t of source.tables) {
    const rows: Record<string, CellValue>[] = [];
    for await (const batch of store.rows(t))
      for (const row of batch.rows)
        rows.push(
          Object.fromEntries(t.columns.map((col, i) => [col.id, row[i]])),
        );
    data.tables[t.id] = rows;
  }
  const bindings: RecipeBindings = {
    ...sourceBindings,
    targetEntities: binding.entities,
    targetAttributes: {},
    targetForeignKeys: {},
  };
  for (const [entity, attributes] of Object.entries(binding.attributes))
    for (const [name, id] of Object.entries(attributes)) {
      const fk = binding.relationships.find(
        (f) =>
          f.source_table === binding.entities[entity] &&
          f.source_columns[0] === id,
      );
      if (fk) bindings.targetForeignKeys[entity + "_" + name] = fk.id;
      else bindings.targetAttributes[entity + "_" + name] = id;
    }
  const captured: RunBinding = {
    targetSchemaHash: await digest(target),
    revision: current.useCase.revision ?? 0,
    sourceDataDigest: await digest(data),
  };
  onStatus("Submitting source snapshot to CQL…");
  let status = await request("/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "recipe",
      recipeId,
      source: schemaSpec(
        source.tables,
        source.useCase.relationships,
        source.useCase.equations ?? [],
      ),
      target,
      data,
      bindings,
      ...captured,
    }),
    signal,
  });
  sameBinding(captured, status.bindings);
  while (status.status === "queued" || status.status === "running") {
    onStatus(status.runId + ": CQL " + status.status + "…");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 800);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new DOMException("Stopped waiting", "AbortError"));
        },
        { once: true },
      );
    });
    status = await request("/runs/" + status.runId, { signal });
    sameBinding(captured, status.bindings);
  }
  if (status.status !== "succeeded")
    throw Error("CQL failed: " + JSON.stringify(status.diagnostics));
  if (
    canonical(status.manifest?.target?.nativeSchemaSpec) !==
      canonical(target) ||
    canonical(status.manifest?.bindings) !== canonical(bindings)
  )
    throw Error(
      "CQL result manifest does not match captured target/role bindings.",
    );
  const rows: Record<string, LiveRow[]> = {};
  for (const t of target.tables) {
    rows[t.id] = [];
    let total = 0;
    do {
      const page = await request(
        "/runs/" +
          status.runId +
          "/tables/" +
          encodeURIComponent(t.id) +
          "?offset=" +
          rows[t.id].length +
          "&limit=500",
        { signal },
      );
      sameBinding(captured, page.bindings);
      if (canonical(page.columns) !== canonical(t.columns))
        throw Error("Returned target columns differ from current target.");
      total = page.total;
      rows[t.id].push(...page.rows);
      if (page.rows.length === 0 && rows[t.id].length < total)
        throw Error("Incomplete result page.");
    } while (rows[t.id].length < total);
    if (rows[t.id].length !== total) throw Error("Result row count mismatch.");
  }
  onStatus("CQL complete. Review counts, then Apply.");
  return {
    runId: status.runId,
    binding: captured,
    target,
    rows,
    manifest: status.manifest,
    programHash: status.programHash,
    sourceCaseId,
    sourceRevision: source.useCase.revision ?? 0,
  };
}
export function materializeLive(
  result: Pick<LiveResult, "target" | "rows">,
  tables: Table[],
  relationships: SchemaSpec["foreign_keys"],
) {
  // The carrier is only a result-local handle. Physical keys come from the frozen schema.
  if (
    canonical(
      schemaSpec(tables, relationships, result.target.equations ?? []),
    ) !== canonical(result.target)
  )
    throw Error("Materialization target schema mismatch.");
  type NativeRow = { input: LiveRow; cells: Map<string, CellValue> };
  const all = new Map<string, Map<string, NativeRow>>();
  const tableById = new Map(tables.map((t) => [t.id, t]));
  const column = (tableId: string, id: string) => {
    const col = tableById.get(tableId)?.columns.find((c) => c.id === id);
    if (!col) throw Error("Unknown key column " + id);
    return col;
  };
  const scalar = (
    table: Table,
    col: Table["columns"][number],
    raw: unknown,
  ): CellValue => {
    const value =
      col.dataType === "boolean" && typeof raw === "boolean"
        ? raw
          ? "true"
          : "false"
        : raw;
    if (value === null) {
      if (col.nullable === false)
        throw Error("Required CQL value " + table.name + "." + col.name);
      return null;
    }
    if (
      typeof value !== "string" ||
      !validScalar(col.dataType ?? "text", value)
    )
      throw Error(
        "Missing/invalid native CQL scalar " +
          table.name +
          "." +
          col.name +
          "; explicit key transport may be required.",
      );
    return value;
  };
  // Allocate only explicitly generated singleton integer identities; retain returned business values.
  for (const table of tables) {
    const inputs = result.rows[table.id];
    if (!Array.isArray(inputs)) throw Error("Missing result table " + table.id);
    const rows = new Map<string, NativeRow>();
    all.set(table.id, rows);
    for (const [i, input] of inputs.entries()) {
      if (typeof input.id !== "string" || !input.id || rows.has(input.id))
        throw Error("Duplicate/missing result carrier.");
      const cells = new Map<string, CellValue>();
      rows.set(input.id, { input, cells });
      for (const col of table.columns) {
        if (col.generated !== undefined) {
          if (
            col.generated !== "identity" ||
            col.dataType !== "integer" ||
            col.nullable !== false ||
            table.primaryKey?.length !== 1 ||
            table.primaryKey[0] !== col.id
          )
            throw Error(
              "Unsupported generated identity " + table.name + "." + col.name,
            );
          cells.set(col.id, String(i + 1));
        } else if (Object.hasOwn(input.values, col.id))
          cells.set(col.id, scalar(table, col, input.values[col.id]));
        else if (
          !relationships.some(
            (f) =>
              f.source_table === table.id && f.source_columns.includes(col.id),
          )
        )
          throw Error(
            "Missing native CQL scalar " +
              table.name +
              "." +
              col.name +
              "; explicit key transport required.",
          );
      }
    }
  }
  const pending: {
    fk: SchemaSpec["foreign_keys"][number];
    source: NativeRow;
    target: NativeRow;
  }[] = [];
  for (const fk of relationships) {
    if (
      !fk.source_columns.length ||
      fk.source_columns.length !== fk.target_columns.length ||
      new Set(fk.source_columns).size !== fk.source_columns.length ||
      new Set(fk.target_columns).size !== fk.target_columns.length
    )
      throw Error("Invalid FK arity.");
    const targetTable = tableById.get(fk.target_table),
      sourceRows = all.get(fk.source_table);
    if (!targetTable || !sourceRows) throw Error("Unknown FK table.");
    if (
      ![targetTable.primaryKey ?? [], ...(targetTable.uniqueKeys ?? [])].some(
        (key) => canonical(key) === canonical(fk.target_columns),
      )
    )
      throw Error("FK target must be a declared ordered key.");
    fk.source_columns.forEach((id, i) => {
      if (
        (column(fk.source_table, id).dataType ?? "text") !==
        (column(fk.target_table, fk.target_columns[i]).dataType ?? "text")
      )
        throw Error("FK key type mismatch.");
    });
    for (const source of sourceRows.values()) {
      const target = all
        .get(fk.target_table)
        ?.get(source.input.foreignKeys[fk.id]);
      if (!target) throw Error("Dangling CQL result reference.");
      pending.push({ fk, source, target });
    }
  }
  // Finite dependency resolution allows chains and cycles whose keys are already present.
  let unresolved = pending;
  while (unresolved.length) {
    const next: typeof pending = [];
    let progress = false;
    for (const edge of unresolved) {
      const { fk, source, target } = edge;
      if (fk.target_columns.some((id) => !target.cells.has(id))) {
        next.push(edge);
        continue;
      }
      fk.source_columns.forEach((id, i) => {
        const value = target.cells.get(fk.target_columns[i])!;
        if (value === null) throw Error("Null FK target key.");
        if (source.cells.has(id) && source.cells.get(id) !== value)
          throw Error("Conflicting physical CQL FK value.");
        if (!source.cells.has(id)) {
          source.cells.set(id, value);
          progress = true;
        }
      });
    }
    if (next.length && !progress)
      throw Error(
        "Unresolvable CQL key dependency; explicit key transport required.",
      );
    unresolved = next;
  }
  // Tagged tuples avoid delimiter collisions and numeric precision loss in key validation.
  const keyPart = (type: string, value: string) => {
    if (type === "integer") return BigInt(value).toString();
    if (type === "real") {
      const [mantissa, exponent = "0"] = value.toLowerCase().split("e");
      const negative = mantissa.startsWith("-");
      const unsigned = mantissa.replace(/^[+-]/, "");
      const [whole, fraction = ""] = unsigned.split(".");
      let digits = (whole + fraction).replace(/^0+/, "");
      if (!digits) return "0";
      let scale = BigInt(exponent) - BigInt(fraction.length);
      while (digits.endsWith("0")) {
        digits = digits.slice(0, -1);
        scale++;
      }
      return (negative ? "-" : "") + digits + "e" + scale;
    }
    return value;
  };
  return tables.map((table) => {
    const rows = [...all.get(table.id)!.values()];
    for (const key of [table.primaryKey ?? [], ...(table.uniqueKeys ?? [])]) {
      if (!key.length) {
        if (key === table.primaryKey) throw Error("Empty native primary key.");
        continue;
      }
      if (new Set(key).size !== key.length)
        throw Error("Duplicate key column.");
      const seen = new Set<string>();
      for (const row of rows) {
        const tuple = key.map((id) => {
          const col = column(table.id, id),
            value = row.cells.get(id);
          if (
            value === undefined ||
            value === null ||
            ((col.dataType ?? "text") === "text" && value === "")
          )
            throw Error("Missing/null/empty native key.");
          return [
            col.dataType ?? "text",
            keyPart(col.dataType ?? "text", value),
          ];
        });
        const token = JSON.stringify(tuple);
        if (seen.has(token))
          throw Error("Duplicate native key in " + table.name);
        seen.add(token);
      }
    }
    return {
      table,
      rows: rows.map((row) =>
        table.columns.map((col) => scalar(table, col, row.cells.get(col.id))),
      ),
    };
  });
}
export async function applyLive(
  store: WorkspaceStore,
  caseId: string,
  result: LiveResult,
  contract: Contract,
) {
  const current = await store.load(caseId);
  if (current.useCase.revision !== result.binding.revision)
    throw Error("Target changed after Run. Run again.");
  if (
    (await digest(
      schemaSpec(
        current.tables,
        current.useCase.relationships,
        current.useCase.equations ?? [],
      ),
    )) !== result.binding.targetSchemaHash
  )
    throw Error("Target schema changed after Run.");
  const source = await store.load(result.sourceCaseId);
  if (source.useCase.revision !== result.sourceRevision)
    throw Error("Source changed after Run.");
  const staged: Table[] = [],
    writers = [];
  try {
    for (const { table, rows } of materializeLive(
      result,
      current.tables,
      current.useCase.relationships,
    )) {
      const writer = store.stage(table);
      writers.push(writer);
      await writer.append(rows);
      staged.push(await writer.finish(table));
    }
    await store.commit(caseId, result.binding.revision, {
      kind: "checkpoint",
      state: {
        tables: staged,
        relationships: current.useCase.relationships,
        equations: current.useCase.equations ?? [],
      },
      description: "CQL live result: " + result.runId,
      provenance: {
        kind: "cql-result-import",
        scope: "complete target replacement",
        resultId: result.runId,
        binding: result.binding,
        contract,
        targetHash: result.binding.targetSchemaHash,
        sourceDigest: result.binding.sourceDataDigest,
        manifest: result.manifest,
        programHash: result.programHash,
        equations: "none imported; external contract only",
      },
    });
  } catch (e) {
    await Promise.allSettled(writers.map((w) => w.abort()));
    await store.discard(staged);
    throw e;
  }
}
