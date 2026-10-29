import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Position,
  useViewport,
  type EdgeProps,
} from "@xyflow/react";
import { useEdgeMidpoint } from "./use-edge-midpoint.ts";
import type { RelationshipRoute } from "./relationship-routing";

function rounded(points: [number, number][]) {
  let path = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const before = points[i - 1],
      corner = points[i],
      after = points[i + 1];
    const a = Math.hypot(corner[0] - before[0], corner[1] - before[1]);
    const b = Math.hypot(after[0] - corner[0], after[1] - corner[1]);
    const radius = Math.min(9, a / 2, b / 2);
    if (!a || !b) continue;
    const from = [
      corner[0] + ((before[0] - corner[0]) / a) * radius,
      corner[1] + ((before[1] - corner[1]) / a) * radius,
    ];
    const to = [
      corner[0] + ((after[0] - corner[0]) / b) * radius,
      corner[1] + ((after[1] - corner[1]) / b) * radius,
    ];
    path += ` L ${from[0]} ${from[1]} Q ${corner[0]} ${corner[1]} ${to[0]} ${to[1]}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${last[0]} ${last[1]}`;
}

export default function RelationshipEdge(props: EdgeProps) {
  const route = props.data?.route as RelationshipRoute | undefined;
  const focused = props.data?.focused as boolean;
  const { zoom } = useViewport();
  const color = props.style?.stroke;
  const sourceDirection = props.sourcePosition === Position.Left ? -1 : 1;
  const targetDirection = props.targetPosition === Position.Left ? -1 : 1;
  const arrowLength = 9 / zoom,
    arrowHalfHeight = 4 / zoom;
  let [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    borderRadius: 8,
  });
  if (route?.points.length) {
    const points = route.points.map(
      (point) => [point.x, point.y] as [number, number],
    );
    points[0] = [props.sourceX, props.sourceY];
    points[1][1] = props.sourceY;
    points[points.length - 2][1] = props.targetY;
    points[points.length - 1] = [props.targetX, props.targetY];
    path = rounded(points);
    const horizontal = points
      .slice(1)
      .map((point, i) => ({
        from: points[i],
        to: point,
      }))
      .filter(({ from, to }) => from[1] === to[1])
      .sort(
        (a, b) => Math.abs(b.from[0] - b.to[0]) - Math.abs(a.from[0] - a.to[0]),
      );
    if (horizontal.length) {
      labelX = (horizontal[0].from[0] + horizontal[0].to[0]) / 2;
      labelY = horizontal[0].from[1];
    }
  }
  const { ref, point } = useEdgeMidpoint(path, { x: labelX, y: labelY });
  return (
    <>
      <path ref={ref} d={path} fill="none" stroke="none" pointerEvents="none" aria-hidden="true" />
      <path
        d={path}
        fill="none"
        stroke="#fafbfc"
        strokeWidth={focused ? 7 : 5}
        strokeLinejoin="round"
        pointerEvents="none"
      />
      <BaseEdge
        id={props.id}
        path={path}
        style={props.style}
        interactionWidth={12}
      />
      <g
        fill={color}
        stroke={color}
        opacity={props.style?.opacity ?? 1}
        pointerEvents="none"
      >
        <circle
          cx={props.sourceX - sourceDirection * 3}
          cy={props.sourceY}
          r={3}
          fill="#fff"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={props.targetX - targetDirection * 3}
          cy={props.targetY}
          r={3}
          fill="#fff"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        <path
          className="relation-arrow"
          d={`M ${props.targetX} ${props.targetY} L ${props.targetX + targetDirection * arrowLength} ${props.targetY - arrowHalfHeight} L ${props.targetX + targetDirection * arrowLength} ${props.targetY + arrowHalfHeight} Z`}
          stroke="none"
        />
      </g>
      {focused && props.data?.labelVisible !== false && (
        <EdgeLabelRenderer>
          <div
            className="relation-label nodrag nopan"
            style={{
              transform: `translate(${point.x}px, ${point.y - 7 / zoom}px) scale(${1 / zoom}) translate(-50%, -100%)`,
              transformOrigin: "0 0",
            }}
            title={String(props.label)}
          >
            {props.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
