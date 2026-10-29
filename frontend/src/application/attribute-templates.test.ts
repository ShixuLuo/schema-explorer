import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryStore } from "../adapters/memory-store.ts";
import {
  compilePlan,
  schemaStatements,
  sqlBundle,
  sqlScript,
} from "../adapters/postgres-compiler.ts";
import { createPostgresEngine } from "../adapters/postgres-engine.ts";
import { failureInfo } from "../model/failure.ts";
import type {
  AttributeParameters,
  Operation,
  SchemaSpec,
} from "../model/operations.ts";
import type { Table } from "../model/schema.ts";
import { planSteps } from "../schema/migration-plan.ts";
import { prepareEdit } from "./edit.ts";
import { EditSession, createEditActions } from "./editor.ts";
import { exportSql } from "./export.ts";
import { fieldArrowOperations } from "./foreign-key-plan.ts";
import { applyEdit, createUseCase, publishImport } from "./workspaces.ts";
const base: SchemaSpec = {
  tables: [
    {
      id: "A",
      name: "A",
      columns: [
        { id: "name", name: "name", dataType: "text", nullable: false },
        { id: "n", name: "n", dataType: "integer", nullable: false },
      ],
      primaryKey: [],
    },
  ],
  foreign_keys: [],
};
const attr = (
  parameters: AttributeParameters,
  type: "text" | "integer" = "text",
): Operation => ({
  op: "add_attribute",
  table_id: "A",
  column: { id: "new", name: "new", dataType: type, nullable: true },
  parameters,
});
test("ordinary attribute creation has no implicit value or Delta; incomplete templates never export SQL", () => {
  const [op] = fieldArrowOperations(
    base,
    "A",
    "type:text",
    "new",
    {},
    () => "new",
  );
  assert.deepEqual(op, attr({ template: "extension" }));
  for (const parameters of [
    { template: "extension" },
    { template: "constant" },
    { template: "copy" },
  ] as AttributeParameters[])
    assert.throws(
      () => compilePlan(base, [attr(parameters)]),
      (error) => failureInfo(error).kind === "incomplete",
    );
});
test("constant and field templates produce real Delta mappings and executable SQL; null and empty text remain distinct", async () => {
  for (const [parameters, type, expected] of [
    [
      { template: "constant", value: { type: "text", value: "" } },
      "text",
      ["", ""],
    ],
    [{ template: "constant", value: { type: "null" } }, "text", [null, null]],
    [
      { template: "constant", value: { type: "text", value: "O'Reilly" } },
      "text",
      ["O'Reilly", "O'Reilly"],
    ],
    [
      {
        template: "constant",
        value: { type: "integer", value: "9223372036854775807" },
      },
      "integer",
      ["9223372036854775807", "9223372036854775807"],
    ],
    [{ template: "copy", source_column: "name" }, "text", ["Alice", "Bob"]],
    [{ template: "copy", source_column: "n" }, "integer", ["10", "20"]],
  ] as [AttributeParameters, "text" | "integer", (string | null)[]][]) {
    const db = new PGlite();
    try {
      const operation = attr(parameters, type),
        plan = compilePlan(base, [operation]);
      assert.equal(plan.steps[0].abstract.migration.kind, "delta");
      const script = sqlBundle(base, [operation], plan.schema).changes;
      assert.equal(script, sqlScript(plan.steps.flatMap((s) => s.statements)));
      await db.exec(schemaStatements(base).join("\n"));
      await db.exec(`INSERT INTO "A" VALUES ('Alice',10),('Bob',20);`);
      await db.exec(script);
      const rows = (
        await db.query<{ value: string | null }>(
          `SELECT "new"::text AS value FROM "A" ORDER BY name`,
        )
      ).rows;
      assert.deepEqual(
        rows.map((r) => r.value),
        expected,
      );
    } finally {
      await db.close();
    }
  }
});
test("typed parameters reject invalid integers, out-of-range values, wrong types, and missing source fields", () => {
  for (const value of ["1.5", "not a number", "9223372036854775808"])
    assert.throws(() =>
      compilePlan(base, [
        attr(
          { template: "constant", value: { type: "integer", value } },
          "integer",
        ),
      ]),
    );
  assert.throws(
    () =>
      compilePlan(base, [
        attr(
          { template: "constant", value: { type: "text", value: "10" } },
          "integer",
        ),
      ]),
    /type/,
  );
  assert.throws(
    () =>
      compilePlan(base, [attr({ template: "copy", source_column: "missing" })]),
    /no longer exists/,
  );
  assert.throws(
    () => compilePlan(base, [attr({ template: "copy", source_column: "n" })]),
    /same type/,
  );
});
async function seeded() {
  const store = createMemoryStore(),
    useCase = await createUseCase(store),
    before = await store.snapshot(useCase.id);
  const table: Table = {
    id: "A",
    caseId: useCase.id,
    name: "A",
    fileName: "",
    bytes: 0,
    rowCount: 0,
    primaryKey: [],
    columns: base.tables[0].columns.map((c, index) => ({
      id: c.id,
      name: c.name,
      index,
      dataType: c.dataType,
      nullable: c.nullable,
    })),
  };
  const writer = store.stage(table);
  await writer.append([
    ["Alice", "10"],
    ["Bob", "20"],
  ]);
  const stored = await writer.finish(table);
  await publishImport(store, before, [stored]);
  return { store, useCase };
}
test("pending draft cannot read or commit; configuring parameters recomputes from original data and exports the composed migration", async () => {
  const { store, useCase } = await seeded(),
    engine = createPostgresEngine(),
    session = new EditSession(
      useCase.id,
      createEditActions(store, engine),
      () => {},
    );
  try {
    const pending = await session.append([attr({ template: "extension" })]);
    assert.equal(pending.pendingParameters?.length, 1);
    assert.equal(pending.dataValidation, undefined);
    const step = planSteps(pending)[0];
    assert.equal(step.selected, undefined);
    assert.deepEqual(
      step.options.filter((o) => o.enabled).map((o) => o.method),
      ["delta"],
    );
    assert.doesNotMatch(step.explanation, /NULL/);
    await assert.rejects(session.commit(), /parameters/);
    await assert.rejects(session.readRows("A", 0), /parameters/);
    const stillPending = await session.configureAttribute(0, {
      template: "constant",
    });
    assert.equal(stillPending.pendingParameters?.length, 1);
    const configured = await session.configureAttribute(0, {
      template: "constant",
      value: { type: "text", value: "ready" },
    });
    assert.equal(configured.pendingParameters, undefined);
    assert.equal(configured.dataValidation, undefined);
    assert.deepEqual(await session.readRows("A", 0), [
      ["Alice", "10", "ready"],
      ["Bob", "20", "ready"],
    ]);
    await session.configureAttribute(0, {
      template: "copy",
      source_column: "name",
    });
    assert.deepEqual(await session.readRows("A", 0), [
      ["Alice", "10", "Alice"],
      ["Bob", "20", "Bob"],
    ]);
    await session.append([
      {
        op: "rename_column",
        table_id: "A",
        column_id: "new",
        new_name: "copied_name",
        method: "delta",
      },
    ]);
    await session.commit();
    const saved = await store.snapshot(useCase.id);
    assert.deepEqual(await store.readRows(saved.tables[0], 0), [
      ["Alice", "10", "Alice"],
      ["Bob", "20", "Bob"],
    ]);
    const exported = await exportSql(store, engine, useCase.id);
    assert.match(exported.migration!, /SET "new" = s\."name"/);
    assert.match(exported.migration!, /RENAME COLUMN "new" TO "copied_name"/);
  } finally {
    session.dispose();
    await store.close();
  }
});
test("Force cannot publish unresolved parameters or destroy retained source data", async () => {
  const { store, useCase } = await seeded();
  try {
    const candidate = await prepareEdit(
      store,
      createPostgresEngine(),
      useCase.id,
      [attr({ template: "extension" })],
      () => {},
      undefined,
      true,
    );
    assert.equal(candidate.pendingParameters?.length, 1);
    await assert.rejects(applyEdit(store, candidate), /parameters/);
    await store.discard(candidate.tables);
    const original = await store.snapshot(useCase.id);
    assert.deepEqual(await store.readRows(original.tables[0], 0), [
      ["Alice", "10"],
      ["Bob", "20"],
    ]);
  } finally {
    await store.close();
  }
});
