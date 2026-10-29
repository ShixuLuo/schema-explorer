import test from "node:test";
import assert from "node:assert/strict";
import {
  type Presentation,
  applyEdits,
  checkedMapping,
  composeMappings,
  endpoint,
  identityMapping,
  mapPath,
  samePresentation,
} from "./presentation.ts";
import { composeMigrations, migrationEndpoints } from "./migration.ts";

const empty: Presentation = { objects: [], arrows: [], equations: [] };
const triangle = () =>
  applyEdits(empty, [
    { kind: "add_object", object: { id: "X", label: "X", kind: "entity" } },
    { kind: "add_object", object: { id: "Y", label: "Y", kind: "entity" } },
    { kind: "add_object", object: { id: "Z", label: "Z", kind: "entity" } },
    {
      kind: "add_arrow",
      arrow: { id: "f", label: "f", source: "X", target: "Y" },
    },
    {
      kind: "add_arrow",
      arrow: { id: "g", label: "g", source: "Y", target: "Z" },
    },
    {
      kind: "add_arrow",
      arrow: { id: "h", label: "h", source: "X", target: "Z" },
    },
  ]);
test("seven presentation edits work without database bindings or instances", () => {
  const initial = triangle(),
    equation = {
      id: "e",
      left: { source: "X", arrows: ["h"] },
      right: { source: "X", arrows: ["f", "g"] },
    };
  const constrained = applyEdits(initial, [
    { kind: "add_equation", equation },
    { kind: "rename", target: "object", id: "X", label: "Any label" },
  ]);
  assert.equal(endpoint(constrained, equation.right), "Z");
  assert.throws(
    () => applyEdits(constrained, [{ kind: "drop_arrow", id: "h" }]),
    /equations/,
  );
  const reduced = applyEdits(constrained, [
    { kind: "drop_equation", id: "e" },
    { kind: "drop_arrow", id: "h" },
    { kind: "drop_arrow", id: "f" },
    { kind: "drop_object", id: "X" },
  ]);
  assert.deepEqual(
    reduced.objects.map((o) => o.id),
    ["Y", "Z"],
  );
  assert.equal(initial.equations.length, 0);
});
test("mapping composition substitutes paths and preserves equation evidence", () => {
  const p = triangle(),
    q = applyEdits(p, [
      {
        kind: "add_equation",
        equation: {
          id: "e",
          left: { source: "X", arrows: ["h"] },
          right: { source: "X", arrows: ["f", "g"] },
        },
      },
    ]);
  const f = identityMapping(p, q),
    g = identityMapping(q);
  const composite = composeMappings(f, g);
  assert.deepEqual(mapPath(composite, { source: "X", arrows: ["f", "g"] }), {
    source: "X",
    arrows: ["f", "g"],
  });
  const invalid = { ...identityMapping(q), target: p, proofs: {} };
  assert.throws(() => checkedMapping(invalid), /preserves an equation/);
  assert.throws(
    () =>
      checkedMapping({
        ...f,
        arrows: { ...f.arrows, h: { source: "X", arrows: ["f"] } },
      }),
    /endpoints/,
  );
});
test("mixed migrations type-check in execution order", () => {
  const p = triangle(),
    f = identityMapping(p),
    program = composeMigrations([
      { kind: "pi", mapping: f },
      { kind: "delta", mapping: f },
      { kind: "sigma", mapping: f },
    ]);
  const [input, output] = migrationEndpoints(program);
  assert.ok(samePresentation(input, p) && samePresentation(output, p));
  assert.throws(
    () =>
      composeMigrations([
        { kind: "delta", mapping: f },
        { kind: "sigma", mapping: identityMapping(empty) },
      ]),
    /do not compose/,
  );
});
