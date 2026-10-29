import test from "node:test";
import assert from "node:assert/strict";
import {
  checkpointPath,
  defaultCheckpointRange,
  liveCheckpointId,
  checkpointLabel,
} from "./history.ts";
import { layoutHistory } from "../schema/history-graph.ts";
import type { CheckpointInfo } from "./workspace.ts";
const points: CheckpointInfo[] = [
  { id: "a", name: "Import", createdAt: 300, parentId: null },
  { id: "b", name: "Rename", createdAt: 100, parentId: "a" },
  { id: "c", name: "Add field", createdAt: 200, parentId: "a" },
  { id: "d", name: "Another design", createdAt: 400, parentId: "a" },
];
test("history follows recorded parents rather than clocks or route names", () => {
  assert.deepEqual(
    checkpointPath(points, { from: null, to: "b" })?.map((c) => c.id),
    ["a", "b"],
  );
  assert.deepEqual(
    checkpointPath(points, { from: "a", to: "d" })?.map((c) => c.id),
    ["d"],
  );
  assert.equal(checkpointPath(points, { from: "b", to: "d" }), null);
  assert.deepEqual(defaultCheckpointRange(points, "c"), { from: "a", to: "c" });
});
test("missing lineage and cycles never produce a guessed migration", () => {
  const old = { id: "old", name: "Old", createdAt: 0 };
  assert.equal(
    checkpointPath([...points, old], { from: "a", to: "old" }),
    null,
  );
  assert.equal(checkpointPath(points, { from: null, to: "missing" }), null);
  assert.equal(
    checkpointPath([{ ...points[0], parentId: "b" }, points[1]], {
      from: null,
      to: "b",
    }),
    null,
  );
});
test("the timeline contains only checkpoints and their actual parent links", () => {
  const graph = layoutHistory({ editing: "d", checkpoints: points });
  assert.equal(graph.nodes.length, points.length);
  assert.deepEqual(
    graph.edges.map((e) => [e.source, e.target]),
    [
      ["a", "b"],
      ["a", "c"],
      ["a", "d"],
    ],
  );
  for (const a of graph.nodes)
    for (const b of graph.nodes)
      if (a.id !== b.id)
        assert.ok(
          a.position.x + 260 <= b.position.x ||
            b.position.x + 260 <= a.position.x ||
            a.position.y + a.height <= b.position.y ||
            b.position.y + b.height <= a.position.y,
        );
  assert.deepEqual(layoutHistory({ editing: "a", checkpoints: points }), graph);
});
test("an empty model has no invented versions or named workspace nodes", () => {
  assert.deepEqual(layoutHistory({ editing: null, checkpoints: [] }), {
    nodes: [],
    edges: [],
  });
});
test("unrecorded legacy parents stay disconnected", () => {
  const graph = layoutHistory({
    editing: "two",
    checkpoints: [
      { id: "one", name: "First", createdAt: 1 },
      { id: "two", name: "Second", createdAt: 2 },
    ],
  });
  assert.equal(graph.edges.length, 0);
  assert.equal(graph.nodes.length, 2);
});
test("Live is an ordinary tag and the default export origin", () => {
  const tag = (id: string) =>
    points.map((c) => ({ ...c, tags: c.id === id ? ["Live"] : [] }));
  assert.equal(liveCheckpointId(tag("a")), "a");
  assert.deepEqual(defaultCheckpointRange(tag("a"), "b"), {
    from: "a",
    to: "b",
  });
  assert.deepEqual(defaultCheckpointRange(tag("c"), "b"), {
    from: "c",
    to: "b",
  });
  assert.deepEqual(defaultCheckpointRange(tag("b"), "b"), {
    from: "b",
    to: "b",
  });
});
test("export labels use the version's change, tags and time without route labels", () => {
  const label = checkpointLabel(points, "b", { editingId: "b" });
  assert.ok(label.includes("Rename [Editing]"));
  assert.ok(!label.includes("Main"));
  assert.ok(!label.includes("#2"));
});
