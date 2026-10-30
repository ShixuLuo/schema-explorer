export type Box = { left: number; top: number; width: number; height: number };

export function placePopover(
  target: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  obstacles: readonly Box[],
  protectTarget: boolean,
): Box {
  const gap = 18, inset = 12;
  const gaps = [gap, 4];
  const width = Math.min(size.width, viewport.width - inset * 2);
  const height = Math.min(size.height, viewport.height - inset * 2);
  const clampX = (x: number) => Math.max(inset, Math.min(x, viewport.width - width - inset));
  const clampY = (y: number) => Math.max(inset, Math.min(y, viewport.height - height - inset));
  // An empty space may start between controls, not just beside the whole panel.
  const xs = new Set([
    inset, viewport.width - width - inset,
    target.left, target.left + target.width + gap, target.left - width - gap,
    ...obstacles.flatMap(o => gaps.flatMap(space => [o.left + o.width + space, o.left - width - space])),
  ].map(clampX));
  const ys = new Set([
    inset, viewport.height - height - inset,
    target.top, target.top - height - gap, target.top + target.height + gap,
    ...obstacles.flatMap(o => gaps.flatMap(space => [o.top + o.height + space, o.top - height - space])),
  ].map(clampY));
  const overlap = (a: Box, b: Box) =>
    Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  let best: Box = { left: inset, top: inset, width, height };
  let bestOverlap = Infinity, bestDistance = Infinity;
  for (const left of xs) for (const top of ys) {
    const box = { left, top, width, height };
    const covered = obstacles.reduce((sum, o) => sum + overlap(box, o), 0) +
      (protectTarget ? overlap(box, target) * 8 : 0);
    const distance = Math.hypot(left - target.left, top - target.top);
    // A nearer card must never win by covering a control when a clear spot exists.
    if (covered < bestOverlap || (covered === bestOverlap && distance < bestDistance)) {
      best = box; bestOverlap = covered; bestDistance = distance;
    }
  }
  return best;
}
