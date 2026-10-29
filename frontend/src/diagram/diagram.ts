import {
  Graph,
  layout,
  type EdgeLabel,
  type GraphLabel,
  type NodeLabel,
} from "@dagrejs/dagre";
import type { Viewport, XYPosition } from "@xyflow/react";
import type { ViewTable } from "../model/comparison.ts";
import type { ForeignKeySpec } from "../model/schema.ts";

export type DiagramAnchor = {
  point: XYPosition;
  nodeId?: string;
  offset?: XYPosition;
};
export function detailsAnchor(
  point: XYPosition,
  node?: { id: string; position: XYPosition },
): DiagramAnchor {
  return node
    ? {
        point,
        nodeId: node.id,
        offset: { x: point.x - node.position.x, y: point.y - node.position.y },
      }
    : { point };
}
export function projectAnchor(
  anchor: DiagramAnchor,
  positions: Record<string, XYPosition>,
  viewport: Viewport,
): XYPosition | null {
  const node = anchor.nodeId ? positions[anchor.nodeId] : undefined;
  if (anchor.nodeId && !node) return null;
  const point =
    node && anchor.offset
      ? { x: node.x + anchor.offset.x, y: node.y + anchor.offset.y }
      : anchor.point;
  return {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y,
  };
}

type Size = { width: number; height: number };
export function relationPaths(relations: ForeignKeySpec[]) {
  return relations.flatMap((group) => {
    const sources = group.source_columns;
    const targets = group.target_columns;
    return sources.map((columnId, index) => ({
      group,
      index,
      relation: {
        ...group,
        id: sources.length > 1 ? `${group.id}/field/${index}` : group.id,
        source_columns: [columnId],
        target_columns: [targets[index]],
      },
    }));
  });
}
export function initialTablePositions(
  tables: ViewTable[],
  relations: ForeignKeySpec[],
  saved: Record<string, XYPosition>,
): Record<string, XYPosition> {
  const retained = tables.filter((table) => saved[table.id]);
  if (!retained.length) return arrangeTables(tables, relations);
  const right = Math.max(...retained.map((table) => saved[table.id].x + 280));
  const added = arrangeTables(
    tables.filter((table) => !saved[table.id]),
    relations,
  );
  return Object.fromEntries(
    tables.map((table) => [
      table.id,
      saved[table.id] ?? {
        x: added[table.id].x + right + 40,
        y: added[table.id].y,
      },
    ]),
  );
}
export function arrangeTables(
  tables: ViewTable[],
  relations: ForeignKeySpec[],
  sizes: Record<string, Size> = {},
  aspectRatio = 1.6,
): Record<string, XYPosition> {
  if (!tables.length) return {};
  const ids = new Set(tables.map((table) => table.id));
  const links = relations.filter(
    (relation) =>
      ids.has(relation.source_table) &&
      ids.has(relation.target_table) &&
      relation.source_table !== relation.target_table,
  );
  const neighbors = new Map(
    tables.map((table) => [table.id, new Set<string>()]),
  );
  for (const link of links) {
    neighbors.get(link.source_table)!.add(link.target_table);
    neighbors.get(link.target_table)!.add(link.source_table);
  }
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const table of tables) {
    if (visited.has(table.id)) continue;
    const component: string[] = [],
      queue = [table.id];
    visited.add(table.id);
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      component.push(id);
      for (const next of neighbors.get(id)!)
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
    }
    components.push(component);
  }
  const blocks = components
    .map((component) => {
      const graph = new Graph<GraphLabel, NodeLabel, EdgeLabel>({
        multigraph: true,
      });
      graph.setGraph({
        rankdir: "LR",
        ranksep: Math.max(
          140,
          50 +
            16 *
              Math.max(
                ...component.map(
                  (id) =>
                    links.filter(
                      (link) =>
                        link.source_table === id || link.target_table === id,
                    ).length,
                ),
              ),
        ),
        nodesep: 65,
        edgesep: 22,
        marginx: 0,
        marginy: 0,
        acyclicer: "greedy",
        ranker: "network-simplex",
      });
      graph.setDefaultEdgeLabel(() => ({}));
      for (const id of component) {
        const table = tables.find((table) => table.id === id)!;
        graph.setNode(
          id,
          sizes[id] ?? { width: 280, height: 53 + table.columns.length * 32 },
        );
      }
      for (const link of links)
        if (component.includes(link.source_table)) {
          // Referenced tables appear on the left; foreign-key arrows still point
          // toward them when rendered by the diagram.
          graph.setEdge(
            link.target_table,
            link.source_table,
            { weight: 1, minlen: 1 },
            link.id,
          );
        }
      layout(graph);
      const positions: Record<string, XYPosition> = {};
      for (const id of component) {
        const node = graph.node(id);
        positions[id] = {
          x: node.x! - node.width / 2,
          y: node.y! - node.height / 2,
        };
      }
      return {
        width: graph.graph().width ?? 280,
        height: graph.graph().height ?? 200,
        positions,
        count: component.length,
      };
    })
    .sort(
      (a, b) => b.count - a.count || b.width * b.height - a.width * a.height,
    );
  const rowWidth = Math.max(
    ...blocks.map((block) => block.width),
    Math.sqrt(
      blocks.reduce(
        (area, block) => area + (block.width + 75) * (block.height + 75),
        0,
      ) * Math.max(0.5, Math.min(3, aspectRatio)),
    ),
  );
  const result: Record<string, XYPosition> = {};
  let x = 40,
    y = 40,
    shelfHeight = 0;
  for (const block of blocks) {
    if (x > 40 && x + block.width > rowWidth + 40) {
      x = 40;
      y += shelfHeight + 80;
      shelfHeight = 0;
    }
    for (const [id, position] of Object.entries(block.positions))
      result[id] = { x: position.x + x, y: position.y + y };
    x += block.width + 80;
    shelfHeight = Math.max(shelfHeight, block.height);
  }
  return result;
}
