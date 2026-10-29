import assert from "node:assert/strict";
import test from "node:test";
import { fieldArrowOperations } from "../application/foreign-key-plan.ts";
import type { ViewTable } from "../model/comparison.ts";
import { endpoint, type Presentation } from "../model/presentation.ts";
import {
  relationCandidates,
  selectedPath,
} from "../model/relation-selection.ts";
import { schemaSpec } from "../model/wire.ts";
const p: Presentation = {
  objects: ["A", "B", "C", "D"].map((id) => ({
    id,
    label: id,
    kind: "entity",
  })),
  arrows: [
    { id: "f", label: "f", source: "A", target: "B" },
    { id: "g", label: "g", source: "B", target: "C" },
    { id: "h", label: "h", source: "A", target: "C" },
    { id: "j", label: "j", source: "C", target: "D" },
    { id: "parallel", label: "parallel", source: "A", target: "B" },
  ],
  equations: [],
};
test("paths preserve order and repeated arrow occurrences", () => {
  const loop: Presentation = {
    objects: [{ id: "A", label: "A", kind: "entity" }],
    arrows: [{ id: "m", label: "manager", source: "A", target: "A" }],
    equations: [],
  };
  assert.deepEqual(selectedPath(loop, ["m", "m"]), {
    source: "A",
    arrows: ["m", "m"],
  });
  assert.throws(() => selectedPath(p, ["g", "f"]), /compose/);
  const choices = relationCandidates(loop, ["m", "m", "m"]);
  assert.ok(
    choices.some(
      (c) =>
        [c.left.arrows.length, c.right.arrows.length].sort().join(",") ===
        "1,2",
    ),
  );
  assert.equal(choices.length, 2);
});
test("one selection infers parallel paths regardless of click order and checks only on confirmation", () => {
  for (const ids of [
    ["f", "parallel"],
    ["g", "h", "f"],
    ["j", "g", "h", "f", "j"],
  ]) {
    const choices = relationCandidates(p, ids);
    assert.equal(choices.length, 1);
    const c = choices[0];
    assert.equal(c.left.source, c.right.source);
    assert.equal(endpoint(p, c.left), endpoint(p, c.right));
    assert.deepEqual(
      [...c.left.arrows, ...c.right.arrows].sort(),
      [...ids].sort(),
    );
  }
  assert.throws(
    () => relationCandidates(p, ["f", "j"]),
    /same source and target/,
  );
  assert.throws(
    () => relationCandidates(p, ["f", "g"]),
    /same source and target/,
  );
});
test("a directed cycle does not silently choose its identity base", () => {
  const cycle: Presentation = {
    ...p,
    arrows: [
      { id: "f", label: "f", source: "A", target: "B" },
      { id: "back", label: "back", source: "B", target: "A" },
    ],
  };
  const choices = relationCandidates(cycle, ["back", "f"]);
  assert.equal(choices.length, 2);
  assert.deepEqual(choices.map((c) => c.left.source).sort(), ["A", "B"]);
});
const empty = (id: string): ViewTable => ({
  id,
  name: id,
  rowCount: 0,
  columns: [],
  primaryKey: [],
});
const ids = () => {
  let i = 0;
  return () => `new${++i}`;
};
test("connecting to a scalar stages an attribute without inventing an initial value", () => {
  const ops = fieldArrowOperations(
    schemaSpec([empty("People")], []),
    "People",
    "type:integer",
    "attribute",
    {},
    ids(),
  );
  assert.equal(ops[0].op, "add_attribute");
  if (ops[0].op === "add_attribute") {
    assert.equal(ops[0].column.dataType, "integer");
    assert.deepEqual(ops[0].parameters, { template: "extension" });
  }
});
test("old automatic reference creation is unavailable even for singleton targets", () => {
  const source = { ...empty("Records"), rowCount: 2 };
  for (const rowCount of [0, 1, 2])
    assert.throws(
      () =>
        fieldArrowOperations(
          schemaSpec([source, { ...empty("People"), rowCount }], []),
          "Records",
          "People",
          "person",
          {},
          ids(),
        ),
      /explicitly/,
    );
});
