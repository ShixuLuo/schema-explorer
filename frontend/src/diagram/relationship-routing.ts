import type { XYPosition } from "@xyflow/react";
import type { ForeignKeySpec } from "../model/schema.ts";

export type RoutingTable = {
  id: string;
  position: XYPosition;
  width: number;
  height: number;
  columns: string[];
  portOffset?: number;
};
export type RelationshipRoute = {
  sourceSide: "left" | "right";
  targetSide: "left" | "right";
  points: XYPosition[];
};
type Segment = { a: XYPosition; b: XYPosition };
const clearance = 24;
const spacing = 16;

function segments(points: XYPosition[]): Segment[] {
  return points.slice(1).flatMap((b, i) => {
    const a = points[i];
    return a.x === b.x && a.y === b.y ? [] : [{ a, b }];
  });
}
function overlap(a: number, b: number, c: number, d: number) {
  return Math.max(
    0,
    Math.min(Math.max(a, b), Math.max(c, d)) -
      Math.max(Math.min(a, b), Math.min(c, d)),
  );
}
function crossesTable({ a, b }: Segment, table: RoutingTable) {
  const { x, y } = table.position;
  return a.x === b.x
    ? a.x > x - 8 &&
        a.x < x + table.width + 8 &&
        overlap(a.y, b.y, y - 8, y + table.height + 8) > 0
    : a.y > y - 8 &&
        a.y < y + table.height + 8 &&
        overlap(a.x, b.x, x - 8, x + table.width + 8) > 0;
}

// Route the complete set together: separate vertical tracks instead of drawing
// independent smooth-step paths that accidentally look like a shared bus.
export function routeRelationships(
  relations: ForeignKeySpec[],
  tables: RoutingTable[],
): Record<string, RelationshipRoute> {
  const result: Record<string, RelationshipRoute> = {};
  const used: Segment[] = [];
  const byId = new Map(tables.map((table) => [table.id, table]));
  const ordered = [...relations].sort((a, b) => {
    const distance = (r: ForeignKeySpec) => {
      const source = byId.get(r.source_table),
        target = byId.get(r.target_table);
      return source && target
        ? Math.abs(source.position.x - target.position.x)
        : 0;
    };
    return distance(a) - distance(b) || a.id.localeCompare(b.id);
  });
  for (const relation of ordered) {
    const source = byId.get(relation.source_table),
      target = byId.get(relation.target_table);
    if (!source || !target) continue;
    const sourceIndex = source.columns.indexOf(relation.source_columns[0]),
      targetIndex = target.columns.indexOf(relation.target_columns[0]);
    if (sourceIndex < 0 || targetIndex < 0) continue;
    const sourceSide =
      source.position.x + source.width <= target.position.x ? "right" : "left";
    const targetSide =
      target.position.x + target.width <= source.position.x ? "right" : "left";
    // Tables in the same column connect around the outside, not through a body.
    const sameColumn = sourceSide === "left" && targetSide === "left";
    const ss = sameColumn ? "right" : sourceSide;
    const ts = sameColumn ? "right" : targetSide;
    const start = {
      x: source.position.x + (ss === "right" ? source.width + 3 : -3),
      y: source.position.y + (source.portOffset ?? 63) + sourceIndex * 32,
    };
    const end = {
      x: target.position.x + (ts === "right" ? target.width + 3 : -3),
      y: target.position.y + (target.portOffset ?? 63) + targetIndex * 32,
    };
    const sd = ss === "right" ? 1 : -1,
      td = ts === "right" ? 1 : -1;
    let best: XYPosition[] = [],
      bestCost = Infinity;
    const consider = (points: XYPosition[]) => {
      const parts = segments(points);
      let cost =
        parts.reduce(
          (n, { a, b }) => n + Math.abs(a.x - b.x) + Math.abs(a.y - b.y),
          0,
        ) +
        parts.length * 12;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        for (const table of tables) {
          // The first and last short segments leave their own endpoint bounds.
          if (
            (i === 0 && table.id === source.id) ||
            (i === parts.length - 1 && table.id === target.id)
          )
            continue;
          if (crossesTable(part, table)) cost += 1_000_000;
        }
        for (const other of used) {
          const vertical = part.a.x === part.b.x;
          if (vertical !== (other.a.x === other.b.x)) continue;
          const gap = vertical
            ? Math.abs(part.a.x - other.a.x)
            : Math.abs(part.a.y - other.a.y);
          if (gap >= spacing) continue;
          const shared = vertical
            ? overlap(
                Math.min(part.a.y, part.b.y) - spacing / 2,
                Math.max(part.a.y, part.b.y) + spacing / 2,
                Math.min(other.a.y, other.b.y) - spacing / 2,
                Math.max(other.a.y, other.b.y) + spacing / 2,
              )
            : overlap(part.a.x, part.b.x, other.a.x, other.b.x);
          // Shared field endpoints may converge; long common trunks are costly.
          cost += shared * (1 - gap / spacing) * 20;
        }
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = points;
      }
    };
    if (!sameColumn) {
      const lo = Math.min(start.x, end.x) + clearance,
        hi = Math.max(start.x, end.x) - clearance;
      const middle = (lo + hi) / 2;
      const lanes = [middle];
      for (let step = spacing; step <= hi - lo; step += spacing)
        lanes.push(middle - step, middle + step);
      for (const x of lanes)
        if (x >= lo && x <= hi)
          consider([start, { x, y: start.y }, { x, y: end.y }, end]);
    } else if (source.id !== target.id || start.y !== end.y) {
      for (let i = 0; i < 8; i++) {
        const x = Math.max(start.x, end.x) + clearance + i * spacing;
        consider([start, { x, y: start.y }, { x, y: end.y }, end]);
      }
    }
    // Longer links bypass intermediate tables using separate horizontal tracks.
    const lo = Math.min(start.x, end.x),
      hi = Math.max(start.x, end.x);
    const between = tables.filter(
      (t) =>
        t.id === source.id ||
        t.id === target.id ||
        (t.position.x < hi && t.position.x + t.width > lo),
    );
    const rows = new Set<number>();
    for (const table of between)
      for (let lane = 0; lane < 3; lane++) {
        rows.add(table.position.y - clearance - lane * spacing);
        rows.add(table.position.y + table.height + clearance + lane * spacing);
      }
    for (let lane = 0; lane < 6; lane++) {
      const sx = start.x + sd * (clearance + lane * spacing),
        tx =
          end.x +
          td *
            (clearance +
              lane * spacing +
              (source.id === target.id && start.y === end.y ? spacing : 0));
      for (const y of rows)
        consider([
          start,
          { x: sx, y: start.y },
          { x: sx, y },
          { x: tx, y },
          { x: tx, y: end.y },
          end,
        ]);
    }
    result[relation.id] = { sourceSide: ss, targetSide: ts, points: best };
    used.push(...segments(best));
  }
  return result;
}
