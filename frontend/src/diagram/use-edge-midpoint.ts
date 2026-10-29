import { useLayoutEffect, useRef, useState } from "react";

// Measure the rendered path, including curves and every routed segment. Keeping
// coordinates in graph space lets React Flow apply pan/zoom exactly once.
export function useEdgeMidpoint(path: string, fallback: { x: number; y: number }) {
  const ref = useRef<SVGPathElement>(null);
  const [measured, setMeasured] = useState<{ path: string; x: number; y: number }>();
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const length = element.getTotalLength();
    if (!Number.isFinite(length)) return;
    const point = element.getPointAtLength(length / 2);
    if (Number.isFinite(point.x) && Number.isFinite(point.y))
      setMeasured({ path, x: point.x, y: point.y });
  }, [path]);
  return { ref, point: measured?.path === path ? measured : fallback };
}
