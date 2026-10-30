import test from "node:test";
import assert from "node:assert/strict";
import type { SchemaSpec } from "../model/operations.ts";
import { translateCommand } from "../model/database-commands.ts";
import { databasePresentation } from "../model/database-presentation.ts";
import { pendingPreviewPlan } from "./ai-default-preview.ts";
import {
  acceptPlanned,
  rejectAction,
  type ActionReview,
} from "./ai-action-review.ts";
import { suggestionDirections } from "./ai-directions.ts";
const base: SchemaSpec = {
  tables: [
    {
      id: "c",
      name: "Customer",
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
      primaryKey: ["cid"],
    },
    {
      id: "o",
      name: "Order",
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
        {
          id: "total",
          name: "customer_total",
          dataType: "text",
          nullable: true,
        },
      ],
      primaryKey: ["oid"],
    },
  ],
  foreign_keys: [],
};
const review = (): ActionReview => ({
  round: 1,
  suggestions: [
    {
      id: "rename",
      title: "untrusted long title",
      dependsOn: [],
      actions: [
        {
          kind: "edit_arrow",
          arrowId: "attribute:email",
          sourceId: "c",
          targetId: "type:text",
          name: "email",
        },
      ],
      status: "pending",
    },
    {
      id: "link",
      title: "Link",
      dependsOn: [],
      actions: [
        {
          kind: "edit_arrow",
          arrowId: "attribute:carrier",
          sourceId: "o",
          targetId: "c",
          name: "customer",
        },
      ],
      status: "pending",
    },
  ],
});
test("default preview compiles every compatible pending group through native builders without selecting or accepting", () => {
  let n = 0;
  const state = review(),
    plan = pendingPreviewPlan(state, base, () => `new${++n}`);
  assert.deepEqual(plan.groupIds, ["rename", "link"]);
  const after = plan.operations.reduce(
    (s, o) => translateCommand(s, o).after,
    base,
  );
  assert.equal(
    after.tables[0].columns.find((c) => c.id === "email")?.name,
    "email",
  );
  assert.equal(after.foreign_keys.length, 1);
  assert.equal(
    databasePresentation(after).arrows.filter(
      (a) => a.source === "o" && a.target === "c",
    ).length,
    1,
  );
  assert.ok(
    !databasePresentation(after).arrows.some(
      (a) => a.id === "attribute:carrier",
    ),
  );
  assert.ok(state.suggestions.every((s) => s.status === "pending"));
  assert.equal(base.foreign_keys.length, 0);
  assert.deepEqual(plan.focus.rename, { arrowId: "attribute:email" });
  assert.ok(plan.focus.link.arrowId?.startsWith("reference:"));
});
test("accept and reject separate real working actions from remaining all-preview actions", () => {
  const start = review(),
    all = pendingPreviewPlan(start, base);
  const acceptedSchema = all.groupOperations.rename.reduce(
    (s, o) => translateCommand(s, o).after,
    base,
  );
  const accepted = acceptPlanned(start, ["rename"]),
    remaining = pendingPreviewPlan(accepted, acceptedSchema);
  assert.deepEqual(remaining.groupIds, ["link"]);
  assert.ok(!remaining.operations.some((o) => o.op === "rename_column"));
  const rejected = rejectAction(accepted, "link");
  assert.equal(
    pendingPreviewPlan(rejected, acceptedSchema).operations.length,
    0,
  );
  assert.equal(acceptedSchema.tables[0].columns[1].name, "email");
});
test("stale groups, conflicts and rejected dependencies never leave a partial operation group", () => {
  const state = review();
  const first = state.suggestions[0].actions[0];
  if (first.kind !== "edit_arrow") throw Error("expected edit arrow");
  state.suggestions.push({
    ...state.suggestions[0],
    id: "conflict",
    actions: [{ ...first, name: "contact" }],
  });
  const plan = pendingPreviewPlan(state, base);
  assert.ok(plan.skippedIds.includes("conflict"));
  state.suggestions[1].dependsOn = ["rename"];
  state.suggestions[1].status = "stale";
  assert.ok(
    rejectAction(state, "rename")
      .suggestions.filter((s) => s.id === "rename" || s.id === "link")
      .every((s) => s.status === "rejected"),
  );
  const broken = review();
  broken.suggestions[0].actions.push({
    kind: "delete_object",
    objectId: "missing",
  });
  const invalid = pendingPreviewPlan(broken, base);
  assert.ok(invalid.skippedIds.includes("rename"));
  assert.equal(invalid.groupOperations.rename, undefined);
  assert.equal(base.tables[0].columns[1].name, "email_address");
});
test("guidance directions are small local schema hints, never model calls or data inference", () => {
  const hints = suggestionDirections(base);
  assert.deepEqual(
    hints.map((h) => h.label),
    ["Check names", "Check types", "Review references", "Simplify structure"],
  );
  assert.ok(hints.every((h) => h.guidance.length < 80));
  assert.deepEqual(suggestionDirections({ tables: [], foreign_keys: [] }), []);
});
