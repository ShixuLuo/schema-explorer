import assert from "node:assert/strict";
import test from "node:test";
import { compareModels, type ModelView } from "../model/comparison.ts";
import { databasePresentation } from "../model/database-presentation.ts";
import { schemaSpec } from "../model/wire.ts";
import {
  categoryComparison,
  reducedCategory,
} from "./category-presentation.ts";
const column = (id: string) => ({
  id,
  name: id,
  index: 0,
  dataType: "text" as const,
  nullable: false,
});
const source = {
  id: "products",
  name: "products",
  rowCount: 2,
  columns: [column("category_id")],
};
const target = {
  id: "categories",
  name: "categories",
  rowCount: 2,
  columns: [column("id")],
  primaryKey: ["id"],
};
const fk = {
  id: "f",
  name: "category_id",
  source_table: source.id,
  source_columns: ["category_id"],
  target_table: target.id,
  target_columns: ["id"],
};
const before: ModelView = { tables: [source, target], relationships: [] },
  after: ModelView = { ...before, relationships: [fk] };
test("reference conversion replaces the scalar generator, preserves its binding, and rewrites user paths", () => {
  const schema = schemaSpec(after.tables, after.relationships, [
    {
      id: "user",
      left: { source: "products", arrows: ["attribute:category_id"] },
      right: { source: "products", arrows: ["reference:f", "attribute:id"] },
    },
  ]);
  const p = reducedCategory(databasePresentation(schema));
  assert.ok(!p.arrows.some((a) => a.id === "attribute:category_id"));
  assert.ok(p.arrows.some((a) => a.id === "reference:f"));
  assert.deepEqual(p.equations.find((e) => e.id === "user")?.left.arrows, [
    "reference:f",
    "attribute:id",
  ]);
  assert.equal(schema.tables[0].columns[0].id, "category_id");
});
test("Adding a reference preserves an explicitly reused business attribute in every view", () => {
  const comparison = compareModels(before, after);
  for (const mode of ["before", "after", "changes"] as const)
    assert.ok(
      categoryComparison(after, comparison, mode).arrows.some(
        (a) => a.id === "attribute:category_id",
      ),
    );
  assert.equal(
    categoryComparison(after, comparison, "changes").arrowChanges["reference:f"]
      .kind,
    "added",
  );
  assert.equal(
    categoryComparison(after, comparison, "changes").arrowChanges[
      "attribute:category_id"
    ],
    undefined,
  );
});
test("recursive carrier definitions preserve generators instead of erasing cyclic constraints", () => {
  const p = databasePresentation(
    schemaSpec(
      [target],
      [
        {
          ...fk,
          source_table: "categories",
          source_columns: ["id"],
          target_table: "categories",
          target_columns: ["id"],
        },
      ],
    ),
  );
  const reduced = reducedCategory(p);
  assert.ok(reduced.arrows.some((a) => a.id === "attribute:id"));
  assert.equal(reduced.equations.length, 1);
});
test("a shared carrier retains the equation between the two references", () => {
  const p = reducedCategory(
    databasePresentation(
      schemaSpec(after.tables, [fk, { ...fk, id: "g", name: "other" }]),
    ),
  );
  assert.ok(!p.arrows.some((a) => a.id === "attribute:category_id"));
  assert.deepEqual(p.equations[0].left.arrows, ["reference:f", "attribute:id"]);
  assert.deepEqual(p.equations[0].right.arrows, [
    "reference:g",
    "attribute:id",
  ]);
});
