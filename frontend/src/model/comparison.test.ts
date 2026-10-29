import assert from "node:assert/strict";
import test from "node:test";
import { compareModels, comparisonView, modelView } from "./comparison.ts";
import type { Column, ForeignKeySpec, Table } from "./schema.ts";

function column(id: string, name = id): Column {
  return {
    id,
    name,
    index: 0,
    dataType: "text",
    nullable: false,
  };
}
function table(id: string, columns: Column[] = [column(`${id}:id`)]): Table {
  return {
    id,
    name: id,
    caseId: "case",
    fileName: "private.csv",
    bytes: 20,
    dataId: `private-${id}`,
    dataBytes: 10,
    rowCount: 2,
    columns: columns.map((c, index) => ({ ...c, index })),
    primaryKey: [],
  };
}
function relation(): ForeignKeySpec {
  return {
    id: "fk",
    source_table: "child",
    source_columns: ["child:id"],
    target_table: "parent",
    target_columns: ["parent:id"],
  };
}
test("model views omit storage fields and detach mutable metadata", () => {
  const source = table("a"),
    view = modelView([source], []);
  assert.deepEqual(Object.keys(view.tables[0]).sort(), [
    "columns",
    "id",
    "name",
    "primaryKey",
    "rowCount",
  ]);
  view.tables[0].name = "changed";
  view.tables[0].columns[0].name = "changed";
  view.tables[0].primaryKey!.push("x");
  assert.equal(source.name, "a");
  assert.equal(source.columns[0].name, "a:id");
  assert.deepEqual(source.primaryKey, []);
  const comparison = compareModels(
    { tables: [source], relationships: [] },
    { tables: [source], relationships: [] },
  );
  assert.ok(!("dataId" in comparison.before.tables[0]));
  source.name = "later source change";
  assert.equal(comparison.before.tables[0].name, "a");
});
test("stable IDs distinguish renames from delete/add and ignore profiling changes", () => {
  const before = table("a", [column("keep"), column("remove")]);
  const after = table("a", [{ ...column("keep", "new name") }, column("new")]);
  after.name = "renamed";
  const diff = compareModels(modelView([before], []), modelView([after], []));
  assert.deepEqual(diff.changes.tables.a, {
    kind: "changed",
    previousName: "a",
  });
  assert.deepEqual(diff.changes.columns.keep, {
    kind: "changed",
    previousName: "keep",
  });
  assert.equal(diff.changes.columns.remove.kind, "removed");
  assert.equal(diff.changes.columns.new.kind, "added");
  const profiled = structuredClone(before);
  Object.assign(profiled.columns[0], { distinctCount: 123 });
  Object.assign(profiled.columns[0], { integerFailures: 2 });
  assert.deepEqual(
    compareModels(modelView([before], []), modelView([profiled], [])).changes,
    { tables: {}, columns: {}, relationships: {}, equations: {} },
  );
});
test("primary key membership and ordering are visible without marking unrelated fields", () => {
  const before = table("a", [column("x"), column("y"), column("z")]);
  before.primaryKey = ["x", "y"];
  const after = structuredClone(before);
  after.primaryKey = ["y", "x"];
  const diff = compareModels(modelView([before], []), modelView([after], []));
  assert.equal(diff.changes.columns.x.kind, "changed");
  assert.equal(diff.changes.columns.y.kind, "changed");
  assert.equal(diff.changes.columns.z, undefined);
});
test("changes view retains deleted rows in context while before/after are exact", () => {
  const before = modelView(
    [table("a", [column("x"), column("y"), column("z")])],
    [],
  );
  const after = modelView(
    [table("a", [column("x"), column("z"), column("new")])],
    [],
  );
  const diff = compareModels(before, after);
  assert.deepEqual(
    comparisonView(diff, "changes").tables[0].columns.map((c) => c.id),
    ["x", "y", "z", "new"],
  );
  assert.deepEqual(
    comparisonView(diff, "after").tables[0].columns.map((c) => c.id),
    ["x", "z", "new"],
  );
  assert.equal(diff.changes.columns.z, undefined);
  assert.deepEqual(comparisonView(diff, "before"), before);
  assert.deepEqual(
    before.tables[0].columns.map((c) => c.id),
    ["x", "y", "z"],
  );
});
test("removed tables and their relationships stay traceable only in changes/before", () => {
  const before = modelView([table("parent"), table("child")], [relation()]);
  const after = modelView([table("child")], []),
    diff = compareModels(before, after);
  assert.equal(diff.changes.tables.parent.kind, "removed");
  assert.equal(diff.changes.columns["parent:id"].kind, "removed");
  assert.equal(diff.changes.relationships.fk.kind, "removed");
  assert.equal(comparisonView(diff, "changes").relationships.length, 1);
  assert.equal(comparisonView(diff, "after").relationships.length, 0);
});
test("new tables and composite relationship mappings are compared as model entities", () => {
  const parent = table("parent", [column("parent:id"), column("parent:other")]);
  parent.primaryKey = ["parent:id", "parent:other"];
  const child = table("child", [column("child:id"), column("child:other")]);
  const old = {
    ...relation(),
    source_table: "child",
    source_columns: ["child:id", "child:other"],
    target_table: "parent",
    target_columns: ["parent:id", "parent:other"],
  };
  const next = structuredClone(old);
  next.source_columns = ["child:other", "child:id"];
  const diff = compareModels(
    modelView([parent, child], [old]),
    modelView([parent, child, table("new")], [next]),
  );
  assert.equal(diff.changes.relationships.fk.kind, "changed");
  assert.equal(diff.changes.tables.new.kind, "added");
  assert.equal(diff.changes.columns["new:id"].kind, "added");
});
test("an empty resulting model is distinct from an empty comparison", () => {
  const diff = compareModels(modelView([table("a")], []), modelView([], []));
  assert.equal(comparisonView(diff, "changes").tables.length, 1);
  assert.equal(comparisonView(diff, "after").tables.length, 0);
  assert.deepEqual(
    compareModels(modelView([], []), modelView([], [])).changes,
    { tables: {}, columns: {}, relationships: {}, equations: {} },
  );
});
