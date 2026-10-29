import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { pathMidpoint } from "./edge-geometry.ts";
import { useEdgeMidpoint } from "./use-edge-midpoint.ts";
import InlineLabel from "./InlineLabel.tsx";
import type { MouseEvent } from "react";
export default function CategoryEdge(props: EdgeProps) {
  const route = props.data?.route as { x: number; y: number }[] | undefined;
  let [path, x, y] = getBezierPath(props);
  if (route && route.length > 1) {
    const first = route[0],
      last = route.at(-1)!;
    const points = route.map((p, i) => {
      const t = i / (route.length - 1);
      return {
        x:
          p.x +
          (props.sourceX - first.x) * (1 - t) +
          (props.targetX - last.x) * t,
        y:
          p.y +
          (props.sourceY - first.y) * (1 - t) +
          (props.targetY - last.y) * t,
      };
    });
    path = points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
    const middle = pathMidpoint(points);
    x = middle.x;
    y = middle.y;
  }
  if (props.data?.parallelAttribute) {
    const direction = props.targetX >= props.sourceX ? 1 : -1;
    const bend =
      props.sourceX +
      direction * Math.min(42, Math.abs(props.targetX - props.sourceX) / 3);
    path = `M ${props.sourceX} ${props.sourceY} C ${bend} ${props.sourceY}, ${bend} ${props.targetY}, ${bend + direction * 12} ${props.targetY} L ${props.targetX} ${props.targetY}`;
    x = (bend + direction * 12 + props.targetX) / 2;
    y = props.targetY;
  }
  const { ref, point } = useEdgeMidpoint(path, { x, y });
  return (
    <>
      <path ref={ref} d={path} fill="none" stroke="none" pointerEvents="none" aria-hidden="true" />
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        style={props.style}
        interactionWidth={20}
      />
      <EdgeLabelRenderer>
        <div
          className={`category-edge-label nodrag nopan ${props.data?.attribute ? "attribute" : ""} ${props.selected ? "selected" : ""}`}
          style={{
            transform: `translate(-50%,-50%) translate(${point.x}px,${point.y}px)`,
            color: props.style?.stroke,
            opacity: props.style?.opacity,
          }}
        >
          <InlineLabel
            label={String(props.label ?? "")}
            name={`arrow ${props.data?.accessibleName ?? props.label}`}
            disabled={!!props.data?.readOnly}
            onSelect={
              props.data?.onSelect as (
                event: MouseEvent<HTMLButtonElement>,
              ) => void
            }
            onRename={props.data?.onRename as (name: string) => Promise<void>}
            editRequest={Number(props.data?.editRequest ?? 0)}
          />
          {Number(props.data?.occurrences ?? 0) > 1 && (
            <span className="arrow-occurrences">
              ×{Number(props.data?.occurrences)}
            </span>
          )}
          {!props.data?.readOnly && (
            <button
              className="graph-delete nodrag nopan"
              aria-label={`Delete arrow ${props.label}`}
              onClick={(e) => {
                e.stopPropagation();
                (props.data?.onDelete as () => void)();
              }}
            >
              ×
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
