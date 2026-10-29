import test from "node:test";
import assert from "node:assert/strict";
import { categoryProjection, categoryLayout } from "./category-graph.ts";
import type { Presentation } from "../model/presentation.ts";
const p: Presentation = {
  objects: [
    { id: "A", label: "A", kind: "entity" },
    { id: "B", label: "B", kind: "entity" },
    { id: "C", label: "C", kind: "entity" },
    { id: "Text", label: "Text", kind: "type" },
  ],
  arrows: [
    { id: "f", label: "f", source: "A", target: "B" },
    { id: "g", label: "g", source: "B", target: "C" },
    { id: "h", label: "h", source: "A", target: "C" },
    { id: "name", label: "name", source: "A", target: "Text" },
  ],
  equations: [
    {
      id: "e",
      left: { source: "A", arrows: ["h"] },
      right: { source: "A", arrows: ["f", "g"] },
    },
  ],
};
test("category projection shows every attribute and reveals only referenced types", () => {
  const visible = categoryProjection(p);
  assert.deepEqual(
    visible.objects.map((o) => o.id),
    ["A", "B", "C", "Text"],
  );
  assert.deepEqual(
    visible.arrows.map((a) => a.id),
    ["f", "g", "h", "name"],
  );
  const empty: Presentation = { objects: p.objects, arrows: [], equations: [] };
  assert.deepEqual(
    categoryProjection(empty).objects.map((o) => o.id),
    ["A", "B", "C"],
  );
  assert.ok(empty.objects.some((o) => o.id === "Text"));
});
test("equation focus retains and distinguishes the two composed paths", () => {
  const result = categoryProjection(p, "e");
  assert.deepEqual([...result.left], ["h"]);
  assert.deepEqual([...result.right], ["f", "g"]);
  assert.deepEqual([...result.highlighted].sort(), ["A", "B", "C"]);
  assert.equal(result.equation?.id, "e");
});
test("category layout is finite for loops and does not modify the model", () => {
  const source = structuredClone(p);
  source.arrows.push({ id: "loop", label: "loop", source: "C", target: "A" });
  const before = structuredClone(source),
    view = categoryProjection(source),
    layout = categoryLayout(view);
  for (const position of Object.values(layout.positions))
    assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y));
  for (const route of Object.values(layout.routes))
    assert.ok(route.length >= 2);
  assert.deepEqual(source, before);
});
