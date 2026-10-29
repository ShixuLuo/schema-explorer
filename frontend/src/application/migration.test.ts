import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMemoryStore } from "../adapters/memory-store.ts";
import { schemaStatements } from "../adapters/postgres-compiler.ts";
import { createPostgresEngine } from "../adapters/postgres-engine.ts";
import type { Operation, TableSpec } from "../model/operations.ts";
import type { CellValue, Table } from "../model/schema.ts";
import { schemaSpec } from "../model/wire.ts";
import { createEditActions, EditSession } from "./editor.ts";
import { exportSql } from "./export.ts";
import { createUseCase, publishImport } from "./workspaces.ts";

const input = JSON.parse(
  readFileSync(
    new URL("../../../verification/input.json", import.meta.url),
    "utf8",
  ),
) as Record<string, CellValue[][]>;
const reference = JSON.parse(
  readFileSync(
    new URL("../../../verification/cql-reference.json", import.meta.url),
    "utf8",
  ),
);
const tableSpec = (id: string): TableSpec => ({
  id,
  name: id,
  primaryKey: [],
  columns: [
    { id: id + "v", name: "value", dataType: "text", nullable: true },
    { id: id + "n", name: "number", dataType: "integer", nullable: false },
  ],
});
const combine = (
  id: string,
  sources: string[],
  method: "sigma" | "pi",
): Operation => ({
  op: "combine_tables",
  table: tableSpec(id),
  inputs: sources.map((table_id) => ({
    table_id,
    column_ids: [table_id + "v", table_id + "n"],
  })),
  method,
});
const sorted = (rows: CellValue[][]) =>
  rows.map((row) => JSON.stringify(row)).sort();

test("templates match the CQL oracle and exported SQL reproduces the complete multi-step preview", async () => {
  const store = createMemoryStore(),
    engine = createPostgresEngine(),
    useCase = await createUseCase(store),
    tables: Table[] = [];
  try {
    for (const id of ["left", "right"]) {
      const spec = tableSpec(id),
        table: Table = {
          id,
          caseId: useCase.id,
          name: id,
          fileName: "",
          bytes: 0,
          rowCount: 0,
          primaryKey: [],
          columns: spec.columns.map((c, index) => ({
            id: c.id,
            name: c.name,
            index,
            dataType: c.dataType,
            nullable: c.nullable,
          })),
        };
      const writer = store.stage(table);
      await writer.append(input[id]);
      tables.push(await writer.finish(table));
    }
    await publishImport(store, await store.snapshot(useCase.id), tables);
    const base = await store.snapshot(useCase.id),
      root = base.useCase.history.editing!;
    await store.updateTags(useCase.id, {
      kind: "add",
      checkpointId: root,
      tag: "Live",
    });
    const session = new EditSession(
      useCase.id,
      createEditActions(store, engine),
      () => {},
    );
    await session.append([combine("matched", ["left", "right"], "sigma")]);
    assert.equal(
      (await session.readRows("matched", 0, 100)).length,
      reference.results.sum,
    );
    await session.chooseMethod(0, "pi");
    assert.equal(
      (await session.readRows("matched", 0, 100)).length,
      reference.results.matched,
    );
    await session.append([
      {
        op: "copy_table",
        table_id: "matched",
        column_ids: ["matchedv", "matchedn"],
        table: tableSpec("copy"),
      },
      combine("mixed", ["matched", "copy"], "sigma"),
    ]);
    assert.equal(
      (await session.readRows("mixed", 0, 100)).length,
      reference.results.mixed,
    );
    const expected = await session.readRows("mixed", 0, 100);
    await session.commit();
    const middle = (await store.snapshot(useCase.id)).useCase.history.editing!;
    await store.updateTags(useCase.id, {
      kind: "add",
      checkpointId: middle,
      tag: "Review",
    });
    const next = new EditSession(
      useCase.id,
      createEditActions(store, engine),
      () => {},
    );
    await next.append([
      {
        op: "add_column",
        table_id: "mixed",
        column: {
          id: "flag",
          name: "flag",
          dataType: "text",
          nullable: false,
        },
        value: { type: "text", value: "ready" },
      },
    ]);
    assert.ok(
      (await next.readRows("mixed", 0, 5, "after")).every(
        (row) => row.at(-1) === "ready",
      ),
    );
    await next.commit();
    const latest = (await store.snapshot(useCase.id)).useCase.history.editing!;
    const full = await exportSql(store, engine, useCase.id),
      suffix = await exportSql(store, engine, useCase.id, {
        from: middle,
        to: latest,
      });
    assert.deepEqual(full.range, { from: root, to: latest });
    assert.match(full.fromLabel, /Live/);
    assert.match(suffix.fromLabel, /Review/);
    assert.match(full.migration!, /IS NOT DISTINCT FROM/);
    assert.match(full.migration!, /UNION ALL/);
    assert.doesNotMatch(full.migration!, /VALUES\s*\(/);
    assert.doesNotMatch(full.migration!, /9223372036854775807/);
    assert.doesNotMatch(suffix.migration!, /JOIN|UNION ALL/);
    const db = new PGlite();
    try {
      await db.exec(schemaStatements(schemaSpec(base.tables, [])).join("\n"));
      for (const id of ["left", "right"])
        for (const row of input[id])
          await db.query(`INSERT INTO "${id}" VALUES ($1,$2)`, row);
      await db.exec(full.migration!);
      const rows = (
        await db.query<CellValue[]>(
          `SELECT value,number::text,flag FROM mixed`,
          [],
          { rowMode: "array" },
        )
      ).rows;
      assert.deepEqual(
        sorted(rows),
        sorted(expected.map((row) => [...row, "ready"])),
      );
    } finally {
      await db.close();
    }
  } finally {
    await store.close();
  }
});

test("an empty workspace evolves into executable SQL without CSV data", async () => {
  const store = createMemoryStore(),
    engine = createPostgresEngine(),
    useCase = await createUseCase(store);
  try {
    const session = new EditSession(
      useCase.id,
      createEditActions(store, engine),
      () => {},
    );
    await session.append([
      {
        method: "sigma",
        op: "create_table",
        table: { id: "people", name: "people", columns: [], primaryKey: [] },
      },
    ]);
    await session.append([
      {
        op: "add_column",
        table_id: "people",
        column: { id: "name", name: "name", dataType: "text", nullable: true },
        value: { type: "null" },
      },
    ]);
    await session.commit();
    const sql = await exportSql(store, engine, useCase.id);
    const db = new PGlite();
    try {
      await db.exec(sql.migration!);
      assert.deepEqual((await db.query("SELECT name FROM people")).rows, []);
    } finally {
      await db.close();
    }
  } finally {
    await store.close();
  }
});

test("a later removal cannot erase an earlier primary-key check", async () => {
  const engine = createPostgresEngine();
  await assert.rejects(
    engine.evaluate(
      { tables: [tableSpec("t")], foreign_keys: [] },
      [
        { op: "add_primary_key", table_id: "t", column_ids: ["tn"] },
        { op: "drop_primary_key", table_id: "t" },
      ],
      async function* () {
        yield {
          offset: 0,
          rows: [
            ["a", "1"],
            ["b", "1"],
          ],
        };
      },
      async () => {},
      () => {},
    ),
    /duplicate values/,
  );
});
