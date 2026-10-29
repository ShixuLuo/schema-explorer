import type { Presentation } from "../model/presentation.ts";
import { routeRelationships } from "./relationship-routing.ts";
type Point = { x: number; y: number };
export type AttributePort = {
  handle: string;
  sourceSide: "left" | "right";
  targetSide: "left" | "right";
  offset: number;
};
export function categoryProjection(p: Presentation, equationId?: string) {
  const equation = p.equations.find((e) => e.id === equationId),
    left = new Set(equation?.left.arrows ?? []),
    right = new Set(equation?.right.arrows ?? []);
  const entities = p.objects.filter((o) => o.kind === "entity"),
    entityIds = new Set(entities.map((o) => o.id));
  const typeObjects = p.objects.filter((o) => o.kind === "type"),
    used = new Set([
      ...p.arrows.filter((a) => !entityIds.has(a.target)).map((a) => a.target),
    ]);
  const objects = [...entities, ...typeObjects.filter((o) => used.has(o.id))],
    highlighted = new Set<string>();
  if (equation) {
    highlighted.add(equation.left.source);
    p.arrows
      .filter((a) => left.has(a.id) || right.has(a.id))
      .forEach((a) => {
        highlighted.add(a.source);
        highlighted.add(a.target);
      });
  }
  return {
    objects,
    typeObjects,
    arrows: p.arrows,
    references: p.arrows.filter(
      (a) => entityIds.has(a.source) && entityIds.has(a.target),
    ),
    left,
    right,
    highlighted,
    equation,
  };
}
export function routeCategoryReferences(
  graph: ReturnType<typeof categoryProjection>,
  positions: Record<string, Point>,
  sizes: Record<string, { width: number; height: number }>,
) {
  return routeRelationships(
    graph.references.map((a) => ({
      id: a.id,
      source_table: a.source,
      source_columns: ["entity"],
      target_table: a.target,
      target_columns: ["entity"],
    })),
    graph.objects
      .filter((o) => positions[o.id])
      .map((o) => ({
        id: o.id,
        position: positions[o.id],
        ...sizes[o.id],
        portOffset: sizes[o.id].height / 2,
        columns: ["entity"],
      })),
  );
}
export function categoryLayout(graph: ReturnType<typeof categoryProjection>) {
  const entities = graph.objects.filter((o) => o.kind === "entity"),
    types = graph.objects.filter((o) => o.kind === "type");
  const attributes = graph.arrows.filter((a) =>
    types.some((t) => t.id === a.target),
  );
  const activeTypes = types.filter((t) =>
    attributes.some((a) => a.target === t.id),
  );
  const entityWidth = 140,
    entityHeight = 54,
    typeWidth = 100,
    rowGap = 26,
    groupGap = 26,
    padding = 24,
    linkWidth = 180;
  const positions: Record<string, Point> = {},
    sizes: Record<string, { width: number; height: number }> = {},
    ports: Record<string, AttributePort> = {};
  const targets = new Map<
    string,
    { arrow: string; side: "left" | "right"; y: number }[]
  >();
  for (const entity of entities)
    sizes[entity.id] = { width: entityWidth, height: entityHeight };
  if (activeTypes.length === 1) {
    const type = activeTypes[0],
      loads = [padding, padding],
      typeX = padding + entityWidth + linkWidth;
    for (const entity of entities) {
      const attrs = attributes.filter((a) => a.source === entity.id),
        side = loads[0] <= loads[1] ? 0 : 1,
        top = loads[side],
        height = Math.max(entityHeight, attrs.length * rowGap);
      positions[entity.id] = {
        x: side === 0 ? padding : typeX + typeWidth + linkWidth,
        y: top + height / 2 - entityHeight / 2,
      };
      attrs.forEach((a, i) => {
        const y = top + height / 2 + (i - (attrs.length - 1) / 2) * rowGap;
        const targetSide = side === 0 ? "left" : "right";
        const list = targets.get(type.id) ?? [];
        list.push({ arrow: a.id, side: targetSide, y });
        targets.set(type.id, list);
        ports[a.id] = {
          handle: `attribute-port:${a.id}`,
          sourceSide: side === 0 ? "right" : "left",
          targetSide,
          offset: 0,
        };
      });
      loads[side] += height + groupGap;
    }
    const points = targets.get(type.id) ?? [];
    const lo = Math.min(...points.map((point) => point.y)),
      hi = Math.max(...points.map((point) => point.y));
    positions[type.id] = { x: typeX, y: lo - padding };
    sizes[type.id] = {
      width: typeWidth,
      height: Math.max(entityHeight, hi - lo + 2 * padding),
    };
  } else if (activeTypes.length >= 2) {
    let y = padding;
    const entityX = padding + typeWidth + linkWidth;
    for (const entity of entities) {
      const groups = activeTypes.map((t) =>
        attributes.filter((a) => a.source === entity.id && a.target === t.id),
      );
      const height = Math.max(
        entityHeight,
        ...groups.map((a) => a.length * rowGap),
      );
      positions[entity.id] = {
        x: entityX,
        y: y + height / 2 - entityHeight / 2,
      };
      groups.forEach((attrs, index) =>
        attrs.forEach((a, i) => {
          const targetSide = index === 0 ? "right" : "left",
            at = y + height / 2 + (i - (attrs.length - 1) / 2) * rowGap;
          const list = targets.get(a.target) ?? [];
          list.push({ arrow: a.id, side: targetSide, y: at });
          targets.set(a.target, list);
          ports[a.id] = {
            handle: `attribute-port:${a.id}`,
            sourceSide: index === 0 ? "left" : "right",
            targetSide,
            offset: 0,
          };
        }),
      );
      y += height + groupGap;
    }
    activeTypes.forEach((type, i) => {
      const points = targets.get(type.id) ?? [];
      const lo = Math.min(...points.map((p) => p.y)),
        hi = Math.max(...points.map((p) => p.y));
      positions[type.id] = {
        x:
          i === 0
            ? padding
            : entityX + entityWidth + linkWidth + (i - 1) * (typeWidth + 40),
        y: lo - padding,
      };
      sizes[type.id] = {
        width: typeWidth,
        height: Math.max(entityHeight, hi - lo + 2 * padding),
      };
    });
  } else {
    const cols = Math.max(1, Math.ceil(Math.sqrt(entities.length)));
    entities.forEach((entity, i) => {
      positions[entity.id] = {
        x: padding + (i % cols) * (entityWidth + 100),
        y: padding + Math.floor(i / cols) * (entityHeight + 90),
      };
    });
  }
  let extraY =
    Math.max(
      padding,
      ...Object.entries(positions).map(([id, p]) => p.y + sizes[id].height),
    ) + 60;
  for (const type of types) {
    if (!positions[type.id]) {
      positions[type.id] = { x: padding, y: extraY };
      sizes[type.id] = { width: typeWidth, height: entityHeight };
      extraY += entityHeight + 30;
    }
    for (const point of targets.get(type.id) ?? [])
      ports[point.arrow].offset = point.y - positions[type.id].y;
  }
  const routed = routeCategoryReferences(graph, positions, sizes);
  return {
    positions,
    sizes,
    attributePorts: ports,
    routes: Object.fromEntries(
      Object.entries(routed).map(([id, r]) => [id, r.points]),
    ),
  };
}
