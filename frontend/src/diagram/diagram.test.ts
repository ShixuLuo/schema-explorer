import test from "node:test";
import assert from "node:assert/strict";
import {
  arrangeTables,
  detailsAnchor,
  projectAnchor,
  initialTablePositions,
  relationPaths,
} from "./diagram.ts";
import type { Relation, Table } from "../model/schema.ts";
import {
  routeRelationships,
  type RoutingTable,
} from "./relationship-routing.ts";

function table(id: string): Table {
  return {
    id,
    caseId: "test",
    name: id,
    fileName: `${id}.csv`,
    bytes: 0,
    rowCount: 0,
    columns: [0, 1].map((index) => ({
      id: `${id}:${index}`,
      name: `field_${index}`,
      index,
      emptyCount: 0,
      distinctCount: 0,
      integerFailures: 0,
      formatChanges: 0,
    })),
  };
}
function relation(child: string, parent: string): Relation {
  return {
    id: `${child}-${parent}`,
    source: { tableId: child, columnId: `${child}:0` },
    target: { tableId: parent, columnId: `${parent}:0` },
    checked: 0,
    matched: 0,
    sourceDistinct: 0,
    cardinality: "N:1",
  };
}
function assertNoOverlap(
  tables: Table[],
  positions: ReturnType<typeof arrangeTables>,
) {
  for (let i = 0; i < tables.length; i++)
    for (let j = i + 1; j < tables.length; j++) {
      const a = positions[tables[i].id],
        b = positions[tables[j].id];
      const ah = 53 + tables[i].columns.length * 32,
        bh = 53 + tables[j].columns.length * 32;
      assert.ok(
        a.x + 280 <= b.x ||
          b.x + 280 <= a.x ||
          a.y + ah <= b.y ||
          b.y + bh <= a.y,
      );
    }
}

test("details follow pan and zoom in diagram coordinates", () => {
  const anchor = detailsAnchor(
    { x: 130, y: 90 },
    { id: "a", position: { x: 100, y: 50 } },
  );
  assert.deepEqual(
    projectAnchor(anchor, { a: { x: 100, y: 50 } }, { x: 10, y: 20, zoom: 1 }),
    { x: 140, y: 110 },
  );
  assert.deepEqual(
    projectAnchor(anchor, { a: { x: 100, y: 50 } }, { x: 90, y: -20, zoom: 2 }),
    { x: 350, y: 160 },
  );
});
test("details follow the attached table and disappear when it is removed", () => {
  const anchor = detailsAnchor(
    { x: 130, y: 90 },
    { id: "a", position: { x: 100, y: 50 } },
  );
  assert.deepEqual(
    projectAnchor(anchor, { a: { x: 150, y: 70 } }, { x: 0, y: 0, zoom: 1 }),
    { x: 180, y: 110 },
  );
  assert.equal(projectAnchor(anchor, {}, { x: 0, y: 0, zoom: 1 }), null);
});
test("edge details follow the graph viewport", () => {
  assert.deepEqual(
    projectAnchor(
      detailsAnchor({ x: 100, y: 200 }),
      {},
      { x: 20, y: 40, zoom: 0.5 },
    ),
    { x: 70, y: 140 },
  );
});
test("relationship layout handles branches without node overlap", () => {
  const tables = ["root", "left", "right", "leaf"].map(table);
  const links = [
    relation("left", "root"),
    relation("right", "root"),
    relation("leaf", "left"),
    relation("leaf", "right"),
  ];
  const original = JSON.stringify(links),
    positions = arrangeTables(tables, links);
  assert.ok(
    positions.root.x < positions.left.x && positions.left.x < positions.leaf.x,
  );
  assertNoOverlap(tables, positions);
  assert.equal(JSON.stringify(links), original);
  assert.deepEqual(arrangeTables(tables, links), positions);
});
test("cycles produce finite nonoverlapping positions", () => {
  const tables = ["a", "b", "c"].map(table),
    links = [relation("a", "b"), relation("b", "c"), relation("c", "a")];
  const positions = arrangeTables(tables, links);
  assert.ok(
    Object.values(positions).every(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    ),
  );
  assertNoOverlap(tables, positions);
});
test("independent tables are packed rather than stacked into one long column", () => {
  const tables = Array.from({ length: 12 }, (_, i) => table(`table_${i}`));
  const positions = arrangeTables(tables, [], {}, 1.6);
  assertNoOverlap(tables, positions);
  assert.ok(new Set(Object.values(positions).map((point) => point.x)).size > 1);
});
test("empty graphs and missing relation endpoints are safe", () => {
  assert.deepEqual(arrangeTables([], []), {});
  assert.equal(
    Object.keys(arrangeTables([table("a")], [relation("a", "missing")])).length,
    1,
  );
});

function routingTable(id: string, x: number, y: number): RoutingTable {
  return {
    id,
    position: { x, y },
    width: 280,
    height: 149,
    columns: [`${id}:0`, `${id}:1`, `${id}:2`],
  };
}
function verticalTracks(route: ReturnType<typeof routeRelationships>[string]) {
  return route.points.slice(1).flatMap((b, i) => {
    const a = route.points[i];
    return a.x === b.x && a.y !== b.y ? [a.x] : [];
  });
}
test("parallel relationships use separate vertical tracks", () => {
  const tables = [
    routingTable("parent", 0, 0),
    routingTable("child", 440, 180),
  ];
  const links = [
    relation("child", "parent"),
    {
      ...relation("child", "parent"),
      id: "second",
      source: { tableId: "child", columnId: "child:1" },
      target: { tableId: "parent", columnId: "parent:1" },
    },
  ];
  const routes = routeRelationships(links, tables);
  const first = verticalTracks(routes[links[0].id]),
    second = verticalTracks(routes.second);
  assert.ok(first.length && second.length);
  for (const a of first)
    for (const b of second) assert.ok(Math.abs(a - b) >= 16);
  assert.deepEqual(routeRelationships([...links].reverse(), tables), routes);
});
test("relationships sharing a field converge without sharing a vertical bus", () => {
  const tables = [
    routingTable("parent", 0, 0),
    routingTable("a", 440, 180),
    routingTable("b", 440, 380),
  ];
  const links = [relation("a", "parent"), relation("b", "parent")];
  const routes = routeRelationships(links, tables);
  assert.deepEqual(
    routes[links[0].id].points.at(-1),
    routes[links[1].id].points.at(-1),
  );
  assert.notEqual(
    verticalTracks(routes[links[0].id])[0],
    verticalTracks(routes[links[1].id])[0],
  );
});
test("opposing branches do not form a false junction at a shared field", () => {
  const tables = [
    routingTable("parent", 0, 220),
    routingTable("a", 440, 0),
    routingTable("b", 440, 440),
  ];
  const links = [relation("a", "parent"), relation("b", "parent")];
  const routes = routeRelationships(links, tables);
  for (const x of verticalTracks(routes[links[0].id]))
    for (const y of verticalTracks(routes[links[1].id]))
      assert.ok(Math.abs(x - y) >= 16);
});
test("long links bypass intermediate table bodies", () => {
  const tables = [
    routingTable("parent", 0, 0),
    routingTable("middle", 440, 0),
    routingTable("child", 880, 0),
  ];
  const link = relation("child", "parent"),
    route = routeRelationships([link], tables)[link.id];
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1],
      b = route.points[i];
    assert.ok(a.x === b.x || a.y === b.y);
    if (a.y === b.y && a.y > 0 && a.y < 149)
      assert.ok(Math.max(a.x, b.x) <= 440 || Math.min(a.x, b.x) >= 720);
    if (a.x === b.x && a.x > 440 && a.x < 720)
      assert.ok(Math.max(a.y, b.y) <= 0 || Math.min(a.y, b.y) >= 149);
  }
});
test("same-column relationships route outside both tables", () => {
  const tables = [routingTable("a", 0, 0), routingTable("b", 0, 240)];
  const link = relation("b", "a"),
    route = routeRelationships([link], tables)[link.id];
  assert.equal(route.sourceSide, "right");
  assert.equal(route.targetSide, "right");
  assert.ok(verticalTracks(route).every((x) => x > 280));
});
test("routing ignores missing tables and fields", () => {
  assert.deepEqual(routeRelationships([relation("a", "b")], []), {});
  const tables = [routingTable("a", 0, 0), routingTable("b", 440, 0)];
  assert.deepEqual(
    routeRelationships(
      [
        {
          ...relation("a", "b"),
          source: { tableId: "a", columnId: "missing" },
        },
      ],
      tables,
    ),
    {},
  );
});

test("new tables are placed beside a saved layout without moving existing tables", () => {
  const saved = { a: { x: 1100, y: 700 }, b: { x: 100, y: 200 } };
  const positions = initialTablePositions(
    [table("a"), table("b"), table("new")],
    [],
    saved,
  );
  assert.deepEqual(positions.a, saved.a);
  assert.deepEqual(positions.b, saved.b);
  assert.ok(positions.new.x >= saved.a.x + 280 + 40);
});

test("a foreign key to its own field has a visible loop outside the table", () => {
  const t = routingTable("a", 0, 0),
    link = relation("a", "a");
  const route = routeRelationships([link], [t])[link.id];
  assert.ok(route.points.length >= 6);
  assert.ok(new Set(route.points.map((p) => p.x)).size >= 3);
  for (const p of route.points)
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});

test("composite foreign keys project every field pair without becoming separate constraints", () => {
  const r = relation("child", "parent");
  r.source.columnIds = ["child:0", "child:1"];
  r.target.columnIds = ["parent:0", "parent:1"];
  const paths = relationPaths([r]);
  assert.equal(paths.length, 2);
  assert.ok(paths.every((p) => p.group === r));
  assert.equal(new Set(paths.map((p) => p.relation.id)).size, 2);
  assert.deepEqual(
    paths.map((p) => [p.relation.source.columnId, p.relation.target.columnId]),
    [
      ["child:0", "parent:0"],
      ["child:1", "parent:1"],
    ],
  );
});
