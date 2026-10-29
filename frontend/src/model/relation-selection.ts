import {
  endpoint,
  samePath,
  type Path,
  type Presentation,
} from "./presentation.ts";
export type RelationCandidate = { left: Path; right: Path };
export function selectedPath(p: Presentation, ids: string[]): Path {
  if (!ids.length) throw new Error("Choose at least one arrow.");
  const first = p.arrows.find((a) => a.id === ids[0]);
  if (!first) throw new Error("A selected arrow no longer exists.");
  const result = { source: first.source, arrows: [...ids] };
  endpoint(p, result);
  return result;
}
// Selection is a multiset of edge occurrences. Confirmation finds two directed
// walks using every occurrence once; direction/order is inferred, repeats are
// never deduplicated. Multiple meanings require an explicit choice.
export function relationCandidates(
  p: Presentation,
  ids: string[],
): RelationCandidate[] {
  if (!ids.length)
    throw new Error("Select the arrows forming a closed relation.");
  if (ids.length > 24)
    throw new Error("Select at most 24 arrow occurrences for one relation.");
  const counts = new Map<string, number>();
  for (const id of ids) {
    if (!p.arrows.some((a) => a.id === id))
      throw new Error("A selected arrow no longer exists.");
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const arrows = p.arrows.filter((a) => counts.has(a.id)),
    result = new Map<string, RelationCandidate>();
  let budget = 12000;
  const key = (path: Path) => JSON.stringify([path.source, path.arrows]);
  for (const source of new Set(arrows.map((a) => a.source))) {
    const paths: { path: Path; end: string; used: Map<string, number> }[] = [];
    const walk = (
      current: string,
      path: string[],
      used: Map<string, number>,
    ) => {
      if (--budget < 0)
        throw new Error(
          "This selection has too many interpretations. Use a smaller closed selection.",
        );
      paths.push({ path: { source, arrows: path }, end: current, used });
      for (const a of arrows)
        if (a.source === current && (used.get(a.id) ?? 0) < counts.get(a.id)!) {
          const next = new Map(used);
          next.set(a.id, (next.get(a.id) ?? 0) + 1);
          walk(a.target, [...path, a.id], next);
        }
    };
    walk(source, [], new Map());
    const buckets = new Map<string, typeof paths>();
    for (const path of paths) {
      const k = JSON.stringify([
        path.end,
        [...counts.keys()].map((id) => path.used.get(id) ?? 0),
      ]);
      const values = buckets.get(k) ?? [];
      values.push(path);
      buckets.set(k, values);
    }
    for (const a of paths) {
      const complement = [...counts].map(
        ([id, n]) => n - (a.used.get(id) ?? 0),
      );
      const partners = buckets.get(JSON.stringify([a.end, complement])) ?? [];
      for (const b of partners) {
        if (samePath(a.path, b.path)) continue;
        const [left, right] =
          key(a.path) < key(b.path) ? [a.path, b.path] : [b.path, a.path];
        result.set(`${key(left)}=${key(right)}`, { left, right });
        if (result.size > 32)
          throw new Error(
            "This selection has many possible relations. Use a smaller closed selection.",
          );
      }
    }
  }
  if (!result.size)
    throw new Error(
      "These arrows do not form two continuous directed paths with the same source and target.",
    );
  return [...result.values()].sort(
    (a, b) =>
      Math.abs(a.left.arrows.length - a.right.arrows.length) -
      Math.abs(b.left.arrows.length - b.right.arrows.length),
  );
}
