import type { WorkspaceStore, WorkspaceSnapshot } from "./ports.ts";
import type { SchemaSpec } from "../model/operations.ts";
import type { Table, CellValue } from "../model/schema.ts";
import type { Assignment } from "../migration/migration-client.ts";
import { schemaSpec } from "../model/wire.ts";
import { canonical, digest, materializeLive } from "./cql-live.ts";
import type { LiveResult, RunBinding } from "./cql-live.ts";

export type PreparedDraftMigration = LiveResult & {
  sourceSchema: SchemaSpec;
  sourceSchemaHash: string;
  assignments: Assignment[];
  resultDigest: string;
};
const spec = (snapshot: WorkspaceSnapshot) => schemaSpec(snapshot.tables,
  snapshot.useCase.relationships, snapshot.useCase.equations ?? []);
async function sourceData(store: WorkspaceStore, snapshot: WorkspaceSnapshot, signal?: AbortSignal) {
  const data: { tables: Record<string, Record<string, CellValue>[]> } = { tables: {} };
  for (const table of snapshot.tables) {
    const rows: Record<string, CellValue>[] = [];
    for await (const batch of store.rows(table)) {
      signal?.throwIfAborted();
      for (const row of batch.rows) rows.push(Object.fromEntries(table.columns.map((col, i) => [col.id, row[i]])));
    }
    data.tables[table.id] = rows;
  }
  return data;
}
async function request(path: string, signal: AbortSignal, payload?: unknown) {
  signal.throwIfAborted();
  const response = await fetch(`/api/cql${path}`, { signal, ...(payload === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }) });
  const body = await response.json();
  if (!response.ok || body.ok === false) throw Error(body.error?.message ?? body.message ?? JSON.stringify(body.error ?? body));
  return body;
}
function checkBinding(expected: RunBinding, actual: unknown) {
  if (canonical(expected) !== canonical(actual)) throw Error("Run snapshot binding mismatch.");
}
function wait(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason ?? new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 800);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
const sealedContent = (result: Omit<PreparedDraftMigration, "resultDigest">) => ({
  runId: result.runId, binding: result.binding, target: result.target, rows: result.rows,
  manifest: result.manifest, programHash: result.programHash, sourceCaseId: result.sourceCaseId,
  sourceRevision: result.sourceRevision, sourceSchema: result.sourceSchema,
  sourceSchemaHash: result.sourceSchemaHash, assignments: result.assignments,
});

// Run reads the source's immutable data IDs. Only Apply publishes a checkpoint.
export async function runDraftMigration(
  store: WorkspaceStore, caseId: string, expectedRevision: number,
  sourceSchema: SchemaSpec, targetSchema: SchemaSpec, assignments: Assignment[],
  onProgress: (message: string) => void, signal: AbortSignal,
): Promise<PreparedDraftMigration> {
  signal.throwIfAborted();
  const source = await store.load(caseId);
  const capturedSource = structuredClone(sourceSchema), target = structuredClone(targetSchema), capturedAssignments = structuredClone(assignments);
  if ((source.useCase.revision ?? 0) !== expectedRevision || canonical(spec(source)) !== canonical(capturedSource))
    throw Error("Source changed before Run. Reopen the migration draft.");
  const data = await sourceData(store, source, signal);
  const binding: RunBinding = { revision: expectedRevision, targetSchemaHash: await digest(target), sourceDataDigest: await digest(data) };
  onProgress("Submitting source snapshot to CQL…");
  let status = await request("/runs", signal, { kind: "query", source: capturedSource, target, assignments: capturedAssignments, data, ...binding });
  const runId = status.runId;
  if (typeof runId !== "string" || !runId) throw Error("Missing CQL run ID.");
  checkBinding(binding, status.bindings);
  while (status.status === "queued" || status.status === "running") {
    onProgress(`${runId}: CQL ${status.status}…`);
    await wait(signal);
    status = await request(`/runs/${encodeURIComponent(runId)}`, signal);
    if (status.runId !== runId) throw Error("Run ID mismatch.");
    checkBinding(binding, status.bindings);
  }
  if (status.status !== "succeeded") throw Error("CQL failed: " + JSON.stringify(status.diagnostics));
  if (canonical(status.manifest?.source?.nativeSchemaSpec) !== canonical(capturedSource) ||
      canonical(status.manifest?.target?.nativeSchemaSpec) !== canonical(target)) throw Error("CQL manifest schema mismatch.");
  if (typeof status.programHash !== "string" || !/^[a-f0-9]{64}$/.test(status.programHash)) throw Error("Missing/invalid CQL program hash.");
  const rows: LiveResult["rows"] = {};
  const counts = status.tables;
  if (!Array.isArray(counts) || counts.length !== target.tables.length || new Set(counts.map((t: { tableId: string }) => t.tableId)).size !== counts.length)
    throw Error("Result table manifest mismatch.");
  for (const table of target.tables) {
    const count = counts.find((t: { tableId: string }) => t.tableId === table.id)?.rowCount;
    if (!Number.isSafeInteger(count) || count < 0) throw Error("Invalid result row count.");
    rows[table.id] = [];
    do {
      const offset = rows[table.id].length;
      const page = await request(`/runs/${encodeURIComponent(runId)}/tables/${encodeURIComponent(table.id)}?offset=${offset}&limit=500`, signal);
      checkBinding(binding, page.bindings);
      if (page.runId !== runId || page.tableId !== table.id || page.offset !== offset || page.total !== count ||
          canonical(page.columns) !== canonical(table.columns) ||
          canonical(page.foreignKeys) !== canonical(target.foreign_keys.filter(f => f.source_table === table.id)) ||
          !Array.isArray(page.rows) || page.rows.length > 500 || page.rows.length + offset > count || (!page.rows.length && offset < count))
        throw Error("Invalid/incomplete CQL result page.");
      rows[table.id].push(...page.rows);
    } while (rows[table.id].length < count);
  }
  signal.throwIfAborted();
  const prepared = { runId, binding, target, rows, manifest: status.manifest, programHash: status.programHash,
    sourceCaseId: caseId, sourceRevision: expectedRevision, sourceSchema: capturedSource,
    sourceSchemaHash: await digest(capturedSource), assignments: capturedAssignments };
  onProgress("CQL complete. Review counts, then Apply.");
  return { ...prepared, resultDigest: await digest(sealedContent(prepared)) };
}

export async function applyDraftMigration(store: WorkspaceStore, prepared: PreparedDraftMigration) {
  // Copy before the first await so callers cannot change the checked result during staging.
  const result = structuredClone(prepared);
  if (await digest(sealedContent(result)) !== result.resultDigest || await digest(result.target) !== result.binding.targetSchemaHash)
    throw Error("Prepared migration changed. Run again.");
  const source = await store.load(result.sourceCaseId);
  if ((source.useCase.revision ?? 0) !== result.sourceRevision || result.binding.revision !== result.sourceRevision ||
      await digest(spec(source)) !== result.sourceSchemaHash ||
      await digest(await sourceData(store, source)) !== result.binding.sourceDataDigest)
    throw Error("Source changed after Run. Run again.");
  const tables: Table[] = result.target.tables.map(table => ({ ...table,
    columns: table.columns.map((column, index) => ({ ...column, index })),
    caseId: result.sourceCaseId, fileName: table.name, bytes: 0, rowCount: 0,
  }));
  const materialized = materializeLive(result, tables, result.target.foreign_keys);
  const staged: Table[] = [], writers: ReturnType<WorkspaceStore["stage"]>[] = [];
  try {
    for (const { table, rows } of materialized) {
      const writer = store.stage(table); writers.push(writer);
      await writer.append(rows); staged.push(await writer.finish(table));
    }
    await store.commit(result.sourceCaseId, result.sourceRevision, {
      kind: "checkpoint", state: { tables: staged, relationships: result.target.foreign_keys, equations: result.target.equations ?? [] },
      description: `CQL draft migration: ${result.runId}`,
      provenance: { kind: "cql-result-import", scope: "complete target replacement", resultId: result.runId,
        binding: { ...result.binding, sourceSchemaHash: result.sourceSchemaHash }, contract: { assignments: result.assignments },
        targetHash: result.binding.targetSchemaHash, sourceDigest: result.binding.sourceDataDigest,
        resultDigest: result.resultDigest, manifest: result.manifest, programHash: result.programHash,
        equations: "none imported; external contract only" },
    });
  } catch (error) {
    await Promise.allSettled(writers.map(writer => writer.abort()));
    await store.discard(staged); throw error;
  }
}
