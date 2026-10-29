import dagre from "@dagrejs/dagre";
import type { HistoryInfo } from "../application/history.ts";
import type { CheckpointInfo } from "../model/workspace.ts";
export type HistoryGraphNode = {
  id: string;
  position: { x: number; y: number };
  checkpoint: CheckpointInfo;
  height: number;
};
export type HistoryGraphLink = { id: string; source: string; target: string };
export function layoutHistory(value: HistoryInfo): {
  nodes: HistoryGraphNode[];
  edges: HistoryGraphLink[];
} {
  const ids = new Set(value.checkpoints.map((c) => c.id));
  const nodes = value.checkpoints.map((checkpoint) => ({
    id: checkpoint.id,
    position: { x: 0, y: 0 },
    checkpoint,
    height: 64 + (checkpoint.tags?.length ? 24 : 0),
  }));
  const edges = value.checkpoints.flatMap((c) =>
    c.parentId && ids.has(c.parentId)
      ? [{ id: `parent:${c.id}`, source: c.parentId, target: c.id }]
      : [],
  );
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "TB",
    ranksep: 48,
    nodesep: 80,
    marginx: 28,
    marginy: 28,
  });
  for (const node of nodes)
    graph.setNode(node.id, { width: 260, height: node.height });
  for (const edge of edges) graph.setEdge(edge.source, edge.target);
  dagre.layout(graph);
  for (const node of nodes) {
    const p = graph.node(node.id);
    node.position = { x: p.x - 130, y: p.y - node.height / 2 };
  }
  return { nodes, edges };
}
