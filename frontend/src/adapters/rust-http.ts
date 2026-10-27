import type { ModelEngine } from "../application/ports.ts";
import type {
  RustEvaluation,
  ScanRequest,
  SqlBundle,
} from "../model/operations.ts";

export function createRustHttpEngine(base = "/api"): ModelEngine {
  async function request<T>(
    path: string,
    body?: unknown,
    method = "POST",
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${base}/${path}`, {
        method,
        headers:
          body === undefined
            ? undefined
            : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error(
        "The local Rust service is unavailable. Restart the local app.",
      );
    }
    if (!response.ok)
      throw new Error(
        response.status === 413
          ? "The request exceeds the local service limit."
          : "The local Rust service could not process this request.",
      );
    if (response.status === 204) return undefined as T;
    const result = (await response.json()) as
      ({ kind: "valid" } & T) | { kind: "invalid"; error: { message: string } };
    if (result.kind === "invalid") throw new Error(result.error.message);
    return result as T;
  }
  return {
    async evaluateBatch(state, operations) {
      return (
        await request<{ preview: RustEvaluation }>("operations/evaluate", {
          state,
          operations,
          batch: true,
        })
      ).preview;
    },
    async validate(schema, counts, source, progress) {
      if (
        !schema.foreign_keys.length &&
        !schema.tables.some((t) => t.primary_key.length)
      )
        return;
      const { id, scans } = await request<{ id: string; scans: ScanRequest[] }>(
        "constraints/start",
        { schema, counts },
      );
      try {
        // The core chooses phases and projections; this adapter only fulfils reads.
        for (const scan of scans) {
          const name =
            schema.tables.find((t) => t.id === scan.table_id)?.name ?? "table";
          for await (const batch of source(scan.table_id, scan.column_ids)) {
            await request(`constraints/${id}/batch`, {
              phase: scan.phase,
              table_id: scan.table_id,
              ...batch,
            });
            progress(
              `Checking ${name} · ${(batch.start + batch.rows.length).toLocaleString()} rows`,
            );
          }
        }
        await request(`constraints/${id}/finish`);
      } finally {
        await request(`constraints/${id}`, undefined, "DELETE").catch(() => {});
      }
    },
    async sql(base, operations, current) {
      return (
        await request<{ sql: SqlBundle }>("migration/sql", {
          base,
          operations,
          current,
        })
      ).sql;
    },
  };
}
