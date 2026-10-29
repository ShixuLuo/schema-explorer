import type { Table } from "../model/schema.ts";
import test from "node:test";
import assert from "node:assert/strict";
import type { SchemaSpec } from "../model/operations.ts";
import { translateCommand } from "../model/database-commands.ts";
import { databasePresentation } from "../model/database-presentation.ts";
import { replaceArrowOperations } from "../application/replace-arrow.ts";
import {
  humanActionOperations,
  validateAiAction,
  type AiEditorAction,
} from "./ai-capabilities.ts";
import {
  acceptancePlan,
  acceptPlanned,
  addActionRound,
  rejectAction,
  type ActionReview,
} from "./ai-action-review.ts";
const base: SchemaSpec = {
  tables: [
    {
      id: "c",
      name: "Customer",
      primaryKey: ["cid"],
      columns: [
        {
          id: "cid",
          name: "customer_id",
          dataType: "text",
          nullable: false,
          storage: "identity",
        },
        {
          id: "email",
          name: "email_address",
          dataType: "text",
          nullable: true,
        },
      ],
    },
    {
      id: "o",
      name: "Order",
      primaryKey: ["oid"],
      columns: [
        {
          id: "oid",
          name: "order_id",
          dataType: "text",
          nullable: false,
          storage: "identity",
        },
        {
          id: "carrier",
          name: "customer_id",
          dataType: "text",
          nullable: true,
        },
      ],
    },
  ],
  foreign_keys: [],
};
const link: AiEditorAction = {
    kind: "edit_arrow",
    arrowId: "attribute:carrier",
    sourceId: "o",
    targetId: "c",
    name: "customer",
    choice: { targetColumns: ["cid"], sourceColumns: [] },
  },
  rename: AiEditorAction = {
    kind: "edit_arrow",
    arrowId: "attribute:email",
    sourceId: "c",
    targetId: "type:text",
    name: "email",
    choice: { targetColumns: [], sourceColumns: [] },
  };
test("AI compiles exactly the same native edit-arrow operations as the human target editor", () => {
  let a = 0,
    b = 0;
  const actual = humanActionOperations(link, base, () => `id${++a}`),
    manual = replaceArrowOperations(
      base,
      link.arrowId,
      link.sourceId,
      link.targetId,
      link.name,
      link.choice,
      () => `id${++b}`,
    ).operations;
  assert.deepEqual(actual, manual);
  const after = actual.reduce((s, op) => translateCommand(s, op).after, base),
    presentation = databasePresentation(after);
  assert.ok(!presentation.arrows.some((a) => a.id === "attribute:carrier"));
  assert.equal(presentation.arrows.filter((a) => a.source === "o").length, 1);
  assert.ok(after.tables[1].columns.some((c) => c.storage === "reference"));
  assert.ok(
    !presentation.arrows.some(
      (a) => a.id === "attribute:cid" || a.id === "attribute:oid",
    ),
  );
});
test("AI cannot bypass human arrow roles or use arbitrary command metadata", () => {
  assert.throws(() =>
    validateAiAction({ ...link, arrowId: "attribute:cid" }, base),
  );
  assert.throws(() =>
    validateAiAction(
      { ...link, choice: { ...link.choice, method: "sigma" } },
      base,
    ),
  );
  assert.deepEqual(
    humanActionOperations(rename, base),
    replaceArrowOperations(
      base,
      rename.arrowId,
      rename.sourceId,
      rename.targetId,
      rename.name,
      rename.choice,
    ).operations,
  );
});
test("dependency groups plan atomically, preserve pending across rounds, and reject dependents without executing", () => {
  const review: ActionReview = {
    round: 1,
    suggestions: [
      {
        id: "a",
        title: "Rename",
        dependsOn: [],
        actions: [rename],
        status: "pending",
      },
      {
        id: "b",
        title: "Link",
        dependsOn: ["a"],
        actions: [link],
        status: "pending",
      },
    ],
  };
  assert.deepEqual(
    acceptancePlan(review, "b").map((s) => s.id),
    ["a", "b"],
  );
  assert.ok(review.suggestions.every((s) => s.status === "pending"));
  const accepted = acceptPlanned(review, ["a"]);
  const next = addActionRound(accepted, [
    {
      id: "c",
      title: "Later",
      dependsOn: [],
      actions: [{ ...rename, name: "contact" }],
    },
  ]);
  assert.equal(next.suggestions.find((s) => s.id === "b")?.status, "pending");
  assert.equal(next.suggestions.find((s) => s.id === "a")?.status, "accepted");
  assert.ok(
    rejectAction(review, "a").suggestions.every((s) => s.status === "rejected"),
  );
});

test("expanded catalogue uses the extracted manual command builders without model-assigned IDs", async () => {
  const H = await import("../application/human-commands.ts");
  const eq = {
    id: "eq",
    left: { source: "c", arrows: ["attribute:email"] },
    right: { source: "c", arrows: ["attribute:email"] },
  };
  const schema = { ...base, equations: [eq] };
  const commands: AiEditorAction[] = [
    { kind: "create_object", name: "Product", keyName: "product_id" },
    { kind: "rename_object", objectId: "o", name: "Purchase" },
    { kind: "delete_object", objectId: "o" },
    {
      kind: "rename_primary_key",
      objectId: "c",
      columnId: "cid",
      name: "customer_key",
    },
    {
      kind: "create_arrow",
      sourceId: "c",
      targetId: "type:text",
      name: "note",
      choice: { targetColumns: [], sourceColumns: [] },
    },
    { kind: "rename_arrow", arrowId: "attribute:email", name: "email" },
    { kind: "delete_arrow", arrowId: "attribute:email" },
    { kind: "add_equation", left: eq.left, right: eq.right },
    { kind: "edit_equation", equationId: "eq", left: eq.left, right: eq.right },
    { kind: "drop_equation", equationId: "eq" },
  ];
  for (const command of commands) {
    let a = 0,
      b = 0;
    assert.deepEqual(
      humanActionOperations(command, schema, () => `new${++a}`),
      H.humanCommandOperations(schema, command, () => `new${++b}`),
      command.kind,
    );
  }
  assert.throws(() =>
    validateAiAction(
      { kind: "create_object", name: "Unsafe", keyName: "id", objectId: "c" },
      schema,
    ),
  );
  assert.throws(() =>
    validateAiAction(
      {
        kind: "create_arrow",
        sourceId: "new-object-not-yet-created",
        targetId: "type:text",
        name: "field",
        choice: { targetColumns: [], sourceColumns: [] },
      },
      schema,
    ),
  );
  assert.throws(() =>
    validateAiAction(
      {
        kind: "rename_primary_key",
        objectId: "c",
        columnId: "email",
        name: "key",
      },
      schema,
    ),
  );
});

test("reference-label coupling and short labels match the human controls", async () => {
  const H = await import("../application/human-commands.ts");
  const schema = {
    ...base,
    foreign_keys: [
      {
        id: "fk",
        name: "customer",
        source_table: "o",
        source_columns: ["carrier"],
        target_table: "c",
        target_columns: ["cid"],
      },
    ],
  };
  assert.deepEqual(H.renameArrowOperations(schema, "reference:fk", "buyer"), [
    {
      op: "rename_column",
      table_id: "o",
      column_id: "carrier",
      new_name: "buyer",
    },
    { op: "rename_arrow", table_id: "o", arrow_id: "fk", new_name: "buyer" },
  ]);
  assert.equal(
    H.humanCommandGroupLabel(base, [rename]),
    "Rename email_address → email",
  );
  assert.equal(H.humanCommandGroupLabel(base, [link]), "Link Order → Customer");
  assert.equal(
    H.humanCommandGroupLabel(base, [
      { kind: "delete_object", objectId: "c" },
      rename,
    ]),
    "Delete Customer · Rename email_address → email",
  );
});

test("client-created object IDs remain distinct and native store rejects cross-case ownership overwrite", async () => {
  const { createMemoryStore } = await import("../adapters/memory-store.ts");
  const { createUseCase } = await import("../application/workspaces.ts");
  const store = createMemoryStore();
  const cases = [await createUseCase(store), await createUseCase(store)];
  const empty: SchemaSpec = { tables: [], foreign_keys: [] };
  const created: Table[] = [];
  for (let i = 0; i < 2; i++) {
    let id = 0;
    const op = humanActionOperations(
      { kind: "create_object", name: "Object", keyName: "_id" },
      empty,
      () => `case${i}-${++id}`,
    )[0];
    assert.equal(op.op, "create_table");
    if (op.op !== "create_table") throw Error("expected create_table");
    const t = {
      ...op.table,
      caseId: cases[i].id,
      fileName: "",
      bytes: 0,
      rowCount: 0,
      columns: op.table.columns.map((c, index) => ({ ...c, index })),
    };
    created.push(t);
    await store.commit(cases[i].id, 0, {
      kind: "checkpoint",
      state: { tables: [t], relationships: [], equations: [] },
      operations: [op],
      description: "Create Object",
    });
  }
  assert.notEqual(created[0].id, created[1].id);
  await assert.rejects(() =>
    store.commit(cases[1].id, 1, {
      kind: "checkpoint",
      state: {
        tables: [{ ...created[0], caseId: cases[1].id }],
        relationships: [],
        equations: [],
      },
      operations: [],
      description: "Invalid overwrite",
    }),
  );
  assert.equal((await store.snapshot(cases[0].id)).tables[0].id, created[0].id);
});

test("ordered shared-command simulation rejects an action invalidated by an earlier group", async () => {
  const { validateAiActionGroups } = await import("./ai-capabilities.ts");
  const groups = [
    { id: "rename", dependsOn: ["drop"], actions: [rename] },
    {
      id: "drop",
      dependsOn: [],
      actions: [{ kind: "delete_object" as const, objectId: "c" }],
    },
  ];
  assert.throws(() => validateAiActionGroups(groups, base));
  const ordered = validateAiActionGroups(
    [
      { id: "b", dependsOn: ["a"], actions: [{ ...rename, name: "contact" }] },
      { id: "a", dependsOn: [], actions: [rename] },
    ],
    base,
  );
  assert.deepEqual(
    ordered.map((g) => g.id),
    ["a", "b"],
  );
  assert.equal(base.tables[0].columns[1].name, "email_address");
});
test("AI source and target choices cannot exceed the shared human dropdown roles", () => {
  assert.throws(() =>
    validateAiAction(
      {
        kind: "create_arrow",
        sourceId: "o",
        targetId: "c",
        name: "identity-link",
        choice: { targetColumns: ["cid"], sourceColumns: ["oid"] },
      },
      base,
    ),
  );
  assert.throws(() =>
    validateAiAction(
      {
        kind: "create_arrow",
        sourceId: "o",
        targetId: "c",
        name: "guess-key",
        choice: { targetColumns: ["email"], sourceColumns: ["carrier"] },
      },
      base,
    ),
  );
});
