import { PGlite } from "@electric-sql/pglite";
import {
  compilePlan,
  constraintStatements,
  ident,
  schemaStatements,
  sqlBundle,
} from "../adapters/postgres-compiler.ts";
import { LIMITS } from "../application/limits.ts";
import type { ModelEngine, RowBatch } from "../application/ports.ts";
import { ReadableFailure } from "../model/failure.ts";
import type { TableSpec } from "../model/operations.ts";
import type { CellValue } from "../model/schema.ts";
import { explainPostgresFailure } from "./postgres-errors.ts";

// One PostgreSQL execution path. Export uses the very same compiled statements.
export function createPostgresEngine(): ModelEngine {
  return {
    async evaluate(base, operations, source, sink, progress) {
      const plan = compilePlan(base, operations);
      const db = await PGlite.create();
      const count = async (table: TableSpec) =>
        Number(
          (
            await db.query<{ n: string }>(
              `SELECT count(*)::text AS n FROM ${ident(table.name)}`,
            )
          ).rows[0].n,
        );
      try {
        await db.exec(schemaStatements(base, false).join("\n"));
        for (const table of base.tables) {
          progress(`Reading ${table.name}…`);
          for await (const batch of source(table.id)) {
            if (!batch.rows.length) continue;
            if (!table.columns.length) {
              for (const _ of batch.rows)
                await db.exec(
                  `INSERT INTO ${ident(table.name)} DEFAULT VALUES;`,
                );
              continue;
            }
            const width = table.columns.length;
            const tuples = batch.rows.map((row, i) => {
              if (row.length !== width)
                throw new Error("A record does not match its table schema.");
              return `(${row.map((_, j) => `$${i * width + j + 1}`).join(",")})`;
            });
            await db.query(
              `INSERT INTO ${ident(table.name)} (${table.columns.map((c) => ident(c.name)).join(",")}) VALUES ${tuples.join(",")}`,
              batch.rows.flat(),
            );
          }
        }
        const initialChecks = constraintStatements(base);
        if (initialChecks.length) {
          try {
            await db.exec(initialChecks.join("\n"));
          } catch (error) {
            throw explainPostgresFailure(error, { before: base, after: base });
          }
        }
        await db.exec("BEGIN;");
        for (const [index, step] of plan.steps.entries()) {
          progress(step.description);
          for (const expansion of step.expansions ?? []) {
            const table = step.before.tables.find(
                (t) => t.id === expansion.tableId,
              )!,
              target = step.before.tables.find(
                (t) => t.id === expansion.choicesTableId,
              )!,
              rows =
                BigInt(await count(table)) *
                BigInt(await count(target)) ** BigInt(expansion.paths);
            if (
              rows > BigInt(LIMITS.rows) ||
              rows * BigInt(expansion.width) > BigInt(LIMITS.cells)
            )
              throw new ReadableFailure({
                kind: "preview-limit",
                precheckFailed: true,
                message: `Π preview for ${table.name} exceeds the local sample limit; the SQL migration can still be exported through schema-only mode.`,
              });
          }
          try {
            await db.exec(step.statements.join("\n"));
          } catch (error) {
            throw explainPostgresFailure(error, step, index);
          }
        }
        await db.exec("COMMIT;");
        for (const table of plan.schema.tables.filter((t) =>
          plan.changedData.includes(t.id),
        )) {
          progress(`Preparing ${table.name} preview…`);
          const rows = async function* (): AsyncIterable<RowBatch> {
            for (let offset = 0; ; offset += 200) {
              const projection = table.columns.length
                ? table.columns.map((c) => `${ident(c.name)}::text`).join(",")
                : "1";
              const result = await db.query<CellValue[]>(
                `SELECT ${projection} FROM ${ident(table.name)} ORDER BY ctid LIMIT 200 OFFSET $1`,
                [offset],
                { rowMode: "array" },
              );
              if (!result.rows.length) break;
              yield {
                offset,
                rows: table.columns.length
                  ? result.rows
                  : result.rows.map(() => []),
              };
            }
          };
          await sink(table, rows());
        }
        return {
          schema: plan.schema,
          changedData: plan.changedData,
          changes: plan.changes,
        };
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          typeof error.code === "string" &&
          /^[0-9A-Z]{5}$/.test(error.code)
        )
          throw explainPostgresFailure(error, { before: base, after: base });
        throw error;
      } finally {
        await db.close();
      }
    },
    async sql(base, operations, current) {
      return sqlBundle(base, operations, current);
    },
  };
}
